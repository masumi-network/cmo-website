"use client";

// 18:00 Ferry Building, modelled (no painted facades), with the California St
// cable car Cuso rides and the newsletter envelopes.
//
// The hall: Beaux-Arts in cream stone, built with the row houses' kit and
// paints (house-models.ts, cream scheme). A ground-floor arcade of round
// arches with the glass set well back, a belt course, two storeys of windows
// (arched with archivolts and keystones, then square attic windows) between
// pilasters, a bracketed cornice, and a low copper roof with a long glazed
// skylight down the middle. A portal under the tower on both long sides.
// It stands on the pier deck: paved, steps down to the Embarcadero sidewalk
// on the city side, a rusticated granite sea wall with a coping into the bay
// on the others.
//
// The tower, after the Giralda: a shaft with corner piers, a framed panel and
// arched windows; the clock stage with four dials; two open belfry stages
// (arches on piers, balustrades, a dark core); an octagonal lantern under a
// copper dome; a flagpole. It is its own mesh so it can be floodlit at night.
//
// Behind the arcade's clear shop glass (shop.tsx), the marketplace, built like
// the café and the taqueria: a tiled floor, a stall behind every arch (produce
// in slatted crates, a bakery with loaves and baguettes, zinc buckets of
// flowers, a cheese counter, a coffee bar with bentwood stools, round in
// turn), enamel pendants, a spine of named shopfronts down the middle, and
// under the tower a passage closed by lit doorways into the nave. Its light
// is baked in the material (no real-time lights); at night it glows warm.
//
// Draw calls: hall 1, market 1, arcade glass 1, tower 1, clock dials 1.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CapsuleGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, Matrix4, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type InstancedMesh, type Texture } from "three";
import { dayNow, isPhone, rig, useInterior, useNightGlow } from "./shared";
import { CableCar, Rails } from "./cable-car";
import { type V3 } from "./parts";
import { PALETTES, SLOT, builder, palette, type Builder, type Frame, type L3, type P2 } from "./house-models";
import { box, cyl, drawn, merged, placed, placer, useLandmarkTextures } from "./landmark-kit";
import { facadeNight } from "./facade";
import { houseMaterial, glassMaterial } from "./materials";
import { FERRY } from "./layout";

export { FERRY };

export const FERRY_CAR = { p: [18.4, 0, 4] as V3 };

const X = FERRY.x;
const Z = FERRY.z;
const FLOOR = FERRY.plinth[1];

type Span = [number, number];

/** The hall's walls (world x, z) and heights; the tower's stages. The cornice reaches the hall box. */
export const HALL = {
  x0: X - 1.45,
  x1: X + 1.45,
  z0: Z - 5.95,
  z1: Z + 5.95,
  /** Top of the arcade arches, the belt course over them, the attic storey's floor, the frieze, the wall top (cornice crown). */
  arcade: 1.35,
  belt: 1.45,
  attic: 2.3,
  frieze: 2.8,
  wall: 3.1,
  cornice: 0.13,
  /** The roof slopes up to `roof` at the skylight curb; the skylight's glazed ridge. */
  roof: 3.5,
  ridge: 3.95,
  tower: {
    shaft: [3.1, 7.12] as Span,
    clock: [7.12, 8.42] as Span,
    belfry: [[8.56, 9.55], [9.65, 10.3]] as Span[],
    dome: [10.62, 10.95] as Span,
  },
};

/** The clock dials: centre height, radius, how far out from the tower's axis. */
export const CLOCK = { y: 7.77, r: 0.45, out: 0.75 };

/** Paint scheme (PALETTES): cream stone, lighter trim, dark sashes. */
export const PAINT = PALETTES.findIndex((p) => p.name === "cream");

const WORLD: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
type Rect = { x0: number; x1: number; z0: number; z1: number };

/** Four walls of a rectangle, counter-clockwise from the south (+z), each facing out. */
function sides(r: Rect) {
  return [
    { f: { o: [r.x0, 0, r.z1], u: [1, 0, 0] } as Frame, len: r.x1 - r.x0, name: "south" },
    { f: { o: [r.x1, 0, r.z1], u: [0, 0, -1] } as Frame, len: r.z1 - r.z0, name: "east" },
    { f: { o: [r.x1, 0, r.z0], u: [-1, 0, 0] } as Frame, len: r.x1 - r.x0, name: "north" },
    { f: { o: [r.x0, 0, r.z0], u: [0, 0, 1] } as Frame, len: r.z1 - r.z0, name: "west" },
  ];
}
const square = (h: number) => sides({ x0: X - h, x1: X + h, z0: Z - h, z1: Z + h });

/** A moulding run round a rectangle, mitred at the corners. `profile`: (out, y) points from the wall out and back. */
function moulding(k: Builder, r: Rect, profile: P2[], slot: number) {
  const ring = (c: number): P2[] => [[r.x0 - c, r.z0 - c], [r.x1 + c, r.z0 - c], [r.x1 + c, r.z1 + c], [r.x0 - c, r.z1 + c]];
  const outs: P2[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let i = 0; i < profile.length - 1; i++) {
    const [[c0, y0], [c1, y1]] = [profile[i], profile[i + 1]];
    const [p, q] = [ring(c0), ring(c1)];
    for (let s = 0; s < 4; s++) {
      const t = (s + 1) % 4;
      const out: L3 = [outs[s][0] * (y1 - y0), c0 - c1, outs[s][1] * (y1 - y0)];
      k.face(WORLD, [[p[s][0], y0, p[s][1]], [p[t][0], y0, p[t][1]], [q[t][0], y1, q[t][1]], [q[s][0], y1, q[s][1]]], out, slot);
    }
  }
}
const squareRect = (h: number): Rect => ({ x0: X - h, x1: X + h, z0: Z - h, z1: Z + h });

/** Runs from a0 to a1 with the gaps left out. */
function runs(a0: number, a1: number, gaps: Span[]): Span[] {
  const out: Span[] = [];
  let a = a0;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) {
    if (g0 > a) out.push([a, g0]);
    a = Math.max(a, g1);
  }
  if (a1 > a) out.push([a, a1]);
  return out;
}

/** Points on a half circle over (mid, spring), from angle t0 to t1. */
const arc = (mid: number, spring: number, r: number, t0: number, t1: number, n: number): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    return [mid + Math.cos(t) * r, spring + Math.sin(t) * r];
  });
const at = ([a, b]: P2, c: number): L3 => [a, b, c];

/** The wall over a round arch at depth c (the caller leaves the arch's rectangle open): the two haunches and the wall up to `y1`. */
function spandrels(k: Builder, f: Frame, a0: number, a1: number, spring: number, y1: number, c: number, facing: number, slot: number, n: number) {
  const mid = (a0 + a1) / 2;
  const r = (a1 - a0) / 2;
  const top = spring + r;
  k.face(f, [[a0, top, c], ...arc(mid, spring, r, Math.PI, Math.PI / 2, n / 2).map((p) => at(p, c))], [0, 0, facing], slot);
  k.face(f, [[a1, top, c], ...arc(mid, spring, r, 0, Math.PI / 2, n / 2).map((p) => at(p, c))], [0, 0, facing], slot);
  if (y1 > top + 1e-6) k.quad(f, a0, a1, top, y1, c, slot, 0, facing);
}

/** The arch's underside from depth c0 back to c1. */
function intrados(k: Builder, f: Frame, a0: number, a1: number, spring: number, c0: number, c1: number, slot: number, n: number) {
  const mid = (a0 + a1) / 2;
  const pts = arc(mid, spring, (a1 - a0) / 2, Math.PI, 0, n);
  for (let i = 0; i < n; i++) {
    const [p, q] = [pts[i], pts[i + 1]];
    k.face(f, [at(p, c0), at(q, c0), at(q, c1), at(p, c1)], [mid - (p[0] + q[0]) / 2, spring - (p[1] + q[1]) / 2, 0], slot);
  }
}

type ArchOpts = { depth: number; id: number; n: number; reveal: number; ring?: number; sill?: boolean; bars?: boolean; glass?: Builder };

/**
 * A round-arched opening in a wall (the caller cuts [a0, a1] up to the
 * crown): haunches, jambs and soffit back to the glass at `depth`, the glass
 * (one window id, or into the `glass` builder when it is clear shop glass), and optionally glazing bars, an archivolt with a keystone,
 * an architrave down the jambs and a sill.
 */
function arch(k: Builder, f: Frame, a0: number, a1: number, b0: number, spring: number, o: ArchOpts, wall: number) {
  const r = (a1 - a0) / 2;
  const mid = (a0 + a1) / 2;
  const top = spring + r;
  const d = -o.depth;
  spandrels(k, f, a0, a1, spring, top, 0, 1, wall, o.n);
  k.face(f, [[a0, b0, 0], [a0, spring, 0], [a0, spring, d], [a0, b0, d]], [1, 0, 0], o.reveal);
  k.face(f, [[a1, b0, 0], [a1, spring, 0], [a1, spring, d], [a1, b0, d]], [-1, 0, 0], o.reveal);
  if (o.sill) k.face(f, [[a0, b0, 0], [a1, b0, 0], [a1, b0, d], [a0, b0, d]], [0, 1, 0], o.reveal);
  intrados(k, f, a0, a1, spring, 0, d, o.reveal, o.n);
  (o.glass ?? k).face(f, [[a0, b0, d], [a1, b0, d], ...arc(mid, spring, r, 0, Math.PI, o.n).map((p) => at(p, d))], [0, 0, 1], SLOT.glass, o.id);
  if (o.bars) {
    const t = 0.012;
    const c = d + 0.006;
    k.quad(f, a0, a1, spring - t, spring + t, c, SLOT.sash);
    k.quad(f, mid - t, mid + t, b0, top - 0.002, c, SLOT.sash);
  }
  if (o.ring) {
    const w = o.ring;
    const p = 0.02;
    const inner = arc(mid, spring, r, Math.PI, 0, o.n);
    const outer = arc(mid, spring, r + w, Math.PI, 0, o.n);
    for (let i = 0; i < o.n; i++) {
      const [P, Q, R, S] = [inner[i], inner[i + 1], outer[i + 1], outer[i]];
      k.face(f, [at(P, p), at(Q, p), at(R, p), at(S, p)], [0, 0, 1], SLOT.trim);
      k.face(f, [at(S, 0), at(R, 0), at(R, p), at(S, p)], [(S[0] + R[0]) / 2 - mid, (S[1] + R[1]) / 2 - spring, 0], SLOT.trim);
      k.face(f, [at(P, 0), at(Q, 0), at(Q, p), at(P, p)], [mid - (P[0] + Q[0]) / 2, spring - (P[1] + Q[1]) / 2, 0], SLOT.trim);
    }
    k.box(f, mid - 0.03, mid + 0.03, top - 0.02, top + w + 0.025, 0, p + 0.012, SLOT.trim); // keystone
    if (o.sill) {
      // architrave down the jambs, a sill under
      k.box(f, a0 - w, a0, b0, spring, 0, p, SLOT.trim);
      k.box(f, a1, a1 + w, b0, spring, 0, p, SLOT.trim);
      k.box(f, a0 - w - 0.02, a1 + w + 0.02, b0 - 0.035, b0, 0, p + 0.025, SLOT.trim);
    }
  }
}

// ---------------------------------------------------------------------------
// The hall

/** n equal bays from a0 to a1. */
const split = (a0: number, a1: number, n: number): Span[] => Array.from({ length: n }, (_, i) => [a0 + ((a1 - a0) * i) / n, a0 + ((a1 - a0) * (i + 1)) / n]);

const PIER = 0.35; // solid corner piers
const UPPER = { w: 0.22, sill: 1.72, top: 2.14 }; // arched windows of the first storey
const ATTIC = { w: 0.2, sill: 2.42, top: 2.68 }; // square attic windows
const PORTAL = { w: 0.8, top: 1.6 }; // the tower's entrance, through the belt course

/** How far the arcade's glass sits behind the wall face (the portal's a little more). */
const GLASS_IN = 0.22;

type Opening = { a0: number; a1: number; spring: number; kind: "arch" | "flank" | "portal" };

/** The bays along one side of the hall, and the ground floor's openings in them. */
function arcade(len: number, long: boolean) {
  const mid = len / 2;
  const bays = long ? [...split(PIER, mid - 1, 7), ...split(mid + 1, len - PIER, 7)] : split(PIER, len - PIER, 3);
  const arches = bays.map(([a, b]): Opening => {
    const w = (b - a) * 0.62;
    const c = (a + b) / 2;
    return { a0: c - w / 2, a1: c + w / 2, spring: HALL.arcade - w / 2, kind: "arch" };
  });
  // under the tower: a tall portal between two narrow arches
  const centre: Opening[] = long
    ? [
        ...[-0.7, 0.7].map((d): Opening => ({ a0: mid + d - 0.15, a1: mid + d + 0.15, spring: HALL.arcade - 0.15, kind: "flank" })),
        { a0: mid - PORTAL.w / 2, a1: mid + PORTAL.w / 2, spring: PORTAL.top - PORTAL.w / 2, kind: "portal" },
      ]
    : [];
  return { bays, openings: [...arches, ...centre] };
}

/** One side of the hall: arcade (its clear glass into `glass`), belt, two storeys of windows, pilasters, brackets. Returns the next window id. */
function hallSide(k: Builder, glass: Builder, f: Frame, len: number, long: boolean, id: number) {
  const mid = len / 2;
  const { bays, openings } = arcade(len, long);
  const uppers = [...bays, ...(long ? split(mid - 1, mid + 1, 3) : [])].map(([a, b]) => (a + b) / 2);
  const edges = [...new Set([...bays.flat(), ...(long ? split(mid - 1, mid + 1, 3).flat() : [])].map((a) => +a.toFixed(4)))];

  // the arcade: arches to the floor, clear glass deep in the opening, an impost band on the piers
  const ground = openings.map((o): [number, number, number] => [o.a0, o.a1, o.spring]);
  const portal = openings.find((o) => o.kind === "portal");
  const impost = ground[0][2]; // the arches' springing
  for (const [a0, a1, spring] of ground) {
    const big = a1 - a0 > 0.6;
    arch(k, f, a0, a1, FLOOR, spring, { depth: big ? 0.3 : GLASS_IN, id: 0, n: big ? 14 : 10, reveal: SLOT.panel, ring: big ? 0.05 : 0.03, bars: true, glass }, SLOT.stucco);
  }
  const springs = ground.map(([a0, a1]) => [a0 - 0.035, a1 + 0.035] as Span);
  for (const [s0, s1] of runs(-0.025, len + 0.025, springs)) {
    k.box(f, s0, s1, FLOOR, FLOOR + 0.14, 0, 0.025, SLOT.panel); // base course
    k.box(f, s0, s1, impost - 0.05, impost, 0, 0.018, SLOT.trim); // impost band
  }

  // the belt course over the arcade (the portal breaks through it)
  const belt: P2[] = [[0, HALL.belt], [0.04, HALL.belt], [0.055, HALL.belt + 0.02], [0.055, HALL.belt + 0.1], [0, HALL.belt + 0.1]];
  for (const [s0, s1] of runs(-0.055, len + 0.055, portal ? [[portal.a0 - 0.06, portal.a1 + 0.06]] : [])) k.profile(f, s0, s1, belt, SLOT.trim);

  // two storeys: arched windows with archivolts, square attic windows with sills
  const holes: [number, number, number, number][] = ground.map(([a0, a1, spring]) => [a0, a1, FLOOR, spring + (a1 - a0) / 2]);
  for (const a of uppers) {
    const [a0, a1] = [a - UPPER.w / 2, a + UPPER.w / 2];
    holes.push([a0, a1, UPPER.sill, UPPER.top]);
    arch(k, f, a0, a1, UPPER.sill, UPPER.top - UPPER.w / 2, { depth: 0.05, id: ++id, n: 8, reveal: SLOT.trim, ring: 0.03, sill: true, bars: true }, SLOT.stucco);
    const r: [number, number, number, number] = [a - ATTIC.w / 2, a + ATTIC.w / 2, ATTIC.sill, ATTIC.top];
    holes.push(r);
    k.window(f, r, ++id);
    k.box(f, r[0] - 0.03, r[1] + 0.03, r[2] - 0.03, r[2], 0, 0.035, SLOT.trim);
  }
  k.wall(f, 0, len, FLOOR, HALL.wall, holes, SLOT.stucco);

  // pilasters between the bays (wider ones round the corners), with capitals
  const [p0, p1] = [HALL.belt + 0.1, HALL.frieze - 0.02];
  for (const a of edges) {
    k.box(f, a - 0.035, a + 0.035, p0, p1, 0, 0.022, SLOT.stucco);
    k.box(f, a - 0.05, a + 0.05, p1 - 0.06, p1, 0, 0.034, SLOT.trim);
  }
  for (const [a0, a1] of [[-0.022, 0.13], [len - 0.13, len + 0.022]]) {
    k.box(f, a0, a1, p0, p1, 0, 0.022, SLOT.stucco);
    k.box(f, a0 - 0.012, a1 + 0.012, p1 - 0.06, p1, 0, 0.034, SLOT.trim);
  }

  // brackets under the cornice crown
  const n = Math.round(len / 0.24);
  for (let i = 0; i <= n; i++) {
    const a = 0.06 + ((len - 0.12) * i) / n;
    k.profile(f, a - 0.018, a + 0.018, [[0, HALL.frieze + 0.07], [0.03, HALL.frieze + 0.07], [0.11, 2.95], [0, 2.95]], SLOT.trim);
  }
  return id;
}

/** The pier deck: a granite sea wall with a coping on the water sides, steps up from the sidewalk, paving. */
function deck(k: Builder) {
  const [px0, px1, pz0, pz1] = [X - FERRY.plinth[0] / 2, X + FERRY.plinth[0] / 2, Z - FERRY.plinth[2] / 2, Z + FERRY.plinth[2] / 2];
  const base = -0.6;
  const STEPS = 0.31; // the steps' run on the city side
  const RUST = 0.04; // granite blocks stand out of the core
  const COPE = 0.08; // the coping reaches the plinth's edge
  const core: Rect = { x0: px0 + STEPS + 0.01, x1: px1 - COPE, z0: pz0 + COPE, z1: pz1 - COPE };
  // the core (dark: it shows in the joints), its top just under the paving
  k.box(WORLD, core.x0, core.x1, base, FLOOR - 0.01, core.z0, core.z1, SLOT.tar);

  // sea wall: courses of rusticated blocks with a dark joint between, a coping on top
  const courses: Span[] = [[base, -0.3], [-0.3, 0], [0, FLOOR - 0.08]];
  for (const { f, len, name } of sides(core)) {
    if (name === "west") continue;
    // north and south run out over the steps' ends; all three wrap the east corners
    const [a0, a1] = name === "east" ? [-RUST, len + RUST] : name === "north" ? [-RUST, len + STEPS + 0.01] : [-STEPS - 0.01, len + RUST];
    courses.forEach(([y0, y1], j) => {
      const n = Math.max(1, Math.round((a1 - a0) / 0.7));
      for (let i = 0; i < n; i++) {
        const s0 = a0 + ((a1 - a0) * (i + (j % 2) * 0.5)) / n;
        const s1 = Math.min(a1, s0 + (a1 - a0) / n - 0.015);
        const pts: P2[] = [[0, y0 + 0.01], [RUST - 0.015, y0 + 0.01], [RUST, y0 + 0.025], [RUST, y1 - 0.015], [RUST - 0.015, y1], [0, y1]];
        k.profile(f, s0, s1, pts, SLOT.stone);
        if (j % 2 && i === 0) k.profile(f, a0, s0 - 0.015, pts, SLOT.stone); // half block at the start of offset courses
      }
    });
    k.box(f, a0 - (name === "east" ? COPE - RUST : 0), a1 + (name === "east" ? COPE - RUST : 0), FLOOR - 0.08, FLOOR, -0.1, COPE, SLOT.stone);
  }

  // two steps from the Embarcadero sidewalk up to the plaza, a riser at the plaza's edge
  k.box(WORLD, px0, core.x0, base, FLOOR - 0.2, core.z0, core.z1, SLOT.stone);
  k.box(WORLD, px0 + STEPS / 2, core.x0, base, FLOOR - 0.1, core.z0, core.z1, SLOT.stone);
  k.face(WORLD, [[px0 + STEPS, FLOOR - 0.1, core.z0], [px0 + STEPS, FLOOR - 0.1, core.z1], [px0 + STEPS, FLOOR, core.z1], [px0 + STEPS, FLOOR, core.z0]], [-1, 0, 0], SLOT.stone);

  // paving slabs on the deck round the hall (the dark core shows in the joints)
  const pave: Rect = { x0: px0 + STEPS, x1: core.x1 - 0.1, z0: core.z0 + 0.1, z1: core.z1 - 0.1 };
  const nx = Math.round((pave.x1 - pave.x0) / 0.45);
  const nz = Math.round((pave.z1 - pave.z0) / 0.45);
  const g = 0.006;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x0 = pave.x0 + ((pave.x1 - pave.x0) * i) / nx;
      const x1 = pave.x0 + ((pave.x1 - pave.x0) * (i + 1)) / nx;
      const z0 = pave.z0 + ((pave.z1 - pave.z0) * j) / nz;
      const z1 = pave.z0 + ((pave.z1 - pave.z0) * (j + 1)) / nz;
      if (x0 >= HALL.x0 && x1 <= HALL.x1 && z0 >= HALL.z0 && z1 <= HALL.z1) continue; // under the hall
      k.face(WORLD, [[x0 + (i ? g : 0), FLOOR, z0 + g], [x1 - g, FLOOR, z0 + g], [x1 - g, FLOOR, z1 - g], [x0 + (i ? g : 0), FLOOR, z1 - g]], [0, 1, 0], SLOT.stone);
    }
  }
  // the edge strip by the coping
  k.face(WORLD, [[pave.x0, FLOOR, core.z0 - 0.1 + COPE], [core.x1 - 0.1 + COPE, FLOOR, core.z0 - 0.1 + COPE], [core.x1 - 0.1 + COPE, FLOOR, pave.z0], [pave.x0, FLOOR, pave.z0]], [0, 1, 0], SLOT.stone);
}

/** The low hipped roof up to the skylight curb, and the glazed skylight down the middle (in two runs, either side of the tower). */
function roof(k: Builder, id: number) {
  const { x0, x1, z0, z1, wall, roof: top, ridge } = HALL;
  const inset = 0.9;
  const t: Rect = { x0: X - 0.55, x1: X + 0.55, z0: z0 + inset, z1: z1 - inset };
  const slope = (p: L3[], out: L3) => k.face(WORLD, p, out, SLOT.copper);
  const rise = top - wall;
  slope([[x0, wall, z0], [x0, wall, z1], [t.x0, top, t.z1], [t.x0, top, t.z0]], [-rise, t.x0 - x0, 0]);
  slope([[x1, wall, z0], [x1, wall, z1], [t.x1, top, t.z1], [t.x1, top, t.z0]], [rise, x1 - t.x1, 0]);
  slope([[x0, wall, z0], [x1, wall, z0], [t.x1, top, t.z0], [t.x0, top, t.z0]], [0, inset, -rise]);
  slope([[x0, wall, z1], [x1, wall, z1], [t.x1, top, t.z1], [t.x0, top, t.z1]], [0, inset, rise]);
  k.face(WORLD, [[t.x0, top, t.z0], [t.x1, top, t.z0], [t.x1, top, t.z1], [t.x0, top, t.z1]], [0, 1, 0], SLOT.tar);

  // the skylight: glazed sides and a pitched glass roof, framed by bars
  const F: Frame = { o: [X, 0, 0], u: [0, 0, 1] }; // a = world z, c = X - world x
  const w = 0.45;
  const eave = top + 0.16;
  const bar = 0.012;
  const section: P2[] = [[-w - bar, top], [w + bar, top], [w + bar, eave + bar], [0, ridge + bar], [-w - bar, eave + bar]];
  for (const [a0, a1] of [[t.z0 + 0.1, Z - 0.75], [Z + 0.75, t.z1 - 0.1]]) {
    for (const s of [-1, 1]) {
      k.face(F, [[a0, top, s * w], [a1, top, s * w], [a1, eave, s * w], [a0, eave, s * w]], [0, 0, s], SLOT.glass, ++id);
      k.face(F, [[a0, eave, s * w], [a1, eave, s * w], [a1, ridge, 0], [a0, ridge, 0]], [0, w, s * (ridge - eave)], SLOT.glass, ++id);
    }
    const n = Math.round((a1 - a0) / 0.4);
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      k.profile(F, Math.max(a0, a - bar), Math.min(a1, a + bar) + (i === 0 ? bar : 0) - (i === n ? bar : 0), section, SLOT.sash);
    }
    k.profile(F, a0, a1, [[-0.02, ridge - 0.02], [0.02, ridge - 0.02], [0.02, ridge + 0.02], [-0.02, ridge + 0.02]], SLOT.sash);
  }
  return id;
}

/**
 * The pier deck and the hall in world coordinates: `shell` in the house
 * material's attributes, `glass` the arcade's clear shop glass (its own mesh).
 */
export function hallParts() {
  const k = builder();
  const glass = builder();
  deck(k);
  let id = 0;
  const r: Rect = { x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1 };
  for (const { f, len, name } of sides(r)) id = hallSide(k, glass, f, len, name === "east" || name === "west", id);
  // the attic sill course, an architrave under the frieze, the cornice crown
  moulding(k, r, [[0, HALL.attic], [0.02, HALL.attic], [0.02, HALL.attic + 0.035], [0, HALL.attic + 0.035]], SLOT.trim);
  moulding(k, r, [[0, HALL.frieze - 0.03], [0.04, HALL.frieze - 0.03], [0.04, HALL.frieze + 0.07], [0, HALL.frieze + 0.07]], SLOT.trim);
  const c = HALL.cornice;
  moulding(k, r, [[0, 2.95], [c - 0.02, 2.95], [c, 2.98], [c, HALL.wall], [0, HALL.wall]], SLOT.trim);
  roof(k, id);
  return { shell: withPaint(k.geometry()), glass: glass.geometry() };
}

const withPaint = (g: BufferGeometry) => {
  g.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(PAINT), 1));
  return g;
};

// ---------------------------------------------------------------------------
// The marketplace behind the arcade

/**
 * The market inside, in world terms: behind the arcade's glass planes, from
 * its tiled floor up to the ceiling over the arches. Down the middle a spine
 * of shopfronts (`spine`: half its width), and under the tower a passage
 * (`passage`: half its length) closed by a wall with a lit doorway on each side.
 */
export const MARKET = {
  x0: HALL.x0 + GLASS_IN,
  x1: HALL.x1 - GLASS_IN,
  z0: HALL.z0 + GLASS_IN,
  z1: HALL.z1 - GLASS_IN,
  floor: FLOOR + 0.01,
  ceiling: 1.68,
  spine: 0.23,
  passage: 0.5,
};
const SPINE = { z0: MARKET.z0 + 0.85, z1: MARKET.z1 - 0.85 };

/** Surfaces the market's material dresses (`aMat`). */
export const MARKET_MAT = { plain: 0, floor: 1, wood: 2, crate: 3, zinc: 4, glaze: 5, marble: 6, bread: 7, plaster: 8, sign: 9 } as const;
const FM = MARKET_MAT;

/** The words on the shop signs, one per row of the sign atlas. */
export const SIGN_WORDS = ["Produce", "Bakery", "Flowers", "Cheese", "Coffee", "Market"];
type Kind = "produce" | "bakery" | "flowers" | "deli" | "cafe";
/** Stall kinds, in the order they come round (neighbours always differ), and their signs. */
const KINDS: Kind[] = ["produce", "bakery", "flowers", "deli", "cafe"];
const WORD: Record<Kind, number> = { produce: 0, bakery: 1, flowers: 2, deli: 3, cafe: 4 };

/** Muted market colours: one wood, cream and stone family, produce and flowers in soft tones, dark shopfronts. */
const MK = {
  wall: "#ddd1b9",
  ceiling: "#e6dcc6",
  floor: "#dcd0b8",
  spine: "#d6c9ae",
  wood: "#7a5a3e",
  dark: "#5e4530",
  light: "#a3815c",
  crate: "#a07e56",
  zinc: "#a4a9ab",
  marble: "#ece8df",
  cream: "#e3d8c2",
  enamel: "#ebe4d3",
  iron: "#2e3230",
  bulb: "#fff1d6",
  display: "#efe0bf",
  nave: "#f1e2c2",
  steel: "#b8bcbe",
  leaves: "#5f7d48",
  rind: "#c39d5c",
  paste: "#e8d7a3",
  crust: ["#b07a45", "#c08d52", "#9c6a3c"],
  produce: ["#6f7f4a", "#c49a4a", "#8a9a5b", "#a8553e", "#6a5462", "#d2b25a"],
  flowers: ["#d9a6a0", "#f0ebe0", "#c9b25e", "#a9b88a", "#b98a9a"],
  jars: ["#8a6a3e", "#b08a5a", "#6f7a5a", "#d8cdb4", "#7a4a3a"],
  fronts: ["#2f5141", "#3a404c", "#5b2f2a", "#4a3d30", "#55603f"],
};

/** Paints a part: a vertex colour (`top` for its upward faces: what's in a crate, a cheese's cut face), its surface, its glow (1: lit by the room; more: glowing). */
function dress(g: BufferGeometry, hex: string, mat: number, o: { glow?: number; top?: string } = {}) {
  const n = g.attributes.normal;
  const count = g.attributes.position.count;
  const [base, top] = [new Color(hex), new Color(o.top ?? hex)];
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) (n.getY(i) > 0.7 ? top : base).toArray(col, i * 3);
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(count).fill(o.glow ?? 1), 1));
  g.setAttribute("aMat", new Float32BufferAttribute(new Float32Array(count).fill(mat), 1));
  return g;
}

const UP = new Vector3(0, 1, 0);
const rodMatrix = new Matrix4();
/** A round rod from a to b (legs, cords). */
function rod(a: V3, b: V3, r: number, seg = 4) {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  rodMatrix.compose(new Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new Quaternion().setFromUnitVectors(UP, d.normalize()), new Vector3(1, 1, 1));
  return new CylinderGeometry(r, r, len, seg, 1, true).applyMatrix4(rodMatrix);
}

/** A point inside, in a wall's frame: `a` along it, `d` in from its face, `y` up. */
const inside = (f: Frame, a: number, d: number, y: number): V3 => [f.o[0] + f.u[0] * a + f.u[2] * d, y, f.o[2] + f.u[2] * a - f.u[0] * d];
/** The turn (about y) that points a plane's front (+z) back out towards the wall. */
const outward = (f: Frame) => Math.atan2(-f.u[2], f.u[0]);

/** A stall behind each arch (not the portal; on the ends, the middle arch), and its shopfront on the spine behind. */
function marketSpots() {
  const spots: { f: Frame; c: number; kind: Kind; k: number; back: number; half: number; narrow: boolean }[] = [];
  let k = 0;
  for (const { f, len, name } of sides({ x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1 })) {
    const long = name === "east" || name === "west";
    arcade(len, long).openings.forEach((o, j) => {
      if (o.kind === "portal" || (!long && j !== 1)) return;
      const narrow = o.kind === "flank";
      let kind: Kind = narrow ? "flowers" : long ? KINDS[(k * 3 + (name === "east" ? 1 : 0)) % KINDS.length] : name === "north" ? "flowers" : "produce";
      if (long && !narrow && (j === 6 || j === 7) && kind === "flowers") kind = "deli"; // beside the narrow florists under the tower
      spots.push({ f, c: (o.a0 + o.a1) / 2, kind, k, back: long ? HALL.x1 - X - MARKET.spine : SPINE.z0 - HALL.z0, half: narrow ? 0.17 : long ? 0.27 : 0.2, narrow });
      k++;
    });
  }
  return spots;
}

/**
 * The marketplace as one geometry in world coordinates: vertex colour, `aGlow`,
 * `aMat` (MARKET_MAT), uv (the signs' word atlas). `userData` carries what the
 * material bakes the light from: `shadows` (x, z, half x, half z of what stands
 * on the floor) and `lamps` (the pendants).
 */
export function marketGeometry() {
  const M = MARKET;
  const [F0, CEIL] = [M.floor, M.ceiling];
  const out: BufferGeometry[] = [];
  const shadows: [number, number, number, number][] = [];
  const lamps: V3[] = [];
  const add = (g: BufferGeometry, hex: string, mat: number = FM.plain, o?: { glow?: number; top?: string }) => out.push(dress(g, hex, mat, o));
  const along = (f: Frame) => Math.abs(f.u[0]) > 0.5;
  /** A box standing at y0, centred on (a, d): `sa` along the wall, `sd` deep, `h` tall. */
  const bx = (f: Frame, a: number, d: number, y0: number, sa: number, sd: number, h: number, hex: string, mat: number = FM.plain, o?: { glow?: number; top?: string }) =>
    add(box(inside(f, a, d, y0 + h / 2), along(f) ? [sa, h, sd] : [sd, h, sa]), hex, mat, o);
  const cy = (f: Frame, a: number, d: number, y0: number, top: number, bottom: number, h: number, hex: string, mat: number, seg: number, o?: { top?: string; open?: boolean }) =>
    add(placed(new CylinderGeometry(top, bottom, h, seg, 1, o?.open ?? false), inside(f, a, d, y0 + h / 2)), hex, mat, o);
  const ball = (f: Frame, a: number, d: number, y: number, r: number, hex: string, mat: number, s: V3 = [1, 1, 1], seg: [number, number] = [5, 3]) =>
    add(placed(new SphereGeometry(r, ...seg).scale(...s), inside(f, a, d, y)), hex, mat);
  const shadow = (f: Frame, a: number, d: number, sa: number, sd: number) => {
    const [x, , z] = inside(f, a, d, 0);
    shadows.push(along(f) ? [x, z, sa / 2, sd / 2] : [x, z, sd / 2, sa / 2]);
  };
  /** A plane facing back out to the arches (signs, lit windows), with uv picked from the sign atlas for `word`. */
  const face = (f: Frame, a: number, d: number, y: number, w: number, h: number, hex: string, mat: number, o: { glow?: number; word?: number } = {}) => {
    const g = new PlaneGeometry(w, h);
    if (o.word !== undefined) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (o.word + 1 - uv.getY(i)) / SIGN_WORDS.length);
    }
    add(placed(g, inside(f, a, d, y), [0, outward(f), 0]), hex, mat, o);
  };

  // the room: a tiled floor, a plaster ceiling, plaster walls between the arches, the spine of shops
  add(placed(new PlaneGeometry(M.x1 - M.x0, M.z1 - M.z0), [X, F0, Z], [-Math.PI / 2, 0, 0]), MK.floor, FM.floor);
  add(placed(new PlaneGeometry(M.x1 - M.x0, M.z1 - M.z0), [X, CEIL, Z], [Math.PI / 2, 0, 0]), MK.ceiling, FM.plaster);
  for (const { f, len, name } of sides({ x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1 })) {
    const { openings } = arcade(len, name === "east" || name === "west");
    for (const [s0, s1] of runs(GLASS_IN, len - GLASS_IN, openings.map((o) => [o.a0, o.a1] as Span))) {
      add(placed(new PlaneGeometry(s1 - s0, CEIL - F0), inside(f, (s0 + s1) / 2, GLASS_IN, (F0 + CEIL) / 2), [0, outward(f) + Math.PI, 0]), MK.wall, FM.plaster);
    }
  }
  for (const [z0, z1] of [[SPINE.z0, Z - M.passage], [Z + M.passage, SPINE.z1]]) add(box([X, (F0 + CEIL) / 2, (z0 + z1) / 2], [2 * M.spine, CEIL - F0, z1 - z0]), MK.spine, FM.plaster);

  // the passage under the tower, closed in the middle: on each side a lit doorway into the nave, its frame, a sign
  add(box([X, (F0 + CEIL) / 2, Z], [0.04, CEIL - F0, 2 * M.passage]), MK.spine, FM.plaster);
  for (const s of [-1, 1]) {
    const x = X + s * 0.021;
    const turn = (s * Math.PI) / 2;
    const [w, h] = [0.44, 0.5];
    add(placed(new PlaneGeometry(w, h), [x, F0 + h / 2, Z], [0, turn, 0]), MK.nave, FM.plain, { glow: 1.8 });
    add(placed(new CircleGeometry(w / 2, 12, 0, Math.PI), [x, F0 + h, Z], [0, turn, 0]), MK.nave, FM.plain, { glow: 1.8 });
    const xf = x + s * 0.008;
    for (const dz of [-1, 1]) add(rod([xf, F0, Z + (dz * (w + 0.024)) / 2], [xf, F0 + h, Z + (dz * (w + 0.024)) / 2], 0.012, 6), MK.dark, FM.wood);
    add(placed(new TorusGeometry(w / 2 + 0.012, 0.012, 4, 14, Math.PI), [xf, F0 + h, Z], [0, turn, 0]), MK.dark, FM.wood);
    add(placed(new PlaneGeometry(0.5, 0.11), [x, F0 + h + w / 2 + 0.14, Z], [0, turn, 0]).translate(0, 0, 0), MK.fronts[0], FM.sign);
    const sign = out[out.length - 1].attributes.uv;
    for (let i = 0; i < sign.count; i++) sign.setY(i, 1 - (5 + 1 - sign.getY(i)) / SIGN_WORDS.length);
    pendant(X + s * 0.3, Z + 0.33);
  }

  /** An enamel pendant: a cord, a cream shade, the lit inside of the shade seen from below. */
  function pendant(x: number, z: number) {
    const y = 1.24;
    add(rod([x, y, z], [x, CEIL, z], 0.004), MK.iron);
    add(placed(new CylinderGeometry(0.016, 0.068, 0.065, 10, 1, true), [x, y - 0.0325, z]), MK.enamel, FM.glaze);
    add(placed(new CircleGeometry(0.064, 10), [x, y - 0.064, z], [Math.PI / 2, 0, 0]), MK.bulb, FM.plain, { glow: 3 });
    lamps.push([x, y - 0.07, z]);
  }

  /** A crate with slatted sides (the material draws the slats), heaped with round produce. */
  function crate(f: Frame, a: number, d: number, y0: number, sa: number, sd: number, h: number, hex: string, n: number) {
    const heap = new Color(hex).multiplyScalar(0.7).getHexString();
    bx(f, a, d, y0, sa, sd, h, MK.crate, FM.crate, { top: `#${heap}` });
    for (let i = 0; i < n; i++) {
      const [da, dd] = [((i % 3) - 1) * sa * 0.28, (i < 3 ? -1 : 1) * sd * 0.18];
      const tone = new Color(hex).offsetHSL(0, 0, ((i * 37) % 7) / 70 - 0.04).getHexString();
      ball(f, a + da, d + dd, y0 + h + 0.01, 0.026, `#${tone}`, FM.glaze);
    }
  }

  /** A zinc bucket, tapered, full of leaves and blooms. */
  function bucket(f: Frame, a: number, d: number, y0: number, k: number) {
    cy(f, a, d, y0, 0.04, 0.03, 0.1, MK.zinc, FM.zinc, 8, { open: true });
    add(placed(new CircleGeometry(0.038, 8), inside(f, a, d, y0 + 0.095), [-Math.PI / 2, 0, 0]), MK.leaves);
    for (const [da, dd, dy] of [[-0.016, 0.008, 0.125], [0.018, -0.01, 0.135]]) ball(f, a + da, d + dd, y0 + dy, 0.028, MK.flowers[(k + Math.round(dy * 100)) % MK.flowers.length], FM.plain);
  }

  /** A bentwood stool: a round seat, three splayed legs, a ring. */
  function stool(f: Frame, a: number, d: number) {
    const [x, , z] = inside(f, a, d, 0);
    const h = 0.17;
    add(cyl([x, F0 + h, z], 0.045, 0.043, 0.012, 10), MK.light, FM.wood);
    for (let i = 0; i < 3; i++) {
      const t = (i * 2 * Math.PI) / 3 + 0.4;
      add(rod([x + 0.032 * Math.cos(t), F0 + h, z + 0.032 * Math.sin(t)], [x + 0.045 * Math.cos(t), F0 + 0.004, z + 0.045 * Math.sin(t)], 0.004), MK.light, FM.wood);
    }
    add(placed(new TorusGeometry(0.038, 0.003, 3, 8), [x, F0 + 0.06, z], [Math.PI / 2, 0, 0]), MK.light, FM.wood);
  }

  function stall(f: Frame, c: number, kind: Kind, k: number, narrow: boolean) {
    if (kind === "produce") {
      // a wooden stand with crates on it, one on the floor in front
      bx(f, c, 0.58, F0 + 0.24, 0.46, 0.3, 0.025, MK.wood, FM.wood);
      bx(f, c, 0.44, F0, 0.44, 0.02, 0.24, MK.wood, FM.wood);
      for (const s of [-1, 1]) bx(f, c + s * 0.22, 0.58, F0, 0.02, 0.28, 0.24, MK.wood, FM.wood);
      for (const s of [-1, 0, 1]) crate(f, c + s * 0.15, 0.6, F0 + 0.265, 0.13, 0.2, 0.065, MK.produce[(k + s + 6) % 6], 3);
      crate(f, c + 0.1, 0.33, F0, 0.14, 0.12, 0.08, MK.produce[(2 * k + 3) % 6], 2);
      shadow(f, c, 0.58, 0.46, 0.3);
      shadow(f, c + 0.1, 0.33, 0.14, 0.12);
    } else if (kind === "bakery") {
      // a cream counter with a marble top and round loaves; a rack of baguettes behind
      bx(f, c, 0.52, F0, 0.47, 0.23, 0.03, MK.dark, FM.wood);
      bx(f, c, 0.52, F0 + 0.03, 0.46, 0.22, 0.29, MK.cream, FM.glaze);
      bx(f, c, 0.52, F0 + 0.32, 0.5, 0.25, 0.018, MK.marble, FM.marble);
      for (const s of [-1, 0, 1]) ball(f, c + s * 0.13, 0.52, F0 + 0.36, 0.042, MK.crust[(k + s + 3) % 3], FM.bread, [1, 0.58, 1.15], [7, 4]);
      bx(f, c, 1.02, F0, 0.44, 0.03, 0.9, MK.wood, FM.wood);
      for (const y of [0.42, 0.66]) {
        bx(f, c, 0.97, F0 + y, 0.44, 0.1, 0.015, MK.wood, FM.wood);
        for (const s of [-1, 1]) {
          const loaf = new CapsuleGeometry(0.014, 0.13, 1, 5).rotateZ(Math.PI / 2);
          if (!along(f)) loaf.rotateY(Math.PI / 2);
          add(placed(loaf, inside(f, c + s * 0.1, 0.97, F0 + y + 0.03)), MK.crust[(k + s + 4) % 3], FM.bread);
        }
      }
      shadow(f, c, 0.52, 0.47, 0.23);
      shadow(f, c, 1.0, 0.44, 0.1);
    } else if (kind === "flowers") {
      // a two-step stand of zinc buckets
      const sa = narrow ? 0.24 : 0.44;
      bx(f, c, 0.66, F0, sa, 0.3, 0.14, MK.light, FM.wood);
      bx(f, c, 0.74, F0 + 0.14, sa, 0.14, 0.14, MK.light, FM.wood);
      const front = narrow ? [0] : [-0.11, 0.11];
      const step = narrow ? [-0.06, 0.06] : [-0.14, 0, 0.14];
      front.forEach((da, i) => bucket(f, c + da, 0.38, F0, k + i));
      step.forEach((da, i) => bucket(f, c + da, 0.59, F0 + 0.14, k + i + 2));
      shadow(f, c, 0.66, sa, 0.3);
    } else if (kind === "deli") {
      // a dark counter with cheese wheels (rind round the sides), a shelf of jars behind
      bx(f, c, 0.52, F0, 0.46, 0.22, 0.32, MK.dark, FM.wood);
      bx(f, c, 0.52, F0 + 0.32, 0.5, 0.25, 0.018, MK.marble, FM.marble);
      for (const s of [-1, 1]) cy(f, c + s * 0.12, 0.52, F0 + 0.338, 0.055, 0.055, 0.04, MK.rind, FM.plain, 10, { top: MK.paste });
      cy(f, c - 0.12, 0.52, F0 + 0.378, 0.045, 0.045, 0.035, MK.rind, FM.plain, 10, { top: MK.paste });
      bx(f, c, 1.02, F0, 0.44, 0.03, 0.9, MK.wood, FM.wood);
      [0.42, 0.66].forEach((y, row) => {
        bx(f, c, 0.97, F0 + y, 0.44, 0.1, 0.015, MK.wood, FM.wood);
        for (let s = -1; s <= 1; s++) cy(f, c + s * 0.12, 0.97, F0 + y + 0.015, 0.022, 0.022, 0.05 + 0.015 * ((s + row + k + 3) % 3), MK.jars[(s + row * 2 + k + 5) % MK.jars.length], FM.glaze, 6);
      });
      shadow(f, c, 0.52, 0.46, 0.22);
      shadow(f, c, 1.0, 0.44, 0.1);
    } else {
      // a coffee bar at the back; a little marble table with two bentwood stools
      bx(f, c, 0.98, F0, 0.4, 0.14, 0.34, MK.fronts[(k + 2) % MK.fronts.length], FM.wood);
      bx(f, c, 0.98, F0 + 0.34, 0.42, 0.16, 0.015, MK.marble, FM.marble);
      bx(f, c - 0.08, 0.99, F0 + 0.355, 0.12, 0.09, 0.1, MK.steel, FM.zinc);
      const [x, , z] = inside(f, c, 0.52, 0);
      add(cyl([x, F0 + 0.255, z], 0.075, 0.075, 0.01, 12), MK.marble, FM.marble);
      add(rod([x, F0 + 0.005, z], [x, F0 + 0.25, z], 0.007, 6), MK.iron, FM.zinc);
      add(cyl([x, F0 + 0.004, z], 0.032, 0.035, 0.008, 10), MK.iron, FM.zinc);
      for (const s of [-1, 1]) stool(f, c + s * 0.16, 0.45);
      shadow(f, c, 0.98, 0.4, 0.14);
      shadow(f, c, 0.52, 0.16, 0.16);
    }
  }

  /** A shopfront on the spine: a painted frame, a lit window with a shelf of goods, the shop's name. */
  function shopfront(f: Frame, c: number, half: number, d: number, k: number, word: number) {
    const front = MK.fronts[k % MK.fronts.length];
    bx(f, c, d - 0.0075, F0, 2 * half, 0.015, CEIL - F0 - 0.06, front, FM.wood);
    face(f, c, d - 0.016, F0 + 0.5, 2 * half - 0.12, 0.38, MK.display, FM.plain, { glow: 2.2 });
    bx(f, c, d - 0.04, F0 + 0.46, 2 * half - 0.14, 0.05, 0.012, MK.wood, FM.wood);
    const n = half > 0.2 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const a = c + (i - (n - 1) / 2) * ((2 * half - 0.2) / n);
      const h = 0.04 + 0.025 * ((i * 2 + k) % 3);
      const hex = MK.jars[(i + k) % MK.jars.length];
      if ((i + k) % 2) cy(f, a, d - 0.04, F0 + 0.472, 0.018, 0.018, h, hex, FM.glaze, 6);
      else bx(f, a, d - 0.04, F0 + 0.472, 0.04, 0.03, h, hex, FM.plain);
    }
    // the name under the arch's transom, where it shows from the street
    face(f, c, d - 0.017, F0 + 0.77, 2 * half - 0.08, 0.1, front, FM.sign, { word });
  }

  for (const s of marketSpots()) {
    stall(s.f, s.c, s.kind, s.k, s.narrow);
    shopfront(s.f, s.c, s.half, s.back, s.k, WORD[s.kind]);
    const [x, , z] = inside(s.f, s.c, 0.55, 0);
    pendant(x, z);
  }

  const g = merged(out);
  g.userData = { shadows, lamps };
  return g;
}

/** The sign atlas: one shop name per row, light on dark (the material reads it as a mask). */
function signAtlas() {
  const [w, h] = [512, 110];
  return drawn(w, h * SIGN_WORDS.length, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h * SIGN_WORDS.length);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 64px Georgia, 'Times New Roman', serif";
    SIGN_WORDS.forEach((word, i) => ctx.fillText(word, w / 2, h * (i + 0.54)));
  }, false);
}

/**
 * The market's material, like the café's and the taqueria's: a standard
 * material with vertex colour, surfaces (MARKET_MAT: glossy tile, wood grain,
 * slatted crates, zinc, glaze, marble, crusty bread, plaster, painted signs)
 * and baked light: brighter by the arches, darker into the corners and where
 * surfaces meet, soft contact shadows under the stalls, warm pools under the
 * pendants. It glows warm at night (useNightGlow).
 */
function marketMaterial({ shadows, lamps }: { shadows: number[][]; lamps: number[][] }, signs: Texture) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: "#ffc98c", emissiveIntensity: 0 });
  const glsl = (list: number[][]) => list.map((v) => `vec${v.length}(${v.map((n) => n.toFixed(3)).join(", ")})`).join(", ");
  const M = MARKET;
  m.customProgramCacheKey = () => "ferry-market";
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = facadeNight;
    s.uniforms.uSigns = { value: signs };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nattribute float aMat;\nvarying float vGlow;\nvarying float vMat;\nvarying vec3 vMPos;\nvarying vec3 vMN;\nvarying vec2 vMUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;\nvMat = aMat;\nvMPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvMN = normal;\nvMUv = uv;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform sampler2D uSigns;
        varying float vGlow;
        varying float vMat;
        varying vec3 vMPos;
        varying vec3 vMN;
        varying vec2 vMUv;
        float mRough = -1.0;
        float mMetal = 0.0;
        float mGloss = 0.0;
        float mPool = 0.0;
        const vec4 SHADOWS[${shadows.length}] = vec4[](${glsl(shadows)});
        const vec3 LAMPS[${lamps.length}] = vec3[](${glsl(lamps)});
        float mHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float mNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), f.x), mix(mHash(i + vec2(0.0, 1.0)), mHash(i + 1.0), f.x), f.y);
        }
        float mLine(float x, float size, float w) {
          float d = abs(fract(x / size + 0.5) - 0.5) * size;
          return 1.0 - smoothstep(w, w + fwidth(x) * 1.2, d);
        }
        float mBox(vec2 p, vec2 c, vec2 h, float soft) {
          vec2 q = abs(p - c) - h;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          return 1.0 - smoothstep(-0.02, soft, d);
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          int mat = int(vMat + 0.5);
          vec3 p = vMPos;
          vec3 n = normalize(vMN);
          float along = abs(n.z) > abs(n.x) ? p.x : p.z;
          if (mat == ${FM.floor}) {
            // glazed tiles 0.12 square in two tones, each a little its own, thin grout
            vec2 cell = floor(p.xz / 0.12);
            float grout = max(mLine(p.x, 0.12, 0.004), mLine(p.z, 0.12, 0.004));
            diffuseColor.rgb *= mix(1.0, 0.84, mod(cell.x + cell.y, 2.0)) * (0.94 + 0.1 * mHash(cell));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.47, 0.42), 0.8 * grout);
            mRough = mix(0.22, 0.85, grout);
            mGloss = 0.5 * (1.0 - grout);
          } else if (mat == ${FM.wood}) {
            vec2 q = abs(n.y) > 0.5 ? vec2(p.x * 2.0, p.z * 46.0) : vec2(along * 2.0, p.y * 46.0);
            diffuseColor.rgb *= 0.8 + 0.36 * (0.6 * mNoise(q) + 0.4 * mNoise(q * vec2(3.0, 0.35) + 7.0));
            mRough = 0.5;
            mGloss = 0.15;
          } else if (mat == ${FM.crate}) {
            // slats with dark gaps between them, rough sawn
            float gap = abs(n.y) < 0.5 ? mLine(p.y - 0.003, 0.026, 0.0025) : 0.0;
            diffuseColor.rgb *= (0.82 + 0.3 * mNoise(vec2(along * 3.0, p.y * 60.0))) * (1.0 - 0.6 * gap);
            mRough = 0.85;
          } else if (mat == ${FM.zinc}) {
            diffuseColor.rgb *= 0.9 + 0.14 * mNoise(vec2(along * 30.0, p.y * 8.0));
            mRough = 0.35;
            mMetal = 0.7;
            mGloss = 0.4;
          } else if (mat == ${FM.glaze}) {
            mRough = 0.16;
            mGloss = 0.9;
          } else if (mat == ${FM.marble}) {
            vec2 q = p.xz * 7.0;
            float v = abs(sin(q.x * 1.3 + q.y * 0.7 + 4.0 * mNoise(q * 0.8)));
            diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.0, 0.25, v);
            mRough = 0.18;
            mGloss = 0.6;
          } else if (mat == ${FM.bread}) {
            // a golden crust, paler where it rose, floury specks
            diffuseColor.rgb *= (0.7 + 0.42 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * (0.9 + 0.16 * mNoise(vec2(along, p.y) * 160.0));
            mRough = 0.8;
          } else if (mat == ${FM.plaster}) {
            vec2 q = abs(n.y) > 0.5 ? p.xz : vec2(along, p.y);
            diffuseColor.rgb *= 0.95 + 0.06 * mNoise(q * 3.0) + 0.03 * mNoise(q * 13.0);
            mRough = 0.92;
          } else if (mat == ${FM.sign}) {
            // painted letters on the board
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.87, 0.74), texture2D(uSigns, vMUv).r);
            mRough = 0.55;
            mGloss = 0.2;
          }

          if (vGlow < 1.5) {
            // daylight through the arches: bright by the glass, dimmer towards the spine
            float dg = min(min(p.x - ${M.x0.toFixed(3)}, ${M.x1.toFixed(3)} - p.x), min(p.z - (${M.z0.toFixed(3)}), ${M.z1.toFixed(3)} - p.z));
            float day = mix(1.3, 0.62, smoothstep(0.0, 1.0, dg));
            float up = p.y - ${M.floor.toFixed(3)};
            float ao = 1.0;
            ao *= mix(1.0, smoothstep(-0.03, 0.35, up), 0.5 * (1.0 - abs(n.y)));
            ao *= mix(1.0, smoothstep(-0.03, 0.45, ${M.ceiling.toFixed(3)} - p.y), 0.4 * (1.0 - abs(n.y)));
            ao *= mix(1.0, smoothstep(-0.02, 0.3, abs(p.x - ${X.toFixed(3)}) - ${M.spine.toFixed(3)}), 0.35 * abs(n.y));
            if (n.y > 0.5 && up < 0.02) {
              for (int i = 0; i < ${shadows.length}; i++) ao *= 1.0 - 0.5 * mBox(p.xz, SHADOWS[i].xy, SHADOWS[i].zw, 0.12);
            }
            for (int i = 0; i < ${lamps.length}; i++) {
              vec3 d = p - LAMPS[i];
              float below = max(-d.y, 0.0);
              float spread = 0.02 + 0.12 * below;
              mPool += exp(-dot(d.xz, d.xz) / spread) * (d.y < 0.0 ? 0.45 + 0.55 * max(n.y, 0.0) : 0.15) / (1.0 + below * 0.8);
            }
            vec3 tone = mix(vec3(0.98, 0.99, 1.0), vec3(1.04, 0.97, 0.86), smoothstep(0.0, 1.0, dg));
            diffuseColor.rgb *= mix(day * tone, vec3(0.8), uNight) * ao;
          }
        }`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (mRough >= 0.0) roughnessFactor = mRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = max(metalnessFactor, mMetal);")
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `totalEmissiveRadiance *= diffuseColor.rgb * vGlow;
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.78, 0.5) * mPool * (0.6 + 0.8 * uNight);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.86) * mGloss * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0) * 0.18;`,
      );
  };
  return m;
}

// ---------------------------------------------------------------------------
// The tower

/** An open belfry stage: corner piers, an arch on every side, a balustrade in each, a dark core, floor and ceiling. */
function belfry(k: Builder, [b0, b1]: Span, half: number, pier: number, core: number, rail: number) {
  k.box(WORLD, X - core, X + core, b0, b1, Z - core, Z + core, SLOT.tar);
  k.face(WORLD, [[X - half, b0, Z - half], [X + half, b0, Z - half], [X + half, b0, Z + half], [X - half, b0, Z + half]], [0, 1, 0], SLOT.stone);
  k.face(WORLD, [[X - half, b1, Z - half], [X + half, b1, Z - half], [X + half, b1, Z + half], [X - half, b1, Z + half]], [0, -1, 0], SLOT.stucco);
  for (const { f, len } of square(half)) {
    const [a0, a1] = [pier, len - pier];
    const r = (a1 - a0) / 2;
    const spring = b1 - 0.07 - r;
    k.box(f, 0, pier, b0, b1, -pier, 0, SLOT.stucco);
    spandrels(k, f, a0, a1, spring, b1, 0, 1, SLOT.stucco, 10);
    spandrels(k, f, a0, a1, spring, b1, -pier, -1, SLOT.stucco, 10);
    intrados(k, f, a0, a1, spring, 0, -pier, SLOT.stucco, 10);
    k.box(f, a0 - 0.015, a0, spring - 0.04, spring, 0, 0.015, SLOT.trim); // imposts
    k.box(f, a1, a1 + 0.015, spring - 0.04, spring, 0, 0.015, SLOT.trim);
    // balustrade: a plinth, balusters, a rail
    const [c0, c1] = [-pier * 0.7, -0.01];
    k.box(f, a0, a1, b0, b0 + 0.05, c0, c1, SLOT.trim);
    k.box(f, a0, a1, b0 + rail - 0.04, b0 + rail, c0 - 0.01, c1 + 0.01, SLOT.trim);
    const n = Math.round((a1 - a0) / 0.12);
    for (let i = 0; i < n; i++) {
      const a = a0 + ((a1 - a0) * (i + 0.5)) / n;
      k.box(f, a - 0.016, a + 0.016, b0 + 0.05, b0 + rail - 0.04, (c0 + c1) / 2 - 0.02, (c0 + c1) / 2 + 0.02, SLOT.trim);
    }
  }
}

/** A regular polygon round the tower's axis (radius r, n sides, first corner at angle t0). */
const ring = (r: number, n: number, t0 = 0): P2[] => Array.from({ length: n }, (_, i) => [X + r * Math.cos(t0 + (i * 2 * Math.PI) / n), Z + r * Math.sin(t0 + (i * 2 * Math.PI) / n)]);

/** The clock tower over the hall's centre, in world coordinates, in the house material's attributes. */
export function towerGeometry() {
  const k = builder();
  const T = HALL.tower;
  let id = 1000;

  // the shaft: corner piers, a framed panel on each face with paired arched windows and one larger one
  const S = 0.62;
  const [s0, s1] = T.shaft;
  for (const { f, len } of square(S)) {
    const mid = len / 2;
    const wins: [number, number, number, number][] = [
      ...[4.25, 5.35].flatMap((y) => [mid - 0.15, mid + 0.15].map((a): [number, number, number, number] => [a - 0.07, a + 0.07, y, y + 0.5])),
      [mid - 0.12, mid + 0.12, 6.2, 6.75],
    ];
    k.wall(f, 0, len, s0, s1, wins, SLOT.stucco);
    for (const [a0, a1, y0, y1] of wins) arch(k, f, a0, a1, y0, y1 - (a1 - a0) / 2, { depth: 0.05, id: ++id, n: 8, reveal: SLOT.panel, ring: 0.025, sill: true }, SLOT.stucco);
    k.box(f, -0.07, 0.16, s0, 6.95, 0, 0.07, SLOT.stucco);
    k.ring2(f, [0.27, len - 0.27, 3.8, 6.88], 0.03, 0.015, SLOT.trim);
  }
  moulding(k, squareRect(S + 0.07), [[0, 3.45], [0.02, 3.45], [0.02, 3.6], [0, 3.6]], SLOT.trim);
  moulding(k, squareRect(S), [[0, 6.95], [0.09, 6.95], [0.11, 7.0], [0.14, 7.05], [0.14, s1], [0, s1]], SLOT.trim);

  // the clock stage: corner pilasters, a moulded ring round each dial, a frieze, a cornice at the tower's full width
  const C = 0.71;
  const [c0, c1] = T.clock;
  for (const { f, len } of square(C)) {
    k.wall(f, 0, len, c0, c1, [], SLOT.stucco);
    k.box(f, -0.03, 0.1, c0, c1 - 0.12, 0, 0.03, SLOT.trim);
    const n = 32;
    const inner = arc(len / 2, CLOCK.y, CLOCK.r, 0, 2 * Math.PI, n);
    const outer = arc(len / 2, CLOCK.y, CLOCK.r + 0.05, 0, 2 * Math.PI, n);
    const p = CLOCK.out - C - 0.005;
    for (let i = 0; i < n; i++) {
      const [P, Q, R, U] = [inner[i], inner[i + 1], outer[i + 1], outer[i]];
      k.face(f, [at(P, p), at(Q, p), at(R, p), at(U, p)], [0, 0, 1], SLOT.trim);
      k.face(f, [at(U, 0), at(R, 0), at(R, p), at(U, p)], [(U[0] + R[0]) / 2 - len / 2, (U[1] + R[1]) / 2 - CLOCK.y, 0], SLOT.trim);
      k.face(f, [at(P, 0), at(Q, 0), at(Q, p), at(P, p)], [len / 2 - (P[0] + Q[0]) / 2, CLOCK.y - (P[1] + Q[1]) / 2, 0], SLOT.trim);
    }
  }
  moulding(k, squareRect(C), [[0, c1 - 0.12], [0.015, c1 - 0.12], [0.015, c1 - 0.1], [0, c1 - 0.1]], SLOT.trim);
  const [b1, b2] = T.belfry;
  moulding(k, squareRect(C), [[0, c1], [0.04, c1], [0.07, c1 + 0.05], [0.1, c1 + 0.08], [0.1, b1[0]], [0, b1[0]]], SLOT.trim);

  // two open belfry stages, each with a cornice
  belfry(k, b1, 0.6, 0.2, 0.32, 0.26);
  moulding(k, squareRect(0.6), [[0, b1[1]], [0.05, b1[1]], [0.08, b1[1] + 0.05], [0.08, b2[0]], [0, b2[0]]], SLOT.trim);
  belfry(k, b2, 0.46, 0.15, 0.2, 0.2);
  moulding(k, squareRect(0.46), [[0, b2[1]], [0.04, b2[1]], [0.06, b2[1] + 0.04], [0.06, 10.38], [0, 10.38]], SLOT.trim);

  // the lantern: an octagonal drum with dark openings, a dome, a finial and the flagpole
  const [d0, d1] = T.dome;
  const oct = ring(0.3, 8, Math.PI / 8);
  k.prism(WORLD, oct.map(([x, z]) => [x, z] as P2), 10.38, d0, SLOT.stucco);
  for (let i = 0; i < 8; i++) {
    // walk the octagon clockwise (seen from above) so each face's frame looks out
    const [p, q] = [oct[(8 - i) % 8], oct[(7 - i + 8) % 8]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const f: Frame = { o: [p[0], 0, p[1]], u: [(q[0] - p[0]) / len, 0, (q[1] - p[1]) / len] };
    k.quad(f, len / 2 - 0.035, len / 2 + 0.035, 10.43, 10.56, 0.003, SLOT.tar);
  }
  k.prism(WORLD, ring(0.33, 8, Math.PI / 8), d0 - 0.02, d0 + 0.02, SLOT.trim);
  const rings = 4;
  const level = (j: number): [number, number] => [0.3 * Math.cos((j / rings) * (Math.PI / 2)), d0 + (d1 - d0) * Math.sin((j / rings) * (Math.PI / 2))];
  for (let j = 0; j < rings; j++) {
    const [[r0, y0], [r1, y1]] = [level(j), level(j + 1)];
    const lo = ring(r0, 8, Math.PI / 8);
    const hi = ring(r1, 8, Math.PI / 8);
    for (let i = 0; i < 8; i++) {
      const t = (i + 1) % 8;
      const pts: L3[] = [[lo[i][0], y0, lo[i][1]], [lo[t][0], y0, lo[t][1]], [hi[t][0], y1, hi[t][1]], [hi[i][0], y1, hi[i][1]]];
      const m = [(lo[i][0] + lo[t][0]) / 2 - X, 0.6, (lo[i][1] + lo[t][1]) / 2 - Z] as L3;
      k.face(WORLD, r1 < 1e-6 ? [pts[0], pts[1], pts[2]] : pts, m, SLOT.copper);
    }
  }
  k.prism(WORLD, ring(0.035, 8), d1 - 0.01, d1 + 0.1, SLOT.trim);
  k.prism(WORLD, ring(0.012, 4), d1 + 0.1, FERRY.tower[1], SLOT.trim);
  return withPaint(k.geometry());
}

/** The four clock dials, just proud of their rings. */
export function clockGeometry() {
  return merged(
    [0, 1, 2, 3].map((i) => {
      const a = (i * Math.PI) / 2;
      return placed(new CircleGeometry(CLOCK.r, 40), [X + Math.sin(a) * CLOCK.out, CLOCK.y, Z + Math.cos(a) * CLOCK.out], [0, a, 0]);
    }),
  );
}

/** A clock face (white dial, dark ticks and hands at ten past six). */
function clockFace() {
  return drawn(256, 256, (ctx) => {
    ctx.fillStyle = "#f6f1e4";
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a2622";
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 === 0 ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96);
      ctx.lineTo(128 + Math.sin(a) * 108, 128 - Math.cos(a) * 108);
      ctx.stroke();
    }
    const hand = (a: number, r: number, w: number) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.sin(a) * r, 128 - Math.cos(a) * r);
      ctx.stroke();
    };
    hand(Math.PI * (6 / 6 + 1 / 36), 58, 10);
    hand(Math.PI * (2 / 6), 86, 7);
  });
}

/** 18:00 Ferry Building and the California St cable car. */
export function FerryBuilding() {
  const interior = useInterior();
  // No lap siding or shingles here: the siding texture fills both slots.
  const { siding } = useLandmarkTextures();
  const m = useMemo(() => {
    const paints = palette();
    const tower = houseMaterial(siding, siding, paints);
    tower.emissive.set("#ffcf96"); // floodlights at night (useNightGlow)
    const dial = clockFace();
    const clock = new MeshStandardMaterial({ map: dial, emissive: "#fff3d6", emissiveMap: dial, emissiveIntensity: 0.05, roughness: 0.5 });
    return { hall: houseMaterial(siding, siding, paints), tower, clock, glass: glassMaterial() };
  }, [siding]);
  const g = useMemo(() => ({ ...hallParts(), tower: towerGeometry(), clocks: clockGeometry(), market: marketGeometry() }), []);
  const market = useMemo(() => marketMaterial(g.market.userData as { shadows: number[][]; lamps: number[][] }, signAtlas()), [g]);
  useNightGlow(m.tower, 0.16, 0);
  useNightGlow(m.clock, 1.8, 0.05);
  // the market has its lights on by day, and glows warm at night
  useNightGlow(market, 0.9, 0.3);
  return (
    <group>
      <mesh geometry={g.shell} material={m.hall} castShadow receiveShadow />
      {/* the marketplace: its light is baked in the material, so it casts no shadows */}
      <mesh ref={interior} geometry={g.market} material={market} receiveShadow />
      <mesh geometry={g.glass} material={m.glass} />
      <mesh geometry={g.tower} material={m.tower} castShadow receiveShadow />
      <mesh geometry={g.clocks} material={m.clock} />
      <Rails x0={6} x1={28} z={4} />
      <CableCar p={FERRY_CAR.p} />
      <Envelopes />
    </group>
  );
}

const view = new Vector3();
const ahead = new Vector3();
const right = new Vector3();

/**
 * The flight out of his raised hand (on the right of the picture: his bubble
 * hangs on the left): away from the lens and turned a little right, up first
 * and then out. Wide screens look down the street to the Ferry Building, so
 * they fly far. The phone shot looks across the street at a wall, behind the
 * cable car: a shorter, steeper flight over the car's roof.
 */
const FLIGHT = {
  wide: { turn: 0.4, reach: 15, rise: 2.4 },
  phone: { turn: 0.45, reach: 3.6, rise: 3.4 },
};
const HAND = { side: 0.62, up: 1.25 };

/**
 * Where envelope `i` is at `u` (0..1) of its flight, into `out`, for a camera
 * looking along `look`; returns its scale (it pops out of his hand, then
 * shrinks away).
 */
export function envelope(u: number, i: number, cuso: Vector3, look: Vector3, phone: boolean, out: Vector3) {
  const f = phone ? FLIGHT.phone : FLIGHT.wide;
  ahead.set(look.x, 0, look.z).normalize();
  right.set(-ahead.z, 0, ahead.x);
  const turn = f.turn + (((i * 0.37) % 1) - 0.5) * 0.12; // a little spread between them
  // out to the side at once (clear of his face and bubble), away from the lens a little later
  const away = f.reach * Math.cos(turn) * u ** 1.5;
  const aside = HAND.side + f.reach * Math.sin(turn) * u;
  const x = ahead.x * away + right.x * aside;
  const z = ahead.z * away + right.z * aside;
  const y = HAND.up + f.rise * (1 - (1 - u) ** 3) + Math.sin(u * 7 + i) * 0.06 * u;
  out.set(cuso.x + x, cuso.y + y, cuso.z + z);
  // a little smaller as they go (the phone shot has no room to send them far), then gone
  return Math.min(1, u / 0.06, (1 - u) / 0.3) * (1 - 0.4 * u);
}

/** Envelopes fly off Cuso while he delivers the newsletter. */
function Envelopes() {
  const mesh = useRef<InstancedMesh>(null);
  const COUNT = 6;
  const material = useMemo(() => {
    const map = drawn(128, 86, (ctx) => {
      ctx.fillStyle = "#fbfaf6";
      ctx.fillRect(0, 0, 128, 86);
      ctx.strokeStyle = "#c9c3b6";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(2, 2);
      ctx.lineTo(64, 48);
      ctx.lineTo(126, 2);
      ctx.stroke();
      ctx.fillStyle = "#3d5afe";
      ctx.fillRect(100, 58, 18, 20); // stamp
    });
    return new MeshStandardMaterial({ map, side: DoubleSide, roughness: 0.7 });
  }, []);
  useFrame(({ camera, clock, size }) => {
    const m = mesh.current;
    if (!m) return;
    const day = dayNow();
    const here = day.a.id === "newsletter" && day.t === 0 && day.mode === "story";
    m.visible = here;
    if (!here) return;
    const phone = isPhone(size);
    for (let i = 0; i < COUNT; i++) {
      const phase = (clock.elapsedTime * 0.2 + i / COUNT) % 1;
      const scale = envelope(phase, i, rig.cuso, camera.getWorldDirection(view), phone, placer.position);
      // face the lens, tipped along the flight, with a gentle flutter
      placer.quaternion.copy(camera.quaternion);
      placer.rotateZ(-0.3 + Math.sin(phase * 8 + i) * 0.15);
      placer.rotateY(Math.sin(phase * 5 + i * 2) * 0.4);
      placer.scale.setScalar(Math.max(0.001, scale));
      placer.updateMatrix();
      m.setMatrixAt(i, placer.matrix);
    }
    placer.scale.setScalar(1);
    placer.rotation.set(0, 0, 0);
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, material, COUNT]} castShadow frustumCulled={false}>
      <planeGeometry args={[0.36, 0.24]} />
    </instancedMesh>
  );
}
