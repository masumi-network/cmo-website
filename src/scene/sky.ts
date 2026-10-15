// The sky dome's look through the day: a gradient from the horizon up, the sun's
// glow, stars at night, and soft fair-weather clouds with haze toward the horizon.
// Per-hour keys like lightingAt (src/lib/time.ts). Only 12:00 is tuned; every
// other key is today's clear sky, so a scroll blends the clouds in and out.

import { BackSide, Color, DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, ShaderMaterial, Vector3 } from "three";
import { mixHex, type Lighting } from "@/lib/time";

export type Sky = {
  /** How much of the sky the clouds cover, 0 to 1. */
  cover: number;
  /** How soft the cloud edges are (noise range from clear to solid). */
  softness: number;
  /** Cloud size: noise cells per unit of the cloud deck (larger is smaller clouds). */
  scale: number;
  /** Drift east, in noise cells per second. */
  wind: number;
  /** How dark the thick middles of the clouds get, 0 to 1. */
  shade: number;
  /** How far the horizon goes toward the distance fog's colour, 0 to 1. */
  haze: number;
  /** How much higher the pale band near the horizon reaches (0 is today's). */
  hazeHeight: number;
  /** Story fog distance times this (smaller is hazier). Explore's fog stays. */
  fogScale: number;
};

const NOON: Sky = { cover: 0.38, softness: 0.14, scale: 1.6, wind: 0.02, shade: 0.55, haze: 0.6, hazeHeight: 0.1, fogScale: 0.8 };
/** Today's clear sky. Cloud shape is noon's, so only cover and haze change on a scroll. */
export const TODAY: Sky = { ...NOON, cover: 0, haze: 0, hazeHeight: 0, fogScale: 1 };

// Hours run 6..30 (30 = 06:00 next day), like lightingAt.
const KEYS: [number, Sky][] = [
  [6, TODAY],
  [9, TODAY],
  [12, NOON],
  [15, TODAY],
  [30, TODAY],
];

export function skyAt(hour: number): Sky {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  if (t === 0 || a === b) return a;
  if (t === 1) return b;
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof Sky)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** The sky right at the horizon: today's, pulled toward the distance fog by the haze. */
export const horizonColor = (L: Lighting, s: Sky) => (s.haze > 0 ? mixHex(L.skyHorizon, L.fog, s.haze) : L.skyHorizon);

/** Sunlit cloud tops (the sun's colour, a touch of sky) and their shaded middles. Dim blue-grey at night. */
export function cloudColors(L: Lighting) {
  const lit = mixHex(mixHex(L.sunColor, L.skyTop, 0.06), L.skyTop, L.night * 0.85);
  const shade = mixHex(mixHex(lit, L.skyTop, 0.35), "#3a4150", 0.18);
  return { lit, shade };
}

/** The noise tile: `size` pixels square, `cells` value-noise cells across. */
export const NOISE = { size: 256, cells: 32 };

/** Tileable smooth value noise, one byte per pixel. Deterministic. */
export function cloudNoise() {
  const { size, cells } = NOISE;
  const step = size / cells;
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const grid = Array.from({ length: cells * cells }, rand);
  const at = (i: number, j: number) => grid[(j % cells) * cells + (i % cells)];
  const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x / step), j = Math.floor(y / step);
      const fx = smooth(x / step - i), fy = smooth(y / step - j);
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
      data[y * size + x] = Math.round(255 * (top + (bottom - top) * fy));
    }
  }
  return data;
}

function noiseTexture() {
  const t = new DataTexture(cloudNoise(), NOISE.size, NOISE.size, RedFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 top, horizon, sunColor, sunDir, cloudLit, cloudShade;
  uniform float night, cover, softness, scale, shade, haze, hazeHeight, drift;
  uniform sampler2D noiseMap;
  varying vec3 vDir;
  float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

  float noise(vec2 p) { return texture2D(noiseMap, p * ${(1 / NOISE.cells).toFixed(6)}).r; }
  // Each octave turns and doubles the cells with an integer matrix, so the tile still wraps.
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5, sum = 0.0;
    for (int i = 0; i < OCTAVES; i++) {
      v += a * noise(p);
      sum += a;
      p = mat2(2.0, 1.0, -1.0, 2.0) * p + vec2(5.3, 1.7);
      a *= 0.45;
    }
    // spread the middle-heavy sum back out to about 0..1
    return clamp((v / sum - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  }

  void main() {
    // Today's gradient, glow and stars read the interpolated direction as they always have.
    vec3 dir = normalize(vDir);
    float h = clamp(vDir.y, -0.2, 1.0);
    vec3 col = mix(horizon, top, smoothstep(-0.02, 0.55 + hazeHeight, h));
    vec3 sd = normalize(sunDir);
    float d = max(dot(vDir, sd), 0.0);
    col += sunColor * (pow(d, 600.0) * 2.5 + pow(d, 12.0) * 0.25) * (1.0 - night * 0.6);

    float density = 0.0;
    if (cover > 0.001 && dir.y > 0.02) {
      // The ray meets a flat cloud deck overhead: clouds shrink and crowd toward the horizon.
      vec2 uv = dir.xz / max(dir.y, 0.03) * scale + vec2(drift, 0.0);
      // Broad patches of cloud and of clear blue, then the puffs inside them.
      float n = fbm(uv) + (noise(uv * 0.25 + vec2(11.0, 3.0)) - 0.5) * 0.7;
      float t0 = 1.0 - cover;
      density = smoothstep(t0 - softness * 0.5, t0 + softness * 0.5, n);
      // Low in the sky they melt into the haze before the noise gets fine enough to shimmer.
      density *= smoothstep(0.04, 0.2, dir.y);
      // Lit from above, grey underneath: a second tap a little lower on screen (toward the viewer
      // on the deck). More cloud there means this point is near the top of a puff.
      float across = length(dir.xz);
      vec2 down = -dir.xz / max(across, 1e-3) * 0.35 * smoothstep(0.0, 0.3, across);
      float n2 = fbm(uv + down) + (noise((uv + down) * 0.25 + vec2(11.0, 3.0)) - 0.5) * 0.7;
      float lit = clamp(0.5 + (n2 - n) * 2.5, 0.0, 1.0);
      float thick = smoothstep(t0, t0 + 0.5, n);
      vec3 cloud = mix(cloudLit * 1.15, cloudShade, clamp(shade * (thick * 0.5 + (1.0 - lit)), 0.0, 1.0));
      // Far clouds take on the horizon's haze.
      cloud = mix(cloud, horizon, haze * (1.0 - smoothstep(0.05, 0.45, h)) * 0.7);
      col = mix(col, cloud, density);
    }

    float stars = step(0.9975, hash(floor(vDir * 420.0))) * smoothstep(0.05, 0.4, h) * night * (1.0 - density);
    col += vec3(stars);
    gl_FragColor = vec4(col, 1.0);
  }`;

/** The dome's material. The water finds it by BackSide and reads `top` and `horizon` (bay.tsx): keep those. */
export function skyMaterial(lite: boolean) {
  return new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    defines: { OCTAVES: lite ? 3 : 4 },
    uniforms: {
      top: { value: new Color() },
      horizon: { value: new Color() },
      sunColor: { value: new Color() },
      sunDir: { value: new Vector3(0, 1, 0) },
      night: { value: 0 },
      cloudLit: { value: new Color() },
      cloudShade: { value: new Color() },
      cover: { value: 0 },
      softness: { value: TODAY.softness },
      scale: { value: TODAY.scale },
      shade: { value: TODAY.shade },
      haze: { value: 0 },
      hazeHeight: { value: 0 },
      drift: { value: 0 },
      noiseMap: { value: noiseTexture() },
    },
    vertexShader,
    fragmentShader,
  });
}

/** Sets the dome for this frame: light `L`, sky `s`, sun (or moon) direction, seconds since start. */
export function updateSky(m: ShaderMaterial, L: Lighting, s: Sky, sunDir: Vector3, time: number) {
  const u = m.uniforms;
  u.top.value.set(L.skyTop);
  u.horizon.value.set(horizonColor(L, s));
  u.sunColor.value.set(L.night > 0.5 ? "#c9d4ff" : L.sunColor);
  u.sunDir.value.copy(sunDir);
  u.night.value = L.night;
  const c = cloudColors(L);
  u.cloudLit.value.set(c.lit);
  u.cloudShade.value.set(c.shade);
  u.cover.value = s.cover;
  u.softness.value = s.softness;
  u.scale.value = s.scale;
  u.shade.value = s.shade;
  u.haze.value = s.haze;
  u.hazeHeight.value = s.hazeHeight;
  // The tile wraps every NOISE.cells, at every octave: keep the offset small for precision.
  u.drift.value = -((time * s.wind) % NOISE.cells);
}
