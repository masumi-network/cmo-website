// The parks' lawns as data: trails, where grass grows wild, the kerb edge and
// fake erosion gullies on the hills. Pure and seeded. The ground shader reads
// it baked into a small texture (lawnTexture); the grass blades (grass.tsx)
// read the same functions, so blades and ground always agree.

import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat } from "three";
import { heightAt } from "@/lib/terrain";
import { EDGE, PARKS, inPark } from "./grid";

/** Area the texture covers (all four parks), in world units, and texels per unit. */
export const LAWN = { x0: -67, z0: -36, size: 80, px: 8 };

/** The two Twin Peaks summits and Telegraph Hill's top: gullies run down from them. */
export const PEAKS: [number, number][] = [[-40.5, 34], [-30, 34.5], [3, -27]];

export type Trail = { points: [number, number][]; width: number };

/** Smooth curve through control points (Catmull-Rom), a point every ~0.25 units. */
function curve(ctrl: [number, number][]): [number, number][] {
  const c = (i: number) => ctrl[Math.min(ctrl.length - 1, Math.max(0, i))];
  const out: [number, number][] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [p0, p1, p2, p3] = [c(i - 1), c(i), c(i + 1), c(i + 2)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * 4);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const f = (a: number, b: number, d: number, e: number) => 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** A trail from control points; its ends sit on the park's kerb (an entrance). */
const trail = (width: number, ...ctrl: [number, number][]): Trail => ({ width, points: curve(ctrl) });

// Park interiors (inside the kerb): Golden Gate x -64.6..-37.4, z 16.4..21.6; Twin Peaks x -48.6..-21.4,
// z 26.4..41.6; Pioneer x -0.6..10.6, z -33.6..-18.4; Dolores x -16.6..-5.4, z 36.4..41.6.
/** Pioneer Park's walk up from the south, to the ring round Coit Tower's plaza. Cuso takes it to 23:00 (routes.ts). */
export const PIONEER_WALK = trail(0.42, [0.6, -18.5], [1.3, -20.4], [3.4, -21.8], [2.9, -23.9]);

export const TRAILS: Trail[] = [
  // Golden Gate Park: a long meandering walk, and a crossing where x -51 used to run.
  trail(0.55, [-64.5, 18.6], [-60, 19.6], [-55, 18.2], [-49, 19.6], [-43, 18], [-37.5, 19.2]),
  trail(0.45, [-50.4, 16.5], [-51, 18.6], [-50.2, 21.5]),
  // Twin Peaks: a dirt trail along the ridge below both summits, and one over the saddle.
  trail(0.42, [-48.5, 37.6], [-45, 36.9], [-41.6, 36.1], [-38, 35.6], [-35, 34.9], [-32, 35.9], [-28.6, 36.6], [-25, 37.8], [-21.5, 38.4]),
  trail(0.4, [-34.4, 26.5], [-35.6, 29], [-34.6, 31.6], [-35.1, 34], [-35.6, 36.4], [-34.2, 39], [-34.9, 41.5]),
  // Pioneer Park: a ring round Coit Tower's plaza, a walk up from the south and the steps from the east.
  trail(0.42, ...Array.from({ length: 25 }, (_, i): [number, number] => [2 + 1.95 * Math.cos((i / 24) * Math.PI * 2), -26 + 1.95 * Math.sin((i / 24) * Math.PI * 2)])),
  PIONEER_WALK,
  trail(0.38, [10.5, -27.2], [8, -26.4], [5.6, -26.9], [3.9, -26.4]),
  // Dolores Park: a long diagonal and a short cross walk.
  trail(0.5, [-16.5, 40.8], [-13.4, 39.4], [-10.6, 38.6], [-7.6, 37.6], [-5.5, 37]),
  trail(0.42, [-10.4, 36.5], [-11.1, 38.8], [-10.7, 41.5]),
];

/** Trail segments [ax, az, bx, bz, half width] bucketed by the 1x1 cells within 1 of them, so a lookup checks a few. */
const BUCKETS = new Map<number, number[][]>();
const cellKey = (i: number, j: number) => i * 1000 + j;
for (const { points, width } of TRAILS) {
  for (let k = 1; k < points.length; k++) {
    const [ax, az] = points[k - 1];
    const [bx, bz] = points[k];
    const seg = [ax, az, bx, bz, width / 2];
    for (let i = Math.floor(Math.min(ax, bx) - 1.5); i <= Math.floor(Math.max(ax, bx) + 1.5); i++)
      for (let j = Math.floor(Math.min(az, bz) - 1.5); j <= Math.floor(Math.max(az, bz) + 1.5); j++) BUCKETS.set(cellKey(i, j), [...(BUCKETS.get(cellKey(i, j)) ?? []), seg]);
  }
}

/** Distance from x,z to the nearest trail's edge (negative on a trail); 1 or more counts as far. */
function trailDistance(x: number, z: number) {
  let best = 1;
  for (const [ax, az, bx, bz, hw] of BUCKETS.get(cellKey(Math.floor(x), Math.floor(z))) ?? []) {
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)) - hw);
  }
  return best;
}

/** On a trail, or within `margin` of one. */
export const onTrail = (x: number, z: number, margin = 0) => trailDistance(x, z) < margin + 0.04;

/** 0..1 from two integers. */
function hash(x: number, z: number) {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Smooth value noise, 0..1. */
export function noise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = (x - xi) ** 2 * (3 - 2 * (x - xi));
  const v = (z - zi) ** 2 * (3 - 2 * (z - zi));
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Which park x,z is in (index into PARKS), or -1. */
const parkOf = (x: number, z: number) => (inPark(x, z) ? PARKS.findIndex(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1) : -1);

/** How wild the grass grows: 0 a mown lawn, 1 tall dry meadow (Twin Peaks, Telegraph Hill's outer slopes). */
export function wildness(x: number, z: number) {
  const park = parkOf(x, z);
  if (park === 1) return 1;
  if (park === 2) return smooth(3.6, 6, Math.hypot(x - 2, z + 26) + (noise(x / 2.5, z / 2.5) - 0.5) * 3);
  return 0;
}

/** Slope of the ground (rise over run) at x,z. */
const slopeAt = (x: number, z: number) => {
  const h = heightAt(x, z);
  return Math.hypot(heightAt(x + 0.1, z) - h, heightAt(x, z + 0.1) - h) / 0.1;
};

/**
 * Fake erosion: gullies running down from each summit, 0..1 (1 on a crest).
 * Only shading (normals and colour) follows it; the ground stays heightAt.
 */
function gullies(x: number, z: number) {
  const steep = smooth(0.04, 0.22, slopeAt(x, z));
  if (steep === 0) return 0;
  // Polar coordinates around the nearest summits, blended over the saddle so there is no seam.
  let sum = 0;
  let weight = 0;
  for (const [px, pz] of PEAKS) {
    const r = Math.hypot(x - px, z - pz);
    if (r > 16) continue;
    const w = 1 / (r * r + 1);
    const a = Math.atan2(z - pz, x - px);
    // About one gully every 1.6 units of arc at r 5; they wander a little as they run down.
    const g = noise(a * 3.1 + 40 + noise(r * 0.35, a) * 0.8, r * 0.28);
    sum += (1 - Math.abs(g * 2 - 1)) * w;
    weight += w;
  }
  return weight ? (sum / weight) * steep : 0;
}

/** Distance inside the park's kerb (0 at the kerb). */
const kerbDistance = (x: number, z: number) =>
  Math.max(0, ...PARKS.map(([x0, x1, z0, z1]) => Math.min(x - x0 - EDGE, x1 - EDGE - x, z - z0 - EDGE, z1 - EDGE - z)));

/** [trail, wild, kerb, gully], each 0..1, all 0 off the parks. `gully` can be passed in when already known. */
export function lawnField(x: number, z: number, gully = gullies): [number, number, number, number] {
  if (!inPark(x, z)) return [0, 0, 0, 0];
  const t = 1 - smooth(-0.08, 0.1, trailDistance(x, z));
  return [t, wildness(x, z), 1 - smooth(0, 0.5, kerbDistance(x, z)), gully(x, z)];
}

let baked: DataTexture | null = null;

/** lawnField baked over LAWN (RGBA = trail, wild, kerb, gully), made once and shared. */
export function lawnTexture() {
  if (baked) return baked;
  const n = LAWN.size * LAWN.px;
  const data = new Uint8Array(n * n * 4);
  const texel = (v: number, v0: number) => Math.min(n - 1, Math.max(0, Math.floor((v - v0) * LAWN.px)));
  for (const [x0, x1, z0, z1] of PARKS) {
    // Gullies are broad: work them out every 4th of a unit and blend in between (the slow part).
    const q = 4;
    const cols = Math.ceil((x1 - x0) * q) + 1;
    const grid = Array.from({ length: (Math.ceil((z1 - z0) * q) + 1) * cols }, (_, k) => gullies(x0 + (k % cols) / q, z0 + Math.floor(k / cols) / q));
    const gully = (x: number, z: number) => {
      const u = (x - x0) * q;
      const v = (z - z0) * q;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const g = (a: number, b: number) => grid[(j + b) * cols + i + a];
      return (g(0, 0) * (1 - (u - i)) + g(1, 0) * (u - i)) * (1 - (v - j)) + (g(0, 1) * (1 - (u - i)) + g(1, 1) * (u - i)) * (v - j);
    };
    for (let j = texel(z0, LAWN.z0); j <= texel(z1, LAWN.z0); j++) {
      for (let i = texel(x0, LAWN.x0); i <= texel(x1, LAWN.x0); i++) {
        const x = LAWN.x0 + (i + 0.5) / LAWN.px;
        const z = LAWN.z0 + (j + 0.5) / LAWN.px;
        if (inPark(x, z)) lawnField(x, z, gully).forEach((v, c) => (data[(j * n + i) * 4 + c] = Math.round(v * 255)));
      }
    }
  }
  baked = new DataTexture(data, n, n, RGBAFormat);
  baked.magFilter = LinearFilter;
  baked.minFilter = LinearMipmapLinearFilter;
  baked.generateMipmaps = true;
  baked.needsUpdate = true;
  return baked;
}

/**
 * GLSL shared by the ground and the grass blades: the lawn field lookup, its
 * gully slope, and the lawn colour. Declares uniform `uLawn` (lawnTexture); uGrass must be declared before it.
 */
export const LAWN_GLSL = /* glsl */ `
  uniform sampler2D uLawn;
  float lHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float lNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(lHash(i), lHash(i + vec2(1.0, 0.0)), f.x), mix(lHash(i + vec2(0.0, 1.0)), lHash(i + 1.0), f.x), f.y);
  }
  vec2 lawnUv(vec2 xz) { return (xz - vec2(${LAWN.x0.toFixed(1)}, ${LAWN.z0.toFixed(1)})) / ${LAWN.size.toFixed(1)}; }
  /** Grass texture at two scales, blended by a slow noise so the tiling never shows. Needs uGrass. */
  vec3 lawnGreen(vec2 xz) {
    vec3 a = texture2D(uGrass, xz / 2.6).rgb;
    vec3 b = texture2D(uGrass, mat2(0.8, -0.6, 0.6, 0.8) * xz / 7.3 + 0.31).rgb;
    return mix(a, b, 0.2 + 0.6 * lNoise(xz / 4.3));
  }
  /** Slope of the fake gullies (world xz), for bending normals. */
  vec2 lawnGullySlope(vec2 xz) {
    float e = ${(1 / LAWN.px).toFixed(4)};
    float h = texture2D(uLawn, lawnUv(xz)).a;
    return vec2(texture2D(uLawn, lawnUv(xz + vec2(e, 0.0))).a - h, texture2D(uLawn, lawnUv(xz + vec2(0.0, e))).a - h) / e;
  }
  /**
   * Lawn colour at xz. f: the lawn field (trail, wild, kerb, gully); n: world normal;
   * green, dry: samples of the grass and dry-grass textures there.
   */
  vec3 lawnColor(vec2 xz, vec4 f, vec3 n, vec3 green, vec3 dry) {
    float wild = f.g;
    // Muted toward sage; a slow drift between yellow-green and blue-green over tens of units.
    float luma = dot(green, vec3(0.299, 0.587, 0.114));
    green = mix(vec3(0.2, 0.25, 0.12), mix(vec3(luma), green, 0.5), 0.55) * vec3(0.95, 0.97, 0.86);
    green *= mix(vec3(1.0, 1.0, 1.06), vec3(1.06, 1.02, 0.86), lNoise(xz / 23.0));
    dry = mix(vec3(dot(dry, vec3(0.299, 0.587, 0.114))), dry, 0.75) * vec3(1.04, 0.99, 0.86);
    // Dry patches: small on watered lawns; on wild slopes the sunny (south) faces and gully crests go gold,
    // the shady north faces and gully floors stay green.
    float patches = lNoise(xz / 9.0) * 0.65 + lNoise(xz / 3.1 + 7.0) * 0.35;
    float sun = clamp(n.z * 4.0, -1.0, 1.0);
    float dryness = smoothstep(0.5, 0.78, patches) * 0.55 * (1.0 - wild);
    dryness += wild * clamp(0.45 + 0.25 * sun + (patches - 0.5) * 0.6 + (f.a - 0.3) * 0.45, 0.1, 0.85);
    vec3 c = mix(green, dry, dryness);
    // Clumps and clover: small darker and lighter patches.
    c *= (0.9 + 0.2 * patches) * (0.93 + 0.1 * lNoise(xz * 1.7));
    // Bare earth where a mown lawn gets steep.
    float steep = smoothstep(0.1, 0.32, 1.0 - n.y) * (1.0 - wild);
    c = mix(c, dry * vec3(0.8, 0.7, 0.58), steep * 0.55);
    // Thicker, shaded grass along the kerb.
    return c * (1.0 - 0.3 * f.b);
  }`;
