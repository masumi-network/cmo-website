// How Cuso gets from one chapter to the next: down from where he stands to
// the street, along walking streets (shortest way on the grid), then up to the
// next spot. Near each place he walks; long street stretches are a quick
// cursor "dash"; roofs, the cable car, the pier and the pyramid tip are jumps.

import { chapters, type ChapterId, type Vec3 } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { WALK_OFFSET, WALK_X, WALK_Z } from "./grid";

export type Mode = "walk" | "dash" | "jump";

/** How a move arrives at `p`. "street" becomes walk near the ends, dash in between. */
type Step = { p: Vec3; how?: "walk" | "jump" | "street" };

/** Walk this far at each end of a street stretch before/after dashing. */
const WALK_ENDS = 4;

const ground = (x: number, z: number): Step => ({ p: [x, heightAt(x, z), z] });
const lineZ = (z: number) => z + WALK_OFFSET; // walking line on an east-west street
const lineX = (x: number) => x + WALK_OFFSET; // walking line on a north-south street

/** From a walking line to the chapter's spot (the spot itself is added after). */
const APPROACH: Record<ChapterId, Step[]> = {
  arrive: [ground(-14, lineZ(-6)), ground(-14, -6.9), { p: [-14, chapters[0].spot[1], -8.2], how: "jump" }],
  learn: [ground(-9.6, lineZ(14))],
  social: [ground(lineX(-3), 29.6)],
  ads: [ground(5.6, lineZ(14)), ground(5.6, 12.2), { p: [5.6, chapters[3].spot[1], 11.2], how: "jump" }],
  seo: [ground(6.5, lineZ(-6)), ground(6.5, -7.0)],
  newsletter: [ground(20.9, lineZ(4))],
  night: [ground(lineX(29), 24.2), { p: [31.4, 0.55, 24.2], how: "jump" }],
  join: [ground(-14, lineZ(-6)), ground(-14, -6.9), { p: [-14, chapters[7].spot[1], -8.2], how: "jump" }],
};
/** Moves onto the spot that are jumps (the pyramid tip, the cable car step). */
const JUMP_TO_SPOT: ChapterId[] = ["seo", "newsletter"];

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
  out.forEach((s, i) => leave.push({ p: s.p, how: (i === 0 ? JUMP_TO_SPOT.includes(A.id) : out[i - 1].how === "jump") ? "jump" : "walk" }));
  const inn = APPROACH[B.id].map((s, i) => (i === 0 ? { ...s, how: "street" as const } : s));
  const middle = streetWalk(leave[leave.length - 1].p, inn[0].p);
  return [...leave, ...middle, ...inn, { p: B.spot, how: JUMP_TO_SPOT.includes(B.id) ? "jump" : "walk" }];
}

/** `modes[i]` / `ground[i]`: how the move arriving at point i goes, and whether it follows the terrain. */
export type Path = { points: Vec3[]; modes: Mode[]; ground: boolean[]; cum: number[]; length: number };

function makePath(steps: Step[]): Path {
  const points: Vec3[] = [steps[0].p];
  const how: Step["how"][] = ["walk"];
  const ground: boolean[] = [false];
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1].p;
    const b = steps[i].p;
    const h = steps[i].how ?? "walk";
    const onGround = h !== "jump" && Math.abs(a[1] - heightAt(a[0], a[2])) < 1e-6 && Math.abs(b[1] - heightAt(b[0], b[2])) < 1e-6;
    const n = onGround ? Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.5)) : 1;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      points.push(onGround ? [x, heightAt(x, z), z] : [x, a[1] + (b[1] - a[1]) * t, z]);
      how.push(h);
      ground.push(onGround);
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
  return { points, modes, ground, cum, length: cum[cum.length - 1] };
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
};

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
  if (path.ground[i]) pos[1] = heightAt(pos[0], pos[2]);
  if (mode === "jump") pos[1] += Math.sin(Math.PI * u) * (1.2 + Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.3);
  const heading = Math.atan2(b[0] - a[0], b[2] - a[2]);
  return { pos, heading, s, mode, u };
}

/** Sample anywhere on the day line: which move, and where on it. */
export function sampleDay(distance: number): Sample & { leg: number; t: number } {
  const d = Math.min(DAY_LENGTH, Math.max(0, distance));
  let leg = 0;
  while (leg < PATHS.length - 1 && LEG_START[leg + 1] <= d) leg++;
  const t = (d - LEG_START[leg]) / PATHS[leg].length;
  return { ...samplePath(PATHS[leg], t), leg, t };
}
