"use client";

// Time of day: sun or moon, sky dome, fog and night glow, driven by scroll.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BackSide, Color, Fog, Frustum, Matrix4, ShaderMaterial, Sphere, Vector3, type Camera, type DirectionalLight, type HemisphereLight, type Mesh } from "three";
import { lightingAt } from "@/lib/time";
import { LINE, carGround, unionCar } from "./cable-line";
import { facadeNight } from "./facade";
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

export function Atmosphere({ lite }: { lite: boolean }) {
  const sun = useRef<DirectionalLight>(null);
  const hemi = useRef<HemisphereLight>(null);
  const fog = useMemo(() => new Fog("#f2d2b2", 40, 260), []);

  const sky = useMemo(
    () =>
      new ShaderMaterial({
        side: BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new Color() },
          horizon: { value: new Color() },
          sunColor: { value: new Color() },
          sunDir: { value: new Vector3(0, 1, 0) },
          night: { value: 0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * p;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top, horizon, sunColor, sunDir;
          uniform float night;
          varying vec3 vDir;
          float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main() {
            float h = clamp(vDir.y, -0.2, 1.0);
            vec3 col = mix(horizon, top, smoothstep(-0.02, 0.55, h));
            float d = max(dot(vDir, normalize(sunDir)), 0.0);
            col += sunColor * (pow(d, 600.0) * 2.5 + pow(d, 12.0) * 0.25) * (1.0 - night * 0.6);
            float stars = step(0.9975, hash(floor(vDir * 420.0))) * smoothstep(0.05, 0.4, h) * night;
            col += vec3(stars);
            gl_FragColor = vec4(col, 1.0);
          }`,
      }),
    [],
  );

  const domeRef = useRef<Mesh>(null);

  useFrame(({ camera, gl }) => {
    const day = dayNow();
    const L = lightingAt(day.hour);
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
      hemi.current.intensity = L.ambient;
      hemi.current.color.set(L.skyTop);
      hemi.current.groundColor.set(L.night > 0.5 ? "#1a1a2a" : "#b49a7c");
    }

    fog.color.set(L.fog);
    fog.near = explore ? 260 : 70;
    fog.far = explore ? 900 : 340;

    sky.uniforms.top.value.set(L.skyTop);
    sky.uniforms.horizon.value.set(L.skyHorizon);
    sky.uniforms.sunColor.value.set(L.night > 0.5 ? "#c9d4ff" : L.sunColor);
    sky.uniforms.sunDir.value.copy(sunDir);
    sky.uniforms.night.value = L.night;
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
