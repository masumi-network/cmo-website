"use client";

// San Francisco cable cars and their rails. They carry the visitor's brand on
// the long route board under the windows.
//
// A double-ended California St car at miniature scale: an enclosed cabin in
// the middle, open grip sections with outward benches and running boards at
// both ends, curved dashes, a clerestory roof that dips over the end
// platforms, a brass headlamp and bell at each end. All static parts are
// merged into one geometry per material (9 draw calls per car).

import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, CircleGeometry, CylinderGeometry, ExtrudeGeometry, LatheGeometry, MeshStandardMaterial, PlaneGeometry, Shape, Vector2 } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { heightAt } from "@/lib/terrain";
import { useBrand, useGlow, type V3 } from "./parts";
import { useNightGlow } from "./shared";
import { useSign } from "./textures";

// Car layout in local units: x along the rails, y up, z across. The car's
// origin is on the street between the rails.
const W = 0.8; // body half-width
const BODY = 2; // half-length of the body (cabin plus open sections)
const CAB = 0.95; // cabin half-length
const DASH = 2.3; // the curved dash at each end, at the centre line
const DASH_R = 1.7; // dash curve radius
const FLOOR = 0.4; // underside of the body
const SEAT = 0.92; // top of the lower body: bench height
const WIN = 1.0; // window sill
const BOARD = 1.62; // letterboard (cream band under the roof)
const EAVE = 1.84; // underside of the roof
const ROOF = 2.42; // roof half-length (overhangs the dash)
const ROOF_W = 0.93; // roof half-width (overhangs the sides)
const STEP = 0.34; // running board top
const STEP_OUT = 1.02; // running board outer edge
export const GAUGE = 0.84;

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

const ENDS = [-1, 1];
const SIDES = [-1, 1];

export type CarParts = Record<"maroon" | "cream" | "gold" | "dark" | "wood" | "roof" | "glass" | "lamp" | "board", BufferGeometry>;

/** All the car's static geometry, one merged geometry per material. */
export function carGeometry(): CarParts {
  const maroon: BufferGeometry[] = [];
  const cream: BufferGeometry[] = [];
  const gold: BufferGeometry[] = [];
  const dark: BufferGeometry[] = [];
  const wood: BufferGeometry[] = [];
  const roof: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  const lamp: BufferGeometry[] = [];
  const board: BufferGeometry[] = [];

  // Lower body: one maroon block, gold pinstripes along it.
  maroon.push(rbox(BODY * 2, SEAT - FLOOR, W * 2, 0, (SEAT + FLOOR) / 2, 0, 0.03));
  for (const s of SIDES) {
    const z = s * (W + 0.003);
    gold.push(box(BODY * 2 - 0.08, 0.012, 0.01, 0, SEAT - 0.045, z), box(BODY * 2 - 0.08, 0.012, 0.01, 0, FLOOR + 0.045, z));
    // Route board with the brand, framed in gold.
    board.push(sidePlane(2.5, 0.24, 0, 0.665, s, W + 0.005));
    gold.push(box(2.54, 0.012, 0.008, 0, 0.665 + 0.126, z), box(2.54, 0.012, 0.008, 0, 0.665 - 0.126, z));
    gold.push(box(0.012, 0.264, 0.008, 1.264, 0.665, z), box(0.012, 0.264, 0.008, -1.264, 0.665, z));
  }

  // Underframe and two trucks with small wheels on the rails.
  dark.push(box(BODY * 2 + 0.2, 0.08, W * 2 - 0.2, 0, FLOOR - 0.04, 0));
  for (const e of ENDS) {
    const x = e * 1.3;
    dark.push(box(0.12, 0.08, 1.0, x, 0.27, 0));
    for (const s of SIDES) {
      dark.push(box(0.78, 0.07, 0.04, x, 0.19, s * 0.5));
      for (const dx of [-0.26, 0.26]) dark.push(at(new CylinderGeometry(0.12, 0.12, 0.045, 14).rotateX(Math.PI / 2), x + dx, 0.142, s * (GAUGE / 2)));
    }
  }

  // Cabin: cream window band, posts between four windows a side, sash bars.
  const winH = BOARD - WIN;
  for (const s of SIDES) {
    cream.push(box(CAB * 2, WIN - SEAT, 0.05, 0, (SEAT + WIN) / 2, s * (W - 0.025)));
    for (let i = 0; i <= 4; i++) cream.push(box(0.07, winH, 0.06, -CAB + (i * CAB) / 2, (WIN + BOARD) / 2, s * (W - 0.03)));
    cream.push(box(CAB * 2, 0.03, 0.04, 0, 1.36, s * (W - 0.035)));
    glass.push(sidePlane(CAB * 2, winH, 0, (WIN + BOARD) / 2, s, W - 0.055));
    // Letterboard: a cream band the whole length, gold lines top and bottom.
    cream.push(box(BODY * 2, EAVE - BOARD, 0.05, 0, (BOARD + EAVE) / 2, s * (W - 0.025)));
    gold.push(box(BODY * 2 - 0.04, 0.012, 0.01, 0, BOARD + 0.035, s * (W + 0.003)), box(BODY * 2 - 0.04, 0.012, 0.01, 0, EAVE - 0.035, s * (W + 0.003)));
  }
  // Cabin end walls, each with a window.
  for (const e of ENDS) {
    const half = 0.5; // window opening half-width
    for (const s of SIDES) cream.push(box(0.05, EAVE - SEAT, W - half, e * CAB, (SEAT + EAVE) / 2, s * (half + (W - half) / 2)));
    cream.push(box(0.05, EAVE - BOARD, half * 2, e * CAB, (BOARD + EAVE) / 2, 0), box(0.05, WIN - SEAT, half * 2, e * CAB, (SEAT + WIN) / 2, 0));
    cream.push(box(0.06, winH, 0.06, e * CAB, (WIN + BOARD) / 2, 0), box(0.06, 0.03, half * 2, e * CAB, 1.36, 0));
    glass.push(endPlane(half * 2, winH, e, CAB + 0.02, (WIN + BOARD) / 2));
  }

  // Open grip sections: outward benches back to back, brass poles, cream corner posts.
  const benchX = (CAB + BODY) / 2;
  const benchL = BODY - CAB - 0.06;
  for (const e of ENDS) {
    wood.push(box(benchL, 0.36, 0.08, e * benchX, SEAT + 0.18, 0), box(benchL + 0.02, 0.03, 0.12, e * benchX, SEAT + 0.375, 0));
    for (const s of SIDES) {
      wood.push(box(benchL, 0.04, 0.42, e * benchX, SEAT + 0.02, s * 0.57));
      cream.push(box(0.07, EAVE - SEAT, 0.07, e * (BODY - 0.035), (SEAT + EAVE) / 2, s * (W - 0.035)));
      for (const x of [1.3, 1.65]) gold.push(rod(0.017, e * x, SEAT, BOARD, s * (W - 0.05)));
      // Running board on brackets, with a dark edge.
      dark.push(box(1.0, 0.03, STEP_OUT - W + 0.02, e * 1.55, STEP - 0.015, s * (W + STEP_OUT) / 2));
      gold.push(box(1.0, 0.008, 0.01, e * 1.55, STEP - 0.008, s * (STEP_OUT + 0.005)));
      for (const x of [1.15, 1.95]) dark.push(box(0.04, 0.08, STEP_OUT - W, e * x, STEP - 0.065, s * (W + STEP_OUT) / 2));
    }
  }

  // End platforms: wood floor, curved maroon dash with a brass rail, bumper, grip lever.
  for (const e of ENDS) {
    wood.push(slab(platformShape(), 0.5, 0.05, e));
    dark.push(slab(platformShape(), 0.45, 0.1, e));
    maroon.push(slab(dashRing(DASH_R - 0.05, DASH_R), 0.95, 0.55, e));
    gold.push(slab(dashRing(DASH_R - 0.06, DASH_R + 0.008), 0.975, 0.025, e));
    gold.push(slab(dashRing(DASH_R - 0.01, DASH_R + 0.004), 0.885, 0.012, e));
    dark.push(slab(dashRing(DASH_R - 0.03, DASH_R + 0.05), 0.42, 0.07, e));
    dark.push(rod(0.018, e * 2.1, 0.5, 1.22, 0.18), box(0.03, 0.03, 0.12, e * 2.1, 1.23, 0.18));
  }

  // Roof: arched, overhanging, dipping over the platforms; maroon fascia; clerestory with deck lights.
  roof.push(bend(archedRoof(ROOF_W, 0.04, 0.07, ROOF, 0.018).translate(0, EAVE, 0)));
  for (const s of SIDES) maroon.push(bend(box(ROOF * 2, 0.06, 0.02, 0, EAVE + 0.01, s * (ROOF_W + 0.02), 24)));
  const cTop = EAVE + 0.07;
  roof.push(rbox(3.3, 0.12, 0.7, 0, cTop + 0.06, 0, 0.025));
  roof.push(archedRoof(0.4, 0.015, 0.025, 1.7, 0.012).translate(0, cTop + 0.12, 0));
  for (const s of SIDES) {
    glass.push(sidePlane(3.0, 0.05, 0, cTop + 0.065, s, 0.352));
    for (let i = 0; i <= 10; i++) roof.push(box(0.03, 0.06, 0.01, -1.5 + i * 0.3, cTop + 0.065, s * 0.354));
  }

  // Headlamp and bell at each end, on the roof.
  for (const e of ENDS) {
    const lx = 2.32;
    const roofTop = EAVE + 0.128 - hood(lx);
    const ly = roofTop + 0.08;
    dark.push(box(0.06, 0.06, 0.05, e * (lx - 0.02), roofTop + 0.01, 0));
    gold.push(at(new CylinderGeometry(0.06, 0.055, 0.11, 16).rotateZ(Math.PI / 2), e * lx, ly, 0));
    lamp.push(at(new CircleGeometry(0.05, 16).rotateY((e * Math.PI) / 2), e * (lx + 0.056), ly, 0));
    const bx = e * 1.98;
    const by = EAVE + 0.12 - hood(bx);
    dark.push(rod(0.012, bx, by - 0.02, by + 0.13, 0, 6));
    const profile = [[0.055, 0], [0.05, 0.012], [0.037, 0.035], [0.031, 0.058], [0.019, 0.074], [0.001, 0.08]].map(([r, y]) => new Vector2(r, y));
    gold.push(at(new LatheGeometry(profile, 16), bx, by + 0.05, 0));
  }

  return {
    maroon: merge(maroon),
    cream: merge(cream),
    gold: merge(gold),
    dark: merge(dark),
    wood: merge(wood),
    roof: merge(roof),
    glass: merge(glass),
    lamp: merge(lamp),
    board: merge(board),
  };
}

// --- materials (shared by every car and rail) ------------------------------

let shared: Record<"maroon" | "cream" | "gold" | "dark" | "wood" | "roof" | "steel" | "groove", MeshStandardMaterial> | null = null;
function paints() {
  shared ??= {
    maroon: new MeshStandardMaterial({ color: "#7b2a22", roughness: 0.4 }),
    cream: new MeshStandardMaterial({ color: "#efe2c4", roughness: 0.55 }),
    gold: new MeshStandardMaterial({ color: "#c9a24c", roughness: 0.32, metalness: 0.7 }),
    dark: new MeshStandardMaterial({ color: "#2b2725", roughness: 0.55, metalness: 0.4 }),
    wood: new MeshStandardMaterial({ color: "#8a5a36", roughness: 0.6 }),
    roof: new MeshStandardMaterial({ color: "#6a615a", roughness: 0.8 }),
    steel: new MeshStandardMaterial({ color: "#b4b1ab", roughness: 0.35, metalness: 0.65 }),
    groove: new MeshStandardMaterial({ color: "#1c1b1a", roughness: 0.9 }),
  };
  return shared;
}

let carParts: CarParts | null = null;
const SOLID = ["maroon", "cream", "gold", "dark", "wood", "roof"] as const;

// --- components --------------------------------------------------------------

/** A strip along x that follows the ground, top `top` above it. */
function strip(x0: number, x1: number, z: number, width: number, top: number) {
  const len = x1 - x0;
  const g = box(len, top + 0.03, width, (x0 + x1) / 2, (top - 0.03) / 2, z, Math.max(1, Math.ceil(len)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + heightAt(p.getX(i), p.getZ(i)));
  return g;
}

/** Two running rails with their grooves, and the cable slot between them. */
export function Rails({ x0, x1, z }: { x0: number; x1: number; z: number }) {
  const m = paints();
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

/** Height and tilt of a car standing on the ground at x, z. */
function ground(x: number, z: number) {
  const a = heightAt(x - 1.3, z);
  const b = heightAt(x + 1.3, z);
  return { y: (a + b) / 2, tilt: Math.atan2(b - a, 2.6) };
}

export function CableCar({ p }: { p: V3 }) {
  const m = paints();
  const parts = (carParts ??= carGeometry());
  const panel = useSign(useBrand(), { bg: "#f3e8cf", fg: "#6b2a1f", width: 1536, height: 160 });
  const glass = useMemo(() => new MeshStandardMaterial({ color: "#1d2127", roughness: 0.15, metalness: 0.5, emissive: "#ffd9a0", emissiveIntensity: 0 }), []);
  useNightGlow(glass, 1.5);
  useEffect(() => () => glass.dispose(), [glass]);
  const lamp = useGlow("#fff1cf", 3, 0.15);
  const boardMat = useMemo(() => new MeshStandardMaterial({ map: panel, roughness: 0.5, emissive: "#ffffff", emissiveMap: panel, emissiveIntensity: 0 }), [panel]);
  useNightGlow(boardMat, 0.35); // the route board is lit at night, so the brand still reads
  useEffect(() => () => boardMat.dispose(), [boardMat]);
  const rest = ground(p[0], p[2]);
  return (
    <group position={[p[0], p[1] + rest.y, p[2]]} rotation-z={rest.tilt}>
      {SOLID.map((k) => (
        <mesh key={k} geometry={parts[k]} material={m[k]} castShadow receiveShadow />
      ))}
      <mesh geometry={parts.glass} material={glass} />
      <mesh geometry={parts.lamp} material={lamp} />
      <mesh geometry={parts.board} material={boardMat} receiveShadow />
    </group>
  );
}
