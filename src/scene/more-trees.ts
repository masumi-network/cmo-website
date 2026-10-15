// A few more street trees, like the concepts: on the north-south streets
// (past the houses' side walls), a few more on the east-west ones where no
// house front is (stoops and garages keep their sidewalk), palms in the
// Mission. The parks are full already. Pure and seeded with its own rng: the layout's rng is never
// touched (that would reshuffle the towers). trees.tsx draws them in the same
// two batches as layout.ts's trees. Phones get every other one.
// Dev only: `?moretrees=off` shows the city without them (A/B screenshots).

import { chapters } from "@/content/day";
import { PLAZA, heightAt } from "@/lib/terrain";
import { CABLE_RAILS, EDGE, SIDEWALK, STREET, WALK_X, WALK_Z, X_STREETS, Z_STREETS, groundAt, insideLand, streetDrop } from "./grid";
import { CITY, CLEAR, OBSTACLES } from "./layout";
import { onRoad } from "./roads";
import { PATHS } from "./routes";
import { CROWN_RADIUS, CROWN_TOP, PIT, SPREAD, kindOf, type Kind, type Tree } from "./tree-models";

/** An extra street tree, its kind chosen here (the Mission's are palms). `lite`: phones draw it too. */
export type Planted = Tree & { kind: Kind; lite: boolean };

const OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("moretrees") === "off";

/** Sidewalk centre line, from a street's centre. */
const CURB = STREET / 2 + SIDEWALK / 2;
/** The Mission, where Dolores Street's palms are: street trees here are palms. */
const MISSION = { x0: -21, x1: 0, z0: 19 };

/** How far a tree's crown reaches from its trunk. */
export const reachOf = (t: Tree & { kind?: Kind }) => CROWN_RADIUS[t.kind ?? kindOf(t)] * t.s * (1 + SPREAD);

/** Cuso's whole day in x and z, every 0.25. */
const ROUTE: [number, number][] = PATHS.flatMap(({ points }) =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);
const FURNITURE = [...CITY.lamps, ...CITY.hydrants, ...CITY.signs];
const SHOTS = chapters.flatMap((c) => [c.camera, c.phone]);

/** True if a crown (reach r, top at `top`) gets between any chapter's camera, desktop or phone, and its subject. */
function inShot(x: number, z: number, top: number, r: number) {
  return SHOTS.some(({ position: p, target: q }) => {
    for (let s = 0; s <= 1.0001; s += 0.02) {
      const [px, py, pz] = [0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * s);
      if (Math.hypot(px - x, pz - z) < r + 1.2 && py < top + 0.5) return true;
    }
    return false;
  });
}

/** A house front faces the sidewalk here: its stoop, entry or garage needs it. */
const frontsHouse = (x: number, z: number) =>
  CITY.houses.some((h) => {
    const out = (z - (h.z + (h.facing * h.d) / 2)) * h.facing;
    return Math.abs(x - h.x) < h.w / 2 + 0.5 && out > -0.1 && out < SIDEWALK + 0.4;
  });

/** Everything a tree must keep clear of, besides other trees. */
function free(t: Tree & { kind?: Kind }) {
  const { x, z } = t;
  const r = reachOf(t);
  const [rx0, rx1, rz] = CABLE_RAILS[0];
  return (
    insideLand(x, z) &&
    CLEAR.every(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) >= cr) &&
    !(x > PLAZA.x0 - 1.2 && x < PLAZA.x1 + 1.2 && z > PLAZA.z0 - 1.2 && z < PLAZA.z1 + 1.2) &&
    !OBSTACLES.some((b) => x > b.minX - 0.4 && x < b.maxX + 0.4 && z > b.minZ - 0.4 && z < b.maxZ + 0.4) &&
    FURNITURE.every((f) => Math.hypot(f.x - x, f.z - z) > 1.3) &&
    ROUTE.every(([px, pz]) => Math.hypot(px - x, pz - z) > Math.max(1.4, r + 0.6)) &&
    chapters.every(({ spot }) => Math.hypot(spot[0] - x, spot[2] - z) > 2.2) &&
    Math.hypot(Math.max(rx0 - x, 0, x - rx1), z - rz) > STREET / 2 + r + 0.2 &&
    [0, 1, 2, 3, 4, 5, 6, 7].every((a) => !onRoad(x + Math.cos(a) * 1.6, z + Math.sin(a) * 1.6)) &&
    !onRoad(x, z) &&
    !inShot(x, z, t.y + CROWN_TOP * t.s, r)
  );
}

/** On a sidewalk, its grate wholly on it and off the curb ramps, not on a walking street, in front of no house. */
const sidewalkSpot = (x: number, z: number) =>
  [-1, 1].every((a) => [-1, 1].every((b) => groundAt(x + (a * PIT) / 2, z + (b * PIT) / 2) === "sidewalk" && streetDrop(x + (a * PIT) / 2, z + (b * PIT) / 2) === 0)) &&
  WALK_X.every((w) => Math.abs(x - w) >= EDGE) &&
  WALK_Z.every((w) => Math.abs(z - w) >= EDGE) &&
  // not on a corner: lamps, ramps and crossings
  X_STREETS.every((s) => Math.abs(x - s) > EDGE + 0.6 || Z_STREETS.every((t) => Math.abs(z - t) > EDGE + 0.6)) &&
  !frontsHouse(x, z);

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

export function moreTrees(): Planted[] {
  const rand = rng(1913);
  const out: Omit<Planted, "lite">[] = [];
  const all = () => [...CITY.trees, ...out];
  const spaced = (x: number, z: number, gap: number) => all().every((o) => Math.hypot(o.x - x, o.z - z) > gap);
  const plantStreet = (x: number, z: number, chance: number) => {
    const [roll, pick, size] = [rand(), rand(), rand()];
    if (roll > chance) return;
    const palm = x > MISSION.x0 && x < MISSION.x1 && z > MISSION.z0;
    const kind: Kind = palm ? "palm" : pick < 0.6 ? "plane" : "ficus";
    const t = { x, y: heightAt(x, z), z, s: palm ? 0.62 + size * 0.2 : 0.55 + size * 0.22, kind };
    if (sidewalkSpot(x, z) && spaced(x, z, 2.4) && free(t)) out.push(t);
  };

  // North-south streets: one tree mid-block on each sidewalk, most blocks.
  for (const s of X_STREETS.filter((x) => !WALK_X.includes(x))) {
    for (let j = 0; j < Z_STREETS.length - 1; j++) {
      for (const side of [-1, 1]) plantStreet(s + side * CURB, (Z_STREETS[j] + Z_STREETS[j + 1]) / 2 + (rand() - 0.5) * 1.2, 0.7);
    }
  }
  // East-west streets: a few more between the city's own, where no house front is.
  for (const t of Z_STREETS.filter((z) => !WALK_Z.includes(z))) {
    for (let x = -66; x < 30; x += 2) {
      for (const side of [-1, 1]) plantStreet(x + (rand() - 0.5) * 0.6, t + side * CURB, 0.45);
    }
  }
  // Phones: every other one.
  return out.map((t, i) => ({ ...t, lite: i % 2 === 0 }));
}

/** The extra trees, computed once. */
export const MORE_TREES = moreTrees();

const FULL = [...CITY.trees, ...MORE_TREES];
const LITE = [...CITY.trees, ...MORE_TREES.filter((t) => t.lite)];

/** Every tree <Trees> draws: the city's own, then the extra ones (phones: half of them). One stable list each. */
export const cityTrees = (lite: boolean): (Tree & { kind?: Kind })[] => (OFF ? CITY.trees : lite ? LITE : FULL);
