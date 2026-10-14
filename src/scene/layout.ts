// Where everything in the city goes. Pure and seeded, so it is testable and
// the same on every visit. Rendering lives in city.tsx.

import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";

export { LAND, PARKS, STREET, SIDEWALK, X_STREETS, Z_STREETS, insideLand } from "./grid";
import { EDGE, STREET, SIDEWALK, X_STREETS, Z_STREETS, WALK_X, WALK_Z, groundAt, inPark, insideLand, streetDrop } from "./grid";
import { FOOTING } from "./materials";
import { onRoad } from "./roads";
import { PATHS } from "./routes";

/** Places the generator keeps clear: [x, z, radius]. */
export const CLEAR: [number, number, number][] = [
  [-14, -10.4, 5.2], // Russian Hill rooftop
  [-11, 10.2, 5.4], // Hayes Valley shop
  [-5.2, 29, 4.8], // Mission wall
  [7, 8, 5.4], // Union Square
  [6.5, -11, 5.8], // Transamerica Pyramid
  [2, -26, 4.5], // Coit Tower's lawn on Telegraph Hill
  [-35, 34, 10], // Twin Peaks: open grass on both peaks, trees only low down
];

/** True if something at x,z (radius r, height h) gets between a camera and its subject. */
export function blocksView(x: number, z: number, h: number, r: number) {
  return chapters.some(({ camera: { position: p, target: q } }) => {
    for (let s = 0; s <= 1.0001; s += 0.04) {
      const px = p[0] + (q[0] - p[0]) * s;
      const py = p[1] + (q[1] - p[1]) * s;
      const pz = p[2] + (q[2] - p[2]) * s;
      if (Math.hypot(px - x, pz - z) < r + 1.2 && py < h + 0.8) return true;
    }
    return false;
  });
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Row house bodies are this much narrower than their plot (a seam between houses). */
export const HOUSE_GAP = 0.06;
/** Height over width of a house front (taken from the Painted Lady photos the models were measured from). */
export const FACADE_ASPECT = 1.5;

// `y` is the ground under the centre; `h` is height above it.
export type House = {
  x: number; y: number; z: number; w: number; d: number;
  /** Set by the facade photo, which is never stretched: (w - HOUSE_GAP) * FACADE_ASPECT. */
  h: number;
  /** Floors in the facade photo (2 or 3). */
  floors: 2 | 3;
  /** +1 faces south (+z), -1 faces north. */
  facing: 1 | -1;
  color: string; trim: string;
  roof: "flat" | "gable";
  bay: boolean;
};
export type Tier = { w: number; d: number; y: number; h: number };
export type Tower = { x: number; y: number; z: number; w: number; d: number; h: number; glass: boolean; color: string; tiers: Tier[] };
export type Tree = { x: number; y: number; z: number; s: number };
/** Street furniture (street.tsx): lamps, hydrants, signs. `turn`: rotation around y. */
export type Fixture = { x: number; y: number; z: number; turn: number };
/** Lamps, hydrants and signs stand this far in from the kerb line, like SF's: clear of the stoops and bays at the back of the sidewalk. */
export const KERB_SET = 0.3;

const PAINTED = ["#f0d9c4", "#e9c7b0", "#d8e0d0", "#cfdbe3", "#f2e6c9", "#e6cfd6", "#d9cbb8", "#f4ede1", "#c9d7cf", "#e8d3a8"];
const TRIMS = ["#fbf7ef", "#f3ece0", "#e8e1d4"];
const STONE = ["#e3d9c8", "#d6cbb7", "#cfc4b0", "#e9e1d3"];
const GLASS = ["#9fb0bf", "#8fa3b4", "#a9b6c0"];

const footprint = (x: number, z: number, w: number, d: number) => [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2], [x, z]];

/**
 * Where a building's ground floor sits on a slope: level with its highest
 * corner, so nothing is sunk; the footing (FOOTING) shows on the downhill side.
 * Null if the slope drops more than the footing can cover.
 */
function base(x: number, z: number, w: number, d: number) {
  const ground = footprint(x, z, w, d).map(([a, b]) => heightAt(a, b));
  const top = Math.max(...ground);
  return top - Math.min(...ground) < FOOTING - 0.1 ? top : null;
}

const clearOf = (x: number, z: number) => CLEAR.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) >= r);

const fits = (x: number, z: number, w: number, d: number, h: number, y: number | null): y is number =>
  y !== null &&
  footprint(x, z, w, d).every(([a, b]) => insideLand(a, b)) &&
  clearOf(x, z) &&
  !blocksView(x, z, y + h, Math.max(w, d) / 2);
/** Financial District down through SoMa. */
const isDowntown = (x: number, z: number) => x > -3 && x < 31 && z > -36 && z < 34;

export function generateCity() {
  const rand = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const houses: House[] = [];
  const towers: Tower[] = [];
  const trees: Tree[] = [];
  const edge = EDGE;

  for (let i = 0; i < X_STREETS.length - 1; i++) {
    for (let j = 0; j < Z_STREETS.length - 1; j++) {
      const x0 = X_STREETS[i] + edge;
      const x1 = X_STREETS[i + 1] - edge;
      const z0 = Z_STREETS[j] + edge;
      const z1 = Z_STREETS[j + 1] - edge;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;

      if (inPark(cx, cz)) {
        for (let k = 0; k < 14; k++) {
          const x = x0 + rand() * (x1 - x0);
          const z = z0 + rand() * (z1 - z0);
          if (insideLand(x, z) && clearOf(x, z) && !blocksView(x, z, heightAt(x, z) + 2.6, 1)) trees.push({ x, y: heightAt(x, z), z, s: 0.8 + rand() * 0.6 });
        }
        continue;
      }

      if (isDowntown(cx, cz)) {
        const count = 2;
        const w = (x1 - x0 - 0.4 * (count - 1)) / count;
        for (let k = 0; k < count; k++) {
          const tw = w * (0.86 + rand() * 0.12);
          const td = (z1 - z0) * (0.85 + rand() * 0.12);
          const x = x0 + w * k + 0.4 * k + w / 2;
          // Nothing near the Transamerica Pyramid outgrows it: Cuso stands on top.
          const nearPyramid = Math.hypot(x - 6.5, cz + 11) < 22;
          const h = Math.min(7 + rand() ** 1.6 * 24, nearPyramid ? 17 : 31);
          const y = base(x, cz, tw, td);
          if (!fits(x, cz, tw, td, h, y)) continue;
          const tiers: Tier[] = [{ w: tw, d: td, y: 0, h: h > 14 ? h * 0.6 : h }];
          if (h > 14) tiers.push({ w: tw * 0.78, d: td * 0.78, y: h * 0.6, h: h > 22 ? h * 0.25 : h * 0.4 });
          if (h > 22) tiers.push({ w: tw * 0.56, d: td * 0.56, y: h * 0.85, h: h * 0.15 });
          const glass = rand() < 0.5;
          towers.push({ x, y, z: cz, w: tw, d: td, h, glass, color: glass ? pick(GLASS) : pick(STONE), tiers });
        }
        continue;
      }

      // Row houses on both long sides, fronts on the street.
      const depth = (z1 - z0) / 2;
      for (const facing of [-1, 1] as const) {
        const z = facing === -1 ? z0 + depth / 2 : z1 - depth / 2;
        let x = x0;
        while (x1 - x >= 2.6) {
          const w = Math.min(2.6 + rand() * 0.8, x1 - x);
          const floors = rand() < 0.55 ? 2 : 3;
          // Room is checked at the old storey heights (at least as tall), so the row stays as it was.
          const room = floors * 2.2 + 0.5;
          const hx = x + w / 2;
          const y = base(hx, z, w, depth);
          if (fits(hx, z, w, depth, room, y)) {
            houses.push({
              x: hx, y, z, w, d: depth, h: (w - HOUSE_GAP) * FACADE_ASPECT, floors, facing,
              color: pick(PAINTED), trim: pick(TRIMS),
              roof: rand() < 0.4 ? "gable" : "flat",
              bay: rand() < 0.7,
            });
          }
          x += w;
        }
      }
    }
  }

  // Street trees along the east-west streets.
  // Cuso walks the WALK_Z streets: keep their sidewalks clear.
  for (const sz of Z_STREETS.filter((z) => !WALK_Z.includes(z))) {
    for (let x = -64; x < 29; x += 4) {
      for (const side of [-1, 1]) {
        const z = sz + side * (STREET / 2 + SIDEWALK / 2);
        // Only on a sidewalk: not where a park closes the street.
        if (!insideLand(x, z) || isDowntown(x, z) || !clearOf(x, z) || groundAt(x, z) !== "sidewalk") continue;
        if (X_STREETS.some((sx) => Math.abs(x - sx) < STREET)) continue;
        const roll = rand();
        const y = heightAt(x, z);
        if (roll < 0.35 && !blocksView(x, z, y + 2.6, 0.9)) trees.push({ x, y, z, s: 0.55 + rand() * 0.25 });
      }
    }
  }

  return { houses, towers, trees, ...streetFurniture(trees) };
}

/** Cuso's whole day in x and z, every 0.25 (jumps too: furniture stays out from under them). */
const ROUTE: [number, number][] = PATHS.flatMap(({ points }) =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);

/**
 * Street lamps, fire hydrants and green street-name signs, by the junctions,
 * all KERB_SET in from the kerb. Lamps stand on two opposite corners of a
 * junction (in front of no house). Hydrants and signs stand just past a corner on the
 * north-south streets, where the sidewalk runs past the houses' side walls
 * (no doors, stoops or garages); signs only where a junction is on one of
 * Cuso's walking streets. Nothing on a curb ramp; everything 1.3 off his
 * routes, clear of trees, landmarks, bridge roads and camera views.
 */
function streetFurniture(trees: Tree[]) {
  const rand = rng(7);
  const lamps: Fixture[] = [];
  const hydrants: Fixture[] = [];
  const signs: Fixture[] = [];
  const taken: { x: number; z: number }[] = [...trees];
  const free = ({ x, z }: { x: number; z: number }, height: number, reach: number) =>
    insideLand(x, z) &&
    clearOf(x, z) &&
    [0, 1, 2, 3, 4, 5, 6, 7].every((a) => {
      const [px, pz] = [x + Math.cos((a * Math.PI) / 4) * 0.2, z + Math.sin((a * Math.PI) / 4) * 0.2];
      return groundAt(px, pz) === "sidewalk" && streetDrop(px, pz) === 0;
    }) &&
    !onRoad(x, z) &&
    taken.every((o) => Math.hypot(o.x - x, o.z - z) > 1.2) &&
    ROUTE.every(([px, pz]) => Math.hypot(px - x, pz - z) > 1.3) &&
    !blocksView(x, z, heightAt(x, z) + height, reach);
  const place = (list: Fixture[], options: { x: number; z: number; dx: number }[], height: number, reach: number) => {
    const o = options.find((p) => free(p, height, reach));
    if (!o) return;
    // hydrant nozzles and sign blades square to the street they stand by
    const f = { x: o.x, y: heightAt(o.x, o.z), z: o.z, turn: o.dx > 0 ? Math.PI : 0 };
    list.push(f);
    taken.push(f);
  };
  const kerb = STREET / 2 + KERB_SET;
  for (const s of X_STREETS) {
    for (const t of Z_STREETS) {
      if (!insideLand(s, t) || groundAt(s, t) !== "street") continue;
      // the four corners, in a seeded order
      const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map((c) => ({ c, k: rand() })).sort((a, b) => a.k - b.k).map(({ c }) => c);
      const past = (along: number) => corners.map(([dx, dz]) => ({ x: s + dx * kerb, z: t + dz * (EDGE + along), dx }));
      // lamps on two opposite corners (the walking streets' corners are curb ramps: they get none)
      for (const [dx, dz] of [corners[0], corners[0].map((v) => -v)]) place(lamps, [{ x: s + dx * kerb, z: t + dz * kerb, dx }], 3.2, 0.15);
      const walk = WALK_X.includes(s) || WALK_Z.includes(t);
      const both = WALK_X.includes(s) && WALK_Z.includes(t);
      if (walk && (both || rand() < 0.15)) place(signs, past(0.5), 2.3, 0.35);
      if (rand() < 0.4) place(hydrants, past(0.9 + rand() * 0.6), 0.4, 0.15);
    }
  }
  return { lamps, hydrants, signs };
}

/** The generated city, computed once. */
export const CITY = generateCity();

/**
 * Transamerica Pyramid: four white precast faces with a constant taper up to
 * Cuso's platform (y 28), the two plumb wings on the east and west faces,
 * and the hollow aluminium spire beside him. `pyramidHalf(y)` is the
 * half-width of the body at height y. The base is as wide as the block allows:
 * its corners stop on the sidewalks of the streets at z -6 and -16. Drawn by
 * pyramid.tsx; kept here so the camera and the layout can read it.
 */
export const PYRAMID = { x: 6.5, z: -11, base: 3.4, top: 0.56, height: 28 };
export const pyramidHalf = (y: number) => PYRAMID.base + ((PYRAMID.top - PYRAMID.base) * y) / PYRAMID.height;
/** Wings: [side (+1 east, -1 west), bottom, top, width]. Their outer walls are plumb. */
export const WINGS: [number, number, number, number][] = [
  [1, 13, 21.5, 1.1],
  [-1, 13, 21, 0.9],
];

/**
 * The Ferry Building's bounding boxes as [width, top, depth] around (x, z):
 * stone plinth (the pier deck), hall (with its cornice and skylight) and clock
 * tower. The 18:00 cable car stands on its rails out front. Drawn by ferry.tsx; the collision test
 * and the camera read it.
 */
export const FERRY = { x: 33.4, z: -3, plinth: [5, 0.3, 14], hall: [3.16, 4.05, 12.16], tower: [1.62, 11.65] } as const;

type Box = { minX: number; maxX: number; minZ: number; maxZ: number; top: number };

/** Solid boxes the camera must not enter: every building plus landmark buildings. */
export const OBSTACLES: Box[] = [
  ...[...CITY.houses, ...CITY.towers].map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, top: b.y + b.h + 0.6 })),
  { minX: -17.5, maxX: -10.5, minZ: -13.6, maxZ: -7.4, top: heightAt(-14, -10.4) + 8.5 }, // Russian Hill rooftop
  { minX: -15, maxX: -7, minZ: 7, maxZ: 11.6, top: heightAt(-11, 9.3) + 6.8 }, // Hayes Valley shop
  { minX: 3.5, maxX: 10.5, minZ: 6.4, maxZ: 11.6, top: heightAt(7, 9) + 9.6 }, // Union Square + billboard
  { minX: -10.4, maxX: -5.4, minZ: 26.4, maxZ: 32.1, top: heightAt(-5.7, 29) + 7 }, // Mission building and its awning (mission.tsx)
  { minX: 1.3, maxX: 2.7, minZ: -26.7, maxZ: -25.3, top: heightAt(2, -26) + 6.4 }, // Coit Tower (6.06 tall on its plaza, coit-tower.tsx)
  ...ferryBoxes(),
];

/** The Ferry Building's plinth and hall, and its clock tower, as camera obstacles (a little air around them). */
function ferryBoxes(): Box[] {
  const { x, z, plinth, hall, tower } = FERRY;
  const g = heightAt(x, z);
  const around = (w: number, d: number, top: number) => ({ minX: x - w / 2 - 0.3, maxX: x + w / 2 + 0.3, minZ: z - d / 2 - 0.3, maxZ: z + d / 2 + 0.3, top: g + top + 0.5 });
  return [around(Math.max(plinth[0], hall[0]), hall[2], hall[1]), around(tower[0], tower[0], tower[1])];
}

/** Air the camera keeps from the Pyramid's faces and wings. */
const PYRAMID_AIR = 0.4;
const PYRAMID_GROUND = heightAt(PYRAMID.x, PYRAMID.z);

/** Inside the Transamerica Pyramid's tapered body or one of its wings (plus a little air)? */
function insidePyramid(x: number, y: number, z: number) {
  const h = y - PYRAMID_GROUND;
  if (h > PYRAMID.height + 0.5 || h < -1) return false;
  const dx = Math.abs(x - PYRAMID.x);
  const dz = Math.abs(z - PYRAMID.z);
  if (dx < pyramidHalf(Math.max(0, h)) + PYRAMID_AIR && dz < pyramidHalf(Math.max(0, h)) + PYRAMID_AIR) return true;
  // wings: plumb outer walls from the face out to the wing's width at its foot
  return WINGS.some(([side, y0, y1, w]) => h > y0 - PYRAMID_AIR && h < y1 + PYRAMID_AIR && Math.sign(x - PYRAMID.x) === side && dx < pyramidHalf(y0) + PYRAMID_AIR && dz < w / 2 + PYRAMID_AIR);
}

/** Air the camera keeps from every wall, so the near plane never slices into a facade. */
const WALL_AIR = 0.35;

/** True if a point is inside a building (with the camera's air around it). */
export const insideBuilding = (x: number, y: number, z: number) =>
  insidePyramid(x, y, z) ||
  OBSTACLES.some((b) => x > b.minX - WALL_AIR && x < b.maxX + WALL_AIR && z > b.minZ - WALL_AIR && z < b.maxZ + WALL_AIR && y < b.top);

type P3 = { x: number; y: number; z: number };

/** The top of the highest building within `pad` (plus the camera's air) of x, z, or -Infinity: what a camera flying over must clear. */
export function roofAt(x: number, z: number, pad = 0) {
  const a = WALL_AIR + pad;
  let top = -Infinity;
  for (const b of OBSTACLES) if (x > b.minX - a && x < b.maxX + a && z > b.minZ - a && z < b.maxZ + a) top = Math.max(top, b.top);
  const r = PYRAMID.base + PYRAMID_AIR + pad;
  if (Math.abs(x - PYRAMID.x) < r && Math.abs(z - PYRAMID.z) < r) top = Math.max(top, PYRAMID_GROUND + PYRAMID.height + 0.5);
  return top;
}

/**
 * Whether the line a→b misses every building (with WALL_AIR + `air` around
 * it). Exact: each solid is a set of linear limits along the line, so nothing
 * thin slips between probes. A solid that already holds `a` (Cuso's eye, mid
 * jump up a wall) is ignored.
 */
export function sightClear(a: P3, b: P3, air = 0) {
  const pad = WALL_AIR + air;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  // [lo, hi]: the part of the line (0..1) inside every limit so far; each limit is p + q·t < 0
  let lo = 0;
  let hi = 1;
  const limit = (p: number, q: number) => {
    if (Math.abs(q) < 1e-12) {
      if (p >= 0) hi = -1;
    } else if (q > 0) hi = Math.min(hi, -p / q);
    else lo = Math.max(lo, -p / q);
  };
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number) => {
    if (a.x > x0 && a.x < x1 && a.z > z0 && a.z < z1 && a.y > y0 && a.y < y1) return false; // holds the eye
    lo = 0;
    hi = 1;
    limit(x0 - a.x, -dx);
    limit(a.x - x1, dx);
    limit(z0 - a.z, -dz);
    limit(a.z - z1, dz);
    limit(y0 - a.y, -dy);
    limit(a.y - y1, dy);
    return lo < hi;
  };
  const minX = Math.min(a.x, b.x) - pad;
  const maxX = Math.max(a.x, b.x) + pad;
  const minZ = Math.min(a.z, b.z) - pad;
  const maxZ = Math.max(a.z, b.z) + pad;
  const minY = Math.min(a.y, b.y);
  for (const o of OBSTACLES) {
    if (o.maxX < minX || o.minX > maxX || o.maxZ < minZ || o.minZ > maxZ || o.top < minY) continue;
    if (box(o.minX - pad, o.maxX + pad, o.minZ - pad, o.maxZ + pad, -1e3, o.top)) return false;
  }
  // the Pyramid: its foot as a box, the tapered body as four sloping limits, the wings as boxes
  const g = PYRAMID_GROUND;
  const r = PYRAMID.base + PYRAMID_AIR + air;
  if (maxX < PYRAMID.x - r || minX > PYRAMID.x + r || maxZ < PYRAMID.z - r || minZ > PYRAMID.z + r || minY > g + PYRAMID.height + 0.5) return true;
  if (insidePyramid(a.x, a.y, a.z)) return true;
  if (box(PYRAMID.x - r, PYRAMID.x + r, PYRAMID.z - r, PYRAMID.z + r, g - 1, g)) return false;
  // |x - px| < base + air + k·(y - g), with k the taper per unit height
  const k = (PYRAMID.top - PYRAMID.base) / PYRAMID.height;
  const ex = a.x - PYRAMID.x;
  const ez = a.z - PYRAMID.z;
  const half = r + k * (a.y - g);
  lo = 0;
  hi = 1;
  limit(ex - half, dx - k * dy);
  limit(-ex - half, -dx - k * dy);
  limit(ez - half, dz - k * dy);
  limit(-ez - half, -dz - k * dy);
  limit(g - a.y, -dy);
  limit(a.y - (g + PYRAMID.height + 0.5), dy);
  if (lo < hi) return false;
  for (const [side, y0, y1, w] of WINGS) {
    const out = pyramidHalf(y0) + PYRAMID_AIR + air;
    const [x0, x1] = side > 0 ? [PYRAMID.x, PYRAMID.x + out] : [PYRAMID.x - out, PYRAMID.x];
    const d = w / 2 + PYRAMID_AIR + air;
    if (box(x0, x1, PYRAMID.z - d, PYRAMID.z + d, g + y0 - PYRAMID_AIR - air, g + y1 + PYRAMID_AIR + air)) return false;
  }
  return true;
}
