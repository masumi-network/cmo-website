"use client";

// Photo-real mode (F12) in Explore: the map path-traced live. Once the map has
// been still a moment (lib/live-trace.ts) the static city is traced from the
// camera's own pose, denoised, and handed to the plates (plates.tsx) as a live
// plate: Cuso, cars and boats stay live on top and cast their shadows on it,
// as on a chapter plate. Any drag or zoom drops it at once. scene.tsx loads
// this only on desktop with photo-real on, once Explore is opened; the tracer
// is set up the first time the map comes to rest (its build blocks the page
// about a second, better then than mid-drag).

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { DataTexture, DirectionalLight, LinearFilter, PerspectiveCamera, RGBAFormat, SRGBColorSpace, UnsignedByteType, type Mesh, type Object3D, type Scene, type Texture } from "three";
import { WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import type { WebGPURenderer } from "three/webgpu";
import { newLive, stepLive } from "@/lib/live-trace";
import { PLATE_RANGE, encodePlate, type PlateEntry } from "@/lib/plates";
import { lightingAt } from "@/lib/time";
import { bakeGround } from "./bake-ground";
import { splitScene } from "./plates";
import { dayNow, rig } from "./shared";
import { buildTwins, lightHousings, studioFill } from "./traced";
import { asTraced, distanceFog, guided, newDenoiser, notInDepth, readTrace, skyTexture, tracerRenderer } from "./tracer";

/** Samples a pixel before the denoiser runs. */
let SPP = 16;
/** How much of the screen's resolution is traced, drawn back at full size: half takes 2.6 s to a clean image against 5.3 s, a little softer. */
let SCALE = 0.5;
// dev only, for scripts/explore-bench.mjs: `?trace=<scale>,<samples>`
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  const [scale, spp] = (new URLSearchParams(window.location.search).get("trace") ?? "").split(",").map(Number);
  if (scale > 0) SCALE = scale;
  if (spp > 0) SPP = spp;
}

/** For scripts/explore-bench.mjs: how long from the map coming to rest to the clean image on screen. */
type Stats = { phase: string; setupMs: number; traceMs: number; traces: number; error?: string };

type Tracing = {
  renderer: WebGPURenderer;
  tracer: WebGPUPathTracer;
  denoiser: ReturnType<typeof newDenoiser>;
  fog: ReturnType<typeof distanceFog>;
  camera: PerspectiveCamera;
  hide: Object3D[];
  /** Sets the sky, glows and night fill for the hour (when it changed). */
  refresh: (hour: number) => void;
  sky: () => Texture;
};

/** Everything the tracer needs, built once: its renderer, the city's plain twins, the BVH (the slow part). */
async function setUp(gl: Parameters<typeof bakeGround>[0], scene: Scene, width: number, height: number): Promise<Tracing> {
  const canvas = document.createElement("canvas");
  const renderer = await tracerRenderer(canvas);
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const twins = buildTwins(scene, bakeGround(gl, scene));
  scene.add(twins.group);
  for (const m of lightHousings(scene) as (Mesh & { visibleToShadowRays?: boolean })[]) m.visibleToShadowRays = false;
  // a plate is the static city: the live objects (Cuso, cars, boats) draw over it
  const live = splitScene(scene).live;
  const hidden = [...twins.originals, ...live];
  const hide = [...notInDepth(scene), ...live, ...hidden];
  const camera = new PerspectiveCamera();
  // the raster's studio light at night, for the tracer
  const fills = studioFill(0).map(() => new DirectionalLight("#ffffff", 0));
  for (const f of fills) scene.add(f, f.target);
  const denoiser = newDenoiser();
  const tracer = new WebGPUPathTracer(renderer);
  tracer.renderScale = SCALE;
  tracer.setDenoiser(denoiser);
  tracer.maxSamples = SPP;
  let sky: Texture = skyTexture(dayNow().hour);
  asTraced(scene, sky, hidden, () => tracer.setScene(scene, camera));
  let hour = -1;
  const refresh = (h: number) => {
    if (Math.abs(h - hour) < 0.02) return;
    hour = h;
    sky.dispose();
    sky = skyTexture(h);
    twins.refresh();
    studioFill(lightingAt(h).night).forEach(({ direction, intensity }, i) => {
      fills[i].intensity = intensity;
      fills[i].position.copy(direction).multiplyScalar(80);
      fills[i].updateMatrixWorld();
    });
    asTraced(scene, sky, hidden, () => {
      tracer.updateEnvironment();
      tracer.updateLights();
      tracer.updateMaterials();
    });
  };
  return { renderer, tracer, denoiser, fog: distanceFog(renderer, scene, camera), camera, hide, refresh, sky: () => sky };
}

/** Linear trace rows (top first, as read back) to the plate's 8-bit sRGB texture (bottom row first, as WebGL uploads). */
function plateTexture(linear: Float32Array, width: number, height: number) {
  const pixels = encodePlate(linear, PLATE_RANGE);
  const rows = new Uint8Array(pixels.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) rows.set(pixels.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const t = new DataTexture(rows, width, height, RGBAFormat, UnsignedByteType);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export default function ExploreTrace() {
  const { gl, scene, camera, size } = useThree();
  const live = useMemo(() => newLive(), []);
  const state = useRef({
    setup: null as Promise<Tracing> | null,
    t: null as Tracing | null,
    /** bumps on every drop: a trace finishing after one is thrown away */
    gen: 0,
    tracing: false,
    ready: null as { entry: PlateEntry; texture: Texture } | null,
    startedAt: 0,
  });
  const stats = useMemo<Stats>(() => ({ phase: "idle", setupMs: 0, traceMs: 0, traces: 0 }), []);

  useEffect(() => {
    (window as Window & { __explore?: Stats }).__explore = stats;
    const s = state.current;
    return () => {
      s.gen++;
      rig.live?.texture.dispose();
      rig.live = null;
      void s.setup?.then((t) => {
        t.tracer.dispose();
        t.renderer.dispose();
      });
    };
  }, [stats]);

  useFrame((_, dt) => {
    const s = state.current;
    const pose = { position: camera.position, quaternion: camera.quaternion };
    const action = stepLive(live, { pose, dt, explore: dayNow().mode === "explore", done: s.ready !== null });

    if (action === "drop") {
      s.gen++;
      s.tracing = false;
      s.ready?.texture.dispose();
      s.ready = null;
      rig.live?.texture.dispose();
      rig.live = null;
      stats.phase = "dropped";
    }
    if (action === "show" && s.ready) {
      rig.live = s.ready;
      s.ready = null;
      stats.traceMs = Math.round(performance.now() - s.startedAt);
      stats.traces++;
      stats.phase = "shown";
    }
    if (action === "start") {
      s.startedAt = performance.now();
      stats.phase = "starting";
      if (!s.setup) {
        const t0 = performance.now();
        s.setup = setUp(gl, scene, size.width, size.height).then(
          (t) => {
            stats.setupMs = Math.round(performance.now() - t0);
            return (s.t = t);
          },
          (e: unknown) => {
            stats.error = String(e);
            throw e;
          },
        );
      }
      const gen = s.gen;
      void s.setup.then((t) => {
        if (gen !== s.gen) return; // moved while setting up
        t.camera.copy(camera as PerspectiveCamera);
        t.camera.updateMatrixWorld();
        t.refresh(dayNow().hour);
        t.tracer.updateCamera();
        t.fog.measure(t.hide);
        s.tracing = true;
        stats.phase = "tracing";
      }, () => (stats.phase = "failed")); // no WebGPU after all: Explore stays as it is
    }

    const t = s.t;
    if (!s.tracing || !t) return;
    guided(scene, t.camera, t.sky(), t.hide, () => t.tracer.renderSample());
    if (!t.denoiser.complete) return;
    s.tracing = false;
    stats.phase = "reading";
    const gen = s.gen;
    void readTrace(t.renderer, t.tracer, t.fog).then(({ linear, width, height }) => {
      if (gen !== s.gen) return;
      const c = t.camera;
      const entry: PlateEntry = { chapter: -1, hour: dayNow().hour, file: "live", width, height, fov: c.fov, position: c.position.toArray(), quaternion: c.quaternion.toArray() };
      s.ready = { entry, texture: plateTexture(linear, width, height) };
    });
  });

  return null;
}
