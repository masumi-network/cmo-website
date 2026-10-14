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
// Draw calls: building 1, painted shopfront and sidewalk 1, cafe 1, glass 1,
// sign 1, corner lamp 2 (the city's acorn lamp, street.tsx).

import { useLayoutEffect, useMemo } from "react";
import { BoxGeometry, CatmullRomCurve3, Color, Float32BufferAttribute, LatheGeometry, MeshStandardMaterial, PlaneGeometry, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3, type BufferGeometry, type Object3D, type Texture } from "three";
import { heightAt } from "@/lib/terrain";
import { facadeNight } from "./facade";
import { PALETTES, SLOT, builder, palette, type Frame, type Rect } from "./house-models";
import { box, cyl, drawn, merged, placed, placer, useLandmarkTextures } from "./landmark-kit";
import { glassMaterial, houseMaterial } from "./materials";
import { Instances, useBrand, type V3 } from "./parts";
import { LIVE, useInterior, useNightGlow } from "./shared";
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
  k.box(FRONT, -W / 2, W / 2, ROOF - 0.12, ROOF, -D, 0, SLOT.tar); // a slab, so it shades the cafe
  k.box(FRONT, -3.3, -2.9, ROOF, ROOF + 0.6, -4.1, -3.7, SLOT.brick);
  return k.geometry();
}

// ---------------------------------------------------------------------------
// Painted parts: plain boxes, cylinders and planes with a vertex colour, a
// glow (`aGlow`: 0 outside, 1 the cafe, more for lamp shades and bulbs) and a
// surface (`aMat`, CAFE_MAT) the shader dresses: wood grain, floorboards,
// bevelled tile, pressed tin, marble, glaze, chrome, leather, the canvas.

/** Surfaces the painted material draws (aMat). */
export const CAFE_MAT = { plain: 0, wood: 1, floor: 2, tile: 3, marble: 4, glaze: 5, leaf: 6, art: 7, plaster: 8, metal: 9, boards: 10, chrome: 11, leather: 12, tin: 13 } as const;
type Mat = (typeof CAFE_MAT)[keyof typeof CAFE_MAT];

const C = {
  // the shopfront and the sidewalk
  green: "#2f5141",
  brass: "#a2874f",
  iron: "#262b29",
  tile: "#d9d3c5",
  stone: "#a9a59c",
  wood: "#6b4529",
  marble: "#ebe7de",
  bulb: "#fff1d8",
  chalk: "#212725",
  chalkLine: "#d8d4c8",
  // the cafe
  oak: "#86552f",
  floor: "#7a4f30",
  plaster: "#ead9bc",
  ceiling: "#ebe3d0",
  subway: "#eeece6",
  wainscot: "#2f5141",
  beam: "#5b3a24",
  frame: "#5c3b24",
  bent: "#4a2c1b",
  leather: "#7a3f22",
  enamel: "#f2eee6",
  opal: "#fff4dc",
  chrome: "#d9dcde",
  beans: "#3a2619",
  tea: "#7a6a3a",
  pane: "#e6ece9",
  pastry: "#c88a3e",
  muffin: "#7a4a2b",
  muffinTop: "#8a5531",
  kraft: "#b8905f",
  screen: "#2a3236",
  planter: "#e9e3d6",
  pot: "#b5724f",
  trunk: "#6b5640",
  cord: "#c9b48e",
  books: ["#3d5249", "#8a4a32", "#2f3d52", "#d8cdb4", "#b08a3e"],
};

function tint(g: BufferGeometry, hex: string, glow: number, mat: Mat = CAFE_MAT.plain) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  g.setAttribute("color", new Float32BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.setAttribute("aMat", new Float32BufferAttribute(new Float32Array(n).fill(mat), 1));
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
  const p = (side: Side, a0: number, a1: number, b0: number, b1: number, c0: number, c1: number, hex: string) =>
    out.push(tint(slab(side, a0, a1, b0, b1, c0, c1), hex, 0, hex === C.wood ? CAFE_MAT.wood : hex === C.brass ? CAFE_MAT.metal : CAFE_MAT.plain));

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

// ---------------------------------------------------------------------------
// The cafe inside: a crafted miniature (reference: design/prompts/cafe-interior.jpg).
// Turned and bent parts (lathe, tube), one small canvas for the pictures,
// light baked in the shader. All of it is one draw call.

/** The room inside: a0..a1 across, c0 (the back wall) to the shopfront, h the ceiling. */
export const ROOM = { a0: -3.95, a1: 3.95, c0: -3.6, h: 3.3 };
/** Where the pendant lamps hang (a, shade height, c) and the cafe tables stand (a, c): the shader lights and shades round them. */
export const PENDANTS: V3[] = [[-2.7, 2.05, -0.95], [-1.05, 2.05, -0.95], [-1.9, 2.2, -2.62], [0.75, 2.25, -2.65], [2.35, 2.25, -2.65]];
export const TABLES: [number, number][] = [[-2.7, -0.95], [-1.05, -0.95], [-2.65, -2.72], [-1.15, -2.72]];
/** The chairs [a, c, turn]: two at each window table (behind and beside it), one facing the banquette at the others. */
const CHAIRS: V3[] = TABLES.flatMap(([a, c], k): V3[] => (k < 2 ? [[a, c - 0.47, 0], [a + 0.5, c - 0.05, -Math.PI / 2]] : [[a, c + 0.46, Math.PI]]));
const STOOLS: [number, number][] = [[0.55, -2.05], [1.45, -2.05], [2.35, -2.05]];
const COUNTER = { a0: -0.15, a1: 3.45, c0: -2.95, c1: -2.38, h: 1.0 };
const BANQUETTE = { a0: -3.93, a1: -0.55, c0: -3.58, c1: -3.08 };
const SHELVES = [1.62, 2.1];

/**
 * The cafe's one canvas (512 x 256, drawn at load, nothing to fetch): two leaf
 * sprites, the chalk menu, two framed prints, the coffee-bag label.
 * Regions are [x, y, w, h] in pixels from the top left.
 */
export const ATLAS = {
  w: 512,
  h: 256,
  leaves: [0, 0, 128, 128],
  fig: [0, 128, 128, 128],
  menu: [128, 0, 384, 120],
  print1: [128, 124, 96, 128],
  print2: [228, 124, 96, 128],
  bag: [328, 124, 64, 96],
} as const;
type Region = readonly [number, number, number, number];

/** Maps a part's 0..1 uv onto a region of the canvas. */
function region(g: BufferGeometry, [x, y, w, h]: Region) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + uv.getX(i) * w) / ATLAS.w, 1 - (y + h - uv.getY(i) * h) / ATLAS.h);
  return g;
}

/** What the menu board and the coffee bags say: the visitor's brand first. */
export function cafeText(brand: string) {
  return {
    menu: [brand, "Espresso|3.5", "Cortado|4.5", "Flat white|5", "Pour over|6", "Cold brew|5.5", "Croissant|4", "Banana bread|4.5"],
    bag: brand,
  };
}

function seeded(seed: number) {
  let v = seed;
  return () => ((v = (v * 16807) % 2147483647) / 2147483647);
}

const lathe = (profile: [number, number][], seg: number) => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), seg);
const tube = (pts: V3[], r: number, seg: number, radial = 5) => new TubeGeometry(new CatmullRomCurve3(pts.map((p) => new Vector3(...p))), seg, r, radial, false);
/** Moves parts built round the origin to p, turned by ry. */
function put(parts: BufferGeometry[], p: V3, ry = 0) {
  placer.position.set(...p);
  placer.rotation.set(0, ry, 0);
  placer.scale.set(1, 1, 1);
  placer.updateMatrix();
  for (const g of parts) g.applyMatrix4(placer.matrix);
  return parts;
}

// Parts, each built round its own origin on the floor (or on the surface it stands on), facing +c.
type Kit = (g: BufferGeometry, hex: string, mat: Mat, glow?: number) => BufferGeometry;

/** A bentwood chair: turned seat, splayed legs, one bent rod for the back legs and hoop, an inner loop, a leg ring. */
function chair(t: Kit) {
  const M = CAFE_MAT;
  const w = (g: BufferGeometry) => t(g, C.bent, M.wood);
  return [
    w(lathe([[0, 0.43], [0.165, 0.43], [0.18, 0.445], [0.175, 0.465], [0, 0.468]], 14)),
    ...[-1, 1].map((s) => w(tube([[s * 0.15, 0.012, 0.14], [s * 0.13, 0.22, 0.115], [s * 0.12, 0.43, 0.1]], 0.012, 3, 5))),
    w(tube([[-0.14, 0.013, -0.17], [-0.125, 0.43, -0.12], [-0.115, 0.66, -0.15], [-0.085, 0.84, -0.17], [0, 0.885, -0.175], [0.085, 0.84, -0.17], [0.115, 0.66, -0.15], [0.125, 0.43, -0.12], [0.14, 0.013, -0.17]], 0.013, 24, 5)),
    w(tube([[-0.075, 0.47, -0.125], [-0.085, 0.62, -0.15], [0, 0.72, -0.16], [0.085, 0.62, -0.15], [0.075, 0.47, -0.125]], 0.009, 10, 4)),
    w(placed(new TorusGeometry(0.135, 0.008, 4, 16), [0, 0.2, -0.015], [Math.PI / 2, 0, 0])),
  ];
}

/** A cup on its saucer (or `bare`), glazed white. */
function cup(t: Kit, bare = false) {
  const g = [t(lathe([[0, 0], [0.026, 0], [0.03, 0.005], [0.034, 0.05], [0.036, 0.058], [0.032, 0.058], [0.029, 0.012], [0, 0.012]], 8), C.marble, CAFE_MAT.glaze)];
  if (!bare) g.push(t(lathe([[0, -0.006], [0.05, -0.004], [0.06, 0.004], [0.057, 0.006], [0, 0.0]], 8), C.marble, CAFE_MAT.glaze));
  return g;
}

/** A round marble table on a cast-iron pedestal with three curled feet, a cup on it. */
function table(t: Kit) {
  const M = CAFE_MAT;
  return [
    t(cyl([0, 0.735, 0], 0.28, 0.28, 0.03, 24), C.marble, M.marble),
    t(lathe([[0, 0.04], [0.05, 0.04], [0.04, 0.1], [0.027, 0.16], [0.023, 0.4], [0.03, 0.56], [0.025, 0.64], [0.06, 0.69], [0.1, 0.705], [0.1, 0.72], [0, 0.72]], 10), C.iron, M.metal),
    ...[0, 1, 2].map((k) => t(placed(tube([[0, 0.07, 0], [0.1, 0.05, 0], [0.19, 0.022, 0], [0.23, 0.017, 0], [0.245, 0.03, 0]], 0.015, 6, 4), [0, 0, 0], [0, (k * Math.PI * 2) / 3, 0]), C.iron, M.metal)),
    ...put(cup(t), [0.09, 0.756, 0.07]),
  ];
}

/** A turned wooden counter stool with a foot ring. */
function stool(t: Kit) {
  const w = (g: BufferGeometry) => t(g, C.bent, CAFE_MAT.wood);
  return [
    w(lathe([[0, 0.69], [0.155, 0.69], [0.17, 0.705], [0.165, 0.735], [0, 0.74]], 14)),
    ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) => w(tube([[sx * 0.09, 0.69, sz * 0.09], [sx * 0.155, 0.014, sz * 0.155]], 0.014, 1, 5))),
    w(placed(new TorusGeometry(0.17, 0.009, 4, 16), [0, 0.25, 0], [Math.PI / 2, 0, 0])),
  ];
}

/** A pendant: ceiling rose, cord, brass socket, white enamel shade glowing inside, a bulb that blooms. */
function pendant(t: Kit, y: number) {
  const M = CAFE_MAT;
  const top = ROOM.h - y;
  return [
    t(cyl([0, top - 0.012, 0], 0.055, 0.06, 0.024, 12), C.ceiling, M.plaster),
    t(box([0, (top + 0.12) / 2, 0], [0.01, top - 0.12, 0.01]), C.iron, M.plain),
    t(lathe([[0, 0.06], [0.022, 0.06], [0.022, 0.11], [0.014, 0.13], [0, 0.13]], 10), C.brass, M.metal),
    // outer (bottom up: faces out) and inner (top down: faces in) enamel
    t(lathe([[0.196, -0.065], [0.19, -0.06], [0.165, -0.02], [0.12, 0.03], [0.06, 0.058], [0.025, 0.065]], 18), C.enamel, M.glaze),
    t(lathe([[0.022, 0.058], [0.058, 0.05], [0.115, 0.023], [0.158, -0.02], [0.185, -0.062]], 18), C.opal, M.plain, 2.6),
    t(placed(new SphereGeometry(0.034, 10, 8), [0, -0.025, 0]), C.bulb, M.plain, 6),
  ];
}

/** A chrome two-group espresso machine with a green enamel panel, gauges, portafilters, a steam wand and cups warming on top. */
function espresso(t: Kit) {
  const M = CAFE_MAT;
  const chrome = (g: BufferGeometry) => t(g, C.chrome, M.chrome);
  const g = [
    chrome(box([0, 0.2, 0], [0.74, 0.32, 0.4])),
    chrome(box([0, 0.375, 0], [0.7, 0.03, 0.36])),
    t(box([0, 0.28, 0.202], [0.6, 0.11, 0.008]), C.green, M.glaze),
    chrome(box([0, 0.03, 0.235], [0.66, 0.025, 0.14])),
    ...[-0.18, 0.18].flatMap((x) => [
      chrome(cyl([x, 0.115, 0.23], 0.05, 0.05, 0.05, 12)),
      chrome(cyl([x, 0.08, 0.235], 0.04, 0.035, 0.03, 12)),
      t(box([x, 0.08, 0.32], [0.024, 0.024, 0.13], [-0.15, 0, 0]), C.iron, M.plain),
    ]),
    ...[-0.08, 0.08].map((x) => t(cyl([x, 0.3, 0.207], 0.03, 0.03, 0.01, 12, [Math.PI / 2, 0, 0]), C.marble, M.glaze, 1.4)),
    chrome(tube([[0.34, 0.22, 0.19], [0.37, 0.17, 0.25], [0.37, 0.06, 0.27]], 0.008, 6, 4)),
    ...[[-0.33, -0.17], [0.33, -0.17], [-0.33, 0.17], [0.33, 0.17]].map(([x, z]) => chrome(cyl([x, 0.02, z], 0.02, 0.025, 0.04, 8))),
  ];
  for (const [x, z] of [[-0.2, -0.06], [-0.08, 0.05], [0.06, -0.05], [0.2, 0.06]]) g.push(...put(cup(t, true), [x, 0.39, z]));
  return g;
}

/** A grinder: black base, chrome body, a hopper of beans. */
function grinder(t: Kit) {
  const M = CAFE_MAT;
  return [
    t(box([0, 0.05, 0], [0.18, 0.1, 0.24]), C.iron, M.plain),
    t(cyl([0, 0.2, -0.02], 0.065, 0.075, 0.2, 14), C.chrome, M.chrome),
    t(cyl([0, 0.16, 0.08], 0.018, 0.018, 0.04, 8, [Math.PI / 2, 0, 0]), C.chrome, M.chrome),
    t(lathe([[0.03, 0.3], [0.09, 0.42], [0.095, 0.44], [0, 0.44]], 14), C.beans, M.glaze),
    t(cyl([0, 0.455, -0.0], 0.097, 0.097, 0.03, 14), C.iron, M.plain),
  ];
}

/** A small framed pastry case: base, chrome posts and rails, a glass shelf, croissants and muffins. */
function pastryCase(t: Kit) {
  const M = CAFE_MAT;
  const [w, d, h] = [0.66, 0.42, 0.36];
  const g = [t(box([0, 0.02, 0], [w, 0.04, d]), C.oak, M.wood), t(box([0, 0.19, 0], [w - 0.04, 0.008, d - 0.04]), C.pane, M.glaze)];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.push(t(box([(x * (w - 0.02)) / 2, h / 2, (z * (d - 0.02)) / 2], [0.016, h, 0.016]), C.chrome, M.chrome));
  for (const z of [-1, 1]) g.push(t(box([0, h, (z * (d - 0.02)) / 2], [w, 0.016, 0.016]), C.chrome, M.chrome));
  for (const x of [-1, 1]) g.push(t(box([(x * (w - 0.02)) / 2, h, 0], [0.016, 0.016, d]), C.chrome, M.chrome));
  const croissant = (p: V3, r: number) => t(placed(new TorusGeometry(0.032, 0.017, 5, 8, Math.PI * 1.25), p, [Math.PI / 2, 0, r]), C.pastry, M.glaze);
  [[-0.2, 0.06, 0.05], [-0.05, 0.06, -0.06], [0.12, 0.06, 0.06], [-0.18, 0.21, -0.05], [0.02, 0.21, 0.07]].forEach(([x, y, z], i) => g.push(croissant([x, y, z], i * 1.3)));
  for (const [x, z] of [[0.2, -0.08], [0.2, 0.07]]) g.push(t(cyl([x, 0.235, z], 0.035, 0.028, 0.045, 10), C.muffin, M.plain), t(placed(new SphereGeometry(0.04, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), [x, 0.255, z]), C.muffinTop, M.plain));
  return g;
}

/** A kraft coffee bag with the brand on its label (canvas). */
function bag(t: Kit) {
  return [
    t(box([0, 0.095, 0], [0.13, 0.19, 0.075]), C.kraft, CAFE_MAT.wood),
    t(box([0, 0.2, -0.005], [0.13, 0.025, 0.05], [0.25, 0, 0]), C.kraft, CAFE_MAT.wood),
    t(region(placed(new PlaneGeometry(0.105, 0.14), [0, 0.095, 0.0385]), ATLAS.bag), "#ffffff", CAFE_MAT.art),
  ];
}

/** A glass jar of beans (or tea) with a lid. */
function jar(t: Kit, hex: string, h = 0.15) {
  return [
    t(lathe([[0, 0], [0.045, 0], [0.05, 0.01], [0.05, h - 0.03], [0.04, h - 0.015], [0, h - 0.015]], 10), hex, CAFE_MAT.glaze),
    t(cyl([0, h - 0.008, 0], 0.036, 0.036, 0.016, 10), C.chrome, CAFE_MAT.chrome),
  ];
}

/**
 * A leafy plant: crossed leaf cards (a canvas sprite, both faces) scattered
 * through a canopy, normals turned out from its middle so it shades like a
 * bush, not like flat cards.
 */
function plant(t: Kit, at: V3, radius: number, height: number, cards: number, size: number, seed: number, sprite: Region, hang = false) {
  const out: BufferGeometry[] = [];
  const rnd = seeded(seed);
  const mid: V3 = [at[0], at[1] + height * (hang ? 0.7 : 0.45), at[2]];
  for (let i = 0; i < cards; i++) {
    const ang = rnd() * Math.PI * 2;
    const r = radius * Math.sqrt(rnd());
    const p: V3 = [at[0] + Math.cos(ang) * r, at[1] + rnd() * height, at[2] + Math.sin(ang) * r * 0.8];
    const turn: V3 = [(rnd() - 0.5) * (hang ? 0.5 : 0.9), rnd() * Math.PI, (rnd() - 0.5) * 0.7 + (hang ? Math.PI : 0)];
    const k = size * (0.75 + 0.5 * rnd());
    for (const back of [false, true]) {
      const g = region(new PlaneGeometry(k, k), sprite);
      if (back) g.rotateY(Math.PI);
      placed(g, p, turn);
      const pos = g.attributes.position;
      const nrm = g.attributes.normal;
      for (let j = 0; j < pos.count; j++) {
        const v = new Vector3(pos.getX(j) - mid[0], pos.getY(j) - mid[1], pos.getZ(j) - mid[2]).normalize();
        v.y += 0.6;
        v.normalize();
        nrm.setXYZ(j, v.x, v.y, v.z);
      }
      out.push(t(g, i % 3 ? "#ffffff" : "#dfe8d2", CAFE_MAT.leaf));
    }
  }
  return out;
}

function interiorGeometry() {
  const M = CAFE_MAT;
  const out: BufferGeometry[] = [];
  const t: Kit = (g, hex, mat, glow = 1) => tint(g, hex, glow, mat);
  const add = (g: BufferGeometry, hex: string, mat: Mat = M.plain, glow = 1) => out.push(t(g, hex, mat, glow));
  const bx = (p: V3, s: V3, hex: string, mat: Mat = M.plain) => add(box(p, s), hex, mat);
  const plane = (w: number, h: number, p: V3, r?: V3) => placed(new PlaneGeometry(w, h), p, r);
  const room = ROOM;
  const [rw, rd] = [room.a1 - room.a0, -room.c0];
  const tileTop = 2.55;
  const dado = 1.1;
  const split = -0.5; // seating (west) and bar (east) along the back wall

  // floor, pressed-tin ceiling with two beams and a crown moulding
  add(plane(rw, rd, [0, 0, room.c0 / 2], [-Math.PI / 2, 0, 0]), C.floor, M.floor);
  add(plane(rw, rd, [0, room.h, room.c0 / 2], [Math.PI / 2, 0, 0]), C.ceiling, M.tin);
  for (const c of [-1.4, -2.25]) bx([0, room.h - 0.075, c], [rw, 0.15, 0.13], C.beam, M.wood);
  bx([0, room.h - 0.04, room.c0 + 0.04], [rw, 0.08, 0.08], C.ceiling, M.plaster);
  for (const s of [-1, 1]) bx([s * (room.a1 - 0.04), room.h - 0.04, room.c0 / 2], [0.08, 0.08, rd], C.ceiling, M.plaster);

  // back wall: white bevelled subway tile behind the bar, beadboard wainscot and a dado rail where people sit, plaster above
  add(plane(rw, room.h - tileTop, [0, (room.h + tileTop) / 2, room.c0]), C.plaster, M.plaster);
  add(plane(room.a1 - split, tileTop, [(room.a1 + split) / 2, tileTop / 2, room.c0]), C.subway, M.tile);
  add(plane(split - room.a0, tileTop - dado, [(split + room.a0) / 2, (tileTop + dado) / 2, room.c0]), C.plaster, M.plaster);
  bx([(split + room.a0) / 2, dado / 2, room.c0 + 0.01], [split - room.a0, dado, 0.02], C.wainscot, M.boards);
  bx([(split + room.a0) / 2, dado, room.c0 + 0.03], [split - room.a0, 0.05, 0.05], C.oak, M.wood);
  // the side walls: plaster, the seating side with wainscot too, skirting on the bar side
  add(plane(rd, room.h, [room.a0, room.h / 2, room.c0 / 2], [0, Math.PI / 2, 0]), C.plaster, M.plaster);
  add(plane(rd, room.h, [room.a1, room.h / 2, room.c0 / 2], [0, -Math.PI / 2, 0]), C.plaster, M.plaster);
  bx([room.a0 + 0.01, dado / 2, room.c0 / 2], [0.02, dado, rd], C.wainscot, M.boards);
  bx([room.a0 + 0.03, dado, room.c0 / 2], [0.05, 0.05, rd], C.oak, M.wood);
  bx([room.a1 - 0.01, 0.05, room.c0 / 2], [0.02, 0.1, rd], C.beam, M.wood);
  // two framed prints over the banquette
  for (const [a, art] of [[-2.85, ATLAS.print1], [-1.65, ATLAS.print2]] as const) {
    bx([a, 1.72, room.c0 + 0.02], [0.4, 0.5, 0.03], C.frame, M.wood);
    add(region(plane(0.34, 0.44, [a, 1.72, room.c0 + 0.037]), art), "#ffffff", M.art);
  }

  // the banquette: a base, a seat with a rolled front, a tufted back with a rolled top
  const { a0: b0, a1: b1, c0: bc0, c1: bc1 } = BANQUETTE;
  const bm = (b0 + b1) / 2;
  const bl = b1 - b0;
  bx([bm, 0.18, (bc0 + bc1) / 2], [bl, 0.36, bc1 - bc0], C.wainscot, M.boards);
  bx([bm, 0.415, (bc0 + bc1) / 2 - 0.02], [bl, 0.11, bc1 - bc0 - 0.06], C.leather, M.leather);
  add(cyl([bm, 0.415, bc1 - 0.055], 0.055, 0.055, bl, 10, [0, 0, Math.PI / 2]), C.leather, M.leather);
  bx([bm, 0.73, bc0 + 0.09], [bl, 0.5, 0.14], C.leather, M.leather);
  add(cyl([bm, 0.98, bc0 + 0.1], 0.06, 0.06, bl, 10, [0, 0, Math.PI / 2]), C.leather, M.leather);
  bx([b1 + 0.04, 0.36, (bc0 + bc1) / 2], [0.08, 0.72, bc1 - bc0], C.wainscot, M.boards);

  // the counter: beadboard front in panels, a recessed kick board, a thick oak top with a rounded edge, a brass foot rail
  const { a0: k0, a1: k1, c0: kc0, c1: kc1, h: kh } = COUNTER;
  const km = (k0 + k1) / 2;
  const kl = k1 - k0;
  bx([km, (0.1 + kh) / 2, (kc0 + kc1) / 2], [kl, kh - 0.1, kc1 - kc0], C.green, M.boards);
  for (const a of [k0 + 0.02, k0 + kl / 3, k0 + (2 * kl) / 3, k1 - 0.02]) bx([a, (0.1 + kh) / 2, kc1 + 0.012], [0.07, kh - 0.1, 0.025], C.green, M.plain);
  bx([km, kh - 0.04, kc1 + 0.012], [kl, 0.06, 0.03], C.green, M.plain);
  bx([km, 0.05, kc1 - 0.03], [kl, 0.1, kc1 - kc0 - 0.06], C.beam, M.wood);
  bx([km, kh + 0.03, (kc0 + kc1) / 2 - 0.02], [kl + 0.1, 0.06, kc1 - kc0 + 0.08], C.oak, M.wood);
  add(cyl([km, kh + 0.03, kc1 + 0.06], 0.03, 0.03, kl + 0.1, 8, [0, 0, Math.PI / 2]), C.oak, M.wood);
  add(cyl([km, 0.2, kc1 + 0.1], 0.018, 0.018, kl - 0.1, 8, [0, 0, Math.PI / 2]), C.brass, M.chrome);
  for (const a of [k0 + 0.15, km, k1 - 0.15]) add(cyl([a, 0.2, kc1 + 0.05], 0.012, 0.012, 0.1, 6, [Math.PI / 2, 0, 0]), C.brass, M.chrome);
  // on it: the espresso machine, grinder, pastry case, a till, cups
  const on = kh + 0.06;
  out.push(...put(espresso(t), [1.75, on, -2.72]));
  out.push(...put(grinder(t), [0.95, on, -2.75]));
  out.push(...put(pastryCase(t), [3.0, on, -2.68]));
  add(box([0.2, on + 0.08, -2.68], [0.03, 0.16, 0.03], [0.3, 0, 0]), C.iron);
  add(box([0.2, on + 0.17, -2.66], [0.24, 0.17, 0.015], [-0.35, 0, 0]), C.screen, M.glaze, 1.6);
  for (const [a, n] of [[0.48, 4], [0.6, 3]] as const) for (let i = 0; i < n; i++) out.push(...put(cup(t, true), [a, on + i * 0.045, -2.62]));
  // three stools along it
  for (const [a, c] of STOOLS) out.push(...put(stool(t), [a, 0, c]));

  // the back bar: two oak shelves on iron brackets, a warm strip under each, bags, jars, cups, books, a plant; a chalk menu over them
  for (const y of SHELVES) {
    bx([1.7, y, room.c0 + 0.125], [3.8, 0.045, 0.25], C.oak, M.wood);
    add(box([1.7, y - 0.03, room.c0 + 0.235], [3.7, 0.012, 0.012]), C.bulb, M.plain, 3);
    for (const a of [-0.05, 1.7, 3.45]) bx([a, y - 0.07, room.c0 + 0.11], [0.02, 0.12, 0.2], C.iron, M.metal);
  }
  const shelf = (y: number, items: [string, number][]) => {
    for (const [kind, a] of items) {
      const p: V3 = [a, y + 0.0225, room.c0 + 0.12];
      if (kind === "bag") out.push(...put(bag(t), p));
      else if (kind === "jar") out.push(...put(jar(t, C.beans), p));
      else if (kind === "tea") out.push(...put(jar(t, C.tea, 0.12), p));
      else if (kind === "cup") out.push(...put(cup(t), p));
      else if (kind === "book") {
        const k = Math.round(a * 100);
        const h = 0.19 + (k % 5) * 0.015;
        add(box([a, p[1] + h / 2, p[2]], [0.045, h, 0.17]), C.books[k % C.books.length], M.plain);
      }
    }
  };
  shelf(SHELVES[0], [["bag", 0.0], ["bag", 0.16], ["bag", 0.32], ["jar", 0.6], ["jar", 0.72], ["tea", 0.84], ["cup", 1.12], ["cup", 1.26], ["bag", 1.9], ["bag", 2.06], ["jar", 2.34], ["jar", 2.46], ["cup", 2.8], ["cup", 2.94], ["tea", 3.3]]);
  shelf(SHELVES[1], [["book", -0.05], ["book", 0.0], ["book", 0.05], ["book", 0.1], ["book", 0.15], ["bag", 0.45], ["bag", 0.61], ["jar", 0.9], ["tea", 1.02], ["bag", 2.0], ["bag", 2.16], ["bag", 2.32], ["jar", 2.65], ["jar", 2.77], ["book", 3.2], ["book", 3.25], ["book", 3.3]]);
  add(box([3.42, SHELVES[1] + 0.12, room.c0 + 0.12], [0.045, 0.2, 0.17], [0, 0, 0.35]), C.books[1]);
  out.push(...plant(t, [1.5, SHELVES[0] + 0.12, room.c0 + 0.24], 0.05, 0.2, 6, 0.2, 3, ATLAS.leaves));
  add(cyl([1.5, SHELVES[0] + 0.0725, room.c0 + 0.14], 0.06, 0.05, 0.1, 10), C.pot, M.glaze);
  out.push(...plant(t, [1.45, SHELVES[1] - 0.18, room.c0 + 0.25], 0.05, 0.4, 7, 0.2, 5, ATLAS.leaves, true));
  add(cyl([1.45, SHELVES[1] + 0.0725, room.c0 + 0.14], 0.06, 0.05, 0.1, 10), C.marble, M.glaze);
  bx([1.7, 2.92, room.c0 + 0.02], [1.74, 0.6, 0.04], C.oak, M.wood);
  add(region(plane(1.6, 0.5, [1.7, 2.92, room.c0 + 0.041]), ATLAS.menu), "#ffffff", M.art);

  // tables by the window and by the banquette, bentwood chairs
  for (const [a, c] of TABLES) out.push(...put(table(t), [a, 0, c]));
  for (const [a, c, turn] of CHAIRS) out.push(...put(chair(t), [a, 0, c], turn));

  // pendants
  for (const [a, y, c] of PENDANTS) out.push(...put(pendant(t, y), [a, y, c]));

  // plants: a fiddle-leaf fig in the window, a hanging plant in the other window
  add(lathe([[0, 0], [0.15, 0], [0.18, 0.05], [0.2, 0.36], [0.21, 0.4], [0, 0.38]], 16).translate(-3.3, 0, -0.58), C.planter, M.glaze);
  add(tube([[-3.3, 0.35, -0.58], [-3.28, 0.9, -0.6], [-3.32, 1.4, -0.57]], 0.022, 6, 5), C.trunk, M.wood);
  out.push(...plant(t, [-3.3, 0.65, -0.6], 0.17, 1.25, 26, 0.44, 7, ATLAS.fig));
  for (const s of [-1, 0, 1]) add(tube([[0.15, room.h - 0.01, -0.4], [0.15 + s * 0.09, 2.3, -0.4 + (s === 0 ? 0.08 : -0.04)], [0.15 + s * 0.11, 2.12, -0.4]], 0.004, 4, 3), C.cord, M.plain);
  add(lathe([[0, 0], [0.08, 0], [0.12, 0.06], [0.13, 0.15], [0, 0.14]], 12).translate(0.15, 2.05, -0.4), C.planter, M.glaze);
  out.push(...plant(t, [0.15, 1.5, -0.4], 0.15, 0.65, 12, 0.3, 11, ATLAS.leaves, true));
  return merged(out);
}

/** The building, the painted parts and the glass, in local coordinates (see SHOP). */
export function shopParts() {
  const glass: BufferGeometry[] = [];
  const front = frontGeometry(glass);
  return { shell: shellGeometry(), front, interior: interiorGeometry(), glass: merged(glass) };
}

// ---------------------------------------------------------------------------
// The cafe's canvas

type Ctx = CanvasRenderingContext2D;
function within(ctx: Ctx, [x, y, w, h]: Region, draw: (w: number, h: number) => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.translate(x, y);
  draw(w, h);
  ctx.restore();
}

/** Glossy leaves on a transparent ground: small ovals (pothos), or a few big fiddle leaves. */
function leafSprite(ctx: Ctx, r: Region, fig: boolean, seed: number) {
  const rnd = seeded(seed);
  within(ctx, r, (w, h) => {
    const n = fig ? 7 : 40;
    for (let i = 0; i < n; i++) {
      const t = i / n; // back to front: darker first
      const ang = rnd() * Math.PI * 2;
      const rr = (fig ? 10 : 6) + rnd() * (fig ? 26 : 40);
      const [x, y] = [w / 2 + Math.cos(ang) * rr, h / 2 + Math.sin(ang) * rr * 0.9];
      const len = fig ? 44 + rnd() * 18 : 18 + rnd() * 16;
      const wide = len * (fig ? 0.62 : 0.5);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang + Math.PI / 2 + (rnd() - 0.5) * 0.9);
      ctx.beginPath();
      ctx.moveTo(0, len * 0.5);
      if (fig) {
        // a fiddle: narrow at the stem, wide and wavy near the tip
        ctx.bezierCurveTo(wide * 0.5, len * 0.3, wide * 0.35, 0, wide * 0.55, -len * 0.2);
        ctx.bezierCurveTo(wide * 0.7, -len * 0.45, wide * 0.1, -len * 0.55, 0, -len * 0.5);
        ctx.bezierCurveTo(-wide * 0.1, -len * 0.55, -wide * 0.7, -len * 0.45, -wide * 0.55, -len * 0.2);
        ctx.bezierCurveTo(-wide * 0.35, 0, -wide * 0.5, len * 0.3, 0, len * 0.5);
      } else {
        ctx.quadraticCurveTo(wide, 0, 0, -len * 0.5);
        ctx.quadraticCurveTo(-wide, 0, 0, len * 0.5);
      }
      ctx.fillStyle = `hsl(${(fig ? 95 : 100) + rnd() * 25}, ${38 + rnd() * 16}%, ${18 + t * 18 + rnd() * 8}%)`;
      ctx.fill();
      const g = ctx.createLinearGradient(-wide / 2, 0, wide / 2, 0);
      g.addColorStop(0, "rgba(255,255,230,0.2)");
      g.addColorStop(0.5, "rgba(255,255,230,0)");
      g.addColorStop(1, "rgba(0,20,0,0.25)");
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(225,240,195,0.45)";
      ctx.lineWidth = fig ? 1.4 : 0.8;
      ctx.beginPath();
      ctx.moveTo(0, len * 0.5);
      ctx.lineTo(0, -len * 0.45);
      if (fig) for (const k of [-0.25, 0, 0.25]) for (const s of [-1, 1]) {
        ctx.moveTo(0, len * k);
        ctx.lineTo(s * wide * 0.4, len * (k - 0.12));
      }
      ctx.stroke();
      ctx.restore();
    }
  });
}

/** A chalkboard: the brand as the heading, then the menu in two columns with prices, chalk dust over it. */
function chalkboard(ctx: Ctx, r: Region, lines: string[]) {
  const rnd = seeded(9);
  within(ctx, r, (w, h) => {
    ctx.fillStyle = "#23292a";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 14; i++) {
      const g = ctx.createRadialGradient(rnd() * w, rnd() * h, 0, rnd() * w, rnd() * h, 30 + rnd() * 50);
      g.addColorStop(0, "rgba(255,255,255,0.05)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    const [head, ...items] = lines;
    ctx.fillStyle = "#efede6";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 24;
    ctx.font = `700 ${size}px Georgia, serif`;
    while (ctx.measureText(head).width > w * 0.7 && size > 10) ctx.font = `700 ${(size -= 2)}px Georgia, serif`;
    ctx.fillText(head, w / 2, 20);
    ctx.fillRect(w / 2 - 50, 35, 100, 1.5);
    ctx.font = "italic 500 13px Georgia, serif";
    items.forEach((line, i) => {
      const [name, price] = line.split("|");
      const col = i < 4 ? 0 : 1;
      const x0 = 24 + col * (w / 2);
      const y = 54 + (i % 4) * 16;
      ctx.textAlign = "left";
      ctx.fillText(name, x0, y);
      ctx.textAlign = "right";
      ctx.fillText(price, x0 + w / 2 - 48, y);
    });
    // chalk: break the strokes up
    ctx.fillStyle = "rgba(35,41,42,0.55)";
    for (let i = 0; i < 1400; i++) ctx.fillRect(rnd() * w, rnd() * h, 1, 1);
  });
}

/** A framed print with a white mat: the bay at dawn with the Golden Gate's towers. */
function printBay(ctx: Ctx, r: Region) {
  within(ctx, r, (w, h) => {
    ctx.fillStyle = "#f3efe6";
    ctx.fillRect(0, 0, w, h);
    const [x, y, iw, ih] = [10, 10, w - 20, h - 20];
    const sky = ctx.createLinearGradient(0, y, 0, y + ih);
    sky.addColorStop(0, "#9fb6c8");
    sky.addColorStop(0.55, "#f1cfa6");
    sky.addColorStop(1, "#e8b48a");
    ctx.fillStyle = sky;
    ctx.fillRect(x, y, iw, ih);
    ctx.fillStyle = "#f7e2bd";
    ctx.beginPath();
    ctx.arc(x + iw * 0.68, y + ih * 0.5, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#7d8f86";
    ctx.beginPath();
    ctx.moveTo(x, y + ih * 0.66);
    ctx.quadraticCurveTo(x + iw * 0.3, y + ih * 0.52, x + iw * 0.55, y + ih * 0.64);
    ctx.lineTo(x + iw, y + ih * 0.6);
    ctx.lineTo(x + iw, y + ih);
    ctx.lineTo(x, y + ih);
    ctx.fill();
    ctx.fillStyle = "#5c7470";
    ctx.fillRect(x, y + ih * 0.78, iw, ih * 0.22);
    ctx.fillStyle = "#b8452e";
    for (const tx of [0.3, 0.72]) ctx.fillRect(x + iw * tx, y + ih * 0.36, 4, ih * 0.44);
    ctx.fillRect(x, y + ih * 0.66, iw, 2.5);
    ctx.strokeStyle = "#b8452e";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + ih * 0.5);
    ctx.quadraticCurveTo(x + iw * 0.15, y + ih * 0.62, x + iw * 0.3 + 2, y + ih * 0.37);
    ctx.quadraticCurveTo(x + iw * 0.51, y + ih * 0.64, x + iw * 0.72 + 2, y + ih * 0.37);
    ctx.quadraticCurveTo(x + iw * 0.88, y + ih * 0.62, x + iw, y + ih * 0.5);
    ctx.stroke();
  });
}

/** A framed print with a white mat: a coffee branch with leaves and red cherries, botanical style. */
function printBranch(ctx: Ctx, r: Region) {
  const rnd = seeded(4);
  within(ctx, r, (w, h) => {
    ctx.fillStyle = "#f3efe6";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#e9e1cf";
    ctx.fillRect(10, 10, w - 20, h - 20);
    ctx.strokeStyle = "#6b4f36";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h - 18);
    ctx.bezierCurveTo(w * 0.42, h * 0.6, w * 0.6, h * 0.4, w * 0.48, 20);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const t = 0.12 + i * 0.1;
      const [x, y] = [w * (0.5 - 0.02 * Math.sin(t * 6)), h - 18 - t * (h - 38)];
      const s = i % 2 ? 1 : -1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(s * (0.9 + rnd() * 0.3));
      ctx.fillStyle = `hsl(${105 + rnd() * 20}, 35%, ${30 + rnd() * 12}%)`;
      ctx.beginPath();
      ctx.ellipse(0, -14, 6, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (i % 3 === 1) {
        ctx.fillStyle = "#a8322a";
        for (const [dx, dy] of [[-5, 3], [1, 5], [6, 1]]) {
          ctx.beginPath();
          ctx.arc(x + dx, y + dy, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  });
}

/** A kraft bag front: folds, a cream label with the brand and a bean. */
function bagLabel(ctx: Ctx, r: Region, brand: string) {
  within(ctx, r, (w, h) => {
    ctx.fillStyle = "#b8905f";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(60,35,10,0.12)";
    ctx.fillRect(0, 0, 3, h);
    ctx.fillRect(w - 3, 0, 3, h);
    ctx.fillStyle = "#f2ebdc";
    ctx.fillRect(9, 26, w - 18, 44);
    ctx.fillStyle = "#1f3b2f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 12;
    ctx.font = `700 ${size}px Georgia, serif`;
    while (ctx.measureText(brand).width > w - 24 && size > 5) ctx.font = `700 ${(size -= 1)}px Georgia, serif`;
    ctx.fillText(brand, w / 2, 40);
    ctx.font = "500 6px Georgia, serif";
    ctx.fillText("HOUSE BLEND", w / 2, 58);
    ctx.fillStyle = "#5a3a22";
    ctx.beginPath();
    ctx.ellipse(w / 2, 82, 5, 7, 0.4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/** The cafe's canvas for the visitor's brand. */
function cafeAtlas(brand: string) {
  const { menu, bag } = cafeText(brand);
  return drawn(ATLAS.w, ATLAS.h, (ctx) => {
    leafSprite(ctx, ATLAS.leaves, false, 5);
    leafSprite(ctx, ATLAS.fig, true, 8);
    chalkboard(ctx, ATLAS.menu, menu);
    printBay(ctx, ATLAS.print1);
    printBranch(ctx, ATLAS.print2);
    bagLabel(ctx, ATLAS.bag, bag);
  });
}

// ---------------------------------------------------------------------------
// Materials

const glslList = (list: number[][]) => list.map((v) => `vec${v.length}(${v.map((n) => n.toFixed(3)).join(", ")})`).join(", ");

/**
 * Vertex-coloured paint. `aGlow` scales a warm emissive (its intensity follows
 * the hour); `aMat` picks a surface (CAFE_MAT): wood grain, floorboards,
 * bevelled tile, pressed tin, marble, glaze, chrome, tufted leather, beadboard,
 * the canvas (pictures, menu, labels, leaves). Inside the cafe (glow 1) the
 * light is baked from the room itself: daylight from the shopfront, fading to
 * the back; darker corners and floor edges; soft contact shadows under the
 * tables, the counter and the banquette; a warm pool under each pendant. No
 * real-time lights or shadows inside.
 */
function paintedMaterial(atlas: { value: Texture | null }) {
  const M = CAFE_MAT;
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, emissive: "#ffc98c", emissiveIntensity: 0 });
  m.customProgramCacheKey = () => "shop-painted";
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = facadeNight;
    s.uniforms.uAtlas = atlas;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nattribute float aMat;\nvarying float vGlow;\nvarying float vMat;\nvarying vec3 vLocal;\nvarying vec3 vObjN;\nvarying vec2 vAtlasUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;\nvMat = aMat;\nvLocal = position;\nvObjN = normal;\nvAtlasUv = uv;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform sampler2D uAtlas;
        varying float vGlow;
        varying float vMat;
        varying vec3 vLocal;
        varying vec3 vObjN;
        varying vec2 vAtlasUv;
        int sMat = 0;
        vec3 sP = vec3(0.0);
        vec3 sN = vec3(0.0, 1.0, 0.0);
        float sRough = -1.0;
        float sMetal = 0.0;
        float sGloss = 0.0;
        float sPool = 0.0;
        vec3 sAlbedo = vec3(0.0);
        vec3 sLight = vec3(0.0);
        float sSpec = 0.0;
        const vec3 PENDANTS[${PENDANTS.length}] = vec3[](${glslList(PENDANTS)});
        const float SHELVES_Y[${SHELVES.length}] = float[](${SHELVES.map((y) => y.toFixed(3)).join(", ")});
        const vec2 TABLES[${TABLES.length}] = vec2[](${glslList(TABLES)});
        const vec2 SEATS[${CHAIRS.length + STOOLS.length}] = vec2[](${glslList([...CHAIRS.map(([a, , c]) => [a, c]), ...STOOLS])});
        const vec3 WARM = vec3(1.0, 0.66, 0.34); // 2700 K
        const vec3 SUN = normalize(vec3(-0.45, -0.46, -1.0)); // low morning sun, in through the shopfront
        // the camera in the shop's own frame (the mesh sits at the shop's origin, unturned)
        vec3 sCam() { return cameraPosition - vec3(${local.x.toFixed(3)}, ${local.ground.toFixed(4)}, ${local.z.toFixed(3)}); }
        // 1 inside the shopfront's glass (display lights and transoms, less mullions and bars), seen from the room
        float sWindow(vec2 q) {
          float w = 0.025;
          float lights = smoothstep(-3.72, -3.66 + w, q.x) * (1.0 - smoothstep(2.14 - w, 2.2, q.x));
          float bars = (1.0 - smoothstep(0.03 - w, 0.03 + w, abs(q.x + 1.747))) + (1.0 - smoothstep(0.03 - w, 0.03 + w, abs(q.x - 0.227)));
          float low = smoothstep(0.62, 0.62 + w * 2.0, q.y) * (1.0 - smoothstep(2.25 - w, 2.25 + w, q.y));
          float high = smoothstep(2.33, 2.33 + w * 2.0, q.y) * (1.0 - smoothstep(2.62 - w * 2.0, 2.62, q.y));
          return clamp(lights * (low + high) - bars, 0.0, 1.0);
        }
        float sHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float sNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), f.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + 1.0), f.x), f.y);
        }
        // 1 on a grid line of cells \`size\` wide, anti-aliased
        float sLine(float x, float size, float w) {
          float d = abs(fract(x / size + 0.5) - 0.5) * size;
          return 1.0 - smoothstep(w, w + fwidth(x) * 1.2, d);
        }
        // soft shadow of a box (centre, half size) on the floor
        float sBox(vec2 p, vec2 c, vec2 h, float soft) {
          vec2 q = abs(p - c) - h;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
          return 1.0 - smoothstep(-0.02, soft, d);
        }
        // relief heights: a bevelled subway tile (0.15 x 0.075), a pressed-tin square (0.3) with a raised boss and border
        float sTile(vec2 q) {
          float row = floor(q.y / 0.075);
          vec2 f = vec2(fract((q.x + 0.075 * mod(row, 2.0)) / 0.15) * 0.15, fract(q.y / 0.075) * 0.075);
          float d = min(min(f.x, 0.15 - f.x), min(f.y, 0.075 - f.y));
          return smoothstep(0.0015, 0.008, d);
        }
        float sTin(vec2 q) {
          vec2 f = fract(q / 0.3) - 0.5;
          float edge = smoothstep(0.42, 0.46, max(abs(f.x), abs(f.y)));
          float boss = 1.0 - smoothstep(0.12, 0.2, length(f));
          float ring = smoothstep(0.24, 0.27, length(f)) * (1.0 - smoothstep(0.3, 0.33, length(f)));
          return 0.6 * boss + 0.5 * ring + 0.7 * edge;
        }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        {
          int mat = int(vMat + 0.5);
          vec3 p = vLocal;
          vec3 n = normalize(vObjN);
          sMat = mat;
          sP = p;
          sN = n;
          // along a wall, horizontally
          float along = abs(n.z) > abs(n.x) ? p.x : p.z;
          if (mat == ${M.leaf} || mat == ${M.art}) {
            vec4 l = texture2D(uAtlas, vAtlasUv);
            if (mat == ${M.leaf}) {
              if (l.a < 0.5) discard;
              diffuseColor.rgb *= l.rgb * 0.85;
              sRough = 0.45;
              sGloss = 0.3;
            } else {
              diffuseColor.rgb *= l.rgb;
              sRough = 0.85;
            }
          } else if (mat == ${M.wood}) {
            vec2 q = abs(n.y) > 0.5 ? vec2(p.x * 2.0, p.z * 46.0) : vec2(along * 2.0, p.y * 46.0);
            float g = 0.6 * sNoise(q) + 0.4 * sNoise(q * vec2(3.0, 0.35) + 7.0);
            diffuseColor.rgb *= 0.8 + 0.38 * g;
            sRough = 0.38;
            sGloss = 0.35;
          } else if (mat == ${M.floor}) {
            // oak boards 0.16 wide running across, butt joints staggered
            float row = floor(p.z / 0.16);
            float off = sHash(vec2(row, 3.0)) * 1.4;
            float col = floor((p.x + off) / 1.4);
            float tone = 0.76 + 0.38 * sHash(vec2(row, col));
            float seam = max(sLine(p.z, 0.16, 0.004), sLine(p.x + off, 1.4, 0.004));
            float g = sNoise(vec2(p.x * 2.5, p.z * 60.0));
            diffuseColor.rgb *= tone * (0.86 + 0.24 * g) * (1.0 - 0.45 * seam);
            sRough = 0.35;
            sGloss = 0.3;
          } else if (mat == ${M.tile}) {
            float h = sTile(vec2(along, p.y));
            diffuseColor.rgb *= mix(0.72, 0.97 + 0.05 * sHash(floor(vec2(along / 0.15, p.y / 0.075))), h);
            sRough = mix(0.7, 0.12, h);
            sGloss = 0.7 * h;
          } else if (mat == ${M.tin}) {
            diffuseColor.rgb *= 0.94 + 0.06 * sTin(p.xz);
            sRough = 0.4;
            sMetal = 0.25;
            sGloss = 0.2;
          } else if (mat == ${M.marble}) {
            vec2 q = p.xz * 7.0;
            float v = abs(sin(q.x * 1.3 + q.y * 0.7 + 4.0 * sNoise(q * 0.8)));
            diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.0, 0.25, v);
            sRough = 0.18;
            sGloss = 0.6;
          } else if (mat == ${M.glaze}) {
            sRough = 0.16;
            sGloss = 0.9;
          } else if (mat == ${M.chrome}) {
            sRough = 0.12;
            sMetal = 1.0;
            sGloss = 0.6;
          } else if (mat == ${M.leather}) {
            // deep-buttoned on the back, plain seams on the seat
            if (n.z > 0.5) {
              vec2 q = vec2(along, p.y) / vec2(0.11, 0.09);
              vec2 f = fract(vec2(q.x + q.y, q.x - q.y) * 0.5) - 0.5;
              float puff = 1.0 - smoothstep(0.2, 0.5, max(abs(f.x), abs(f.y)));
              float button = 1.0 - smoothstep(0.05, 0.1, length(0.5 - abs(f)));
              diffuseColor.rgb *= (0.8 + 0.26 * puff) * (1.0 - 0.5 * button);
            } else {
              diffuseColor.rgb *= 1.0 - 0.3 * sLine(p.x, 0.62, 0.004);
            }
            sRough = 0.42;
            sGloss = 0.45;
          } else if (mat == ${M.plaster}) {
            vec2 q = abs(n.y) > 0.5 ? p.xz : vec2(along, p.y);
            diffuseColor.rgb *= 0.95 + 0.06 * sNoise(q * 3.0) + 0.03 * sNoise(q * 13.0);
            sRough = 0.92;
          } else if (mat == ${M.metal}) {
            sRough = 0.35;
            sMetal = 0.6;
            sGloss = 0.4;
          } else if (mat == ${M.boards}) {
            // painted beadboard: a groove every 0.09
            diffuseColor.rgb *= 1.0 - 0.35 * sLine(along, 0.09, 0.004);
            sRough = 0.5;
            sGloss = 0.15;
          }

          if (vGlow > 0.5 && vGlow < 1.5) {
            float day = 1.0 - uNight;
            float depth = clamp(-p.z / 3.6, 0.0, 1.0);
            // occlusion where surfaces meet: floor, ceiling, back and side walls, shelves, and under things
            float ao = 1.0;
            ao *= mix(1.0, smoothstep(-0.05, 0.55, p.y), 0.6 * (1.0 - abs(n.y)));
            ao *= mix(1.0, smoothstep(-0.05, 0.7, ${ROOM.h.toFixed(2)} - p.y), 0.55 * (1.0 - abs(n.y)) + 0.25 * max(-n.y, 0.0));
            ao *= mix(1.0, smoothstep(-0.05, 0.9, p.z - (${ROOM.c0.toFixed(2)})), 0.6 * (1.0 - abs(n.z)));
            ao *= mix(1.0, smoothstep(-0.05, 1.0, ${ROOM.a1.toFixed(2)} - abs(p.x)), 0.6 * (1.0 - abs(n.x)));
            // the back corners
            ao *= mix(0.55, 1.0, smoothstep(0.0, 1.4, length(vec2(${ROOM.a1.toFixed(2)} - abs(p.x), p.z - (${ROOM.c0.toFixed(2)})))));
            // shelves against the wall, and the counter's overhang
            if (n.z > 0.5 && p.z < ${(ROOM.c0 + 0.02).toFixed(3)}) for (int i = 0; i < ${SHELVES.length}; i++) ao *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(p.y - SHELVES_Y[i]))) * step(-0.2, p.x) * step(p.x, 3.6);
            if (n.z > 0.5 && abs(p.z - (${COUNTER.c1.toFixed(3)})) < 0.05 && p.y < ${COUNTER.h.toFixed(2)}) ao *= mix(0.5, 1.0, smoothstep(0.0, 0.3, ${COUNTER.h.toFixed(2)} - p.y)) * mix(0.55, 1.0, smoothstep(0.0, 0.5, p.y));
            // contact shadows on the floor: tables, chairs and stools, the counter, the banquette
            if (n.y > 0.5 && p.y < 0.06) {
              for (int i = 0; i < ${TABLES.length}; i++) ao *= 1.0 - 0.55 * (1.0 - smoothstep(0.05, 0.42, length(p.xz - TABLES[i])));
              for (int i = 0; i < ${CHAIRS.length + STOOLS.length}; i++) ao *= 1.0 - 0.4 * (1.0 - smoothstep(0.05, 0.3, length(p.xz - SEATS[i])));
              ao *= 1.0 - 0.7 * sBox(p.xz, vec2(${((COUNTER.a0 + COUNTER.a1) / 2).toFixed(3)}, ${((COUNTER.c0 + COUNTER.c1) / 2).toFixed(3)}), vec2(${((COUNTER.a1 - COUNTER.a0) / 2).toFixed(3)}, ${((COUNTER.c1 - COUNTER.c0) / 2).toFixed(3)}), 0.4);
              ao *= 1.0 - 0.7 * sBox(p.xz, vec2(${((BANQUETTE.a0 + BANQUETTE.a1) / 2).toFixed(3)}, ${((BANQUETTE.c0 + BANQUETTE.c1) / 2).toFixed(3)}), vec2(${((BANQUETTE.a1 - BANQUETTE.a0) / 2).toFixed(3)}, ${((BANQUETTE.c1 - BANQUETTE.c0) / 2).toFixed(3)}), 0.35);
            }
            // the banquette's base sits in its own shadow
            if (p.z < ${BANQUETTE.c1.toFixed(3)} && p.x < ${BANQUETTE.a1.toFixed(3)} && p.y < 0.36) ao *= 0.6;

            // light: a little ambient, daylight from the glass, the pendants, the shelf strips, a shaft of low sun
            vec3 V = normalize(sCam() - p);
            vec3 L = vec3(1.0, 0.86, 0.68) * mix(0.17, 0.05, uNight) * ao;
            L += vec3(1.0, 0.93, 0.82) * day * 0.42 * exp(-depth * 2.4) * (0.5 + 0.5 * max(n.z, 0.0)) * ao;
            for (int i = 0; i < ${PENDANTS.length}; i++) {
              vec3 d = PENDANTS[i] - vec3(0.0, 0.03, 0.0) - p;
              float r2 = dot(d, d);
              vec3 l = d * inversesqrt(r2);
              float wrap = clamp((dot(n, l) + 0.25) / 1.25, 0.0, 1.0);
              float cone = mix(0.3, 1.0, smoothstep(-0.05, 0.45, l.y));
              // tables shade the floor under them
              float under = 1.0;
              for (int j = 0; j < ${TABLES.length}; j++) under *= p.y < 0.72 ? mix(1.0, 0.3, 1.0 - smoothstep(0.22, 0.32, length(p.xz - TABLES[j]))) : 1.0;
              float lamp = wrap * cone * under / (0.18 + r2 * 2.0);
              sPool += lamp;
              L += WARM * lamp * mix(1.15, 1.5, uNight) * mix(0.55, 1.0, ao);
              // a highlight of the bulb on glossy things
              vec3 h = normalize(l + V);
              sSpec += pow(max(dot(n, h), 0.0), mix(18.0, 140.0, sGloss)) * sGloss * cone / (0.4 + r2);
            }
            for (int i = 0; i < ${SHELVES.length}; i++) {
              float dy = SHELVES_Y[i] - 0.04 - p.y;
              float dz = p.z - (${(ROOM.c0 + 0.235).toFixed(3)});
              float along = step(-0.15, p.x) * step(p.x, 3.55);
              float strip = along * step(0.0, dy) * exp(-dy * 4.0) * exp(-max(dz, 0.0) * 6.0) * (0.4 + 0.6 * max(n.z, max(n.y, 0.0)));
              L += WARM * strip * mix(0.55, 0.8, uNight);
            }
            if (day > 0.01) {
              // trace back to the shopfront along the sun, and let it through the glass
              float t = -p.z / -SUN.z;
              vec2 q = p.xy - SUN.xy * t;
              float lit = sWindow(q) * max(dot(n, -SUN), 0.0) * smoothstep(0.0, 0.3, t) * mix(1.0, 0.45, clamp(t / 4.0, 0.0, 1.0)) * (1.0 - 0.8 * sMetal);
              L += vec3(1.0, 0.78, 0.5) * 1.6 * lit * day;
            }
            sLight = L;
            sAlbedo = diffuseColor.rgb;
            // what the real scene lights add on top (environment, the sun through the glass) stays small
            diffuseColor.rgb *= mix(0.2, 0.12, uNight) * ao;
          }
        }`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (sRough >= 0.0) roughnessFactor = sRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = max(metalnessFactor, sMetal);")
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        // relief: bevelled tile on the back wall, pressed tin on the ceiling
        if (sMat == ${M.tile} || sMat == ${M.tin}) {
          bool tin = sMat == ${M.tin};
          vec2 q = tin ? sP.xz : vec2(abs(sN.z) > abs(sN.x) ? sP.x : sP.z, sP.y);
          float e = 0.003;
          float h0 = tin ? sTin(q) : sTile(q);
          float hx = tin ? sTin(q + vec2(e, 0.0)) : sTile(q + vec2(e, 0.0));
          float hy = tin ? sTin(q + vec2(0.0, e)) : sTile(q + vec2(0.0, e));
          vec2 g = vec2(hx - h0, hy - h0) / e * (tin ? 0.004 : 0.006);
          vec3 d = tin ? vec3(-g.x, 0.0, -g.y) : (abs(sN.z) > abs(sN.x) ? vec3(-g.x, -g.y, 0.0) : vec3(0.0, -g.y, -g.x));
          normal = normalize(normal + (viewMatrix * vec4(d, 0.0)).xyz);
        }`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `if (vGlow > 0.5 && vGlow < 1.5) {
          // inside the cafe: its own baked light
          totalEmissiveRadiance = sAlbedo * sLight * (1.0 - 0.9 * sMetal);
          totalEmissiveRadiance += WARM * sSpec * 0.9;
          vec3 V = normalize(sCam() - sP);
          if (sMetal > 0.9) {
            // chrome mirrors the room: dark floor, a bright streak of the shop window, the warm ceiling
            vec3 r = reflect(-V, sN);
            // where the reflected ray meets the room: floor below, the lit window band, the warm ceiling (parallax by height)
            float e = r.y + (sP.y - 1.25) * 0.9;
            vec3 room = mix(vec3(0.06, 0.045, 0.035), vec3(0.9, 0.72, 0.5), smoothstep(-0.25, 0.45, e));
            float streak = exp(-pow((e - 0.06) / 0.035, 2.0)) * smoothstep(0.0, 0.3, r.z);
            totalEmissiveRadiance += mix(vec3(1.0), sAlbedo, 0.4) * (room * 0.55 + vec3(1.0, 0.97, 0.92) * streak * mix(1.3, 0.6, uNight));
          }
          if (sMat == ${M.leather}) totalEmissiveRadiance += sAlbedo * WARM * pow(1.0 - abs(dot(V, sN)), 2.5) * 0.9;
          totalEmissiveRadiance += vec3(1.0, 0.95, 0.86) * sGloss * pow(1.0 - abs(dot(V, sN)), 4.0) * 0.12;
        } else {
          totalEmissiveRadiance *= diffuseColor.rgb * vGlow;
        }`,
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
  const interior = useInterior();
  const { siding } = useLandmarkTextures();
  const brand = useBrand();
  const sign = useSign(brand, { bg: "#efe6d0", fg: "#1f3b2f", panel: SHOP_SIGN });
  // the gooseneck lamps light the sign at night
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.7, emissive: "#fff1d8", emissiveMap: sign, emissiveIntensity: 0 }), [sign]);
  useNightGlow(signMat, 0.55, 0);
  // (no shingled roof here: the siding stands in for the shingles)
  const atlas = useMemo(() => ({ value: null as Texture | null }), []);
  const m = useMemo(() => ({ house: houseMaterial(siding, siding, palette()), painted: paintedMaterial(atlas), glass: glassMaterial() }), [siding, atlas]);
  // the cafe's canvas carries the brand (menu, coffee bags)
  const cafe = useMemo(() => cafeAtlas(brand), [brand]);
  useLayoutEffect(() => {
    atlas.value = cafe;
    return () => cafe.dispose();
  }, [atlas, cafe]);
  // the cafe has its lights on in the morning, and glows at night
  useNightGlow(m.painted, 1.0, 0.45);
  const parts = useMemo(() => {
    const p = shopParts();
    return p;
  }, []);
  return (
    <>
      <Instances items={ONE} geometry={parts.shell} material={m.house} attributes={paintAttribute} place={placeShell} />
      <group position={[local.x, local.ground, local.z]}>
        <mesh geometry={parts.front} material={m.painted} castShadow receiveShadow />
        {/* the cafe: its light is baked in the shader, so it casts no shadows (its leaf cards would cast squares) */}
        <mesh ref={interior} geometry={parts.interior} material={m.painted} receiveShadow userData={LIVE} />
        <mesh geometry={parts.glass} material={m.glass} />
        {/* the visitor's brand on the fascia */}
        <mesh position={[...SHOP.sign]} material={signMat} userData={LIVE}>
          <planeGeometry args={SHOP_SIGN} />
        </mesh>
      </group>
      <Lamps lamps={LAMP} />
    </>
  );
}
