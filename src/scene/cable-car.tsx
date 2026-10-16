"use client";

// San Francisco cable cars and their rails. They carry the visitor's brand on
// the long route board under the windows.
//
// A double-ended California St car at miniature scale: an enclosed cabin in
// the middle, open grip sections with slatted benches back to back and
// running boards at both ends, curved dashes, a clerestory roof that dips over
// the end platforms, a brass headlamp and bell at each end. Varnished teak
// (posts, sashes, benches, floors, ceiling; wood.ts grain per board), maroon
// and cream satin paint, brass. Edges are cut (chamferBox), contact shadow is
// baked per vertex (ao.ts), the windows are clear shop glass. All static
// parts are merged into one geometry per material (9 draw calls per car).

import { useContext, useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, MeshStandardMaterial, PlaneGeometry, Shape, Vector2, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { surfaceAt } from "@/lib/terrain";
import { vertexAO, type Box } from "./ao";
import { glassMaterial } from "./materials";
import { useBrand, useGlow, type V3 } from "./parts";
import { Lite, detail, useNightGlow } from "./shared";
import { useSign } from "./textures";
import { GAUGE } from "./grid";
import { WOOD_LOOKS, chamferBox, tagBoard, woodBoard, woodMaterial, type WoodLook } from "./wood";

export { GAUGE };

// Car layout in local units: x along the rails, y up, z across. The car's
// origin is on the street between the rails.
const W = 0.8; // body half-width
const BODY = 2; // half-length of the body (cabin plus open sections)
const CAB = 0.95; // cabin half-length
const DASH = 2.3; // the curved dash at each end, at the centre line
const DASH_R = 1.7; // dash curve radius
const FLOOR = 0.4; // underside of the body
const SEAT = 0.92; // top of the lower body: the floor of the cabin and open sections
const WIN = 1.0; // window sill
const BOARD = 1.62; // letterboard (cream band under the roof)
/** The brand's route board on each side, [width, height]. */
export const ROUTE_BOARD = [2.5, 0.24] as const;
const EAVE = 1.84; // underside of the roof
const ROOF = 2.42; // roof half-length (overhangs the dash)
const ROOF_W = 0.93; // roof half-width (overhangs the sides)
const STEP = 0.34; // running board top
const STEP_OUT = 1.02; // running board outer edge
const DECK = SEAT + 0.014; // top of the floor boards
const BENCH = DECK + 0.1; // top of the bench seats

/** Size of the car, for placement. `step` is a spot on the running board (+x end, +z side). */
export const CAR = {
  length: ROOF * 2,
  width: STEP_OUT * 2,
  height: EAVE + 0.3,
  step: [1.6, STEP, 1.0] as V3,
  /** Solid parts as half-sizes (collision test): body to the eaves, roof with its fascia, running boards. */
  body: { x: DASH, z: W, bottom: FLOOR, top: EAVE },
  roof: { x: ROOF, z: ROOF_W + 0.03 },
  board: { x0: 1.05, x1: 2.05, z: STEP_OUT, top: STEP },
};

/** The roof dips a little over the end platforms, like a hood. */
const hood = (x: number) => 0.35 * Math.max(0, Math.abs(x) - 1.9) ** 2;

// --- geometry helpers ----------------------------------------------------

const at = <G extends BufferGeometry>(g: G, x: number, y: number, z: number) => g.translate(x, y, z);
const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, segX = 1) => at(new BoxGeometry(sx, sy, sz, segX), x, y, z);
const rbox = (sx: number, sy: number, sz: number, x: number, y: number, z: number, r = 0.025) => at(new RoundedBoxGeometry(sx, sy, sz, 2, r), x, y, z);
/** A vertical rod from y0 to y1. */
const rod = (r: number, x: number, y0: number, y1: number, z: number, seg = 8) => at(new CylinderGeometry(r, r, y1 - y0, seg), x, (y0 + y1) / 2, z);
/** A plane facing +z (side = 1) or -z (side = -1). */
const sidePlane = (w: number, h: number, x: number, y: number, side: number, z: number) => at(new PlaneGeometry(w, h).rotateY(side > 0 ? 0 : Math.PI), x, y, side * z);
/** A plane facing +x (end = 1) or -x (end = -1). */
const endPlane = (w: number, h: number, end: number, x: number, y: number) => at(new PlaneGeometry(w, h).rotateY((end * Math.PI) / 2), end * x, y, 0);

/** A shape drawn in the x-z plane, extruded down from yTop by `depth`. */
function slab(shape: Shape, yTop: number, depth: number, end = 1) {
  const g = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 16 }).rotateX(Math.PI / 2);
  if (end < 0) g.rotateY(Math.PI);
  return g.translate(0, yTop, 0);
}

/** A band following the dash curve between radii rIn and rOut (centre at DASH - DASH_R). */
function dashRing(rIn: number, rOut: number) {
  const cx = DASH - DASH_R;
  const aOut = Math.asin(W / rOut);
  const aIn = Math.asin(W / rIn);
  const s = new Shape();
  s.moveTo(cx + rOut * Math.cos(-aOut), rOut * Math.sin(-aOut));
  s.absarc(cx, 0, rOut, -aOut, aOut, false);
  s.lineTo(cx + rIn * Math.cos(aIn), rIn * Math.sin(aIn));
  s.absarc(cx, 0, rIn, aIn, -aIn, true);
  s.closePath();
  return s;
}

/** The end platform floor: from the body end out to the dash curve. */
function platformShape() {
  const cx = DASH - DASH_R;
  const a = Math.asin(W / DASH_R);
  const s = new Shape();
  s.moveTo(BODY, -W);
  s.lineTo(cx + DASH_R * Math.cos(-a), -W);
  s.absarc(cx, 0, DASH_R - 0.01, -a, a, false);
  s.lineTo(BODY, W);
  s.closePath();
  return s;
}

/** Arched cross-section (z, y), extruded along x and dipped at the ends. */
function archedRoof(halfW: number, thick: number, rise: number, halfLen: number, bevel: number) {
  const s = new Shape();
  s.moveTo(-halfW, 0);
  s.lineTo(halfW, 0);
  s.lineTo(halfW, thick);
  s.quadraticCurveTo(0, thick + rise * 2, -halfW, thick);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: halfLen * 2, steps: 24, curveSegments: 12, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2 });
  return g.rotateY(Math.PI / 2).translate(-halfLen, 0, 0);
}

/** Dip every vertex by the hood curve. */
function bend(g: BufferGeometry) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) - hood(p.getX(i)));
  return g;
}

const merge = (parts: BufferGeometry[]) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  return g;
};

/** Darkens the vertex colours by the light each vertex gets (AO), never below `floor`. */
function shade(g: BufferGeometry, blockers: Box[], floor = 0.3) {
  const ao = vertexAO(g.attributes.position.array, g.attributes.normal.array, blockers, 16, 0.4);
  const c = g.attributes.color;
  for (let i = 0; i < c.count; i++) {
    const k = floor + (1 - floor) * ao[i];
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return g;
}

const ENDS = [-1, 1];
const SIDES = [-1, 1];

const SOLID = ["maroon", "cream", "gold", "dark", "wood", "roof"] as const;
type Solid = (typeof SOLID)[number];
export type CarParts = Record<Solid | "glass" | "lamp" | "board", BufferGeometry>;

/** All the car's static geometry, one merged geometry per material. Solid parts carry `aWood` and AO-shaded vertex colours. */
export function carGeometry(): CarParts {
  const solid: Record<Solid, BufferGeometry[]> = { maroon: [], cream: [], gold: [], dark: [], wood: [], roof: [] };
  const glass: BufferGeometry[] = [];
  const lamp: BufferGeometry[] = [];
  const board: BufferGeometry[] = [];
  const blockers: Box[] = [];
  let n = 0;
  const centre = new Vector3();
  /** Adds a part; `axis` is the grain (or brushing) direction. Wood gets a tone per board, paint and brass none. */
  const add = (part: Solid, g: BufferGeometry, axis: 0 | 1 | 2 = 0) => {
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    flat.computeBoundingBox();
    flat.boundingBox!.getCenter(centre);
    const b = woodBoard(n++, 5);
    solid[part].push(tagBoard(flat, [centre.x, centre.y, centre.z], axis, part === "wood" ? b : { seed: b.seed, tone: 1 }));
  };
  /** A box with cut edges (`cut` 0: sharp) that also blocks light for the AO bake (unless `block` is false). */
  const piece = (part: Solid, sx: number, sy: number, sz: number, x: number, y: number, z: number, cut = 0.006, axis: 0 | 1 | 2 = 0, block = true) => {
    add(part, at(cut > 0 ? chamferBox(sx, sy, sz, cut) : new BoxGeometry(sx, sy, sz), x, y, z), axis);
    if (block) blockers.push({ min: [x - sx / 2, y - sy / 2, z - sz / 2], max: [x + sx / 2, y + sy / 2, z + sz / 2] });
  };
  /** Floor boards along x between x0 and x1, across the car within ±half. */
  const boards = (x0: number, x1: number, half: number, width: number) => {
    const count = Math.round((half * 2) / width);
    const w = (half * 2) / count;
    for (let i = 0; i < count; i++) piece("wood", x1 - x0, DECK - SEAT, w - 0.006, (x0 + x1) / 2, (SEAT + DECK) / 2, -half + w * (i + 0.5), 0.003);
  };

  // Lower body: one maroon block, gold pinstripes along it.
  add("maroon", rbox(BODY * 2, SEAT - FLOOR, W * 2, 0, (SEAT + FLOOR) / 2, 0, 0.03));
  blockers.push({ min: [-BODY, FLOOR, -W], max: [BODY, SEAT, W] });
  for (const s of SIDES) {
    const z = s * (W + 0.003);
    piece("gold", BODY * 2 - 0.08, 0.012, 0.01, 0, SEAT - 0.045, z, 0, 0, false);
    piece("gold", BODY * 2 - 0.08, 0.012, 0.01, 0, FLOOR + 0.045, z, 0, 0, false);
    // Route board with the brand, framed in gold.
    board.push(sidePlane(ROUTE_BOARD[0], ROUTE_BOARD[1], 0, 0.665, s, W + 0.005));
    piece("gold", 2.54, 0.012, 0.008, 0, 0.665 + 0.126, z, 0, 0, false);
    piece("gold", 2.54, 0.012, 0.008, 0, 0.665 - 0.126, z, 0, 0, false);
    piece("gold", 0.012, 0.264, 0.008, 1.264, 0.665, z, 0, 1, false);
    piece("gold", 0.012, 0.264, 0.008, -1.264, 0.665, z, 0, 1, false);
  }

  // Underframe and two trucks with small wheels on the rails.
  add("dark", box(BODY * 2 + 0.2, 0.08, W * 2 - 0.2, 0, FLOOR - 0.04, 0));
  for (const e of ENDS) {
    const x = e * 1.3;
    add("dark", box(0.12, 0.08, 1.0, x, 0.27, 0));
    for (const s of SIDES) {
      add("dark", box(0.78, 0.07, 0.04, x, 0.19, s * 0.5));
      for (const dx of [-0.26, 0.26]) add("dark", at(new CylinderGeometry(0.12, 0.12, 0.045, 14).rotateX(Math.PI / 2), x + dx, 0.142, s * (GAUGE / 2)));
    }
  }

  // Floors: teak boards along the car over the cabin and both open sections.
  boards(-BODY + 0.07, BODY - 0.07, W - 0.05, 0.13);

  // Cabin: cream panel under the windows, teak posts, sill, head rail and sash bars, clear glass.
  const winH = BOARD - WIN;
  for (const s of SIDES) {
    piece("cream", CAB * 2, WIN - SEAT, 0.05, 0, (SEAT + WIN) / 2, s * (W - 0.025), 0.008);
    for (let i = 0; i <= 4; i++) piece("wood", 0.07, winH, 0.06, -CAB + (i * CAB) / 2, (WIN + BOARD) / 2, s * (W - 0.03), 0.008, 1);
    piece("wood", CAB * 2 + 0.04, 0.03, 0.085, 0, WIN + 0.015, s * (W - 0.035), 0.008);
    piece("wood", CAB * 2, 0.03, 0.075, 0, BOARD - 0.015, s * (W - 0.035), 0.006);
    piece("wood", CAB * 2, 0.026, 0.035, 0, 1.36, s * (W - 0.04), 0.006, 0, false);
    glass.push(sidePlane(CAB * 2, winH, 0, (WIN + BOARD) / 2, s, W - 0.055));
    // Letterboard: a cream band the whole length, gold lines top and bottom.
    piece("cream", BODY * 2 - 0.01, EAVE - BOARD, 0.047, 0, (BOARD + EAVE) / 2, s * (W - 0.0265), 0.01); // 3 mm inside the corner posts
    piece("gold", BODY * 2 - 0.04, 0.012, 0.01, 0, BOARD + 0.035, s * (W + 0.003), 0, 0, false);
    piece("gold", BODY * 2 - 0.04, 0.012, 0.01, 0, EAVE - 0.035, s * (W + 0.003), 0, 0, false);
    // Inside: a long bench along each wall, three slats on brackets.
    for (let k = 0; k < 3; k++) piece("wood", CAB * 2 - 0.12, 0.02, 0.07, 0, BENCH - 0.01, s * (W - 0.1 - k * 0.085), 0.004);
    for (const x of [-CAB + 0.15, 0, CAB - 0.15]) piece("dark", 0.03, BENCH - DECK - 0.02, 0.22, x, (DECK + BENCH - 0.02) / 2, s * (W - 0.17), 0.004);
  }
  // Cabin end walls, each with a window framed in teak.
  for (const e of ENDS) {
    const half = 0.5; // window opening half-width
    for (const s of SIDES) piece("cream", 0.05, EAVE - SEAT, W - half - 0.004, e * CAB, (SEAT + EAVE) / 2, s * (half + (W - half - 0.004) / 2), 0.008, 1);
    piece("cream", 0.05, EAVE - BOARD, half * 2, e * CAB, (BOARD + EAVE) / 2, 0, 0.008);
    piece("cream", 0.05, WIN - SEAT, half * 2, e * CAB, (SEAT + WIN) / 2, 0, 0.008);
    piece("wood", 0.07, 0.03, half * 2 + 0.04, e * CAB, WIN + 0.015, 0, 0.006, 2);
    piece("wood", 0.06, winH, 0.06, e * CAB, (WIN + BOARD) / 2, 0, 0.008, 1);
    piece("wood", 0.06, 0.026, half * 2, e * CAB, 1.36, 0, 0.006, 2, false);
    glass.push(endPlane(half * 2, winH, e, CAB + 0.02, (WIN + BOARD) / 2));
  }

  // Open grip sections: slatted benches back to back on brackets, brass poles, teak corner posts.
  const benchX = (CAB + BODY) / 2;
  const benchL = BODY - CAB - 0.08;
  for (const e of ENDS) {
    const x = e * benchX;
    for (const dx of [-0.42, 0, 0.42].map((d) => d * benchL)) piece("wood", 0.035, 0.42, 0.05, x + dx, DECK + 0.21, 0, 0.006, 1); // back posts
    piece("wood", benchL + 0.03, 0.03, 0.09, x, DECK + 0.435, 0, 0.008); // cap rail
    for (const s of SIDES) {
      for (let k = 0; k < 4; k++) piece("wood", benchL, 0.022, 0.085, x, BENCH - 0.011, s * (0.39 + k * 0.1), 0.005);
      for (let k = 0; k < 3; k++) piece("wood", benchL, 0.06, 0.018, x, BENCH + 0.05 + k * 0.085, s * 0.035, 0.005);
      for (const dx of [-0.42, 0, 0.42].map((d) => d * benchL)) piece("dark", 0.03, BENCH - DECK - 0.022, 0.36, x + dx, (DECK + BENCH - 0.022) / 2, s * 0.58, 0.004);
      piece("wood", 0.07, EAVE - DECK, 0.07, e * (BODY - 0.035), (DECK + EAVE) / 2, s * (W - 0.035), 0.01, 1);
      for (const px of [1.3, 1.65]) add("gold", rod(0.017, e * px, DECK, BOARD, s * (W - 0.05)), 1);
      // Running board: teak treads on brackets, with a brass nosing.
      piece("wood", 1.0, 0.03, STEP_OUT - W + 0.02, e * 1.55, STEP - 0.015, s * (W + STEP_OUT) / 2, 0.006);
      piece("gold", 1.0, 0.008, 0.01, e * 1.55, STEP - 0.008, s * (STEP_OUT + 0.005), 0, 0, false);
      for (const bx of [1.15, 1.95]) piece("dark", 0.04, 0.08, STEP_OUT - W, e * bx, STEP - 0.065, s * (W + STEP_OUT) / 2, 0);
    }
  }

  // End platforms: teak floor, curved maroon dash with a brass rail, bumper, grip lever.
  for (const e of ENDS) {
    add("wood", slab(platformShape(), 0.5, 0.05, e));
    add("dark", slab(platformShape(), 0.45, 0.1, e));
    add("maroon", slab(dashRing(DASH_R - 0.05, DASH_R), 0.95, 0.55, e));
    add("gold", slab(dashRing(DASH_R - 0.06, DASH_R + 0.008), 0.975, 0.025, e), 2);
    add("gold", slab(dashRing(DASH_R - 0.01, DASH_R + 0.004), 0.885, 0.012, e), 2);
    add("dark", slab(dashRing(DASH_R - 0.03, DASH_R + 0.05), 0.42, 0.07, e));
    add("dark", rod(0.018, e * 2.1, 0.5, 1.22, 0.18));
    add("dark", box(0.03, 0.03, 0.12, e * 2.1, 1.23, 0.18));
  }

  // Roof: arched, overhanging, dipping over the platforms; maroon fascia; teak ceiling; clerestory with deck lights.
  add("roof", bend(archedRoof(ROOF_W, 0.04, 0.07, ROOF, 0.018).translate(0, EAVE, 0)));
  blockers.push({ min: [-BODY, EAVE, -ROOF_W], max: [BODY, EAVE + 0.06, ROOF_W] });
  for (const s of SIDES) add("maroon", bend(box(ROOF * 2, 0.06, 0.02, 0, EAVE + 0.01, s * (ROOF_W + 0.02), 24)));
  for (let k = 0; k < 7; k++) {
    const w = ((W - 0.05) * 2) / 7;
    piece("wood", BODY * 2 - 0.1, 0.014, w - 0.004, 0, EAVE - 0.007, -(W - 0.05) + w * (k + 0.5), 0.003, 0, false);
  }
  const cTop = EAVE + 0.07;
  add("roof", rbox(3.3, 0.12, 0.7, 0, cTop + 0.06, 0, 0.025));
  add("roof", archedRoof(0.4, 0.015, 0.025, 1.7, 0.012).translate(0, cTop + 0.12, 0));
  for (const s of SIDES) {
    glass.push(sidePlane(3.0, 0.05, 0, cTop + 0.065, s, 0.352));
    for (let i = 0; i <= 10; i++) add("roof", box(0.03, 0.06, 0.01, -1.5 + i * 0.3, cTop + 0.065, s * 0.354));
  }
  // Ceiling lamps: three in the cabin, one over each open section (lit at night).
  for (const x of [-0.6, 0, 0.6, -benchX, benchX]) lamp.push(at(new CylinderGeometry(0.05, 0.06, 0.02, 12), x, EAVE - 0.024, 0));

  // Headlamp and bell at each end, on the roof.
  for (const e of ENDS) {
    const lx = 2.32;
    const roofTop = EAVE + 0.128 - hood(lx);
    const ly = roofTop + 0.08;
    add("dark", box(0.06, 0.06, 0.05, e * (lx - 0.02), roofTop + 0.01, 0));
    add("gold", at(new CylinderGeometry(0.06, 0.055, 0.11, 16).rotateZ(Math.PI / 2), e * lx, ly, 0));
    lamp.push(at(new CircleGeometry(0.05, 16).rotateY((e * Math.PI) / 2), e * (lx + 0.056), ly, 0));
    const bx = e * 1.98;
    const by = EAVE + 0.12 - hood(bx);
    add("dark", rod(0.012, bx, by - 0.02, by + 0.13, 0, 6), 1);
    const profile = [[0.055, 0], [0.05, 0.012], [0.037, 0.035], [0.031, 0.058], [0.019, 0.074], [0.001, 0.08]].map(([r, y]) => new Vector2(r, y));
    add("gold", at(new LatheGeometry(profile, 16), bx, by + 0.05, 0), 1);
  }

  const out = Object.fromEntries(SOLID.map((k) => [k, shade(merge(solid[k]), blockers)])) as Record<Solid, BufferGeometry>;
  return { ...out, glass: merge(glass), lamp: merge(lamp), board: merge(board) };
}

// --- materials (shared by every car and rail) ------------------------------

const PAINT = WOOD_LOOKS.paint;
const FINISH: Record<Solid, [string, WoodLook]> = {
  maroon: ["#7b2a22", PAINT],
  cream: ["#efe2c4", { ...PAINT, rough: [0.38, 0.55] }],
  gold: ["#c9a24c", WOOD_LOOKS.brass],
  dark: ["#2b2725", { ...PAINT, rough: [0.5, 0.72], metal: 0.35 }],
  wood: ["#9c7444", WOOD_LOOKS.teak],
  roof: ["#6a615a", { ...PAINT, contrast: 0.15, rough: [0.7, 0.92] }],
};

type Paints = Record<Solid, MeshStandardMaterial> & { glass: MeshStandardMaterial };
const shared: { full?: Paints; lite?: Paints } = {};
/** The car's materials: on phones plain standard ones (programs the city already has). */
export function carMaterials(lite: boolean): Paints {
  const key = lite ? "lite" : "full";
  return (shared[key] ??= {
    ...(Object.fromEntries(SOLID.map((k) => [k, woodMaterial(FINISH[k][0], FINISH[k][1], lite)])) as Record<Solid, MeshStandardMaterial>),
    glass: glassMaterial(),
  });
}

let rails: Record<"steel" | "groove", MeshStandardMaterial> | null = null;
const railMaterials = () =>
  (rails ??= {
    steel: new MeshStandardMaterial({ color: "#b4b1ab", roughness: 0.35, metalness: 0.65 }),
    groove: new MeshStandardMaterial({ color: "#1c1b1a", roughness: 0.9 }),
  });

let carParts: CarParts | null = null;

// --- components --------------------------------------------------------------

/** A strip along x that follows the ground, top `top` above it. */
function strip(x0: number, x1: number, z: number, width: number, top: number) {
  const len = x1 - x0;
  const g = box(len, top + 0.03, width, (x0 + x1) / 2, (top - 0.03) / 2, z, Math.max(1, Math.ceil(len)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + surfaceAt(p.getX(i), p.getZ(i)));
  return g;
}

/** Two running rails with their grooves, and the cable slot between them. */
export function Rails({ x0, x1, z }: { x0: number; x1: number; z: number }) {
  const m = railMaterials();
  const { steel, groove } = useMemo(() => {
    const rail = GAUGE / 2;
    return {
      steel: merge([strip(x0, x1, z - rail, 0.05, 0.022), strip(x0, x1, z + rail, 0.05, 0.022), strip(x0, x1, z - 0.028, 0.022, 0.014), strip(x0, x1, z + 0.028, 0.022, 0.014)]),
      groove: merge([strip(x0, x1, z - rail + 0.04, 0.026, 0.006), strip(x0, x1, z + rail - 0.04, 0.026, 0.006), strip(x0, x1, z, 0.034, 0.008)]),
    };
  }, [x0, x1, z]);
  return (
    <>
      <mesh geometry={steel} material={m.steel} receiveShadow />
      <mesh geometry={groove} material={m.groove} receiveShadow />
    </>
  );
}

/** Height and tilt of a car standing on the street at x, z. */
function ground(x: number, z: number) {
  const a = surfaceAt(x - 1.3, z);
  const b = surfaceAt(x + 1.3, z);
  return { y: (a + b) / 2, tilt: Math.atan2(b - a, 2.6) };
}

/** The car itself, its origin on the street between the rails. `moving`: kept out of reflections (they would show it where it was). */
export function CarModel({ moving = false }: { moving?: boolean }) {
  const m = carMaterials(useContext(Lite));
  const parts = (carParts ??= carGeometry());
  const panel = useSign(useBrand(), { bg: "#f3e8cf", fg: "#6b2a1f", width: 1536, panel: ROUTE_BOARD });
  const lamp = useGlow("#fff1cf", 3, 0.15);
  const boardMat = useMemo(() => new MeshStandardMaterial({ map: panel, roughness: 0.5, emissive: "#ffffff", emissiveMap: panel, emissiveIntensity: 0 }), [panel]);
  useNightGlow(boardMat, 0.35); // the route board is lit at night, so the brand still reads
  useEffect(() => () => boardMat.dispose(), [boardMat]);
  const layer = moving ? detail : undefined;
  return (
    <>
      {SOLID.map((k) => (
        <mesh key={k} ref={layer} geometry={parts[k]} material={m[k]} castShadow receiveShadow />
      ))}
      <mesh ref={layer} geometry={parts.glass} material={m.glass} />
      <mesh ref={layer} geometry={parts.lamp} material={lamp} />
      <mesh ref={layer} geometry={parts.board} material={boardMat} receiveShadow />
    </>
  );
}

/** A car standing at p on the street, pitched with it. */
export function CableCar({ p }: { p: V3 }) {
  const rest = ground(p[0], p[2]);
  return (
    <group position={[p[0], p[1] + rest.y, p[2]]} rotation-z={rest.tilt}>
      <CarModel />
    </group>
  );
}
