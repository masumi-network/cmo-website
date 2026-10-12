// Where everything in the city goes. Pure and seeded, so it is testable and
// the same on every visit. Rendering lives in city.tsx.

import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";

export { LAND, STREET, SIDEWALK, X_STREETS, Z_STREETS, insideLand } from "./grid";
import { STREET, SIDEWALK, X_STREETS, Z_STREETS, WALK_Z, insideLand } from "./grid";

/** Places the generator keeps clear: [x, z, radius]. */
export const CLEAR: [number, number, number][] = [
  [-14, -10.4, 5.2], // Russian Hill rooftop
  [-11, 10.2, 5.4], // Hayes Valley shop
  [-5.2, 29, 4.8], // Mission wall
  [7, 8, 5.4], // Union Square
  [6.5, -11, 5.8], // Transamerica Pyramid
  [2, -26, 8.5], // Telegraph Hill
  [-34, 30, 11.5], // Twin Peaks
];

/** Blocks that are parks: [x0, x1, z0, z1] in street coordinates. */
export const PARKS: [number, number, number, number][] = [
  [-67, -35, 14, 24], // Golden Gate Park
  [-35, -19, 34, 44], // Dolores Park
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

// `y` is the ground under the centre; `h` is height above it.
export type House = {
  x: number; y: number; z: number; w: number; d: number; h: number;
  /** +1 faces south (+z), -1 faces north. */
  facing: 1 | -1;
  color: string; trim: string;
  roof: "flat" | "gable";
  bay: boolean;
};
export type Tier = { w: number; d: number; y: number; h: number };
export type Tower = { x: number; y: number; z: number; w: number; d: number; h: number; glass: boolean; color: string; tiers: Tier[] };
export type Tree = { x: number; y: number; z: number; s: number };
export type Lamp = { x: number; y: number; z: number };

const PAINTED = ["#f0d9c4", "#e9c7b0", "#d8e0d0", "#cfdbe3", "#f2e6c9", "#e6cfd6", "#d9cbb8", "#f4ede1", "#c9d7cf", "#e8d3a8"];
const TRIMS = ["#fbf7ef", "#f3ece0", "#e8e1d4"];
const STONE = ["#e3d9c8", "#d6cbb7", "#cfc4b0", "#e9e1d3"];
const GLASS = ["#9fb0bf", "#8fa3b4", "#a9b6c0"];

const fits = (x: number, z: number, w: number, d: number, h: number) =>
  [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2]].every(([a, b]) => insideLand(a, b)) &&
  CLEAR.every(([cx, cz, r]) => Math.hypot(x - cx, z - cz) >= r) &&
  !blocksView(x, z, heightAt(x, z) + h, Math.max(w, d) / 2);

const isPark = (x: number, z: number) => PARKS.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
/** Financial District down through SoMa. */
const isDowntown = (x: number, z: number) => x > -3 && x < 31 && z > -36 && z < 34;

export function generateCity() {
  const rand = rng(42);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const houses: House[] = [];
  const towers: Tower[] = [];
  const trees: Tree[] = [];
  const lamps: Lamp[] = [];
  const edge = STREET / 2 + SIDEWALK;

  for (let i = 0; i < X_STREETS.length - 1; i++) {
    for (let j = 0; j < Z_STREETS.length - 1; j++) {
      const x0 = X_STREETS[i] + edge;
      const x1 = X_STREETS[i + 1] - edge;
      const z0 = Z_STREETS[j] + edge;
      const z1 = Z_STREETS[j + 1] - edge;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;

      if (isPark(cx, cz)) {
        for (let k = 0; k < 14; k++) {
          const x = x0 + rand() * (x1 - x0);
          const z = z0 + rand() * (z1 - z0);
          if (insideLand(x, z) && !blocksView(x, z, heightAt(x, z) + 2.6, 1)) trees.push({ x, y: heightAt(x, z), z, s: 0.8 + rand() * 0.6 });
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
          if (!fits(x, cz, tw, td, h)) continue;
          const tiers: Tier[] = [{ w: tw, d: td, y: 0, h: h > 14 ? h * 0.6 : h }];
          if (h > 14) tiers.push({ w: tw * 0.78, d: td * 0.78, y: h * 0.6, h: h > 22 ? h * 0.25 : h * 0.4 });
          if (h > 22) tiers.push({ w: tw * 0.56, d: td * 0.56, y: h * 0.85, h: h * 0.15 });
          const glass = rand() < 0.5;
          towers.push({ x, y: heightAt(x, cz), z: cz, w: tw, d: td, h, glass, color: glass ? pick(GLASS) : pick(STONE), tiers });
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
          const h = floors * 2.2 + 0.5;
          const hx = x + w / 2;
          if (fits(hx, z, w, depth, h)) {
            houses.push({
              x: hx, y: heightAt(hx, z), z, w, d: depth, h, facing,
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

  // Street trees and lamps along the east-west streets.
  // Cuso walks the WALK_Z streets: keep their sidewalks clear.
  for (const sz of Z_STREETS.filter((z) => !WALK_Z.includes(z))) {
    for (let x = -64; x < 29; x += 4) {
      for (const side of [-1, 1]) {
        const z = sz + side * (STREET / 2 + SIDEWALK / 2);
        if (!insideLand(x, z) || isDowntown(x, z) || CLEAR.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
        if (X_STREETS.some((sx) => Math.abs(x - sx) < STREET)) continue;
        const roll = rand();
        const y = heightAt(x, z);
        if (roll < 0.35 && !blocksView(x, z, y + 2.6, 0.9)) trees.push({ x, y, z, s: 0.55 + rand() * 0.25 });
        else if (roll > 0.82 && !blocksView(x, z, y + 3, 0.2)) lamps.push({ x, y, z });
      }
    }
  }

  return { houses, towers, trees, lamps };
}

/** Land bounds, for the ground texture. */
export const LAND_BOUNDS = { minX: -90, maxX: 45, minZ: -60, maxZ: 52 };

/** The generated city, computed once. */
export const CITY = generateCity();

type Box = { minX: number; maxX: number; minZ: number; maxZ: number; top: number };

/** Solid boxes the camera must not enter: every building plus landmark buildings. */
export const OBSTACLES: Box[] = [
  ...[...CITY.houses, ...CITY.towers].map((b) => ({ minX: b.x - b.w / 2, maxX: b.x + b.w / 2, minZ: b.z - b.d / 2, maxZ: b.z + b.d / 2, top: b.y + b.h + 0.6 })),
  { minX: -17.5, maxX: -10.5, minZ: -13.4, maxZ: -7.4, top: heightAt(-14, -10.4) + 8.5 }, // Russian Hill rooftop
  { minX: -15, maxX: -7, minZ: 7, maxZ: 11.6, top: heightAt(-11, 9.3) + 6.8 }, // Hayes Valley shop
  { minX: 3.5, maxX: 10.5, minZ: 6.4, maxZ: 11.6, top: heightAt(7, 9) + 9.6 }, // Union Square + billboard
  { minX: -6, maxX: -5.4, minZ: 26.4, maxZ: 31.6, top: 5.4 }, // Mission wall
];

/** True if a point is inside a building. */
export const insideBuilding = (x: number, y: number, z: number) =>
  OBSTACLES.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.top);
