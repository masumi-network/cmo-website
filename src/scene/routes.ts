// How Cuso gets from one chapter to the next: down from where he stands to
// the street, along walking streets (shortest way on the grid), then up to the
// next spot. Near each place he walks; long street stretches are a quick
// cursor "dash"; roofs, the cable car, the pier and the pyramid tip are jumps.
// Jumps go over things, never through them (tests/unit/collision.test.ts):
// onto a tall building he leaps straight up beside the wall, to a point above
// the cornice and parapet, then hops over onto the roof. At a junction he
// crosses on a crosswalk, down and up its curb ramps; mid-block he hops the kerb.

import { chapters, type ChapterId, type Vec3 } from "@/content/day";
import { surfaceAt } from "@/lib/terrain";
import { SPEED } from "./gait";
import { STREET, WALK_OFFSET, WALK_X, WALK_Z, X_STREETS, Z_STREETS, streetDrop } from "./grid";

export type Mode = "walk" | "dash" | "jump";

/** How a move arrives at `p`. "street" becomes walk near the ends, dash in between. `face`: a fixed heading for the move. */
type Step = { p: Vec3; how?: "walk" | "jump" | "street"; face?: number };

/** Walk this far at each end of a street stretch before/after dashing. */
const WALK_ENDS = 4;

const ground = (x: number, z: number): Step => ({ p: [x, surfaceAt(x, z), z] });
const lineZ = (z: number) => z + WALK_OFFSET; // walking line on an east-west street
// walking line on a north-south street; on the waterfront (x 29) it keeps
// clear of the pier deck and the Ferry Building's plinth, which reach x 30.9
const lineX = (x: number) => x + WALK_OFFSET - (x === 29 ? 0.4 : 0);
const RUSSIAN_HILL_ROOF = chapters[0].spot[1];
const UNION_SQUARE_ROOF = chapters[3].spot[1];
const PYRAMID_TIP = chapters[4].spot[1];

/** From a walking line to the chapter's spot (the spot itself is added after). */
const ROOFTOP_WAY: Step[] = [
  ground(-14, lineZ(-6)),
  ground(-14, -6.85), // clear of the cornice (it sticks out to z -7.16)
  { p: [-14, RUSSIAN_HILL_ROOF + 0.6, -6.85], how: "jump" }, // up past the cornice, above the parapet
  { p: [-14, RUSSIAN_HILL_ROOF, -8.2], how: "jump" }, // over it, onto the roof
];
const APPROACH: Record<ChapterId, Step[]> = {
  arrive: ROOFTOP_WAY,
  learn: [ground(-9.6, lineZ(14))],
  social: [ground(lineX(-3), 29.6)],
  ads: [ground(5.6, lineZ(14)), ground(5.6, 12.2), { p: [5.6, UNION_SQUARE_ROOF + 0.5, 12.2], how: "jump" }, { p: [5.6, UNION_SQUARE_ROOF, 11.2], how: "jump" }],
  // up beside the pyramid's south face to just above the platform's edge, then a hop to the middle
  seo: [ground(6.5, lineZ(-6)), ground(6.5, -7.0), { p: [6.5, PYRAMID_TIP + 0.5, -10.1], how: "jump" }],
  newsletter: [ground(19.95, lineZ(4))],
  night: [ground(lineX(29), 24.2), { p: [31.4, 0.55, 24.2], how: "jump" }],
  join: ROOFTOP_WAY,
};
/** Moves onto the spot that are jumps (the pyramid tip, the cable car step). */
const JUMP_TO_SPOT: ChapterId[] = ["seo", "newsletter"];
/**
 * Spots he faces a fixed way on (and hops on and off facing it) instead of
 * turning to the camera. The cable car's running board is too narrow to turn
 * on: he rides it facing out, his back to the car.
 */
export const FACE: Partial<Record<ChapterId, number>> = { newsletter: 0 };

type Node = { x: number; z: number; lines: string[] };

const linesOf = (x: number, z: number) => [
  ...WALK_Z.filter((s) => Math.abs(lineZ(s) - z) < 1e-6).map((s) => `z${s}`),
  ...WALK_X.filter((s) => Math.abs(lineX(s) - x) < 1e-6).map((s) => `x${s}`),
];

/** Shortest walk between two points on walking lines (Dijkstra on the small grid). */
function streetWalk(from: Vec3, to: Vec3): Step[] {
  const nodes: Node[] = [
    { x: from[0], z: from[2], lines: linesOf(from[0], from[2]) },
    { x: to[0], z: to[2], lines: linesOf(to[0], to[2]) },
  ];
  for (const sx of WALK_X) for (const sz of WALK_Z) nodes.push({ x: lineX(sx), z: lineZ(sz), lines: [`x${sx}`, `z${sz}`] });
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    nodes.forEach((_, i) => {
      if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    });
    if (u < 0 || u === 1) break;
    done[u] = true;
    nodes.forEach((n, v) => {
      if (done[v] || !n.lines.some((l) => nodes[u].lines.includes(l))) return;
      const d = dist[u] + Math.hypot(n.x - nodes[u].x, n.z - nodes[u].z);
      if (d < dist[v]) {
        dist[v] = d;
        prev[v] = u;
      }
    });
  }
  if (prev[1] < 0) throw new Error("no walking route");
  const order: number[] = [];
  for (let v = 1; v >= 0; v = prev[v]) order.unshift(v);
  return order.slice(1, -1).map((i) => ({ ...ground(nodes[i].x, nodes[i].z), how: "street" as const }));
}

function routeSteps(a: number, b: number): Step[] {
  const A = chapters[a];
  const B = chapters[b];
  const out = [...APPROACH[A.id]].reverse();
  // Leaving retraces the approach: a jump in is a jump out.
  const leave: Step[] = [{ p: A.spot }];
  out.forEach((s, i) => leave.push({ p: s.p, how: (i === 0 ? JUMP_TO_SPOT.includes(A.id) : out[i - 1].how === "jump") ? "jump" : "walk", face: i === 0 ? FACE[A.id] : undefined }));
  const inn = APPROACH[B.id].map((s, i) => (i === 0 ? { ...s, how: "street" as const } : s));
  const middle = streetWalk(leave[leave.length - 1].p, inn[0].p);
  return [...leave, ...middle, ...inn, { p: B.spot, how: JUMP_TO_SPOT.includes(B.id) ? "jump" : "walk", face: FACE[B.id] }];
}

/** `modes[i]` / `ground[i]` / `face[i]`: how the move arriving at point i goes, whether it follows the terrain, a fixed heading. */
export type Path = { points: Vec3[]; modes: Mode[]; ground: boolean[]; face: (number | null)[]; cum: number[]; length: number };

function makePath(steps: Step[]): Path {
  const points: Vec3[] = [steps[0].p];
  const how: Step["how"][] = ["walk"];
  const ground: boolean[] = [false];
  const face: (number | null)[] = [null];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1].p;
    const b = steps[i].p;
    const h = steps[i].how ?? "walk";
    const onGround = h !== "jump" && Math.abs(a[1] - surfaceAt(a[0], a[2])) < 1e-6 && Math.abs(b[1] - surfaceAt(b[0], b[2])) < 1e-6;
    const n = onGround ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.5)) : 1;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      points.push(onGround ? [x, surfaceAt(x, z), z] : [x, a[1] + (b[1] - a[1]) * t, z]);
      how.push(h);
      ground.push(onGround);
      face.push(steps[i].face ?? null);
    }
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0, z0] = points[i - 1];
    const [x1, y1, z1] = points[i];
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, how[i] === "jump" ? y1 - y0 : 0, z1 - z0));
  }
  // Street stretches: walk near both ends, dash in the middle.
  const modes: Mode[] = how.map((h) => (h === "jump" ? "jump" : "walk"));
  let i = 1;
  while (i < how.length) {
    if (how[i] !== "street") {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < how.length && how[j + 1] === "street") j++;
    const start = cum[i - 1];
    const end = cum[j];
    for (let k = i; k <= j; k++) modes[k] = cum[k] - start > WALK_ENDS && end - cum[k - 1] > WALK_ENDS ? "dash" : "walk";
    i = j + 1;
  }
  return { points, modes, ground, face, cum, length: cum[cum.length - 1] };
}

/** One path per move: PATHS[i] goes from chapter i to chapter i + 1. */
export const PATHS: Path[] = chapters.slice(1).map((_, i) => makePath(routeSteps(i, i + 1)));

/** Where each move starts on one long line through the whole day (in world units). */
export const LEG_START: number[] = PATHS.map((_, i) => PATHS.slice(0, i).reduce((sum, p) => sum + p.length, 0));
export const DAY_LENGTH = PATHS.reduce((s, p) => s + p.length, 0);

/** Distance along the day for scroll position: move `from` at progress t (0..1), or resting at chapter `from`. */
export const dayDistance = (from: number, t: number) => (from >= PATHS.length ? DAY_LENGTH : LEG_START[from] + t * PATHS[from].length);

export type Sample = {
  pos: Vec3;
  /** Facing angle around Y (towards where the path goes next). */
  heading: number;
  /** Distance along this move. */
  s: number;
  mode: Mode;
  /** 0..1 through the current segment (the jump arc uses it). */
  u: number;
  /** A fixed heading for this move (see FACE), or null: face where he goes. */
  face: number | null;
};

/** He hops a kerb: up this far before it, down this far after it. */
export const HOP = 0.25;
const KERB_LINES = [X_STREETS, Z_STREETS].map((streets) => streets.flatMap((s) => [s - STREET / 2, s + STREET / 2]));

/**
 * How far above the ground his feet are at x, z, heading dx, dz, for a kerb
 * he is crossing: on the low side, within HOP of it, still part way up (all
 * the way at the kerb), so he steps down late and up early, never through the
 * kerb. Nothing where a curb ramp makes the kerb flush.
 */
function kerbHop(x: number, z: number, dx: number, dz: number) {
  let lift = 0;
  KERB_LINES.forEach((lines, axis) => {
    const [p, d] = axis ? [z, dz] : [x, dx];
    if (Math.abs(d) < 1e-6) return;
    for (const k of lines) {
      const e = (k - p) / d; // along the way to the kerb line
      if (Math.abs(e) > HOP) continue;
      const beyond = e + Math.sign(e || 1) * 1e-3;
      const step = streetDrop(x, z) - streetDrop(x + dx * beyond, z + dz * beyond);
      if (step > 0) lift = Math.max(lift, step * (1 - Math.abs(e) / HOP) ** 2);
    }
  });
  return lift;
}

export function samplePath(path: Path, t: number): Sample {
  const s = Math.min(1, Math.max(0, t)) * path.length;
  let i = 1;
  while (i < path.cum.length - 1 && path.cum[i] < s) i++;
  const a = path.points[i - 1];
  const b = path.points[i];
  const seg = path.cum[i] - path.cum[i - 1] || 1;
  const u = Math.min(1, Math.max(0, (s - path.cum[i - 1]) / seg));
  const pos: [number, number, number] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  const mode = path.modes[i];
  const across = Math.hypot(b[0] - a[0], b[2] - a[2]);
  if (path.ground[i]) pos[1] = surfaceAt(pos[0], pos[2]) + (across > 1e-6 ? kerbHop(pos[0], pos[2], (b[0] - a[0]) / across, (b[2] - a[2]) / across) : 0);
  if (mode === "jump" && across > 1e-6) pos[1] += Math.sin(Math.PI * u) * (1.2 + across * 0.3);
  // straight up beside a wall: fast off the ground, slowing at the top; straight down: falling faster
  else if (mode === "jump") pos[1] = a[1] + (b[1] - a[1]) * (b[1] > a[1] ? 1 - (1 - u) ** 2 : u * u);
  const heading = Math.atan2(b[0] - a[0], b[2] - a[2]);
  return { pos, heading, s, mode, u, face: path.face[i] };
}

/** Sample anywhere on the day line: which move, and where on it. */
export function sampleDay(distance: number): Sample & { leg: number; t: number } {
  const d = Math.min(DAY_LENGTH, Math.max(0, distance));
  let leg = 0;
  while (leg < PATHS.length - 1 && LEG_START[leg + 1] <= d) leg++;
  const t = (d - LEG_START[leg]) / PATHS[leg].length;
  return { ...samplePath(PATHS[leg], t), leg, t };
}

/** Further than this behind the scroll, he blinks there instead of walking. */
export const TELEPORT = 70;

/**
 * Where he is `dt` seconds on from day distance `d` on his way to `target`:
 * at the pace of the stretch he is on (walk, dash, jump), slowing as he
 * arrives; straight there if he is more than TELEPORT behind.
 */
export function walkOn(d: number, target: number, dt: number) {
  const gap = target - d;
  if (Math.abs(gap) > TELEPORT) return target;
  const speed = Math.min(SPEED[sampleDay(d).mode], Math.abs(gap) * 3 + 0.6);
  return Math.min(DAY_LENGTH, Math.max(0, d + Math.sign(gap) * Math.min(Math.abs(gap), speed * dt)));
}
