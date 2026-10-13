"use client";

// Coit Tower on Telegraph Hill, in Pioneer Park, modelled (no painted facades).
//
// The tower: unpainted fluted concrete on a crisp stepped base course, with
// pour lifts, soft tonal patches and rain streaks running down the flutes
// under the arcade. At the top, a ledge, the open observation arcade (twenty
// arches with real depth over a parapet, a lit core inside), a cornice, the
// top stage of tall blind arched windows and a stepped cornice under the
// parapet. The flutes, arches and windows line up, twenty round.
//
// The base: a low Art Deco block with rounded corners on a podium. Tall
// windows in stepped recesses with bronze mullions and transoms; the entrance
// on the west, a deep open portal. Behind the glass and through the door,
// the WPA murals: warm painted walls, lit day and night.
//
// The plaza: the summit cut level, paved in rings of slabs, with a coursed
// stone wall down into the hill and a coped parapet with piers round the top.
// Acorn lamps (the city's, street.tsx, scaled down) and benches facing the
// view stand round the edge, off the walks.
//
// Night: the shaft is floodlit from below (fading up it), the arcade core and
// the murals glow warm, the lamps light pools on the paving.
//
// Two draw calls: everything solid in one mesh (vertex colours, a small
// shader for concrete, stone, murals and night light), and the glass.

import { useMemo } from "react";
import { BoxGeometry, BufferGeometry, Color, Float32BufferAttribute, MeshStandardMaterial, Vector2 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { glassMaterial } from "./materials";
import { heightAt } from "@/lib/terrain";
import { facadeNight } from "./facade";
import { builder, sides, type Builder, type Frame, type L3, type P2, type Rect } from "./house-models";
import { placed } from "./landmark-kit";
import { STREET_PARTS } from "./street";

/**
 * Sizes, y above the plaza. The plaza is level with the highest ground under
 * it, so the hill never pokes through; its wall reaches `footing` below the
 * lowest ground, so it never floats on the downhill side, and leans out by
 * `batter` at its foot.
 */
export const COIT = {
  x: 2,
  z: -26,
  plaza: 1.5,
  batter: 0.04,
  footing: 0.4,
  parapet: { h: 0.15, t: 0.08 },
  /** The base: square `w` with rounded corners, on a podium; walls to the cornice, roof inside the parapet, parapet top `h`. */
  lobby: { w: 1.3, corner: 0.16, podium: 0.05, wall: 0.49, roof: 0.56, h: 0.62 },
  shaft: { r: 0.48, bottom: 0.6, top: 4.98, flutes: 20, depth: 0.035 },
  /** The open observation arcade, then the top stage of blind windows. */
  deck: { r: 0.5, bottom: 5.04, top: 5.56 },
  crown: { r: 0.53, bottom: 5.62, top: 5.86 },
  top: 6.06,
};

/** Plaza top and wall bottom, from the ground under the plaza (sampled on rings). */
export function coitSeat() {
  let hi = -Infinity;
  let lo = Infinity;
  for (let r = 0; r <= COIT.plaza + 1e-9; r += COIT.plaza / 10) {
    for (let a = 0; a < 48; a++) {
      const h = heightAt(COIT.x + r * Math.cos((a / 48) * Math.PI * 2), COIT.z + r * Math.sin((a / 48) * Math.PI * 2));
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  }
  return { top: hi + 0.03, bottom: lo - COIT.footing };
}

// Plaza furniture, local to the plaza centre (x east, z south). Angles are atan2(z, x).
const polar = (deg: number, r: number): [number, number] => [r * Math.cos((deg * Math.PI) / 180), r * Math.sin((deg * Math.PI) / 180)];
/** Acorn lamps round the parapet, and benches facing the view. */
export const LAMPS = [30, 90, 150, -150, -90, -30].map((a) => polar(a, 1.34));
export const BENCHES = [0, 60, 120, -120, -60].map((a) => polar(a, 1.26));
const LAMP_SCALE = 0.12;
/** The walks: out of the west door, and round the base. */
export const WALKS: [number, number][][] = [
  [[-COIT.lobby.w / 2 - COIT.lobby.podium, 0], [-1.0, 0]],
  Array.from({ length: 49 }, (_, i) => polar((i / 48) * 360, 0.98)),
];

/** What the shader does with a face: concrete, stone (paving on top, courses on the sides), murals, a lit room, plain paint, a lamp globe. */
export const KIND = { concrete: 0, stone: 1, mural: 2, room: 3, plain: 4, glow: 5 } as const;

const PAINTS = {
  concrete: [KIND.concrete, "#e7e0d2"],
  roof: [KIND.plain, "#b4ac9f"],
  wall: [KIND.stone, "#c6bcaa"],
  coping: [KIND.stone, "#ddd5c7"],
  paving: [KIND.stone, "#cec7b9"],
  mural: [KIND.mural, "#ffffff"],
  room: [KIND.room, "#f0dab8"],
  floor: [KIND.room, "#9a7f68"],
  dark: [KIND.plain, "#36322d"],
  bronze: [KIND.plain, "#6a6048"],
  iron: [KIND.plain, "#26302c"],
  granite: [KIND.plain, "#aaa59c"],
  wood: [KIND.plain, "#8a6a4a"],
  frame: [KIND.plain, "#3d372f"],
  glow: [KIND.glow, "#efe9dc"],
} as const;
type Paint = keyof typeof PAINTS;
const NAMES = Object.keys(PAINTS) as Paint[];
/** Paint ids, used as the builder's slot numbers. */
const P = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<Paint, number>;

/** A plain copy with only what the material reads: position, normal, colour and kind (per vertex, from its paint). */
function painted(g: BufferGeometry, paintOf: (i: number) => number) {
  const flat = g.index ? g.toNonIndexed() : g;
  const n = flat.attributes.position.count;
  const color = new Float32Array(n * 3);
  const kind = new Float32Array(n);
  const c = new Color();
  for (let i = 0; i < n; i++) {
    const [k, hex] = PAINTS[NAMES[paintOf(i)]];
    c.set(hex).toArray(color, i * 3);
    kind[i] = k;
  }
  const out = new BufferGeometry();
  out.setAttribute("position", flat.attributes.position);
  out.setAttribute("normal", flat.attributes.normal);
  out.setAttribute("color", new Float32BufferAttribute(color, 3));
  out.setAttribute("aKind", new Float32BufferAttribute(kind, 1));
  return out;
}
const tag = (g: BufferGeometry, paint: Paint) => painted(g, () => P[paint]);
const fromBuilder = (k: Builder) => {
  const g = k.geometry().toNonIndexed();
  return painted(g, (i) => g.attributes.aSlot.getX(i));
};

// ---------- Modelling helpers (world axes as a builder frame: (a, b, c) is (x, y, z)) ----------

const W0: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
type Outline = (grow: number) => P2[];

const circle = (r: number, n: number): Outline => (c) => Array.from({ length: n }, (_, i) => [(r + c) * Math.cos((i / n) * Math.PI * 2), (r + c) * Math.sin((i / n) * Math.PI * 2)]);
/** A square of half side `half` with corners rounded to `rc` (`seg` steps each), grown by c. */
const rounded = (half: number, rc: number, seg: number): Outline => (c) =>
  [[1, 1], [-1, 1], [-1, -1], [1, -1]].flatMap(([sx, sz], q) =>
    Array.from({ length: seg + 1 }, (_, i): P2 => {
      const a = ((q + i / seg) * Math.PI) / 2;
      return [sx * (half - rc) + (rc + c) * Math.cos(a), sz * (half - rc) + (rc + c) * Math.sin(a)];
    }),
  );

/**
 * A profile run round a closed outline (like `moulding` in house-models.ts):
 * `profile` is (out, y) points, up the wall and back over the top; each
 * segment faces away from the profile's inside. `keep` picks outline edges.
 */
function turn(k: Builder, outline: Outline, profile: P2[], paint: number, keep?: (i: number) => boolean) {
  for (let s = 0; s < profile.length - 1; s++) {
    const [[c0, y0], [c1, y1]] = [profile[s], profile[s + 1]];
    const [p, q] = [outline(c0), outline(c1)];
    for (let i = 0; i < p.length; i++) {
      if (keep && !keep(i)) continue;
      const j = (i + 1) % p.length;
      let [nx, nz] = [p[j][1] - p[i][1], p[i][0] - p[j][0]];
      if (nx * (p[i][0] + p[j][0]) + nz * (p[i][1] + p[j][1]) < 0) [nx, nz] = [-nx, -nz];
      const len = Math.hypot(nx, nz) || 1;
      const out: L3 = [(nx / len) * (y1 - y0), c0 - c1, (nz / len) * (y1 - y0)];
      k.face(W0, [[p[i][0], y0, p[i][1]], [p[j][0], y0, p[j][1]], [q[j][0], y1, q[j][1]], [q[i][0], y1, q[i][1]]], out, paint);
    }
  }
}
/** A flat cap over an outline, facing up (or down). */
const cap = (k: Builder, pts: P2[], y: number, paint: number, up = true) => k.face(W0, pts.map(([x, z]): L3 => [x, y, z]), [0, up ? 1 : -1, 0], paint);

/** Points on a half circle over (mid, spring), from angle t0 to t1. */
const arc = (mid: number, spring: number, r: number, t0: number, t1: number, n: number): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / n;
    return [mid + Math.cos(t) * r, spring + Math.sin(t) * r];
  });

type Arch = { w: number; sill: number; spring: number };

/**
 * One flat bay of a round arcade, in a frame along it (a 0..L, b up, c out):
 * the wall with an arched opening in the middle, its reveal `t` deep, then the
 * inner face (an open arcade, `inner` in from each end) or a closed back.
 */
function archedBay(k: Builder, f: Frame, L: number, y0: number, y1: number, o: Arch, t: number, inner: number | null, wall: number, back: number) {
  const [a0, a1, r] = [(L - o.w) / 2, (L + o.w) / 2, o.w / 2];
  const crown = o.spring + r;
  const pts = arc(L / 2, o.spring, r, Math.PI, 0, 8);
  const at = (c: number) => (p: P2): L3 => [p[0], p[1], c];
  const face = (c: number, e: number, facing: number) => {
    k.quad(f, e, a0, y0, y1, c, wall, 0, facing);
    k.quad(f, a1, L - e, y0, y1, c, wall, 0, facing);
    k.quad(f, a0, a1, y0, o.sill, c, wall, 0, facing);
    if (y1 > crown + 1e-6) k.quad(f, a0, a1, crown, y1, c, wall, 0, facing);
    k.face(f, [[a0, crown, c], ...pts.slice(0, 5).map(at(c))], [0, 0, facing], wall);
    k.face(f, [[a1, crown, c], ...pts.slice(4).map(at(c))], [0, 0, facing], wall);
  };
  face(0, 0, 1);
  // the reveal: jambs, sill and the arch's soffit
  k.face(f, [[a0, o.sill, 0], [a0, o.spring, 0], [a0, o.spring, -t], [a0, o.sill, -t]], [1, 0, 0], wall);
  k.face(f, [[a1, o.sill, 0], [a1, o.spring, 0], [a1, o.spring, -t], [a1, o.sill, -t]], [-1, 0, 0], wall);
  k.face(f, [[a0, o.sill, 0], [a1, o.sill, 0], [a1, o.sill, -t], [a0, o.sill, -t]], [0, 1, 0], wall);
  for (let j = 0; j < pts.length - 1; j++) {
    const [p, q] = [pts[j], pts[j + 1]];
    k.face(f, [at(0)(p), at(0)(q), at(-t)(q), at(-t)(p)], [L / 2 - (p[0] + q[0]) / 2, o.spring - (p[1] + q[1]) / 2, 0], wall);
  }
  if (inner === null) k.quad(f, a0, a1, o.sill, crown, -t, back);
  else face(-t, inner, -1);
}

/** A ring of `n` flat bays round the axis (apothem `r`), each with an arch centred on a flute. */
function arcade(k: Builder, n: number, r: number, y0: number, y1: number, o: Arch, t: number, open: boolean, wall: number, back: number) {
  const rv = r / Math.cos(Math.PI / n);
  const L = 2 * r * Math.tan(Math.PI / n);
  const inner = open ? (L * t) / r / 2 : null;
  for (let i = 0; i < n; i++) {
    const [ta, tb] = [(i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2];
    // from vertex b back to vertex a, the frame's out (-u.z, u.x) points away from the axis
    const B: L3 = [rv * Math.cos(tb), 0, rv * Math.sin(tb)];
    const u: L3 = [(rv * Math.cos(ta) - B[0]) / L, 0, (rv * Math.sin(ta) - B[2]) / L];
    archedBay(k, { o: B, u }, L, y0, y1, o, t, inner, wall, back);
  }
}

/** A small room behind an opening, from c0 back to c1: jambs, ceiling, floor and the back wall. */
function room(k: Builder, f: Frame, [a0, a1, b0, b1]: Rect, c0: number, c1: number, wall: number, floor: number) {
  k.face(f, [[a0, b0, c0], [a0, b1, c0], [a0, b1, c1], [a0, b0, c1]], [1, 0, 0], wall);
  k.face(f, [[a1, b0, c0], [a1, b1, c0], [a1, b1, c1], [a1, b0, c1]], [-1, 0, 0], wall);
  k.face(f, [[a0, b1, c0], [a1, b1, c0], [a1, b1, c1], [a0, b1, c1]], [0, -1, 0], wall);
  k.face(f, [[a0, b0, c0], [a1, b0, c0], [a1, b0, c1], [a0, b0, c1]], [0, 1, 0], floor);
  k.quad(f, a0, a1, b0, b1, c1, wall);
}

// ---------- The tower ----------

/** The fluted shaft: twenty shallow channels between sharp ridges (a ridge at every 1/20 turn). */
function shaft(k: Builder) {
  const { r, bottom, top, flutes, depth } = COIT.shaft;
  const n = flutes * 4;
  const pts = Array.from({ length: n }, (_, j): P2 => {
    const a = (j / n) * Math.PI * 2;
    const rr = [r, r - depth * 0.7, r - depth, r - depth * 0.7][j % 4];
    return [rr * Math.cos(a), rr * Math.sin(a)];
  });
  for (let j = 0; j < n; j++) {
    const [p, q] = [pts[j], pts[(j + 1) % n]];
    k.face(W0, [[p[0], bottom, p[1]], [q[0], bottom, q[1]], [q[0], top, q[1]], [p[0], top, p[1]]], [p[0] + q[0], 0, p[1] + q[1]], P.concrete);
  }
}

function tower(k: Builder) {
  const { shaft: s, deck, crown, lobby } = COIT;
  const round = (r: number) => circle(r, 40);
  // base course on the lobby roof: two crisp steps and a chamfer up to the flutes
  turn(k, round(s.r), [[0.12, lobby.roof], [0.12, 0.6], [0.08, 0.6], [0.08, 0.645], [0.04, 0.665], [0, 0.665]], P.concrete);
  shaft(k);
  // a ledge under the arcade
  turn(k, round(s.r), [[0, s.top - 0.04], [0.05, s.top - 0.01], [0.07, s.top + 0.01], [0.07, deck.bottom], [deck.r - s.r, deck.bottom]], P.concrete);
  // the observation arcade: open arches over a parapet, a lit core, floor and ceiling
  const t = 0.06;
  arcade(k, s.flutes, deck.r, deck.bottom, deck.top, { w: 0.1, sill: deck.bottom + 0.09, spring: deck.bottom + 0.4 }, t, true, P.concrete, P.room);
  const innerV = (deck.r - t) / Math.cos(Math.PI / s.flutes);
  cap(k, circle(innerV, s.flutes)(0), deck.bottom + 0.001, P.floor);
  cap(k, circle(innerV, s.flutes)(0), deck.top - 0.001, P.room, false);
  turn(k, circle(0.24, s.flutes), [[0, deck.bottom], [0, deck.top]], P.room);
  // cornice, then the top stage with its tall blind arched windows
  turn(k, round(deck.r), [[0, deck.top], [0.03, deck.top + 0.015], [0.045, deck.top + 0.03], [0.045, crown.bottom], [crown.r - deck.r, crown.bottom]], P.concrete);
  arcade(k, s.flutes, crown.r, crown.bottom, crown.top, { w: 0.05, sill: crown.bottom + 0.035, spring: crown.bottom + 0.165 }, 0.03, false, P.concrete, P.dark);
  // the stepped cornice and the parapet round the roof
  const y = crown.top;
  turn(k, round(crown.r), [[0, y], [0.015, y], [0.015, y + 0.025], [0.03, y + 0.025], [0.03, y + 0.05], [0.05, y + 0.05], [0.05, y + 0.09], [0.03, y + 0.09], [0.03, COIT.top - 0.02], [0.04, COIT.top - 0.02], [0.04, COIT.top], [-0.03, COIT.top], [-0.03, y + 0.13]], P.concrete);
  cap(k, round(crown.r - 0.03)(0), y + 0.13, P.roof);
}

// ---------- The base ----------

/** A tall window in a stepped recess: bronze mullion and transom on the glass, the painted room behind. Returns the hole. */
function window(k: Builder, g: Builder, f: Frame, a: number): Rect {
  const [w, b0, b1, step] = [0.11, 0.12, 0.43, 0.022];
  const inner: Rect = [a - w / 2, a + w / 2, b0, b1];
  const outer: Rect = [inner[0] - step, inner[1] + step, b0 - step, b1 + step];
  k.reveal(f, outer, 0, -0.012, P.concrete);
  k.ring2(f, inner, step, -0.012, P.concrete);
  k.reveal(f, inner, -0.012, -0.045, P.concrete);
  g.quad(f, ...inner, -0.045, 0);
  k.box(f, a - 0.006, a + 0.006, b0, b1, -0.045, -0.038, P.frame);
  const tb = b0 + (b1 - b0) * 0.72;
  k.box(f, inner[0], inner[1], tb - 0.006, tb + 0.006, -0.045, -0.038, P.frame);
  room(k, f, inner, -0.045, -0.16, P.mural, P.mural);
  k.box(f, outer[0] - 0.01, outer[1] + 0.01, outer[2] - 0.018, outer[2], 0, 0.02, P.concrete);
  return outer;
}

/** The west entrance: a stepped portal, open into a painted vestibule, a glazed transom. Returns the hole. */
function door(k: Builder, g: Builder, f: Frame, a: number): Rect {
  const floor = 0.03;
  const open: Rect = [a - 0.12, a + 0.12, floor, 0.43];
  const outer: Rect = [a - 0.15, a + 0.15, floor, 0.46];
  k.reveal(f, outer, 0, -0.015, P.concrete);
  k.ring2(f, open, 0.03, -0.015, P.concrete);
  room(k, f, open, -0.015, -0.32, P.mural, P.floor);
  g.quad(f, open[0], open[1], 0.35, 0.43, -0.03, 0);
  k.box(f, open[0], open[1], 0.34, 0.35, -0.035, -0.025, P.frame);
  // a plain panel over the portal, under the cornice
  k.box(f, a - 0.09, a + 0.09, 0.466, 0.484, 0, 0.006, P.concrete);
  return outer;
}

function base(k: Builder, g: Builder) {
  const { w, corner: rc, podium, wall, roof, h } = COIT.lobby;
  const half = w / 2;
  const outline = rounded(half, rc, 4);
  const cornerEdge = (i: number) => i % 5 !== 4;
  turn(k, outline, [[podium, -0.02], [podium, 0.03], [0, 0.03]], P.coping);
  turn(k, outline, [[0, 0.03], [0, wall]], P.concrete, cornerEdge);
  for (const { f, len, name } of sides({ x0: -half, x1: half, z0: -half, z1: half })) {
    const mid = len / 2;
    const holes = (name === "west" ? [-0.36, 0.36] : [-0.36, 0, 0.36]).map((d) => window(k, g, f, mid + d));
    if (name === "west") holes.push(door(k, g, f, mid));
    k.wall(f, rc, len - rc, 0.03, wall, holes, P.concrete);
  }
  // cornice, parapet and the roof inside it
  turn(k, outline, [[0, wall], [0.02, wall], [0.02, wall + 0.04], [0.006, wall + 0.04], [0.006, h - 0.02], [0.016, h - 0.02], [0.016, h], [-0.05, h], [-0.05, roof]], P.concrete);
  cap(k, outline(-0.05), roof, P.roof);
}

// ---------- The plaza ----------

function plaza(k: Builder, wallH: number) {
  const { plaza: r, batter, parapet } = COIT;
  const edge = circle(r, 72);
  turn(k, edge, [[batter, -wallH], [0, -0.06]], P.wall);
  turn(k, edge, [[0, -0.06], [0.015, -0.05], [0.015, -0.01], [0, 0], [0, parapet.h - 0.03], [0.012, parapet.h - 0.03], [0.012, parapet.h], [-parapet.t - 0.012, parapet.h], [-parapet.t - 0.012, parapet.h - 0.03], [-parapet.t, parapet.h - 0.03], [-parapet.t, 0]], P.coping);
  cap(k, edge(-parapet.t), 0, P.paving);
}

/** Piers on the parapet, lamps and benches: three.js parts, painted. */
function furniture() {
  const out: BufferGeometry[] = [];
  const mid = COIT.plaza - COIT.parapet.t / 2;
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    const [x, z] = [mid * Math.cos(a), mid * Math.sin(a)];
    out.push(tag(placed(new BoxGeometry(0.11, 0.2, 0.08), [x, 0.1, z], [0, -a, 0]), "coping"));
    out.push(tag(placed(new BoxGeometry(0.13, 0.025, 0.1), [x, 0.2125, z], [0, -a, 0]), "coping"));
  }
  // the city's acorn lamps, scaled to the tower
  for (const [x, z] of LAMPS) {
    out.push(tag(STREET_PARTS.lampIron.clone().scale(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE).translate(x, 0, z), "iron"));
    out.push(tag(STREET_PARTS.lampGlass.clone().scale(LAMP_SCALE, LAMP_SCALE, LAMP_SCALE).translate(x, 0, z), "glow"));
  }
  // benches facing out over the parapet (the sitter looks along +x before turning)
  for (const [x, z] of BENCHES) {
    const turnY = -Math.atan2(z, x);
    const part = (g: BufferGeometry, p: L3, paint: Paint) => out.push(tag(placed(placed(g, p), [x, 0, z], [0, turnY, 0]), paint));
    part(new BoxGeometry(0.06, 0.012, 0.2), [0, 0.045, 0], "wood");
    part(new BoxGeometry(0.012, 0.05, 0.2), [-0.032, 0.085, 0], "wood");
    for (const s of [-1, 1]) part(new BoxGeometry(0.05, 0.04, 0.012), [0, 0.02, s * 0.085], "iron");
  }
  return out;
}

/** The whole model, local to the plaza centre at plaza level: the solid parts (one mesh) and the glass. */
export function coitParts() {
  const seat = coitSeat();
  const k = builder();
  const g = builder();
  tower(k);
  base(k, g);
  plaza(k, seat.top - seat.bottom);
  const solid = mergeGeometries([fromBuilder(k), ...furniture()]);
  return { solid, glass: g.geometry() };
}

// ---------- The material ----------

const FRAG_HEAD = /* glsl */ `
  uniform float uNight;
  uniform vec2 uLamps[${LAMPS.length}];
  flat varying float vKind;
  varying vec3 vLoc;
  varying vec3 vNrm;
  vec3 cGlow = vec3(0.0);
  float cRough = 0.9;
  float cHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), f.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + 1.0), f.x), f.y);
  }`;

const FRAG_COLOR = /* glsl */ `
  int cKind = int(vKind + 0.5);
  vec3 cN = normalize(vNrm);
  float cY = vLoc.y;
  float cR = length(vLoc.xz);
  float cT = atan(vLoc.z, vLoc.x) / 6.2831853; // turns round the axis, -0.5..0.5
  vec3 cC = diffuseColor.rgb;
  vec3 cFlood = vec3(1.0, 0.9, 0.74);
  if (cKind == ${KIND.concrete}) {
    // unpainted concrete: soft patches (seamless all round), a fine grain
    float tone = 0.94 + 0.05 * (cNoise(vec2(vLoc.x, cY * 0.4) * 6.0) + cNoise(vec2(vLoc.z, cY * 0.4) * 6.0 + 9.0)) + 0.03 * cNoise(vec2(vLoc.x + vLoc.z, cY) * 30.0);
    bool cShaft = cR < 0.56 && cY > ${COIT.lobby.h + 0.04} && cY < ${COIT.shaft.top};
    if (cShaft) {
      // pour lifts, gone once they are thinner than a pixel
      float fw = fwidth(cY);
      float d = (0.5 - abs(fract(cY / 0.4) - 0.5)) * 0.4;
      tone -= 0.035 * (1.0 - smoothstep(0.0, 0.004 + fw, d)) * (1.0 - smoothstep(0.004, 0.02, fw));
      // rain streaks down the flutes from the ledge: three lanes a flute, some long, some short, many none
      float t = cT * ${COIT.shaft.flutes}.0 + ${COIT.shaft.flutes / 2}.0;
      float lane = floor(t) * 3.0 + floor(fract(t) * 3.0);
      float h = cHash(vec2(lane, 3.7));
      float x = fract(fract(t) * 3.0);
      float across = smoothstep(0.1, 0.5, x) * smoothstep(0.9, 0.5, x);
      float len = 0.4 + 2.8 * h * h;
      float streak = across * smoothstep(${COIT.shaft.top} - len, ${COIT.shaft.top}, cY) * step(0.3, h) * (0.55 + 0.45 * cNoise(vec2(lane * 5.0, cY * 7.0)));
      tone -= 0.22 * streak + 0.06 * smoothstep(4.5, ${COIT.shaft.top}, cY);
      // a little darker at the foot
      tone -= 0.04 * (1.0 - smoothstep(${COIT.lobby.h}, 1.2, cY));
    }
    if (cY < ${COIT.lobby.h}) tone -= 0.05 * (1.0 - smoothstep(0.03, 0.12, cY));
    cC *= tone;
    // floodlit from the plaza: brightest low on the shaft, fading up it; the base only catches the spill
    float flood = cY > ${COIT.lobby.h - 0.02} ? 0.1 + 0.42 * exp(-(cY - 0.6) * 0.5) : 0.07;
    cGlow = cC * cFlood * flood * uNight * (cN.y < -0.3 ? 0.35 : 1.0);
  } else if (cKind == ${KIND.stone}) {
    vec2 cell;
    float joint;
    float fw;
    if (cN.y > 0.7) {
      // paving: rings of slabs round the tower, in running bond
      float w = 0.12;
      float ring = floor(cR / w);
      float n = max(8.0, floor(6.2831853 * (ring + 0.5) * w / 0.17));
      float ta = cT * n + 0.5 * mod(ring, 2.0);
      cell = vec2(ring, floor(ta));
      joint = min((0.5 - abs(fract(cR / w) - 0.5)) * w, (0.5 - abs(fract(ta) - 0.5)) * 6.2831853 * cR / n);
      fw = fwidth(cR);
    } else {
      // coursed stone: 36 blocks round, courses 0.1 high
      float course = floor(cY / 0.1);
      float ta = cT * 36.0 + 0.5 * mod(course, 2.0);
      cell = vec2(course, floor(ta));
      joint = min((0.5 - abs(fract(cY / 0.1) - 0.5)) * 0.1, (0.5 - abs(fract(ta) - 0.5)) * 6.2831853 * cR / 36.0);
      fw = fwidth(cY);
    }
    float line = 1.0 - smoothstep(0.003, 0.003 + fw * 1.5, joint);
    cC *= (0.94 + 0.1 * cHash(cell)) * (1.0 - 0.28 * line * (1.0 - smoothstep(0.006, 0.02, fw)));
    cC *= 0.97 + 0.06 * cNoise(vLoc.xz * 9.0 + cY * 3.0);
    cRough = 0.93;
    if (cN.y > 0.7) {
      // pools of lamplight on the paving
      float pool = 0.0;
      for (int i = 0; i < ${LAMPS.length}; i++) {
        vec2 d = vLoc.xz - uLamps[i];
        pool += exp(-dot(d, d) / 0.03);
      }
      cGlow = cC * vec3(1.0, 0.78, 0.5) * pool * 0.55 * uNight;
    }
  } else if (cKind == ${KIND.mural}) {
    // the WPA murals: a row of working people before fields and hills under a pale sky, over a dark dado
    float along = dot(vLoc.xz, normalize(vec2(-cN.z, cN.x) + vec2(1e-5, 0.0)));
    vec3 paint = mix(vec3(0.5, 0.32, 0.18), vec3(0.56, 0.5, 0.3), smoothstep(0.17, 0.2, cY + 0.02 * cNoise(vec2(along * 30.0, 1.0))));
    paint = mix(paint, vec3(0.74, 0.68, 0.52), smoothstep(0.3, 0.33, cY + 0.03 * cNoise(vec2(along * 18.0, 4.0))));
    // people of all heights standing about: a body, a head, in work clothes
    vec2 fig = vec2(along * 20.0, (cY - 0.1) * 7.0);
    float id = floor(fig.x);
    float hh = cHash(vec2(id, 1.3));
    float fx = abs(fract(fig.x) - 0.5);
    float fy = fig.y - 0.4 * cHash(vec2(id, 2.9));
    float tall = 0.6 + 0.5 * hh;
    float present = step(0.3, hh);
    float body = step(fx, 0.12 + 0.12 * cHash(vec2(id, 5.3)) - 0.08 * fy / tall) * step(0.0, fy) * step(fy, tall) * present;
    float head = step(length(vec2(fx, (fy - tall - 0.13) * 0.5)), 0.08) * present;
    vec3 cloth = mix(mix(vec3(0.27, 0.3, 0.36), vec3(0.52, 0.24, 0.14), step(0.4, cHash(vec2(id, 7.1)))), vec3(0.36, 0.38, 0.22), step(0.75, cHash(vec2(id, 8.3))));
    paint = mix(paint, cloth, body);
    paint = mix(paint, vec3(0.62, 0.42, 0.3), head);
    paint = mix(paint, vec3(0.3, 0.17, 0.12), 1.0 - smoothstep(0.08, 0.1, cY));
    cC *= paint;
    // lit inside all day, warm at night
    cGlow = cC * (0.35 + 1.1 * uNight);
    cC *= 0.45;
  } else if (cKind == ${KIND.room}) {
    cGlow = cC * vec3(1.0, 0.86, 0.66) * (0.03 + 0.95 * uNight);
    cC *= 0.3;
  } else if (cKind == ${KIND.plain}) {
    cRough = 0.7;
  } else {
    cGlow = vec3(1.0, 0.82, 0.54) * 3.0 * uNight;
    cRough = 0.35;
  }
  diffuseColor.rgb = cC;`;

/** Vertex colours plus the shader above. Night comes from facadeNight, like the city's windows. */
function coitMaterial() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  m.customProgramCacheKey = () => "coit";
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uNight: facadeNight, uLamps: { value: LAMPS.map(([x, z]) => new Vector2(x, z)) } });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aKind;\nflat varying float vKind;\nvarying vec3 vLoc;\nvarying vec3 vNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvKind = aKind;\nvLoc = transformed;\nvNrm = objectNormal;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAG_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = cRough;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += cGlow;");
  };
  return m;
}

const seat = coitSeat();

export function CoitTower() {
  const parts = useMemo(() => coitParts(), []);
  const m = useMemo(() => ({ solid: coitMaterial(), glass: glassMaterial() }), []);
  return (
    <group position={[COIT.x, seat.top, COIT.z]}>
      <mesh geometry={parts.solid} material={m.solid} castShadow receiveShadow />
      <mesh geometry={parts.glass} material={m.glass} />
    </group>
  );
}
