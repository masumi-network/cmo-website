// What glass reflects: the real city, not a painted sky. One cube probe
// renders the scene (sky dome, fog, buildings, bay, bridges) around the
// chapter's subject into a cube map. Glass samples it by the reflected view
// ray, corrected for parallax inside a box (houses opposite line up on flat
// facades). It re-renders only when the chapter or the hour changes, one cube
// face per frame into a back buffer, so a scroll never hitches and glass never
// reads the texture being drawn. Only glass uses it: the rest of the lighting
// keeps the studio environment (scene.tsx).

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CubeCamera, HalfFloatType, LinearMipmapLinearFilter, Vector3, type PerspectiveCamera, WebGLCubeRenderTarget, type Scene, type Texture, type WebGLRenderer } from "three";
import { chapters, type Vec3 } from "@/content/day";
import { activeIndex } from "@/lib/time";
import { heightAt } from "@/lib/terrain";
import { useCity } from "@/lib/store";
import { dayNow } from "./shared";

/** Cube face size: a window never shows more detail than this at chapter distances. */
export const PROBE_SIZE = { full: 256, lite: 128 };
/**
 * The probe sees nothing nearer than this: not Cuso, nor the roof he stands
 * on, nor a billboard beside him. Near things would fill half the cube and
 * show up in every window; past them it sees the street and the city.
 */
export const PROBE_NEAR = 4;
/** While travelling, follow the sky in steps of this many hours, at most every MIN_GAP seconds. */
const HOUR_STEP = 0.4;
const MIN_GAP = 0.25;
/** Seconds the hour must stay put before the scroll counts as stopped. */
const SETTLE = 0.3;

/** Shared by every glass material (like facadeNight): the probe swaps in its texture and box. */
export const glassUniforms = {
  uGlassEnv: { value: null as Texture | null },
  /** 0 until the first probe is ready: glass shows its painted sky until then. */
  uGlassMix: { value: 0 },
  uProbePos: { value: new Vector3() },
  uProbeMin: { value: new Vector3() },
  uProbeMax: { value: new Vector3() },
};

/**
 * `glassEnv(p, r, sky)`: the city seen from world point `p` along the
 * reflected ray `r`. Inside the probe's box the ray is traced to the box wall
 * and looked up from the probe (parallax-corrected); it fades to a plain
 * direction lookup over 8 units outside the box, so there is never a seam.
 * `sky` is the painted fallback, used until the probe has rendered.
 */
export const GLASS_ENV_GLSL = /* glsl */ `
  uniform samplerCube uGlassEnv;
  uniform float uGlassMix;
  uniform vec3 uProbePos;
  uniform vec3 uProbeMin;
  uniform vec3 uProbeMax;
  vec3 glassEnv(vec3 p, vec3 r, vec3 sky) {
    vec3 pc = clamp(p, uProbeMin, uProbeMax);
    vec3 rs = r + step(abs(r), vec3(1e-5)) * 1e-5;
    vec3 t = (mix(uProbeMin, uProbeMax, step(0.0, rs)) - pc) / rs;
    vec3 boxed = normalize(pc + r * min(min(t.x, t.y), t.z) - uProbePos);
    vec3 dir = mix(boxed, r, smoothstep(0.0, 8.0, distance(p, pc)));
    return mix(sky, textureCube(uGlassEnv, dir).rgb, uGlassMix);
  }`;

/** What the probe was last rendered for. `settled`: the hour has not moved for a moment (the scroll stopped). */
export type ProbeKey = { index: number; hour: number; explore: boolean; time: number; settled: boolean };

/**
 * Whether the probe should render now. Once after load; when the chapter or
 * mode changes; once more when the scroll stops on a new hour. Full mode
 * also follows the sky while travelling, in hour steps. Lite renders only
 * where the scroll stops: about one render per chapter.
 */
export function probeDue(last: ProbeKey | null, now: ProbeKey, lite: boolean) {
  if (!last) return true;
  if (now.explore !== last.explore) return true;
  if (lite) return now.settled && (now.index !== last.index || Math.abs(now.hour - last.hour) > 0.01);
  if (now.index !== last.index) return true;
  if (now.settled) return Math.abs(now.hour - last.hour) > 0.01;
  return Math.abs(now.hour - last.hour) >= HOUR_STEP && now.time - last.time >= MIN_GAP;
}

/**
 * Where the probe stands: over the chapter's subject (the camera target), at
 * least PROBE_NEAR + 1 over the street so it sees the street below; its box
 * reaches the street and about a block around, where the facades it
 * reflects stand.
 * Explore mode: high over the city centre, the box the whole city.
 */
export function probeSpot(index: number, explore: boolean): { position: Vec3; min: Vec3; max: Vec3 } {
  if (explore) return { position: [-5, 14, 5], min: [-90, -1, -70], max: [80, 60, 70] };
  const [x, y, z] = chapters[index].camera.target;
  const floor = heightAt(x, z) - 0.3;
  const py = Math.max(y + 1.2, floor + PROBE_NEAR + 1.3);
  return { position: [x, py, z], min: [x - 12, floor, z - 12], max: [x + 12, py + 40, z + 12] };
}

function createProbe(size: number) {
  const make = () => new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
  const targets = [make(), make()];
  const camera = new CubeCamera(PROBE_NEAR, 1200, targets[0]); // for its six face cameras
  let back = 0;
  let face = -1;
  let pending: { key: ProbeKey; spot: ReturnType<typeof probeSpot> } | null = null;
  let last: ProbeKey | null = null;

  function renderFace(gl: WebGLRenderer, scene: Scene, i: number) {
    const target = targets[back];
    if (camera.coordinateSystem !== gl.coordinateSystem) {
      camera.coordinateSystem = gl.coordinateSystem;
      camera.updateCoordinateSystem();
    }
    // mipmaps once, with the last face
    target.texture.generateMipmaps = i === 5;
    gl.setRenderTarget(target, i);
    gl.clear();
    gl.render(scene, camera.children[i] as PerspectiveCamera);
  }

  return {
    /** Call every frame; renders at most one face (all six for the first render, behind the poster). */
    step(gl: WebGLRenderer, scene: Scene, key: ProbeKey, lite: boolean) {
      if (face < 0) {
        if (!probeDue(last, key, lite)) return;
        pending = { key, spot: probeSpot(key.index, key.explore) };
        camera.position.set(...pending.spot.position);
        camera.updateMatrixWorld();
        face = 0;
      }
      const previous = gl.getRenderTarget();
      const shadows = gl.shadowMap.autoUpdate;
      // the sun's shadow map from this frame is still right (it follows the subject)
      gl.shadowMap.autoUpdate = false;
      const until = last ? face + 1 : 6;
      for (; face < until; face++) renderFace(gl, scene, face);
      gl.shadowMap.autoUpdate = shadows;
      gl.setRenderTarget(previous);
      if (face < 6 || !pending) return;
      // swap: glass now reads what was just drawn
      const { spot } = pending;
      glassUniforms.uGlassEnv.value = targets[back].texture;
      glassUniforms.uProbePos.value.set(...spot.position);
      glassUniforms.uProbeMin.value.set(...spot.min);
      glassUniforms.uProbeMax.value.set(...spot.max);
      glassUniforms.uGlassMix.value = 1;
      last = pending.key;
      pending = null;
      face = -1;
      back = 1 - back;
    },
    dispose() {
      for (const t of targets) t.dispose();
      last = pending = null;
      face = -1;
      glassUniforms.uGlassEnv.value = null;
      glassUniforms.uGlassMix.value = 0;
    },
  };
}

/** The city probe for glass. Renders nothing itself. */
export function Reflections({ lite }: { lite: boolean }) {
  const probe = useMemo(() => createProbe(lite ? PROBE_SIZE.lite : PROBE_SIZE.full), [lite]);
  const still = useMemo(() => ({ hour: -1, since: 0 }), []);
  useEffect(() => () => probe.dispose(), [probe]);
  useFrame(({ gl, scene, clock }) => {
    // `Ready` (scene.tsx) sets this once every shader is compiled: the probe must not trigger compiles
    if (!scene.userData.shadersReady) return;
    const day = dayNow();
    const index = activeIndex(useCity.getState().progress, chapters.length);
    const time = clock.elapsedTime;
    if (Math.abs(day.hour - still.hour) > 1e-4) Object.assign(still, { hour: day.hour, since: time });
    probe.step(gl, scene, { index, hour: day.hour, explore: day.mode === "explore", time, settled: time - still.since > SETTLE }, lite);
  });
  return null;
}
