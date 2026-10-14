"use client";

// A few Teslas: mostly Model 3s and Model Ys, the odd Cybertruck and Roadster. Two
// loops run clockwise round city blocks on the inner lane, so every turn there
// is a right turn and no two loops ever cross. A few more cars come over the
// bridges: out of the Yerba Buena tunnel or the Marin fog, over the deck and
// down the approach, a lap of the nearest city loop, and back the way they
// came, turning round out of sight. Cars follow the hills and the road decks,
// keep their distance, take turns at the junctions where routes meet and stop
// for Cuso. The models come from scripts/convert-cars.mjs.

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
import { DECKS, ROADS, ROAD_WIDTH } from "./roads";
import { SHADOW_REACH } from "./parts";
import { DETAIL, LIVE, rig, useNightGlow } from "./shared";

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
const TURN = 1.2;
const STEP = 0.25;

/**
 * A closed route sampled every ~STEP units: x, z in `pts`. Bridge routes also
 * keep the road surface height (`ys`; NaN on city streets, where the ground is
 * surfaceAt, a kerb below the sidewalks). `zones` has, per point, the junctions it is in (bit k: ZONES[k]).
 */
export type Path = { pts: Float32Array; length: number; ys?: Float32Array; zones: Uint8Array };
export type Car = { path: Path; offset: number; speed: number; color: string; type: CarType };
export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

/** Tesla paints: pearl white, solid black, stealth grey, quicksilver, deep blue, ultra red. */
const PAINTS = ["#e9e8e3", "#0f1012", "#3d4045", "#a2a5a8", "#1d3563", "#a3151d"];
const [WHITE, BLACK, GREY, SILVER, BLUE] = PAINTS;
/** Which model each city car is, in order: the Cybertruck in quicksilver, the Roadster in red. */
const LINEUP: CarType[] = ["modely", "model3", "modely", "cybertruck", "model3", "roadster", "modely"];

/**
 * Loops the cars circle, [x0, x1, z0, z1] on car streets, and how many cars each.
 * No two loops share a corner: two cars turning at one corner would touch.
 */
const LOOPS: [number, number, number, number, number][] = [
  [-19, 13, -16, 34, 5], // below Russian Hill, past Union Square and SoMa, back by the Mission wall
  [-51, -35, -26, -16, 2], // Pacific Heights
];

/**
 * Junctions where routes meet, and tight bends, [x, z, radius]: a car is in
 * one while its centre is this close. A car goes in only when no other car is
 * in it, nor in the next one along its way (it never waits inside one).
 */
const ZONES: [number, number, number][] = [
  [13, 14, 4.5], // the Bay Bridge ramp lands on the downtown loop
  [-52, -35, 5], // Golden Gate cars turn off and back onto the Marina street ...
  [-51, -26, 4.5], // ... and join the Pacific Heights loop
  [-74, -42, 8], // the Golden Gate approach's tight bend: two cars side by side there would touch
  [-80, -160.5, 6], // the Marin road's S bend just off the deck: the same
];
/** How far ahead a car makes sure the junctions are clear before it goes in. */
const CLEAR = 15;

/** Where the Yerba Buena tunnel starts (the Bay Bridge's east road ends in it). */
const PORTAL = ROADS.find((road) => road.tunnel)!.points.at(-1)!;
/** The Marin road goes out into the fog north of here (it ends at z -288). */
const FOG_Z = -282;

/** Out of sight: the whole car past the tunnel portal's dark face, or out in the Marin fog. */
export const outOfSight = (x: number, z: number) => (x > PORTAL[0] + 2.3 && Math.abs(z - PORTAL[2]) < ROAD_WIDTH) || z < FOG_Z;

/** A route point: x, y, z, with y NaN on a city street. */
type P3 = [number, number, number];

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
  const zones = new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++) {
    const s = (i * length) / n;
    while (cum[j + 1] < s) j++;
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const [px, py, pz] = dense[j];
    const [qx, qy, qz] = dense[(j + 1) % dense.length];
    const x = (pts[i * 2] = px + (qx - px) * u);
    const z = (pts[i * 2 + 1] = pz + (qz - pz) * u);
    // A road ends tucked just under its street: never below the ground. NaN (a street) stays NaN.
    ys[i] = Math.max(py + (qy - py) * u, surfaceAt(x, z));
    zones[i] = ZONES.reduce((bits, [zx, zz, r], k) => (Math.hypot(x - zx, z - zz) < r ? bits | (1 << k) : bits), 0);
  }
  return ys.some((y) => !Number.isNaN(y)) ? { pts, length, ys, zones } : { pts, length, zones };
}

/** An arc round cx, cz on a city street, from angle a0 to a1 (degrees; 0 is +x east, 90 is +z south). */
function arc(cx: number, cz: number, r: number, a0: number, a1: number): P3[] {
  const n = Math.ceil(Math.abs(a1 - a0) / 7.5);
  return Array.from({ length: n + 1 }, (_, k): P3 => {
    const a = ((a0 + ((a1 - a0) * k) / n) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, NaN, cz + Math.sin(a) * r];
  });
}

/** The rounded corners of a clockwise loop round [x0, x1, z0, z1] on the inner lane: NE, SE, SW, NW. */
function corners(x0: number, x1: number, z0: number, z1: number): P3[][] {
  const a = x0 + LANE + TURN;
  const b = x1 - LANE - TURN;
  const c = z0 + LANE + TURN;
  const d = z1 - LANE - TURN;
  return [[b, c], [b, d], [a, d], [a, c]].map(([cx, cz], k) => arc(cx, cz, TURN, (k - 1) * 90, k * 90));
}

/** The right-hand lane for driving along a road's centre line (the surface is level across). */
function lane(centre: readonly Vec3[]): P3[] {
  const c = centre.filter((p, i) => i === 0 || Math.hypot(p[0] - centre[i - 1][0], p[2] - centre[i - 1][2]) > 1e-6);
  return c.map(([x, y, z], i): P3 => {
    const [a, b] = [c[Math.max(0, i - 1)], c[Math.min(c.length - 1, i + 1)]];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    return [x - ((b[2] - a[2]) / len) * LANE, y, z + ((b[0] - a[0]) / len) * LANE];
  });
}

/** Round from the lane arriving at `end` (heading tx, tz) to the lane leaving it: a left U-turn, only ever out of sight. */
function uTurn([x, y, z]: Vec3, tx: number, tz: number): P3[] {
  return Array.from({ length: 13 }, (_, k): P3 => {
    const a = (k / 12) * Math.PI;
    return [x - tz * LANE * Math.cos(a) + tx * LANE * Math.sin(a), y, z + tx * LANE * Math.cos(a) + tz * LANE * Math.sin(a)];
  });
}

const road = (name: string) => ROADS.find((r) => r.name === name)!.points;
const reversed = <T,>(list: readonly T[]) => [...list].reverse();
const K = ROAD_WIDTH / 2;

/**
 * Out of the Yerba Buena tunnel and west over the Bay Bridge, down the ramp to
 * the x 13 junction, left onto the downtown loop and once round it, then left
 * back up the ramp and east into the tunnel, where it turns round.
 */
function bayRoute(): P3[] {
  const [, x1, z0, z1] = LOOPS[0];
  const [ne, se, sw, nw] = corners(LOOPS[0][0], x1, z0, z1);
  const west = road("bay-bridge-west");
  const east = road("bay-bridge-east");
  const inside: Vec3 = [PORTAL[0] + 4, PORTAL[1], PORTAL[2]];
  const jz = west[west.length - 1][2]; // the ramp lands on z 14 at the x 13 junction
  return [
    ...lane([inside, ...reversed(east), ...reversed(DECKS[1].points), ...west]),
    ...arc(x1 + K, jz + K, K + LANE, -90, -180),
    ...se,
    ...sw,
    ...nw,
    ...ne,
    ...arc(x1 + K, jz - K, K + LANE, 180, 90),
    ...lane([...reversed(west), ...DECKS[1].points, ...east, inside]),
    ...uTurn(inside, 1, 0),
  ];
}

/**
 * Out of the Marin fog and south over the Golden Gate, down its approach onto
 * the Marina street, right at x -51 and left onto the Pacific Heights loop,
 * once round it and on north to the Marina street, left back up the approach,
 * over the bridge and into the fog, where it turns round.
 */
function goldenGateRoute(): P3[] {
  const [x0, x1, z0, z1] = LOOPS[1];
  const [ne, se, sw] = corners(x0, x1, z0, z1);
  const south = road("golden-gate-south");
  const [end, before] = [MARIN_ROAD[MARIN_ROAD.length - 1], MARIN_ROAD[MARIN_ROAD.length - 2]];
  const len = Math.hypot(end[0] - before[0], end[2] - before[2]);
  const jz = south[south.length - 1][2]; // the approach lands on the Marina street, z -36
  return [
    ...lane([...reversed(MARIN_ROAD), ...reversed(DECKS[0].points), ...south]),
    ...arc(x0 - LANE - TURN, jz + LANE + TURN, TURN, -90, 0),
    ...arc(x0 + LANE + TURN, z0 - LANE - TURN, 2 * LANE + TURN, 180, 90),
    ...ne,
    ...se,
    ...sw,
    ...arc(x0 - K, jz + K, K + LANE, 0, -90),
    ...lane([...reversed(south), ...DECKS[0].points, ...MARIN_ROAD]),
    ...uTurn(end, (end[0] - before[0]) / len, (end[2] - before[2]) / len),
  ];
}

/**
 * The bridge routes, the city loop each joins (its cars drive at that loop's
 * speed), where the first car starts (mid-deck, so the bridges have traffic
 * from the first frame) and their cars, spread evenly along the route.
 */
const ROUTES: { build: () => P3[]; loop: number; from: [number, number]; cars: [CarType, string][] }[] = [
  { build: goldenGateRoute, loop: 1, from: [-80.75, -110], cars: [["model3", WHITE], ["modely", BLUE], ["model3", GREY]] },
  // The Cybertruck is long: it takes the straight bridge, not the Golden Gate's tight bend.
  { build: bayRoute, loop: 0, from: [79, 13.25], cars: [["modely", BLACK], ["cybertruck", SILVER], ["model3", WHITE]] },
];

/** Every car: the city loops' first, then the bridge cars. */
export function makeTraffic(): Car[] {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let k = 0;
  const speeds: number[] = [];
  const city = LOOPS.flatMap(([x0, x1, z0, z1, count]) => {
    const path = resample(corners(x0, x1, z0, z1).flat());
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

/** Point `s` units along a path (wraps), with the height of the road or ground there. */
export function pointAt<T extends { x: number; z: number; y?: number }>({ pts, length, ys }: Path, s: number, out: T): T & { y: number } {
  const n = pts.length / 2;
  const f = ((((s % length) + length) % length) / length) * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const u = f - Math.floor(f);
  out.x = pts[i * 2] + (pts[j * 2] - pts[i * 2]) * u;
  out.z = pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * u;
  const y = ys ? ys[i] + (ys[j] - ys[i]) * u : NaN;
  out.y = Number.isNaN(y) ? surfaceAt(out.x, out.z) : y;
  return out as T & { y: number };
}

const front = { x: 0, y: 0, z: 0 };
const back = { x: 0, y: 0, z: 0 };

/** Where a car `s` along its route stands: wheels on the path, tilted to the ground or the road. */
export function carPose(car: Car, s: number, out: Pose): Pose {
  const { wheelbase, width } = MODELS[car.type];
  const half = wheelbase / 2;
  const hf = pointAt(car.path, s + half, front).y;
  const hb = pointAt(car.path, s - half, back).y;
  const dx = front.x - back.x;
  const dz = front.z - back.z;
  const span = Math.hypot(dx, dz);
  out.x = (front.x + back.x) / 2;
  out.z = (front.z + back.z) / 2;
  out.y = (hf + hb) / 2;
  out.yaw = Math.atan2(dx, dz);
  out.pitch = -Math.atan2(hf - hb, span);
  // Roads are level across. On a street: left is (cos yaw, -sin yaw); a positive roll lifts the left side.
  const w = width / 2;
  const lx = (dz / span) * w;
  const lz = (-dx / span) * w;
  const onRoad = car.path.ys && !Number.isNaN(car.path.ys[indexAt(car.path, s)]);
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
    const move = step * car.speed;
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
    <group userData={LIVE}>
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
    </group>
  );
}
