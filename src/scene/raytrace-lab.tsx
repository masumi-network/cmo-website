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
import { WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import {
  ACESFilmicToneMapping,
  Matrix4,
  SRGBColorSpace,
  WebGPURenderer,
  DirectionalLight,
  type PerspectiveCamera,
  type Mesh,
  type Scene,
  type Texture,
} from "three/webgpu";
import { PLATE_RANGE, encodePlate, type PlateEntry } from "@/lib/plates";
import { lightingAt } from "@/lib/time";
import { dayNow } from "./shared";
import { CHAINS, screenSpace, type Chain } from "./fx-lab";
import { splitScene } from "./plates";
import { bakeGround } from "./bake-ground";
import { GRID, probeBaker } from "./probe-lab";
import { runWebGPU } from "./webgpu-lab";
import { facadeNight } from "./facade";
import { buildTwins, farCasters, lightHousings, studioFill } from "./traced";
import { asTraced, distanceFog, guided, newDenoiser, notInDepth, readTrace, skyTexture, tracerRenderer } from "./tracer";

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
    /** probes mode: bake the hour on screen, for scripts/probes.mjs */
    __probes?: { bake: ReturnType<typeof probeBaker>["bake"]; hour: () => number; grid: typeof GRID };
  }
}

const MILESTONES = [1, 4, 16, 64, 256];

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
  const { linear, width, height } = await readTrace(renderer, tracer, fog);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.putImageData(new ImageData(encodePlate(linear, PLATE_RANGE), width, height), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/webp", quality: 0.9 })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { webp: btoa(bin), width, height };
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
      const gpu = await tracerRenderer(canvas, fxMode || mode === "webgpu");
      renderer = gpu;
      if (stop) return;
      gpu.setPixelRatio(Number(new URLSearchParams(window.location.search).get("dpr") ?? 1));
      gpu.setSize(window.innerWidth, window.innerHeight, false);
      gpu.toneMapping = ACESFilmicToneMapping;
      gpu.outputColorSpace = SRGBColorSpace;

      // Wait for the city to finish loading and compiling: the same moment the poster lifts.
      while (!scene.userData.shadersReady && !stop) await new Promise((r) => setTimeout(r, 100));
      if (stop) return;

      const tw0 = performance.now();
      const twins = buildTwins(scene, bakeGround(gl, scene));
      scene.add(twins.group);
      // lamps: the light sits inside its glass globe, which would block every light ray (the raster's lights cast no shadows)
      const housings = lightHousings(scene) as (Mesh & { visibleToShadowRays?: boolean })[];
      for (const m of housings) m.visibleToShadowRays = false;
      cleanup.push(() => housings.forEach((m) => delete m.visibleToShadowRays));
      // the sun's shadows as today's frame has them: casters outside its shadow box (the Bay Bridge) are left out, at rest
      let sun: DirectionalLight | undefined;
      scene.traverse((o) => void ((o as DirectionalLight).isDirectionalLight && o.castShadow && (sun ??= o as DirectionalLight)));
      let far: (Mesh & { visibleToShadowRays?: boolean })[] = [];
      const shadowsAsToday = () => {
        for (const m of far) delete m.visibleToShadowRays;
        far = sun ? farCasters(scene, sun).filter((m) => !housings.includes(m)) : [];
        for (const m of far) m.visibleToShadowRays = false;
      };
      cleanup.push(() => far.forEach((m) => delete m.visibleToShadowRays));
      stats.twinMs = performance.now() - tw0;
      cleanup.push(() => {
        scene.remove(twins.group);
        twins.group.traverse((o) => (o as Mesh).geometry?.dispose());
      });

      if (mode === "probes") {
        // the static city's light probes for the hour on screen (probe-lab.ts), for scripts/probes.mjs
        const hidden = [...twins.originals, ...splitScene(scene).live];
        const probeTracer = new WebGPUPathTracer(gpu);
        const baker = probeBaker({ renderer: gpu, tracer: probeTracer, scene, hour: () => dayNow().hour, sky: skyTexture, traced: (s, fn) => asTraced(scene, s, hidden, fn), refresh: twins.refresh });
        cleanup.push(() => {
          baker.dispose();
          probeTracer.dispose();
        });
        window.__probes = { bake: baker.bake, hour: () => dayNow().hour, grid: GRID };
        return;
      }
      if (mode === "webgpu") {
        runWebGPU({ renderer: gpu, gl, scene, camera: camera as PerspectiveCamera, sky: skyTexture, hour: () => dayNow().hour, night: () => facadeNight.value, panel, stopped: () => stop });
        return;
      }
      if (fxMode) {
        runEffects(gpu, scene, camera as PerspectiveCamera, twins.originals, stats, panel, () => stop);
        return;
      }
      // A plate is the static city: the live objects (Cuso, cars, boats) are drawn over it later.
      const live = plateMode ? splitScene(scene).live : [];
      const staticHidden = [...twins.originals, ...live];
      let exported = false;

      tracer = new WebGPUPathTracer(gpu);
      tracer.renderScale = Number(params.get("scale") ?? 1);
      // OIDN runs once the tracer stops at maxSamples (weights in public/oidn).
      const denoiser = params.get("denoise") === "0" ? null : newDenoiser();
      if (denoiser) {
        tracer.setDenoiser(denoiser);
        tracer.maxSamples = Number(params.get("spp") ?? (plateMode ? 256 : 16));
      }
      let hour = dayNow().hour;
      sky = skyTexture(hour);
      // the raster's studio light at night (studioFill): two fill lights round the view, for the tracer only
      const fills = studioFill(0).map(() => new DirectionalLight("#ffffff", 0));
      for (const f of fills) scene.add(f, f.target);
      const fillAt = (h: number) =>
        studioFill(lightingAt(h).night).forEach(({ direction, intensity }, i) => {
          fills[i].intensity = intensity;
          fills[i].target.position.copy(camera.position);
          fills[i].position.copy(camera.position).addScaledVector(direction, 80);
          fills[i].updateMatrixWorld();
          fills[i].target.updateMatrixWorld();
        });
      fillAt(hour);
      cleanup.push(() => fills.forEach((f) => scene.remove(f, f.target)));
      const t0 = performance.now();
      asTraced(scene, sky, staticHidden, () => tracer!.setScene(scene, camera));
      stats.buildMs = performance.now() - t0;
      const t1 = performance.now();
      let resetAt = t1;

      const fog = distanceFog(gpu, scene, camera as PerspectiveCamera);
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
          // and the twins' lit windows and lamps, and the night's fill
          twins.refresh();
          fillAt(hour);
          asTraced(scene, sky, staticHidden, () => {
            tracer!.updateEnvironment();
            tracer!.updateLights();
            tracer!.updateMaterials();
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
          // the night as it is now (lit windows, lamps): setScene below reads the materials again
          twins.refresh();
          shadowsAsToday();
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
          exportPlate(gpu, tracer, fog).then(({ webp, width, height }) => {
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

