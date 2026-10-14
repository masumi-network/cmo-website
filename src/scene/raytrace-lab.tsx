"use client";

// Dev only (`?raytrace`): the photo-real spike. Path-traces the live city with
// WebGPU on a canvas over the WebGL one, and measures what the research doc
// asks: BVH build time, shader compile time, samples per second, time to N
// samples. scene.tsx loads it only outside production builds.
// Keys: R shows or hides the traced image, F freezes the WebGL city (fair timing),
// P reads the scene again and restarts (a second rest).
// Numbers are on window.__rt for scripts/raytrace-bench.mjs.

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { initUNetFromURL } from "oidn-web";
import { OIDNDenoiser, WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import { BVHComputeData } from "three-mesh-bvh/webgpu";
import { float, getViewPosition, perspectiveDepthToViewZ, screenUV, select, smoothstep, texture, uniform, vec4 } from "three/tsl";
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  NoToneMapping,
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  FloatType,
  LinearFilter,
  MeshStandardMaterial,
  Matrix4,
  RGBAFormat,
  SRGBColorSpace,
  WebGPURenderer,
  DepthTexture,
  Fog,
  MeshBasicNodeMaterial,
  QuadMesh,
  RenderTarget,
  Vector2,
  type BatchedMesh,
  type PerspectiveCamera,
  type Mesh,
  type Object3D,
  type Scene,
  type Texture,
} from "three/webgpu";
import { PLATE_RANGE, encodePlate, type PlateEntry } from "@/lib/plates";
import { lightingAt } from "@/lib/time";
import { dayNow } from "./shared";
import { CHAINS, screenSpace, type Chain } from "./fx-lab";
import { splitScene } from "./plates";
import { bakeGround } from "./bake-ground";
import { TRACE_LAYER, buildTwins } from "./traced";

type Stats = {
  buildMs: number;
  /** Building the plain twins of patched meshes (traced.ts). */
  twinMs: number;
  /** Re-reading moved objects (Cuso, cars) once the camera rests. */
  poseMs: number;
  /** From the last reset to the denoised image on screen (after `spp` samples). */
  denoisedMs: number;
  /** fx mode: median GPU ms per frame of the effect chain, over the last 120 frames. */
  fxMs?: number;
  fxFrames?: number;
  /** plates mode: the largest camera-matrix difference from the plate's camera. */
  plateOff?: number;
  firstSampleMs: number;
  samples: number;
  samplesPerSecond: number;
  sinceReset: number;
  /** ms since the last reset when each sample count was first reached. */
  reached: Record<number, number>;
  error?: string;
};

declare global {
  interface Window {
    __rt?: Stats;
    __rtCamera?: () => number[];
    /** plate mode: the plate (base64 WebP) and its manifest entry, for scripts/plates.mjs */
    __plate?: { webp: string; entry: PlateEntry };
  }
}

/**
 * three-mesh-bvh 0.9.16 bug: getBVH fills a shared range object but sets start
 * and vertexStart only for batched meshes, so a mesh after a batched one (Cuso)
 * reads past its end. Start every lookup from zero.
 */
type Range = { start: number; vertexStart: number };
const proto = BVHComputeData.prototype as unknown as { getBVH: (o: unknown, i: number, r: Range) => unknown; zeroed?: boolean };
if (!proto.zeroed) {
  const getBVH = proto.getBVH;
  proto.getBVH = function (this: unknown, object, instanceId, range) {
    range.start = 0;
    range.vertexStart = 0;
    return getBVH.call(this, object, instanceId, range);
  };
  proto.zeroed = true;
}

const MILESTONES = [1, 4, 16, 64, 256];
const DEG = Math.PI / 180;

/** The app's sky shader, baked into an equirect the path tracer can light with. */
function skyTexture(hour: number): Texture {
  const L = lightingAt(hour);
  const top = new Color(L.skyTop);
  const horizon = new Color(L.skyHorizon);
  const sunColor = new Color(L.night > 0.5 ? "#c9d4ff" : L.sunColor);
  // haze: near the horizon the sky turns to the fog colour, as fogged distant ground does, so the two meet without an edge
  const fog = new Color(L.fog);
  const elevation = (L.elevation < 0 ? 38 : L.elevation) * DEG;
  const azimuth = L.azimuth * DEG;
  const sx = Math.cos(elevation) * Math.sin(azimuth);
  const sy = Math.sin(elevation);
  const sz = Math.cos(elevation) * Math.cos(azimuth);
  const W = 512;
  const H = 256;
  const data = new Float32Array(W * H * 4);
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < H; j++) {
    const theta = ((j + 0.5) / H - 0.5) * Math.PI;
    for (let i = 0; i < W; i++) {
      const phi = ((i + 0.5) / W - 0.5) * 2 * Math.PI;
      const x = Math.cos(theta) * Math.cos(phi);
      const y = Math.sin(theta);
      const z = Math.cos(theta) * Math.sin(phi);
      const k = smooth(-0.02, 0.55, Math.min(Math.max(y, -0.2), 1));
      // the glow only: the sun itself is the directional light
      const glow = Math.pow(Math.max(x * sx + y * sy + z * sz, 0), 12) * 0.25 * (1 - L.night * 0.6);
      const o = (j * W + i) * 4;
      const haze = smooth(0.12, 0, y);
      data[o] = (horizon.r + (top.r - horizon.r) * k) * (1 - haze) + fog.r * haze + sunColor.r * glow;
      data[o + 1] = (horizon.g + (top.g - horizon.g) * k) * (1 - haze) + fog.g * haze + sunColor.g * glow;
      data[o + 2] = (horizon.b + (top.b - horizon.b) * k) * (1 - haze) + fog.b * haze + sunColor.b * glow;
      data[o + 3] = 1;
    }
  }
  const tex = new DataTexture(data, W, H, RGBAFormat, FloatType);
  tex.mapping = EquirectangularReflectionMapping;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Stands in for materials the tracer cannot read (no colour: the sky's shader). Their meshes are hidden too. */
const blank = new MeshStandardMaterial();

/**
 * Runs `fn` with the scene as the path tracer should see it: the sky as an
 * equirect (not the WebGL-only studio cube), and meshes with custom shader
 * materials (the sky dome) hidden behind a stand-in material. Meshes with a
 * plain twin (traced.ts) are hidden too: the twin stands in for them.
 */
function asTraced(scene: Scene, sky: Texture, twinned: Object3D[], fn: () => void) {
  const swapped: [Mesh, Mesh["material"], boolean][] = [];
  const shown = twinned.filter((m) => m.visible);
  for (const m of shown) m.visible = false;
  scene.traverse((o) => {
    // three-mesh-bvh reads one BVH per batched geometry here and builds the missing ones (the trees).
    if ((o as BatchedMesh).isBatchedMesh) (o as BatchedMesh & { boundsTrees?: unknown[] }).boundsTrees ??= [];
    const mesh = o as Mesh;
    // no colour (the sky's shader), not drawn at all (material.visible false), or adding light (washes, glows):
    // the tracer would draw them as solid surfaces (the mural's black wash hid the mural)
    if (mesh.isMesh && [mesh.material].flat().some((m) => !("color" in m) || !m.visible || m.blending === AdditiveBlending)) {
      swapped.push([mesh, mesh.material, mesh.visible]);
      mesh.material = blank;
      mesh.visible = false;
    }
  });
  const { environment, background } = scene;
  scene.environment = sky;
  scene.background = sky;
  try {
    fn();
  } finally {
    scene.environment = environment;
    scene.background = background;
    for (const m of shown) m.visible = true;
    for (const [mesh, material, visible] of swapped) {
      mesh.material = material;
      mesh.visible = visible;
    }
  }
}

/**
 * The denoiser rasterizes albedo and normals inside renderSample to guide it:
 * show that pass what the tracer sees (the twins, not the originals, GLSL
 * meshes or lines) and a sky the WebGPU raster can read.
 */
function guided(scene: Scene, camera: PerspectiveCamera, sky: Texture, hide: Object3D[], fn: () => void) {
  const shown = hide.filter((m) => m.visible);
  for (const m of shown) m.visible = false;
  const mask = camera.layers.mask;
  camera.layers.enable(TRACE_LAYER);
  const { environment, background } = scene;
  scene.environment = sky;
  scene.background = sky;
  try {
    fn();
  } finally {
    Object.assign(scene, { environment, background });
    camera.layers.mask = mask;
    for (const m of shown) m.visible = true;
  }
}

/**
 * The scene's distance fog over the traced image: the tracer has no fog, so a
 * depth pass (redrawn when the view changes) blends in the fog colour as three's
 * linear fog does; the sky gets haze near the horizon only.
 * Karl the fog bank (fog.tsx) is a GLSL shader: it needs its TSL port first.
 */
function distanceFog(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const depthTexture = new DepthTexture(size.x, size.y);
  const target = new RenderTarget(size.x, size.y, { depthTexture });
  const depthOnly = new MeshBasicNodeMaterial({ colorWrite: false });
  const near = uniform(camera.near);
  const far = uniform(camera.far);
  const fogNear = uniform(70);
  const fogFar = uniform(340);
  const fogColor = uniform(new Color());
  const depth = texture(depthTexture, screenUV).x;
  const overlay = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false });
  overlay.colorNode = fogColor;
  // Geometry: three's linear fog by distance. Sky: the same haze as skyTexture near the horizon, so a pixel
  // that is half far water and half sky (the depth pass is not antialiased, the trace is) still fogs: no line.
  const ground = smoothstep(fogNear, fogFar, perspectiveDepthToViewZ(depth, near, far).negate());
  // the city camera's matrices: inside the quad, three's camera nodes are the quad's own camera
  const projectionInverse = uniform(camera.projectionMatrixInverse);
  const world = uniform(camera.matrixWorld);
  const view = getViewPosition(screenUV, float(1), projectionInverse);
  const up = world.mul(vec4(view, 0)).xyz.normalize().y;
  overlay.opacityNode = select(depth.lessThan(0.99999), ground, smoothstep(0.12, 0, up));
  const quad = new QuadMesh(overlay);
  return {
    /** Redraws the depth: after the camera or the objects move. */
    measure(hide: Object3D[]) {
      const { overrideMaterial, environment, background } = scene;
      const shown = hide.filter((m) => m.visible);
      for (const m of shown) m.visible = false;
      // what the tracer sees: the twins (the cables exist only as twins), not the originals
      const mask = camera.layers.mask;
      camera.layers.enable(TRACE_LAYER);
      scene.overrideMaterial = depthOnly;
      scene.environment = null;
      scene.background = null;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      Object.assign(scene, { overrideMaterial, environment, background });
      camera.layers.mask = mask;
      for (const m of shown) m.visible = true;
    },
    draw() {
      if (scene.fog instanceof Fog) {
        fogNear.value = scene.fog.near;
        fogFar.value = scene.fog.far;
        fogColor.value.copy(scene.fog.color);
      }
      near.value = camera.near;
      far.value = camera.far;
      projectionInverse.value = camera.projectionMatrixInverse;
      world.value = camera.matrixWorld;
      renderer.autoClear = false;
      quad.render(renderer);
      renderer.autoClear = true;
    },
    dispose() {
      target.dispose();
      depthOnly.dispose();
      overlay.dispose();
    },
  };
}

/** Kept out of the fog's depth: meshes the WebGPU raster cannot draw (custom GLSL: the sky dome, the fog bank), and lines and points, which the tracer does not see. */
const notInDepth = (scene: Scene) => {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if ((o as { isLine?: boolean }).isLine || (o as { isPoints?: boolean }).isPoints) out.push(m);
    else if (m.isMesh && [m.material].flat().some((x) => "isShaderMaterial" in x && x.isShaderMaterial)) out.push(m);
  });
  return out;
};

/**
 * fx mode: the city through a screen-space effect chain (fx-lab.ts) on the
 * WebGPU renderer, with shadows on as in WebGL, timed per frame on the GPU.
 */
function runEffects(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, originals: Mesh[], stats: Stats, panel: HTMLElement, stopped: () => boolean) {
  const chain = (new URLSearchParams(window.location.search).get("fx") ?? "base") as Chain;
  if (!CHAINS.includes(chain)) throw new Error(`fx must be one of ${CHAINS.join(", ")}`);
  renderer.shadowMap.enabled = true;
  const sky = skyTexture(dayNow().hour);
  const hide = [...notInDepth(scene), ...originals];
  const pipeline = screenSpace(renderer, scene, camera, chain);
  const times: number[] = [];
  const tick = () => {
    if (stopped()) return pipeline.dispose();
    guided(scene, camera, sky, hide, () => pipeline.render());
    renderer.resolveTimestampsAsync("render").then((ms) => {
      if (typeof ms !== "number" || !(ms > 0)) return;
      times.push(ms);
      if (times.length > 120) times.shift();
      const sorted = [...times].sort((a, b) => a - b);
      stats.fxMs = +sorted[sorted.length >> 1].toFixed(2);
      stats.fxFrames = (stats.fxFrames ?? 0) + 1;
      panel.textContent = `fx ${chain}  ${stats.fxMs} ms GPU (median of ${times.length})\nR toggle  F freeze`;
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The denoised plate as the WebGL side needs it: linear colour with the
 * scene's fog mixed in (as three's fog does, before tone mapping), divided by
 * PLATE_RANGE and sRGB-encoded (lib/plates.ts), as WebP.
 */
async function exportPlate(renderer: WebGPURenderer, tracer: WebGPUPathTracer, fog: ReturnType<typeof distanceFog>) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new RenderTarget(size.x, size.y, { type: FloatType });
  const toneMapping = renderer.toneMapping;
  renderer.toneMapping = NoToneMapping;
  renderer.setRenderTarget(target);
  tracer.renderSample(); // done sampling: this only draws the denoised image
  fog.draw();
  renderer.setRenderTarget(null);
  renderer.toneMapping = toneMapping;
  const linear = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y)) as Float32Array;
  target.dispose();
  const canvas = new OffscreenCanvas(size.x, size.y);
  canvas.getContext("2d")!.putImageData(new ImageData(encodePlate(linear, PLATE_RANGE), size.x, size.y), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/webp", quality: 0.9 })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { webp: btoa(bin), width: size.x, height: size.y };
}

export default function RaytraceLab() {
  const { gl, scene, camera, setFrameloop } = useThree();

  useEffect(() => {
    let stop = false;
    const stats: Stats = { buildMs: 0, twinMs: 0, poseMs: 0, denoisedMs: 0, firstSampleMs: 0, samples: 0, samplesPerSecond: 0, sinceReset: 0, reached: {} };
    window.__rt = stats;
    // for scripts: the camera, rounded, to tell when it has come to rest
    window.__rtCamera = () => camera.matrixWorld.elements.map((v) => Math.round(v * 1e4));

    const canvas = document.createElement("canvas");
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none" });
    gl.domElement.after(canvas);
    const panel = document.createElement("pre");
    Object.assign(panel.style, {
      position: "fixed", left: "8px", bottom: "8px", zIndex: "100", margin: "0", padding: "6px 8px",
      font: "11px/1.4 ui-monospace, monospace", color: "#f7f6f2", background: "rgba(17,17,20,0.75)", borderRadius: "6px", pointerEvents: "none",
    });
    document.body.append(panel);

    const cleanup: (() => void)[] = [];
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("raytrace") ?? "";
    const fxMode = mode === "fx";
    const plateMode = mode === "plate";
    let frozen = false;
    let posed = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "r") canvas.style.visibility = canvas.style.visibility === "hidden" ? "" : "hidden";
      if (e.key === "p") posed = false; // read the scene again and restart: a second rest, for steady-state timing
      if (e.key === "f") {
        frozen = !frozen;
        setFrameloop(frozen ? "never" : "always");
        posed = false;
      }
    };
    window.addEventListener("keydown", onKey);

    let renderer: WebGPURenderer | null = null;
    let tracer: WebGPUPathTracer | null = null;
    let sky: Texture | null = null;

    (async () => {
      // The city's triangles and attributes outgrow WebGPU's default 128 MB storage binding: ask for what the GPU has.
      const gpu = (navigator as Navigator & { gpu: { requestAdapter(o: object): Promise<{ limits: Record<string, number> } | null> } }).gpu;
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) throw new Error("no WebGPU adapter");
      const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
      renderer = new WebGPURenderer({ canvas, antialias: false, trackTimestamp: fxMode, requiredLimits: { maxStorageBufferBindingSize, maxBufferSize } });
      await renderer.init();
      if (stop) return;
      renderer.setPixelRatio(Number(new URLSearchParams(window.location.search).get("dpr") ?? 1));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.outputColorSpace = SRGBColorSpace;

      // Wait for the city to finish loading and compiling: the same moment the poster lifts.
      while (!scene.userData.shadersReady && !stop) await new Promise((r) => setTimeout(r, 100));
      if (stop) return;

      const tw0 = performance.now();
      const twins = buildTwins(scene, bakeGround(gl, scene));
      scene.add(twins.group);
      stats.twinMs = performance.now() - tw0;
      cleanup.push(() => {
        scene.remove(twins.group);
        twins.group.traverse((o) => (o as Mesh).geometry?.dispose());
      });

      if (fxMode) {
        runEffects(renderer, scene, camera as PerspectiveCamera, twins.originals, stats, panel, () => stop);
        return;
      }
      // A plate is the static city: the live objects (Cuso, cars, boats) are drawn over it later.
      const live = plateMode ? splitScene(scene).live : [];
      const staticHidden = [...twins.originals, ...live];
      let exported = false;

      tracer = new WebGPUPathTracer(renderer);
      tracer.renderScale = Number(params.get("scale") ?? 1);
      // OIDN runs once the tracer stops at maxSamples. Weights (gitignored): public/lab/oidn, see photoreal.md.
      const denoiser = params.get("denoise") === "0" ? null : new OIDNDenoiser({ initUNetFromURL, auxWeightsUrl: "/lab/oidn/rt_hdr_alb_nrm.tza", colorWeightsUrl: "/lab/oidn/rt_hdr.tza" });
      if (denoiser) {
        tracer.setDenoiser(denoiser);
        tracer.maxSamples = Number(params.get("spp") ?? (plateMode ? 256 : 16));
      }
      let hour = dayNow().hour;
      sky = skyTexture(hour);
      const t0 = performance.now();
      asTraced(scene, sky, staticHidden, () => tracer!.setScene(scene, camera));
      stats.buildMs = performance.now() - t0;
      const t1 = performance.now();
      let resetAt = t1;

      const fog = distanceFog(renderer, scene, camera as PerspectiveCamera);
      const hide = [...notInDepth(scene), ...live];
      const guideHidden = [...hide, ...staticHidden];
      cleanup.push(() => fog.dispose());
      fog.measure(guideHidden);

      const last = new Matrix4().copy(camera.matrixWorld);
      let stillSince = t1;
      let lastPoll = 0;
      const tick = () => {
        if (stop || !tracer) return;
        const now = performance.now();
        // Scrolling changes the hour: new sky and sun.
        const h = dayNow().hour;
        if (Math.abs(h - hour) > 0.02) {
          hour = h;
          sky?.dispose();
          sky = skyTexture(hour);
          asTraced(scene, sky, staticHidden, () => {
            tracer!.updateEnvironment();
            tracer!.updateLights();
          });
          resetAt = now;
          stats.reached = {};
          stats.denoisedMs = 0;
        }
        if (!last.equals(camera.matrixWorld)) {
          last.copy(camera.matrixWorld);
          tracer.updateCamera();
          resetAt = stillSince = now;
          stats.reached = {};
          stats.denoisedMs = 0;
          posed = false;
        }
        // At rest: catch up with what moved since the scene was read (Cuso's pose, cars), then the fog's depth.
        if (!posed && now - stillSince > 300) {
          posed = true;
          const p0 = performance.now();
          // plates re-read too: level-of-detail models (trees) switch on and off with the camera
          if (params.get("pose") === "0") {
            // keep the poses read at load: only restart the samples
            tracer.reset();
          } else {
            // updateTransforms moves whole objects but keeps a skinned mesh's vertices (Cuso ghosts),
            // so read the scene again: the per-geometry BVHs are cached, only the packing repeats.
            asTraced(scene, sky!, staticHidden, () => tracer!.setScene(scene, camera));
          }
          fog.measure(guideHidden);
          stats.poseMs = performance.now() - p0;
          resetAt = now;
          stats.reached = {};
          stats.denoisedMs = 0;
        }
        guided(scene, camera as PerspectiveCamera, sky!, guideHidden, () => tracer!.renderSample());
        if (denoiser?.complete && !stats.denoisedMs) stats.denoisedMs = Math.round(performance.now() - resetAt);
        // plate: once clean, hand the linear, fogged image and the camera to scripts/plates.mjs
        if (plateMode && stats.denoisedMs && !exported) {
          exported = true;
          const day = dayNow();
          const cam = camera as PerspectiveCamera;
          exportPlate(renderer!, tracer, fog).then(({ webp, width, height }) => {
            window.__plate = {
              webp,
              entry: { chapter: day.from, hour: day.hour, file: "", width, height, fov: cam.fov, position: cam.position.toArray(), quaternion: cam.quaternion.toArray() },
            };
          }, (e: unknown) => (stats.error = String(e)));
        }
        // a plate's progress view stays raw: the export mixes the fog in (a half-sampled sky under it reads as a cut)
        if (!plateMode) fog.draw();
        stats.sinceReset = now - resetAt;
        if (now - lastPoll > 250) {
          lastPoll = now;
          const asked = now;
          tracer.getSampleCountsAsync().then((c) => {
            if (asked < resetAt) return; // counted before the last reset
            stats.samples = c.min;
            stats.samplesPerSecond = c.samplesPerSecond;
            if (!stats.firstSampleMs && c.min > 0) stats.firstSampleMs = performance.now() - t1;
            for (const m of MILESTONES) if (c.min >= m && stats.reached[m] === undefined) stats.reached[m] = Math.round(performance.now() - resetAt);
            panel.textContent =
              `raytrace  twins ${stats.twinMs.toFixed(0)} ms  pose ${stats.poseMs.toFixed(0)} ms  build ${stats.buildMs.toFixed(0)} ms  first sample ${stats.firstSampleMs.toFixed(0)} ms\n` +
              `${c.min} spp  ${c.samplesPerSecond.toFixed(1)} spp/s  ${(stats.sinceReset / 1000).toFixed(1)} s since reset\n` +
              `reached ${MILESTONES.map((m) => `${m}:${stats.reached[m] ?? "-"}`).join(" ")}  denoised ${stats.denoisedMs || "-"}\n` +
              `R toggle  F freeze${frozen ? " (frozen)" : ""}  P restart`;
          });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    })().catch((e: unknown) => {
      stats.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      panel.textContent = `raytrace failed: ${stats.error}`;
      console.error(e);
    });

    return () => {
      stop = true;
      window.removeEventListener("keydown", onKey);
      tracer?.dispose();
      for (const c of cleanup) c();
      sky?.dispose();
      renderer?.dispose();
      canvas.remove();
      panel.remove();
      setFrameloop("always");
    };
  }, [gl, scene, camera, setFrameloop]);

  return null;
}

