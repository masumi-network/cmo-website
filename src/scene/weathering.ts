// Weathering for the buildings' shaders (materials.ts): dirt splashed up from
// the street, faint rain streaks, concrete that is never one flat colour, a
// slightly different tone per building, shade under every overhang and a
// little dust on the roofs. Restrained on purpose: a real city, not a dirt
// filter. World position only, so the water mirror and the glass probe see
// the same thing. Every GLSL symbol starts with w (the materials use f).

import { HILLS, PLAZA } from "@/lib/terrain";

/** Grime fades out by this height above the ground (world units, about a storey and a half). */
export const GRIME_TOP = 1.6;
/** The most grime darkens anything, right at the ground on the dirtiest building. */
export const MAX_GRIME = 0.3;
/** How much buildings differ in tone (each channel within ±this); mottle is 1.5 times it. Houses keep their curated palettes. */
export const TONE = { house: 0.02, downtown: 0.04 };
/** Undersides (cornices, bays, sills, eaves): this much darker, the contact shade AO used to give. */
const SOFFIT = 0.25;
/** Dust on roofs facing up: how far toward its grey. */
const DUST = 0.06;

/** A float literal GLSL accepts. */
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** heightAt (terrain.ts) in GLSL: the plaza, else the sum of the hills' domes. */
export const GROUND_GLSL = /* glsl */ `
  float wGround(vec2 p) {
    if (p.x > ${f(PLAZA.x0)} && p.x < ${f(PLAZA.x1)} && p.y > ${f(PLAZA.z0)} && p.y <= ${f(PLAZA.z1)}) return ${f(PLAZA.y)};
    float wH = 0.0;
    vec2 wD;
    float wT;
${HILLS.map(([x, z, a, rx, rz]) => `    wD = (p - vec2(${f(x)}, ${f(z)})) / vec2(${f(rx)}, ${f(rz)}); wT = max(1.0 - dot(wD, wD), 0.0); wH += ${f(a)} * wT * wT;`).join("\n")}
    return wH;
  }`;

/** Grime at height h above the ground: n (0..1, noise) moves its top edge, seed sets how dirty the building is. */
export function grime(h: number, seed: number, n: number) {
  const top = GRIME_TOP * (0.6 + 0.4 * n);
  const g = 1 - smoothstep(0, top, h);
  return MAX_GRIME * (0.65 + 0.35 * fract(seed * 7.13)) * g * g;
}

/** A building's tone: lighter or darker and a little warmer or cooler, each channel within ±a. */
export function tone(seed: number, a: number): [number, number, number] {
  const l = fract(seed * 3.71) * 2 - 1;
  const w = fract(seed * 11.3) * 2 - 1;
  return [1 + a * (0.75 * l + 0.25 * w), 1 + a * 0.75 * l, 1 + a * (0.75 * l - 0.25 * w)];
}

const fract = (x: number) => x - Math.floor(x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The functions behind the snippet; `grime` and `tone` above mirror wGrime and wTone. */
export const WEATHER_GLSL = /* glsl */ `
  uniform float uWeather;
  const float W_TOP = ${f(GRIME_TOP)};
  const float W_MAX = ${f(MAX_GRIME)};
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 wI = floor(p);
    vec2 wF = fract(p);
    wF = wF * wF * (3.0 - 2.0 * wF);
    return mix(mix(wHash(wI), wHash(wI + vec2(1.0, 0.0)), wF.x), mix(wHash(wI + vec2(0.0, 1.0)), wHash(wI + 1.0), wF.x), wF.y);
  }
  // Noise whose cells are k pixels across: its average (0.5) once they get too small to show.
  float wFine(float n, float k) { return mix(n, 0.5, smoothstep(0.3, 0.7, k)); }
  float wGrime(float h, float seed, float n) {
    float wTop = W_TOP * (0.6 + 0.4 * n);
    float wG = 1.0 - smoothstep(0.0, wTop, h);
    return W_MAX * (0.65 + 0.35 * fract(seed * 7.13)) * wG * wG;
  }
  vec3 wTone(float seed, float a) {
    float wL = fract(seed * 3.71) * 2.0 - 1.0;
    float wW = fract(seed * 11.3) * 2.0 - 1.0;
    return 1.0 + a * (0.75 * wL + 0.25 * wW * vec3(1.0, 0.0, -1.0));
  }`;

/**
 * The snippet that weathers diffuseColor, after the material's own colour.
 * `seed` is a flat per-building value (0..1), `glass` how much of the pixel is
 * glass (kept clean), `amount` the material's TONE (uWeather: houses and
 * landmarks share one program, so it is a uniform).
 */
export function weather(seed: string, glass: string, amount: number) {
  const glsl = /* glsl */ `{
    float wGl = clamp(${glass}, 0.0, 1.0);
    float wSeed = ${seed};
    float wWall = 1.0 - smoothstep(0.3, 0.7, abs(vFNormal.y));
    vec2 wAx = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
    // walls by (along, height), tops by (x, z)
    vec2 wS = wWall > 0.5 ? vec2(dot(vFPos.xz, wAx), vFPos.y) : vFPos.xz;
    float wPx = length(fwidth(vFPos)); // a pixel, in world units
    // splash-back from the street: the top edge wanders along the wall; half as much on ledges and steps
    float wN = wFine(wNoise(vec2(wS.x * 2.2, vFPos.y * 0.7) + wSeed * 37.0), wPx * 2.2);
    float wDirt = wGrime(vFPos.y - wGround(vFPos.xz), wSeed, wN) * (0.5 + 0.5 * wWall);
    // varied concrete: big soft patches, and faint streaks down the walls
    float wMot = wFine(wNoise(wS * 0.4 + wSeed * 53.0), wPx * 0.4) * 2.0 - 1.0;
    float wStreak = wWall * smoothstep(0.62, 0.9, wNoise(vec2(wS.x * 4.0, wS.y * 0.15))) * (1.0 - smoothstep(0.3, 0.7, wPx * 4.0));
    vec3 wC = diffuseColor.rgb * wTone(wSeed, uWeather) * (1.0 + 1.5 * uWeather * wMot);
    wC *= 1.0 - wDirt * vec3(0.9, 0.95, 1.0) - 0.04 * wStreak;
    wC *= 1.0 - ${f(SOFFIT)} * smoothstep(0.5, 0.8, -vFNormal.y);
    wC = mix(wC, vec3(0.42, 0.4, 0.37), ${f(DUST)} * smoothstep(0.6, 0.95, vFNormal.y) * (0.6 + 0.4 * wMot));
    diffuseColor.rgb = mix(wC, diffuseColor.rgb, wGl);
  }`;
  return { glsl, amount };
}

export type Weather = ReturnType<typeof weather>;
