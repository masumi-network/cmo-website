// The land beyond the modelled city: Marin and Mount Tam behind the Golden
// Gate, the North Bay, the East Bay flats and hills with Oakland's towers,
// and the Peninsula ridge with a Sutro-like mast. Pure data and geometry, so
// it is easy to test; backdrop.tsx draws it.
//
// Each ridge is a strip along a toe line in the water: columns every STEP
// units, rows rising away from the city to the crest and falling behind it.
// Every toe stands past the story fog, so its foot melts into the fogged water.

import { Color } from "three";
import { overhead } from "./atmosphere";
import { WATERLINE } from "./roads";

type P2 = [number, number];
type P3 = [number, number, number];

/** The toe row sits this far under the water, so no edge shows. */
const TOE = WATERLINE - 1;
/** Column spacing along each ridge. */
const STEP = 4;
/** The city's middle: ridges face it, and haze grows with distance from it. */
const CENTRE: P2 = [-15, 5];

export type Peak = { x: number; z: number; h: number; w: number };
/** Named tops on the crests (x, z of the crest, height, width). */
export const PEAKS = {
  tam: { x: -272, z: -445, h: 74, w: 36 },
  /** Tam's long western shoulder. */
  tamWest: { x: -330, z: -432, h: 56, w: 70 },
  sutro: { x: -168, z: 352, h: 47, w: 40 },
  grizzly: { x: 462, z: -170, h: 52, w: 75 },
} satisfies Record<string, Peak>;

/** A row across the ridge: offset from the toe (fraction of depth), height (fraction of the crest), how built up. */
type Row = [offset: number, height: number, town: number];
/** Hills: a misty foot, slopes, the crest (row 4) and a back slope. */
const HILL: Row[] = [[0, 0, 0], [0.12, 0.15, 1], [0.35, 0.45, 0.8], [0.7, 0.85, 0.35], [1, 1, 0], [1.4, 0.3, 0]];
/** The East Bay: a shore, flats a few units high (rows 1 to 3), then the hills. */
const EAST: Row[] = [[0, 0, 0], [0.02, 0.055, 1], [0.15, 0.065, 1], [0.3, 0.08, 1], [0.45, 0.25, 0.6], [0.6, 0.62, 0.3], [0.76, 1, 0], [1, 0.35, 0]];

export type Ridge = {
  name: string;
  /** One mesh per region (frustum culling). */
  region: "marin" | "north" | "east" | "south";
  /** The toe line, in order. The ridge rises on the side away from the city. */
  base: P2[];
  /** Toe to back of the crest row, units. */
  depth: number;
  rows: Row[];
  /** Crest range from the noise, before peaks. */
  lo: number;
  hi: number;
  peaks: Peak[];
  /** How built up the lower slopes are, 0 to 1 (pale specks by day, lights at night). */
  town: number;
  seed: number;
  /** East Bay: the row where the flats end. */
  flats?: number;
};

export const RIDGES: Ridge[] = [
  // Mount Tam's ridge behind the headlands, peak behind the bridge's north tower from Russian Hill
  { name: "tam", region: "marin", base: [[-440, -330], [-340, -372], [-220, -388], [-110, -386], [-10, -394], [72, -412]], depth: 58, rows: HILL, lo: 26, hi: 46, peaks: [PEAKS.tam, PEAKS.tamWest], town: 0.12, seed: 1 },
  // Bolinas ridge, farther and paler, over Tam's western shoulder
  { name: "bolinas", region: "marin", base: [[-610, -425], [-500, -480], [-370, -530], [-240, -560], [-110, -578]], depth: 48, rows: HILL, lo: 42, hi: 60, peaks: [], town: 0, seed: 2 },
  // North Bay: a low, very hazy ridge behind Angel Island and Tiburon
  { name: "north-bay", region: "north", base: [[-70, -585], [80, -608], [230, -620], [380, -606], [520, -570]], depth: 40, rows: HILL, lo: 18, hi: 32, peaks: [], town: 0.5, seed: 3 },
  // East Bay: Oakland and Berkeley flats along the shore, the hills behind (Grizzly Peak)
  { name: "east-bay", region: "east", base: [[332, 225], [331, 110], [330, 0], [333, -120], [337, -260], [348, -390], [376, -500]], depth: 165, rows: EAST, lo: 34, hi: 48, peaks: [PEAKS.grizzly], town: 1, seed: 4, flats: 3 },
  // The Peninsula: Daly City's bluffs to San Bruno Mountain, low toward the south bay
  { name: "peninsula", region: "south", base: [[-345, 150], [-282, 226], [-186, 288], [-90, 322], [0, 338], [92, 336], [186, 310], [276, 262]], depth: 54, rows: HILL, lo: 20, hi: 38, peaks: [PEAKS.sutro], town: 0.8, seed: 5 },
];

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
/** Smooth 1D value noise, 0..1. */
const noise1 = (x: number) => {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) + (hash(i + 1) - hash(i)) * u;
};
const fbm1 = (x: number) => (noise1(x) + 0.5 * noise1(x * 2.1 + 3.7) + 0.25 * noise1(x * 4.3 + 9.1)) / 1.75;
/** Smooth maximum: no kink where a peak meets the noise. */
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
};

/** The toe line as a smooth curve (Catmull-Rom through the points), dense. */
function curve(base: P2[]) {
  const c = (i: number) => base[Math.min(base.length - 1, Math.max(0, i))];
  const out: P2[] = [];
  for (let i = 0; i < base.length - 1; i++) {
    const [p0, p1, p2, p3] = [c(i - 1), c(i), c(i + 1), c(i + 2)];
    for (let k = 0; k < 24; k++) {
      const t = k / 24;
      const f = (a: number, b: number, d: number, e: number) => 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(base[base.length - 1]);
  return out;
}

export type Column = { s: number; points: P3[]; town: number[]; crest: number };
const columnCache = new Map<Ridge, Column[]>();

/** The ridge's cross-sections, toe to back, every STEP units along its toe line. */
export function ridgeColumns(ridge: Ridge): Column[] {
  const cached = columnCache.get(ridge);
  if (cached) return cached;
  const dense = curve(ridge.base);
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const total = len[len.length - 1];
  const n = Math.ceil(total / STEP);
  const taper = Math.min(80, total * 0.25);
  const crestRow = ridge.rows.findIndex((r) => r[1] === 1);
  const seed = ridge.seed * 17.3;
  const cols: Column[] = [];
  let j = 1;
  for (let i = 0; i <= n; i++) {
    const s = (i / n) * total;
    while (j < dense.length - 1 && len[j] < s) j++;
    const t = (s - len[j - 1]) / (len[j] - len[j - 1] || 1);
    const [ax, az] = dense[j - 1];
    const [bx, bz] = dense[j];
    const x = ax + (bx - ax) * t;
    const z = az + (bz - az) * t;
    // across: perpendicular to the toe line, away from the city
    const tl = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / tl;
    let nz = -(bx - ax) / tl;
    if (nx * (x - CENTRE[0]) + nz * (z - CENTRE[1]) < 0) [nx, nz] = [-nx, -nz];
    // spurs and coves: the depth wanders a little along the ridge
    const depth = ridge.depth * (0.85 + 0.3 * fbm1(s / 35 + seed));
    const cx = x + nx * depth * ridge.rows[crestRow][0];
    const cz = z + nz * depth * ridge.rows[crestRow][0];
    let h = ridge.lo + (ridge.hi - ridge.lo) * fbm1(s / 45 + seed * 3);
    for (const p of ridge.peaks) h = smax(h, p.h * Math.exp(-(((cx - p.x) ** 2 + (cz - p.z) ** 2) / p.w ** 2)), 8);
    // a rough skyline: knolls and saddles on every crest, peaks included
    h *= 1 + 0.14 * (fbm1(s / 13 + seed * 5) - 0.5);
    h = TOE + (h - TOE) * smoothstep(0, taper, s) * smoothstep(0, taper, total - s);
    const points = ridge.rows.map(([o, f], r): P3 => {
      // interior rows wander up and down a little: gullies and spurs, not bands
      const inner = r > 0 && r < crestRow;
      const k = inner ? 1 + 0.16 * (fbm1(s / 23 + r * 3.1 + seed) - 0.5) : 1;
      return [x + nx * depth * o, TOE + f * k * (h - TOE), z + nz * depth * o];
    });
    cols.push({ s, points, town: ridge.rows.map((r) => r[2] * ridge.town), crest: crestRow });
  }
  columnCache.set(ridge, cols);
  return cols;
}

/** Oakland and Emeryville: a few towers on the East Bay flats ([x, z, width, depth, height]). */
export const TOWERS = (
  [
    [364, 2, 4, 4, 11], [369, -3, 3.5, 3.5, 9], [360, 8, 3, 4, 7], [372, 6, 4.5, 3, 12], [366, 12, 3, 3, 6],
    [376, -1, 3, 3, 8], [361, -6, 3.5, 3, 5], [370, 15, 3, 3.5, 5], [378, 10, 3.5, 3.5, 7], [357, 2, 3, 3, 4.5],
    [365, -58, 3.5, 3.5, 8], [370, -63, 3, 3, 6], [361, -52, 3, 3, 5], [374, -55, 4, 3, 7], [367, -68, 3, 3, 4.5],
    [359, -150, 3, 3, 5], [364, -146, 3.5, 3, 6.5],
  ] as const
).map(([x, z, w, d, h], i) => ({ x, z, w, d, h, tone: i % 4 }));
const TONES = ["#cdc6b6", "#b7b2a6", "#9aa4ab", "#c2b9a5"];

/** The Sutro-like mast: on the Peninsula crest nearest its peak. `height` includes the antennas. */
export const MAST = (() => {
  const south = RIDGES.find((r) => r.region === "south")!;
  const p = PEAKS.sutro;
  const best = ridgeColumns(south)
    .map((c) => c.points[c.crest])
    .reduce((a, b) => (Math.hypot(b[0] - p.x, b[2] - p.z) < Math.hypot(a[0] - p.x, a[2] - p.z) ? b : a));
  return { x: best[0], y: best[1] - 0.5, z: best[2], legs: 24, height: 29 };
})();

/** One mesh's worth of data. Colours are linear albedo; surf is (town, built, mist). */
export type Region = { name: Ridge["region"]; position: number[]; normal: number[]; color: number[]; surf: number[]; index: number[] };

const GRASS = new Color("#b9a06c");
const MAST_RED = new Color("#b5402e");
const MAST_WHITE = new Color("#e4e0d8");

function addRidge(out: Region, ridge: Ridge) {
  const cols = ridgeColumns(ridge);
  const rows = ridge.rows.length;
  const first = out.position.length / 3;
  const P = (i: number, r: number) => cols[Math.min(cols.length - 1, Math.max(0, i))].points[Math.min(rows - 1, Math.max(0, r))];
  cols.forEach((col, i) => {
    col.points.forEach((p, r) => {
      const a = P(i + 1, r);
      const b = P(i - 1, r);
      const c = P(i, r + 1);
      const d = P(i, r - 1);
      const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
      const v = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      n = l > 1e-9 ? n.map((k) => k / l) : [0, 1, 0];
      if (n[1] < 0) n = n.map((k) => -k);
      out.position.push(...p);
      out.normal.push(...n);
      out.color.push(GRASS.r, GRASS.g, GRASS.b);
      out.surf.push(col.town[r], 0, r === 0 ? 1 : 0);
    });
  });
  for (let i = 0; i < cols.length - 1; i++)
    for (let r = 0; r < rows - 1; r++) {
      const a = first + i * rows + r;
      const b = a + rows;
      quad(out, a, b, b + 1, a + 1);
    }
}

/** Two triangles, wound to face along the vertices' normals. */
function quad(out: Region, a: number, b: number, c: number, d: number) {
  for (const [p, q, r] of [[a, b, c], [a, c, d]]) {
    const v = (k: number) => out.position.slice(k * 3, k * 3 + 3);
    const [pp, qq, rr] = [v(p), v(q), v(r)];
    const e1 = [qq[0] - pp[0], qq[1] - pp[1], qq[2] - pp[2]];
    const e2 = [rr[0] - pp[0], rr[1] - pp[1], rr[2] - pp[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [0, 1, 2].map((k) => out.normal[p * 3 + k] + out.normal[q * 3 + k] + out.normal[r * 3 + k]);
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] >= 0) out.index.push(p, q, r);
    else out.index.push(p, r, q);
  }
}

/** A flat-shaded face of four corners (in order round the face), its normal facing out. */
function face(out: Region, corners: P3[], normal: number[], color: Color) {
  const first = out.position.length / 3;
  for (const c of corners) {
    out.position.push(...c);
    out.normal.push(...normal);
    out.color.push(color.r, color.g, color.b);
    out.surf.push(0, 1, 0);
  }
  quad(out, first, first + 1, first + 2, first + 3);
}

function box(out: Region, x: number, z: number, w: number, d: number, y0: number, y1: number, color: Color) {
  const [x0, x1, z0, z1] = [x - w / 2, x + w / 2, z - d / 2, z + d / 2];
  face(out, [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], color);
  face(out, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0], color);
  face(out, [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], [0, 0, -1], color);
  face(out, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color);
  face(out, [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], color);
}

/** A square beam from a to b, half-width w (four sides). */
function beam(out: Region, a: P3, b: P3, w: number, color: Color) {
  const ax = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const al = Math.hypot(ax[0], ax[1], ax[2]);
  const u = ax.map((k) => k / al);
  const ref = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let s = [u[1] * ref[2] - u[2] * ref[1], u[2] * ref[0] - u[0] * ref[2], u[0] * ref[1] - u[1] * ref[0]];
  const sl = Math.hypot(s[0], s[1], s[2]);
  s = s.map((k) => k / sl);
  const t = [s[1] * u[2] - s[2] * u[1], s[2] * u[0] - s[0] * u[2], s[0] * u[1] - s[1] * u[0]];
  const sides: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const [p, q] of sides) {
    const n = [0, 1, 2].map((k) => s[k] * p + t[k] * q);
    const e = [0, 1, 2].map((k) => s[k] * -q + t[k] * p); // along the face
    const at = (o: P3, sign: number): P3 => [0, 1, 2].map((k) => o[k] + (n[k] + e[k] * sign) * w) as P3;
    face(out, [at(a, -1), at(a, 1), at(b, 1), at(b, -1)], n, color);
  }
}

function addMast(out: Region) {
  const { x, y, z, legs: H, height } = MAST;
  const leg = (k: number, f: number): P3 => {
    const ang = (k * 2 * Math.PI) / 3 + 0.4;
    const r = f < 0.55 ? 3.6 + (1.7 - 3.6) * (f / 0.55) : 1.7;
    return [x + Math.cos(ang) * r, y + f * H, z + Math.sin(ang) * r];
  };
  const BANDS = 7;
  for (let k = 0; k < 3; k++) {
    for (let b = 0; b < BANDS; b++) beam(out, leg(k, b / BANDS), leg(k, (b + 1) / BANDS), 0.6 - 0.18 * (b / BANDS), b % 2 === (BANDS - 1) % 2 ? MAST_RED : MAST_WHITE);
    // crossbars at the waist and the top
    for (const f of [0.55, 1]) beam(out, leg(k, f), leg((k + 1) % 3, f), 0.4, MAST_WHITE);
    // antennas
    const top = leg(k, 1);
    beam(out, top, [top[0], y + height, top[2]], 0.26, k === 0 ? MAST_RED : MAST_WHITE);
  }
}

/** The backdrop's meshes, one per region. `lite`: the same (phones see the ridges no worse). */
export function backdropRegions(lite = false): Region[] {
  void lite;
  const regions = (["marin", "north", "east", "south"] as const).map((name): Region => ({ name, position: [], normal: [], color: [], surf: [], index: [] }));
  const get = (name: Region["name"]) => regions.find((r) => r.name === name)!;
  for (const ridge of RIDGES) addRidge(get(ridge.region), ridge);
  for (const t of TOWERS) box(get("east"), t.x, t.z, t.w, t.d, WATERLINE, t.h, new Color(TONES[t.tone]));
  addMast(get("south"));
  return regions;
}

/** 0 for the nearest ridges (280 from the city), 1 for the farthest (700): hazier and bluer. */
export const layerAt = (x: number, z: number) => Math.min(1, Math.max(0, (Math.hypot(x - CENTRE[0], z - CENTRE[1]) - 280) / 420));
export const LAYER = { centre: CENTRE, near: 280, far: 700 };

// ---------------------------------------------------------------------------
// Per hour.

export type BackdropLook = {
  /** How much haze over the nearest ridges, 0 to 1. */
  hazeNear: number;
  /** ... and over the farthest. */
  hazeFar: number;
  /** How much of the sky's top colour goes into the far haze (bluer with distance). */
  blue: number;
  /** Forward scattering: the ridges glow when the sun is behind them. */
  glow: number;
  /** Town lights, 0 to 1. */
  lights: number;
};

const DAY: BackdropLook = { hazeNear: 0.36, hazeFar: 0.7, blue: 0.3, glow: 0.25, lights: 0 };
const DAWN: BackdropLook = { hazeNear: 0.53, hazeFar: 0.8, blue: 0.3, glow: 0.9, lights: 0 };
const KEYS: [number, BackdropLook][] = [
  // 06:00: warm haze, backlit toward the Gate
  [6, DAWN],
  [7, { hazeNear: 0.5, hazeFar: 0.78, blue: 0.3, glow: 0.5, lights: 0 }],
  [9, { ...DAY, hazeNear: 0.32, hazeFar: 0.7, glow: 0.3 }],
  // day: gold hills in blue haze
  [12, DAY],
  [15, { ...DAY, glow: 0.35 }],
  // 18:00: backlit orange haze to the south-west
  [18, { hazeNear: 0.46, hazeFar: 0.76, blue: 0.3, glow: 0.9, lights: 0 }],
  // 22:00: dark violet silhouettes, a little darker than the horizon, towns lit
  [22, { hazeNear: 0.5, hazeFar: 0.7, blue: 0.2, glow: 0.2, lights: 1 }],
  [30, DAWN],
];

export function backdropAt(hour: number): BackdropLook {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0)));
  if (t === 0) return a;
  if (t === 1) return b;
  const out = { ...a };
  for (const k of Object.keys(a) as (keyof BackdropLook)[]) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** The haze colours: at the toe the fog (the water there is all fog), near ridges the sky's horizon, far ones bluer. */
export function hazeColors(fog: Color, horizon: Color, top: Color, blue: number, out = { toe: new Color(), near: new Color(), far: new Color() }) {
  out.toe.copy(fog);
  out.near.copy(horizon);
  out.far.copy(horizon).lerp(top, blue);
  return out;
}

/** 1 in every story shot, 0 high over the city (Explore). */
export const backdropFade = (distance: number) => 1 - overhead(distance);

// ---------------------------------------------------------------------------
// Town lights at night.

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Lights per square unit: dense on the flats, sparse up the slopes. */
const DENSITY = { flats: 0.05, slopes: 0.026 };
const MAX_LIGHTS = 3000;

/**
 * Points of light on the towns: a street grid on the East Bay flats, sparse
 * up the slopes under the crests, windows on the towers, two red lights on
 * the mast. kind: 0 ground, 1 window, 2 mast (the only ones that blink).
 */
export function townLights(lite = false) {
  // Phones: none. Their 22:00 camera looks down at Cuso, never at the horizon.
  if (lite) return null;
  const rand = rng(91);
  const pos: number[] = [];
  const kind: number[] = [];
  for (const ridge of RIDGES) {
    const cols = ridgeColumns(ridge);
    for (let i = 0; i < cols.length - 1; i++)
      for (let r = 0; r < ridge.rows.length - 1; r++) {
        const town = Math.min(cols[i].town[r], cols[i].town[r + 1]);
        if (town <= 0) continue;
        const p00 = cols[i].points[r];
        const p10 = cols[i + 1].points[r];
        const p01 = cols[i].points[r + 1];
        const p11 = cols[i + 1].points[r + 1];
        const area = Math.hypot(p10[0] - p00[0], p10[2] - p00[2]) * Math.hypot(p01[0] - p00[0], p01[2] - p00[2]);
        const flat = ridge.flats !== undefined && r < ridge.flats;
        const expected = area * town * (flat ? DENSITY.flats : DENSITY.slopes);
        const n = Math.floor(expected + rand());
        for (let k = 0; k < n; k++) {
          // on the flats, on a jittered street grid; on the slopes, anywhere
          let u = rand();
          let v = rand();
          if (flat) {
            u = (Math.floor(u * 2) + 0.5 + (rand() - 0.5) * 0.3) / 2;
            v = (Math.floor(v * 4) + 0.5 + (rand() - 0.5) * 0.3) / 4;
          }
          // exactly on one of the quad's two triangles (the mesh splits it 00-10-11, 00-11-01)
          const [a, b, c, wa, wb, wc] = u >= v ? [p00, p10, p11, 1 - u, u - v, v] : [p00, p11, p01, 1 - v, u, v - u];
          const y = a[1] * wa + b[1] * wb + c[1] * wc;
          const x = a[0] * wa + b[0] * wb + c[0] * wc;
          const z = a[2] * wa + b[2] * wb + c[2] * wc;
          if (y < WATERLINE + 0.4) continue; // the shore and the tapered ends are under water
          if (TOWERS.some((t) => Math.abs(x - t.x) < t.w / 2 + 0.5 && Math.abs(z - t.z) < t.d / 2 + 0.5)) continue;
          pos.push(x, y + 0.45, z);
          kind.push(0);
        }
      }
  }
  // windows on the faces toward the city (west) and south
  for (const t of TOWERS) {
    for (let y = 1.2; y < t.h - 0.4; y += 1.1) {
      for (let a = -t.d / 2 + 0.5; a < t.d / 2 - 0.3; a += 0.9) if (rand() < 0.4) {
        pos.push(t.x - t.w / 2 - 0.12, y, t.z + a);
        kind.push(1);
      }
      for (let a = -t.w / 2 + 0.5; a < t.w / 2 - 0.3; a += 0.9) if (rand() < 0.3) {
        pos.push(t.x + a, y, t.z + t.d / 2 + 0.12);
        kind.push(1);
      }
    }
  }
  // thin evenly to the cap (never the mast's)
  const cap = MAX_LIGHTS - 2;
  const keep = Math.min(1, cap / kind.length);
  const position: number[] = [];
  const kinds: number[] = [];
  for (let i = 0; i < kind.length; i++) {
    if (keep < 1 && ((i * 0.6180339887) % 1) >= keep) continue;
    position.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    kinds.push(kind[i]);
  }
  for (const k of [0, 1]) {
    const ang = (k * 2 * Math.PI) / 3 + 0.4;
    position.push(MAST.x + Math.cos(ang) * 1.7, MAST.y + MAST.height + 0.3, MAST.z + Math.sin(ang) * 1.5);
    kinds.push(2);
  }
  const count = kinds.length;
  const seed = new Float32Array(count).map(() => rand());
  return { position: new Float32Array(position), kind: new Float32Array(kinds), seed, count };
}
