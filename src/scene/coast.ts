// The Pacific coast of the city: Ocean Beach (sand) down the west shore,
// Lands End (a rocky apron and boulders) round the north-west point, Seal
// Rocks and Mile Rock offshore, and surf on every ocean-facing shore. Bay
// shores keep their sea wall. Pure and seeded: seashore.tsx draws it, bay.tsx
// folds it into the shore field (foam starts at the new water line) and runs
// SURF_GLSL in the water shader. Tested in tests/unit/coast.test.ts.

import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { heightAt } from "@/lib/terrain";
import { KERB, LAND, insideLand, streetDrop } from "./grid";
import { ROADS, piers } from "./roads";

/** The water surface (bay.tsx WATER_Y; a copy so this file stays free of the water's imports, tested equal). */
export const WATER_Y = -0.45;

/** Dev only: `?coast=off` shows the old sea wall all round (A/B screenshots and cost). */
export const COAST_OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("coast") === "off";

/** The ocean shore, along LAND (x east, z south): Ocean Beach from the south-west corner north, then Lands End round to the Golden Gate. */
export const COAST_PATH: [number, number][] = [LAND[14], LAND[15], LAND[0], LAND[1], LAND[2]];
const CUM = COAST_PATH.reduce<number[]>((acc, [x, z], i) => (i ? [...acc, acc[i - 1] + Math.hypot(x - COAST_PATH[i - 1][0], z - COAST_PATH[i - 1][1])] : [0]), []);

/** Where along the path (arc length) each kind of shore runs, with the length of its soft ends. */
export const OCEAN_BEACH = { from: 0, to: 76, fade: 8 };
export const LANDS_END = { from: 64, to: 102.5, fade: 7 };
/** Sand from the wall out to where it is this far under the water. */
export const BEACH_W = 4.5;
const BEACH_DEEP = WATER_Y - 0.35;
/** Below this a coast cell is under the (opaque) water and not drawn. */
const SUNK = WATER_Y - 0.8;
/** How far past the wall the coast mesh reaches, and how far it tucks under the land. */
export const COAST_REACH = 6;
const TUCK = 0.45;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
function noise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The sea wall's top at a shore point, as city.tsx raises it (never above a street that runs to it). */
export const wallTop = (x: number, z: number) =>
  heightAt(x, z) - Math.max(...[-0.6, 0, 0.6].flatMap((dx) => [-0.6, 0, 0.6].map((dz) => streetDrop(x + dx, z + dz))));

/**
 * The nearest point of the ocean shore: arc length `s` along COAST_PATH, its
 * position, and `d`, the signed distance from the shore (positive on the water).
 */
export function coastAt(x: number, z: number) {
  let best = Infinity;
  let s = 0;
  let px = 0;
  let pz = 0;
  for (let i = 1; i < COAST_PATH.length; i++) {
    const [ax, az] = COAST_PATH[i - 1];
    const [bx, bz] = COAST_PATH[i];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const qx = ax + vx * t;
    const qz = az + vz * t;
    const dist = Math.hypot(x - qx, z - qz);
    if (dist < best) {
      best = dist;
      s = CUM[i - 1] + t * (CUM[i] - CUM[i - 1]);
      px = qx;
      pz = qz;
    }
  }
  return { s, d: insideLand(x, z) ? -best : best, px, pz };
}

/** How much of a kind of shore there is at arc length s (0 to 1, soft at both ends). */
const span = ({ from, to, fade }: { from: number; to: number; fade: number }, s: number) => smoothstep(from, from + fade, s) * (1 - smoothstep(to - fade, to, s));

/**
 * The beach's height at distance d out from the wall whose top is `top`: flush
 * with it at the wall (it buries the wall's rounded lip), a gentle dry beach,
 * a steeper face into the water, BEACH_DEEP under it at BEACH_W. Inland it
 * tucks under the ground.
 */
export function beachProfile(d: number, top: number) {
  if (d <= 0) return top - 0.02 + d * 0.25;
  const u = Math.min(d / BEACH_W, 1);
  const y = top - 0.02 + (BEACH_DEEP - top + 0.02) * u * (0.6 + 0.4 * u);
  return d > BEACH_W ? y - (d - BEACH_W) * 0.25 : y;
}

/** Lands End: chunky rock shelves falling into the sea, coves and points from noise, never above the land behind. */
function rockProfile(x: number, z: number, d: number, top: number) {
  const n = noise(x / 2.6, z / 2.6) * 0.65 + noise(x / 1.1 + 7, z / 1.1) * 0.35 - 0.5;
  const dd = Math.max(0, d + 2.2 * n);
  let y = top - 0.02 - 0.1 * dd - 0.035 * dd * dd;
  // shelves: flat ledges with steep steps between them
  const q = y / 0.14;
  y = 0.14 * (Math.floor(q) + smoothstep(0.25, 0.75, q - Math.floor(q)));
  y += 0.1 * (noise(x / 0.7, z / 0.7) - 0.5);
  if (d < 0.7) y = Math.max(y, top - 0.03 - 0.3 * Math.max(d, 0)); // over the wall's lip
  if (d <= 0) y = top - 0.02 + d * 0.25;
  return Math.min(y, top - 0.02);
}

export type CoastPoint = { y: number; rock: boolean; s: number; d: number; top: number };

/** The coast's surface at x, z (sand or rock), or null where there is none (the bay shores, inland, open sea). */
export function coastSurface(x: number, z: number): CoastPoint | null {
  const { s, d, px, pz } = coastAt(x, z);
  if (d < -TUCK - 0.5 || d > COAST_REACH + 0.5) return null;
  const sand = span(OCEAN_BEACH, s);
  // rock starts where the beach ends, its edge wandering
  const rockAmount = span(LANDS_END, s + 5 * (noise(s / 4, 3.1) - 0.5));
  if (sand <= 0 && rockAmount <= 0) return null;
  // flush with the wall (a kerb lower where a street meets it), then a kerb under the ground, so a street's end leaves no step across the beach
  const wall = wallTop(px, pz);
  const top = wall + (heightAt(px, pz) - KERB - wall) * smoothstep(0, 1.6, d);
  const sandY = sand > 0 ? SUNK + (beachProfile(d, top) - SUNK) * sand : -Infinity;
  const rockY = rockAmount > 0 ? SUNK + (rockProfile(x, z, d, top) - SUNK) * rockAmount : -Infinity;
  return { y: Math.max(sandY, rockY), rock: rockY > sandY, s, d, top };
}

/** The coast's height at x, z, -Infinity where there is none. */
export const coastHeight = (x: number, z: number) => coastSurface(x, z)?.y ?? -Infinity;

/** The box the coast mesh covers (and bay.tsx bakes into the shore field). */
export const COAST_BOX = { x0: -92, x1: -58, z0: -60, z1: 49 };
const CELL = 0.4;

const SAND = new Color("#cdc1a6");
const ROCK = [new Color("#4f4c48"), new Color("#44423f"), new Color("#5a5650")];

/**
 * One mesh: the beach (smooth) and the rock apron (flat shaded, chunky),
 * vertex colours, aRock (1 on rock). Cells hidden under the land or the water
 * are left out.
 */
export function coastGeometry() {
  const { x0, x1, z0, z1 } = COAST_BOX;
  const nx = Math.round((x1 - x0) / CELL) + 1;
  const nz = Math.round((z1 - z0) / CELL) + 1;
  const points: (CoastPoint | null)[] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) points.push(coastSurface(x0 + i * CELL, z0 + j * CELL));
  const sand: number[] = [];
  const rock: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = [j * nx + i, j * nx + i + 1, (j + 1) * nx + i, (j + 1) * nx + i + 1];
      const p = k.map((n) => points[n]);
      if (p.some((q) => !q)) continue;
      const q = p as CoastPoint[];
      if (q.every((c) => c.y < SUNK + 0.55) || q.every((c) => c.d < -TUCK)) continue;
      const tri = [k[0], k[2], k[1], k[1], k[2], k[3]];
      (q.filter((c) => c.rock).length >= 2 ? rock : sand).push(...tri);
    }
  }
  const pos = new Float32Array(points.length * 3);
  const col = new Float32Array(points.length * 3);
  const kind = new Float32Array(points.length);
  const c = new Color();
  points.forEach((p, n) => {
    const x = x0 + (n % nx) * CELL;
    const z = z0 + Math.floor(n / nx) * CELL;
    pos.set([x, p ? p.y : 0, z], n * 3);
    if (!p) return;
    if (p.rock) {
      const t = noise(x / 4.3, z / 4.3) * 2;
      c.copy(ROCK[0]).lerp(ROCK[t < 1 ? 1 : 2], t < 1 ? 1 - t : t - 1);
    } else {
      c.copy(SAND).multiplyScalar(0.94 + 0.1 * noise(x / 3, z / 3));
    }
    col.set([c.r, c.g, c.b], n * 3);
    kind[n] = p.rock ? 1 : 0;
  });
  const part = (index: number[], flat: boolean) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    g.setAttribute("aRock", new Float32BufferAttribute(kind, 1));
    g.setIndex(index);
    if (!flat) g.computeVertexNormals();
    const out = g.toNonIndexed();
    if (flat) out.computeVertexNormals();
    return out;
  };
  return mergeGeometries([part(sand, false), part(rock, true)])!;
}

// ---------------------------------------------------------------------------
// Rocks: boulders on Lands End and the north end of the beach, and the sea
// stacks. Drawn with the parks' rock (grass.tsx stoneGeometries): about 1.25
// across at scale 1, 0.62 of that tall before `tall`.

export type Rock = { x: number; y: number; z: number; s: number; tall: number; yaw: number; stack: boolean };
/** How far a rock reaches from its centre (x, z) at scale 1, and how high above its centre. */
export const ROCK_RADIUS = 1.1;
export const ROCK_TOP = 0.78;

/** Seal Rocks off the north end of Ocean Beach, Mile Rock off Lands End: [x, z, size]. */
export const STACKS: [number, number, number][] = [
  [-74.6, -25.4, 0.8],
  [-76.6, -24.4, 0.6],
  [-76, -27.4, 0.5],
  [-95, -56, 0.7],
];

const GG_SOUTH = ROADS.find((r) => r.name === "golden-gate-south")!;
/** Things the rocks keep clear of: [x, z, radius]: the Golden Gate's south anchorage, its approach road and the road's piers. */
export const KEEP_CLEAR: [number, number, number][] = [
  [-80, -52, 4],
  ...GG_SOUTH.points.map(([x, , z]): [number, number, number] => [x, z, 2]),
  ...piers(GG_SOUTH).map(([x, z]): [number, number, number] => [x, z, 0.8]),
];

export const ROCKS: Rock[] = (() => {
  const rand = rng(23);
  const out: Rock[] = [];
  const clear = (x: number, z: number, r: number) =>
    !insideLand(x, z) && KEEP_CLEAR.every(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) > cr + r) && out.every((o) => Math.hypot(o.x - x, o.z - z) > (o.s + r) * 0.8);
  // Sea stacks: a tall rock with a few lower ones round its foot.
  for (const [x, z, s] of STACKS) {
    out.push({ x, y: WATER_Y - 0.15 * s, z, s, tall: 1.8, yaw: rand() * 6.28, stack: true });
    // a narrower crag on top breaks the round silhouette
    out.push({ x: x + 0.15 * s, y: WATER_Y + 0.55 * s, z: z - 0.1 * s, s: 0.62 * s, tall: 2.2, yaw: rand() * 6.28, stack: true });
    for (let k = 0; k < 3; k++) {
      const a = rand() * 6.28;
      const r = s * (0.9 + rand() * 0.5);
      const b = s * (0.35 + rand() * 0.25);
      out.push({ x: x + Math.cos(a) * r, y: WATER_Y - 0.2 * b, z: z + Math.sin(a) * r, s: b, tall: 1.2, yaw: rand() * 6.28, stack: true });
    }
  }
  // Boulders in clusters along the rocky shore, bigger out in the water.
  const along = (s: number) => {
    let i = 1;
    while (i < CUM.length - 1 && CUM[i] < s) i++;
    const t = (s - CUM[i - 1]) / (CUM[i] - CUM[i - 1]);
    const [ax, az] = COAST_PATH[i - 1];
    const [bx, bz] = COAST_PATH[i];
    const l = Math.hypot(bx - ax, bz - az);
    return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, nx: (az - bz) / l, nz: (bx - ax) / l };
  };
  for (let cluster = 0; cluster < 40; cluster++) {
    const s0 = LANDS_END.from + 4 + rand() * (LANDS_END.to - LANDS_END.from - 6);
    const d0 = 0.8 + rand() * 2.4;
    for (let k = 0; k < 6; k++) {
      const p = along(s0 + (rand() - 0.5) * 3);
      const d = d0 + (rand() - 0.5) * 1.2;
      // (nx, nz) points inland
      const x = p.x - p.nx * d;
      const z = p.z - p.nz * d;
      const ground = coastSurface(x, z);
      if (!ground) continue;
      const size = (0.18 + rand() * 0.22) * (0.8 + 0.25 * d);
      if (!clear(x, z, size * ROCK_RADIUS)) continue;
      // sunk a third into the ground or the water, and never higher than the land behind
      const y = Math.min(Math.max(ground.y, WATER_Y) - size * 0.3, ground.top - 0.02 - size * ROCK_TOP);
      out.push({ x, y, z, s: size, tall: 1, yaw: rand() * 6.28, stack: false });
    }
  }
  return out;
})();

/** Lite drops every other boulder (the stacks stay). */
export const liteRocks = (rocks: Rock[]) => rocks.filter((r, i) => r.stack || i % 2 === 0);

// ---------------------------------------------------------------------------
// Surf: lines of breakers rolling in on ocean-facing shores, a sheet of white
// water at the water's edge. Full on the open Pacific, fading through the
// Golden Gate, none in the bay.

/** Exposure: 1 - smoothstep(x0, x1, x + k * clamp(z0 - z, 0, cap)) (into the strait the fade comes west). */
export const EXPOSURE = { x0: -66, x1: -40, z0: -30, k: 0.6, cap: 60 };
/** Breaker spacing and how fast they roll in (lines a second), how far out they break, the white-water sheet. */
export const SURF = { spacing: 1.4, speed: 0.22, reach: 6, sheet: 1.4 };

export const surfExposure = (x: number, z: number) =>
  1 - smoothstep(EXPOSURE.x0, EXPOSURE.x1, x + EXPOSURE.k * Math.min(Math.max(0, EXPOSURE.z0 - z), EXPOSURE.cap));

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * GLSL: coastExposure(p) as surfExposure, and coastSurf(d, t, n1, n2): foam
 * from the surf at distance d from the shore, time t, two smooth noises in
 * -1..1. Lines are antialiased with fwidth and fade to their mean where they
 * get thinner than a pixel (no shimmer far away).
 */
export const SURF_GLSL = /* glsl */ `
  float coastExposure(vec2 p) {
    return 1.0 - smoothstep(${f(EXPOSURE.x0)}, ${f(EXPOSURE.x1)}, p.x + ${f(EXPOSURE.k)} * clamp(${f(EXPOSURE.z0)} - p.y, 0.0, ${f(EXPOSURE.cap)}));
  }
  // d: distance from the water line; far: the same blurred over a few units (the swell does not follow every cove);
  // t: time; n1, n2: smooth noise (-1..1, several units across); froth: fine noise (0..1)
  float coastSurf(float d, float far, float t, float n1, float n2, float froth) {
    float zone = smoothstep(${f(SURF.reach)}, ${f(SURF.reach * 0.35)}, d) * smoothstep(-0.2, 0.3, d);
    float phase = mix(d, far, smoothstep(0.5, 4.0, d)) / ${f(SURF.spacing)} + t * ${f(SURF.speed)} + n1 * 0.18;
    float fr = fract(phase);
    float aa = clamp(fwidth(phase) * 1.5, 0.04, 1.0);
    // the breaking crest (soft front), a short trail of foam out to sea behind it
    float crest = max(exp(-fr * 14.0), 1.0 - smoothstep(0.0, aa, 1.0 - fr)) + 0.15 * exp(-fr * 4.0);
    // waves break where the bars are, everywhere close in
    float breaks = smoothstep(-0.2, 0.4, n2 + 1.2 * (1.0 - smoothstep(0.8, ${f(SURF.reach * 0.55)}, d)));
    float lines = mix(0.25, crest, smoothstep(0.5, 0.15, fwidth(phase)));
    float foamy = smoothstep(0.3, 0.7, froth);
    float sheet = smoothstep(${f(SURF.sheet)}, 0.1, d) * (0.1 + 0.5 * smoothstep(0.5, 0.85, froth));
    return clamp(zone * (0.9 * lines * breaks * (0.25 + 0.75 * foamy) + sheet), 0.0, 1.0);
  }`;
