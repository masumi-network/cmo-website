// A rail jump's camera flight path (camera-rig.tsx flies it, navigate.ts times
// it): an arc from one shot to another over the roofs it crosses.

import { Vector3 } from "three";
import { roofAt } from "./layout";

/** How a flight goes: `lift`, how high its arc goes mid-way; `hold`, the part of it spent rising before it sets off (and coming down at the end). */
export type Plan = { lift: number; hold: number };
/** The arc lifts a fifth of the way it flies, at most this, unless a building is in the way. */
const FLIGHT_LIFT = 16;
/** Room it keeps over the roofs it flies across (and around their edges). */
const OVER_ROOFS = 2;
const ROOF_PAD = 0.6;
const smootherstep = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const p = new Vector3();
const q = new Vector3();

/**
 * Where a flight from `a` to `b` is at `t` (0..1 of its time): across, up the
 * arc and (flyAt) the aim on one ease, so they move together. With a `hold`
 * it rises first and crosses after, each eased on its own.
 */
export function flightPoint(out: Vector3, a: Vector3, b: Vector3, t: number, { lift, hold }: Plan) {
  const e = smootherstep(t);
  out.lerpVectors(a, b, hold ? smootherstep((t - hold) / (1 - 2 * hold)) : e);
  out.y = a.y + (b.y - a.y) * e + lift * Math.sin(Math.PI * e);
  return out;
}

/**
 * The calmest flight from `a` to `b` that passes over every roof it crosses:
 * a gentle arc if it can, else a higher one, else one that rises first (a
 * tall tower right beside the start). Only roofs under its path count: the
 * shots stand beside buildings, and asking for air over those near the ends
 * made nearly every flight the highest, rise-first one.
 */
export function flightPlan(a: Vector3, b: Vector3): Plan {
  const gentle = Math.min(FLIGHT_LIFT, a.distanceTo(b) * 0.2);
  for (const hold of [0, 0.12, 0.24]) {
    const plan = { lift: gentle, hold };
    for (let t = 0.01; t < 0.995; t += 0.01) {
      flightPoint(p, a, b, t, { lift: 0, hold });
      plan.lift = Math.max(plan.lift, (roofAt(p.x, p.z, ROOF_PAD) + OVER_ROOFS - p.y) / Math.sin(Math.PI * smootherstep(t)));
    }
    if (plan.lift <= 40) return plan;
  }
  return { lift: 40, hold: 0.24 };
}

/**
 * Seconds a flight on `plan` from `a` to `b` takes: longer the farther it
 * really goes (over the arc), so it never rushes. About 1.7 s next door,
 * 3.6 s at most (over the towers).
 */
export function flightTime(a: Vector3, b: Vector3, plan = flightPlan(a, b)) {
  let length = 0;
  q.copy(a);
  for (let k = 1; k <= 40; k++) {
    flightPoint(p, a, b, k / 40, plan);
    length += p.distanceTo(q);
    q.copy(p);
  }
  return Math.min(3.6, Math.max(1.6, 1.2 + length / 35));
}
