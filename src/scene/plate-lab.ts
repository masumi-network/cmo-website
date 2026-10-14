// Dev only: pre-traced chapter plates (photo-real spike, raytrace-lab.tsx).
// `?raytrace=plate` traces the static city (no live objects) and hands the frame
// and its depth to scripts/plates.mjs. `?raytrace=plates` draws a saved plate and
// the live objects on top, depth-tested against it: the photo-real rest at
// raster cost.

import { Color, DataTexture, FloatType, MeshBasicNodeMaterial, NearestFilter, QuadMesh, RedFormat, RenderTarget, SRGBColorSpace, TextureLoader, Vector2, type Camera, type Object3D, type PerspectiveCamera, type Scene, type Texture, type WebGPURenderer } from "three/webgpu";
import { float, positionView, screenUV, select, texture, uniform, vec4, viewZToPerspectiveDepth } from "three/tsl";

/** What a plate was traced from: the camera must match to show it. */
export type PlateCamera = { matrixWorld: number[]; near: number; far: number; fov: number; aspect: number; w: number; h: number };
export type Plate = { color: Texture; depth: DataTexture; camera: PlateCamera };

/** Objects marked `userData.live` (Cuso, cars, boats): hiding one hides everything under it. */
export function liveRoots(scene: Scene) {
  const out: Object3D[] = [];
  scene.traverse((o) => {
    if (o.userData.live) out.push(o);
  });
  return out;
}

/**
 * Everything to hide so only the live objects (and the lights) draw: the
 * smallest set, whole subtrees that hold nothing live.
 */
export function allButLive(scene: Scene) {
  const holdsLive = new Set<Object3D>();
  scene.traverse((o) => {
    if (o.userData.live) for (let p: Object3D | null = o; p; p = p.parent) holdsLive.add(p);
  });
  const hide: Object3D[] = [];
  const walk = (o: Object3D) => {
    for (const c of o.children) {
      if (c.userData.live || (c as { isLight?: boolean }).isLight) continue;
      if (holdsLive.has(c)) walk(c);
      else hide.push(c);
    }
  };
  walk(scene);
  return hide;
}

/** Linear view depth of the visible scene (0 where nothing is, the sky), one float per pixel, as the GPU lays rows out. */
export async function readDepth(renderer: WebGPURenderer, scene: Scene, camera: Camera) {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const target = new RenderTarget(size.x, size.y, { type: FloatType });
  const material = new MeshBasicNodeMaterial();
  material.colorNode = vec4(positionView.z.negate(), 0, 0, 1);
  const { overrideMaterial, background } = scene;
  scene.overrideMaterial = material;
  scene.background = null;
  const clear = renderer.getClearColor(new Color());
  const alpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setClearColor(clear, alpha);
  Object.assign(scene, { overrideMaterial, background });
  const rgba = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, size.x, size.y)) as Float32Array;
  target.dispose();
  material.dispose();
  const data = new Float32Array(size.x * size.y);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
  return { w: size.x, h: size.y, data };
}

export function plateCamera(camera: PerspectiveCamera, w: number, h: number): PlateCamera {
  return { matrixWorld: [...camera.matrixWorld.elements], near: camera.near, far: camera.far, fov: camera.fov, aspect: camera.aspect, w, h };
}

/**
 * True once the camera has come to rest on the plate's view. The rig eases in
 * and never lands on the same matrix twice, so "close" counts (about 2 cm and
 * a degree), and the composite then draws from the plate's own camera.
 */
export function matches(camera: PerspectiveCamera, p: PlateCamera) {
  const e = camera.matrixWorld.elements;
  return Math.abs(camera.fov - p.fov) < 1e-3 && Math.abs(camera.aspect - p.aspect) < 1e-3 && p.matrixWorld.every((v, i) => Math.abs(v - e[i]) < 0.02);
}

/** Loads a plate saved by scripts/plates.mjs, or null if there is none for this chapter and size. */
export async function loadPlate(name: string): Promise<Plate | null> {
  const res = await fetch(`/lab/plates/${name}.json`);
  if (!res.ok) return null;
  const camera = (await res.json()) as PlateCamera;
  const [color, bytes] = await Promise.all([new TextureLoader().loadAsync(`/lab/plates/${name}.png`), fetch(`/lab/plates/${name}.f32`).then((r) => r.arrayBuffer())]);
  color.colorSpace = SRGBColorSpace;
  const depth = new DataTexture(new Float32Array(bytes), camera.w, camera.h, RedFormat, FloatType);
  depth.minFilter = depth.magFilter = NearestFilter;
  depth.needsUpdate = true;
  return { color, depth, camera };
}

/**
 * Draws the plate as it was on screen (already tone mapped, so not again) and
 * writes its depth, so the live objects drawn next hide behind the city.
 */
export function plateQuad(plate: Plate) {
  const material = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: true });
  material.toneMapped = false;
  material.fog = false;
  const near = uniform(plate.camera.near);
  const far = uniform(plate.camera.far);
  // the image loads bottom row first (flipY); the depth readback is top row first, like screenUV
  material.colorNode = texture(plate.color, screenUV.flipY());
  const d = texture(plate.depth, screenUV).r;
  material.depthNode = select(d.greaterThan(0), viewZToPerspectiveDepth(d.negate(), near, far), float(1));
  return new QuadMesh(material);
}
