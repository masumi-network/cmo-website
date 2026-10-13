// The bridge decks and the roads at their four ends. Pure data and geometry
// (rendered in landmarks.tsx), tested in roads.test.ts.
//
// Each road starts where its level main deck ends and goes on, at the deck's
// width and with its centre line, to a road on land:
// - Golden Gate south: over its anchorage, round a bend over the shore and
//   down onto the Marina street (z -36), which runs east into the grid.
// - Golden Gate north: MARIN_ROAD, cut and filled into the headlands (terrain.ts).
// - Bay Bridge west: down its side span to the SF anchorage, then a viaduct
//   along the z 14 street that lands at the x 13 junction.
// - Bay Bridge east: down its side span into the Yerba Buena Island tunnel.

import { BufferGeometry, Float32BufferAttribute } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Vec3 } from "@/content/day";
import { MARIN_ROAD, headlandHeight, surfaceAt } from "@/lib/terrain";
import { EDGE, KERB, LAND, STREET, X_STREETS, Z_STREETS, insideLand } from "./grid";

/** Road surface on both main decks. */
export const DECK_Y = 7;
/** As wide as the decks and the city streets (two lanes). */
export const ROAD_WIDTH = STREET;
/** Steepest any approach gets (SF streets here go to 0.36). */
export const MAX_GRADE = 0.32;
/** Depth of a viaduct slab under the road surface. */
export const SLAB = 0.6;
/** Piers in the water stand on this. */
const SEA_FLOOR = -1.2;
/** Lane marks: dash and gap length, like the street texture. */
const DASH = 1.4;

/** Yerba Buena Island: the dome bay.tsx draws (HILLS[0], tested to match). */
export const ISLAND = { x: 142, z: 14, r: 9, h: 7.5, y: -0.6 };
const islandHeight = (x: number, z: number) => {
  const d = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  return d < 1 ? ISLAND.y + ISLAND.h * Math.sqrt(1 - d * d) : -Infinity;
};

export type Road = {
  name: string;
  /** Centre line, about every half unit (Marin: every unit); y is the road surface. */
  points: Vec3[];
  /** points[0..span] are a steel side span (drawn with its bridge); the rest is a concrete approach. */
  span: number;
  /** Ground or sea floor under x, z. */
  ground: (x: number, z: number) => number;
  /** Ends in a tunnel portal (the last point). */
  tunnel?: boolean;
};

function segmentDistance(px: number, pz: number, [ax, az]: number[], [bx, bz]: number[]) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
const nearShore = (x: number, z: number) => LAND.some((p, i) => segmentDistance(x, z, LAND[(i + LAND.length - 1) % LAND.length], p) < 0.7);
/** City ground (streets a kerb below their sidewalks), the sea wall's top, or the sea floor. */
const cityGround = (x: number, z: number) => (insideLand(x, z) || nearShore(x, z) ? surfaceAt(x, z) : SEA_FLOOR);
const islandGround = (x: number, z: number) => Math.max(SEA_FLOOR, islandHeight(x, z));

type Op = ["line", number] | ["arc", number, number];
/** A centre line from `start` heading `deg` (0 = +x, 90 = +z): lines and arcs (radius, turn in degrees), every half unit. */
function trace(start: [number, number], deg: number, ops: Op[]) {
  let [x, z] = start;
  let a = (deg * Math.PI) / 180;
  const out: [number, number][] = [[x, z]];
  for (const op of ops) {
    const turn = op[0] === "arc" ? (op[2] * Math.PI) / 180 : 0;
    const len = op[0] === "arc" ? op[1] * Math.abs(turn) : op[1];
    const n = Math.max(1, Math.round(len / 0.5));
    // each step is a chord of the arc, so the arc ends exactly where it should
    const step = turn ? 2 * op[1] * Math.sin(Math.abs(turn) / n / 2) : len / n;
    for (let k = 0; k < n; k++) {
      a += turn / n / 2;
      x += Math.cos(a) * step;
      z += Math.sin(a) * step;
      a += turn / n / 2;
      out.push([x, z]);
    }
  }
  return out;
}

/**
 * Heights from the deck (level, DECK_Y) down to `endY`: as late as each
 * stretch's steepest grade allows, then rounded over a 3 unit window, so it
 * leaves the deck and meets the end level, with no kinks.
 */
function descend(xz: [number, number][], endY: number, maxGrade: (s: number) => number) {
  const W = 3;
  const s = xz.map(() => 0);
  for (let i = 1; i < xz.length; i++) s[i] = s[i - 1] + Math.hypot(xz[i][0] - xz[i - 1][0], xz[i][1] - xz[i - 1][1]);
  const L = s[s.length - 1];
  const ideal = s.map(() => endY);
  for (let i = s.length - 2; i >= 0; i--) if (s[i] < L - W / 2) ideal[i] = Math.min(DECK_Y, ideal[i + 1] + maxGrade(s[i]) * (s[i + 1] - s[i]));
  const at = (t: number) => {
    if (t <= 0) return DECK_Y;
    if (t >= L) return endY;
    let i = 1;
    while (s[i] < t) i++;
    return ideal[i - 1] + ((ideal[i] - ideal[i - 1]) * (t - s[i - 1])) / (s[i] - s[i - 1]);
  };
  const N = 30;
  return xz.map(([x, z], i): Vec3 => {
    let sum = 0;
    for (let k = 0; k <= N; k++) sum += at(s[i] - W / 2 + (W * k) / N);
    return [x, sum / (N + 1), z];
  });
}

const ggSouth = trace([-80, -52], 90, [["line", 10], ["arc", 6, -90], ["line", 6]]);
const bayWest = trace([52, 14], 180, [["line", 52 - 14.5]]);
/** The tunnel portal: where the road, at 1.4, meets the island's west flank. */
const PORTAL_Y = 1.4;
const PORTAL_X = ISLAND.x - ISLAND.r * Math.sqrt(1 - ((PORTAL_Y - ISLAND.y) / ISLAND.h) ** 2);
const bayEast = trace([106, 14], 0, [["line", PORTAL_X - 106]]);
const spanEnd = (xz: [number, number][], x: number) => xz.findIndex(([px]) => Math.abs(px - x) < 0.26);

/** Bay Bridge anchorages, where the side spans end: west at the SF sea wall, east in the bay. */
export const BAY_ANCHORS = [32.7, 124];

export const ROADS: Road[] = [
  // Tucked just under the street at its end (a kerb below the sidewalks), so the ground's asphalt takes over.
  { name: "golden-gate-south", points: descend(ggSouth, -KERB - 0.04, () => MAX_GRADE), span: 0, ground: cityGround },
  { name: "golden-gate-north", points: MARIN_ROAD.map(([x, y, z]): Vec3 => [x, y, z]), span: 0, ground: headlandHeight },
  {
    name: "bay-bridge-west",
    points: descend(bayWest, -KERB - 0.04, (s) => (52 - s > BAY_ANCHORS[0] ? 0.12 : MAX_GRADE)),
    span: spanEnd(bayWest, BAY_ANCHORS[0]),
    ground: cityGround,
  },
  {
    name: "bay-bridge-east",
    points: descend(bayEast, PORTAL_Y, (s) => (106 + s < BAY_ANCHORS[1] ? 0.2 : MAX_GRADE)),
    span: spanEnd(bayEast, BAY_ANCHORS[1]),
    ground: islandGround,
    tunnel: true,
  },
];

/** The level main decks: Golden Gate between its anchorages, Bay Bridge between its end towers. */
export const DECKS: { points: Vec3[] }[] = [
  { points: [[-80, DECK_Y, -52], [-80, DECK_Y, -152]] },
  { points: [[52, DECK_Y, 14], [106, DECK_Y, 14]] },
];

/** Road surface height of the Bay Bridge deck at x (level between the towers, then down the side spans). */
export function bayDeckY(x: number) {
  const r = ROADS.find((road) => road.name === (x < 52 ? "bay-bridge-west" : "bay-bridge-east"));
  if (!r || (x >= 52 && x <= 106)) return DECK_Y;
  const p = r.points;
  for (let i = 1; i < p.length; i++) {
    const [x0, y0] = p[i - 1];
    const [x1, y1] = p[i];
    if ((x - x0) * (x - x1) <= 0) return x0 === x1 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return p[p.length - 1][1];
}

/** Every road surface by name: the four bridge-end roads and the two main decks. */
const SURFACES = [...ROADS, ...DECKS.map(({ points }, i) => ({ name: i ? "bay-bridge-deck" : "golden-gate-deck", points }))];

/**
 * Where x, z is on a bridge deck or bridge-end road (read only, for the
 * traffic and its tests): the road, its surface height there, the distance
 * along its centre line, and the offset to the left of it (as `frames` has it).
 * Undefined off the roads, including past a road's two ends.
 */
export function onRoad(x: number, z: number): { name: string; y: number; s: number; offset: number } | undefined {
  let best: { name: string; y: number; s: number; offset: number } | undefined;
  const consider = (name: string, a: Vec3, b: Vec3, t: number, s: number) => {
    const [px, pz] = [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
    const side = (x - a[0]) * (b[2] - a[2]) - (z - a[2]) * (b[0] - a[0]) >= 0 ? 1 : -1;
    const offset = side * Math.hypot(x - px, z - pz);
    if (Math.abs(offset) <= ROAD_WIDTH / 2 + 1e-6 && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { name, y: a[1] + (b[1] - a[1]) * t, s, offset };
  };
  for (const { name, points } of SURFACES) {
    let s = 0;
    let past = false; // beyond the end of the segment before
    for (let i = 1; i < points.length; i++) {
      const [a, b] = [points[i - 1], points[i]];
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const t = ((x - a[0]) * (b[0] - a[0]) + (z - a[2]) * (b[2] - a[2])) / (len * len);
      if (t >= 0 && t <= 1) consider(name, a, b, t, s + t * len);
      // on the outside of a bend, past one segment and short of the next: the shared corner is nearest
      else if (t < 0 && past) consider(name, a, b, 0, s);
      past = t > 1;
      s += len;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Geometry. Faces are oriented towards a wanted side and flat shaded; the
// materials map textures in world units (worldMaterial), so no UVs.

type P = [number, number, number];
type Frame = { p: Vec3; t: [number, number]; n: [number, number] };

/** Position, heading and left normal at every point. */
function frames(points: Vec3[]): Frame[] {
  return points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const t: [number, number] = [(b[0] - a[0]) / len, (b[2] - a[2]) / len];
    return { p, t, n: [t[1], -t[0]] };
  });
}
/** The point `u` to the left of the centre line and `dy` above the road surface. */
const at = ({ p, n }: Frame, u: number, dy: number): P => [p[0] + n[0] * u, p[1] + dy, p[2] + n[1] * u];

function tri(out: number[], a: P, b: P, c: P, want: P) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const flip = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2] < 0;
  out.push(...a, ...(flip ? c : b), ...(flip ? b : c));
}
const quad = (out: number[], a: P, b: P, c: P, d: P, want: P) => {
  tri(out, a, b, c, want);
  tri(out, b, d, c, want);
};
const side = (f: Frame, s: number): P => [f.n[0] * s, 0, f.n[1] * s];
const UP: P = [0, 1, 0];

/** A box section [u0, u1] x [y0, y1] (y from the road surface) swept along frames, with end caps. */
function sweepBox(out: number[], fs: Frame[], u0: number, u1: number, y0: (i: number) => number, y1: (i: number) => number) {
  for (let i = 0; i < fs.length - 1; i++) {
    const [a, b] = [fs[i], fs[i + 1]];
    const c = (f: Frame, j: number, u: number, top: boolean) => at(f, u, top ? y1(j) : y0(j));
    quad(out, c(a, i, u1, true), c(a, i, u1, false), c(b, i + 1, u1, true), c(b, i + 1, u1, false), side(a, 1)); // left
    quad(out, c(a, i, u0, true), c(a, i, u0, false), c(b, i + 1, u0, true), c(b, i + 1, u0, false), side(a, -1)); // right
    quad(out, c(a, i, u0, true), c(a, i, u1, true), c(b, i + 1, u0, true), c(b, i + 1, u1, true), UP); // top
    quad(out, c(a, i, u0, false), c(a, i, u1, false), c(b, i + 1, u0, false), c(b, i + 1, u1, false), [0, -1, 0]); // bottom
  }
  for (const [i, k] of [[0, -1], [fs.length - 1, 1]]) {
    const f = fs[i];
    quad(out, at(f, u0, y0(i)), at(f, u1, y0(i)), at(f, u0, y1(i)), at(f, u1, y1(i)), [f.t[0] * k, 0, f.t[1] * k]);
  }
}

function geometry(pos: number[]) {
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Asphalt over the whole width. */
function asphalt(out: number[], fs: Frame[]) {
  const h = ROAD_WIDTH / 2;
  for (let i = 0; i < fs.length - 1; i++) quad(out, at(fs[i], h, 0), at(fs[i], -h, 0), at(fs[i + 1], h, 0), at(fs[i + 1], -h, 0), UP);
}

/**
 * The dashed centre line. `c0` and `dir` give the dash phase, so it runs on
 * from its deck without a break. `show(i)` says where the road paints its own
 * (on the street at the end, the ground's marks take over).
 */
function centreLine(out: number[], fs: Frame[], c0: number, dir: number, show: (i: number) => boolean) {
  const w = 0.1;
  let s = 0;
  for (let i = 0; i < fs.length - 1; i++) {
    const [a, b] = [fs[i], fs[i + 1]];
    const len = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
    if (show(i) && show(i + 1)) {
      // split the segment where dashes start and stop
      const cuts = [0, len];
      for (let k = Math.ceil((c0 + dir * s) / DASH) * DASH; dir > 0 ? k < c0 + dir * (s + len) : k > c0 + dir * (s + len); k += dir * DASH) cuts.push((k - c0) / dir - s);
      cuts.sort((p, q) => p - q);
      for (let j = 0; j < cuts.length - 1; j++) {
        const [t0, t1] = [cuts[j] / len, cuts[j + 1] / len];
        const mid = c0 + dir * (s + (cuts[j] + cuts[j + 1]) / 2);
        if (t1 - t0 < 1e-6 || ((mid % (2 * DASH)) + 2 * DASH) % (2 * DASH) >= DASH) continue;
        const lerp = (t: number): Frame => ({ p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t + 0.012, a.p[2] + (b.p[2] - a.p[2]) * t], t: a.t, n: a.n });
        quad(out, at(lerp(t0), w, 0), at(lerp(t0), -w, 0), at(lerp(t1), w, 0), at(lerp(t1), -w, 0), UP);
      }
    }
    s += len;
  }
}

/** Where the road starts on a deck: the dash phase there. */
function phase(road: Road): [number, number] {
  const [x, , z] = road.points[0];
  for (const { points } of DECKS) {
    const len = Math.hypot(points[1][0] - points[0][0], points[1][2] - points[0][2]);
    if (points[0][0] === x && points[0][2] === z) return [0, -1];
    if (points[1][0] === x && points[1][2] === z) return [len, 1];
  }
  return [0, 1];
}

/** Lowest ground under the road and at both edges. */
function low(road: Road, f: Frame, s: number) {
  const u = (ROAD_WIDTH / 2) * s;
  return Math.min(road.ground(f.p[0], f.p[2]), road.ground(f.p[0] + f.n[0] * u, f.p[2] + f.n[1] * u));
}

/** Pier positions under elevated stretches: [x, z, groundY, topY]. Never in a junction or on a cross street. */
export function piers(road: Road, every = 5): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const fs = frames(road.points);
  let since = 0;
  for (let i = road.span + 1; i < fs.length; i++) {
    const { p, t } = fs[i];
    since += Math.hypot(p[0] - fs[i - 1].p[0], p[2] - fs[i - 1].p[2]);
    const g = road.ground(p[0], p[2]);
    if (since < every || p[1] - g < 1.6 || i > fs.length - 3) continue;
    // a road along z crosses the east-west streets, and the other way round
    const cross = Math.abs(t[1]) > 0.5 ? Z_STREETS.some((sz) => Math.abs(p[2] - sz) < EDGE + 0.6) : X_STREETS.some((sx) => Math.abs(p[0] - sx) < EDGE + 0.6);
    if (cross && insideLand(p[0], p[2])) continue;
    out.push([p[0], p[2], g, p[1] - SLAB]);
    since = 0;
  }
  return out;
}

/**
 * A road's approach: asphalt, centre line and concrete (slab or retaining
 * walls down to the ground where it is low, parapets where it is high, piers).
 * The side span part (before `span`) only gets asphalt and marks: its steel is
 * drawn by the bridge (spanGeometry).
 */
export function roadGeometry(road: Road) {
  const fs = frames(road.points);
  const road_: number[] = [];
  const marks: number[] = [];
  const concrete: number[] = [];
  asphalt(road_, fs);
  const [c0, dir] = phase(road);
  centreLine(marks, fs, c0, dir, (i) => road.points[i][1] - road.ground(road.points[i][0], road.points[i][2]) > 0.06);

  const approach = fs.slice(road.span);
  const h = ROAD_WIDTH / 2;
  // Slab sides: a slab where it is high, a retaining wall down into the ground where it is low.
  const bottom = (f: Frame, s: number) => {
    const g = low(road, f, s);
    return f.p[1] - g < 1.6 ? g - 0.2 - f.p[1] : -SLAB;
  };
  for (let i = 0; i < approach.length - 1; i++) {
    const [a, b] = [approach[i], approach[i + 1]];
    for (const s of [1, -1]) quad(concrete, at(a, h * s, 0), at(a, h * s, bottom(a, s)), at(b, h * s, 0), at(b, h * s, bottom(b, s)), side(a, s));
    quad(concrete, at(a, h, bottom(a, 1)), at(a, -h, bottom(a, -1)), at(b, h, bottom(b, 1)), at(b, -h, bottom(b, -1)), [0, -1, 0]);
  }
  // Parapets where the ground beside the road falls away (on viaducts and fills, not in cuts),
  // eased in and out along the road, and gone where a road comes down to its street.
  const smoothstep = (a: number, b: number, v: number) => {
    const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  const g = (f: Frame) => road.ground(f.p[0], f.p[2]);
  const drop = (f: Frame) => f.p[1] - Math.min(g(f), ...[4, -4].map((u) => road.ground(f.p[0] + f.n[0] * u, f.p[2] + f.n[1] * u)));
  const last = road.points[road.points.length - 1];
  const atGrade = Math.abs(last[1] - road.ground(last[0], last[2])) < 0.1;
  const raw = approach.map((f) => smoothstep(0.2, 0.9, drop(f)) * (atGrade ? smoothstep(0.15, 0.9, f.p[1] - g(f)) : 1));
  const parapet = raw.map((_, i) => {
    const near = raw.slice(Math.max(0, i - 4), i + 5);
    const k = near.reduce((a, b) => a + b, 0) / near.length;
    return k < 0.05 ? 0.001 : 0.5 * k;
  });
  // just outside the road (cars use its whole width), its foot tucked down beside the slab edge
  for (const s of [1, -1]) {
    const [u0, u1] = s > 0 ? [RAIL.inner, RAIL.inner + RAIL.parapet] : [-RAIL.inner - RAIL.parapet, -RAIL.inner];
    sweepBox(concrete, approach, u0, u1, (i) => (parapet[i] > 0.01 ? -0.25 : 0), (i) => parapet[i]);
  }
  for (const [x, z, base, top] of piers(road)) {
    const f = fs.find(({ p }) => p[0] === x && p[2] === z) as Frame;
    const box = (along: number, acrossU: number, y0: number, y1: number) => {
      const ends = [-along, along].map((d): Frame => ({ p: [x + f.t[0] * d, top, z + f.t[1] * d], t: f.t, n: f.n }));
      sweepBox(concrete, ends, -acrossU, acrossU, () => y0 - top, () => y1 - top);
    };
    box(0.4, 0.5, base - 0.2, top - 0.35); // column
    box(0.45, 1.3, top - 0.4, top); // cap under the slab
  }
  return { asphalt: geometry(road_), marks: geometry(marks), concrete: geometry(concrete) };
}

/** Railings and parapets stand just outside the road: inner face this far from the centre line. */
export const RAIL = { inner: ROAD_WIDTH / 2 + 0.02, parapet: 0.2, girder: 2.05 };
/** The bridges' main cables and suspenders hang this far from the centre line: outside the railings, over the edge girders. */
export const CABLE = 1.95;

/** The frame at distance `s` along the frames (interpolated). */
function frameAt(fs: Frame[], s: number): Frame {
  for (let i = 1, d = 0; i < fs.length; i++) {
    const [a, b] = [fs[i - 1], fs[i]];
    const len = Math.hypot(b.p[0] - a.p[0], b.p[2] - a.p[2]);
    if (d + len >= s || i === fs.length - 1) {
      const t = Math.min(1, Math.max(0, (s - d) / len));
      const tx = b.p[0] - a.p[0];
      const tz = b.p[2] - a.p[2];
      const t2: [number, number] = [tx / len, tz / len];
      return { p: [a.p[0] + tx * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + tz * t], t: t2, n: [t2[1], -t2[0]] };
    }
    d += len;
  }
  return fs[0];
}

/**
 * An open steel railing on both edges of a deck, just outside the road: an
 * edge girder under it, posts every 0.7 and a top and a mid rail, so traffic
 * on the deck shows through.
 */
export function railingGeometry(points: Vec3[]) {
  const fs = frames(points);
  const out: number[] = [];
  const h = ROAD_WIDTH / 2;
  const u = RAIL.inner;
  let L = 0;
  for (let i = 1; i < fs.length; i++) L += Math.hypot(fs[i].p[0] - fs[i - 1].p[0], fs[i].p[2] - fs[i - 1].p[2]);
  for (const s of [1, -1]) {
    const across = (a: number, b: number): [number, number] => (s > 0 ? [a, b] : [-b, -a]);
    sweepBox(out, fs, ...across(h, RAIL.girder), () => -0.53, () => 0.03); // edge girder, the suspenders land on it
    sweepBox(out, fs, ...across(u, u + 0.07), () => 0.55, () => 0.61); // top rail
    sweepBox(out, fs, ...across(u, u + 0.06), () => 0.29, () => 0.33); // mid rail
    const n = Math.max(1, Math.round(L / 0.7));
    for (let k = 0; k <= n; k++) {
      const c = frameAt(fs, (L * k) / n);
      const ends = [-0.035, 0.035].map((d): Frame => ({ ...c, p: [c.p[0] + c.t[0] * d, c.p[1], c.p[2] + c.t[1] * d] }));
      sweepBox(out, ends, ...across(u, u + 0.07), () => 0.03, () => 0.55); // post
    }
  }
  return geometry(out);
}

/** A level main deck: asphalt and centre line (its steel is the bridge's own). */
export function deckGeometry(points: Vec3[]) {
  const fs = frames(points);
  const road: number[] = [];
  const marks: number[] = [];
  asphalt(road, fs);
  centreLine(marks, fs, 0, 1, () => true);
  return { asphalt: geometry(road), marks: geometry(marks) };
}

/** Steel under and beside a side span (Bay Bridge): deck plate and truss, matching the main deck, and its railing. */
export function spanGeometry(road: Road) {
  const points = road.points.slice(0, road.span + 1);
  const fs = frames(points);
  const out: number[] = [];
  const h = ROAD_WIDTH / 2;
  sweepBox(out, fs, -h, h, () => -0.53, () => -0.03);
  sweepBox(out, fs, -1.3, 1.3, () => -1.63, () => -0.53);
  return mergeGeometries([geometry(out), railingGeometry(points)]);
}
