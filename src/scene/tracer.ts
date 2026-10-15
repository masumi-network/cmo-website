// The path tracer as the city uses it: photo-real plates are baked with it in
// the dev lab (raytrace-lab.tsx), and Explore traces the map with it live
// (explore-trace.tsx). The tracer reads plain materials, an equirect sky and no
// fog, so this is how the city is shown to it, and how its image comes back.

import { initUNetFromURL } from "oidn-web";
import { OIDNDenoiser, type WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import { BVHComputeData } from "three-mesh-bvh/webgpu";
import { float, getViewPosition, perspectiveDepthToViewZ, screenUV, select, smoothstep, texture, uniform, vec4 } from "three/tsl";
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DepthTexture,
  EquirectangularReflectionMapping,
  Fog,
  FloatType,
  LinearFilter,
  MeshBasicNodeMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  QuadMesh,
  RGBAFormat,
  RenderTarget,
  Vector2,
  WebGPURenderer,
  type BatchedMesh,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
} from "three/webgpu";
import { lightingAt } from "@/lib/time";
import { TRACE_LAYER } from "./traced";

/** A WebGPU renderer the tracer can run on: the city's triangles and attributes outgrow WebGPU's default 128 MB storage binding, so it asks for what the GPU has. */
export async function tracerRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, trackTimestamp = false) {
  const gpu = (navigator as Navigator & { gpu: { requestAdapter(o: object): Promise<{ limits: Record<string, number> } | null> } }).gpu;
  const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("no WebGPU adapter");
  const { maxStorageBufferBindingSize, maxBufferSize } = adapter.limits;
  const renderer = new WebGPURenderer({ canvas: canvas as HTMLCanvasElement, antialias: false, trackTimestamp, requiredLimits: { maxStorageBufferBindingSize, maxBufferSize } });
  await renderer.init();
  return renderer;
}

/** OIDN, once the tracer stops at maxSamples. Weights in public/oidn (Apache 2.0, README there), 1.8 MB each, loaded on first use. */
export const newDenoiser = () => new OIDNDenoiser({ initUNetFromURL, auxWeightsUrl: "/oidn/rt_hdr_alb_nrm.tza", colorWeightsUrl: "/oidn/rt_hdr.tza" });

/** The finished trace, fog mixed in, as linear colour (RGBA floats, rows as the GPU reads them back). */
export async function readTrace(renderer: WebGPURenderer, tracer: WebGPUPathTracer, fog: ReturnType<typeof distanceFog>) {
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
  return { linear, width: size.x, height: size.y };
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

const DEG = Math.PI / 180;

/** The app's sky shader, baked into an equirect the path tracer can light with. */
export function skyTexture(hour: number): Texture {
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
export function asTraced(scene: Scene, sky: Texture, twinned: Object3D[], fn: () => void) {
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
export function guided(scene: Scene, camera: PerspectiveCamera, sky: Texture, hide: Object3D[], fn: () => void) {
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
export function distanceFog(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera) {
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
export const notInDepth = (scene: Scene) => {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    const m = o as Mesh;
    if ((o as { isLine?: boolean }).isLine || (o as { isPoints?: boolean }).isPoints) out.push(m);
    else if (m.isMesh && [m.material].flat().some((x) => "isShaderMaterial" in x && x.isShaderMaterial)) out.push(m);
  });
  return out;
};

