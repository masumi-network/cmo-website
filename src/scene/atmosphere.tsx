"use client";

// Time of day: sun or moon, sky dome, fog and night glow, driven by scroll.

// Height-aware haze in the fog chunks: patched at import, before any shader compiles.
import "./haze";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Fog, Frustum, Matrix4, Sphere, Vector3, type Camera, type DirectionalLight, type HemisphereLight, type Mesh, type PerspectiveCamera } from "three";
import { lightingAt, type Lighting } from "@/lib/time";
import { LINE, carGround, unionCar } from "./cable-line";
import { facadeNight } from "./facade";
import { TODAY, skyAt, skyMaterial, updateSky } from "./sky";
import { dayNow, rig, updateNightGlow } from "./shared";

const sunDir = new Vector3();
const DEG = Math.PI / 180;

/** Toward the sun; the moon stands in for it at night, high and cool. */
export function sunDirection(L: Pick<Lighting, "elevation" | "azimuth">, out = new Vector3()) {
  const elevation = (L.elevation < 0 ? 38 : L.elevation) * DEG;
  const azimuth = L.azimuth * DEG;
  return out.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
}

/**
 * Half the side of the sun's square shadow box (m), centred on what the camera looks at. 2048 texels across
 * (1024 in lite): `min` gives 1.6 cm a texel. `travel` while the camera moves, `explore` over the whole map.
 */
export const SHADOW = { min: 16, travel: 34, explore: 90 };
/** The box reaches this far past the target, times the camera's distance to it, plus `BEYOND` m. */
const REACH = 1.3;
const BEYOND = 8;

export type ShadowShot = { position: Vector3; target: Vector3; fov: number; aspect: number };

const sx = new Vector3();
const sy = new Vector3();
const fw = new Vector3();
const rt = new Vector3();
const up = new Vector3();
const p = new Vector3();
const UP = new Vector3(0, 1, 0);

/**
 * The shadow box for a camera at rest: just big enough, across the sun's rays, for everything the camera
 * sees from its lens to well past its target (REACH, BEYOND); never under `min` nor over `travel`.
 */
export function shadowBox(shot: ShadowShot, sun: Vector3) {
  const d = shot.position.distanceTo(shot.target);
  fw.subVectors(shot.target, shot.position).normalize();
  rt.crossVectors(fw, UP).normalize();
  up.crossVectors(rt, fw);
  // the shadow camera's own axes (three's lookAt from the sun)
  sx.crossVectors(UP, sun).normalize();
  sy.crossVectors(sun, sx);
  const t = Math.tan((shot.fov / 2) * DEG);
  let half = 0;
  for (const depth of [1, d * REACH + BEYOND])
    for (const a of [-1, 1])
      for (const b of [-1, 1]) {
        p.copy(shot.position)
          .addScaledVector(fw, depth)
          .addScaledVector(rt, a * depth * t * shot.aspect)
          .addScaledVector(up, b * depth * t)
          .sub(shot.target);
        half = Math.max(half, Math.abs(p.dot(sx)), Math.abs(p.dot(sy)));
      }
  // in half-metre steps: a little pointer parallax does not resize it
  return Math.min(Math.max(Math.ceil(half * 2) / 2, SHADOW.min), SHADOW.travel);
}

/** The box this frame: the fitted one at rest, the travel box while moving (`moving` 0..1), Explore's in Explore. */
export const shadowHalf = (fit: number, moving: number, explore: boolean) =>
  explore ? SHADOW.explore : fit + (SHADOW.travel - fit) * Math.min(Math.max(moving, 0), 1);

/**
 * Lite: the sun's shadow map is redrawn only when something big in it moves
 * (the sun, the shadow box, Cuso walking or turning, the cable car in view), and
 * otherwise every SHADOW_EVERY frames for small idle motion (breathing, wind).
 * Cars, boats and street furniture cast no shadows in lite.
 */
const SHADOW_EVERY = 4;
const drawn = { box: new Vector3(), half: 0, sun: new Vector3(), cuso: new Vector3(), heading: 0, frames: 0 };
const view = new Frustum();
const m4 = new Matrix4();
/** The cable car and the shadow it throws on the street, while it runs. */
const car = new Sphere(new Vector3(), 8);
const ground = { y: 0, tilt: 0 };
function shadowsMoved(camera: Camera, half: number) {
  if (unionCar.v !== 0) {
    carGround(unionCar.s, ground);
    car.center.set(unionCar.s, ground.y, LINE.z);
    if (view.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)).intersectsSphere(car)) return true;
  }
  return (
    drawn.box.distanceToSquared(rig.target) > 1e-6 ||
    Math.abs(drawn.half - half) > 1e-3 ||
    drawn.sun.distanceToSquared(sunDir) > 1e-8 ||
    drawn.cuso.distanceToSquared(rig.cuso) > 1e-6 ||
    Math.abs(drawn.heading - rig.heading) > 1e-3
  );
}

/** Dev only: `?look=off` keeps today's clear sky at every hour, for before and after screenshots. */
const LOOK_OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("look") === "off";

const FOG = { story: { near: 70, far: 340 }, explore: { near: 260, far: 900 } };

/**
 * Distance fog for a camera `distance` from what it looks at. Explore pushes it far out, so the whole map shows. In
 * the story it is close (shots stand 6 to 36 m off), except while the camera is still high above the city after an
 * Explore pin: the fog eases in as it comes down (switched with the mode, it hid the city in a white haze).
 * `scale` is the sky's haze (sky.ts fogScale): it brings only the story fog nearer.
 */
export function fogRange(distance: number, explore: boolean, scale = 1) {
  if (explore) return { ...FOG.explore };
  const e = overhead(distance);
  const near = FOG.story.near * scale;
  const far = FOG.story.far * scale;
  return { near: near + (FOG.explore.near - near) * e, far: far + (FOG.explore.far - far) * e };
}

/** 0 within 50 of what the camera looks at (every story shot), 1 from 120 (Explore's map), eased between. */
export function overhead(distance: number) {
  const k = Math.min(Math.max((distance - 50) / (120 - 50), 0), 1);
  return k * k * (3 - 2 * k);
}

/** The hemisphere light, times the hour's ambient (time.ts). The sky light (reflections.ts) does most of the fill now. */
const HEMI = 0.5;

export function Atmosphere({ lite }: { lite: boolean }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const fog = useMemo(() => new Fog("#f2d2b2", 40, 260), []);

  const sky = useMemo(() => skyMaterial(lite), [lite]);

  const domeRef = useRef<Mesh>(null);

  const motion = useMemo(() => ({ last: new Vector3(), moving: 1 }), []);

  useFrame(({ camera, gl, clock }, dt) => {
    const day = dayNow();
    const L = lightingAt(day.hour);
    const S = LOOK_OFF ? TODAY : skyAt(day.hour);
    const explore = day.mode === "explore";
    sunDirection(L, sunDir);

    // How much the camera is on the move (0 at rest): it takes the travel box at once and gives it back as it settles.
    const speed = rig.target.distanceTo(motion.last) / Math.max(dt, 1e-3);
    motion.last.copy(rig.target);
    const goal = Math.min(Math.max((speed - 0.15) / 1.35, 0), 1);
    motion.moving += (goal - motion.moving) * (1 - Math.exp(-(goal > motion.moving ? 10 : 2.5) * dt));
    if (motion.moving < 0.002) motion.moving = 0;
    const fit = shadowBox({ position: camera.position, target: rig.target, fov: (camera as PerspectiveCamera).fov, aspect: (camera as PerspectiveCamera).aspect }, sunDir);
    const half = shadowHalf(fit, motion.moving, explore);

    if (sun.current) {
      sun.current.position.copy(rig.target).addScaledVector(sunDir, 80);
      sun.current.target.position.copy(rig.target);
      sun.current.target.updateMatrixWorld();
      sun.current.color.set(L.sunColor);
      sun.current.intensity = L.sunIntensity;
      const cam = sun.current.shadow.camera;
      if (cam.right !== half) {
        cam.left = -half;
        cam.right = half;
        cam.top = half;
        cam.bottom = -half;
        cam.updateProjectionMatrix();
      }
    }
    gl.shadowMap.autoUpdate = !lite;
    if (lite && (++drawn.frames >= SHADOW_EVERY || shadowsMoved(camera, half))) {
      gl.shadowMap.needsUpdate = true;
      drawn.box.copy(rig.target);
      drawn.half = half;
      drawn.sun.copy(sunDir);
      drawn.cuso.copy(rig.cuso);
      drawn.heading = rig.heading;
      drawn.frames = 0;
    }
    if (hemi.current) {
      // a base fill under the sky light (the probe's own picture of the city gets only this)
      hemi.current.intensity = L.ambient * HEMI;
      hemi.current.color.set(L.skyTop);
      hemi.current.groundColor.set(L.night > 0.5 ? "#1a1a2a" : "#b49a7c");
    }

    fog.color.set(L.fog);
    Object.assign(fog, fogRange(camera.position.distanceTo(rig.target), explore, S.fogScale));

    updateSky(sky, L, S, sunDir, clock.elapsedTime);
    domeRef.current?.position.copy(camera.position);

    rig.night = L.night;
    facadeNight.value = L.night;
    updateNightGlow(L.night);
  });

  return (
    <>
      <primitive object={fog} attach="fog" />
      <mesh ref={domeRef} material={sky} renderOrder={-1} frustumCulled={false}>
        <sphereGeometry args={[480, 32, 16]} />
      </mesh>
      <hemisphereLight ref={hemi} />
      <directionalLight
        ref={sun}
        castShadow
        // lite: a quarter of the texels (phones draw far fewer pixels anyway)
        shadow-mapSize={lite ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0003}
        // a few texels of the box at rest: no acne, and Cuso's shoes still throw their contact shadow
        shadow-normalBias={0.03}
        shadow-camera-near={1}
        shadow-camera-far={220}
      />
    </>
  );
}
