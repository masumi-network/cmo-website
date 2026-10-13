"use client";

// Alcatraz and Treasure Island, modelled for the distance they are seen at
// (the 06:00 hero, the explore aerial, chapter backdrops; close only in
// explore mode). Buildings use the row houses' kit and material
// (house-models.ts, houseMaterial): one draw call per island for all of them.
// The islands' footprints at the water line are fixed: the boat routes and
// the shore foam in bay.tsx read them (tests/unit/islands.test.ts).

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  ConeGeometry,
  DataTexture,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  Shape,
  type Mesh,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PALETTES, SLOT, builder, palette, type Builder, type Frame, type L3, type P2, type Rect } from "./house-models";
import { useLandmarkTextures } from "./landmark-kit";
import { houseMaterial } from "./materials";
import { rig, useNightGlow } from "./shared";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** A model in the house material: one paint scheme, glass that never lights up (aWin 0, no blinds or curtains). */
function finish(g: BufferGeometry, scheme: number) {
  const n = g.attributes.position.count;
  g.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(n).fill(scheme), 1));
  g.setAttribute("aWin", new Float32BufferAttribute(new Float32Array(n), 1));
  const pane = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) pane.set([0.5, 0.3], i * 2);
  g.setAttribute("aPane", new Float32BufferAttribute(pane, 2));
  return g;
}

/** A builder's model, moved into place (normals follow). */
const placedModel = (k: Builder, m: Matrix4) => k.geometry().applyMatrix4(m);
const at = (x: number, y: number, z: number, turn = 0) => new Matrix4().makeRotationY(turn).setPosition(x, y, z);

/** Four walls of a rectangle (x0..x1, z0..z1), counter-clockwise from the south (+z): each frame faces out. */
function sides(x0: number, x1: number, z0: number, z1: number) {
  return [
    { f: { o: [x0, 0, z1], u: [1, 0, 0] } as Frame, len: x1 - x0, name: "south" },
    { f: { o: [x1, 0, z1], u: [0, 0, -1] } as Frame, len: z1 - z0, name: "east" },
    { f: { o: [x1, 0, z0], u: [-1, 0, 0] } as Frame, len: x1 - x0, name: "north" },
    { f: { o: [x0, 0, z0], u: [0, 0, 1] } as Frame, len: z1 - z0, name: "west" },
  ];
}
const LOCAL: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
/** A regular polygon round (x, z). */
const ngon = (x: number, z: number, r: number, n: number, turn = 0): P2[] => Array.from({ length: n }, (_, i) => [x + r * Math.cos(turn + (i * 2 * Math.PI) / n), z + r * Math.sin(turn + (i * 2 * Math.PI) / n)]);
const ring = (plan: P2[], y: number): L3[] => plan.map(([x, z]) => [x, y, z]);

/** A thin square rod between two points (struts, braces, legs). */
function rod(k: Builder, a: L3, b: L3, r: number, slot: number) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  const t = d.map((x) => x / len);
  const ref = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const p = [t[1] * ref[2] - t[2] * ref[1], t[2] * ref[0] - t[0] * ref[2], t[0] * ref[1] - t[1] * ref[0]];
  const pl = Math.hypot(p[0], p[1], p[2]);
  const n1 = p.map((x) => x / pl);
  const n2 = [t[1] * n1[2] - t[2] * n1[1], t[2] * n1[0] - t[0] * n1[2], t[0] * n1[1] - t[1] * n1[0]];
  const square = (o: L3): L3[] =>
    [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s1, s2]) => [o[0] + r * (s1 * n1[0] + s2 * n2[0]), o[1] + r * (s1 * n1[1] + s2 * n2[1]), o[2] + r * (s1 * n1[2] + s2 * n2[2])] as L3);
  // four sides, no ends (too thin to see)
  const [r0, r1] = [square(a), square(b)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid: L3 = [(r0[i][0] + r0[j][0]) / 2 - a[0], (r0[i][1] + r0[j][1]) / 2 - a[1], (r0[i][2] + r0[j][2]) / 2 - a[2]];
    k.face(LOCAL, [r0[i], r0[j], r1[j], r1[i]], mid, slot);
  }
}

/** A steel window in a recess: glass at the back, a grid of glazing bars over it (the cellhouse's barred sashes). */
function barred(k: Builder, f: Frame, r: Rect, depth: number, cols: number, rows: number, reveal = SLOT.stone) {
  const [a0, a1, b0, b1] = r;
  k.reveal(f, r, 0, -depth, reveal);
  k.quad(f, a0, a1, b0, b1, -depth, SLOT.glass);
  const t = 0.012;
  const c = -depth + 0.004;
  for (let i = 1; i < cols; i++) {
    const a = a0 + ((a1 - a0) * i) / cols;
    k.quad(f, a - t / 2, a + t / 2, b0, b1, c, SLOT.sash);
  }
  for (let j = 1; j < rows; j++) {
    const b = b0 + ((b1 - b0) * j) / rows;
    k.quad(f, a0, a1, b - t / 2, b + t / 2, c, SLOT.sash);
  }
}

/** A band run round a rectangle, `out` proud of its walls (belt courses, copings). */
function band(k: Builder, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, out: number, slot: number, inner = 0) {
  for (const { f, len } of sides(x0, x1, z0, z1)) k.box(f, -out, len + out, y0, y1, -inner, out, slot);
}

// ---------------------------------------------------------------------------
// Alcatraz: a rocky island with layered cliffs, benches of ice plant and a
// switchback road from the dock, the cellhouse on top, the lighthouse, the
// water tower, the warden's house ruin, the recreation yard and Building 64.

/** An ellipse with a rocky outline, long axis north-west to south-east. */
export const ALCATRAZ = { x: -6, z: -66, a: 7, b: 3.4, angle: -0.6 };
export const alcatrazOutline = (theta: number) => 1 + 0.07 * Math.sin(3 * theta + 1) + 0.05 * Math.sin(5 * theta + 2.3) + 0.03 * Math.sin(11 * theta + 0.7);
/** Island-local coordinates (u along the long axis, to the east-south-east; v to the south-south-west) to a normalised radius: 1 at the water line. */
export function alcatrazRho(u: number, v: number) {
  const { a, b } = ALCATRAZ;
  return Math.hypot(u / a, v / b) / alcatrazOutline(Math.atan2(v / b, u / a));
}
/** Island-local point at angle theta and normalised radius rho. */
export function alcatrazAt(theta: number, rho: number): P2 {
  const o = alcatrazOutline(theta) * rho;
  return [ALCATRAZ.a * o * Math.cos(theta), ALCATRAZ.b * o * Math.sin(theta)];
}
/** Signed distance (world units) from a world point to the island's water line. */
export function alcatrazDistance(x: number, z: number) {
  const [u, v] = toIsland(x, z);
  const e = 0.02;
  const r = alcatrazRho(u, v);
  const g = Math.hypot(alcatrazRho(u + e, v) - r, alcatrazRho(u, v + e) - r) / e;
  return (r - 0.99) / Math.max(g, 1e-4);
}
export function toIsland(x: number, z: number): P2 {
  const { angle } = ALCATRAZ;
  const dx = x - ALCATRAZ.x;
  const dz = z - ALCATRAZ.z;
  return [dx * Math.cos(angle) - dz * Math.sin(angle), dx * Math.sin(angle) + dz * Math.cos(angle)];
}
export function toWorld(u: number, v: number): P2 {
  const { angle } = ALCATRAZ;
  return [ALCATRAZ.x + u * Math.cos(angle) + v * Math.sin(angle), ALCATRAZ.z - u * Math.sin(angle) + v * Math.cos(angle)];
}

/** The top of the island (local y above the water): flat round the cellhouse, lower to the north-west, falling at the rim. */
export function alcatrazGround(u: number, v: number) {
  return 2.3 - 0.45 * smoothstep(-2.6, -5, u) - 0.12 * smoothstep(0.45, 0.74, alcatrazRho(u, v));
}

/** Where the switchback road climbs the cliff (angles round the island, from the dock westwards along the city side). */
export const ROAD = { from: 0.5, to: 1.4 };
/** The dock: a wide quay at the foot of the cliff, at the south-east end. */
const DOCK = { from: -0.15, to: 0.42, y: 0.22 };
/** The cliff's layers: the lip, two benches and the quay (or talus) at its foot. */
const LIP = 0.745;
const BENCH = [1.4, 0.8];

export type Band = "top" | "edge" | "rock" | "rock2" | "rock3" | "ledge" | "road" | "quay" | "talus" | "seawall" | "sea";
export type Row = { rho: number; y: number; band: Band };

/** How far along the road sector an angle is, by distance on the benches (so the grade is even), 0..1. */
const ROAD_ARC = (() => {
  const n = 64;
  const out = [0];
  for (let i = 1; i <= n; i++) {
    const [p, q] = [alcatrazAt(ROAD.from + ((ROAD.to - ROAD.from) * (i - 1)) / n, 0.86), alcatrazAt(ROAD.from + ((ROAD.to - ROAD.from) * i) / n, 0.86)];
    out.push(out[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1]));
  }
  return out.map((d) => d / out[n]);
})();
function roadShare(t: number) {
  const f = Math.min(1, Math.max(0, (t - ROAD.from) / (ROAD.to - ROAD.from))) * (ROAD_ARC.length - 1);
  const i = Math.min(ROAD_ARC.length - 2, Math.floor(f));
  return mix(ROAD_ARC[i], ROAD_ARC[i + 1], f - i);
}

/** Smooth, periodic 0..1 noise round the island. */
const wave = (t: number, s: number) => 0.5 + 0.25 * Math.sin(3 * t + s) + 0.15 * Math.sin(7 * t + s * 2.1) + 0.1 * Math.sin(13 * t + s * 3.7);

/**
 * One column of the island mesh, from the middle out to under the water.
 * `band` is what the strip from this row to the next one is (its colour).
 * The cliff is in layers: a face, a bench, a face, a bench, a face, then talus
 * (or the quay at the dock) down to the water line. In the road sector the
 * two benches slope the opposite ways and carry the road: the lower leg from
 * the quay, the upper one from the hairpin to the top.
 */
export function alcatrazColumn(theta: number): Row[] {
  const t = Math.atan2(Math.sin(theta), Math.cos(theta));
  const k = Math.round((theta / (Math.PI * 2)) * 960);
  const ground = (rho: number) => alcatrazGround(...alcatrazAt(t, rho));
  const wR = smoothstep(ROAD.from - 0.15, ROAD.from, t) * smoothstep(ROAD.to + 0.15, ROAD.to, t);
  const s = roadShare(t);
  const wD = smoothstep(DOCK.from - 0.2, DOCK.from, t) * smoothstep(DOCK.to + 0.12, DOCK.to, t);
  const road = wR > 0.5;

  const T = ground(LIP);
  const B1 = Math.min(T, mix(BENCH[0], mix(T, 0.95, s), wR));
  const drop1 = road ? 0 : 0.03;
  const B2 = Math.min(B1 - drop1, mix(BENCH[1], mix(DOCK.y, 0.95, s), wR));
  const drop2 = road ? 0 : 0.03;
  const B3 = Math.min(DOCK.y, B2 - drop2);
  const width = (seed: number) => mix(mix(0.025 + 0.035 * wave(t, seed), 0.065, wR), 0.02, wD);
  const face = (seed: number) => 0.011 + 0.008 * hash(k, seed);
  const jit = (seed: number) => 0.007 * (hash(seed, k) - 0.5);

  const rows: Row[] = [{ rho: 0, y: ground(0), band: "top" }];
  for (const rho of [0.13, 0.27, 0.4, 0.52, 0.62]) rows.push({ rho, y: ground(rho), band: "top" });
  rows.push({ rho: 0.7, y: ground(0.7), band: "edge" });
  rows.push({ rho: LIP, y: T, band: "rock" });
  const r1 = LIP + face(1) + 0.01 * wave(t, 4);
  rows.push({ rho: (LIP + r1) / 2 + jit(1), y: (T + B1) / 2, band: "rock2" });
  rows.push({ rho: r1, y: B1, band: road ? "road" : "ledge" });
  const b1 = r1 + width(2);
  rows.push({ rho: b1, y: B1 - drop1, band: "rock" });
  const r2 = b1 + face(2);
  rows.push({ rho: (b1 + r2) / 2 + jit(2), y: (B1 - drop1 + B2) / 2, band: "rock3" });
  rows.push({ rho: r2, y: B2, band: road ? "road" : "ledge" });
  const b2 = r2 + width(3);
  rows.push({ rho: b2, y: B2 - drop2, band: "rock2" });
  const r3 = b2 + face(3);
  rows.push({ rho: (b2 + r3) / 2 + jit(3), y: (B2 - drop2 + B3) / 2, band: "rock3" });
  const quay = wD > 0.5;
  rows.push({ rho: r3, y: B3, band: quay ? "quay" : "talus" });
  rows.push({ rho: 0.99, y: mix(0.03, B3, wD), band: quay ? "seawall" : "talus" });
  rows.push({ rho: 1, y: -0.05, band: "sea" });
  rows.push({ rho: 1.12, y: -1.2, band: "sea" });
  return rows;
}

const COLORS: Record<Band, string> = {
  top: "#7c8558",
  edge: "#6e7a4d",
  rock: "#8b7f6f",
  rock2: "#7a6f62",
  rock3: "#6c6257",
  ledge: "#6d7a4b",
  road: "#a8a397",
  quay: "#aaa499",
  talus: "#5f574d",
  seawall: "#8f8a80",
  sea: "#4b453e",
};

const ISLAND_SEGMENTS = 96;

/** The rock: flat-shaded strips between columns, one colour each (non-indexed). */
function alcatrazGeometry() {
  const cols = Array.from({ length: ISLAND_SEGMENTS }, (_, k) => {
    const theta = (k / ISLAND_SEGMENTS) * Math.PI * 2;
    return { theta, rows: alcatrazColumn(theta) };
  });
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const c = new Color();
  const gravel = new Color("#aea696");
  const grey = new Color("#918b7f");
  const p = (theta: number, r: Row): L3 => {
    const [u, v] = alcatrazAt(theta, r.rho);
    return [u, r.y, v];
  };
  const tri = (a: L3, b: L3, d: L3, expect: L3) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) return;
    n = n.map((x) => x / len);
    const flip = n[0] * expect[0] + n[1] * expect[1] + n[2] * expect[2] < 0;
    const pts = flip ? [a, d, b] : [a, b, d];
    if (flip) n = n.map((x) => -x);
    for (const q of pts) {
      pos.push(...q);
      nrm.push(...n);
      col.push(c.r, c.g, c.b);
    }
  };
  for (let k = 0; k < ISLAND_SEGMENTS; k++) {
    const A = cols[k];
    const B = cols[(k + 1) % ISLAND_SEGMENTS];
    const tb = k + 1 === ISLAND_SEGMENTS ? Math.PI * 2 : B.theta;
    const mid = (A.theta + tb) / 2;
    const radial = [Math.cos(mid) / ALCATRAZ.a, Math.sin(mid) / ALCATRAZ.b];
    const rl = Math.hypot(radial[0], radial[1]);
    for (let i = 0; i < A.rows.length - 1; i++) {
      const band = A.rows[i].band;
      // patches: gravel paths and bare ground on top, grey rock among the ice plant on the benches
      c.set(COLORS[band]);
      if (band === "top" && hash(k, i * 7) > 0.85) c.lerp(gravel, 0.3);
      if (band === "ledge" && wave(A.theta, 9) > 0.6) c.lerp(grey, 0.8);
      c.multiplyScalar(band === "top" ? 0.95 + 0.08 * hash(k * 3, i) : 0.9 + 0.18 * hash(k * 3, i));
      const [a0, a1, b0, b1] = [p(A.theta, A.rows[i]), p(A.theta, A.rows[i + 1]), p(tb, B.rows[i]), p(tb, B.rows[i + 1])];
      // out and up from this strip of the profile
      const dr = (A.rows[i + 1].rho - A.rows[i].rho) * 5;
      const dy = A.rows[i + 1].y - A.rows[i].y;
      const expect: L3 = [(-dy * radial[0]) / rl, dr, (-dy * radial[1]) / rl];
      tri(a0, b0, a1, expect);
      tri(b0, b1, a1, expect);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

// The buildings, in island-local coordinates (y up from the water).
const CELLHOUSE = { u0: -2.5, u1: 2.5, v0: -0.9, v1: 0.6, storey: 0.48 };
const LIGHTHOUSE = { u: -3.0, v: 0.95, h: 2.3 };
const LH_GROUND = alcatrazGround(LIGHTHOUSE.u, LIGHTHOUSE.v);
/** The lantern room's centre, where the beam turns. */
export const LANTERN = { u: LIGHTHOUSE.u, v: LIGHTHOUSE.v, y: LH_GROUND + LIGHTHOUSE.h + 0.16 };
const TOWER = { u: 4.25, v: -0.65 };
const YARD = { u0: 2.62, u1: 3.62, v0: -0.9, v1: 0.6 };
const RUIN = { u0: -4.0, u1: -3.05, v0: -0.95, v1: 0.0 };
/** Building 64 on the quay: its centre's angle and radius round the island. */
const B64 = { theta: 0.2, rho: 0.9, len: 1.5, depth: 0.42, storey: 0.21 };
const PIER = { theta: 0.04, len: 0.85, width: 0.28, deck: 0.16 };

/** The frame of the shore at angle theta: a point at rho, along the shore (to lower angles) and out to the water. */
function shoreFrame(theta: number, rho: number) {
  const [u, v] = alcatrazAt(theta, rho);
  const [u1, v1] = alcatrazAt(theta - 0.01, rho);
  const [u2, v2] = alcatrazAt(theta + 0.01, rho);
  const turn = Math.atan2(-(v1 - v2), u1 - u2); // rotation that takes local +x along the shore
  return { u, v, turn };
}

function cellhouse(k: Builder) {
  const { u0, u1, v0, v1, storey } = CELLHOUSE;
  const y = alcatrazGround(0, (v0 + v1) / 2);
  const top = y + 3 * storey;
  for (const { f, len } of sides(u0, u1, v0, v1)) {
    const long = len > 2;
    const n = long ? 13 : 3;
    const bay = len / n;
    const holes: Rect[] = [];
    const tall: Rect[] = [];
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * bay;
      holes.push([c - 0.07, c + 0.07, y + 0.12, y + 0.36]);
      tall.push([c - 0.075, c + 0.075, y + storey + 0.1, y + 3 * storey - 0.12]);
    }
    k.wall(f, 0, len, y - 0.45, top, [...holes, ...tall], SLOT.stone);
    for (const r of holes) barred(k, f, r, 0.05, 2, 2);
    for (const r of tall) barred(k, f, r, 0.06, 3, 6);
    // pilasters between the bays, a belt course over the ground storey
    for (let i = 0; i <= n; i++) k.box(f, i * bay - 0.03, i * bay + 0.03, y - 0.45, top, 0, 0.025, SLOT.stone);
  }
  band(k, u0, u1, v0, v1, y + storey - 0.02, y + storey + 0.03, 0.035, SLOT.stone);
  // the parapet with a light coping, the roof inside it
  band(k, u0, u1, v0, v1, top, top + 0.12, 0.03, SLOT.panel, 0.06);
  k.face(LOCAL, [[u0, top, v0], [u1, top, v0], [u1, top, v1], [u0, top, v1]], [0, 1, 0], SLOT.gravel);
  // monitors along the ridge: a band of skylights under a flat cap
  const vm = (v0 + v1) / 2;
  for (const [m0, m1] of [[-2.1, -0.75], [-0.6, 0.75], [0.9, 2.25]]) {
    for (const { f, len } of sides(m0, m1, vm - 0.22, vm + 0.22)) {
      k.wall(f, 0, len, top, top + 0.05, [], SLOT.stone);
      k.quad(f, 0, len, top + 0.05, top + 0.15, -0.01, SLOT.glass);
      const panes = Math.max(1, Math.round(len / 0.15));
      for (let i = 0; i <= panes; i++) k.quad(f, (len * i) / panes - 0.008, (len * i) / panes + 0.008, top + 0.05, top + 0.15, -0.004, SLOT.sash);
    }
    k.box(LOCAL, m0 - 0.04, m1 + 0.04, top + 0.15, top + 0.18, vm - 0.26, vm + 0.26, SLOT.stone);
  }
}

function lighthouse(k: Builder) {
  const { u, v, h } = LIGHTHOUSE;
  const y = LH_GROUND;
  const turn = Math.PI / 8;
  // the octagonal tower, tapering, on a plinth
  k.solid(LOCAL, ring(ngon(u, v, 0.27, 8, turn), y - 0.3), ring(ngon(u, v, 0.27, 8, turn), y + 0.08), SLOT.stone);
  k.solid(LOCAL, ring(ngon(u, v, 0.2, 8, turn), y + 0.08), ring(ngon(u, v, 0.14, 8, turn), y + h), SLOT.stucco);
  // gallery deck and railing, the lantern's dark mullions, its roof and vent
  k.solid(LOCAL, ring(ngon(u, v, 0.24, 8, turn), y + h), ring(ngon(u, v, 0.24, 8, turn), y + h + 0.035), SLOT.panel);
  k.solid(LOCAL, ring(ngon(u, v, 0.235, 8, turn), y + h + 0.035), ring(ngon(u, v, 0.235, 8, turn), y + h + 0.05), SLOT.trim);
  for (const [x, z] of ngon(u, v, 0.235, 8, turn)) rod(k, [x, y + h + 0.035, z], [x, y + h + 0.1, z], 0.006, SLOT.trim);
  for (const [x, z] of ngon(u, v, 0.122, 8, turn)) rod(k, [x, y + h + 0.05, z], [x, y + h + 0.28, z], 0.008, SLOT.sash);
  k.solid(LOCAL, ring(ngon(u, v, 0.15, 8, turn), y + h + 0.27), ring(ngon(u, v, 0.15, 8, turn), y + h + 0.3), SLOT.sash);
  k.solid(LOCAL, ring(ngon(u, v, 0.14, 8, turn), y + h + 0.3), ring(ngon(u, v, 0.02, 8, turn), y + h + 0.42), SLOT.sash);
  k.solid(LOCAL, ring(ngon(u, v, 0.03, 6), y + h + 0.42), ring(ngon(u, v, 0.03, 6), y + h + 0.47), SLOT.sash);
  // the keeper's door and a few slit windows up the city side
  const apothem = (b: number) => (0.2 - (0.06 * (b - 0.08)) / (h - 0.08)) * Math.cos(Math.PI / 8);
  k.quad({ o: [u, y, v + apothem(0.08)], u: [1, 0, 0] }, -0.04, 0.04, 0.08, 0.26, 0.004, SLOT.door);
  for (const b of [0.7, 1.2, 1.7]) k.quad({ o: [u, y, v + apothem(b + 0.05)], u: [1, 0, 0] }, -0.018, 0.018, b, b + 0.1, 0.004, SLOT.sash);
}

/** The steel tank on a braced frame, at the north-east end. */
function waterTower(k: Builder) {
  const { u, v } = TOWER;
  const y = alcatrazGround(u, v);
  const legTop = y + 1.4;
  const feet = ngon(u, v, 0.48, 4, Math.PI / 4);
  const heads = ngon(u, v, 0.36, 4, Math.PI / 4);
  const lerp2 = (a: P2, b: P2, t: number): L3 => [mix(a[0], b[0], t), 0, mix(a[1], b[1], t)];
  for (let i = 0; i < 4; i++) {
    rod(k, [feet[i][0], y - 0.2, feet[i][1]], [heads[i][0], legTop, heads[i][1]], 0.025, SLOT.stone);
    const j = (i + 1) % 4;
    // two levels of struts with X braces between them
    const levels = [0, 0.5, 1];
    for (let l = 0; l < levels.length; l++) {
      const tl = levels[l];
      const p = lerp2(feet[i], heads[i], tl);
      const q = lerp2(feet[j], heads[j], tl);
      const yy = mix(y, legTop, tl);
      if (l > 0) rod(k, [p[0], yy, p[2]], [q[0], yy, q[2]], 0.012, SLOT.stone);
      if (l < levels.length - 1) {
        const tn = levels[l + 1];
        const pn = lerp2(feet[i], heads[i], tn);
        const qn = lerp2(feet[j], heads[j], tn);
        const yn = mix(y, legTop, tn);
        rod(k, [p[0], yy, p[2]], [qn[0], yn, qn[2]], 0.008, SLOT.stone);
        rod(k, [q[0], yy, q[2]], [pn[0], yn, pn[2]], 0.008, SLOT.stone);
      }
    }
  }
  // the tank: a catwalk round its foot, the drum, a shallow cone and a finial
  k.solid(LOCAL, ring(ngon(u, v, 0.47, 16), legTop), ring(ngon(u, v, 0.47, 16), legTop + 0.03), SLOT.trim);
  k.solid(LOCAL, ring(ngon(u, v, 0.4, 16), legTop + 0.03), ring(ngon(u, v, 0.4, 16), legTop + 0.62), SLOT.panel);
  k.solid(LOCAL, ring(ngon(u, v, 0.42, 16), legTop + 0.62), ring(ngon(u, v, 0.03, 16), legTop + 0.8), SLOT.stone);
  k.solid(LOCAL, ring(ngon(u, v, 0.03, 6), legTop + 0.8), ring(ngon(u, v, 0.03, 6), legTop + 0.88), SLOT.trim);
}

/** The warden's house: roofless walls with empty windows and a chimney, burnt out in 1970. */
function ruin(k: Builder) {
  const { u0, u1, v0, v1 } = RUIN;
  const y = alcatrazGround(u1, (v0 + v1) / 2) - 0.08;
  const t = 0.05;
  for (const { f, len, name } of sides(u0, u1, v0, v1)) {
    const n = Math.max(2, Math.round(len / 0.24));
    const step = len / n;
    // piers between the openings, broken off at different heights
    for (let i = 0; i <= n; i++) {
      const a = i * step;
      const h = 0.42 + 0.22 * hash(i + name.length, 3) - (name === "north" ? 0.12 : 0);
      k.box(f, Math.max(0, a - 0.05), Math.min(len, a + 0.05), y - 0.4, y + h, -t, 0, SLOT.stone);
    }
    for (let i = 0; i < n; i++) {
      const a0 = i * step + 0.05;
      const a1 = (i + 1) * step - 0.05;
      k.box(f, a0, a1, y - 0.4, y + 0.1, -t, 0, SLOT.stone); // under the sills
      if (hash(i, name.length) > 0.35) k.box(f, a0, a1, y + 0.3, y + 0.36 + 0.06 * hash(name.length, i), -t, 0, SLOT.stone); // a lintel left standing
    }
  }
  k.box(LOCAL, u0 + 0.3, u0 + 0.45, y, y + 0.78, v0 + 0.02, v0 + 0.16, SLOT.brick);
  k.box(LOCAL, (u0 + u1) / 2 - 0.025, (u0 + u1) / 2 + 0.025, y - 0.4, y + 0.3, v0 + t, v1 - t, SLOT.stone);
}

/** The recreation yard: high concrete walls at the cellhouse's east end, a guard tower on the far corner. */
function yard(k: Builder) {
  const { u0, u1, v0, v1 } = YARD;
  const y = Math.max(...[u0, u1].flatMap((u) => [v0, v1].map((v) => alcatrazGround(u, v))));
  for (const { f, len, name } of sides(u0, u1, v0, v1)) {
    if (name === "west") continue; // the cellhouse's end wall
    k.box(f, 0, len, y - 0.4, y + 0.38, -0.05, 0, SLOT.stone);
    k.box(f, -0.01, len + 0.01, y + 0.38, y + 0.41, -0.06, 0.01, SLOT.panel);
  }
  k.face(LOCAL, [[u0, y + 0.02, v0 + 0.05], [u1 - 0.05, y + 0.02, v0 + 0.05], [u1 - 0.05, y + 0.02, v1 - 0.05], [u0, y + 0.02, v1 - 0.05]], [0, 1, 0], SLOT.panel);
  // stepped seats along the north wall
  for (let i = 0; i < 3; i++) k.box(LOCAL, u0 + 0.05, u1 - 0.1, y, y + 0.06 * (3 - i), v0 + 0.05 + i * 0.08, v0 + 0.13 + i * 0.08, SLOT.stone);
  // guard tower: a post, a glazed cab and its roof
  const [gu, gv] = [u1 + 0.05, v1 + 0.05];
  k.box(LOCAL, gu - 0.06, gu + 0.06, y - 0.2, y + 0.6, gv - 0.06, gv + 0.06, SLOT.stone);
  k.box(LOCAL, gu - 0.09, gu + 0.09, y + 0.6, y + 0.72, gv - 0.09, gv + 0.09, SLOT.glass);
  k.box(LOCAL, gu - 0.11, gu + 0.11, y + 0.72, y + 0.75, gv - 0.11, gv + 0.11, SLOT.tar);
}

/** Building 64 on the quay, built along +x with its front to +z. Returns its lit windows (local rects at the front). */
function building64(k: Builder): Rect[] {
  const { len, depth, storey } = B64;
  const y = DOCK.y;
  const top = y + 3 * storey;
  const [x0, x1, z0, z1] = [-len / 2, len / 2, -depth / 2, depth / 2];
  const lit: Rect[] = [];
  for (const { f, len: l, name } of sides(x0, x1, z0, z1)) {
    const front = name === "south";
    const n = front ? 9 : name === "north" ? 0 : 2;
    const holes: Rect[] = [];
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < n; i++) {
        const c = ((i + 0.5) * l) / n;
        holes.push([c - 0.045, c + 0.045, y + s * storey + 0.06, y + s * storey + 0.17]);
      }
    }
    k.wall(f, 0, l, y - 0.3, top, holes, SLOT.panel);
    for (const r of holes) barred(k, f, r, 0.03, 2, 1, SLOT.panel);
    if (front) lit.push(holes[n + 2], holes[2 * n + 6]);
    // belt courses
    k.box(f, -0.02, l + 0.02, y + storey - 0.015, y + storey + 0.01, 0, 0.015, SLOT.stone);
    k.box(f, -0.02, l + 0.02, y + 2 * storey - 0.015, y + 2 * storey + 0.01, 0, 0.015, SLOT.stone);
  }
  band(k, x0, x1, z0, z1, top, top + 0.06, 0.02, SLOT.stone, 0.04);
  k.face(LOCAL, [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], [0, 1, 0], SLOT.tar);
  return lit;
}

/** The pier, built along +z (out to the water) from the sea wall, on piles. */
function pier(k: Builder) {
  const { len, width, deck } = PIER;
  k.box(LOCAL, -width / 2, width / 2, deck - 0.04, deck, -0.25, len, SLOT.stone);
  for (let z = 0.15; z <= len; z += 0.24) for (const x of [-width / 2 + 0.03, width / 2 - 0.03]) rod(k, [x, -0.8, z], [x, deck - 0.04, z + 0.001], 0.02, SLOT.tar);
  // a bollard each side at the end, and a lamp post
  for (const x of [-width / 2 + 0.03, width / 2 - 0.03]) k.box(LOCAL, x - 0.02, x + 0.02, deck, deck + 0.04, len - 0.06, len - 0.02, SLOT.tar);
  k.box(LOCAL, width / 2 - 0.04, width / 2 - 0.02, deck, deck + 0.35, len - 0.15, len - 0.13, SLOT.trim);
}

const ALCATRAZ_SCHEME = PALETTES.findIndex((p) => p.name === "white and black");

function alcatrazBuildingsGeometry() {
  const k = builder();
  cellhouse(k);
  lighthouse(k);
  waterTower(k);
  ruin(k);
  yard(k);
  const parts = [k.geometry()];
  const b = builder();
  building64(b);
  const f = shoreFrame(B64.theta, B64.rho);
  parts.push(placedModel(b, at(f.u, 0, f.v, f.turn)));
  return finish(mergeGeometries(parts), ALCATRAZ_SCHEME);
}

function alcatrazPierGeometry() {
  const k = builder();
  pier(k);
  const f = shoreFrame(PIER.theta, 0.985);
  return finish(placedModel(k, at(f.u, 0, f.v, f.turn)), ALCATRAZ_SCHEME);
}

/** Lights: the lantern (full), a lamp on the pier, a few windows lit in Building 64 (dimmer), as uv into LIGHT_LEVELS. */
const LIGHT_LEVELS = [
  [255, 255, 255],
  [110, 100, 80],
  [70, 50, 30],
];
function lightLevels() {
  const data = new Uint8Array(LIGHT_LEVELS.length * 4);
  LIGHT_LEVELS.forEach((c, i) => data.set([...c, 255], i * 4));
  const t = new DataTexture(data, LIGHT_LEVELS.length, 1);
  t.magFilter = t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

function alcatrazLightsGeometry() {
  const parts: BufferGeometry[] = [];
  const level = (g: BufferGeometry, i: number) => {
    const out = g.index ? g.toNonIndexed() : g;
    const uv = new Float32Array(out.attributes.position.count * 2);
    for (let j = 0; j < uv.length; j += 2) uv.set([(i + 0.5) / LIGHT_LEVELS.length, 0.5], j);
    out.setAttribute("uv", new Float32BufferAttribute(uv, 2));
    return out;
  };
  // the lantern room's glass, between the gallery and the roof
  const lantern = builder();
  lantern.solid(LOCAL, ring(ngon(LANTERN.u, LANTERN.v, 0.115, 8, Math.PI / 8), LANTERN.y - 0.11), ring(ngon(LANTERN.u, LANTERN.v, 0.115, 8, Math.PI / 8), LANTERN.y + 0.11), 0);
  parts.push(level(lantern.geometry(), 0));
  // the pier lamp
  const lamp = builder();
  lamp.box(LOCAL, PIER.width / 2 - 0.055, PIER.width / 2 - 0.005, PIER.deck + 0.33, PIER.deck + 0.38, PIER.len - 0.165, PIER.len - 0.115, 0);
  const pf = shoreFrame(PIER.theta, 0.985);
  parts.push(level(placedModel(lamp, at(pf.u, 0, pf.v, pf.turn)), 1));
  // two windows in Building 64
  const win = builder();
  const lit = building64(builder());
  for (const r of lit) win.quad({ o: [-B64.len / 2, 0, B64.depth / 2], u: [1, 0, 0] }, r[0], r[1], r[2], r[3], -0.028, 0);
  const bf = shoreFrame(B64.theta, B64.rho);
  parts.push(level(placedModel(win, at(bf.u, 0, bf.v, bf.turn)), 2));
  const merged = mergeGeometries(parts.map((g) => {
    const out = new BufferGeometry();
    for (const key of ["position", "normal", "uv"]) out.setAttribute(key, g.attributes[key]);
    return out;
  }));
  return merged;
}

/** Two soft beams from the lantern, apex at the origin, fading outwards. */
function beamGeometry() {
  const beams = [0, Math.PI].map((r) => new ConeGeometry(0.9, 18, 20, 1, true).translate(0, -9, 0).rotateZ(Math.PI / 2).rotateY(r));
  const g = mergeGeometries(beams);
  const p = g.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, 1 - Math.hypot(p.getX(i), p.getZ(i)) / 18) ** 2.5;
    colors.set([k, k, k], i * 3);
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** Additive, fading along the beam and at its edges (where the cone is seen edge-on). */
function beamGlow() {
  const material = new MeshBasicMaterial({ color: "#fff1c9", vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  material.customProgramCacheKey = () => "bay-beam";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vFacing;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvFacing = abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFacing;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vFacing * vFacing;");
  };
  return material;
}

/** Alcatraz, in its own frame at the water line. `unreflected`: the water's set of things its mirror leaves out (the beam). Four draw calls. */
export function Alcatraz({ waterY, unreflected }: { waterY: number; unreflected: Set<Object3D> }) {
  const { siding } = useLandmarkTextures();
  const island = useMemo(() => alcatrazGeometry(), []);
  const buildings = useMemo(() => mergeGeometries([alcatrazBuildingsGeometry(), alcatrazPierGeometry()]), []);
  const lights = useMemo(() => alcatrazLightsGeometry(), []);
  const beams = useMemo(() => beamGeometry(), []);
  const rock = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }), []);
  const paint = useMemo(() => houseMaterial(siding, siding, palette()), [siding]);
  const glow = useMemo(() => new MeshStandardMaterial({ color: "#222", emissive: "#fff1c9", emissiveIntensity: 0.2, emissiveMap: lightLevels() }), []);
  useNightGlow(glow, 5, 0.2);
  const beamMaterial = useMemo(() => beamGlow(), []);
  const beam = useRef<Mesh>(null);
  useEffect(() => {
    const b = beam.current;
    if (!b) return;
    unreflected.add(b);
    return () => void unreflected.delete(b);
  }, [unreflected]);
  useFrame((_, dt) => {
    const b = beam.current;
    if (!b) return;
    b.rotation.y += dt * 0.5;
    b.visible = rig.night > 0.05;
    beamMaterial.opacity = rig.night * 0.3;
  });
  return (
    <group position={[ALCATRAZ.x, waterY, ALCATRAZ.z]} rotation-y={ALCATRAZ.angle}>
      <mesh geometry={island} material={rock} castShadow receiveShadow />
      <mesh geometry={buildings} material={paint} castShadow receiveShadow />
      <mesh geometry={lights} material={glow} />
      <mesh ref={beam} geometry={beams} material={beamMaterial} position={[LANTERN.u, LANTERN.y, LANTERN.v]} visible={false} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Treasure Island: flat made land north of Yerba Buena with a causeway, the
// 1939 exposition's three hangars and Building One, palms along the avenue.

/** [x, z, half x, half z, corner]. */
export const TREASURE_ISLAND: [number, number, number, number, number][] = [
  [143, -7, 10, 8.5, 2.5],
  [141.5, 3.5, 2.2, 4, 0.6],
];
export const TREASURE_Y = 0.35;
export const roundedBoxDistance = (x: number, z: number, [cx, cz, hx, hz, r]: number[]) => {
  const qx = Math.abs(x - cx) - hx + r;
  const qz = Math.abs(z - cz) - hz + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
};

function treasureIslandGeometry() {
  // shape space is (x, -z), counter-clockwise
  const shapes = TREASURE_ISLAND.map(([cx, cz, hx, hz, r]) => {
    const [x0, x1, y0, y1] = [cx - hx, cx + hx, -(cz + hz), -(cz - hz)];
    const s = new Shape();
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0);
    s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x1, y1 - r);
    s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y1);
    s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + r);
    s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    return s;
  });
  const g = new ExtrudeGeometry(shapes, { depth: TREASURE_Y + 1.2 - 0.1, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, -1.2, 0);
  return g;
}

const HANGAR = { w: 2.8, l: 4.4, wall: 0.5, rise: 0.55, xs: [137.4, 140.7, 144.0], z: -10.5 };

/** A hangar at the origin, long along z: walls with big doors at both ends, a ribbed barrel roof and a clerestory along its crown. */
function hangar(k: Builder) {
  const { w, l, wall: h, rise } = HANGAR;
  const [x0, x1, z0, z1] = [-w / 2, w / 2, -l / 2, l / 2];
  const N = 10;
  const R = w / 2 + 0.05;
  const arch = Array.from({ length: N + 1 }, (_, i) => {
    const a = (Math.PI * i) / N;
    const [nx, ny] = [-Math.cos(a) * rise, Math.sin(a) * R];
    const nl = Math.hypot(nx, ny);
    return [-R * Math.cos(a), h + rise * Math.sin(a), nx / nl, ny / nl] as const; // x, y, and the arch's outward normal
  });
  for (const { f, len, name } of sides(x0, x1, z0, z1)) {
    const end = name === "south" || name === "north";
    if (end) {
      const door: Rect = [len / 2 - 0.6, len / 2 + 0.6, 0, 0.44];
      k.wall(f, 0, len, -0.3, h, [door], SLOT.trim);
      k.reveal(f, door, 0, -0.04, SLOT.trim);
      k.quad(f, door[0], door[1], 0, 0.44, -0.04, SLOT.door);
      for (const b of [0.15, 0.3]) k.quad(f, door[0], door[1], b - 0.006, b + 0.006, -0.035, SLOT.sash);
      for (let i = 1; i < 6; i++) k.quad(f, door[0] + (i * 1.2) / 6 - 0.005, door[0] + (i * 1.2) / 6 + 0.005, 0, 0.44, -0.035, SLOT.sash);
      // the arched gable over the wall, flush with it, and Moderne pilasters each side of the door
      const gable: L3[] = arch.map(([x, y]) => [len / 2 + (name === "south" ? x : -x), y, 0]);
      k.face(f, gable.map(([a, b]) => [Math.min(len, Math.max(0, a)), b, 0.0001] as L3), [0, 0, 1], SLOT.trim);
      for (const a of [len / 2 - 0.75, len / 2 + 0.65]) k.box(f, a, a + 0.1, -0.3, h + 0.25, 0, 0.04, SLOT.trim);
    } else {
      k.wall(f, 0, len, -0.3, h, [], SLOT.stone);
      k.box(f, -0.02, len + 0.02, h - 0.04, h, 0, 0.03, SLOT.trim);
    }
  }
  // the barrel roof and its ribs
  for (let i = 0; i < N; i++) {
    const [xa, ya, nxa, nya] = arch[i];
    const [xb, yb] = arch[i + 1];
    k.face(LOCAL, [[xa, ya, z0 - 0.05], [xb, yb, z0 - 0.05], [xb, yb, z1 + 0.05], [xa, ya, z1 + 0.05]], [nxa + arch[i + 1][2], nya + arch[i + 1][3], 0], SLOT.stone);
  }
  for (let r = 0; r < 7; r++) {
    const z = z0 + 0.25 + (r * (l - 0.5)) / 6;
    for (let i = 0; i < N; i++) {
      const [xa, ya, nxa, nya] = arch[i];
      const [xb, yb, nxb, nyb] = arch[i + 1];
      const o = 0.025;
      const top: L3[] = [[xa + nxa * o, ya + nya * o, z - 0.025], [xb + nxb * o, yb + nyb * o, z - 0.025], [xb + nxb * o, yb + nyb * o, z + 0.025], [xa + nxa * o, ya + nya * o, z + 0.025]];
      k.face(LOCAL, top, [nxa + nxb, nya + nyb, 0], SLOT.panel);
      for (const s of [-1, 1]) k.face(LOCAL, [[xa, ya, z + s * 0.025], [xb, yb, z + s * 0.025], [xb + nxb * o, yb + nyb * o, z + s * 0.025], [xa + nxa * o, ya + nya * o, z + s * 0.025]], [0, 0, s], SLOT.panel);
    }
  }
  // the clerestory: a glazed monitor along the crown
  const top = h + rise;
  for (const { f, len } of sides(-0.32, 0.32, z0 + 0.4, z1 - 0.4)) {
    k.wall(f, 0, len, top - 0.12, top + 0.03, [], SLOT.trim);
    k.quad(f, 0, len, top + 0.03, top + 0.13, -0.005, SLOT.glass);
    const panes = Math.max(1, Math.round(len / 0.2));
    for (let i = 0; i <= panes; i++) k.quad(f, (len * i) / panes - 0.01, (len * i) / panes + 0.01, top + 0.03, top + 0.13, 0, SLOT.sash);
  }
  k.box(LOCAL, -0.37, 0.37, top + 0.13, top + 0.16, z0 + 0.35, z1 - 0.35, SLOT.stone);
}

const ONE = { x: 141.5, z: -3 };

/** Building One, the Art Moderne terminal, facing the causeway (+z): a central block with fins, two long wings with ribbon windows. */
function buildingOne(k: Builder) {
  // wings, set back from the centre, with rounded ends
  for (const s of [-1, 1]) {
    const [a0, a1] = s > 0 ? [0.6, 2.0] : [-2.0, -0.6];
    const [near, end] = s > 0 ? [a0, a1] : [a1, a0];
    // the plan: from the centre block out to a half-round end and back
    const round: P2[] = Array.from({ length: 7 }, (_, i) => {
      const a = Math.PI / 2 - (Math.PI * i) / 6;
      return [end + s * 0.33 * Math.cos(a), 0.33 * Math.sin(a)];
    });
    const plan: P2[] = [[near, 0.33], ...round, [near, -0.33]];
    k.prism(LOCAL, plan, -0.3, 0.6, SLOT.trim);
    const cx = (near + end) / 2;
    k.prism(LOCAL, plan.map(([x, z]) => [cx + (x - cx) * 0.95, z * 0.85] as P2), 0.6, 0.62, SLOT.gravel);
    // two ribbon windows along the front with a sill under each, and the same at the back
    for (const c of [1, -1]) {
      const f: Frame = c > 0 ? { o: [a0, 0, 0.33], u: [1, 0, 0] } : { o: [a1, 0, -0.33], u: [-1, 0, 0] };
      const len = a1 - a0;
      for (const [b0, b1] of [[0.12, 0.24], [0.36, 0.48]]) {
        k.quad(f, 0.05, len - 0.05, b0, b1, 0.004, SLOT.glass);
        for (let x = 0.05; x <= len - 0.05 + 1e-6; x += (len - 0.1) / 8) k.quad(f, x - 0.008, x + 0.008, b0, b1, 0.007, SLOT.sash);
        k.box(f, 0.03, len - 0.03, b0 - 0.03, b0, 0, 0.03, SLOT.trim);
      }
    }
  }
  // the central block, standing forward and taller
  const C = { x0: -0.6, x1: 0.6, z0: -0.45, z1: 0.45, top: 1.15 };
  for (const { f, len, name } of sides(C.x0, C.x1, C.z0, C.z1)) {
    const front = name === "south";
    const holes: Rect[] = [];
    if (front) for (let i = 0; i < 4; i++) holes.push([0.2 + i * 0.22 + 0.04, 0.2 + i * 0.22 + 0.18, 0.32, 1.0]);
    k.wall(f, 0, len, -0.3, C.top, holes, SLOT.trim);
    for (const r of holes) barred(k, f, r, 0.04, 1, 5, SLOT.trim);
    if (!front) continue;
    // fins between the glass strips, above the parapet; the entrance under a canopy
    for (let i = 0; i <= 4; i++) k.box(f, 0.2 + i * 0.22 - 0.025, 0.2 + i * 0.22 + 0.025, 0.25, C.top + 0.12, 0, 0.08, SLOT.trim);
    k.box(f, len / 2 - 0.3, len / 2 + 0.3, 0, 0.2, -0.02, 0.004, SLOT.door);
    k.box(f, len / 2 - 0.42, len / 2 + 0.42, 0.22, 0.25, 0, 0.2, SLOT.trim);
  }
  k.face(LOCAL, [[C.x0, C.top, C.z0], [C.x1, C.top, C.z0], [C.x1, C.top, C.z1], [C.x0, C.top, C.z1]], [0, 1, 0], SLOT.gravel);
  band(k, C.x0, C.x1, C.z0, C.z1, C.top, C.top + 0.05, 0.02, SLOT.trim, 0.03);
  // the forecourt
  k.box(LOCAL, -1.2, 1.2, -0.04, 0.012, 0.45, 1.0, SLOT.stone);
}

/** A palm: a leaning trunk and a crown of drooping fronds (both faces). */
function palm(k: Builder, x: number, z: number, h: number, seed: number) {
  const lean: P2 = [0.05 * Math.cos(seed * 2.3), 0.05 * Math.sin(seed * 2.3)];
  const topP: L3 = [x + lean[0], h, z + lean[1]];
  k.solid(LOCAL, ring(ngon(x, z, 0.03, 5, seed), -0.05), ring(ngon(topP[0], topP[2], 0.022, 5, seed), h), SLOT.tar);
  for (let i = 0; i < 6; i++) {
    const a = seed + (i * Math.PI) / 3;
    const [cx, cz] = [Math.cos(a), Math.sin(a)];
    const mid: L3 = [topP[0] + cx * 0.16, h + 0.06, topP[2] + cz * 0.16];
    const tip: L3 = [topP[0] + cx * 0.3, h - 0.08, topP[2] + cz * 0.3];
    const side: L3 = [-cz * 0.05, 0, cx * 0.05];
    const l: L3 = [mid[0] + side[0], mid[1], mid[2] + side[2]];
    const r: L3 = [mid[0] - side[0], mid[1], mid[2] - side[2]];
    for (const up of [1, -1]) k.face(LOCAL, [topP, l, tip, r], [0, up, 0], SLOT.sash);
  }
}

const TREASURE_SCHEME = PALETTES.findIndex((p) => p.name === "sage");

function treasureBuildingsGeometry() {
  const parts: BufferGeometry[] = [];
  for (const x of HANGAR.xs) {
    const k = builder();
    hangar(k);
    parts.push(placedModel(k, at(x, TREASURE_Y, HANGAR.z)));
  }
  const one = builder();
  buildingOne(one);
  parts.push(placedModel(one, at(ONE.x, TREASURE_Y, ONE.z)));
  // the avenue from the causeway to Building One, a cross street in front of it, palms along it
  const k = builder();
  const y = TREASURE_Y;
  k.box(LOCAL, ONE.x - 0.25, ONE.x + 0.25, y - 0.03, y + 0.02, -1.5, 7.2, SLOT.gravel);
  k.box(LOCAL, 135.5, 150.5, y - 0.03, y + 0.02, -1.9, -1.5, SLOT.gravel);
  for (let i = 0; i < 8; i++) for (const s of [-1, 1]) palm(k, ONE.x + s * 0.55, -0.9 + i * 1.0, 0.75 + 0.1 * hash(i, s), i * 1.7 + s);
  parts.push(placedModel(k, new Matrix4()));
  return finish(mergeGeometries(parts), TREASURE_SCHEME);
}

/** Treasure Island: the flat land, its sea wall, and every building, palm and road in one more draw call. */
export function TreasureIsland() {
  const { siding } = useLandmarkTextures();
  const flat = useMemo(() => treasureIslandGeometry(), []);
  const buildings = useMemo(() => treasureBuildingsGeometry(), []);
  const m = useMemo(
    () => ({
      lawn: new MeshStandardMaterial({ color: "#959f73", roughness: 1 }),
      wall: new MeshStandardMaterial({ color: "#a9a397", roughness: 0.95 }),
      paint: houseMaterial(siding, siding, palette()),
    }),
    [siding],
  );
  return (
    <>
      <mesh geometry={flat} material={[m.lawn, m.wall]} receiveShadow castShadow />
      <mesh geometry={buildings} material={m.paint} castShadow receiveShadow />
    </>
  );
}

/** Every generated island mesh, for the tests. */
export const islandGeometries = () => ({
  alcatraz: alcatrazGeometry(),
  alcatrazBuildings: alcatrazBuildingsGeometry(),
  alcatrazPier: alcatrazPierGeometry(),
  alcatrazLights: alcatrazLightsGeometry(),
  beam: beamGeometry(),
  treasureIsland: treasureIslandGeometry(),
  treasureBuildings: treasureBuildingsGeometry(),
});
