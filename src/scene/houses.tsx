"use client";

// Victorian row houses (Painted Ladies). Each house is a box with one of six
// real facade photos on the street side (houses-atlas.jpg), and in front of it
// a relief built from that photo: bay windows, the cornice with its brackets,
// window hoods and sills, the entry and its steps. The relief takes its colour
// from the photo by front projection, so every part shows what the photo
// shows at that spot, and edges that face sideways or up stretch the photo's
// edge colour. One instanced mesh per facade tile.

import { useMemo } from "react";
import { BoxGeometry, BufferGeometry, DataTexture, ExtrudeGeometry, Float32BufferAttribute, NearestFilter, Object3D, RedFormat, Shape, Vector2, Vector3, type Texture } from "three";
import { WALK_OFFSET, WALK_Z } from "./grid";
import { HOUSE_GAP, type House } from "./layout";
import { FOOTING, houseMaterial, roofMaterial } from "./materials";
import { Instances } from "./parts";
import { HULL } from "./rig";

/** A span across the facade photo, as shares of the tile (u from the left, v from the ground). */
type Span = [number, number];
/** A rectangle on the photo: [u0, u1, v0, v1]. */
type Rect = [number, number, number, number];

export type Facade = {
  /** Where the main cornice starts (its frieze); the crown is the top CROWN of the tile. */
  cornice: number;
  /** Centres of the cornice brackets. */
  brackets: number[];
  /** The bay window: its sides meet the wall at `wall`, its front face spans `front`. `bands` are the floor cornices around it. */
  bay: { wall: Span; front: Span; v: Span; bands: Span[] };
  /** Window hoods and sills. */
  ledges: Rect[];
  /** Entry pilasters and other posts. */
  posts: Rect[];
  /** The hood over the front door. */
  entry: Rect;
  /** The stoop below the door (v0 is the ground). */
  steps: Rect;
  /** Window openings (glass and sashes), lit at night one by one. */
  windows: Rect[];
};

/** The six tiles of houses-atlas.jpg (3 x 2, row by row), measured from the photos. */
export const FACADES: Facade[] = [
  // 0 · blue, two storeys, bay on the right, columned porch on the left
  {
    cornice: 0.905,
    brackets: [0.035, 0.24, 0.43, 0.6, 0.8, 0.965],
    bay: { wall: [0.44, 0.935], front: [0.555, 0.82], v: [0.03, 0.905], bands: [[0.875, 0.915], [0.455, 0.495], [0.03, 0.07]] },
    ledges: [[0.1, 0.365, 0.8, 0.865], [0.11, 0.35, 0.505, 0.53]],
    posts: [[0.01, 0.1, 0, 0.47], [0.3, 0.39, 0, 0.47]],
    entry: [0.005, 0.405, 0.47, 0.505],
    steps: [0.08, 0.33, 0, 0.03],
    windows: [[0.165, 0.305, 0.536, 0.775], [0.493, 0.553, 0.549, 0.81], [0.615, 0.769, 0.563, 0.817], [0.83, 0.886, 0.549, 0.805], [0.493, 0.553, 0.128, 0.393], [0.615, 0.769, 0.131, 0.396], [0.83, 0.886, 0.128, 0.393], [0.139, 0.303, 0.331, 0.378]],
  },
  // 1 · green, three storeys, bay on the left
  {
    cornice: 0.905,
    brackets: [0.02, 0.17, 0.42, 0.575, 0.98],
    bay: { wall: [0.04, 0.555], front: [0.15, 0.43], v: [0, 0.965], bands: [[0.585, 0.625], [0.25, 0.29]] },
    ledges: [[0.655, 0.915, 0.86, 0.9], [0.67, 0.895, 0.615, 0.65], [0.655, 0.915, 0.535, 0.575]],
    posts: [[0.625, 0.665, 0, 0.295], [0.895, 0.935, 0, 0.295]],
    entry: [0.6, 0.975, 0.295, 0.335],
    steps: [0.665, 0.895, 0, 0.015],
    windows: [[0.08, 0.135, 0.68, 0.893], [0.209, 0.385, 0.695, 0.897], [0.463, 0.517, 0.68, 0.893], [0.08, 0.135, 0.338, 0.549], [0.209, 0.385, 0.348, 0.551], [0.463, 0.517, 0.338, 0.549], [0.08, 0.135, 0.023, 0.219], [0.209, 0.385, 0.031, 0.219], [0.463, 0.517, 0.023, 0.219], [0.714, 0.849, 0.658, 0.844], [0.714, 0.849, 0.344, 0.521], [0.703, 0.864, 0.201, 0.251]],
  },
  // 2 · yellow, two storeys, bay on the left on corbels, stairs up to the door
  {
    cornice: 0.905,
    brackets: [0.03, 0.165, 0.325, 0.485, 0.64, 0.73, 0.86, 0.97],
    bay: { wall: [0.06, 0.62], front: [0.2, 0.49], v: [0.09, 0.885], bands: [[0.855, 0.895], [0.48, 0.515], [0.09, 0.125]] },
    ledges: [[0.72, 0.93, 0.815, 0.845], [0.725, 0.92, 0.555, 0.575]],
    posts: [[0.655, 0.705, 0, 0.485], [0.945, 0.985, 0, 0.485], [0.18, 0.22, 0.015, 0.09], [0.455, 0.5, 0.015, 0.09]],
    entry: [0.645, 0.995, 0.485, 0.52],
    steps: [0.705, 0.945, 0, 0.115],
    windows: [[0.117, 0.173, 0.57, 0.8], [0.249, 0.435, 0.58, 0.808], [0.508, 0.568, 0.57, 0.8], [0.117, 0.173, 0.182, 0.421], [0.249, 0.435, 0.187, 0.426], [0.508, 0.568, 0.182, 0.421], [0.76, 0.883, 0.57, 0.802], [0.736, 0.898, 0.383, 0.419]],
  },
  // 3 · pink, three storeys, bay on the right, arched door on the left
  {
    cornice: 0.905,
    brackets: [],
    bay: { wall: [0.47, 0.935], front: [0.595, 0.82], v: [0, 0.905], bands: [[0.885, 0.925], [0.6, 0.625], [0.29, 0.315]] },
    ledges: [[0.095, 0.37, 0.875, 0.895], [0.095, 0.37, 0.58, 0.6], [0.045, 0.465, 0.635, 0.665], [0.045, 0.465, 0.32, 0.35]],
    posts: [[0.055, 0.11, 0, 0.29], [0.345, 0.395, 0, 0.29]],
    entry: [0.04, 0.41, 0.29, 0.31],
    steps: [0.11, 0.345, 0, 0.012],
    windows: [[0.143, 0.322, 0.675, 0.854], [0.143, 0.322, 0.37, 0.551], [0.139, 0.334, 0.19, 0.248], [0.51, 0.589, 0.683, 0.863], [0.64, 0.783, 0.695, 0.868], [0.835, 0.896, 0.683, 0.863], [0.51, 0.589, 0.368, 0.562], [0.64, 0.783, 0.375, 0.565], [0.835, 0.896, 0.368, 0.562], [0.51, 0.589, 0.067, 0.248], [0.64, 0.783, 0.07, 0.25], [0.835, 0.896, 0.067, 0.248]],
  },
  // 4 · sage, bay over a garage, door on the right
  {
    cornice: 0.915,
    brackets: [0.035, 0.975],
    bay: { wall: [0.05, 0.65], front: [0.215, 0.495], v: [0.255, 0.905], bands: [[0.88, 0.925], [0.585, 0.605], [0.255, 0.285]] },
    ledges: [[0.725, 0.945, 0.86, 0.885], [0.73, 0.94, 0.655, 0.67], [0.725, 0.945, 0.545, 0.565], [0.73, 0.94, 0.31, 0.33], [0.06, 0.65, 0.205, 0.225]],
    posts: [[0.69, 0.735, 0, 0.25], [0.915, 0.96, 0, 0.25], [0.06, 0.1, 0, 0.205], [0.61, 0.65, 0, 0.205]],
    entry: [0.67, 0.985, 0.255, 0.27],
    steps: [0.735, 0.915, 0, 0.012],
    windows: [[0.092, 0.193, 0.666, 0.875], [0.259, 0.463, 0.676, 0.883], [0.524, 0.622, 0.666, 0.875], [0.092, 0.193, 0.336, 0.546], [0.259, 0.463, 0.346, 0.549], [0.524, 0.622, 0.336, 0.546], [0.764, 0.9, 0.653, 0.849], [0.764, 0.9, 0.331, 0.526], [0.11, 0.6, 0.158, 0.199], [0.744, 0.905, 0.194, 0.224]],
  },
  // 5 · white with black trim, three storeys, bay on the left
  {
    cornice: 0.905,
    brackets: [0.044, 0.164, 0.41, 0.52, 0.66, 0.96],
    bay: { wall: [0.065, 0.52], front: [0.17, 0.415], v: [0, 0.905], bands: [[0.875, 0.915], [0.585, 0.605], [0.28, 0.3]] },
    ledges: [[0.645, 0.915, 0.83, 0.905], [0.655, 0.905, 0.635, 0.655], [0.645, 0.915, 0.545, 0.62]],
    posts: [[0.595, 0.665, 0, 0.33], [0.895, 0.965, 0, 0.33]],
    entry: [0.575, 0.985, 0.33, 0.355],
    steps: [0.665, 0.895, 0, 0.015],
    windows: [[0.095, 0.154, 0.67, 0.854], [0.212, 0.376, 0.678, 0.863], [0.435, 0.495, 0.67, 0.854], [0.095, 0.154, 0.367, 0.551], [0.212, 0.376, 0.37, 0.559], [0.435, 0.495, 0.367, 0.551], [0.095, 0.154, 0.055, 0.248], [0.212, 0.376, 0.055, 0.248], [0.435, 0.495, 0.055, 0.248], [0.71, 0.845, 0.663, 0.839], [0.71, 0.845, 0.37, 0.551], [0.695, 0.857, 0.236, 0.268]],
  },
];

// How far each part stands out from the wall, in world units.
const BAY = 0.3;
const BAND = 0.05; // floor cornices, beyond the bay
const FRIEZE = 0.08;
const LEDGE = 0.09;
const POST = 0.12;
const ENTRY = 0.2;
const STEP = 0.11; // per step
const CROWN_D = 0.36;
/** The cornice crown: the top share of the photo. */
const CROWN = 0.035;
/** The furthest any part stands out from the front wall (the cornice crown). */
export const RELIEF_DEPTH = CROWN_D;
/** Parts that start on the ground reach down this share of the height, so slopes show no gap. */
const BELOW = -0.2;
/** Keeps photo samples off the very edge of a tile. */
const INSET = 0.004;
/**
 * Faces that would only stretch one row or column of the photo (sides, tops
 * and undersides of parts) are painted one flat colour instead: their `aUv`
 * is the spot to take it from, plus FLAT on u. The shaders sample that spot
 * blurred (a small average), so it reads as plain trim.
 */
export const FLAT = 2;
/** Typical house width: turns world offsets into shares of the width. */
const WIDTH = 3;

type P = [u: number, z: number];
const unit = (u: number) => Math.min(1, Math.max(0, u));
type V3 = [number, number, number];
type UV = [number, number];

/**
 * Builds flat-shaded faces in the relief frame: x = u - 0.5, y = v, z = out
 * from the wall in world units. Faces that look out to the street take the
 * photo by front projection (u, v of the face itself); the others are flat
 * colour (see FLAT). `width` (world units) turns sideways offsets into shares
 * of the width; parts starting on the ground reach down to `below`.
 * The rooftop apartment (landmarks.tsx) uses it too.
 */
export function reliefBuilder(width = WIDTH, below = BELOW) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const n = new Vector3();
  const clamp = (x: number) => Math.min(1 - INSET, Math.max(INSET, x));
  /** A convex polygon; `out` is roughly its outward direction. `paint` makes it one flat colour. */
  function face(pts: V3[], out: V3, paint?: UV) {
    const p = pts.map(([u, v, z]) => new Vector3(u - 0.5, v, z));
    a.subVectors(p[1], p[0]);
    b.subVectors(p[2], p[0]);
    n.crossVectors(a, b).normalize();
    const flip = n.x * out[0] + n.y * out[1] + n.z * out[2] < 0;
    if (flip) n.negate();
    const base = pos.length / 3;
    pts.forEach(([u, v], i) => {
      pos.push(p[i].x, p[i].y, p[i].z);
      nrm.push(n.x, n.y, n.z);
      if (paint) uvs.push(clamp(paint[0]) + FLAT, clamp(paint[1]));
      else uvs.push(clamp(u), clamp(v));
    });
    for (let i = 1; i < p.length - 1; i++) idx.push(...(flip ? [base, base + i + 1, base + i] : [base, base + i, base + i + 1]));
  }
  /**
   * A part standing out from the wall between heights v0 and v1. Its plan is
   * a line from the wall out and back to the wall (u, z), at the bottom and
   * at the top (same u, the depth may differ for a sloped front). `paint` is
   * where its flat faces take their colour. `flat` paints every face.
   */
  function prism(bottom: P[], top: P[], v0: number, v1: number, paint: UV, flat = false) {
    // Below the ground line the photo has nothing to show: a plain footing.
    if (v0 <= 0.001 && below < 0 && !flat) {
      prism(bottom, bottom, below, 0, [paint[0], 0.02], true);
      v0 = 0;
    }
    const cu = bottom.reduce((s, [u]) => s + u, 0) / bottom.length;
    const cz = bottom.reduce((s, [, z]) => s + z, 0) / bottom.length;
    for (let i = 0; i < bottom.length - 1; i++) {
      const [p, q, p2, q2] = [bottom[i], bottom[i + 1], top[i + 1], top[i]];
      const du = q[0] - p[0];
      const dz = q[1] - p[1];
      const mu = (p[0] + q[0]) / 2 - cu;
      const mz = (p[1] + q[1]) / 2 - cz;
      const out: V3 = dz * mu - du * mz >= 0 ? [dz, 0, -du] : [-dz, 0, du];
      // a face that looks sideways would stretch one column of the photo
      const side = Math.abs(du) < 1e-9;
      face([[p[0], v0, p[1]], [q[0], v0, q[1]], [p2[0], v1, p2[1]], [q2[0], v1, q2[1]]], out, side || flat ? paint : undefined);
    }
    face(top.map(([u, z]) => [u, v1, z]), [0, 1, 0], paint);
    face(bottom.map(([u, z]) => [u, v0, z]), [0, -1, 0], paint);
  }
  /** A block from u0 to u1 and v0 to v1, dBottom out at its foot and dTop at its head; flat faces take the colour at its middle. */
  const box = (u0: number, u1: number, v0: number, v1: number, dBottom: number, dTop = dBottom) =>
    prism([[u0, 0], [u0, dBottom], [u1, dBottom], [u1, 0]], [[u0, 0], [u0, dTop], [u1, dTop], [u1, 0]], v0, v1, [(u0 + u1) / 2, (Math.max(0, v0) + v1) / 2]);
  /**
   * A three-sided bay: its sides meet the wall at `wall`, its front spans
   * `front`; `grow` widens it (a cornice band around it). Its top and
   * underside take the colour at `paintV` on the middle of the front.
   */
  function bay(wall: Span, front: Span, v0: number, v1: number, depth: number, grow = 0, paintV = (v0 + v1) / 2) {
    const e = grow / width;
    const plan: P[] = [[unit(wall[0] - e), 0], [unit(front[0] - e * 0.5), depth + grow], [unit(front[1] + e * 0.5), depth + grow], [unit(wall[1] + e), 0]];
    prism(plan, plan, v0, v1, [(front[0] + front[1]) / 2, paintV]);
  }
  function geometry() {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
    g.setAttribute("aUv", new Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    return g;
  }
  return { box, bay, geometry };
}

/** The relief for one facade tile, in the house's front frame (see `placeRelief`). */
export function reliefGeometry(tile: number) {
  const f = FACADES[tile];
  const { box, bay, geometry } = reliefBuilder();
  // The bay: three faces, the front one where the photo shows the bay's front.
  bay(f.bay.wall, f.bay.front, f.bay.v[0], f.bay.v[1], BAY, 0, f.bay.v[1] - 0.015);
  for (const [v0, v1] of f.bay.bands) bay(f.bay.wall, f.bay.front, v0, v1, BAY, BAND);
  // The cornice: frieze, brackets, crown.
  box(0, 1, f.cornice, 1 - CROWN, FRIEZE);
  for (const c of f.brackets) box(unit(c - 0.015), unit(c + 0.015), f.cornice - 0.015, 1 - CROWN, 0.06, CROWN_D - 0.04);
  box(0, 1, 1 - CROWN, 1, CROWN_D);
  for (const [u0, u1, v0, v1] of f.ledges) box(u0, u1, v0, v1, LEDGE);
  for (const [u0, u1, v0, v1] of f.posts) box(u0, u1, v0, v1, POST);
  box(f.entry[0], f.entry[1], f.entry[2], f.entry[3], ENTRY);
  // The stoop: a flight of three where the photo shows stairs, else one step.
  const [s0, s1, , top] = f.steps;
  const n = top > 0.05 ? 3 : 1;
  for (let i = 0; i < n; i++) box(s0, s1, 0, (top * (n - i)) / n, STEP * (i + 1));
  return geometry();
}

/** Size of the window id map that covers the whole atlas (3 x 2 tiles). */
export const WINDOW_MAP = { width: 384, height: 384 };

/**
 * One id per window of the atlas (0 = wall), laid out like the atlas as a
 * texture (row 0 at the bottom, so tile row 0 is the top half). The night
 * shader lights each window as a whole by its id.
 */
export function windowIds() {
  const { width, height } = WINDOW_MAP;
  const data = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const x = ((px + 0.5) / width) * 3;
      const y = (py + 0.5) / height;
      const col = Math.floor(x);
      const row = y >= 0.5 ? 0 : 1;
      const u = x - col;
      const v = row === 0 ? (y - 0.5) * 2 : y * 2;
      const tile = row * 3 + col;
      const k = FACADES[tile].windows.findIndex(([u0, u1, v0, v1]) => u >= u0 && u <= u1 && v >= v0 && v <= v1);
      if (k >= 0) data[py * width + px] = tile * 20 + k + 1;
    }
  }
  return data;
}

function windowTexture() {
  const t = new DataTexture(windowIds(), WINDOW_MAP.width, WINDOW_MAP.height, RedFormat);
  t.magFilter = t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** Atlas tiles: 2-storey fronts are 0, 2, 4; 3-storey are 1, 3, 5. Siding tint per tile. */
const TWO_STOREY = [0, 2, 4];
const THREE_STOREY = [1, 3, 5];
const SIDING = ["#d3e2ee", "#d4e6d6", "#f3e3b2", "#eccfd2", "#d3dccd", "#f1efe9"];
export const tileOf = (h: House, i: number) => (h.floors === 3 ? THREE_STOREY : TWO_STOREY)[(((i * 7 + Math.round(h.x * 3)) % 3) + 3) % 3];

/** The body is a little narrower than the plot (a seam between houses); the photo and the relief share its width. */
const bodyWidth = (h: House) => h.w - HOUSE_GAP;

/** How far Cuso's body reaches sideways from his walking line (arms out), plus a little air. */
const REACH = Math.max(...HULL.map(([, , x0, x1]) => Math.max(-x0, x1))) + 0.04;

/**
 * How far this house's relief stands out: RELIEF_DEPTH on a typical house,
 * less on narrower ones (so a bay keeps its angle and its sides show the photo
 * at the same scale). Cuso walks the sidewalks of the WALK_Z streets close to
 * the house fronts on one side; there the relief is flattened so his arms
 * clear it.
 */
export function reliefDepth(h: House) {
  const front = h.z + (h.facing * h.d) / 2;
  const gaps = WALK_Z.map((s) => (front - (s + WALK_OFFSET)) * -h.facing).filter((g) => g > 0 && g < 2);
  return Math.max(0, Math.min(RELIEF_DEPTH * Math.min(1, bodyWidth(h) / WIDTH), ...gaps.map((g) => g - REACH)));
}

/** The relief's frame: origin on the front wall at the ground, x along the facade (photo left to right), z out to the street (scaled to `reliefDepth`). */
export function placeRelief(h: House, o: Object3D) {
  o.position.set(h.x, h.y, h.z + (h.facing * h.d) / 2);
  o.rotation.set(0, h.facing > 0 ? 0 : Math.PI, 0);
  o.scale.set(bodyWidth(h), h.h, reliefDepth(h) / RELIEF_DEPTH);
}

const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** A roof prism; the gable faces the street. */
const gable = new ExtrudeGeometry(new Shape([new Vector2(-0.5, 0), new Vector2(0.5, 0), new Vector2(0, 1)]), {
  depth: 1,
  bevelEnabled: false,
}).translate(0, 0, -0.5);

type Front = { h: House; tile: number };

const houseAttributes = {
  aTile: (h: House, i: number) => tileOf(h, i),
  aFacing: (h: House) => h.facing,
};
const frontAttributes = {
  aTile: (f: Front) => f.tile,
  aFacing: (f: Front) => f.h.facing,
};
const houseBody = (h: House, o: Object3D, i: number) => {
  o.position.set(h.x, h.y - FOOTING, h.z);
  o.scale.set(bodyWidth(h), h.h + FOOTING, h.d);
  return SIDING[tileOf(h, i)];
};
const houseFront = (f: Front, o: Object3D) => placeRelief(f.h, o);
const houseRoof = (h: House, o: Object3D) => {
  o.position.set(h.x, h.y + h.h, h.z);
  o.scale.set(h.w, h.w * 0.42, h.d);
  return "#8a8580";
};

/** Victorian row houses: a real facade with its relief on the street side, lap siding elsewhere, shingled gables. */
export function Houses({ houses, tex }: { houses: House[]; tex: { atlas: Texture; siding: Texture; shingles: Texture } }) {
  const windows = useMemo(() => windowTexture(), []);
  const walls = useMemo(() => houseMaterial(tex.atlas, tex.siding, windows), [tex, windows]);
  const relief = useMemo(() => houseMaterial(tex.atlas, tex.siding, windows, true), [tex, windows]);
  const shingles = useMemo(() => roofMaterial(tex.shingles), [tex]);
  const gables = useMemo(() => houses.filter((h) => h.roof === "gable"), [houses]);
  const tiles = useMemo(() => {
    const fronts = houses.map((h, i) => ({ h, tile: tileOf(h, i) }));
    return FACADES.map((_, t) => ({ geometry: reliefGeometry(t), fronts: fronts.filter((f) => f.tile === t) }));
  }, [houses]);
  return (
    <>
      <Instances items={houses} geometry={box} material={walls} place={houseBody} attributes={houseAttributes} />
      {tiles.map(({ geometry, fronts }, t) => (
        <Instances key={t} items={fronts} geometry={geometry} material={relief} place={houseFront} attributes={frontAttributes} />
      ))}
      <Instances items={gables} geometry={gable} material={shingles} place={houseRoof} />
    </>
  );
}
