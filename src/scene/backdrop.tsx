"use client";

// The distant hills and towns beyond the modelled city (skyline.ts): one
// shader for every ridge (its own haze, no scene fog), and town lights at
// night. Shown in the story, gone in Explore.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  FrontSide,
  ShaderMaterial,
  Vector2,
  Vector3,
  type Mesh,
  type Object3D,
} from "three";
import { lightingAt } from "@/lib/time";
import { DETAIL, damp, dayNow, rig } from "./shared";
import { LAYER, backdropAt, backdropFade, backdropRegions, hazeColors, townLights } from "./skyline";

/** Dev only: `?backdrop=off` hides the backdrop, for before and after screenshots. */
const OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("backdrop") === "off";

const LAYER_GLSL = /* glsl */ `
  uniform vec2 uCentre;
  float layerAt(vec2 xz) { return clamp((length(xz - uCentre) - ${LAYER.near.toFixed(1)}) / ${(LAYER.far - LAYER.near).toFixed(1)}, 0.0, 1.0); }`;

const vertexShader = /* glsl */ `
  attribute vec3 aColor;
  attribute vec3 aSurf;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec3 vSurf;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normal;
    vColor = aColor;
    vSurf = aSurf;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir, uSunLight, uSkyLight, uGlowColor, uToe, uNear, uFar;
  uniform float uHazeNear, uHazeFar, uFade;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying vec3 vSurf;
  ${LAYER_GLSL}

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec3 n = normalize(vNormal);
    vec2 xz = vWorld.xz;
    float town = vSurf.x;
    float built = vSurf.y;
    float mist = vSurf.z;
    // Gullies and spurs: tilt the normal along the slope of a noise field (not on the towers or the mast).
    float g0 = vnoise(xz / 16.0) + 0.5 * vnoise(xz / 6.0);
    float gx = vnoise((xz + vec2(1.0, 0.0)) / 16.0) + 0.5 * vnoise((xz + vec2(1.0, 0.0)) / 6.0) - g0;
    float gz = vnoise((xz + vec2(0.0, 1.0)) / 16.0) + 0.5 * vnoise((xz + vec2(0.0, 1.0)) / 6.0) - g0;
    n = normalize(n - vec3(gx, 0.0, gz) * BUMP * (1.0 - built));
    // Golden grass with darker scrub in patches.
    float scrub = smoothstep(0.5, 0.8, vnoise(xz / 22.0) * 0.6 + vnoise(xz / 7.0) * 0.4);
    vec3 land = mix(vec3(0.46, 0.34, 0.16), vec3(0.14, 0.15, 0.08), scrub * 0.85);
    // Towns: pale soft blocks with darker gaps.
    float blocks = vnoise(xz / 2.6) * 0.6 + vnoise(xz / 8.0) * 0.4;
    vec3 houses = mix(vec3(0.62, 0.56, 0.47), vec3(0.3, 0.27, 0.24), smoothstep(0.45, 0.8, blocks));
    land = mix(land, houses, town * smoothstep(0.3, 0.55, vnoise(xz / 11.0 + 5.0) * 0.5 + town * 0.5));
    vec3 albedo = mix(land, vColor, built);

    // Half-wrapped sun, sky from above.
    float wrap = dot(n, uSunDir) * 0.5 + 0.5;
    vec3 lit = albedo * (uSunLight * wrap * wrap + uSkyLight * (0.6 + 0.4 * n.y));

    // Aerial perspective: hazier and bluer with distance, glowing toward the sun.
    float layer = layerAt(xz);
    float haze = mix(1.0, mix(uHazeNear, uHazeFar, layer), uFade);
    vec3 view = normalize(vWorld - cameraPosition);
    vec3 air = mix(uNear, uFar, layer) + uGlowColor * pow(max(dot(view, uSunDir), 0.0), 8.0);
    vec3 col = mix(lit, air, haze);
    // Sea mist at the foot: the fogged water's colour, no seam.
    col = mix(col, uToe, mist);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const lightsVertex = /* glsl */ `
  attribute float aKind;
  attribute float aSeed;
  uniform float uLights, uPx, uTime, uFade;
  varying vec3 vColor;
  varying float vAlpha;
  ${LAYER_GLSL}
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    float mast = step(1.5, aKind);
    // Only the mast blinks: on a second, off a second.
    float blink = mix(1.0, step(0.5, fract(uTime * 0.5 + aSeed * 0.5)), mast);
    gl_PointSize = uPx * mix(0.8 + 0.5 * aSeed, 1.5, mast);
    vec3 sodium = vec3(1.0, 0.6, 0.28);
    vec3 white = vec3(1.0, 0.88, 0.7);
    vColor = mast > 0.5 ? vec3(1.0, 0.1, 0.06) * 2.5 : mix(sodium, white, step(0.65, aSeed)) * 1.4;
    vAlpha = uLights * uFade * blink * mix(1.0, 0.4, layerAt(position.xz));
  }`;

const lightsFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = smoothstep(0.5, 0.1, length(gl_PointCoord - 0.5));
    gl_FragColor = vec4(vColor, vAlpha * a);
    #include <colorspace_fragment>
  }`;

/** How strongly the sun and the sky light the far hills (tuned on screen). */
const LIGHT = { sun: 0.28, sky: 0.5 };

const centre = new Vector2(...LAYER.centre);

function ridgeMaterial() {
  return new ShaderMaterial({
    side: FrontSide,
    fog: false,
    defines: { BUMP: "14.0" },
    uniforms: {
      uCentre: { value: centre },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uSunLight: { value: new Color() },
      uSkyLight: { value: new Color() },
      uGlowColor: { value: new Color() },
      uToe: { value: new Color() },
      uNear: { value: new Color() },
      uFar: { value: new Color() },
      uHazeNear: { value: 0.5 },
      uHazeFar: { value: 0.8 },
      uFade: { value: 1 },
    },
    vertexShader,
    fragmentShader,
  });
}

function lightsMaterial() {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uCentre: { value: centre }, uLights: { value: 0 }, uPx: { value: 2 }, uTime: { value: 0 }, uFade: { value: 1 } },
    vertexShader: lightsVertex,
    fragmentShader: lightsFragment,
  });
}

type DomeUniforms = { top: { value: Color }; horizon: { value: Color }; sunColor: { value: Color }; sunDir: { value: Vector3 } };
const hazes = { toe: new Color(), near: new Color(), far: new Color() };
const sunColor = new Color();

export function Backdrop({ lite }: { lite: boolean }) {
  if (OFF) return null;
  return <Ridges lite={lite} />;
}

function Ridges({ lite }: { lite: boolean }) {
  const geometries = useMemo(
    () =>
      backdropRegions(lite).map((r) => {
        const g = new BufferGeometry();
        g.setAttribute("position", new Float32BufferAttribute(r.position, 3));
        g.setAttribute("normal", new Float32BufferAttribute(r.normal, 3));
        g.setAttribute("aColor", new Float32BufferAttribute(r.color, 3));
        g.setAttribute("aSurf", new Float32BufferAttribute(r.surf, 3));
        g.setIndex(r.index);
        g.computeBoundingSphere();
        return g;
      }),
    [lite],
  );
  const lightsGeometry = useMemo(() => {
    const l = townLights(lite);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(l.position, 3));
    g.setAttribute("aKind", new Float32BufferAttribute(l.kind, 1));
    g.setAttribute("aSeed", new Float32BufferAttribute(l.seed, 1));
    g.computeBoundingSphere();
    return g;
  }, [lite]);
  const material = useMemo(() => ridgeMaterial(), []);
  const lightMat = useMemo(() => lightsMaterial(), []);
  useEffect(
    () => () => {
      for (const g of geometries) g.dispose();
      lightsGeometry.dispose();
    },
    [geometries, lightsGeometry],
  );
  useEffect(
    () => () => {
      material.dispose();
      lightMat.dispose();
    },
    [material, lightMat],
  );

  const meshes = useRef<(Mesh | null)[]>([]);
  const points = useRef<Object3D | null>(null);
  const dome = useRef<DomeUniforms | null>(null);
  const fade = useRef(1);

  useFrame(({ scene, camera, gl, clock }, delta) => {
    if (!dome.current) {
      scene.traverse((o) => {
        const m = (o as Mesh).material as ShaderMaterial | undefined;
        if ((o as Mesh).isMesh && o.renderOrder < 0 && m?.side === BackSide && m.uniforms?.top) dome.current = m.uniforms as unknown as DomeUniforms;
      });
      if (!dome.current) return;
    }
    const day = dayNow();
    const L = lightingAt(day.hour);
    const k = backdropAt(day.hour);
    const d = dome.current;
    const target = day.mode === "explore" ? 0 : backdropFade(camera.position.distanceTo(rig.target));
    fade.current += (target - fade.current) * damp(4, delta);
    if (Math.abs(target - fade.current) < 1e-3) fade.current = target;
    const shown = fade.current > 0.001;

    const u = material.uniforms;
    u.uSunDir.value.copy(d.sunDir.value).normalize();
    sunColor.copy(d.sunColor.value);
    u.uSunLight.value.copy(sunColor).multiplyScalar(L.sunIntensity * LIGHT.sun);
    u.uSkyLight.value.copy(d.top.value).multiplyScalar(L.ambient * LIGHT.sky);
    u.uGlowColor.value.copy(sunColor).multiplyScalar(k.glow);
    const fog = (scene.fog as { color?: Color } | null)?.color ?? d.horizon.value;
    hazeColors(fog, d.horizon.value, d.top.value, k.blue, hazes);
    u.uToe.value.copy(hazes.toe);
    u.uNear.value.copy(hazes.near);
    u.uFar.value.copy(hazes.far);
    u.uHazeNear.value = k.hazeNear;
    u.uHazeFar.value = k.hazeFar;
    u.uFade.value = fade.current;
    for (const m of meshes.current) if (m) m.visible = shown;

    const lu = lightMat.uniforms;
    lu.uLights.value = k.lights;
    lu.uTime.value = clock.elapsedTime;
    lu.uFade.value = fade.current;
    lu.uPx.value = 2 * gl.getPixelRatio();
    if (points.current) points.current.visible = shown && k.lights > 0.01;
  });

  return (
    <group>
      {geometries.map((g, i) => (
        <mesh
          key={i}
          geometry={g}
          material={material}
          ref={(m) => {
            meshes.current[i] = m;
            m?.layers.set(DETAIL);
          }}
        />
      ))}
      <points
        ref={(p) => {
          points.current = p;
          p?.layers.set(DETAIL);
        }}
        geometry={lightsGeometry}
        material={lightMat}
        visible={false}
      />
    </group>
  );
}
