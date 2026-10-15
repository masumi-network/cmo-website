// Dev only (`?raytrace=probes`): bakes the light probes (src/lib/probes.ts)
// for the hour on screen, with the lab's path tracer. The tracer's camera is
// swapped for one that starts every ray at a probe: each TILE x TILE square
// of the image is one probe, each pixel one direction cell. Rays leaving a
// probe never meet the sun or a lamp directly (punctual lights are sampled at
// hits only), so a probe holds bounced light and sky: the raster draws the
// sun and lamps itself. scripts/probes.mjs drives it through the chapters.

import { DoubleSide, FrontSide, Mesh as GLMesh, Raycaster, Vector3 as V3, type BatchedMesh, type InstancedMesh, type Material, type Object3D, type Side } from "three";
import { acceleratedRaycast } from "three-mesh-bvh";
import * as bvhGpu from "three-mesh-bvh/webgpu";
import { PI, uniform } from "three/tsl";
import { Camera, DirectionalLight, FloatType, NoToneMapping, RenderTarget, Vector3, type Scene, type Texture, type WebGPURenderer } from "three/webgpu";
import type { WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import { TILE, addDirectional, cellDirection, dilateProbes, encodeProbes, projectTile, tileOrigin, type ProbeManifest } from "@/lib/probes";
import { lightingAt } from "@/lib/time";
import { studioFill } from "./traced";

const { wgslTagFn, rayStruct } = bvhGpu as unknown as { wgslTagFn: (s: TemplateStringsArray, ...a: unknown[]) => unknown; rayStruct: unknown };

/** The grid: 3 m cells over the city the chapters look at (chapter cameras sit within 35 m of the middle). */
export const GRID: Pick<ProbeManifest, "min" | "size" | "res"> = { min: [-96, -3, -96], size: [192, 42, 162], res: [64, 14, 54] };

/**
 * Radiance above this is a firefly: a ray off glass or water that caught the sun's glint in one cell. Left in, one
 * outlier set the hour's 8-bit scale (1,246 at 18:00) and rounded most probes to zero. Sky and sunlit walls stay under 2.
 */
const MAX_RADIANCE = 4;

/** Tiles per row of the bake image. Not a divisor of the probe count, so the last row is part empty: that tells which way up the readback is. */
const TILES_X = 250;

/**
 * Which probes are outside (1) or inside a building or under the ground (0): of 16 rays from the probe, more than a
 * quarter first meet the back of a one-sided surface. Uses the BVHs the tracer built (setScene).
 */
function outsideProbes(root: Object3D) {
  const meshes: GLMesh[] = [];
  root.traverseVisible((o) => {
    const m = o as GLMesh;
    if (!m.isMesh || (o as InstancedMesh).isInstancedMesh || (o as BatchedMesh).isBatchedMesh || !m.geometry.boundsTree) return;
    m.raycast = acceleratedRaycast;
    meshes.push(m);
  });
  // three's raycasts skip the back of a one-sided surface, the very hit wanted here: see both sides for now
  const sides = new Map<Material, Side>();
  for (const m of meshes) for (const mat of [m.material].flat()) if (!sides.has(mat)) sides.set(mat, mat.side);
  for (const mat of sides.keys()) mat.side = DoubleSide;
  const ray = new Raycaster();
  (ray as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  ray.layers.enableAll();
  ray.far = 100;
  const dirs = Array.from({ length: 16 }, (_, c) => cellDirection((c % 4) * 2, Math.floor(c / 4) * 2, 1, 1));
  const [nx, ny, nz] = GRID.res;
  const step = new V3().fromArray(GRID.size).divide(new V3(nx, ny, nz));
  const origin = new V3();
  const normal = new V3();
  const valid = new Uint8Array(nx * ny * nz);
  for (let p = 0; p < valid.length; p++) {
    const i = p % nx;
    const j = Math.floor(p / nx) % ny;
    const k = Math.floor(p / (nx * ny));
    origin.set(i + 0.5, j + 0.5, k + 0.5).multiply(step).add(new V3().fromArray(GRID.min));
    let back = 0;
    for (const d of dirs) {
      ray.set(origin, d);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit?.face) continue;
      const material = [(hit.object as GLMesh).material].flat()[hit.face.materialIndex ?? 0] ?? [(hit.object as GLMesh).material].flat()[0];
      if (sides.get(material as Material) !== FrontSide) continue;
      if (normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).dot(d) > 0) back++;
    }
    valid[p] = back > 4 ? 0 : 1;
  }
  for (const [mat, side] of sides) mat.side = side;
  return valid;
}

class ProbeCamera extends Camera {
  getCameraRayFn() {
    const [nx, ny, nz] = GRID.res;
    const gmin = uniform(new Vector3().fromArray(GRID.min));
    const step = uniform(new Vector3().fromArray(GRID.size).divide(new Vector3(nx, ny, nz)));
    const fn = wgslTagFn/* wgsl */ `
      fn getCameraRay( uv: vec2f, resolution: vec2f, ray: ptr<function, ${rayStruct}> ) -> bool {
        let px = uv * resolution;
        let pixel = floor( px );
        let r = px - pixel;
        let tile = floor( pixel / ${TILE}.0 );
        if ( tile.x >= ${TILES_X}.0 ) { return false; }
        let probe = tile.y * ${TILES_X}.0 + tile.x;
        if ( probe >= ${nx * ny * nz}.0 ) { return false; }
        let k = floor( probe / ${nx * ny}.0 );
        let rest = probe - k * ${nx * ny}.0;
        let j = floor( rest / ${nx}.0 );
        let i = rest - j * ${nx}.0;
        let c = pixel - tile * ${TILE}.0;
        let y = 1.0 - 2.0 * ( c.y + r.y ) / ${TILE}.0;
        let s = sqrt( max( 0.0, 1.0 - y * y ) );
        let phi = 2.0 * ${PI} * ( c.x + r.x ) / ${TILE}.0;
        ray.origin = ${gmin} + ( vec3f( i, j, k ) + 0.5 ) * ${step};
        ray.direction = vec3f( s * cos( phi ), y, s * sin( phi ) );
        ray.maxDist = 0.0;
        return true;
      }
    `;
    return { fn, update: () => false };
  }
}

type Bake = { hour: number; scale: number; bytes: string; ms: number; samples: number; inside: number; flipped: boolean };

/**
 * A baker for the scene as the lab traces it. `traced(sky, fn)` runs `fn` with
 * the sky and twins in place (raytrace-lab's asTraced); `refresh` sets the
 * twins' glows for the hour on screen.
 */
export function probeBaker(o: { renderer: WebGPURenderer; tracer: WebGPUPathTracer; scene: Scene; hour: () => number; sky: (hour: number) => Texture; traced: (sky: Texture, fn: () => void) => void; refresh: () => void }) {
  const { renderer, tracer, scene } = o;
  const count = GRID.res[0] * GRID.res[1] * GRID.res[2];
  const width = TILES_X * TILE;
  const height = Math.ceil(count / TILES_X) * TILE;
  const camera = new ProbeCamera();
  tracer.synchronizeRenderSize = false;
  tracer.dynamicLowRes = false;
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.setSize(width, height);
  // the raster's studio light at night, for the tracer (bounced) and added to each probe below (seen directly)
  const fills = studioFill(0).map(() => new DirectionalLight("#ffffff", 0));
  for (const f of fills) scene.add(f, f.target);
  let built = false;
  let sky: Texture | null = null;
  let valid: Uint8Array | null = null;

  const dispose = () => {
    for (const f of fills) scene.remove(f, f.target);
    sky?.dispose();
  };
  const bake = async (spp: number): Promise<Bake> => {
    const t0 = performance.now();
    const hour = o.hour();
    const fill = studioFill(lightingAt(hour).night);
    fill.forEach(({ direction, intensity }, i) => {
      fills[i].intensity = intensity;
      fills[i].position.copy(direction).multiplyScalar(80);
      fills[i].updateMatrixWorld();
      fills[i].target.updateMatrixWorld();
    });
    o.refresh();
    sky?.dispose();
    sky = o.sky(hour);
    o.traced(sky, () => {
      if (!built) {
        tracer.setScene(scene, camera);
        valid = outsideProbes(scene as unknown as Object3D);
      } else {
        tracer.updateEnvironment();
        tracer.updateLights();
        tracer.updateMaterials();
      }
    });
    built = true;
    tracer.maxSamples = spp;
    tracer.reset();
    for (;;) {
      tracer.renderSample();
      await new Promise((r) => requestAnimationFrame(r));
      if ((await tracer.getSampleCountsAsync()).min >= spp) break;
      if (performance.now() - t0 > 180_000) throw new Error(`probes: under ${spp} spp after 180 s`);
    }

    const target = new RenderTarget(width, height, { type: FloatType });
    const toneMapping = renderer.toneMapping;
    renderer.toneMapping = NoToneMapping;
    renderer.setRenderTarget(target);
    tracer.renderSample(); // done sampling: this only copies the image
    renderer.setRenderTarget(null);
    renderer.toneMapping = toneMapping;
    const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)) as Float32Array;
    target.dispose();

    // the last tile row is part empty: if the readback's first row is the empty end, it is upside down
    // (by colour: the copy writes alpha 1 everywhere; a cell never traced is black, one that sees anything is not)
    const lit = (x: number, y: number) => pixels[(y * width + x) * 4] + pixels[(y * width + x) * 4 + 1] + pixels[(y * width + x) * 4 + 2] > 0;
    const flipped = !lit(width - 1, 0) && lit(width - 1, height - 1);
    const sh = new Float32Array(count * 12);
    const tile = new Float32Array(TILE * TILE * 4);
    for (let p = 0; p < count; p++) {
      const [x0, y0] = tileOrigin(p, TILES_X);
      for (let j = 0; j < TILE; j++) {
        const row = flipped ? height - 1 - (y0 + j) : y0 + j;
        tile.set(pixels.subarray((row * width + x0) * 4, (row * width + x0 + TILE) * 4), j * TILE * 4);
      }
      const out = sh.subarray(p * 12, p * 12 + 12);
      for (let i = 0; i < tile.length; i++) if (i % 4 !== 3) tile[i] = Math.min(tile[i], MAX_RADIANCE);
      projectTile(tile, TILE, 0, 0, out);
      for (const { direction, intensity } of fill) if (intensity > 0) addDirectional(out, direction, [intensity, intensity, intensity]);
    }
    dilateProbes(sh, valid!, GRID.res, 3);
    const { bytes, scale } = encodeProbes(sh);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { hour, scale, bytes: btoa(bin), ms: Math.round(performance.now() - t0), samples: spp, inside: valid!.length - valid!.reduce((a, b) => a + b, 0), flipped };
  };
  return { bake, dispose };
}
