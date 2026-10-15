// Photo-real mode (F12) in Explore: when to trace the map live, and when to
// drop the trace. Pure, so it is unit tested; the tracer is
// src/scene/explore-trace.tsx. The trace shows as a plate (plates.tsx) taken
// from the camera's own pose: it starts once the map has been still a moment,
// shows when done, and goes the moment the map moves.

export type V3 = { x: number; y: number; z: number };
export type Pose = { position: V3; quaternion: V3 & { w: number } };

/** Seconds the map must be still before a trace starts (a drag pauses often). */
export const STILL_FOR = 0.3;
/**
 * Below these the camera counts as still. After a drag it eases in for a while (about 0.7 s from 5 cm a second to
 * 5 mm): a trace started earlier is carried centimetres off its pose by the time it shows, and drops at once.
 */
const CREEP = { speed: 0.005, turn: 0.001 }; // metres a second, radians a second

/** How far from its pose a trace still holds: once shown, the rig snaps the camera back onto it (camera-rig.tsx, holdsLive), a jump of up to this in one frame; a drag goes further. */
export const HOLD = { dist: 0.05, angle: Math.PI / 180 };

const angleBetween = (p: Pose["quaternion"], q: Pose["quaternion"]) => 2 * Math.acos(Math.min(1, Math.abs(p.x * q.x + p.y * q.y + p.z * q.z + p.w * q.w)));
const off = (a: Pose, b: Pose) => Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) > HOLD.dist || angleBetween(a.quaternion, b.quaternion) > HOLD.angle;

export const newLive = () => ({ last: null as Pose | null, still: 0, tracing: null as Pose | null, shown: null as Pose | null });
export type Live = ReturnType<typeof newLive>;

const copy = (p: Pose): Pose => ({ position: { ...p.position }, quaternion: { ...p.quaternion } });

/**
 * One frame: `start` a trace from `pose`, `show` the finished one, `drop` what is traced or shown, or `wait`.
 * `known`: a kept trace of the view the camera is on (findTrace), shown at once: it needs no stillness to wait for.
 */
export function stepLive(
  s: Live,
  { pose, dt, explore, done, pressed = false, known = null }: { pose: Pose; dt: number; explore: boolean; done: boolean; pressed?: boolean; known?: Pose | null },
): "wait" | "start" | "show" | "drop" {
  const had = s.tracing !== null || s.shown !== null;
  if (!explore) {
    Object.assign(s, newLive());
    return had ? "drop" : "wait";
  }
  const last = s.last;
  s.last = copy(pose);
  if (known && !pressed && !s.tracing && !s.shown) {
    s.shown = copy(known); // the rig snaps the camera onto it (it is within HOLD)
    s.still = 0;
    return "show";
  }
  let moving = last === null;
  if (s.shown) moving = off(pose, s.shown); // the rig holds the camera on it: only a real move counts
  else if (last && dt > 0) {
    const a = last.position;
    const b = pose.position;
    moving = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) / dt > CREEP.speed || angleBetween(last.quaternion, pose.quaternion) / dt > CREEP.turn;
    if (s.tracing && off(pose, s.tracing)) moving = true; // drifted off while tracing: it would not hold when done
  }
  if (moving) {
    s.still = 0;
    s.tracing = null;
    s.shown = null;
    return had ? "drop" : "wait";
  }
  if (pressed) {
    // the pointer is down: a pause mid-drag, not a rest (a trace would only be thrown away)
    s.still = 0;
    if (!s.tracing) return "wait";
    s.tracing = null;
    return "drop";
  }
  s.still += dt;
  if (done && s.tracing) {
    s.shown = s.tracing;
    s.tracing = null;
    return "show";
  }
  if (!s.tracing && !s.shown && s.still >= STILL_FOR) {
    s.tracing = copy(pose);
    return "start";
  }
  return "wait";
}

/** A finished trace, kept to show again when the camera comes back to its view. */
export type Kept = { pose: Pose; hour: number; width: number; height: number };

/** The kept trace for this view, if any: the same pose (within HOLD), hour and window size. */
export function findTrace<T extends Kept>(kept: T[], pose: Pose, hour: number, width: number, height: number) {
  return kept.find((k) => !off(pose, k.pose) && Math.abs(k.hour - hour) < 0.02 && k.width === width && k.height === height) ?? null;
}

/**
 * Keeps `trace` as the newest (one already kept just moves to the front; a new one for a kept view replaces it),
 * at most `max`. Returns the traces let go, for their textures to be freed.
 */
export function keepTrace<T extends Kept>(kept: T[], trace: T, max: number): T[] {
  const gone: T[] = [];
  const at = kept.indexOf(trace);
  if (at >= 0) kept.splice(at, 1);
  else {
    const same = findTrace(kept, trace.pose, trace.hour, trace.width, trace.height);
    if (same) gone.push(...kept.splice(kept.indexOf(same), 1));
  }
  kept.unshift(trace);
  gone.push(...kept.splice(max));
  return gone;
}
