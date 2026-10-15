"use client";

// Camera follows the day: each chapter has a shot. While Cuso walks to the
// next place the camera leads him (he walks towards us), then settles into
// the next shot. Explore mode pulls back to a bird's-eye view.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PerspectiveCamera, Vector3, type Camera } from "three";
import { chapters, overview } from "@/content/day";
import { jumpEase } from "@/lib/navigate";
import { usePan } from "@/lib/pan";
import { useCity } from "@/lib/store";
import { type Plan, flightPlan, flightPoint, flightTime } from "./flight";
import { insideBuilding, sightClear, sightHit } from "./layout";
import { damp, dayNow, overlays, rig, setLerp } from "./shared";

const pos = new Vector3();
const tgt = new Vector3();
const right = new Vector3();
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const chasePos = new Vector3();
const chaseTgt = new Vector3();

/** Fit Explore's view so every pin stays inside the frame (room for labels and the top bar), then ease out a little. */
const fit = { aspect: 0, fov: 0, pos: new Vector3(), tgt: new Vector3() };
const probeCam = new PerspectiveCamera();
const ndc = new Vector3();
function fitOverview(aspect: number, fov: number) {
  if (fit.aspect === aspect && fit.fov === fov) return fit;
  const points = [...chapters.filter((c) => c.id !== "join").map((c) => new Vector3(c.spot[0], c.spot[1] + 2.4, c.spot[2])), ...overview.include.map((p) => new Vector3(...p))];
  const center = points.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / points.length).setY(0);
  const dir = new Vector3(...overview.direction).normalize();
  probeCam.fov = fov;
  probeCam.aspect = aspect;
  probeCam.updateProjectionMatrix();
  const fits = (d: number) => {
    probeCam.position.copy(center).addScaledVector(dir, d);
    probeCam.lookAt(center);
    probeCam.updateMatrixWorld();
    return points.every((p) => {
      ndc.copy(p).project(probeCam);
      return Math.abs(ndc.x) < 0.8 && ndc.y > -0.82 && ndc.y < 0.7; // room for pin labels and the top bar
    });
  };
  let lo = 40;
  let hi = 600;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fit.aspect = aspect;
  fit.fov = fov;
  fit.tgt.copy(center);
  fit.pos.copy(center).addScaledVector(dir, hi * 1.12);
  return fit;
}

/** Where the fitted overview looks (the middle of the pins). */
export const overviewCenter = () => ({ x: fit.tgt.x, z: fit.tgt.z });

const eye = new Vector3();
const lifted = new Vector3();

/**
 * The boom: when something stands between Cuso and the camera, the camera
 * swings up over him on an arc around his eye (a little closer, looking at
 * him), and settles back once he is in sight. `x` (0..1) is how far along that path it is; `goal` the lift it is
 * heading for. Critically damped, so it never pops.
 */
export const BOOM = {
  /** Lifts tried, from none to the whole swing. */
  levels: 6,
  /** Extra elevation at full lift (radians), and the steepest it may look down. */
  angle: 1,
  steepest: 1.35,
  /** The boom is this much shorter at full lift. */
  closer: 0.25,
  /** Spring rates (1/s): quick to rise, slow and calm to settle. */
  rise: 7,
  settle: 2.2,
  /** Seconds Cuso must be in sight before it comes down, and the extra air it needs to come down. */
  hold: 0.45,
  air: 0.6,
  /** Fastest it ever swings (lift per second), for the tests. */
  maxRate: 3,
};

export type Boom = { x: number; v: number; goal: number; clear: number };
export const newBoom = (): Boom => ({ x: 0, v: 0, goal: 0, clear: 0 });

/** The camera at `cam`, swung up around `eye` by `lift` (0..1). Writes and returns `out`. */
export function boomPose(out: Vector3, eye: Vector3, cam: Vector3, lift: number) {
  const l = Math.max(0, lift);
  const dx = cam.x - eye.x;
  const dy = cam.y - eye.y;
  const dz = cam.z - eye.z;
  const flat = Math.hypot(dx, dz);
  if (l === 0 || flat < 1e-6) return out.copy(cam);
  const elevation = Math.atan2(dy, flat);
  const up = elevation + l * Math.max(0, Math.min(BOOM.angle, BOOM.steepest - elevation));
  const r = Math.hypot(flat, dy) * (1 - BOOM.closer * l);
  const across = (r * Math.cos(up)) / flat;
  return out.set(eye.x + dx * across, eye.y + r * Math.sin(up), eye.z + dz * across);
}

/**
 * The least lift that sees Cuso's eye from the camera at `cam`. To come down
 * below `goal` it must see him with extra air (hysteresis). `sight` false:
 * only keep the camera itself out of buildings (during a rail jump's flight,
 * when he is already at the far end).
 */
export function boomNeed(eye: Vector3, cam: Vector3, goal: number, sight = true) {
  for (let k = 0; k < BOOM.levels; k++) {
    const lift = k / BOOM.levels;
    boomPose(lifted, eye, cam, lift);
    if (sight ? sightClear(eye, lifted, lift < goal ? BOOM.air : 0) : !insideBuilding(lifted.x, lifted.y, lifted.z)) return lift;
  }
  return 1;
}

/** One step of the boom towards `need` (from boomNeed): up at once, down only after BOOM.hold seconds in sight. */
export function stepBoom(b: Boom, need: number, dt: number) {
  if (need > b.goal) {
    b.goal = need;
    b.clear = 0;
  } else if (need < b.goal) {
    b.clear += dt;
    if (b.clear >= BOOM.hold) {
      b.goal = need;
      b.clear = 0;
    }
  } else b.clear = 0;
  spring(b, b.goal, b.goal >= b.x ? BOOM.rise : BOOM.settle, dt);
  return b;
}

/** The lead cam: this far ahead of Cuso, to his side and up; how fast it swaps sides (1/s) and how long the usual side must be clear to swap back (s). */
export const LEAD = { ahead: 7, side: 3.2, up: 3.6, swap: 6, hold: 0.5 };
export const newSide = () => ({ x: 1, v: 0, goal: 1, clear: 0 });

/**
 * Which side of Cuso the lead cam stands (`x`: 1 as authored, -1 mirrored,
 * eased between): the other side when a wall stands between him and the
 * usual one (the Bay Bridge's anchorage beside the Embarcadero), back once
 * the usual side has been clear for LEAD.hold. `at(side)` is the lead cam there.
 */
export function stepSide(s: { x: number; v: number; goal: number; clear: number }, eye: Vector3, at: (side: number) => Vector3, dt: number) {
  const blocked = (side: number) => sightHit(eye, at(side)) < 1;
  if (s.goal > 0) {
    if (blocked(1) && !blocked(-1)) s.goal = -1;
    s.clear = 0;
  } else if (blocked(1)) s.clear = 0;
  else if ((s.clear += dt) >= LEAD.hold) {
    s.goal = 1;
    s.clear = 0;
  }
  spring(s, s.goal, LEAD.swap, dt);
  return s;
}

/**
 * The arm: the boom frames Cuso, the arm is the guarantee. If a building
 * still stands between his eye and the camera (the boom lags a dash, cannot
 * lift over a tall block, or the camera trails a blink), the camera comes in
 * along that line to just short of the wall, in the same frame, and eases
 * back out once clear. `x` is how much of the line it may use (0..1).
 */
export const ARM = {
  /** Spring rate (1/s) back out. */
  out: 3,
  /** Room it keeps short of the wall's air (units). */
  gap: 0.05,
};
export const newArm = () => ({ x: 1, v: 0 });

/** `cam` drawn in towards `eye` as far as the arm `a` allows this frame. Writes and returns `cam`. */
export function armPose(cam: Vector3, eye: Vector3, a: { x: number; v: number }, dt: number) {
  const hit = sightHit(eye, cam);
  const reach = hit < 1 ? Math.max(0, hit - ARM.gap / Math.max(cam.distanceTo(eye), 1e-6)) : 1;
  if (reach < a.x) {
    a.x = reach;
    a.v = 0;
  } else spring(a, reach, ARM.out, dt);
  return a.x < 1 ? cam.lerpVectors(eye, cam, a.x) : cam;
}

/**
 * One step of a critically damped spring (exact for any dt, so a slow frame
 * is a big step, not a stall): `s.x` heads for `goal` at rate `w`, `s.v` its
 * speed. Close enough, it stops dead (Explore's pins must stand still).
 */
function spring(s: { x: number; v: number }, goal: number, w: number, dt: number) {
  const e = Math.exp(-w * dt);
  const c = s.x - goal;
  const t = (s.v + w * c) * dt;
  s.v = (s.v - w * t) * e;
  s.x = goal + (c + t) * e;
  if (Math.abs(s.x - goal) < 1e-4 && Math.abs(s.v) < 1e-3) {
    s.x = goal;
    s.v = 0;
  }
}

const axis = { x: 0, v: 0 };
const AXES = ["x", "y", "z"] as const;
/** `p` follows `goal` on a critically damped spring (speed `v`): smooth even when the goal jumps (Cuso blinks). */
export function follow(p: Vector3, v: Vector3, goal: Vector3, w: number, dt: number) {
  for (const k of AXES) {
    axis.x = p[k];
    axis.v = v[k];
    spring(axis, goal[k], w, dt);
    p[k] = axis.x;
    v[k] = axis.v;
  }
}

type Pose = { pos: Vector3; tgt: Vector3 };
/** A rail jump's camera flight, from where the camera was (or from a flight still under way: a second click). Planned and timed on its first frame. */
export type Flight = { t0: number; from: Pose | { flight: Flight; to: Pose }; at: Pose; plan: Plan | null; time: number };
const clonePose = (p: Pose): Pose => ({ pos: p.pos.clone(), tgt: p.tgt.clone() });

/** Start a flight at `t0` from pose `from`, or on from `flight` (still on its way to `to`). */
export function startFlight(from: Pose | Flight, t0: number, to?: Pose): Flight {
  const at = { pos: new Vector3(), tgt: new Vector3() };
  return { t0, time: 0, from: "t0" in from ? { flight: from, to: clonePose(to ?? from.at) } : clonePose(from), at, plan: null };
}

/** Where the flight is at `now` on its way to the live shot `to` (eased, with a gentle lift). Writes `out`, returns how far (0..1). */
export function flyAt(f: Flight, now: number, to: Pose, out: Pose): number {
  let start: Pose;
  if ("flight" in f.from) {
    const old = f.from;
    flyAt(old.flight, now, old.to, f.at);
    start = f.at;
    if (now - old.flight.t0 >= old.flight.time) f.from = clonePose(old.to);
  } else start = f.from;
  if (!f.plan) {
    f.plan = flightPlan(start.pos, to.pos);
    f.time = flightTime(start.pos, to.pos, f.plan);
  }
  const t = Math.min(1, Math.max(0, (now - f.t0) / f.time));
  const u = jumpEase(f.t0, now, f.time);
  flightPoint(out.pos, start.pos, to.pos, t, f.plan);
  // the aim rises with it: it glides over the roofs looking ahead, not down at the street
  out.tgt.lerpVectors(start.tgt, to.tgt, u).y += f.plan.lift * Math.sin(Math.PI * u) * 0.85;
  return u;
}

/** Dev only: `?cam=px,py,pz,tx,ty,tz` pins the camera, for close-up screenshots of one object. */
const PIN = (() => {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
  return v?.length === 6 && v.every(Number.isFinite) ? v : null;
})();

const smoothstep =(a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The biggest free stretch of screen, top to bottom, between the things drawn
 * over the scene (`edges`: [top, bottom] in px). On phones Cuso stands in it.
 */
export function largestGap(edges: readonly (readonly [number, number])[], height: number): [number, number] {
  const sorted = [...edges].sort((p, q) => p[0] - q[0]);
  let best: [number, number] = [0, height];
  let size = -1;
  let y = 0;
  for (const [top, bottom] of [...sorted, [height, height] as const]) {
    const end = Math.min(top, height);
    if (end - y > size) {
      size = end - y;
      best = [y, end];
    }
    y = Math.max(y, bottom);
  }
  return best;
}

/** What covers the scene right now: the top bar and every card (`data-card`). */
function freeBand(height: number) {
  const edges: [number, number][] = [];
  const { header, cards } = overlays();
  for (const r of header ? [header, ...cards] : cards) {
    if (r.width > 0 && r.bottom > 0 && r.top < height) edges.push([r.top, r.bottom]);
  }
  return largestGap(edges, height);
}

/** Room kept above his head for the speech bubble, in px. */
const BUBBLE = 72;
/** Vertical field of view: upright screens see more sky and street. */
export const PORTRAIT_FOV = 52;
const screenY = (y: number, height: number) => ((1 - ndc.set(rig.cuso.x, rig.cuso.y + y, rig.cuso.z).project(probeCam).y) * height) / 2;

/**
 * Phones: pull back until Cuso (at rig.cuso) and his bubble fit the free band
 * ([top, bottom] in px), then return how far (px) to slide the picture so he
 * stands in the middle of it. Moves `camPos`.
 */
export function fitBand(camPos: Vector3, camTgt: Vector3, fov: number, size: { width: number; height: number }, [top, bottom]: [number, number]) {
  probeCam.fov = fov;
  probeCam.aspect = size.width / size.height;
  probeCam.updateProjectionMatrix();
  const aim = () => {
    probeCam.position.copy(camPos);
    probeCam.lookAt(camTgt);
    probeCam.updateMatrixWorld();
  };
  aim();
  const room = Math.max(48, (bottom - top) * 0.85 - BUBBLE);
  const tall = screenY(0, size.height) - screenY(1.9, size.height);
  if (tall > room) camPos.sub(camTgt).multiplyScalar(Math.min(2, tall / room)).add(camTgt);
  aim();
  const middle = (screenY(1.9, size.height) - BUBBLE + screenY(0, size.height)) / 2;
  return middle - (top + bottom) / 2;
}

/**
 * Cuso's box on screen (left,top,right,bottom in px) as `data-cuso` on the
 * canvas, so tests can check that no card covers him.
 */
function publishCuso(canvas: HTMLCanvasElement, camera: Camera, height: number) {
  camera.updateMatrixWorld();
  const head = ndc.set(rig.cuso.x, rig.cuso.y + 1.9, rig.cuso.z).project(camera);
  const top = ((1 - head.y) * height) / 2;
  const feet = ndc.set(rig.cuso.x, rig.cuso.y, rig.cuso.z).project(camera);
  const bottom = ((1 - feet.y) * height) / 2;
  const x = ((feet.x + 1) * canvas.clientWidth) / 2;
  const half = (bottom - top) / 3; // he is about two thirds as wide as he is tall
  const box = [x - half, top, x + half, bottom].map(Math.round).join(",");
  if (canvas.dataset.cuso !== box) canvas.dataset.cuso = box;
}

/**
 * `a` towards `b` by t, going round `center` (Cuso) rather than straight: the
 * lead cam in front of him and the shot behind him would otherwise blend
 * through him. Writes `a`.
 */
export function orbitLerp(a: Vector3, center: Vector3, b: Vector3, t: number) {
  const ax = a.x - center.x;
  const az = a.z - center.z;
  const bx = b.x - center.x;
  const bz = b.z - center.z;
  const ya = Math.atan2(ax, az);
  const turn = Math.atan2(bx, bz) - ya;
  const yaw = ya + Math.atan2(Math.sin(turn), Math.cos(turn)) * t;
  const flat = Math.hypot(ax, az) + (Math.hypot(bx, bz) - Math.hypot(ax, az)) * t;
  return a.set(center.x + Math.sin(yaw) * flat, a.y + (b.y - a.y) * t, center.z + Math.cos(yaw) * flat);
}

const live: Pose = { pos, tgt };
const flown: Pose = { pos: new Vector3(), tgt: new Vector3() };
/** How quickly the camera follows its shot (spring rates, 1/s). */
const FOLLOW = { story: 5, explore: 3.2, eye: 8 };

/**
 * The camera rides with Cuso while the lead cam follows him (`couple` 1): it
 * follows its goal as an offset from a point that moves with him, on a spring,
 * so it keeps up however fast he goes (a spring alone trails a dashing Cuso by
 * 9 units and loses him) while shot changes and the lead cam swinging round a
 * corner stay smooth. At a chapter's shot (`couple` 0) his hops do not move
 * it. When he jumps (a blink, a rail jump's pop) the camera stays put and
 * eases over.
 */
export type Trail = { anchor: Vector3; rel: Vector3; v: Vector3; last: Vector3 | null; out: Vector3 };
export const newTrail = (): Trail => ({ anchor: new Vector3(), rel: new Vector3(), v: new Vector3(), last: null, out: new Vector3() });
/** He moved more than this in one frame: a jump, not a step. */
const JUMPED = 1.5;

/** One step: where the trailing point is now, given Cuso at `cuso` and the goal `goal`. */
export function trail(t: Trail, cuso: Vector3, goal: Vector3, couple: number, w: number, dt: number) {
  if (!t.last) {
    t.anchor.copy(cuso);
    t.rel.subVectors(goal, cuso);
    t.last = cuso.clone();
  }
  const step = t.out.subVectors(cuso, t.last);
  if (step.length() <= JUMPED) t.anchor.addScaledVector(step, couple);
  t.last.copy(cuso);
  follow(t.rel, t.v, t.out.subVectors(goal, t.anchor), w, dt);
  return t.out.addVectors(t.anchor, t.rel);
}

/** Put the trailing point at `at` (at rest), e.g. where a flight ends. */
function place(t: Trail, cuso: Vector3, at: Vector3) {
  t.anchor.copy(cuso);
  t.rel.subVectors(at, cuso);
  t.v.set(0, 0, 0);
  t.last = (t.last ?? new Vector3()).copy(cuso);
}

export function CameraRig() {
  const me = useRef({
    /** Where the camera stands and looks before the boom: damped towards the shot, or flown on a rail jump. */
    base: null as Vector3 | null,
    look: new Vector3(),
    baseT: newTrail(),
    lookT: newTrail(),
    eyeT: newTrail(),
    slide: 0,
    boom: newBoom(),
    arm: newArm(),
    side: newSide(),
    flight: null as Flight | null,
    jumpAt: -1,
    blinks: 0,
    /** The chapter a rail jump landed on: its shot holds (no lead cam) until the page scrolls away. */
    held: -1,
  });

  useFrame(({ camera, size, gl }, delta) => {
    const r = me.current;
    // Not clamped: every step is exact for any dt. Software WebGL draws a frame every
    // second or two; clamped, the camera would take minutes to settle.
    const dt = Math.max(0, delta);
    const day = dayNow();
    const { jump, progress } = useCity.getState();
    const now = performance.now() / 1000;
    const portrait = size.width < size.height;
    const phone = portrait && size.width < 768;
    let slideTo = 0;
    let chase = 0;
    const cam = camera as PerspectiveCamera;
    const fov = portrait ? PORTRAIT_FOV : 35;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // A rail jump: fly from wherever the camera is, or on from the flight still under way.
    if (jump && jump.at !== r.jumpAt) {
      r.jumpAt = jump.at;
      r.held = jump.index;
      if (r.base && !r.flight) {
        // fly from where the camera really is: take the boom's swing into the flight
        r.base.copy(camera.position);
        Object.assign(r.boom, newBoom());
      }
      r.flight = jump.cut || !r.base ? null : r.flight ? startFlight(r.flight, jump.at, live) : startFlight({ pos: r.base, tgt: r.look }, jump.at);
      if (jump.cut) r.base = null;
    }
    // He blinked ahead: fly after him over the roofs, like a rail jump (eased, the camera crossed the blocks between).
    if (rig.blinks !== r.blinks) {
      r.blinks = rig.blinks;
      if (r.base && !r.flight && day.mode !== "explore") {
        r.base.copy(camera.position);
        Object.assign(r.boom, newBoom());
        r.flight = startFlight({ pos: r.base, tgt: r.look }, now);
      }
    }
    if (r.held >= 0 && (Math.abs(progress - r.held) > 0.01 || day.mode === "explore")) r.held = -1;

    if (day.mode === "explore") {
      // The fitted overview, moved and zoomed by the visitor (drag, pinch, wheel).
      const f = fitOverview(size.width / size.height, cam.fov);
      const { pan, zoom } = usePan.getState();
      tgt.copy(f.tgt).add(tmp.set(pan.x, 0, pan.z));
      pos.subVectors(f.pos, f.tgt).multiplyScalar(zoom).add(tgt);
    } else {
      // Follow where Cuso really is (he walks at his own pace behind the scroll).
      // After a rail jump: the chapter's own shot while he walks his last steps in.
      const tv = rig.travel;
      const a = chapters[r.held >= 0 ? r.held : tv.leg];
      const b = r.held >= 0 ? a : chapters[Math.min(tv.leg + 1, chapters.length - 1)];
      const t = r.held >= 0 ? 0 : smoothstep(0, 1, tv.t);
      const shotA = phone ? a.phone : a.camera;
      const shotB = phone ? b.phone : b.camera;
      setLerp(pos, shotA.position, shotB.position, t);
      setLerp(tgt, shotA.target, shotB.target, t);
      // Lead cam: ahead of Cuso and off to one side, so we see his face (and his
      // arrow the right way round) as he walks towards us. From a few steps out
      // until the last stretch, where the next shot takes over (the lead cam
      // would stand inside the building he is about to jump onto).
      chase = r.held >= 0 ? 0 : smoothstep(1, 7, tv.s) * (1 - smoothstep(tv.length - 12, tv.length - 2, tv.s));
      if (chase > 0) {
        const h = rig.heading;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        const lead = (side: number) => chasePos.set(rig.cuso.x + fx * LEAD.ahead + fz * LEAD.side * side, rig.cuso.y + LEAD.up, rig.cuso.z + fz * LEAD.ahead - fx * LEAD.side * side);
        stepSide(r.side, tmp.set(rig.cuso.x, rig.cuso.y + 1.4, rig.cuso.z), lead, dt);
        lead(r.side.x);
        chaseTgt.set(rig.cuso.x - fx * 1.5, rig.cuso.y + 1.1, rig.cuso.z - fz * 1.5);
        orbitLerp(pos, tmp.set(rig.cuso.x, rig.cuso.y + 1.1, rig.cuso.z), chasePos, chase);
        tgt.lerp(chaseTgt, chase);
      }
      if (phone) {
        slideTo = fitBand(pos, tgt, fov, size, freeBand(size.height));
      } else if (portrait) {
        // Tablets upright: Cuso centred and a step back. The hero card sits on
        // top, so Cuso goes low; everywhere else he goes high.
        const low = (id: string) => (id === "arrive" ? 2.4 : -0.2);
        tgt.lerp(tmp.copy(rig.cuso).setY(rig.cuso.y + low(a.id) + (low(b.id) - low(a.id)) * t), 0.7);
        pos.sub(tgt).multiplyScalar(1.3).add(tgt);
      }
      // A little parallax with the pointer.
      right.subVectors(tgt, pos).cross(up).normalize();
      pos.addScaledVector(right, rig.pointer.x * 0.35).addScaledVector(up, rig.pointer.y * 0.2);
    }

    if (PIN) {
      pos.set(PIN[0], PIN[1], PIN[2]);
      tgt.set(PIN[3], PIN[4], PIN[5]);
      r.base = null;
      r.flight = null;
    }

    if (!r.base) {
      r.base = pos.clone();
      r.look.copy(tgt);
      place(r.baseT, rig.cuso, r.base);
      place(r.lookT, rig.cuso, r.look);
    }
    if (!rig.placed) {
      // He is not in the scene yet (his model is loading): start following from where he appears, not from the origin.
      r.baseT.last = r.lookT.last = r.eyeT.last = null;
    }
    if (r.flight) {
      const u = flyAt(r.flight, now, live, flown);
      r.base.copy(flown.pos);
      r.look.copy(flown.tgt);
      place(r.baseT, rig.cuso, r.base); // a flight ends at rest
      place(r.lookT, rig.cuso, r.look);
      if (u >= 1) r.flight = null;
    } else {
      const w = day.mode === "explore" ? FOLLOW.explore : FOLLOW.story;
      // rides with him as much as the lead cam is in play
      r.base.copy(trail(r.baseT, rig.cuso, pos, chase, w, dt));
      r.look.copy(trail(r.lookT, rig.cuso, tgt, chase, w, dt));
    }
    const k = damp(3.2, dt);
    // Slide the picture (not the camera) so Cuso sits in the free band.
    r.slide += (slideTo - r.slide) * k;
    if (Math.abs(r.slide) > 0.5) cam.setViewOffset(size.width, size.height, 0, r.slide, size.width, size.height);
    else if (cam.view?.enabled) cam.clearViewOffset();

    // The boom keeps Cuso in sight (and the camera out of buildings): it checks where the
    // camera is and where it is heading, so it starts to rise before a wall comes between them.
    let need = 0;
    if (day.mode !== "explore" && !PIN && rig.placed) {
      // the boom swings around his eye; when he pops somewhere else it eases over, so the camera does not jump
      eye.copy(trail(r.eyeT, rig.cuso, tmp.set(rig.cuso.x, rig.cuso.y + 1.4, rig.cuso.z), 1, FOLLOW.eye, dt));
      // Mid-flight he is already at the far end (a swing around him would throw the camera
      // about): only keep the camera out of buildings.
      need = r.flight ? boomNeed(eye, r.base, r.boom.goal, false) : Math.max(boomNeed(eye, r.base, r.boom.goal), boomNeed(eye, pos, r.boom.goal));
    }
    stepBoom(r.boom, need, dt);
    boomPose(camera.position, eye, r.base, r.boom.x);
    // mid-flight he is at the far end: the flight keeps over the roofs itself
    if (day.mode !== "explore" && !PIN && rig.placed && !r.flight) armPose(camera.position, eye, r.arm, dt);
    // swung in close, it looks at him (the shot's aim is past him: he would drop out of the bottom)
    rig.target.lerpVectors(r.look, tmp.copy(eye).setY(eye.y - 0.4), Math.min(1, Math.max(0, r.boom.x) * 2));
    camera.lookAt(rig.target);
    publishCuso(gl.domElement, camera, size.height);
  });

  return null;
}
