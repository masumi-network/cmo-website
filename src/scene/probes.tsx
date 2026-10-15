"use client";

// Photo-real mode (F12, docs/features/photoreal.md): baked light probes while
// the camera moves. Every lit material gets a small patch (desktop only, at
// load, before shaders compile): where a probe grid is loaded and photo-real
// is on, its light replaces today's studio light (the environment's diffuse
// part) and hemisphere light, so streets and walls keep the traced bounce and
// shade between chapters. Reflections stay as they are. Off (`cityProbesMix`
// 0), every material draws exactly as today: switching costs no recompile.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Data3DTexture, LinearFilter, Material, Vector2, Vector3, Vector4, type MeshStandardMaterial, type Object3D } from "three";
import { PROBES_DIR, PROBE_GLSL_CONSTANTS, hourBlend, parseProbeManifest, probeBytes, type ProbeManifest } from "@/lib/probes";
import { damp, dayNow } from "./shared";

const empty = new Data3DTexture(new Uint8Array(4), 1, 1, 1);
empty.needsUpdate = true;

/** Shared by every patched material. */
export const probeUniforms = {
  cityProbes: { value: empty as Data3DTexture },
  cityProbesMin: { value: new Vector3() },
  cityProbesSize: { value: new Vector3(1, 1, 1) },
  cityProbesRes: { value: new Vector3(1, 1, 1) },
  /** Block of hour a, block of hour b, how far from a to b, blocks in the texture. */
  cityProbesHour: { value: new Vector4(0, 0, 0, 1) },
  cityProbesScale: { value: new Vector2(1, 1) },
  /** 0 = today's light, 1 = the probes'. */
  cityProbesMix: { value: 0 },
};

const { A0, A1, SQRT3 } = PROBE_GLSL_CONSTANTS;
const f = (x: number) => x.toFixed(6);

// The texture holds 4 coefficient blocks (RGB of L0, L1x, L1y, L1z) side by side along x, hours stacked along z.
const PARS = /* glsl */ `
uniform highp sampler3D cityProbes;
uniform vec3 cityProbesMin;
uniform vec3 cityProbesSize;
uniform vec3 cityProbesRes;
uniform vec4 cityProbesHour;
uniform vec2 cityProbesScale;
uniform float cityProbesMix;
vec3 cityProbeTap(float c, float block, vec3 g) {
  return texture(cityProbes, vec3((c * cityProbesRes.x + g.x) / (4.0 * cityProbesRes.x), g.y / cityProbesRes.y, (block * cityProbesRes.z + g.z) / (cityProbesHour.w * cityProbesRes.z))).rgb;
}
vec3 cityProbeHour(float block, float scale, vec3 g, vec3 n) {
  vec3 l0 = cityProbeTap(0.0, block, g) * scale;
  float s = 2.0 * ${f(SQRT3)} * scale;
  vec3 lx = (cityProbeTap(1.0, block, g) - 0.5) * s;
  vec3 ly = (cityProbeTap(2.0, block, g) - 0.5) * s;
  vec3 lz = (cityProbeTap(3.0, block, g) - 0.5) * s;
  return max(${f(A0)} * l0 + ${f(A1)} * (lx * n.x + ly * n.y + lz * n.z), 0.0);
}
// world point p facing n: the probes' irradiance; w is 1 inside the grid and fades to 0 at its edge
vec3 cityProbeIrradiance(vec3 p, vec3 n, out float w) {
  vec3 cell = cityProbesSize / cityProbesRes;
  vec3 f = (p + n * cell * 0.5 - cityProbesMin) / cityProbesSize;
  vec3 edge = smoothstep(vec3(0.0), vec3(0.04), f) * smoothstep(vec3(1.0), vec3(0.96), f);
  w = edge.x * edge.y * edge.z;
  vec3 g = clamp(f * cityProbesRes, vec3(0.5), cityProbesRes - 0.5);
  vec3 a = cityProbeHour(cityProbesHour.x, cityProbesScale.x, g, n);
  return cityProbesHour.z > 0.0 ? mix(a, cityProbeHour(cityProbesHour.y, cityProbesScale.y, g, n), cityProbesHour.z) : a;
}
`;

const APPLY = /* glsl */ `
#if defined( RE_IndirectDiffuse )
  if ( cityProbesMix > 0.0 ) {
    float cityW;
    vec3 cityE = cityProbeIrradiance( ( ( vec4( geometryPosition, 1.0 ) - viewMatrix[ 3 ] ) * viewMatrix ).xyz, transformNormalByInverseViewMatrix( geometryNormal, viewMatrix ), cityW );
    float cityK = cityProbesMix * cityW;
    irradiance *= 1.0 - cityK;
    iblIrradiance = mix( iblIrradiance, cityE, cityK );
  }
#endif
`;

const patched = new WeakSet<Material>();

/** Adds the probe light to a lit material, after its own patch (if any). Once per material. */
export function withProbes(m: Material) {
  const lit = m as MeshStandardMaterial & { isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean };
  if (patched.has(m) || !(lit.isMeshStandardMaterial || lit.isMeshLambertMaterial || lit.isMeshPhongMaterial)) return;
  patched.add(m);
  const original = m.onBeforeCompile;
  const key = m.customProgramCacheKey;
  const ownKey = key !== Material.prototype.customProgramCacheKey;
  m.onBeforeCompile = (shader, renderer) => {
    original.call(m, shader, renderer);
    Object.assign(shader.uniforms, probeUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${PARS}`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>\n${APPLY}`);
  };
  m.customProgramCacheKey = () => `${ownKey ? key.call(m) : original.toString()}|probes`;
}

/** Every lit material in the scene. */
export function patchProbes(scene: Object3D) {
  scene.traverse((o) => {
    for (const m of [(o as { material?: Material | Material[] }).material ?? []].flat()) withProbes(m);
  });
}

/** The baked bytes (12 per probe, x fastest, then y, z, hour blocks) as the shader's RGBA texture. */
export function probeTexture(bytes: Uint8Array, m: ProbeManifest) {
  const [nx, ny, nz] = m.res;
  const blocks = Math.max(...m.hours.map((h) => h.block)) + 1;
  const data = new Uint8Array(nx * 4 * ny * nz * blocks * 4);
  for (let b = 0; b < blocks; b++)
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const src = (((b * nz + k) * ny + j) * nx + i) * 12;
          for (let c = 0; c < 4; c++) {
            const dst = (((b * nz + k) * ny + j) * nx * 4 + c * nx + i) * 4;
            data[dst] = bytes[src + c * 3];
            data[dst + 1] = bytes[src + c * 3 + 1];
            data[dst + 2] = bytes[src + c * 3 + 2];
            data[dst + 3] = 255;
          }
        }
  const t = new Data3DTexture(data, nx * 4, ny, nz * blocks);
  t.minFilter = t.magFilter = LinearFilter;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return { texture: t, blocks };
}

async function load(): Promise<{ manifest: ProbeManifest; bytes: Uint8Array } | null> {
  const manifest = parseProbeManifest(await (await fetch(`${PROBES_DIR}/manifest.json`)).json());
  if (!manifest) return null;
  const r = await fetch(`${PROBES_DIR}/${manifest.file}`);
  if (!r.ok) return null;
  const bytes = await probeBytes(await r.arrayBuffer());
  return bytes.length === manifest.res[0] * manifest.res[1] * manifest.res[2] * 12 * (Math.max(...manifest.hours.map((h) => h.block)) + 1) ? { manifest, bytes } : null;
}

/** Loads the probes the first time photo-real is on, then fades them in and out with it and follows the hour. */
export function Probes({ on }: { on: boolean }) {
  const gl = useThree((s) => s.gl);
  const grid = useRef<ProbeManifest | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (!on || asked.current) return;
    asked.current = true;
    load()
      .then((got) => {
        if (!got) return;
        const { texture, blocks } = probeTexture(got.bytes, got.manifest);
        const u = probeUniforms;
        u.cityProbes.value = texture;
        u.cityProbesMin.value.fromArray(got.manifest.min);
        u.cityProbesSize.value.fromArray(got.manifest.size);
        u.cityProbesRes.value.fromArray(got.manifest.res);
        u.cityProbesHour.value.w = blocks;
        grid.current = got.manifest;
      })
      .catch(() => {}); // no probes: today's light
  }, [on]);

  useFrame((_, dt) => {
    const m = grid.current;
    const u = probeUniforms;
    if (!m) return;
    u.cityProbesMix.value += ((on ? 1 : 0) - u.cityProbesMix.value) * damp(6, dt);
    if (!on && u.cityProbesMix.value < 1e-3) u.cityProbesMix.value = 0;
    const { a, b, t } = hourBlend(
      m.hours.map((h) => h.hour),
      dayNow().hour,
    );
    u.cityProbesHour.value.set(m.hours[a].block, m.hours[b].block, t, u.cityProbesHour.value.w);
    u.cityProbesScale.value.set(m.hours[a].scale, m.hours[b].scale);
    // for tests: on once the probes are loaded and mostly faded in
    const shown = u.cityProbesMix.value > 0.5 ? "on" : "off";
    if (gl.domElement.dataset.probes !== shown) gl.domElement.dataset.probes = shown;
  });

  return null;
}
