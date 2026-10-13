"use client";

// 07:00 Hayes Valley coffee shop, modelled (no photos). A two-storey
// Edwardian corner building: lap siding, double-hung windows with real glass
// and a bracketed cornice, built with the row houses' kit and material
// (house-models.ts). Under it a painted timber shopfront: pilasters with
// consoles, panelled stall risers, big display windows, transom lights, a
// recessed door, the visitor's brand on the fascia. It wraps round the
// corner. Through the glass, a small cafe glows warm: counter, back bar,
// marble tables, bentwood chairs, pendant lamps, plants.
//
// Draw calls: building 1, painted parts (shopfront, cafe, sidewalk) 1,
// glass 1, sign 1, corner lamp 2 (the city's acorn lamp, street.tsx).

import { useMemo } from "react";
import { BoxGeometry, Color, Float32BufferAttribute, IcosahedronGeometry, MeshStandardMaterial, PlaneGeometry, type BufferGeometry, type Object3D } from "three";
import { heightAt } from "@/lib/terrain";
import { facadeNight } from "./facade";
import { PALETTES, SLOT, builder, palette, type Frame, type Rect } from "./house-models";
import { box, cyl, merged, placed, useLandmarkTextures } from "./landmark-kit";
import { houseMaterial } from "./materials";
import { Instances, useBrand, type V3 } from "./parts";
import { useNightGlow } from "./shared";
import { Lamps } from "./street";
import { useSign } from "./textures";

/** The sign face in world units [width, height]; its canvas follows the same shape. */
export const SHOP_SIGN = [6.8, 0.8] as const;

// Heights above the ground (the block is flat here).
const STORE = 3.82; // top of the shopfront (the fascia cornice)
const FRIEZE = 5.9; // the main cornice: frieze, bed moulding, crown
const CROWN = 6.25;
const TOP = 6.43;
const ROOF = 6.23;
const OVER = 0.36; // the crown's reach
const RELIEF = 0.22; // the shopfront's furthest reach (fascia cornice)
const W = 8; // x -15..-7
const D = 4.6; // z 7..11.6
const UPPER: [number, number] = [4.3, 5.5]; // upper windows, bottom and top

// Nob Hill starts to rise under the east end: the floor is level with the
// highest point of the sidewalk in front (the corner); a stone base course
// covers the step down to the west.
const local = { x: -11, z: 11.6, ground: heightAt(-7, 11.6) };
const world = (a: number, c: number) => ({ x: local.x + a, z: local.z + c });
/** The sidewalk under a point, relative to the floor. */
const sidewalk = (a: number, c: number) => heightAt(local.x + a, local.z + c) - local.ground;

/** Sidewalk furniture (local: a along the front, c out to the street), as boxes. */
const TABLE = { a: -3.15, c: 0.48 };
const BOARD = { a: 1.2, c: 0.48 };
const furnitureBox = (name: string, a0: number, a1: number, c0: number, c1: number, top: number) => ({
  name,
  x0: world(a0, 0).x,
  x1: world(a1, 0).x,
  z0: world(0, c0).z,
  z1: world(0, c1).z,
  y0: local.ground + sidewalk((a0 + a1) / 2, (c0 + c1) / 2),
  y1: local.ground + sidewalk((a0 + a1) / 2, (c0 + c1) / 2) + top,
});

/**
 * The shop in world terms, for tests and the collision check. The model is
 * built in local coordinates from the middle of the front wall on the ground:
 * x = SHOP.x + a, y = SHOP.ground + b, z = SHOP.z + c.
 */
export const SHOP = {
  ...local,
  x0: local.x - W / 2,
  x1: local.x + W / 2,
  z0: local.z - D,
  z1: local.z,
  storeTop: STORE,
  top: TOP,
  overhang: OVER,
  relief: RELIEF,
  /** Centre of the brand sign (local). */
  sign: [0, 3.17, 0.085] as const,
  /** The corner lamp: an SF acorn lamp like the street's, 0.3 in from the kerb. */
  lamp: { x: -6.6, y: heightAt(-6.6, 12.2), z: 12.2, turn: 0 },
  furniture: [
    furnitureBox("cafe table", TABLE.a - 0.56, TABLE.a + 0.56, TABLE.c - 0.22, TABLE.c + 0.22, 0.85),
    furnitureBox("menu board", BOARD.a - 0.26, BOARD.a + 0.26, BOARD.c - 0.18, BOARD.c + 0.18, 0.88),
  ],
};

// ---------------------------------------------------------------------------
// The building: the row houses' kit and paint (one palette, see PAINT).

const FRONT: Frame = { o: [0, 0, 0], u: [1, 0, 0] };
const EAST: Frame = { o: [W / 2, 0, 0], u: [0, 0, -1] }; // the corner side, a from the front back
const WEST: Frame = { o: [-W / 2, 0, -D], u: [0, 0, 1] };
const BACK: Frame = { o: [W / 2, 0, -D], u: [-1, 0, 0] };
/** The storefront wraps this far round the corner. */
const WRAP = 1.9;

function shellGeometry() {
  const k = builder();
  let id = 0;
  const upper = (at: number[]): Rect[] => at.map((a) => [a - 0.36, a + 0.36, UPPER[0], UPPER[1]]);
  const cornice = (f: Frame, a0: number, a1: number, brackets: number[]) => {
    k.box(f, a0, a1, FRIEZE, CROWN - 0.06, 0, 0.05, SLOT.frieze);
    k.box(f, a0, a1, CROWN - 0.06, CROWN, 0, 0.15, SLOT.trim);
    for (const a of brackets) k.profile(f, a - 0.05, a + 0.05, [[0, FRIEZE - 0.16], [0.07, FRIEZE - 0.16], [0.27, CROWN - 0.06], [0, CROWN - 0.06]], SLOT.trim);
  };

  // front: siding over the shopfront, three windows, the cornice (it runs round the corner)
  const front = upper([-2.6, 0, 2.6]);
  for (const r of front) k.window(FRONT, r, ++id, { hood: "cap" });
  k.wall(FRONT, -W / 2, W / 2, STORE, CROWN, front, SLOT.body);
  cornice(FRONT, -W / 2 - 0.05, W / 2 + 0.05, [-3.95, -3.45, -1.6, -1.0, 1.0, 1.6, 3.45, 3.95]);
  k.box(FRONT, -W / 2 - OVER, W / 2 + OVER, CROWN, TOP, 0, OVER, SLOT.trim);
  k.quad(FRONT, -W / 2, W / 2, ROOF, TOP, 0, SLOT.body, 0, -1); // the parapet from the roof

  // the corner side: the shopfront's return, two windows, the cornice
  const east = upper([WRAP / 2, 3.3]);
  for (const r of east) k.window(EAST, r, ++id, { hood: "cap" });
  k.wall(EAST, 0, D, -1.7, CROWN, [[0, WRAP, -1.7, STORE], ...east], SLOT.body);
  cornice(EAST, 0, D, [0.05, 1.95, 2.55, 4.5]);
  k.box(EAST, 0, D, CROWN, TOP, 0, OVER, SLOT.trim);
  k.quad(EAST, 0, D, ROOF, TOP, 0, SLOT.body, 0, -1);

  // the far side (a neighbour's wall once): two windows, the cornice returns a little
  const west = upper([1.3, 3.1]);
  for (const r of west) k.window(WEST, r, ++id, { hood: "cap" });
  k.wall(WEST, 0, D, -1.7, ROOF, west, SLOT.body);
  k.wall(WEST, D - 0.5, D, ROOF, CROWN, [], SLOT.body);
  cornice(WEST, D - 0.5, D, []);
  k.box(WEST, D - 0.5, D, CROWN, TOP, 0, OVER, SLOT.trim);

  // back wall, flat tar roof, a brick chimney
  k.wall(BACK, 0, W, -1.7, ROOF, [], SLOT.body);
  k.face(FRONT, [[-W / 2, ROOF, 0], [W / 2, ROOF, 0], [W / 2, ROOF, -D], [-W / 2, ROOF, -D]], [0, 1, 0], SLOT.tar);
  k.box(FRONT, -3.3, -2.9, ROOF, ROOF + 0.6, -4.1, -3.7, SLOT.brick);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Painted parts: plain boxes, cylinders and planes with a vertex colour and a
// glow (`aGlow`: 0 outside, 1 the cafe, more for lamp shades and bulbs).

const C = {
  green: "#2f5141",
  brass: "#a2874f",
  iron: "#262b29",
  tile: "#d9d3c5",
  stone: "#a9a59c",
  wood: "#6b4529",
  oak: "#9c6b42",
  floor: "#6e4a31",
  plaster: "#e2d3b6",
  ceiling: "#e8dcc3",
  backTile: "#d9d2c3",
  marble: "#ebe7de",
  steel: "#c2c4c4",
  leaf: "#4c6a3a",
  leaf2: "#62803f",
  pot: "#b5724f",
  opal: "#fff2da",
  bulb: "#fff1d8",
  chalk: "#212725",
  chalkLine: "#d8d4c8",
  panel: "#4e3423",
  print: "#8c9a8f",
};

function tint(g: BufferGeometry, hex: string, glow: number) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  g.setAttribute("color", new Float32BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(n).fill(glow), 1));
  return g;
}

type Side = "front" | "east";
/** A box between a0..a1 (along the wall), b0..b1 (up) and c0..c1 (out of it), on the front or the corner side. */
function slab(side: Side, a0: number, a1: number, b0: number, b1: number, c0: number, c1: number) {
  // the corner side: x = W/2 + c, z = -a
  const [x0, x1, z0, z1] = side === "front" ? [a0, a1, c0, c1] : [W / 2 + c0, W / 2 + c1, -a1, -a0];
  return box([(x0 + x1) / 2, (b0 + b1) / 2, (z0 + z1) / 2], [x1 - x0, b1 - b0, z1 - z0]);
}

/**
 * One run of shopfront between two pilasters: stall riser with raised panels,
 * sill, glass (in the glass mesh) split by mullions, transom bar, transom
 * lights, head rail. `lights`: the display's panes; transoms split each in two.
 */
function display(side: Side, a0: number, a1: number, lights: number, out: BufferGeometry[], glass: BufferGeometry[]) {
  const p = (a0_: number, a1_: number, b0: number, b1: number, c0: number, c1: number, hex: string) => out.push(tint(slab(side, a0_, a1_, b0, b1, c0, c1), hex, 0));
  const w = (a1 - a0) / lights;
  p(a0, a1, 0, 0.55, 0, 0.04, C.green); // stall riser
  p(a0 - 0.02, a1, 0.55, 0.62, 0, 0.1, C.green); // sill
  p(a0, a1, 2.25, 2.33, 0, 0.07, C.green); // transom bar
  p(a0, a1, 2.62, 2.68, 0, 0.05, C.green); // head rail
  for (let i = 0; i < lights; i++) {
    const l0 = a0 + i * w;
    p(l0 + 0.1, l0 + w - 0.1, 0.12, 0.44, 0.04, 0.055, C.green); // raised panel
    glass.push(pane(side, l0, l0 + w, 0.62, 2.25));
  }
  glass.push(pane(side, a0, a1, 2.33, 2.62));
  // stiles at the ends, mullions between the lights, a muntin halving each transom light
  p(a0, a0 + 0.06, 0.62, 2.25, 0, 0.05, C.green);
  p(a1 - 0.06, a1, 0.62, 2.25, 0, 0.05, C.green);
  for (let i = 1; i < lights; i++) p(a0 + i * w - 0.03, a0 + i * w + 0.03, 0.62, 2.62, 0, 0.05, C.green);
  for (let i = 0; i < lights; i++) p(a0 + (i + 0.5) * w - 0.018, a0 + (i + 0.5) * w + 0.018, 2.33, 2.62, 0, 0.04, C.green);
}

/** A pane of glass recessed 0.03 behind the frame, facing out. */
function pane(side: Side, a0: number, a1: number, b0: number, b1: number) {
  const g = new PlaneGeometry(a1 - a0, b1 - b0);
  if (side === "front") return placed(g, [(a0 + a1) / 2, (b0 + b1) / 2, -0.03]);
  return placed(g, [W / 2 - 0.03, (b0 + b1) / 2, -(a0 + a1) / 2], [0, Math.PI / 2, 0]);
}

/** A pilaster: plinth, shaft, and a console under the fascia cornice. */
function pilaster(side: Side, a0: number, a1: number, console: boolean, out: BufferGeometry[]) {
  out.push(tint(slab(side, a0 - 0.02, a1 + 0.02, -0.6, 0.32, 0, 0.14), C.green, 0));
  out.push(tint(slab(side, a0, a1, 0.32, 2.68, 0, 0.1), C.green, 0));
  out.push(tint(slab(side, a0 - 0.015, a1 + 0.015, 2.55, 2.68, 0, 0.12), C.green, 0)); // capital
  if (console) {
    out.push(tint(slab(side, a0 + 0.03, a1 - 0.03, 2.68, 3.58, 0, 0.13), C.green, 0));
    out.push(tint(slab(side, a0 + 0.01, a1 - 0.01, 3.4, 3.58, 0, 0.17), C.green, 0)); // its scroll head
  }
}

function frontGeometry(glass: BufferGeometry[]) {
  const out: BufferGeometry[] = [];
  const p = (side: Side, a0: number, a1: number, b0: number, b1: number, c0: number, c1: number, hex: string) => out.push(tint(slab(side, a0, a1, b0, b1, c0, c1), hex, 0));

  // the front: a granite base course, pilaster, display (three lights), post, recessed door, corner post
  p("front", -4, 3.72, -0.6, 0, 0, 0.06, C.stone);
  p("east", 0.2, WRAP, -0.9, 0, 0, 0.06, C.stone);
  pilaster("front", -4, -3.72, true, out);
  display("front", -3.72, 2.2, 3, out, glass);
  pilaster("front", 2.2, 2.44, false, out);
  out.push(tint(box([3.92, -0.14, -0.08], [0.44, 0.92, 0.44]), C.green, 0)); // corner post: plinth, shaft
  out.push(tint(box([3.92, 1.5, -0.08], [0.4, 2.36, 0.4]), C.green, 0));
  out.push(tint(box([3.92, 2.615, -0.08], [0.43, 0.13, 0.43]), C.green, 0));
  for (const g of [slab("front", 3.79, 3.97, 2.68, 3.58, 0, 0.13), slab("front", 3.77, 3.99, 3.4, 3.58, 0, 0.17)]) out.push(tint(g, C.green, 0));
  for (const g of [slab("east", 0.03, 0.21, 2.68, 3.58, 0, 0.13), slab("east", 0.01, 0.23, 3.4, 3.58, 0, 0.17)]) out.push(tint(g, C.green, 0));

  // the recessed entry: side panels, soffit, mosaic threshold, a wooden door with a glazed panel
  const [e0, e1, back] = [2.44, 3.72, -0.6];
  p("front", e0, e0 + 0.04, 0, 2.25, back, 0, C.green);
  p("front", e1 - 0.04, e1, 0, 2.25, back, 0, C.green);
  p("front", e0, e1, 2.2, 2.25, back, 0, C.green);
  p("front", e0, e1, 2.25, 2.33, 0, 0.07, C.green); // transom bar
  p("front", e0, e1, 2.62, 2.68, 0, 0.05, C.green); // head rail
  p("front", (e0 + e1) / 2 - 0.018, (e0 + e1) / 2 + 0.018, 2.33, 2.62, 0, 0.04, C.green);
  glass.push(pane("front", e0, e1, 2.33, 2.62));
  p("front", e0, e1, -0.6, 0.02, back, 0.1, C.tile); // and its step
  p("front", e0 + 0.04, 2.6, 0, 2.2, back - 0.04, back, C.green);
  p("front", 3.56, e1 - 0.04, 0, 2.2, back - 0.04, back, C.green);
  p("front", 2.6, 2.7, 0, 2.2, back - 0.04, back + 0.01, C.wood);
  p("front", 3.46, 3.56, 0, 2.2, back - 0.04, back + 0.01, C.wood);
  p("front", 2.7, 3.46, 2.1, 2.2, back - 0.04, back + 0.01, C.wood);
  p("front", 2.7, 3.46, 0, 1.0, back - 0.04, back + 0.01, C.wood);
  p("front", 2.78, 3.38, 0.14, 0.86, back + 0.01, back + 0.02, C.wood); // kick panel
  p("front", 3.36, 3.4, 1.0, 1.16, back + 0.01, back + 0.05, C.brass); // pull handle
  glass.push(placed(new PlaneGeometry(0.76, 1.1), [3.08, 1.55, back - 0.015]));

  // the fascia with the sign, a brass bead round it, the fascia cornice; round the corner too
  p("front", -4, 4.08, 2.68, 3.62, 0, 0.08, C.green);
  p("east", 0, WRAP, 2.68, 3.62, 0, 0.08, C.green);
  p("front", -4.04, 4.12, 3.58, 3.66, 0, 0.12, C.green);
  p("east", 0, WRAP + 0.04, 3.58, 3.66, 0, 0.12, C.green);
  p("front", -4.2, 4.2, 3.66, 3.82, 0, RELIEF - 0.02, C.green);
  p("east", 0, WRAP + 0.08, 3.66, 3.82, 0, RELIEF - 0.02, C.green);
  const [sw, sh] = [SHOP_SIGN[0] / 2, SHOP_SIGN[1] / 2];
  const [, sy] = SHOP.sign;
  p("front", -sw - 0.04, sw + 0.04, sy + sh, sy + sh + 0.04, 0.08, 0.1, C.brass);
  p("front", -sw - 0.04, sw + 0.04, sy - sh - 0.04, sy - sh, 0.08, 0.1, C.brass);
  p("front", -sw - 0.04, -sw, sy - sh, sy + sh, 0.08, 0.1, C.brass);
  p("front", sw, sw + 0.04, sy - sh, sy + sh, 0.08, 0.1, C.brass);

  // round the corner: one display window and a pilaster
  display("east", 0.28, 1.64, 1, out, glass);
  pilaster("east", 1.64, WRAP, true, out);

  // gooseneck lamps over the sign, under the upper windows
  for (const a of [-2.6, 0, 2.6]) {
    out.push(tint(box([a, 3.86, 0.05], [0.08, 0.08, 0.04]), C.iron, 0));
    out.push(tint(box([a, 3.94, 0.07], [0.022, 0.16, 0.022]), C.iron, 0));
    out.push(tint(box([a, 4.02, 0.16], [0.022, 0.022, 0.2]), C.iron, 0));
    out.push(tint(cyl([a, 3.98, 0.26], 0.022, 0.07, 0.08, 10, [0.5, 0, 0]), C.green, 0));
    out.push(tint(cyl([a, 3.945, 0.24], 0.05, 0.05, 0.01, 10, [0.5, 0, 0]), C.bulb, 4));
  }

  // on the sidewalk (it slopes a little): a cafe table with two chairs, an A-frame menu board
  const table: BufferGeometry[] = [];
  const { a: ta, c: tc } = TABLE;
  table.push(tint(cyl([ta, 0.72, tc], 0.21, 0.21, 0.03, 16), C.marble, 0));
  table.push(tint(cyl([ta, 0.36, tc], 0.02, 0.02, 0.7, 6), C.iron, 0));
  table.push(tint(cyl([ta, 0.01, tc], 0.12, 0.12, 0.02, 12), C.iron, 0));
  for (const s of [-1, 1]) {
    const x = ta + s * 0.42;
    table.push(tint(box([x, 0.44, tc], [0.24, 0.03, 0.24]), C.iron, 0));
    table.push(tint(box([x + s * 0.11, 0.64, tc], [0.02, 0.36, 0.22]), C.iron, 0));
    for (const ox of [-0.1, 0.1]) for (const oz of [-0.1, 0.1]) table.push(tint(box([x + ox, 0.22, tc + oz], [0.02, 0.44, 0.02]), C.iron, 0));
  }
  const menu: BufferGeometry[] = [];
  const lean = Math.atan2(0.15, 0.84);
  for (const s of [-1, 1]) {
    const centre: V3 = [BOARD.a, 0.43, BOARD.c + s * 0.075];
    const board = (size: V3, at: V3, hex: string) => menu.push(tint(placed(new BoxGeometry(...size).translate(...at), centre, [-s * lean, 0, 0]), hex, 0));
    board([0.5, 0.86, 0.03], [0, 0, 0], C.green);
    board([0.42, 0.6, 0.01], [0, 0.06, s * 0.018], C.chalk);
    for (const [y, w] of [[0.26, 0.24], [0.14, 0.3], [0.06, 0.2], [-0.04, 0.28]]) board([w, 0.022, 0.006], [-0.04 + (0.3 - w) / 2, y, s * 0.024], C.chalkLine);
  }
  for (const [at, parts] of [[TABLE, table], [BOARD, menu]] as const) for (const g of parts) out.push(g.translate(0, sidewalk(at.a, at.c), 0));
  return merged(out);
}

// ---------------------------------------------------------------------------
// The cafe inside (all of it glows a little; the lamps more).

function interiorGeometry() {
  const out: BufferGeometry[] = [];
  const add = (g: BufferGeometry, hex: string, glow = 1) => out.push(tint(g, hex, glow));
  const bx = (p: V3, s: V3, hex: string, glow = 1) => add(box(p, s), hex, glow);
  const room = { a0: -3.95, a1: 3.95, c0: -3.6, h: 3.3 };
  const [rw, rd] = [room.a1 - room.a0, -room.c0];

  // the room, its faces looking in
  add(placed(new PlaneGeometry(rw, rd), [0, 0, room.c0 / 2], [-Math.PI / 2, 0, 0]), C.floor);
  add(placed(new PlaneGeometry(rw, rd), [0, room.h, room.c0 / 2], [Math.PI / 2, 0, 0]), C.ceiling);
  add(placed(new PlaneGeometry(rw, room.h - 1.5), [0, 1.5 + (room.h - 1.5) / 2, room.c0]), C.plaster);
  add(placed(new PlaneGeometry(rw, 1.5), [0, 0.75, room.c0]), C.backTile);
  // dark wood panelling and a picture where people sit
  bx([-2.15, 0.5, room.c0 + 0.02], [3.6, 1.0, 0.04], C.panel);
  bx([room.a0 + 0.02, 0.5, room.c0 / 2], [0.04, 1.0, rd], C.panel);
  bx([-2.3, 1.85, room.c0 + 0.03], [0.9, 0.66, 0.04], C.wood);
  bx([-2.3, 1.85, room.c0 + 0.05], [0.78, 0.54, 0.02], C.print);
  add(placed(new PlaneGeometry(rd, room.h), [room.a0, room.h / 2, room.c0 / 2], [0, Math.PI / 2, 0]), C.plaster);
  add(placed(new PlaneGeometry(rd, room.h), [room.a1, room.h / 2, room.c0 / 2], [0, -Math.PI / 2, 0]), C.plaster);

  // the counter, the espresso machine, a grinder, cups
  bx([1.5, 0.5, -2.65], [3.6, 1.0, 0.6], C.green);
  bx([1.5, 1.03, -2.65], [3.7, 0.06, 0.7], C.oak);
  bx([2.4, 1.25, -2.75], [0.75, 0.38, 0.42], C.steel);
  bx([2.4, 1.1, -2.47], [0.6, 0.03, 0.14], C.iron);
  for (let i = 0; i < 4; i++) add(cyl([2.15 + i * 0.16, 1.48, -2.75], 0.045, 0.04, 0.07, 8), C.marble);
  add(cyl([1.6, 1.22, -2.75], 0.07, 0.07, 0.3, 10), C.iron);
  add(cyl([1.6, 1.45, -2.75], 0.09, 0.05, 0.16, 10), C.steel);

  // the back bar: three oak shelves of jars and tins
  const jar = [C.marble, "#c99a55", C.backTile, "#5d6d4a", "#b8794f", C.marble];
  for (const [n, y] of [1.55, 1.95, 2.35].entries()) {
    bx([1.7, y, -3.48], [3.8, 0.03, 0.24], C.oak);
    for (let i = 0; i < 13; i++) {
      const h = 0.12 + 0.06 * ((i * 7 + n * 3) % 3) * 0.5;
      add(cyl([-0.08 + i * 0.27 + (n % 2) * 0.08, y + 0.015 + h / 2, -3.47], 0.055, 0.055, h, 8), jar[(i + n * 2) % jar.length]);
    }
  }

  // tables by the window, a second row, chairs, a banquette along the far wall
  const table = (a: number, c: number) => {
    add(cyl([a, 0.74, c], 0.27, 0.27, 0.035, 16), C.marble);
    add(cyl([a, 0.37, c], 0.03, 0.03, 0.72, 6), C.iron);
    add(cyl([a, 0.02, c], 0.18, 0.2, 0.04, 12), C.iron);
  };
  /** A bentwood chair at a, c facing `turn` (0: towards the street). */
  const chair = (a: number, c: number, turn: number) => {
    const [fx, fz] = [Math.sin(turn), Math.cos(turn)];
    const at = (u: number, y: number, v: number): V3 => [a + u * fz + v * fx, y, c - u * fx + v * fz]; // u across, v forward
    add(cyl([a, 0.46, c], 0.18, 0.18, 0.035, 12), C.wood);
    for (const [u, v] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) bx(at(u, 0.23, v), [0.025, 0.46, 0.025], C.wood);
    for (const u of [-0.13, 0.13]) bx(at(u, 0.68, -0.15), [0.025, 0.44, 0.025], C.wood);
    add(box(at(0, 0.86, -0.15), [0.3, 0.08, 0.025], [0, turn, 0]), C.wood);
  };
  for (const a of [-2.75, -0.95]) {
    table(a, -0.9);
    chair(a, -1.35, 0);
    chair(a + 0.5, -0.9, -Math.PI / 2);
  }
  for (const a of [-2.5, -0.9]) {
    table(a, -2.2);
    chair(a, -2.65, 0);
    chair(a + 0.5, -2.2, -Math.PI / 2);
  }
  bx([-3.75, 0.22, -2.0], [0.4, 0.44, 2.8], C.wood);
  bx([-3.9, 0.75, -2.0], [0.1, 0.62, 2.8], "#4b3324");

  // pendant lamps: cord, brass cap, opal shade
  for (const [a, c, y] of [[-2.75, -0.9, 2.0], [-0.95, -0.9, 2.0], [0.9, -2.6, 2.15], [2.4, -2.6, 2.15], [-1.7, -2.2, 2.2]]) {
    bx([a, (y + room.h) / 2, c], [0.012, room.h - y, 0.012], C.iron);
    add(cyl([a, y + 0.02, c], 0.03, 0.04, 0.05, 8), C.brass);
    add(cyl([a, y - 0.06, c], 0.06, 0.17, 0.13, 16), C.opal, 3);
  }

  // plants: a big one in the window, one on the counter, one trailing off the top shelf
  const leaves = (a: number, y: number, c: number, r: number, hex: string) => add(placed(new IcosahedronGeometry(r, 0), [a, y, c], [0.4, a, 0.3]), hex);
  add(cyl([-3.5, 0.17, -0.45], 0.17, 0.13, 0.34, 12), C.pot);
  leaves(-3.5, 0.75, -0.45, 0.3, C.leaf);
  leaves(-3.38, 1.1, -0.52, 0.24, C.leaf2);
  leaves(-3.58, 1.36, -0.4, 0.19, C.leaf);
  add(cyl([-0.1, 1.15, -2.65], 0.09, 0.07, 0.18, 10), C.backTile);
  leaves(-0.1, 1.38, -2.65, 0.17, C.leaf2);
  leaves(3.3, 2.52, -3.45, 0.16, C.leaf);
  leaves(3.38, 2.3, -3.4, 0.11, C.leaf2);
  return merged(out);
}

/** The building, the painted parts and the glass, in local coordinates (see SHOP). */
export function shopParts() {
  const glass: BufferGeometry[] = [];
  const front = frontGeometry(glass);
  return { shell: shellGeometry(), front, interior: interiorGeometry(), glass: merged(glass) };
}

// ---------------------------------------------------------------------------
// Materials

/** Vertex-coloured paint; `aGlow` scales a warm emissive (its intensity follows the hour). */
function paintedMaterial() {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: "#ffc98c", emissiveIntensity: 0 });
  m.customProgramCacheKey = () => "shop-painted";
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nvarying float vGlow;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;")
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= diffuseColor.rgb * vGlow;");
  };
  return m;
}

/**
 * Clear shop glass: you see the cafe straight on; at a glancing angle it
 * mirrors the sky by fresnel, like the house windows (houseMaterial).
 */
function glassMaterial() {
  const m = new MeshStandardMaterial({ color: "#0e1417", roughness: 0.05, transparent: true, depthWrite: false });
  m.customProgramCacheKey = () => "shop-glass";
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = facadeNight;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGPos;\nvarying vec3 vGNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGNrm = normalize(mat3(modelMatrix) * objectNormal);");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uNight;\nvarying vec3 vGPos;\nvarying vec3 vGNrm;").replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `
      vec3 gV = normalize(vGPos - cameraPosition);
      vec3 gN = normalize(vGNrm);
      vec3 gR = reflect(gV, gN);
      #ifdef USE_FOG
        vec3 gHor = fogColor;
      #else
        vec3 gHor = vec3(0.85, 0.86, 0.88);
      #endif
      vec3 gZen = mix(vec3(0.32, 0.48, 0.78), vec3(0.02, 0.03, 0.06), uNight);
      totalEmissiveRadiance += mix(gHor, gZen, smoothstep(0.0, 0.6, abs(gR.y))) * (gR.y > 0.0 ? 1.0 : 0.75);
      diffuseColor.a = 0.07 + 0.8 * pow(1.0 - abs(dot(gV, gN)), 1.6);`,
    );
  };
  return m;
}

const ONE = [0];
/** The building wears one of the row houses' paint schemes. */
const PAINT = PALETTES.findIndex((p) => p.name === "cream");
const paintAttribute = { aPalette: () => PAINT };
const placeShell = (_: number, o: Object3D) => {
  o.position.set(local.x, local.ground, local.z);
};
const LAMP = [SHOP.lamp];

/** 07:00 Hayes Valley shop. The sign shows the visitor's brand. */
export function Shopfront() {
  const { siding } = useLandmarkTextures();
  const sign = useSign(useBrand(), { bg: "#efe6d0", fg: "#1f3b2f", panel: SHOP_SIGN });
  // the gooseneck lamps light the sign at night
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.7, emissive: "#fff1d8", emissiveMap: sign, emissiveIntensity: 0 }), [sign]);
  useNightGlow(signMat, 0.55, 0);
  // (no shingled roof here: the siding stands in for the shingles)
  const m = useMemo(() => ({ house: houseMaterial(siding, siding, palette()), painted: paintedMaterial(), glass: glassMaterial() }), [siding]);
  // the cafe is lit in the morning, brighter at night
  useNightGlow(m.painted, 1.1, 0.3);
  const parts = useMemo(() => {
    const p = shopParts();
    return { shell: p.shell, painted: merged([p.front, p.interior]), glass: p.glass };
  }, []);
  return (
    <>
      <Instances items={ONE} geometry={parts.shell} material={m.house} attributes={paintAttribute} place={placeShell} />
      <group position={[local.x, local.ground, local.z]}>
        <mesh geometry={parts.painted} material={m.painted} castShadow receiveShadow />
        <mesh geometry={parts.glass} material={m.glass} />
        {/* the visitor's brand on the fascia */}
        <mesh position={[...SHOP.sign]} material={signMat}>
          <planeGeometry args={SHOP_SIGN} />
        </mesh>
      </group>
      <Lamps lamps={LAMP} />
    </>
  );
}
