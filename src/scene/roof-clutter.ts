// Rooftop clutter: HVAC units, vents, stair bulkheads, skylights and TV
// antennas on the flat roofs, so the city reads lived-in from above. Pure and
// seeded with its own rng (never the layout's), so it is testable and the
// same on every visit. Drawn by clutter.tsx.
//
// Restrained: a few items on some roofs. Towers get them on the top of their
// highest tier, beside the parts towers.tsx already puts there (every flat
// stone or brick top already has its water tank); row houses on the flat tar
// roof behind the false front (gables carry nothing). Nothing on a roof edge,
// a chimney, near a spot where Cuso stands, or in a chapter shot.

import { chapters } from "@/content/day";
import { BODY_DEPTH, H, W } from "./house-models";
import { CITY, HOUSE_GAP, type House, type Tower } from "./layout";
import { towerPieces, towerStyle } from "./towers";

const KINDS = ["hvac", "vent", "bulkhead", "skylight", "antenna"] as const;
export type Kind = (typeof KINDS)[number];
/** Phones: only the items big enough to read from their cameras. */
export const LITE_KINDS: readonly Kind[] = ["hvac", "bulkhead", "skylight"];

/** Footprint (w along x, d along z, before a quarter turn) and height of each kind. */
export const SIZE: Record<Kind, { w: number; d: number; h: number }> = {
  hvac: { w: 0.5, d: 0.34, h: 0.3 },
  vent: { w: 0.12, d: 0.12, h: 0.26 },
  bulkhead: { w: 0.76, d: 0.62, h: 0.78 },
  skylight: { w: 0.5, d: 0.36, h: 0.16 },
  antenna: { w: 0.38, d: 0.06, h: 0.8 },
};

type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Roof = Rect & {
  /** The roof's height, where items stand. */
  y: number;
  /** What already stands there (grown by a little air). */
  taken: Rect[];
  on: { tower: Tower } | { house: House };
};
/** `turn`: a quarter turn (w runs along z). `roof`: index into roofs(). */
export type Item = { kind: Kind; x: number; y: number; z: number; turn: boolean; roof: number };

/** Air between items, and around the parts already on a roof. */
const GAP = 0.12;
/** Usable roof stops this far inside a parapet, a metal rim or a side wall. */
const EDGE = 0.15;
/** Behind a house's false front and its cornice. */
const FRONT = 0.4;
/** No clutter on a building this close to any spot where Cuso stands. */
const SPOT_CLEAR = 4;

const rect = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const shrink = (r: Rect, by: number): Rect => ({ x0: r.x0 + by, x1: r.x1 - by, z0: r.z0 + by, z1: r.z1 - by });
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const inside = (a: Rect, b: Rect) => a.x0 >= b.x0 && a.x1 <= b.x1 && a.z0 >= b.z0 && a.z1 <= b.z1;

export function footprint({ kind, x, z, turn }: Pick<Item, "kind" | "x" | "z" | "turn">): Rect {
  const { w, d } = SIZE[kind];
  return turn ? rect(x, z, d, w) : rect(x, z, w, d);
}

/** Same test as layout.ts blocksView, over every chapter's desktop and phone shot. */
function blocksShot(x: number, z: number, h: number, r: number) {
  return chapters.some((c) =>
    [c.camera, c.phone].some(({ position: p, target: q }) => {
      for (let s = 0; s <= 1.0001; s += 0.04) {
        const px = p[0] + (q[0] - p[0]) * s;
        const py = p[1] + (q[1] - p[1]) * s;
        const pz = p[2] + (q[2] - p[2]) * s;
        if (Math.hypot(px - x, pz - z) < r + 1.2 && py < h + 0.8) return true;
      }
      return false;
    }),
  );
}

const nearSpot = (r: Rect) =>
  chapters.some(({ spot: [x, , z] }) => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1)) < SPOT_CLEAR);

/** The top of a flat-crowned tower: inside its parapet (stone, brick) or metal rim (glass), less what towers.tsx put there. */
function towerRoof(t: Tower): Roof | null {
  const s = towerStyle(t);
  if (s.crown !== "flat") return null;
  const top = t.tiers[t.tiers.length - 1];
  const y = t.y + top.y + top.h;
  // towers.tsx: glass rooftops use the roof 0.25 in; parapets stand on the wall (inset) and are 0.14 thick.
  const usable = shrink(rect(t.x, t.z, top.w, top.d), (s.style === "glass" ? 0.25 : s.inset + 0.14) + EDGE);
  const parts = towerPieces(t, false).filter((p) => p.group !== undefined);
  const taken = parts.map((p) => shrink({ x0: p.min[0], x1: p.max[0], z0: p.min[2], z1: p.max[2] }, -GAP));
  return { ...usable, y, taken, on: { tower: t } };
}

/** A row house's flat tar roof (house-models.ts bodyGeometry: at H - 0.18, chimney at the back). */
function houseRoof(h: House): Roof | null {
  if (h.roof !== "flat") return null;
  const s = (h.w - HOUSE_GAP) / W;
  const zs = h.d / BODY_DEPTH;
  const front = h.z + (h.facing * h.d) / 2;
  const back = h.z - (h.facing * h.d) / 2;
  const [za, zb] = [front - h.facing * FRONT, back + h.facing * EDGE];
  const half = (h.w - HOUSE_GAP) / 2 - EDGE;
  // The chimney: model x 0.85..1.2, z -2.15..-1.8 (the model turns half round on a north-facing house).
  const cx = [0.85, 1.2].map((x) => h.x + h.facing * x * s);
  const cz = [-2.15, -1.8].map((z) => front + h.facing * z * zs);
  const chimney = shrink({ x0: Math.min(...cx), x1: Math.max(...cx), z0: Math.min(...cz), z1: Math.max(...cz) }, -GAP);
  return { x0: h.x - half, x1: h.x + half, z0: Math.min(za, zb), z1: Math.max(za, zb), y: h.y + (H - 0.18) * s, taken: [chimney], on: { house: h } };
}

/** Every roof that may carry clutter, towers first. */
export function roofs(): Roof[] {
  return [...CITY.towers.map(towerRoof), ...CITY.houses.map(houseRoof)].filter((r): r is Roof => r !== null && !nearSpot(r));
}

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** What a roof asks for, in order (the first that fits is placed first). */
function wants(roof: Roof, rand: () => number): Kind[] {
  if ("tower" in roof.on) {
    const s = towerStyle(roof.on.tower);
    const out: Kind[] = ["hvac"];
    if (rand() < 0.5) out.push("hvac");
    if (rand() < 0.6) out.push("vent");
    if (s.style === "loft" && rand() < 0.5) out.push("skylight");
    return out.slice(0, 3);
  }
  if (rand() < 0.55) return [];
  const pick = (): Kind => {
    const r = rand();
    return r < 0.3 ? "vent" : r < 0.6 ? "skylight" : r < 0.75 ? "hvac" : r < 0.9 ? "antenna" : "bulkhead";
  };
  const first = pick();
  const second = rand() < 0.4 ? pick() : null;
  return second && second !== first ? [first, second] : [first];
}

/** The clutter on every roof. Lite: the same items, less the small ones. */
export function roofClutter(lite: boolean): Item[] {
  const rand = rng(2718);
  const out: Item[] = [];
  roofs().forEach((roof, index) => {
    const placed: Rect[] = [];
    for (const kind of wants(roof, rand)) {
      const { w, d, h } = SIZE[kind];
      for (let tries = 0; tries < 20; tries++) {
        const turn = rand() < 0.5;
        const [fw, fd] = turn ? [d, w] : [w, d];
        const x = roof.x0 + fw / 2 + rand() * (roof.x1 - roof.x0 - fw);
        const z = roof.z0 + fd / 2 + rand() * (roof.z1 - roof.z0 - fd);
        const f = rect(x, z, fw, fd);
        if (!inside(f, roof) || roof.taken.some((t) => overlap(f, t)) || placed.some((p) => overlap(f, shrink(p, -GAP)))) continue;
        if (blocksShot(x, z, roof.y + h, Math.max(w, d) / 2)) continue;
        placed.push(f);
        out.push({ kind, x, y: roof.y, z, turn, roof: index });
        break;
      }
    }
  });
  return lite ? out.filter((it) => LITE_KINDS.includes(it.kind)) : out;
}
