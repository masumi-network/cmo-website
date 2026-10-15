// Where the parked cars go (drawn by parked.tsx). Pure and seeded with its own
// random numbers, never the layout's. A car stands on the asphalt a few
// centimetres off the kerb, the way the traffic goes on its side (right-hand),
// with gaps between cars. Only on streets no car drives, never on Cuso's way
// (on a street he walks, the far side) nor by the cable car rails, a car
// length or so from every junction (so off the crosswalks and curb
// ramps), never in front of a garage or a hydrant, clear of the landmarks and
// never between a chapter's camera and its subject.

import { chapters } from "@/content/day";
import { heightAt, surfaceAt } from "@/lib/terrain";
import { CABLE_RAILS, EDGE, KERB, LAND_BOUNDS, STREET, WALK_X, WALK_Z, X_STREETS, Z_STREETS, groundAt, insideLand, streetDrop } from "./grid";
import { VARIANTS } from "./house-models";
import { variantOf } from "./houses";
import { CITY, CLEAR } from "./layout";
import { onRoad } from "./roads";
import { PATHS } from "./routes";
import { MODELS, makeTraffic, type CarType } from "./traffic";

export type ParkedCar = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number; type: CarType; color: string; lite: boolean };

/** Calm paints: pearl white, stealth grey, solid black, quicksilver, deep blue (white and grey most often). */
export const PARKED_PAINTS = ["#e9e8e3", "#3d4045", "#0f1012", "#a2a5a8", "#1d3563"];
const PAINT_ODDS = [0.3, 0.24, 0.18, 0.18, 0.1];
/** Mostly Model 3s and Ys, the odd Cybertruck. */
const TYPE_ODDS: [CarType, number][] = [["model3", 0.46], ["modely", 0.46], ["cybertruck", 0.08]];

/** How often a free spot along a kerb gets a car, and the gap before the next spot. */
const FILL = 0.9;
const GAP = [0.6, 2.2] as const;
/** The body (without the mirrors) is this much of a model's width; it stands this far off the kerb. */
const BODY = 0.89;
const KERB_GAP = [0.05, 0.12] as const;
/** A car's ends stay this far from the cross street's centre line: past its sidewalk and crosswalk. */
const SETBACK = EDGE + 1;
/** Cable car rails [x0, x1, z]: the Union Square line and the California St rails by the Ferry Building (ferry.tsx). */
export const RAILS: [number, number, number][] = [...CABLE_RAILS, [6, 28, 4]];
/** Phones get about half the cars. */
const LITE_SHARE = 0.5;

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const pickBy = <T,>(rand: () => number, items: T[], odds: number[]) => {
  let r = rand();
  for (let i = 0; i < items.length; i++) if ((r -= odds[i]) < 0) return items[i];
  return items[items.length - 1];
};

/** How far a point is from a car's footprint (0 inside): its centre, heading (sin, cos of yaw), length and width. */
function away(c: { x: number; z: number; yaw: number }, length: number, width: number, x: number, z: number) {
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const along = (x - c.x) * fx + (z - c.z) * fz;
  const side = (x - c.x) * fz - (z - c.z) * fx;
  return Math.hypot(Math.max(0, Math.abs(along) - length / 2), Math.max(0, Math.abs(side) - width / 2));
}

/** Points every ~`step` along a run of [x, z] points. */
function dense(points: [number, number][], step: number): [number, number][] {
  return points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  });
}

/** Whether something at x, z (top `h`, reach `r`) gets between any chapter's camera, desktop or phone, and its subject. */
function inShot(x: number, z: number, h: number, r: number) {
  return chapters.some((ch) =>
    [ch.camera, ch.phone].some(({ position: p, target: q }) => {
      for (let s = 0; s <= 1.0001; s += 0.02) {
        if (Math.hypot(p[0] + (q[0] - p[0]) * s - x, p[2] + (q[2] - p[2]) * s - z) < r + 1.2 && p[1] + (q[1] - p[1]) * s < h + 0.8) return true;
      }
      return false;
    }),
  );
}

/** Every parked car in the city. */
export function parkCars(): ParkedCar[] {
  const rand = rng(2718);
  // What must stay clear: every moving car's route, Cuso's day, the hydrants and the garage doors.
  const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
  const lanes = [...new Set(makeTraffic().map((t) => t.path))]
    .flatMap((p) => Array.from({ length: p.pts.length / 2 }, (_, i): [number, number] => [p.pts[i * 2], p.pts[i * 2 + 1]]))
    .filter(([x, z]) => x > minX && x < maxX && z > minZ && z < maxZ);
  const route = PATHS.flatMap(({ points }) => dense(points.map(([x, , z]) => [x, z]), 0.25));
  const rails = RAILS.flatMap(([x0, x1, z]) => dense([[x0 - 2, z], [x1 + 2, z]], 0.25));
  const hydrants = CITY.hydrants.map((f): [number, number] => [f.x, f.z]);
  // In front of a garage: the street just off its kerb, the house's width.
  const garages = CITY.houses
    .filter((h, i) => VARIANTS[variantOf(h, i)].garage)
    .flatMap((h) => {
      const z = h.z + h.facing * (h.d / 2 + (EDGE - STREET / 2) + 0.8);
      return dense([[h.x - h.w / 2, z], [h.x + h.w / 2, z]], 0.25);
    });

  const out: ParkedCar[] = [];
  const free = (c: { x: number; z: number; yaw: number }, length: number, width: number) => {
    const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
    // the body on the asphalt (the mirrors may reach over the kerb)
    for (let a = -0.5; a <= 0.5001; a += 1 / 8) {
      for (let b = -0.5; b <= 0.5001; b += 1 / 2) {
        const [x, z] = [c.x + fx * a * length + fz * b * width * BODY, c.z + fz * a * length - fx * b * width * BODY];
        if (!insideLand(x, z) || groundAt(x, z) !== "street" || streetDrop(x, z) !== KERB || onRoad(x, z)) return false;
      }
    }
    const near = (pts: [number, number][], d: number) => pts.some(([x, z]) => Math.abs(x - c.x) < d + length && Math.abs(z - c.z) < d + length && away(c, length, width, x, z) <= d);
    // a gap to every other parked car (they are square to the streets, so their boxes will do)
    const box = (o: { yaw: number }, l: number, w: number) => (Math.abs(Math.sin(o.yaw)) < 0.5 ? [w / 2, l / 2] : [l / 2, w / 2]);
    const [ex, ez] = box(c, length, width);
    const apart = out.every((o) => {
      const [ox, oz] = box(o, MODELS[o.type].length, MODELS[o.type].width);
      return Math.abs(o.x - c.x) > ex + ox + 0.6 || Math.abs(o.z - c.z) > ez + oz + 0.6;
    });
    return (
      apart &&
      !near(lanes, 1.4) &&
      !near(route, 1.2) &&
      !near(rails, 1.6) &&
      !near(hydrants, 1.2) &&
      !near(garages, 0.4) &&
      chapters.every(({ spot }) => Math.hypot(c.x - spot[0], c.z - spot[2]) > 6) &&
      CLEAR.every(([x, z, r]) => Math.hypot(c.x - x, c.z - z) > r + length / 2 + 0.2) &&
      !inShot(c.x, c.z, surfaceAt(c.x, c.z) + 1.1, length / 2)
    );
  };

  /** One kerb: the street's centre line `centre`, along x or z from a0 to a1, on side ±1. */
  const kerb = (alongZ: boolean, centre: number, a0: number, a1: number, side: 1 | -1) => {
    // right-hand traffic: the south kerb faces east, the north kerb west; the west kerb faces south, the east kerb north
    const yaw = alongZ ? (side < 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    let at = a0 + rand() * GAP[1];
    for (;;) {
      const type = pickBy(rand, TYPE_ODDS.map(([t]) => t), TYPE_ODDS.map(([, p]) => p));
      const { length, width } = MODELS[type];
      if (at + length > a1) return;
      const use = rand() < FILL;
      const offset = STREET / 2 - KERB_GAP[0] - rand() * (KERB_GAP[1] - KERB_GAP[0]) - (width * BODY) / 2;
      const along = at + length / 2;
      const c = { x: alongZ ? centre + side * offset : along, z: alongZ ? along : centre + side * offset, yaw: yaw + (rand() - 0.5) * 0.03 };
      const color = pickBy(rand, PARKED_PAINTS, PAINT_ODDS);
      const lite = rand() < LITE_SHARE;
      if (use && free(c, length, width)) out.push({ ...c, ...tilt(c, MODELS[type]), type, color, lite });
      at += length + GAP[0] + rand() * (GAP[1] - GAP[0]);
    }
  };

  const streets = (lines: number[], cross: number[], alongZ: boolean) => {
    for (const centre of lines) {
      // On a street Cuso walks only the far side: his walking line is on the south or east side, on the waterfront (x 29) the west (routes.ts).
      const walk = (alongZ ? WALK_X : WALK_Z).includes(centre);
      const sides = ([-1, 1] as const).filter((side) => !walk || side === (alongZ && centre === 29 ? 1 : -1));
      for (let i = 0; i < cross.length - 1; i++) for (const side of sides) kerb(alongZ, centre, cross[i] + SETBACK, cross[i + 1] - SETBACK, side);
    }
  };
  streets(X_STREETS, Z_STREETS, true);
  streets(Z_STREETS, X_STREETS, false);
  return out;
}

/** Height and tilt on the street: wheels on the asphalt, tilted with the hill. */
function tilt(c: { x: number; z: number; yaw: number }, { wheelbase, width }: { wheelbase: number; width: number }) {
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const half = wheelbase / 2;
  const hb = surfaceAt(c.x - fx * half, c.z - fz * half);
  const hf = surfaceAt(c.x + fx * half, c.z + fz * half);
  // the wheel tracks, both on the street (a positive roll lifts the left side)
  const w = (width * BODY) / 2 - 0.1;
  const roll = Math.atan2(heightAt(c.x + fz * w, c.z - fx * w) - heightAt(c.x - fz * w, c.z + fx * w), 2 * w);
  return { y: (hf + hb) / 2, pitch: -Math.atan2(hf - hb, wheelbase), roll };
}
