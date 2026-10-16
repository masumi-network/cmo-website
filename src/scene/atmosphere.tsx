"use client";

// Time of day: sun or moon, sky dome, fog and night glow, driven by scroll.

// Height-aware haze in the fog chunks: patched at import, before any shader compiles.
import "./haze";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Fog, Frustum, Matrix4, Sphere, Vector3, type Camera, type DirectionalLight, type HemisphereLight, type Mesh } from "three";
import { lightingAt } from "@/lib/time";
import { LINE, carGround, unionCar } from "./cable-line";
import { facadeNight } from "./facade";
import { TODAY, skyAt, skyMaterial, updateSky } from "./sky";
import { dayNow, rig, updateNightGlow } from "./shared";

const sunDir = new Vector3();
const DEG = Math.PI / 180;

/**
 * Lite: the sun's shadow map is redrawn only when something big in it moves
 * (the sun, the shadow box, Cuso walking or turning, the cable car in view), and
 * otherwise every SHADOW_EVERY frames for small idle motion (breathing, wind).
 * Cars, boats and street furniture cast no shadows in lite.
 */
const SHADOW_EVERY = 4;
const drawn = { box: new Vector3(), sun: new Vector3(), cuso: new Vector3(), heading: 0, frames: 0 };
const view = new Frustum();
const m4 = new Matrix4();
/** The cable car and the shadow it throws on the street, while it runs. */
const car = new Sphere(new Vector3(), 8);
const ground = { y: 0, tilt: 0 };
function shadowsMoved(camera: Camera) {
  if (unionCar.v !== 0) {
    carGround(unionCar.s, ground);
    car.center.set(unionCar.s, ground.y, LINE.z);
    if (view.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)).intersectsSphere(car)) return true;
  }
  return (
    drawn.box.distanceToSquared(rig.target) > 1e-6 ||
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

  useFrame(({ camera, gl, clock }) => {
    const day = dayNow();
    const L = lightingAt(day.hour);
    const S = LOOK_OFF ? TODAY : skyAt(day.hour);
    const explore = day.mode === "explore";

    // The moon stands in for the sun at night, high and cool.
    const elevation = (L.elevation < 0 ? 38 : L.elevation) * DEG;
    const azimuth = L.azimuth * DEG;
    sunDir.set(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));

    if (sun.current) {
      sun.current.position.copy(rig.target).addScaledVector(sunDir, 80);
      sun.current.target.position.copy(rig.target);
      sun.current.target.updateMatrixWorld();
      sun.current.color.set(L.sunColor);
      sun.current.intensity = L.sunIntensity;
      const box = explore ? 90 : 34;
      const cam = sun.current.shadow.camera;
      if (cam.right !== box) {
        cam.left = -box;
        cam.right = box;
        cam.top = box;
        cam.bottom = -box;
        cam.updateProjectionMatrix();
      }
    }
    gl.shadowMap.autoUpdate = !lite;
    if (lite && (++drawn.frames >= SHADOW_EVERY || shadowsMoved(camera))) {
      gl.shadowMap.needsUpdate = true;
      drawn.box.copy(rig.target);
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
        shadow-bias={-0.0008}
        shadow-normalBias={0.1}
        shadow-camera-near={1}
        shadow-camera-far={220}
      />
    </>
  );
}
