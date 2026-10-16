// The six Painted Ladies as real 3D models, built from code (no photos on
// them): bay windows with recessed glass and sashes, cornices on brackets,
// window casings with hoods and sills, recessed entries with doors, stoops,
// a garage. Every model is built once at a reference size (W x H, the
// layout's 1.5 aspect) and instanced per house, scaled to its plot.
//
// Each face carries a paint slot (`aSlot`, see SLOTS) instead of a colour, so
// one material paints every house from its own palette (PALETTES, picked per
// house); glass carries a window id (`aWin`) so whole windows light up at
// night, and its place on the pane (`aPane`) for blinds and curtains.
//
// Two models per house: the front (front wall and everything on it, z out
// of the wall) and the body behind it (side and back walls, roof), shared by
// all variants.
//
// Every face also carries its distance to each of its (up to four) edges
// (`aEdge`), so the shader can round its real edges off (a bevel of light,
// no extra triangles). Seams inside a flat wall and edges against the wall
// are left out: they are not edges you could see.

import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";

/** The reference house: body width and height (layout.ts FACADE_ASPECT is 1.5). */
export const W = 3;
export const H = 4.5;
/** Walls reach this far below the ground (covers FOOTING on the narrowest house). */
export const FOOT = 1.7;
/** Depth of the body behind the front wall (layout.ts houses are 2.6 deep). */
export const BODY_DEPTH = 2.6;
/** The furthest anything stands out of the front wall: the cornice crown. */
export const RELIEF_DEPTH = 0.36;

/**
 * Paints. The first seven come from the house's palette, the next five are the same on every house.
 * The last two are for the 06:00 apartment (rooftop.tsx): `stucco` (the body colour without siding)
 * and `gravel` (a tar-and-gravel roof). `copper`: weathered green copper (the Ferry Building's roof and dome).
 * Printed and bare parts of the landmarks: `poster` (a paper print from the material's second texture,
 * the 09:00 wall), `vinyl` (the 12:00 billboard's face, the same way), `steel` (its satin steel truss)
 * and `wood` (the 09:00 ladder).
 */
export const SLOTS = ["body", "trim", "frieze", "panel", "sash", "door", "scales", "glass", "roof", "tar", "stone", "brick", "stucco", "gravel", "copper", "poster", "vinyl", "steel", "wood"] as const;
export type Slot = (typeof SLOTS)[number];
export const SLOT = Object.fromEntries(SLOTS.map((s, i) => [s, i])) as Record<Slot, number>;
const FIXED = { glass: "#0c1014", roof: "#8f8a84", tar: "#5b5853", stone: "#c4beb2", brick: "#94695a", gravel: "#8e877c", copper: "#86a194", poster: "#fbf8f2", vinyl: "#ffffff", steel: "#959a9f", wood: "#b9915f" };
/** Slots whose faces carry where they are on their face (`aPane`, 0..1 across and up): glass, prints. */
const PANED: number[] = [SLOT.glass, SLOT.poster, SLOT.vinyl];

/** A poster's print (SLOT.poster): the photo's inset from each edge, as a share of the print. */
export const POSTER = { border: 0.034 };
/** The billboard's face (SLOT.vinyl): its size in world units and the sheets it is pasted up in (across, up). */
export const VINYL = { w: 5.58, h: 2.78, sheets: [5, 2] as const };

/**
 * The shader bevel: within `bevel` of a real edge the normal leans out to 45 degrees at the edge itself.
 * `aEdge` stores each distance less `off`, so an edge left out is 0: a mesh without the attribute
 * (WebGL reads 0) has no bevel anywhere.
 */
export const EDGE = { bevel: 0.015, off: 4 };

/**
 * `aEdge` for a flat convex polygon: per corner, its distance to the line of each of the first four
 * edges (edge k runs from corner k to k + 1), less EDGE.off; 0 where `on[k]` is false or there is no
 * edge k. Distance to a line is linear across the face, so interpolation is exact everywhere inside.
 * Polygons of more than four edges stay plain (all 0).
 */
export function edgeDistances(pts: L3[], on: boolean[]) {
  const n = pts.length;
  const out = new Array<number>(n * 4).fill(0);
  if (n > 4) return out;
  // the face normal (Newell), to measure in its plane
  let [nx, ny, nz] = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % n]];
    nx += (p[1] - q[1]) * (p[2] + q[2]);
    ny += (p[2] - q[2]) * (p[0] + q[0]);
    nz += (p[0] - q[0]) * (p[1] + q[1]);
  }
  for (let k = 0; k < Math.min(n, 4); k++) {
    if (!on[k]) continue;
    const [a, b] = [pts[k], pts[(k + 1) % n]];
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    // in-plane direction across the edge: normal x edge
    const c = [ny * e[2] - nz * e[1], nz * e[0] - nx * e[2], nx * e[1] - ny * e[0]];
    const len = Math.hypot(...c);
    if (len < 1e-12) continue;
    for (let v = 0; v < n; v++) {
      const d = Math.abs(((pts[v][0] - a[0]) * c[0] + (pts[v][1] - a[1]) * c[1] + (pts[v][2] - a[2]) * c[2]) / len);
      out[v * 4 + k] = d - EDGE.off;
    }
  }
  return out;
}

/**
 * Painted Lady colour schemes: a muted pastel body, white or cream trim, a
 * lighter tint for panels, friezes and fish scales, and one dark accent for
 * sashes and the door. Every house gets one (see `paletteOf` in houses.tsx);
 * neighbours never share one.
 */
export const PALETTES: { name: string; body: string; trim: string; panel: string; dark: string }[] = [
  { name: "powder blue", body: "#a7bfd5", trim: "#f4f0e6", panel: "#c4d5e4", dark: "#34465a" },
  { name: "butter yellow", body: "#ead48a", trim: "#f7f2e3", panel: "#f2e6c2", dark: "#3d3a2c" },
  { name: "dusty pink", body: "#d9a8a0", trim: "#f2e7d4", panel: "#e8c6bf", dark: "#6e2e38" },
  { name: "sage", body: "#a2b39a", trim: "#f1ecdd", panel: "#bfcab7", dark: "#3c4639" },
  { name: "cream", body: "#ece2cc", trim: "#fbf8f0", panel: "#e2d5b8", dark: "#5a4636" },
  { name: "white and black", body: "#efede7", trim: "#2e3133", panel: "#e0ddd5", dark: "#25292b" },
  { name: "lavender", body: "#b9b0cc", trim: "#f5f2ea", panel: "#d0c9dc", dark: "#463e5c" },
  { name: "teal", body: "#6f9493", trim: "#efe8d6", panel: "#8fadab", dark: "#2b4546" },
  { name: "slate", body: "#8291a4", trim: "#f2efe7", panel: "#a1aebd", dark: "#2f3a48" },
  { name: "apricot", body: "#e0c3aa", trim: "#f6f0e3", panel: "#ecd6c3", dark: "#6b4230" },
];

export type Span = [number, number];
/** A rectangle on the facade as shares of it: [u0, u1, v0, v1], u from the left, v from the ground. */
export type Rect = [number, number, number, number];

export type Variant = {
  name: string;
  floors: 2 | 3;
  /** Where the cornice frieze starts; brackets under the crown (centres). */
  cornice: number;
  brackets: number[];
  dentils?: boolean;
  /**
   * The bay: its sides meet the wall at `wall` and its front spans `front`.
   * `bands`: floor cornices around it; `windows`: one row per storey.
   * `base`: down to the ground, on corbels, or over the garage.
   */
  bay: { wall: Span; front: Span; v: Span; bands: Span[]; windows: Span[]; base: "ground" | "corbels" | "garage"; faces: "body" | "panel"; scales?: boolean };
  windows: { r: Rect; hood: "cap" | "pediment" }[];
  /** Plain friezes across the flat side (between storeys). */
  belts?: Rect[];
  /** The recessed entry: opening across `open`, up to `top`, floor (top of the stoop) at `floor`. */
  entry: { open: Span; top: number; floor: number; posts: [Span, Span]; columns?: boolean; arch?: boolean; hood?: Rect };
  garage?: Rect;
};

/** Measured from the six reference photos (design/prompts/textures/house1-6.txt). 2-storey: 0, 2, 4; 3-storey: 1, 3, 5. */
export const VARIANTS: Variant[] = [
  {
    name: "blue",
    floors: 2,
    cornice: 0.905,
    brackets: [0.035, 0.24, 0.43, 0.6, 0.8, 0.965],
    bay: { wall: [0.44, 0.935], front: [0.555, 0.82], v: [0, 0.905], bands: [[0.455, 0.495], [0.865, 0.905]], windows: [[0.13, 0.395], [0.555, 0.815]], base: "ground", faces: "panel" },
    windows: [{ r: [0.165, 0.305, 0.536, 0.775], hood: "pediment" }],
    entry: { open: [0.1, 0.3], top: 0.455, floor: 0.03, posts: [[0.01, 0.1], [0.3, 0.39]], columns: true, hood: [0.005, 0.405, 0.455, 0.505] },
  },
  {
    name: "green",
    floors: 3,
    cornice: 0.905,
    brackets: [0.02, 0.17, 0.42, 0.575, 0.98],
    bay: { wall: [0.04, 0.555], front: [0.15, 0.43], v: [0, 0.905], bands: [[0.25, 0.29], [0.585, 0.625], [0.865, 0.905]], windows: [[0.025, 0.22], [0.34, 0.55], [0.68, 0.85]], base: "ground", faces: "body", scales: true },
    windows: [{ r: [0.714, 0.849, 0.658, 0.844], hood: "cap" }, { r: [0.714, 0.849, 0.344, 0.521], hood: "cap" }],
    entry: { open: [0.665, 0.895], top: 0.295, floor: 0.015, posts: [[0.625, 0.665], [0.895, 0.935]], hood: [0.6, 0.975, 0.295, 0.335] },
  },
  {
    name: "yellow",
    floors: 2,
    cornice: 0.905,
    brackets: [0.03, 0.165, 0.325, 0.485, 0.64, 0.73, 0.86, 0.97],
    bay: { wall: [0.06, 0.62], front: [0.2, 0.49], v: [0.09, 0.905], bands: [[0.09, 0.125], [0.48, 0.515], [0.865, 0.905]], windows: [[0.182, 0.421], [0.57, 0.8]], base: "corbels", faces: "body" },
    windows: [{ r: [0.76, 0.883, 0.57, 0.802], hood: "cap" }],
    entry: { open: [0.705, 0.945], top: 0.485, floor: 0.115, posts: [[0.655, 0.705], [0.945, 0.985]], hood: [0.645, 0.995, 0.485, 0.52] },
  },
  {
    name: "pink",
    floors: 3,
    cornice: 0.905,
    brackets: [],
    dentils: true,
    bay: { wall: [0.47, 0.935], front: [0.595, 0.82], v: [0, 0.905], bands: [[0.29, 0.315], [0.6, 0.625], [0.865, 0.905]], windows: [[0.067, 0.248], [0.368, 0.562], [0.683, 0.85]], base: "ground", faces: "body" },
    windows: [{ r: [0.143, 0.322, 0.675, 0.854], hood: "cap" }, { r: [0.143, 0.322, 0.37, 0.551], hood: "cap" }],
    belts: [[0.045, 0.465, 0.62, 0.65], [0.045, 0.465, 0.315, 0.345]],
    entry: { open: [0.11, 0.345], top: 0.29, floor: 0.012, posts: [[0.055, 0.11], [0.345, 0.395]], arch: true },
  },
  {
    name: "sage",
    floors: 2,
    cornice: 0.915,
    brackets: [0.035, 0.975],
    bay: { wall: [0.05, 0.65], front: [0.215, 0.495], v: [0.255, 0.915], bands: [[0.255, 0.285], [0.585, 0.61], [0.875, 0.915]], windows: [[0.336, 0.546], [0.666, 0.85]], base: "garage", faces: "panel" },
    windows: [{ r: [0.764, 0.9, 0.653, 0.849], hood: "cap" }, { r: [0.764, 0.9, 0.331, 0.526], hood: "cap" }],
    entry: { open: [0.735, 0.915], top: 0.25, floor: 0.012, posts: [[0.69, 0.735], [0.915, 0.96]], hood: [0.67, 0.985, 0.25, 0.275] },
    garage: [0.1, 0.61, 0, 0.205],
  },
  {
    name: "white",
    floors: 3,
    cornice: 0.905,
    brackets: [0.044, 0.164, 0.41, 0.52, 0.66, 0.96],
    bay: { wall: [0.065, 0.52], front: [0.17, 0.415], v: [0, 0.905], bands: [[0.28, 0.3], [0.585, 0.605], [0.865, 0.905]], windows: [[0.055, 0.248], [0.367, 0.551], [0.67, 0.854]], base: "ground", faces: "body" },
    windows: [{ r: [0.71, 0.845, 0.663, 0.839], hood: "pediment" }, { r: [0.71, 0.845, 0.37, 0.551], hood: "pediment" }],
    entry: { open: [0.665, 0.895], top: 0.33, floor: 0.015, posts: [[0.595, 0.665], [0.895, 0.965]], hood: [0.575, 0.985, 0.33, 0.36] },
  },
];

/** Linear RGB for every palette and slot (palette * SLOTS.length + slot), for the house material. */
export function palette() {
  const out = new Float32Array(PALETTES.length * SLOTS.length * 3);
  const c = new Color();
  PALETTES.forEach((p, i) => {
    const paint: Record<Slot, string> = { body: p.body, trim: p.trim, frieze: p.panel, panel: p.panel, sash: p.dark, door: p.dark, scales: p.panel, stucco: p.body, ...FIXED };
    SLOTS.forEach((s, k) => c.set(paint[s]).toArray(out, (i * SLOTS.length + k) * 3));
  });
  return out;
}

// How far parts stand out of the wall (reference units).
const BAY_D = 0.27;
const BAND_GROW = 0.035;
const CROWN_D = RELIEF_DEPTH;
const CROWN_H = 0.16;
const FRIEZE_D = 0.05;
const STOOP_D = 0.34;
const PORCH = 0.3; // entry recess
const REC = 0.05; // glass behind the casing
const CASE_W = 0.06;
const CASE_D = 0.035;
const SASH = 0.028;

/** Local coordinates in a frame: a along the wall, b up, c out of it. */
export type L3 = [number, number, number];
export type P2 = [number, number];
/** A wall: origin and unit direction along it (horizontal); out is along x up. */
export type Frame = { o: L3; u: L3 };
const FRONT: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
const X = (u: number) => (u - 0.5) * W;
const Y = (v: number) => v * H;

/** The modelling kit (also used by the 06:00 apartment in rooftop.tsx and the 07:00 shop in shop.tsx). */
export function builder() {
  const pos: number[] = [];
  const nrm: number[] = [];
  const slots: number[] = [];
  const wins: number[] = [];
  const panes: number[] = [];
  const edges: number[] = [];
  const idx: number[] = [];
  const world = ({ o, u }: Frame, [a, b, c]: L3): L3 => [o[0] + u[0] * a - u[2] * c, o[1] + b, o[2] + u[2] * a + u[0] * c];
  const dir = ({ u }: Frame, [a, b, c]: L3): L3 => [u[0] * a - u[2] * c, b, u[2] * a + u[0] * c];

  /**
   * A flat convex polygon (or a fan from its first point), facing roughly `out`. `on`: which edges
   * (corner k to k + 1) are real, for the bevel; all of them unless told.
   */
  function face(f: Frame, local: L3[], out: L3, slot: number, id = 0, on?: boolean[]) {
    const p = local.map((q) => world(f, q));
    let [nx, ny, nz] = [0, 0, 0];
    for (let i = 0; i < p.length; i++) {
      const [x1, y1, z1] = p[i];
      const [x2, y2, z2] = p[(i + 1) % p.length];
      nx += (y1 - y2) * (z1 + z2);
      ny += (z1 - z2) * (x1 + x2);
      nz += (x1 - x2) * (y1 + y2);
    }
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-10) return;
    const [ox, oy, oz] = dir(f, out);
    // Newell's normal follows the winding (counter-clockwise seen from outside): turn it to face out
    const flip = nx * ox + ny * oy + nz * oz < 0;
    const k = flip ? -1 / len : 1 / len;
    const base = pos.length / 3;
    // glass: where each corner is on its pane (0..1 across and up), for blinds and curtains
    const as = local.map((q) => q[0]);
    const bs = local.map((q) => q[1]);
    const span = (x: number, xs: number[]) => (x - Math.min(...xs)) / Math.max(1e-6, Math.max(...xs) - Math.min(...xs));
    const paned = PANED.includes(slot);
    p.forEach((q, i) => {
      pos.push(...q);
      nrm.push(nx * k, ny * k, nz * k);
      slots.push(slot);
      wins.push(id);
      if (paned) panes.push(span(as[i], as), span(bs[i], bs));
      else panes.push(0, 0);
    });
    edges.push(...edgeDistances(p, on ?? p.map(() => true)));
    for (let i = 1; i < p.length - 1; i++) idx.push(...(flip ? [base, base + i + 1, base + i] : [base, base + i, base + i + 1]));
  }

  /**
   * A convex solid between two matching rings. Faces lying on the wall
   * (c = 0, facing in) or under the footing are left out: nobody sees them.
   * Edges lying on the wall are inside corners: no bevel there.
   */
  function solid(f: Frame, r0: L3[], r1: L3[], slot: number, id = 0) {
    const all = [...r0, ...r1];
    const mid = [0, 1, 2].map((k) => all.reduce((s, q) => s + q[k], 0) / all.length) as L3;
    const faces = [r0, r1, ...r0.map((_, i) => [r0[i], r0[(i + 1) % r0.length], r1[(i + 1) % r0.length], r1[i]])];
    for (const pts of faces) {
      const centre = [0, 1, 2].map((k) => pts.reduce((s, q) => s + q[k], 0) / pts.length) as L3;
      const out: L3 = [centre[0] - mid[0], centre[1] - mid[1], centre[2] - mid[2]];
      if (pts.every((q) => Math.abs(q[2]) < 1e-6) && out[2] < 0) continue;
      if (pts.every((q) => q[1] <= -FOOT + 1e-6) && out[1] < 0) continue;
      const flat = (q: L3) => Math.abs(q[2]) < 1e-6;
      face(f, pts, out, slot, id, pts.map((q, i) => !(flat(q) && flat(pts[(i + 1) % pts.length]))));
    }
  }
  const ring = (a0: number, a1: number, c0: number, c1: number, b: number): L3[] => [[a0, b, c0], [a1, b, c0], [a1, b, c1], [a0, b, c1]];
  const box = (f: Frame, a0: number, a1: number, b0: number, b1: number, c0: number, c1: number, slot: number, id = 0) =>
    solid(f, ring(a0, a1, c0, c1, b0), ring(a0, a1, c0, c1, b1), slot, id);
  /** A profile in the (c, b) plane, run along the wall from a0 to a1. */
  const profile = (f: Frame, a0: number, a1: number, pts: P2[], slot: number) =>
    solid(f, pts.map(([c, b]) => [a0, b, c]), pts.map(([c, b]) => [a1, b, c]), slot);
  /** A shape in the (a, b) plane, from c0 out to c1. */
  const slab = (f: Frame, pts: P2[], c0: number, c1: number, slot: number) =>
    solid(f, pts.map(([a, b]) => [a, b, c0]), pts.map(([a, b]) => [a, b, c1]), slot);
  /** A plan in the (a, c) plane, from b0 up to b1. */
  const prism = (f: Frame, plan: P2[], b0: number, b1: number, slot: number) =>
    solid(f, plan.map(([a, c]) => [a, b0, c]), plan.map(([a, c]) => [a, b1, c]), slot);
  /** A rectangle facing out of the wall at depth c. `on`: its real edges (bottom, right, top, left). */
  const quad = (f: Frame, a0: number, a1: number, b0: number, b1: number, c: number, slot: number, id = 0, facing = 1, on?: boolean[]) =>
    face(f, [[a0, b0, c], [a1, b0, c], [a1, b1, c], [a0, b1, c]], [0, 0, facing], slot, id, on);

  /**
   * A wall from a0 to a1 and b0 to b1 with rectangular holes, as few rectangles as it takes.
   * Bevelled at its ends and round its holes; not at its top and foot (a cornice or the ground meets
   * them) nor along the seams between its rectangles.
   */
  function wall(f: Frame, a0: number, a1: number, b0: number, b1: number, holes: Rect[], slot: number) {
    const cuts = (k: 0 | 2, lo: number, hi: number) =>
      [...new Set([lo, hi, ...holes.flatMap((r) => [r[k], r[k + 1]]).filter((x) => x > lo && x < hi)])].sort((p, q) => p - q);
    const as = cuts(0, a0, a1);
    const bs = cuts(2, b0, b1);
    const open = (a: number, b: number) => holes.some(([h0, h1, v0, v1]) => a > h0 && a < h1 && b > v0 && b < v1);
    // a run's top or bottom is an edge only where the row beyond is open all along it
    const clear = (i0: number, i1: number, j: number) => {
      if (j < 0 || j >= bs.length - 1) return false;
      for (let i = i0; i < i1; i++) if (!open((as[i] + as[i + 1]) / 2, (bs[j] + bs[j + 1]) / 2)) return false;
      return true;
    };
    for (let j = 0; j < bs.length - 1; j++) {
      const bm = (bs[j] + bs[j + 1]) / 2;
      let start = -1;
      for (let i = 0; i <= as.length - 1; i++) {
        const solidCell = i < as.length - 1 && !open((as[i] + as[i + 1]) / 2, bm);
        if (solidCell && start < 0) start = i;
        if (!solidCell && start >= 0) {
          quad(f, as[start], as[i], bs[j], bs[j + 1], 0, slot, 0, 1, [clear(start, i, j - 1), true, clear(start, i, j + 1), true]);
          start = -1;
        }
      }
    }
  }

  /** The sides of an opening, from c0 back to c1 (faces look into the opening). */
  function reveal(f: Frame, [a0, a1, b0, b1]: Rect, c0: number, c1: number, slot: number, head = true) {
    face(f, [[a0, b0, c0], [a0, b1, c0], [a0, b1, c1], [a0, b0, c1]], [1, 0, 0], slot);
    face(f, [[a1, b0, c0], [a1, b1, c0], [a1, b1, c1], [a1, b0, c1]], [-1, 0, 0], slot);
    face(f, [[a0, b0, c0], [a1, b0, c0], [a1, b0, c1], [a0, b0, c1]], [0, 1, 0], slot);
    if (head) face(f, [[a0, b1, c0], [a1, b1, c0], [a1, b1, c1], [a0, b1, c1]], [0, -1, 0], slot);
  }

  /** A frame of four strips around a rectangle, facing out at c (sashes, casings). */
  function ring2(f: Frame, [a0, a1, b0, b1]: Rect, w: number, c: number, slot: number) {
    quad(f, a0 - w, a0, b0 - w, b1 + w, c, slot);
    quad(f, a1, a1 + w, b0 - w, b1 + w, c, slot);
    quad(f, a0, a1, b1, b1 + w, c, slot);
    quad(f, a0, a1, b0 - w, b0, c, slot);
  }

  /** Glass with its sash frame and meeting rail, at depth c. */
  function glazing(f: Frame, r: Rect, c: number, id: number, rail = true) {
    const [a0, a1, b0, b1] = r;
    quad(f, a0, a1, b0, b1, c, SLOT.glass, id);
    ring2(f, [a0 + SASH, a1 - SASH, b0 + SASH, b1 - SASH], SASH, c + 0.006, SLOT.sash);
    if (rail) quad(f, a0 + SASH, a1 - SASH, (b0 + b1) / 2 - SASH / 2, (b0 + b1) / 2 + SASH / 2, c + 0.006, SLOT.sash);
  }

  /**
   * A window in a wall (the caller cuts the hole): glass recessed behind the
   * opening; with `casing`, a frame proud of the wall, a sill and a hood.
   */
  function window(f: Frame, r: Rect, id: number, casing?: { hood: "cap" | "pediment" }) {
    const [a0, a1, b0, b1] = r;
    const cd = casing ? CASE_D : 0;
    reveal(f, r, cd, -REC, SLOT.trim);
    glazing(f, r, -REC, id);
    if (!casing) return;
    const o: Rect = [a0 - CASE_W, a1 + CASE_W, b0 - CASE_W, b1 + CASE_W];
    ring2(f, r, CASE_W, cd, SLOT.trim);
    face(f, [[o[0], o[2], 0], [o[0], o[3], 0], [o[0], o[3], cd], [o[0], o[2], cd]], [-1, 0, 0], SLOT.trim);
    face(f, [[o[1], o[2], 0], [o[1], o[3], 0], [o[1], o[3], cd], [o[1], o[2], cd]], [1, 0, 0], SLOT.trim);
    face(f, [[o[0], o[2], 0], [o[1], o[2], 0], [o[1], o[2], cd], [o[0], o[2], cd]], [0, -1, 0], SLOT.trim);
    // sill
    box(f, o[0] - 0.04, o[1] + 0.04, o[2] - 0.05, o[2], 0, cd + 0.05, SLOT.trim);
    // hood: a frieze and a cap, or a pediment
    const t = o[3];
    if (casing.hood === "cap") {
      box(f, o[0], o[1], t, t + 0.1, 0, cd, SLOT.frieze);
      box(f, o[0] - 0.05, o[1] + 0.05, t + 0.1, t + 0.15, 0, cd + 0.06, SLOT.trim);
    } else {
      box(f, o[0] - 0.04, o[1] + 0.04, t, t + 0.05, 0, cd + 0.05, SLOT.trim);
      slab(f, [[o[0] - 0.04, t + 0.05], [o[1] + 0.04, t + 0.05], [(a0 + a1) / 2, t + 0.21]], 0, cd + 0.03, SLOT.trim);
    }
  }

  function geometry() {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
    g.setAttribute("aSlot", new Float32BufferAttribute(slots, 1));
    g.setAttribute("aWin", new Float32BufferAttribute(wins, 1));
    g.setAttribute("aPane", new Float32BufferAttribute(panes, 2));
    g.setAttribute("aEdge", new Float32BufferAttribute(edges, 4));
    g.setIndex(idx);
    return g;
  }
  return { face, solid, box, profile, slab, prism, quad, wall, reveal, ring2, glazing, window, geometry };
}

/** The front of variant `v`: the front wall from the footing to the cornice crown, and everything on it. Frame: x across, y up, z out. */
export function frontGeometry(v: number) {
  const s = VARIANTS[v];
  const k = builder();
  let id = 0;
  const holes: Rect[] = [];

  // Flat-wall windows: casing, sill, hood.
  for (const w of s.windows) {
    const r: Rect = [X(w.r[0]), X(w.r[1]), Y(w.r[2]), Y(w.r[3])];
    holes.push(r);
    k.window(FRONT, r, ++id, { hood: w.hood });
  }
  for (const [u0, u1, v0, v1] of s.belts ?? []) k.box(FRONT, X(u0), X(u1), Y(v0), Y(v1), 0, 0.04, SLOT.frieze);

  id = bay(k, s, id);
  id = entry(k, s, id, holes);
  if (s.garage) id = garage(k, s, id, holes);

  // The front wall, lap siding, with its openings.
  const crown = H - CROWN_H;
  k.wall(FRONT, -W / 2, W / 2, -FOOT, crown, holes, SLOT.body);
  // The false front seen from behind, above the flat roof.
  k.quad(FRONT, -W / 2, W / 2, H - 0.2, H, 0, SLOT.body, 0, -1);

  // The cornice: frieze, brackets (or dentils), bed moulding, crown.
  const c0 = Y(s.cornice);
  k.box(FRONT, -W / 2, W / 2, c0, crown - 0.06, 0, FRIEZE_D, SLOT.frieze);
  k.box(FRONT, -W / 2, W / 2, crown - 0.06, crown, 0, 0.15, SLOT.trim);
  k.box(FRONT, -W / 2, W / 2, crown, H, 0, CROWN_D, SLOT.trim);
  for (const u of s.brackets) {
    const x = Math.min(W / 2 - 0.045, Math.max(-W / 2 + 0.045, X(u)));
    k.profile(FRONT, x - 0.045, x + 0.045, [[0, c0 - 0.14], [0.07, c0 - 0.14], [0.27, crown - 0.06], [0, crown - 0.06]], SLOT.trim);
  }
  if (s.dentils) for (let x = -W / 2 + 0.06; x < W / 2 - 0.05; x += 0.15) k.box(FRONT, x, x + 0.08, crown - 0.15, crown - 0.06, 0, 0.11, SLOT.trim);
  return k.geometry();
}

export type Builder = ReturnType<typeof builder>;

/**
 * A plain geometry (a box, a cylinder) in the kit's attributes, painted `slot`: non-indexed, no uvs,
 * no bevel. With a member's `axis`, aPane is where on the member: along it and round it (world units),
 * for wood grain and rolled steel.
 */
export function asKit(g: BufferGeometry, slot: number, axis?: L3) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute("uv");
  const pos = out.attributes.position;
  const nrm = out.attributes.normal;
  const n = pos.count;
  const pane = new Float32Array(n * 2);
  if (axis) {
    const a = new Vector3(...axis).normalize();
    const [p, q, t] = [new Vector3(), new Vector3(), new Vector3()];
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i);
      q.fromBufferAttribute(nrm, i);
      // round the member: across this face (on an end cap, any way across it)
      t.crossVectors(q, a);
      if (t.lengthSq() < 1e-6) t.set(a.y, a.z, a.x).cross(a);
      pane[i * 2] = p.dot(a);
      pane[i * 2 + 1] = p.dot(t.normalize());
    }
  }
  out.setAttribute("aSlot", new Float32BufferAttribute(new Float32Array(n).fill(slot), 1));
  out.setAttribute("aWin", new Float32BufferAttribute(new Float32Array(n), 1));
  out.setAttribute("aPane", new Float32BufferAttribute(pane, 2));
  out.setAttribute("aEdge", new Float32BufferAttribute(new Float32Array(n * 4), 4));
  return out;
}

// ---------- Shared by the landmark blocks (rooftop.tsx, union-square.tsx) ----------

/** A rectangle in plan (world x and z). */
export type Box2 = { x0: number; x1: number; z0: number; z1: number };
/** World axes as a frame: (a, b, c) is (x, y, z). */
const WORLD: Frame = { o: [0, 0, 0], u: [1, 0, 0] };

/** Four walls of a rectangle, counter-clockwise from the south (+z), each facing out. `wraps`: north and south run round the corners. */
export function sides(r: Box2) {
  return [
    { f: { o: [r.x0, 0, r.z1], u: [1, 0, 0] } as Frame, len: r.x1 - r.x0, wraps: true, name: "south" },
    { f: { o: [r.x1, 0, r.z1], u: [0, 0, -1] } as Frame, len: r.z1 - r.z0, wraps: false, name: "east" },
    { f: { o: [r.x1, 0, r.z0], u: [-1, 0, 0] } as Frame, len: r.x1 - r.x0, wraps: true, name: "north" },
    { f: { o: [r.x0, 0, r.z0], u: [0, 0, 1] } as Frame, len: r.z1 - r.z0, wraps: false, name: "west" },
  ];
}

/**
 * A moulding run round a rectangle and mitred at its corners. `profile` is
 * (out, y) points from the wall out and back, counter-clockwise seen along
 * the wall (out to the right); out < 0 runs round the inside (a parapet).
 * Its edges against the wall (out 0) are inside corners: no bevel; `bevel` false leaves out every edge
 * (a parapet's inner face: inside corners all round).
 */
export function moulding(k: Builder, r: Box2, profile: P2[], slot: number, bevel = true) {
  const ring = (c: number): P2[] => [[r.x0 - c, r.z0 - c], [r.x1 + c, r.z0 - c], [r.x1 + c, r.z1 + c], [r.x0 - c, r.z1 + c]];
  const outs: P2[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let i = 0; i < profile.length - 1; i++) {
    const [[c0, y0], [c1, y1]] = [profile[i], profile[i + 1]];
    const [p, q] = [ring(c0), ring(c1)];
    for (let s = 0; s < 4; s++) {
      const t = (s + 1) % 4;
      const out: L3 = [outs[s][0] * (y1 - y0), c0 - c1, outs[s][1] * (y1 - y0)];
      k.face(WORLD, [[p[s][0], y0, p[s][1]], [p[t][0], y0, p[t][1]], [q[t][0], y1, q[t][1]], [q[s][0], y1, q[s][1]]], out, slot, 0, [bevel && c0 !== 0, bevel, bevel && c1 !== 0, bevel]);
    }
  }
}

/** The bay window: three faces with a window per storey, corner posts, floor cornices, its base. */
function bay(k: Builder, s: Variant, id: number) {
  const { wall: [w0, w1], front: [f0, f1], v: [v0], bands, windows, base, faces } = s.bay;
  const plan: P2[] = [[X(w0), 0], [X(f0), BAY_D], [X(f1), BAY_D], [X(w1), 0]];
  const bot = base === "ground" ? -FOOT : Y(v0);
  const top = Y(s.cornice);
  const paint = faces === "body" ? SLOT.body : SLOT.panel;
  const spandrel = s.bay.scales ? SLOT.scales : faces === "body" ? SLOT.panel : SLOT.body;
  for (let i = 0; i < 3; i++) {
    const [p, q] = [plan[i], plan[i + 1]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const f: Frame = { o: [p[0], 0, p[1]], u: [(q[0] - p[0]) / len, 0, (q[1] - p[1]) / len] };
    const m = i === 1 ? Math.max(0.09, len * 0.1) : Math.max(0.07, len * 0.2);
    const holes: Rect[] = windows.map(([b0, b1]) => [m, len - m, Y(b0), Y(b1)]);
    k.wall(f, 0, len, bot, top, holes, paint);
    for (const r of holes) {
      k.window(f, r, ++id);
      // the panel under each window, down to the band or base below it
      const below = Math.max(Y(v0), ...bands.map(([, b1]) => Y(b1)).filter((b) => b < r[2]));
      if (r[2] - below > 0.2) k.box(f, m, len - m, below + 0.06, r[2] - 0.07, 0, 0.02, spandrel);
    }
  }
  // corner posts
  for (const [x, z] of plan) k.box(FRONT, x - 0.04, x + 0.04, bot, top, Math.max(0, z - 0.03), z + 0.035, SLOT.trim);
  // floor cornices: the plan grown a little
  const g = BAND_GROW;
  const grown: P2[] = [[X(w0) - g, 0], [X(f0) - g * 0.4, BAY_D + g], [X(f1) + g * 0.4, BAY_D + g], [X(w1) + g, 0]];
  for (const [b0, b1] of bands) k.prism(FRONT, grown, Y(b0), Y(b1), SLOT.trim);
  if (base !== "ground") {
    // the underside, and corbels under the front corners
    k.face(FRONT, plan.map(([a, c]) => [a, bot, c]), [0, -1, 0], SLOT.trim);
    if (base === "corbels") {
      for (const u of [f0, f1]) {
        const x = X(u);
        k.profile(FRONT, x - 0.05, x + 0.05, [[0, bot - 0.4], [0.06, bot - 0.4], [BAY_D, bot], [0, bot]], SLOT.trim);
      }
    }
  }
  return id;
}

/** The recessed entry: porch, door with panels, transom (or fanlight under an arch), posts or columns, hood, stoop. */
function entry(k: Builder, s: Variant, id: number, holes: Rect[]) {
  const e = s.entry;
  const [a0, a1] = e.open.map(X);
  const top = Y(e.top);
  const floor = Y(e.floor);
  const mid = (a0 + a1) / 2;
  const r = (a1 - a0) / 2;
  const spring = top - r;
  holes.push([a0, a1, 0, top]);
  k.reveal(FRONT, [a0, a1, 0, top], 0, -PORCH, SLOT.trim, !e.arch);
  k.quad(FRONT, a0, a1, 0, top, -PORCH, SLOT.trim);

  // the door, two raised panels, and the glass over it
  const dw = Math.min(a1 - a0 - 0.12, 0.62);
  const [d0, d1] = [mid - dw / 2, mid + dw / 2];
  const dt = e.arch ? spring : top - 0.3;
  const back = -PORCH;
  k.box(FRONT, d0, d1, floor, dt, back, back + 0.03, SLOT.door);
  const h = dt - floor;
  for (const [p0, p1] of [[0.07, 0.42], [0.5, 0.92]]) k.box(FRONT, d0 + 0.07, d1 - 0.07, floor + h * p0, floor + h * p1, back + 0.03, back + 0.045, SLOT.door);
  if (e.arch) {
    // spandrels fill the corners above the arch, an archivolt frames it, the fanlight fills it
    const n = 8;
    const arc = (rad: number, from: number, to: number) => Array.from({ length: n + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / n;
      return [mid + Math.cos(t) * rad, spring + Math.sin(t) * rad] as P2;
    });
    k.face(FRONT, [[a0, top, 0], ...arc(r, Math.PI, Math.PI / 2).map(([a, b]) => [a, b, 0] as L3)], [0, 0, 1], SLOT.trim);
    k.face(FRONT, [[a1, top, 0], ...arc(r, 0, Math.PI / 2).map(([a, b]) => [a, b, 0] as L3)], [0, 0, 1], SLOT.trim);
    const inner = arc(r, Math.PI, 0);
    const outer = arc(r + 0.07, Math.PI, 0);
    for (let i = 0; i < n; i++) {
      const [p, q] = [inner[i], inner[i + 1]];
      // the arch's underside, back into the porch
      k.face(FRONT, [[p[0], p[1], 0], [q[0], q[1], 0], [q[0], q[1], back], [p[0], p[1], back]], [mid - (p[0] + q[0]) / 2, spring - (p[1] + q[1]) / 2, 0], SLOT.trim);
      const [P, Q] = [outer[i], outer[i + 1]];
      k.face(FRONT, [[p[0], p[1], 0.05], [q[0], q[1], 0.05], [Q[0], Q[1], 0.05], [P[0], P[1], 0.05]], [0, 0, 1], SLOT.trim);
      k.face(FRONT, [[P[0], P[1], 0], [Q[0], Q[1], 0], [Q[0], Q[1], 0.05], [P[0], P[1], 0.05]], [(P[0] + Q[0]) / 2 - mid, (P[1] + Q[1]) / 2 - spring, 0], SLOT.trim);
    }
    k.box(FRONT, mid - 0.06, mid + 0.06, top - 0.1, top + 0.08, 0, 0.08, SLOT.trim); // keystone
    const fan = arc(r - 0.06, Math.PI, 0).map(([a, b]) => [a, b, back + 0.005] as L3);
    k.face(FRONT, [[mid, spring, back + 0.005], ...fan], [0, 0, 1], SLOT.glass, ++id);
  } else {
    k.glazing(FRONT, [d0, d1, dt + 0.05, top - 0.07], back + 0.005, ++id, false);
  }

  // posts: columns on their bases, or pilasters with capitals
  const hoodB = e.hood ? Y(e.hood[2]) : top;
  for (const [p0, p1] of e.posts.map((p) => p.map(X))) {
    const x = (p0 + p1) / 2;
    if (e.columns) {
      k.box(FRONT, x - 0.08, x + 0.08, -FOOT, floor + 0.14, 0.01, 0.19, SLOT.trim);
      k.box(FRONT, x - 0.05, x + 0.05, floor + 0.14, hoodB - 0.1, 0.05, 0.15, SLOT.trim);
      k.box(FRONT, x - 0.08, x + 0.08, hoodB - 0.1, hoodB, 0.01, 0.19, SLOT.trim);
    } else {
      k.box(FRONT, p0, p1, -FOOT, hoodB, 0, 0.06, SLOT.trim);
      k.box(FRONT, p0 - 0.02, p1 + 0.02, hoodB - 0.09, hoodB, 0, 0.09, SLOT.trim);
    }
  }
  if (e.hood) {
    const [h0, h1, hb0, hb1] = [X(e.hood[0]), X(e.hood[1]), Y(e.hood[2]), Y(e.hood[3])];
    k.box(FRONT, h0, h1, hb0, hb1 - 0.05, 0, 0.2, SLOT.frieze);
    k.box(FRONT, Math.max(-W / 2, h0 - 0.03), Math.min(W / 2, h1 + 0.03), hb1 - 0.05, hb1, 0, 0.25, SLOT.trim);
  }

  // the stoop: a tall one is three deep treads running into the porch (they still read as
  // steps where the front is flattened beside Cuso's line), with cheek walls and newels
  const tall = floor > 0.25;
  const steps = tall ? 3 : 1;
  const out = tall ? STOOP_D : 0.16;
  const inner = tall ? -PORCH * 0.8 : 0;
  const tread = (out - inner) / steps;
  const cheek = tall ? 0.06 : 0;
  for (let i = 1; i <= steps; i++) {
    const c1 = out - (i - 1) * tread;
    const c0 = i === steps ? back : c1 - tread;
    k.box(FRONT, a0 + cheek, a1 - cheek, -FOOT, Math.max(floor * (i / steps), 0.05), c0, c1, SLOT.stone);
  }
  if (tall) {
    const low = floor / steps + 0.24;
    for (const [c0, c1] of [[a0, a0 + cheek], [a1 - cheek, a1]]) {
      k.profile(FRONT, c0, c1, [[out, -FOOT], [out, low], [inner, floor + 0.24], [inner, -FOOT]], SLOT.trim);
      k.box(FRONT, c0 - 0.012, c1 + 0.012, low - 0.06, low + 0.2, out - 0.09, out, SLOT.trim);
    }
  }
  return id;
}

/** The garage under the bay: a recessed panelled door with a row of lites, posts, a lintel. */
function garage(k: Builder, s: Variant, id: number, holes: Rect[]) {
  const [u0, u1, , v1] = s.garage!;
  const [a0, a1, top] = [X(u0), X(u1), Y(v1)];
  const back = -0.1;
  holes.push([a0, a1, 0, top]);
  k.reveal(FRONT, [a0, a1, 0, top], 0, back, SLOT.trim);
  k.quad(FRONT, a0, a1, 0, top, back, SLOT.panel);
  for (const t of [0.22, 0.47]) k.box(FRONT, a0 + 0.03, a1 - 0.03, top * t - 0.018, top * t + 0.018, back, back + 0.025, SLOT.trim);
  // the lites, one window
  const l0 = top * 0.72;
  const l1 = top * 0.9;
  k.quad(FRONT, a0 + 0.05, a1 - 0.05, l0, l1, back + 0.005, SLOT.glass, ++id);
  for (let i = 0; i <= 4; i++) {
    const x = a0 + 0.05 + ((a1 - a0 - 0.1) * i) / 4;
    k.quad(FRONT, x - 0.02, x + 0.02, l0, l1, back + 0.01, SLOT.trim);
  }
  for (const x of [a0 - 0.12, a1]) k.box(FRONT, x, x + 0.12, -FOOT, top, 0, 0.06, SLOT.trim);
  k.box(FRONT, a0 - 0.14, a1 + 0.14, top, Y(s.bay.v[0]), 0, 0.1, SLOT.trim);
  return id;
}

/**
 * The body behind the front: side walls with two small windows each, the
 * back wall, and a roof. `gable`: a shingled roof running back from a
 * fish-scale gable over the cornice; else a flat tar roof behind the false
 * front, with a brick chimney. Frame: x across, y up, z from the front wall (0)
 * back to -BODY_DEPTH.
 */
export function bodyGeometry(gable: boolean) {
  const k = builder();
  const D = BODY_DEPTH;
  const eave = gable ? H - 0.15 : H - 0.18;
  const left: Frame = { o: [-W / 2, 0, -D], u: [0, 0, 1] };
  const right: Frame = { o: [W / 2, 0, 0], u: [0, 0, -1] };
  const back: Frame = { o: [W / 2, 0, -D], u: [-1, 0, 0] };
  let id = 40;
  for (const [f, rects] of [
    [left, [[0.55, 0.95, 1.05, 1.65], [1.55, 1.95, 2.75, 3.35]]],
    [right, [[0.65, 1.05, 2.75, 3.35], [1.65, 2.05, 1.05, 1.65]]],
  ] as [Frame, Rect[]][]) {
    k.wall(f, 0, D, -FOOT, eave, rects, SLOT.body);
    for (const r of rects) {
      k.reveal(f, r, 0, -0.05, SLOT.trim);
      k.glazing(f, r, -0.05, ++id);
      // flush trim: neighbours stand 0.06 away
      k.box(f, r[0] - 0.05, r[1] + 0.05, r[2] - 0.05, r[2], 0, 0.02, SLOT.trim);
      k.box(f, r[0] - 0.05, r[1] + 0.05, r[3], r[3] + 0.06, 0, 0.02, SLOT.trim);
    }
  }
  k.wall(back, 0, W, -FOOT, eave, [], SLOT.body);

  const top: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
  if (!gable) {
    k.face(top, [[-W / 2, eave, 0], [W / 2, eave, 0], [W / 2, eave, -D], [-W / 2, eave, -D]], [0, 1, 0], SLOT.tar);
    k.box(top, 0.85, 1.2, eave, H - 0.02, -2.15, -1.8, SLOT.brick);
    return k.geometry();
  }
  // Two shingled slopes, ridge front to back.
  const rise = 1.15;
  const ridge = eave + rise;
  const t = 0.06;
  const ov = 0.02;
  const ye = eave - (ov * rise) / (W / 2);
  const zf = 0.03;
  for (const side of [-1, 1]) {
    const xe = side * (W / 2 + ov);
    const sec = (z: number): L3[] => [[xe, ye, z], [xe, ye + t, z], [0, ridge + t, z], [0, ridge, z]];
    k.face(top, sec(zf), [0, 0, 1], SLOT.trim);
    k.face(top, sec(-D), [0, 0, -1], SLOT.roof);
    k.face(top, [[xe, ye + t, zf], [0, ridge + t, zf], [0, ridge + t, -D], [xe, ye + t, -D]], [side, 1, 0], SLOT.roof);
    k.face(top, [[xe, ye, zf], [xe, ye + t, zf], [xe, ye + t, -D], [xe, ye, -D]], [side, 0, 0], SLOT.trim);
    // bargeboard along the front rake
    const board = (x: number, y: number): L3[] => [[x, y + t, zf], [x, y + t, zf + 0.07], [x, y + t - 0.13, zf + 0.07], [x, y + t - 0.13, zf]];
    const solidBoard = [board(xe, ye), board(0, ridge)];
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0]]) {
      const [p, q] = solidBoard;
      k.face(top, [p[i], p[j], q[j], q[i]], [[0, 1, 0], [0, 0, 1], [0, -1, 0], [0, 0, -1]][i] as L3, SLOT.trim);
    }
  }
  k.box(top, -0.05, 0.05, ridge + t - 0.01, ridge + t + 0.04, -D, zf + 0.07, SLOT.trim);
  // the gables: fish-scale shingles on the street, plain at the back
  k.face(top, [[-W / 2, eave, 0], [W / 2, eave, 0], [0, ridge, 0]], [0, 0, 1], SLOT.scales);
  k.face(top, [[-W / 2, eave, -D], [W / 2, eave, -D], [0, ridge, -D]], [0, 0, -1], SLOT.body);
  // an attic window in the gable
  const r: Rect = [-0.17, 0.17, eave + 0.3, eave + 0.68];
  k.glazing(top, r, 0.01, ++id);
  k.ring2(top, r, 0.05, 0.035, SLOT.trim);
  k.box(top, r[0] - 0.09, r[1] + 0.09, r[2] - 0.1, r[2] - 0.05, 0, 0.08, SLOT.trim);
  return k.geometry();
}
