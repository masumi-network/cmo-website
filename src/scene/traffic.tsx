"use client";

// A few Teslas: mostly Model 3s and Model Ys, the odd Cybertruck and Roadster.
// Three loops run clockwise on the inner lane: two round city blocks, and the
// Roadster's long way round the west of the city. A few more cars come over the
// bridges: out of the Yerba Buena tunnel or the Marin fog, over the deck and
// down the approach, a lap of the nearest city loop, and back the way they
// came, turning round out of sight. Cars turn like real ones (the rear axle
// follows the lane, the nose swings wide), slow down for a corner and pull
// away after it, follow the hills and the road decks, keep their distance,
// take turns at the junctions where routes meet and stop for Cuso. The models
// come from scripts/convert-cars.mjs.

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Frustum,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Sphere,
  type BufferGeometry,
  type InstancedMesh,
  type Mesh,
} from "three";
import type { Vec3 } from "@/content/day";
import { MARIN_ROAD, heightAt, surfaceAt } from "@/lib/terrain";
import { DECKS, ROADS, ROAD_WIDTH, onRoad } from "./roads";
import { SHADOW_REACH } from "./parts";
import { DETAIL, rig, useNightGlow } from "./shared";

// ---------------------------------------------------------------------------
// Layout and driving (pure, tested in tests/unit/traffic.test.ts)

/**
 * The models at city scale (Cuso is ~1.9 units tall, a lane is 1.5 wide).
 * Metres are the GLB's own size (its node extras, checked by a test): length,
 * width over mirrors and wheels, wheelbase. The Cybertruck is scaled down a
 * little so it still fits its lane (mirrors included).
 */
const model = (url: string, scale: number, metres: { length: number; width: number; wheelbase: number }) => ({
  url,
  /** Phones: the same car simplified to half a phone pixel (`convert-cars.mjs --lite`), a third to a half of the triangles. */
  liteUrl: url.replace("/cars/", "/cars/lite/"),
  metres,
  scale,
  length: metres.length * scale,
  width: metres.width * scale,
  wheelbase: metres.wheelbase * scale,
});
export const MODELS = {
  model3: model("/models/cars/model3.glb", 0.68, { length: 4.72, width: 2.088, wheelbase: 2.876 }),
  modely: model("/models/cars/modely.glb", 0.68, { length: 4.79, width: 2.125, wheelbase: 2.902 }),
  cybertruck: model("/models/cars/cybertruck.glb", 0.62, { length: 5.683, width: 2.382, wheelbase: 3.643 }),
  roadster: model("/models/cars/roadster.glb", 0.68, { length: 4.627, width: 1.891, wheelbase: 2.922 }),
};
export type CarType = keyof typeof MODELS;
const TYPES = Object.keys(MODELS) as CarType[];

const LANE = 0.75;
const STEP = 0.1;
const DEG = Math.PI / 180;

/**
 * How a car takes a square city corner. The route is the path of its rear
 * axle, and the car points along it, so the front swings wide and the rear
 * cuts in, like a real car. The steering winds on over `on` and back off over
 * `off` (the curvature rises and falls as half cosines), so the body never
 * snaps round. Right turns wind on quickly at the corner and unwind slowly,
 * clear of the kerb. A left turn is gentler and comes out `cut` short of its
 * lane, over the centre line, then drifts back over `merge` (12 units, or less
 * where the next corner comes sooner): a car this long can't swing left into
 * a 1.5 wide lane without its nose over the far kerb.
 */
const RIGHT = { on: 0.8, off: 2, cut: 0 };
const LEFT = { on: 4.8, off: 4.8, cut: 0.6 };

/**
 * Speed: through a bend no faster than GRIP allows (sideways acceleration,
 * units a second squared), braking at most BRAKE before it and pulling away at
 * most PULL after it. A tight corner takes about 1.1 units a second.
 */
const GRIP = 1.2;
const BRAKE = 1.6;
const PULL = 1.2;

/**
 * A closed route, sampled every ~STEP units: x, z in `pts`, the way it runs
 * there in `dirs` (unit x, z) and the fastest a car may go there in `pace`.
 * A car pivots on the route: `pivot` is where along its wheelbase, as a
 * fraction. On city streets it is the rear axle (0), so a car turns a corner
 * like a real one, front swinging wide. On the bridge roads it is the middle
 * (0.5): their lanes are as narrow as the cars, and a nose swinging out in
 * their long bends would brush the oncoming lane. Bridge routes also keep the
 * road surface height (`ys`; NaN on city streets, where the ground is
 * surfaceAt, a kerb below the sidewalks). `zones` has, per point, the
 * junctions it is in (bit k: ZONES[k]).
 */
export type Path = { pts: Float32Array; dirs: Float32Array; pace: Float32Array; pivot: Float32Array; length: number; ys?: Float32Array; zones: Uint16Array };
export type Car = { path: Path; offset: number; speed: number; color: string; type: CarType };
export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

/** Tesla paints: pearl white, solid black, stealth grey, quicksilver, deep blue, ultra red. */
const PAINTS = ["#e9e8e3", "#0f1012", "#3d4045", "#a2a5a8", "#1d3563", "#a3151d"];
const [WHITE, BLACK, GREY, SILVER, BLUE] = PAINTS;
/** Which model each city car is, in order: the Cybertruck in quicksilver, the Roadster in red. */
const LINEUP: CarType[] = ["modely", "model3", "modely", "cybertruck", "model3", "roadster", "modely"];

/** A loop round blocks of car streets: its corners [x, z], clockwise, so it keeps to the inner lane. */
const block = (x0: number, x1: number, z0: number, z1: number): [number, number][] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

/**
 * Loops the cars circle, clockwise on car streets (round the outside of a
 * convex corner a car turns right, round an inside one left), and how many
 * cars each. Where a loop meets another one's corner, the cars take turns
 * there (ZONES): two cars turning at one corner would touch.
 */
export const LOOPS: { ring: [number, number][]; cars: number }[] = [
  { ring: block(-19, 13, -16, 34), cars: 5 }, // below Russian Hill, past Union Square and SoMa, back by the Mission wall
  // The Roadster's long way round: North Beach, down the Russian Hill side to the Mission, west under Twin Peaks,
  // up the Sunset to Golden Gate Park, and north up the Haight and Pacific Heights side.
  { ring: [[-35, -26], [-19, -26], [-19, 44], [-51, 44], [-51, 24], [-35, 24]], cars: 1 },
  { ring: block(-51, -35, -26, -16), cars: 1 }, // Pacific Heights
];

/**
 * Junctions where routes meet, and tight bends, [x, z, radius]: a car is in
 * one while its centre is this close. A car goes in only when no other car is
 * in it, nor in the next one along its way (it never waits inside one).
 */
const ZONES: [number, number, number][] = [
  [13, 14, 4.5], // the Bay Bridge ramp lands on the downtown loop
  [-57, -35.5, 10], // Golden Gate cars turn off and back onto the Marina street (and drift back into their lane) ...
  [-51, -26, 5.5], // ... and join the Pacific Heights loop
  [-74, -42, 8], // the Golden Gate approach's tight bend: two cars side by side there would touch
  [-80, -160.5, 9], // the Marin road's S bend just off the deck: the same
  [22, 14, 8], // a car up the Bay Bridge ramp drifts back into its lane after its left turn
  // The Roadster's loop turns at the Pacific Heights loop's corner and passes its next one, and passes both of the
  // downtown loop's corners on x -19. Wide, so a car waiting to go in stands clear of a nose swinging round the corner.
  [-35, -26, 6.5],
  [-35, -16, 6.5],
  [-19, -16, 6.5],
  [-19, 34, 6.5],
];
/** How far ahead a car makes sure the junctions are clear before it goes in. */
const CLEAR = 15;

/** Where the Yerba Buena tunnel starts (the Bay Bridge's east road ends in it). */
const PORTAL = ROADS.find((road) => road.tunnel)!.points.at(-1)!;
/** The Marin road goes out into the fog north of here (it ends at z -288). */
const FOG_Z = -282;

/** Out of sight: the whole car past the tunnel portal's dark face, or out in the Marin fog. */
export const outOfSight = (x: number, z: number) => (x > PORTAL[0] + 2.3 && Math.abs(z - PORTAL[2]) < ROAD_WIDTH) || z < FOG_Z;

/** A route point: x, y, z, with y NaN on a city street, and where a car pivots there (0 when not given: its rear axle; see Path). */
type P3 = [number, number, number] | [number, number, number, number];

/** Samples a closed run of points every ~STEP units. */
function resample(raw: P3[]): Path {
  const dense = raw.filter((p, i) => {
    const q = raw[(i + raw.length - 1) % raw.length];
    return Math.hypot(p[0] - q[0], p[2] - q[2]) > 1e-6;
  });
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const [px, , pz] = dense[i - 1];
    const [qx, , qz] = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(qx - px, qz - pz));
  }
  const length = cum[cum.length - 1];
  const n = Math.round(length / STEP);
  const pts = new Float32Array(n * 2);
  const ys = new Float32Array(n);
  const zones = new Uint16Array(n);
  const pivot = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const s = (i * length) / n;
    while (cum[j + 1] < s) j++;
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const [px, py, pz, pp = 0] = dense[j];
    const [qx, qy, qz, qp = 0] = dense[(j + 1) % dense.length];
    const x = (pts[i * 2] = px + (qx - px) * u);
    const z = (pts[i * 2 + 1] = pz + (qz - pz) * u);
    // A road ends tucked just under its street: never below the ground. NaN (a street) stays NaN.
    ys[i] = Math.max(py + (qy - py) * u, surfaceAt(x, z));
    pivot[i] = u < 0.5 ? pp : qp;
    zones[i] = ZONES.reduce((bits, [zx, zz, r], k) => (Math.hypot(x - zx, z - zz) < r ? bits | (1 << k) : bits), 0);
  }
  const dirs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [a, b] = [((i + n - 1) % n) * 2, ((i + 1) % n) * 2];
    const [dx, dz] = [pts[b] - pts[a], pts[b + 1] - pts[a + 1]];
    const d = Math.hypot(dx, dz);
    dirs[i * 2] = dx / d;
    dirs[i * 2 + 1] = dz / d;
  }
  const pace = paceOf(dirs, length / n);
  // The pivot moves from the rear axle to the middle over the first 6 units of a road, and back over its last 6, clear of the turns.
  const EASE = Math.round(6 / STEP);
  const gap = new Float32Array(n).fill(EASE);
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < 2 * n; k++) {
      const i = pass ? (2 * n - 1 - k) % n : k % n;
      const prev = pass ? (i + 1) % n : (i + n - 1) % n;
      gap[i] = pivot[i] === 0 ? 0 : Math.min(gap[i], gap[prev] + 1);
    }
  }
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, gap[i] / EASE);
    pivot[i] *= t * t * (3 - 2 * t);
  }
  return ys.some((y) => !Number.isNaN(y)) ? { pts, dirs, pace, pivot, length, ys, zones } : { pts, dirs, pace, pivot, length, zones };
}

/** The fastest a car may go at each point: GRIP through the bends, braking for them and pulling away after. */
function paceOf(dirs: Float32Array, step: number) {
  const n = dirs.length / 2;
  const pace = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = [((i + n - 1) % n) * 2, ((i + 1) % n) * 2];
    const bend = Math.abs(Math.atan2(dirs[a] * dirs[b + 1] - dirs[a + 1] * dirs[b], dirs[a] * dirs[b] + dirs[a + 1] * dirs[b + 1])) / (2 * step);
    pace[i] = Math.min(99, Math.sqrt(GRIP / Math.max(bend, 1e-6)));
  }
  // twice round, so the limits carry over the loop's seam
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n;
    pace[i] = Math.min(pace[i], Math.sqrt(pace[(i + n - 1) % n] ** 2 + 2 * PULL * step));
  }
  for (let k = 2 * n - 1; k >= 0; k--) {
    const i = k % n;
    pace[i] = Math.min(pace[i], Math.sqrt(pace[(i + 1) % n] ** 2 + 2 * BRAKE * step));
  }
  return pace;
}

/** The runs `turn` makes (chain trims the runs between them, never a turn). */
const TURNS = new WeakSet<P3[]>();

/**
 * A square turn on city streets, from heading `from` to `to` (degrees; 0 is +x
 * east, 90 is +z south) round the point (qx, qz) where the two lanes cross:
 * the rear axle's path (RIGHT or LEFT above), and for a left turn its drift
 * back into the lane.
 */
function turn(qx: number, qz: number, from: number, to: number, merge = 12): P3[] {
  const sign = Math.sign(((to - from + 540) % 360) - 180); // +1 right, -1 left
  const { on, off, cut } = sign > 0 ? RIGHT : LEFT;
  const peak = Math.PI / (on + off); // the half cosines add up to a quarter turn
  /** How far it has turned `u` along the bend. */
  const turned = (u: number) =>
    u < on ? (peak / 2) * (u - (on / Math.PI) * Math.sin((Math.PI * u) / on)) : (peak / 2) * (on + (u - on) + (off / Math.PI) * Math.sin((Math.PI * (u - on)) / off));
  const ds = 0.02;
  const bend: [number, number][] = [[0, 0]];
  for (let u = ds; u < on + off + ds / 2; u += ds) {
    const a = from * DEG + sign * turned(u - ds / 2);
    const [x, z] = bend[bend.length - 1];
    bend.push([x + Math.cos(a) * ds, z + Math.sin(a) * ds]);
  }
  const [ix, iz] = [Math.cos(from * DEG), Math.sin(from * DEG)];
  const [ox, oz] = [Math.cos(to * DEG), Math.sin(to * DEG)];
  const [ex, ez] = bend[bend.length - 1];
  // start where the bend ends on the lane it turns into, `cut` short
  const back = ex * ix + ez * iz + cut;
  const [sx, sz] = [qx - ix * back, qz - iz * back];
  const [fx, fz] = [sx + ex, sz + ez];
  const drift = Array.from({ length: cut ? Math.round(merge / 0.25) : 0 }, (_, k): P3 => {
    const t = ((k + 1) * 0.25) / merge;
    const shift = cut * t * t * t * (10 - 15 * t + 6 * t * t); // smootherstep: no kink at either end
    return [fx + ox * merge * t + ix * shift, NaN, fz + oz * merge * t + iz * shift];
  });
  // up a bridge ramp, the road's height (resample keeps it above the street)
  const run = [...bend.map(([x, z]): P3 => [sx + x, NaN, sz + z]), ...drift].map(([x, , z]): P3 => [x, onRoad(x, z)?.y ?? NaN, z]);
  TURNS.add(run);
  return run;
}

/**
 * Runs of a closed route joined end to end. A turn starts before its corner
 * and ends after it, so the run before it loses the points it would double
 * back over, and the run after it the points the turn already covered.
 */
function chain(...runs: P3[][]): P3[] {
  const along = (p: P3, from: P3, dx: number, dz: number) => (p[0] - from[0]) * dx + (p[2] - from[2]) * dz;
  const near = (p: P3, q: P3) => Math.hypot(p[0] - q[0], p[2] - q[2]) < 25;
  const out = runs.map((run) => (TURNS.has(run) ? run : [...run]));
  out.forEach((run, k) => {
    const next = out[(k + 1) % out.length];
    if (!TURNS.has(run)) {
      const [a, b] = next;
      while (run.length > 1 && near(run[run.length - 1], a) && along(run[run.length - 1], a, b[0] - a[0], b[2] - a[2]) > -0.05) run.pop();
    }
    if (!TURNS.has(next)) {
      const [a, b] = [run[run.length - 2], run[run.length - 1]];
      while (next.length > 1 && near(next[0], b) && along(next[0], b, b[0] - a[0], b[2] - a[2]) < 0.05) next.shift();
    }
  });
  return out.flat();
}

/** The turns of a clockwise loop through `ring`'s corners, on the inner lane: one per corner, in order. */
function corners(ring: [number, number][]): P3[][] {
  return ring.map(([x, z], k) => {
    const [px, pz] = ring[(k + ring.length - 1) % ring.length];
    const [nx, nz] = ring[(k + 1) % ring.length];
    const [ix, iz] = [Math.sign(x - px), Math.sign(z - pz)];
    const [ox, oz] = [Math.sign(nx - x), Math.sign(nz - z)];
    // where the lanes cross: a lane is LANE to the right of its street's centre line
    return turn(x - (iz + oz) * LANE, z + (ix + ox) * LANE, Math.atan2(iz, ix) / DEG, Math.atan2(oz, ox) / DEG);
  });
}

/** The right-hand lane for driving along a road's centre line (the surface is level across), its corners rounded off (Chaikin) so the heading turns smoothly between the road's points. */
function lane(centre: readonly Vec3[]): P3[] {
  const c = centre.filter((p, i) => i === 0 || Math.hypot(p[0] - centre[i - 1][0], p[2] - centre[i - 1][2]) > 1e-6);
  let pts = c.map(([x, y, z], i): P3 => {
    const [a, b] = [c[Math.max(0, i - 1)], c[Math.min(c.length - 1, i + 1)]];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return [x - ((b[2] - a[2]) / len) * LANE, y, z + ((b[0] - a[0]) / len) * LANE];
  });
  const mix = (p: P3, q: P3, t: number): P3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  for (let k = 0; k < 3; k++) pts = [pts[0], ...pts.slice(1).flatMap((q, i) => [mix(pts[i], q, 0.25), mix(pts[i], q, 0.75)]), pts[pts.length - 1]];
  return pts.map(([x, y, z]): P3 => [x, y, z, 0.5]); // on a road a car pivots on its middle
}

/** Round from the lane arriving at `end` (heading tx, tz) to the lane leaving it: a left U-turn, only ever out of sight. */
function uTurn([x, y, z]: Vec3, tx: number, tz: number): P3[] {
  const run = Array.from({ length: 13 }, (_, k): P3 => {
    const a = (k / 12) * Math.PI;
    return [x - tz * LANE * Math.cos(a) + tx * LANE * Math.sin(a), y, z + tx * LANE * Math.cos(a) + tz * LANE * Math.sin(a), 0.5];
  });
  TURNS.add(run);
  return run;
}

const road = (name: string) => ROADS.find((r) => r.name === name)!.points;
const reversed = <T,>(list: readonly T[]) => [...list].reverse();

/**
 * Out of the Yerba Buena tunnel and west over the Bay Bridge, down the ramp to
 * the x 13 junction, left onto the downtown loop and once round it, then left
 * back up the ramp and east into the tunnel, where it turns round.
 */
function bayRoute(): P3[] {
  const [nw, ne, se, sw] = corners(LOOPS[0].ring);
  const x1 = LOOPS[0].ring[1][0];
  const west = road("bay-bridge-west");
  const east = road("bay-bridge-east");
  const inside: Vec3 = [PORTAL[0] + 4, PORTAL[1], PORTAL[2]];
  const jz = west[west.length - 1][2]; // the ramp lands on z 14 at the x 13 junction
  return chain(
    lane([inside, ...reversed(east), ...reversed(DECKS[1].points), ...west]),
    turn(x1 - LANE, jz - LANE, 180, 90),
    se,
    sw,
    nw,
    ne,
    turn(x1 - LANE, jz + LANE, 90, 0),
    lane([...reversed(west), ...DECKS[1].points, ...east, inside]),
    uTurn(inside, 1, 0),
  );
}

/**
 * Out of the Marin fog and south over the Golden Gate, down its approach onto
 * the Marina street, right at x -51 and left onto the Pacific Heights loop,
 * once round it and on north to the Marina street, left back up the approach,
 * over the bridge and into the fog, where it turns round.
 */
function goldenGateRoute(): P3[] {
  const [, ne, se, sw] = corners(LOOPS[2].ring);
  const [x0, z0] = LOOPS[2].ring[0];
  const south = road("golden-gate-south");
  const [end, before] = [MARIN_ROAD[MARIN_ROAD.length - 1], MARIN_ROAD[MARIN_ROAD.length - 2]];
  const len = Math.hypot(end[0] - before[0], end[2] - before[2]);
  const jz = south[south.length - 1][2]; // the approach lands on the Marina street, z -36
  return chain(
    lane([...reversed(MARIN_ROAD), ...reversed(DECKS[0].points), ...south]),
    turn(x0 - LANE, jz + LANE, 0, 90),
    turn(x0 - LANE, z0 + LANE, 90, 0, 8), // the loop's next corner is 16 on
    ne,
    se,
    sw,
    turn(x0 + LANE, jz - LANE, 270, 180),
    lane([...reversed(south), ...DECKS[0].points, ...MARIN_ROAD]),
    uTurn(end, (end[0] - before[0]) / len, (end[2] - before[2]) / len),
  );
}

/**
 * The bridge routes, the city loop each joins (its cars drive at that loop's
 * speed), where the first car starts (mid-deck, so the bridges have traffic
 * from the first frame) and their cars, spread evenly along the route.
 */
const ROUTES: { build: () => P3[]; loop: number; from: [number, number]; cars: [CarType, string][] }[] = [
  { build: goldenGateRoute, loop: 2, from: [-80.75, -110], cars: [["model3", WHITE], ["modely", BLUE], ["model3", GREY]] },
  // The Cybertruck is long: it takes the straight bridge, not the Golden Gate's tight bend.
  { build: bayRoute, loop: 0, from: [79, 13.25], cars: [["modely", BLACK], ["cybertruck", SILVER], ["model3", WHITE]] },
];

/** Every car: the city loops' first, then the bridge cars. */
export function makeTraffic(): Car[] {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let k = 0;
  const speeds: number[] = [];
  const city = LOOPS.flatMap(({ ring, cars: count }) => {
    const path = resample(corners(ring).flat());
    const start = rand() * path.length;
    const speed = 2.3 + rand() * 0.9; // one speed per loop, so cars on it keep their spacing
    speeds.push(speed);
    return Array.from({ length: count }, (_, i) => ({
      path,
      offset: (start + (i * path.length) / count) % path.length,
      speed,
      color: PAINTS[k % PAINTS.length],
      type: LINEUP[k++] ?? "model3",
    }));
  });
  const bridges = ROUTES.flatMap(({ build, loop, from: [fx, fz], cars }) => {
    const path = resample(build());
    let start = 0;
    for (let i = 0, best = Infinity; i < path.pts.length / 2; i++) {
      const d = Math.hypot(path.pts[i * 2] - fx, path.pts[i * 2 + 1] - fz);
      if (d < best) [best, start] = [d, (i * path.length) / (path.pts.length / 2)];
    }
    return cars.map(([type, color], i) => ({ path, offset: (start + (i * path.length) / cars.length) % path.length, speed: speeds[loop], color, type }));
  });
  return [...city, ...bridges];
}

/** Only the cars on the city loops (they never leave the city streets). */
export const makeCars = () => makeTraffic().filter((car) => !car.path.ys);

const indexAt = ({ pts, length }: Path, s: number) => Math.floor(((((s % length) + length) % length) / length) * (pts.length / 2)) % (pts.length / 2);

/** Catmull-Rom through four values: a smooth curve through b (u 0) and c (u 1). */
const spline = (a: number, b: number, c: number, d: number, u: number) =>
  0.5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);

/** Point `s` units along a path (wraps), on a smooth curve through its points, with the height of the road or ground there. */
export function pointAt<T extends { x: number; z: number; y?: number }>({ pts, length, ys }: Path, s: number, out: T): T & { y: number } {
  const n = pts.length / 2;
  const f = ((((s % length) + length) % length) / length) * n;
  const i = Math.floor(f) % n;
  const a = (i + n - 1) % n;
  const c = (i + 1) % n;
  const d = (i + 2) % n;
  const u = f - Math.floor(f);
  out.x = spline(pts[a * 2], pts[i * 2], pts[c * 2], pts[d * 2], u);
  out.z = spline(pts[a * 2 + 1], pts[i * 2 + 1], pts[c * 2 + 1], pts[d * 2 + 1], u);
  const y = ys ? ys[i] + (ys[c] - ys[i]) * u : NaN;
  out.y = Number.isNaN(y) ? surfaceAt(out.x, out.z) : y;
  return out as T & { y: number };
}

/** Which way the path runs `s` along it (wraps): the unit x, z, on a smooth curve through the points' directions, so the heading turns without steps. */
function directionAt({ dirs, length }: Path, s: number, out: { x: number; z: number }) {
  const n = dirs.length / 2;
  const f = ((((s % length) + length) % length) / length) * n;
  const i = Math.floor(f) % n;
  const a = (i + n - 1) % n;
  const c = (i + 1) % n;
  const d = (i + 2) % n;
  const u = f - Math.floor(f);
  const x = spline(dirs[a * 2], dirs[i * 2], dirs[c * 2], dirs[d * 2], u);
  const z = spline(dirs[a * 2 + 1], dirs[i * 2 + 1], dirs[c * 2 + 1], dirs[d * 2 + 1], u);
  const len = Math.hypot(x, z);
  out.x = x / len;
  out.z = z / len;
  return out;
}

/** A per-point value of a path (its pace or pivot) `s` along it (wraps). */
function valueAt(values: Float32Array, length: number, s: number) {
  const n = values.length;
  const f = ((((s % length) + length) % length) / length) * n;
  const i = Math.floor(f) % n;
  return values[i] + (values[(i + 1) % n] - values[i]) * (f - Math.floor(f));
}

/** Where a car `s` along its path pivots on it: `s` less half a wheelbase on a street (its rear axle), `s` on a road (its middle). */
const pivotAt = (car: Car, s: number) => s + (valueAt(car.path.pivot, car.path.length, s) - 0.5) * MODELS[car.type].wheelbase;

/** The fastest a car `s` along its path may go: the pace where it pivots, the way it points. */
export const paceAt = (car: Car, s: number) => valueAt(car.path.pace, car.path.length, pivotAt(car, s));

const rear = { x: 0, y: 0, z: 0 };
const ahead = { x: 0, y: 0, z: 0 };
const way = { x: 0, z: 0 };

/**
 * Where a car `s` along its route stands: on its pivot (the rear axle on a
 * street), pointing the way the path runs there, as a real car does: no
 * sliding sideways, the front swings wide in a turn. On a straight its middle
 * is `s`. Wheels on the ground or the road, tilted with them.
 */
export function carPose(car: Car, s: number, out: Pose): Pose {
  const { wheelbase, width } = MODELS[car.type];
  const half = wheelbase / 2;
  const p = pivotAt(car, s);
  pointAt(car.path, p, rear);
  directionAt(car.path, p, way);
  const lead = s - p; // from the pivot to the middle
  out.x = rear.x + way.x * lead;
  out.z = rear.z + way.z * lead;
  const onRoad = car.path.ys && !Number.isNaN(car.path.ys[indexAt(car.path, s)]);
  // the wheels: on a road, the road's height; on a street, the ground right under them
  const hb = onRoad ? pointAt(car.path, s - half, ahead).y : surfaceAt(out.x - way.x * half, out.z - way.z * half);
  const hf = onRoad ? pointAt(car.path, s + half, ahead).y : surfaceAt(out.x + way.x * half, out.z + way.z * half);
  out.y = (hf + hb) / 2;
  out.yaw = Math.atan2(way.x, way.z);
  out.pitch = -Math.atan2(hf - hb, wheelbase);
  // Roads are level across. On a street: left is (cos yaw, -sin yaw); a positive roll lifts the left side.
  const w = width / 2;
  const lx = way.z * w;
  const lz = -way.x * w;
  // The hill tilts it, not the kerb (the probes reach over the sidewalks).
  out.roll = onRoad ? 0 : Math.atan2(heightAt(out.x + lx, out.z + lz) - heightAt(out.x - lx, out.z - lz), width);
  return out;
}

const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
const poses: Pose[] = [];

/** Whether two car footprints (pose, length and width) overlap: no axis of either separates them. */
function touch(a: Pose, am: { length: number; width: number }, b: Pose, bm: { length: number; width: number }) {
  const axes = [a.yaw, a.yaw + Math.PI / 2, b.yaw, b.yaw + Math.PI / 2];
  return axes.every((yaw) => {
    const [ux, uz] = [Math.sin(yaw), Math.cos(yaw)];
    // half extent of a footprint along u, from its own forward and side axes
    const reach = (p: Pose, m: { length: number; width: number }) =>
      (Math.abs(Math.sin(p.yaw) * ux + Math.cos(p.yaw) * uz) * m.length + Math.abs(Math.cos(p.yaw) * ux - Math.sin(p.yaw) * uz) * m.width) / 2;
    return Math.abs((b.x - a.x) * ux + (b.z - a.z) * uz) < reach(a, am) + reach(b, bm);
  });
}

/** How far apart two cars in a lane keep their centres: half of each plus a gap. */
export const spacing = (back: Car, front: Car) => (MODELS[back.type].length + MODELS[front.type].length) / 2 + 1.4;

/**
 * Moves every car on, unless Cuso or the car in front is just ahead, or it is
 * about to enter a junction (ZONES) another car is in. `rolled` adds up how
 * far each car really went (no wrap), for its wheels. Cuso's height is
 * optional: with it, cars on a raised road drive on over him.
 */
export function driveCars(cars: Car[], driven: Float32Array, dt: number, cuso: { x: number; z: number; y?: number }, rolled?: Float64Array) {
  const step = Math.min(dt, 0.1);
  for (let i = 0; i < cars.length; i++) carPose(cars[i], driven[i], (poses[i] ??= { ...pose }));
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const p = poses[i];
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    const move = step * Math.min(car.speed, paceAt(car, driven[i]));
    // About to go into a junction: it, and any other one just after it, must be clear.
    const inside = car.path.zones[indexAt(car.path, driven[i])];
    let entering = car.path.zones[indexAt(car.path, driven[i] + move + 0.5)] & ~inside;
    for (let d = 0; entering && d < CLEAR; d += STEP) entering |= car.path.zones[indexAt(car.path, driven[i] + move + 0.5 + d)] & ~inside;
    let blocked = false;
    for (let j = 0; j < cars.length && !blocked; j++) {
      if (j === i) continue;
      const other = cars[j];
      if (other.path === car.path) {
        const gap = (((driven[j] - driven[i]) % car.path.length) + car.path.length) % car.path.length;
        blocked = gap < spacing(car, other);
      } else {
        // A car of another route ahead, not coming the other way (bridge cars share the city
        // loops' lanes): wait if a gap further on this car would touch it (round corners too).
        const q = poses[j];
        const [rx, rz] = [q.x - p.x, q.z - p.z];
        if (rx * rx + rz * rz < 64 && rx * fx + rz * fz > 0 && Math.sin(q.yaw) * fx + Math.cos(q.yaw) * fz > -0.5) {
          blocked = touch(carPose(car, driven[i] + move + 1.4, pose), MODELS[car.type], q, MODELS[other.type]);
        }
      }
      blocked ||= (entering & other.path.zones[indexAt(other.path, driven[j])]) !== 0;
    }
    if (!blocked) {
      const rx = cuso.x - p.x;
      const rz = cuso.z - p.z;
      const ahead = rx * fx + rz * fz;
      const level = cuso.y === undefined || Math.abs(cuso.y - p.y) < 1.5;
      blocked = level && ahead > 0 && ahead < MODELS[car.type].length / 2 + 2.4 && Math.abs(rx * fz - rz * fx) < 1.2;
    }
    if (blocked) continue;
    driven[i] = (driven[i] + move) % car.path.length; // wrap: keeps float32 precise
    if (rolled) rolled[i] += move;
  }
}

/** How far a wheel of `radius` (city units) has turned after rolling `distance`, in radians. */
export const wheelAngle = (distance: number, radius: number) => distance / radius;


// ---------------------------------------------------------------------------
// Rendering: one instanced mesh per (model, material), materials shared. The
// wheel (tyre and rim) is its own mesh, four instances per car, rolled by distance.

const PARTS = ["paint", "glass", "trim", "light_front", "light_rear", "tyre", "rim"] as const;
type Part = (typeof PARTS)[number];
const isWheel = (part: Part) => part === "tyre" || part === "rim";

function useMaterials(): Record<Part, MeshStandardMaterial> {
  return useMemo(() => {
    const side = DoubleSide;
    return {
      paint: new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, side }),
      // Tinted glass that mirrors the sky.
      glass: new MeshPhysicalMaterial({ color: "#35424f", roughness: 0.05, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0, side }),
      trim: new MeshStandardMaterial({ color: "#121315", roughness: 0.7, side }),
      rim: new MeshStandardMaterial({ color: "#6c7177", roughness: 0.45, metalness: 0.35, side }),
      tyre: new MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.9, side }),
      light_front: new MeshStandardMaterial({ color: "#16181c", emissive: "#f4f8ff", roughness: 0.15, side }),
      light_rear: new MeshStandardMaterial({ color: "#6e0b10", emissive: "#ff2a24", roughness: 0.3, side }),
    };
  }, []);
}

/** A wheel spot on the car: from the car's pose to the wheel's axle, and its radius in city units. */
type Spot = { at: Matrix4; radius: number; flip: boolean };
type Piece = { key: string; type: CarType; part: Part; geometry: BufferGeometry; local: Matrix4; spots: Spot[] };

/** Every (model, material) piece, with the matrix from a car's pose to the piece (scale and the GLB's quantization). */
function usePieces(lite: boolean): Piece[] {
  const gltfs = useGLTF(TYPES.map((type) => (lite ? MODELS[type].liteUrl : MODELS[type].url)));
  return useMemo(
    () =>
      gltfs.flatMap(({ scene }, t) => {
        const type = TYPES[t];
        const scale = MODELS[type].scale;
        scene.updateMatrixWorld(true);
        // [x, y, z, radius] in metres per wheel (scripts/convert-cars.mjs); the GLB's wheel is the first.
        let wheels: number[][] = [];
        scene.traverse((o) => void (o.userData.wheels && (wheels = o.userData.wheels)));
        const spots = wheels.map(([x, y, z, r]) => ({
          // The right side is the same wheel turned round, so its rim faces out.
          at: new Matrix4()
            .makeScale(scale, scale, scale)
            .multiply(new Matrix4().makeTranslation(x, y, z))
            .multiply(new Matrix4().makeRotationY(x < 0 ? Math.PI : 0))
            .multiply(new Matrix4().makeScale(r / wheels[0][3], r / wheels[0][3], r / wheels[0][3])),
          radius: r * scale,
          flip: x < 0,
        }));
        const pieces: Piece[] = [];
        scene.traverse((o) => {
          const mesh = o as Mesh;
          const part = (mesh.material as MeshStandardMaterial | undefined)?.name as Part;
          if (!mesh.isMesh || !PARTS.includes(part)) return;
          const local = isWheel(part) ? mesh.matrixWorld.clone() : new Matrix4().makeScale(scale, scale, scale).multiply(mesh.matrixWorld);
          pieces.push({ key: `${type}-${part}`, type, part, geometry: mesh.geometry, local, spots: isWheel(part) ? spots : [] });
        });
        return pieces;
      }),
    [gltfs],
  );
}

/** A soft dark blob, drawn under each car where it meets the road. */
function useContactShadow() {
  return useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.6, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return {
      geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      material: new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    };
  }, []);
}

const o = new Object3D();
o.rotation.order = "YXZ";
const m4 = new Matrix4();
const spin = new Matrix4();
const blob = new Matrix4();
const c = new Color();
const frustum = new Frustum();
const sphere = new Sphere();

/** A few Teslas circling blocks and crossing the bridges, following the hills and the decks. They stop for Cuso. */
export function Cars({ lite = false }: { lite?: boolean }) {
  const cars = useMemo(() => makeTraffic(), []);
  const driven = useMemo(() => Float32Array.from(cars, (car) => car.offset), [cars]);
  const rolled = useMemo(() => new Float64Array(cars.length), [cars]);
  /** Each car's instance slot among the cars of its model. */
  const slot = useMemo(() => cars.map((car, i) => cars.slice(0, i).filter((other) => other.type === car.type).length), [cars]);
  const count = (type: CarType) => cars.filter((car) => car.type === type).length;
  const material = useMaterials();
  const pieces = usePieces(lite);
  const shadow = useContactShadow();
  useNightGlow(material.light_front, 0.9, 0.03);
  useNightGlow(material.light_rear, 1.8, 0.25);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const shadows = useRef<InstancedMesh>(null);

  // Colours before the first frame, so the paint's shader is compiled with them (the frame loop repacks them).
  useLayoutEffect(() => {
    pieces.forEach((piece, k) => {
      const mesh = meshes.current[k];
      if (piece.part !== "paint" || !mesh) return;
      cars.forEach((car, i) => car.type === piece.type && mesh.setColorAt(slot[i], c.set(car.color)));
    });
  }, [cars, pieces, slot]);

  useFrame(({ camera }, dt) => {
    // At night the sky no longer lights the paint and glass.
    material.paint.envMapIntensity = material.glass.envMapIntensity = 1 - 0.8 * rig.night;
    driveCars(cars, driven, dt, rig.cuso, rolled);
    // Only the cars in view take an instance (the first `n` of their model's), so the rest cost nothing.
    frustum.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const shown: Record<CarType, number> = { model3: 0, modely: 0, cybertruck: 0, roadster: 0 };
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      carPose(car, driven[i], pose);
      const { length, width } = MODELS[car.type];
      o.position.set(pose.x, pose.y, pose.z);
      o.rotation.set(pose.pitch, pose.yaw, pose.roll);
      o.scale.setScalar(outOfSight(pose.x, pose.z) ? 0 : 1); // turning round in the tunnel or the fog
      o.updateMatrix();
      shadows.current?.setMatrixAt(i, blob.multiplyMatrices(o.matrix, m4.makeScale(width * 1.1, 1, length * 1.08)));
      if (!frustum.intersectsSphere(sphere.set(o.position, length / 2 + (lite ? 0 : SHADOW_REACH)))) continue;
      const n = shown[car.type]++;
      pieces.forEach((piece, k) => {
        const mesh = meshes.current[k];
        if (piece.type !== car.type || !mesh) return;
        if (piece.part === "paint") mesh.setColorAt(n, c.set(car.color));
        if (!piece.spots.length) return mesh.setMatrixAt(n, m4.multiplyMatrices(o.matrix, piece.local));
        piece.spots.forEach((spot, w) => {
          // Turned round on the right, so it spins the other way to roll forward.
          spin.makeRotationX(wheelAngle(rolled[i], spot.radius) * (spot.flip ? -1 : 1));
          mesh.setMatrixAt(n * 4 + w, m4.multiplyMatrices(o.matrix, spot.at).multiply(spin).multiply(piece.local));
        });
      });
    }
    pieces.forEach((piece, k) => {
      const mesh = meshes.current[k];
      if (!mesh) return;
      mesh.count = shown[piece.type] * Math.max(1, piece.spots.length);
      mesh.visible = mesh.count > 0; // no draw call for a model with no car in view
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
    if (shadows.current) shadows.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {pieces.map((piece, k) => (
        <instancedMesh
          key={piece.key}
          ref={(mesh) => {
            meshes.current[k] = mesh;
            mesh?.layers.set(DETAIL); // no cars in reflections
          }}
          args={[piece.geometry, material[piece.part], count(piece.type) * Math.max(1, piece.spots.length)]}
          // the body's shadow covers the glass; lite keeps only the soft blob under each car
          castShadow={!lite && piece.part === "paint"}
          receiveShadow={piece.part === "paint"}
          frustumCulled={false}
        />
      ))}
      <instancedMesh ref={shadows} args={[shadow.geometry, shadow.material, cars.length]} frustumCulled={false} renderOrder={-1} layers={DETAIL} />
    </>
  );
}
