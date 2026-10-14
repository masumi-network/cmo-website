// The Union Square cable car's run, as pure functions (tested in
// tests/unit/cable-line.test.ts and collision.test.ts).
//
// A double-ended car on the z 14 street: the west end of the line (short of
// the 07:00 spot), Union Square under the billboard, the east end (short of
// the x 13 junction where the Bay Bridge viaduct lands). It takes the cable
// gently, cruises at cable speed, brakes into each stop, waits, and at the
// ends drives back the way it came.
//
// Cuso crosses its street. Where, is worked out from his routes: "windows" of
// the day line where his body could touch the car, each with the stretch of
// line ("span") the car must keep off while he is there. The car claims a
// span when it gets within braking distance of it, and only while he is not
// near; otherwise it brakes and waits short of it. He never steps into a
// window whose span the car has claimed: he waits at the kerb. So they never
// meet, whoever moves first.

import { chapters } from "@/content/day";
import type { Mode } from "@/lib/store";
import { activeIndex } from "@/lib/time";
import { surfaceAt } from "@/lib/terrain";
import { CAR } from "./cable-car";
import { CABLE_RAILS } from "./grid";
import { HULL } from "./rig";
import { DAY_LENGTH, sampleDay } from "./routes";

const [RAIL_X0, RAIL_X1, Z] = CABLE_RAILS[0];

/** The line: rails [x0, x1] down the z street, and the car's stops (centre x), west to east. */
export const LINE = {
  z: Z,
  rails: [RAIL_X0, RAIL_X1] as const,
  // west end (its east end on the x -3 junction), Union Square (UNION_CAR), east end (clear of Cuso's climb)
  stops: [-6.5, 2.1, 8.7],
};
/** Cable speed, how gently the grip takes it, how firmly the brakes stop (units/s, units/s²). */
export const CRUISE = 1.6;
export const ACCEL = 0.55;
export const BRAKE = 0.75;
/** How far out from the car's centre its wheels reach along the rails. */
export const WHEELS = 1.3 + 0.26 + 0.12;
/** Seconds standing at each stop. */
const DWELL = [7, 5, 7];
const UNION = 1;
/** Chapters whose shot shows the line: the car waits at Union Square, out of the 07:00 shot and in the 12:00 one. */
const HOLD = ["learn", "ads"];

/** The car waits while Cuso is this close (day distance) to a crossing; more than he moves in a frame (22 units/s at 0.1 s). */
const NEAR = 4;
/** The car also gives way while Cuso walks towards a crossing from this close (about 3 s of his walk and dash). */
const AHEAD = 40;

export type CableCar = {
  /** Centre x along the rails, speed (>= 0), heading (+1 east). */
  s: number;
  v: number;
  dir: 1 | -1;
  /** The stop it stands at (-1 running), the one it runs to, and how long it still waits. */
  at: number;
  next: number;
  wait: number;
  /** Spans (bits) it has claimed: it is in them or committed to going in. */
  claimed: number;
};

/** At Union Square, waiting, then off east: a page opened at 12:00 has it in place. */
export const startCar = (): CableCar => ({ s: LINE.stops[UNION], v: 0, dir: 1, at: UNION, next: UNION, wait: 8, claimed: 0 });

/** The one car the scene drives, which Cuso keeps clear of. */
export const unionCar = startCar();

/** Whether the story is on (or settling into) a chapter that wants the car at Union Square. */
export const holdsAtUnion = (progress: number, mode: Mode) => mode === "story" && HOLD.includes(chapters[activeIndex(progress, chapters.length)].id);

/** Height of the car's floor and its pitch, standing on the street at s (as cable-car.tsx stands a car). */
export function carGround(s: number, out: { y: number; tilt: number }) {
  const a = surfaceAt(s - 1.3, Z);
  const b = surfaceAt(s + 1.3, Z);
  out.y = (a + b) / 2;
  out.tilt = Math.atan2(b - a, 2.6);
  return out;
}

// --- where Cuso crosses -------------------------------------------------------

export type Window = { a: number; b: number; span: number };
export type Span = { s0: number; s1: number };

/** The car's solids relative to its centre and floor: [x0, x1, z half-width, y0, y1] (as CAR, collision.test.ts). */
const { body, roof, board } = CAR;
const SOLIDS: [number, number, number, number, number][] = [
  [-body.x, body.x, body.z, body.bottom, body.top],
  [-roof.x, roof.x, roof.z, body.top, CAR.height],
  [board.x0, board.x1, board.z, board.top - 0.03, board.top],
  [-board.x1, -board.x0, board.z, board.top - 0.03, board.top],
];
const PAD = 0.03;
const SAMPLE = 0.05;

/** Which way he faces at day distance d going `dir` along it (as cuso.tsx turns him). */
function facing(d: number, dir: number) {
  const { pos, face } = sampleDay(d);
  if (face !== null) return face;
  const ahead = sampleDay(d + dir * 1.6).pos;
  return Math.atan2(ahead[0] - pos[0], ahead[2] - pos[2]);
}

/** Car centres [lo, hi] (on the line) at which the car would touch him at day distance d, going either way along, or null. */
function touching(d: number): [number, number] | null {
  const { pos } = sampleDay(d);
  if (Math.abs(pos[2] - Z) > 3.5) return null;
  // his body's boxes turned to his heading, as axis-aligned boxes: [x0, x1, z0, z1, y0, y1]
  const boxes: number[][] = [];
  for (const dir of [1, -1]) {
    const h = facing(d, dir);
    const [c, s] = [Math.cos(h), Math.sin(h)];
    for (const [b0, b1, x0, x1, z0, z1] of HULL) {
      const xs = [x0 * c + z0 * s, x1 * c + z0 * s, x0 * c + z1 * s, x1 * c + z1 * s];
      const zs = [-x0 * s + z0 * c, -x1 * s + z0 * c, -x0 * s + z1 * c, -x1 * s + z1 * c];
      boxes.push([pos[0] + Math.min(...xs) - PAD, pos[0] + Math.max(...xs) + PAD, pos[2] + Math.min(...zs) - PAD, pos[2] + Math.max(...zs) + PAD, pos[1] + b0, pos[1] + b1]);
    }
  }
  /** Whether a car at s, its floor between f0 and f1 at its centre and pitched by slope t, touches one of his boxes. */
  const hits = (s: number, f0: number, f1: number, t: number, anywhere = false) =>
    boxes.some(([bx0, bx1, bz0, bz1, by0, by1]) =>
      SOLIDS.some(
        ([sx0, sx1, half, y0, y1]) =>
          by1 > f0 + y0 + Math.min(sx0 * t, sx1 * t) && by0 < f1 + y1 + Math.max(sx0 * t, sx1 * t) && bz1 > Z - half && bz0 < Z + half && (anywhere || (bx1 > s + sx0 && bx0 < s + sx1)),
      ),
    );
  const [f0, f1] = floorRange();
  if (!hits(0, f0, f1, 0, true)) return null; // out of reach wherever the car is
  const [w, e] = [LINE.stops[0], LINE.stops[LINE.stops.length - 1]];
  const g = { y: 0, tilt: 0 };
  let lo = Infinity;
  let hi = -Infinity;
  for (let s = w - SAMPLE; s <= e + SAMPLE; s += SAMPLE) {
    if (Math.abs(s - pos[0]) > 3.2) continue;
    carGround(s, g);
    if (!hits(s, g.y, g.y, Math.tan(g.tilt))) continue;
    lo = Math.min(lo, s - SAMPLE);
    hi = Math.max(hi, s + SAMPLE);
  }
  return lo < hi ? [lo, hi] : null;
}

let floors: [number, number] | null = null;
/** How low and high the car's floor gets anywhere on its run (its pitched ends included). */
function floorRange(): [number, number] {
  if (floors) return floors;
  const g = { y: 0, tilt: 0 };
  let [lo, hi] = [Infinity, -Infinity];
  for (let s = LINE.stops[0]; s <= LINE.stops[LINE.stops.length - 1]; s += 0.1) {
    carGround(s, g);
    const lift = (Math.abs(Math.tan(g.tilt)) * CAR.length) / 2;
    [lo, hi] = [Math.min(lo, g.y - lift), Math.max(hi, g.y + lift)];
  }
  return (floors = [lo, hi]);
}

let found: { windows: Window[]; spans: Span[] } | null = null;

/** Where on his day line Cuso could touch the car somewhere on its run, and the spans of line to keep off then. */
export function crossings() {
  if (found) return found;
  const [w, e] = [LINE.stops[0], LINE.stops[LINE.stops.length - 1]];
  const raw: (Span & { a: number; b: number })[] = [];
  let open: (Span & { a: number; b: number }) | null = null;
  for (let d = 0; d <= DAY_LENGTH + SAMPLE / 2; d += SAMPLE) {
    const t = touching(d);
    const hit = t && t[0] < e && t[1] > w ? t : null;
    if (hit) {
      open ??= { a: d - SAMPLE, b: d, s0: hit[0], s1: hit[1] };
      open.b = d + SAMPLE;
      open.s0 = Math.min(open.s0, hit[0]);
      open.s1 = Math.max(open.s1, hit[1]);
    } else if (open) {
      raw.push(open);
      open = null;
    }
  }
  if (open) raw.push(open);
  // windows whose stretches of line overlap share one span
  const spans: Span[] = [];
  const windows = raw.map(({ a, b, s0, s1 }) => {
    let k = spans.findIndex((sp) => s0 < sp.s1 && s1 > sp.s0);
    if (k < 0) k = spans.push({ s0, s1 }) - 1;
    else spans[k] = { s0: Math.min(s0, spans[k].s0), s1: Math.max(s1, spans[k].s1) };
    return { a, b, span: k };
  });
  found = { windows, spans };
  return found;
}

/** Cuso's day distance now and where the scroll sends him. */
export type CusoAt = { d: number; target: number };

/**
 * Whether Cuso is clear of span k: neither he nor where he is going is near
 * one of its windows, and he is not on his way across one or walking up to one
 * (the car gives way: a cable car is slow, and him waiting seconds at the
 * kerb read as lag).
 */
function clear(k: number, { d, target }: CusoAt) {
  for (const w of crossings().windows) {
    if (w.span !== k) continue;
    if ((d > w.a - NEAR && d < w.b + NEAR) || (target > w.a - NEAR && target < w.b + NEAR)) return false;
    if (Math.min(d, target) < w.a && Math.max(d, target) > w.b) return false;
    // walking towards it, a few steps away
    if ((target > d && d < w.a && w.a - d < AHEAD) || (target < d && d > w.b && d - w.b < AHEAD)) return false;
  }
  return true;
}

const inside = (s: number, sp: Span) => s > sp.s0 && s < sp.s1;
/** How far ahead (going dir) the car reaches span sp; negative once it is in it or past it. */
const ahead = (s: number, dir: number, sp: Span) => (dir > 0 ? sp.s0 - s : s - sp.s1);

/**
 * One step of the car: wait at a stop, or run on towards the next one,
 * claiming each of Cuso's crossings on the way or braking short of it while
 * he is near. `hold`: come to rest at Union Square and stay there.
 */
export function stepCar(car: CableCar, dt: number, cuso: CusoAt, hold: boolean) {
  const { spans } = crossings();
  const stops = LINE.stops;
  dt = Math.min(dt, 0.1);
  // let go of the spans it has left behind
  for (let k = 0; k < spans.length; k++) {
    if (car.claimed & (1 << k) && !inside(car.s, spans[k]) && ahead(car.s, car.dir, spans[k]) < 0) car.claimed &= ~(1 << k);
  }

  if (car.at >= 0) {
    if (hold && car.at === UNION) return;
    if (hold) car.wait = Math.min(car.wait, 1.5); // back to Union Square soon
    car.wait -= dt;
    if (car.wait > 0) return;
    const dir = car.at === 0 ? 1 : car.at === stops.length - 1 ? -1 : car.dir;
    // off only once the first crossing ahead is clear of Cuso
    for (let k = 0; k < spans.length; k++) {
      const e = ahead(car.s, dir, spans[k]);
      if (e >= 0 && e < Math.abs(stops[car.at + dir] - car.s) && !clear(k, cuso)) return;
    }
    car.dir = dir;
    car.next = car.at + dir;
    car.at = -1;
  }

  const goal = stops[car.next];
  const dist = (goal - car.s) * car.dir;
  // where it has to be stopped by: the next stop, or short of a crossing Cuso is near
  let room = dist;
  for (let k = 0; k < spans.length; k++) {
    const e = ahead(car.s, car.dir, spans[k]);
    if (car.claimed & (1 << k) || e < 0 || e > dist) continue;
    if (!clear(k, cuso)) room = Math.min(room, Math.max(0, e - 0.02));
    else if (e <= (car.v * car.v) / (2 * BRAKE) + car.v * dt + 0.05) car.claimed |= 1 << k; // committed: from here it could not stop in time
  }
  // take up the cable, unless one more step of that would leave too little room to stop: then brake evenly to stop right there
  const up = Math.min(CRUISE, car.v + ACCEL * dt);
  const left = room - ((car.v + up) / 2) * dt;
  const brake = left <= 1e-6 || (up * up) / (2 * left) > BRAKE;
  const v = brake ? Math.max(0, car.v - (room > 1e-6 ? (car.v * car.v) / (2 * room) : Infinity) * dt) : up;
  let move = ((car.v + v) / 2) * dt;
  car.v = v;
  if (move >= room || (v === 0 && brake)) {
    move = room;
    car.v = 0;
  }
  car.s += car.dir * move;
  if (dist - move <= 1e-6) {
    car.s = goal;
    car.v = 0;
    car.at = car.next;
    car.wait = DWELL[car.at];
  }
}

/**
 * Where Cuso may get to on his way from `from` to `to` (day distances): not
 * into a crossing while the car is in it or committed to it. He stops at its
 * edge, on his side, and goes on when the car has passed.
 */
export function cusoMayGo(from: number, to: number, car: CableCar) {
  if (!car.claimed) return to;
  const { windows } = crossings();
  for (const w of windows) {
    if (!(car.claimed & (1 << w.span)) || to <= w.a || to >= w.b) continue;
    return from <= w.a ? w.a : from >= w.b ? w.b : from;
  }
  return to;
}
