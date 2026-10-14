"use client";

// 12:00 Union Square. An early-1900s commercial block modelled with the row
// houses' kit (house-models.ts) and painted by their material: a two-storey
// shop base with display windows and a corner entrance, three office storeys
// of Chicago windows between piers, a cornice, and a gravel roof with a
// parapet on three sides and a stair bulkhead. On the roof a classic
// billboard on a steel truss, with a catwalk and gooseneck lamps, shows the
// visitor's ad. West of it, a corner of the square with the Dewey Monument.
// Behind the display windows, lit showcases; behind the corner doors, a
// lobby. The cable car waits below. Six draw calls: building, steel, lamp
// glow, ad, showcases, shop glass.

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { AdditiveBlending, BoxGeometry, BufferGeometry, CircleGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute, LatheGeometry, Matrix4, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector2, Vector3 } from "three";
import { heightAt } from "@/lib/terrain";
import { rig, useInterior, useNightGlow } from "./shared";
import { CableCar, Rails } from "./cable-car";
import { PALETTES, SLOT, builder, moulding, palette, sides, type Box2, type Builder, type Frame, type L3, type P2, type Rect, type Span } from "./house-models";
import { box, cyl, merged, placed, useLandmarkTextures } from "./landmark-kit";
import { houseMaterial, glassMaterial } from "./materials";
import { useBrand, type V3 } from "./parts";
import { useSign } from "./textures";

/**
 * The 12:00 building, y from the ground at its centre. The south edge has no
 * parapet (Cuso jumps up there). Below the cornice nothing stands out of the
 * walls further than `relief`, except the belt course over the shops (0.06
 * above and below `belt.y`). `billboard` is the box round the board, its
 * truss, catwalk and lamps. The collision test reads all of it.
 */
const [X0, X1] = [3.5, 10.5];
/** The billboard's face: centred on the roof, at its north edge. */
const BOARD = { x: (X0 + X1) / 2, y: 8, z: 6.72 };
export const UNION = {
  x0: X0, x1: X1, z0: 6.4, z1: 11.6, roof: 5,
  wall: 0.16, parapet: 0.27,
  relief: 0.06,
  cornice: { out: 0.16, bottom: 4.73, top: 4.97 },
  belt: { y: 1.9, out: 0.1 },
  /** Bays along the north and south walls (x) and the east and west walls (z). */
  bays: { x: 4, z: 3 },
  /** Paint scheme (PALETTES): cream terracotta, white trim, bronze frames. */
  palette: PALETTES.findIndex((p) => p.name === "cream"),
  board: BOARD,
  billboard: { x0: BOARD.x - 2.95, x1: BOARD.x + 2.95, z0: BOARD.z - 0.07, z1: 7.72, top: BOARD.y + 1.7 },
  /** The stair bulkhead in the south-east corner, away from Cuso and beside the billboard in the 12:00 shot. */
  bulkhead: { x: 9.78, z: 10.68, w: 1.0, d: 1.1, top: 5.9 },
  /** The Dewey Monument in the square, west of the building: its base is `base` square. */
  monument: { x: 1.5, z: 9, base: 1.5, top: 4.75 },
};
/** The cable car parked below Union Square, between the two places Cuso crosses its rails (x -1.4 and 5.6). */
export const UNION_CAR = { p: [2.1, 0, 14] as V3 };

/** The billboard's ad face in world units [width, height]; its canvas follows the same shape. */
export const AD_PANEL = [5.58, 2.78] as const;
/** Where the ad face hangs (z), just in front of its backing. */
export const FACE_Z = 6.95;

// Heights up the facade.
const FOOT = -0.3;
const PLINTH = 0.1;
const BASE_TOP = UNION.belt.y - 0.06;
const BELT_TOP = UNION.belt.y + 0.06;
const FLOORS = [BELT_TOP, 2.84, 3.72];
const SILL = 0.2;
const HEAD = 0.72;
const FRIEZE = 4.6;
/** Display windows (their showcases light themselves) and the mezzanine lights over them. */
const DISPLAY: Span = [0.3, 1.12];
const MEZZANINE: Span = [1.2, 1.74];
const CORNER = 0.26; // corner piers
const PIER = 0.34;
const CHAMFER = 0.55; // the corner entrance, south-west

const WORLD: Frame = { o: [0, 0, 0], u: [1, 0, 0] };

/** The bays along a wall: equal openings between corner piers and piers. */
function bays(len: number, n: number): Span[] {
  const w = (len - 2 * CORNER - (n - 1) * PIER) / n;
  return Array.from({ length: n }, (_, i) => [CORNER + i * (w + PIER), CORNER + i * (w + PIER) + w]);
}

/** The showcase behind each display window, in its wall's frame (c out of the wall): glass, back panel, floor and soffit. */
export const SHOWCASE = { glass: -0.07, back: -0.48, floor: DISPLAY[0], ceiling: DISPLAY[1] };
const FOOTPRINT: Box2 = { x0: UNION.x0, x1: UNION.x1, z0: UNION.z0, z1: UNION.z1 };
/**
 * The shop openings along a wall: one per bay. On the north and south walls
 * the corner piers are wider at the base, so the showcases round a corner
 * never meet; the two by the corner entrance keep clear of its lobby.
 */
const shopSpans = (len: number, name: string, wraps: boolean): Span[] => {
  const end = wraps ? -SHOWCASE.back + 0.02 : 0;
  return bays(len, wraps ? UNION.bays.x : UNION.bays.z).map(([a0, a1]) => [Math.max(a0, end, name === "south" ? CHAMFER + 0.3 : 0), Math.min(a1, len - end, name === "west" ? len - CHAMFER - 0.3 : len)]);
};

const THEMES = ["mannequins", "leather", "home", "knitwear"] as const;
/** Back panels: muted greige, sage, blush, slate and sand. */
const BACKS = ["#d8cebf", "#b8bfb2", "#cfbab0", "#b1b8c0", "#cbc1aa"];
/** Every display window: its wall, its span along it, what it shows and its back panel. Neighbours never match. */
export const SHOP_BAYS = sides(FOOTPRINT)
  .flatMap(({ f, len, name, wraps }) => shopSpans(len, name, wraps).map(([a0, a1]) => ({ f, a0, a1 })))
  .map((b, i) => ({ ...b, theme: THEMES[i % THEMES.length], back: BACKS[i % BACKS.length] }));

/** The corner entrance's frame (along the cut, out to the south-west) and the lobby behind its doors. */
const ENTRY: Frame = { o: [UNION.x0, 0, UNION.z1 - CHAMFER], u: [Math.SQRT1_2, 0, Math.SQRT1_2] };
const ENTRY_LEN = CHAMFER * Math.SQRT2;
export const LOBBY = { f: ENTRY, a0: 0.08, a1: ENTRY_LEN - 0.08, c0: -0.46, c1: -0.16, top: 1.14 };

/** A shopfront in its opening: stallriser, the display window's bronze frame (its glass and showcase: displayGeometry), transom bar, mezzanine lights. */
function shopfront(k: Builder, f: Frame, [a0, a1, b0, b1]: Rect, id: number) {
  const back = -0.08;
  k.reveal(f, [a0, a1, b0, b1], 0, back, SLOT.panel);
  k.box(f, a0, a1, b0, DISPLAY[0], back, back + 0.04, SLOT.panel);
  const m = (a0 + a1) / 2;
  for (const [s0, s1] of [[a0, a0 + 0.035], [m - 0.02, m + 0.02], [a1 - 0.035, a1]]) k.box(f, s0, s1, DISPLAY[0], DISPLAY[1], back, back + 0.025, SLOT.sash);
  k.box(f, a0, a1, DISPLAY[0], DISPLAY[0] + 0.03, back, back + 0.025, SLOT.sash);
  k.box(f, a0, a1, DISPLAY[1], MEZZANINE[0], back, back + 0.03, SLOT.sash);
  k.quad(f, a0, a1, MEZZANINE[0], b1, back, SLOT.glass, id);
  for (const s of [1, 2]) {
    const x = a0 + ((a1 - a0) * s) / 3;
    k.box(f, x - 0.015, x + 0.015, MEZZANINE[0], b1, back, back + 0.02, SLOT.sash);
  }
}

/** A Chicago window: a wide fixed light between two narrow sashes, one window id. */
function chicago(k: Builder, f: Frame, r: Rect, id: number) {
  const [a0, a1, b0, b1] = r;
  const back = -0.07;
  const side = (a1 - a0) * 0.2;
  const m = 0.035;
  k.reveal(f, r, 0, back, SLOT.stucco);
  k.glazing(f, [a0, a0 + side, b0, b1], back, id);
  k.glazing(f, [a0 + side + m, a1 - side - m, b0, b1], back, id, false);
  k.glazing(f, [a1 - side, a1, b0, b1], back, id);
  for (const x of [a0 + side, a1 - side - m]) k.box(f, x, x + m, b0, b1, back, back + 0.03, SLOT.sash);
  k.box(f, a0 - 0.03, a1 + 0.03, b0 - 0.05, b0, 0, 0.05, SLOT.trim);
}

/** The corner entrance: a cut corner with glass double doors (their glass and the lobby: displayGeometry) under a transom. */
function entrance(k: Builder, id: number) {
  const { x0, z1 } = UNION;
  const f = ENTRY;
  const len = ENTRY_LEN;
  const [d0, d1] = [LOBBY.a0, LOBBY.a1];
  const back = LOBBY.c1;
  const top = 1.62;
  k.wall(f, 0, len, FOOT, BASE_TOP, [[d0, d1, 0, top]], SLOT.panel);
  k.reveal(f, [d0, d1, 0, top], 0, back, SLOT.panel);
  k.ring2(f, [d0 + 0.028, d1 - 0.028, 0.048, 1.052], 0.028, back + 0.006, SLOT.door);
  k.box(f, len / 2 - 0.02, len / 2 + 0.02, 0, 1.08, back, back + 0.03, SLOT.door);
  k.box(f, d0, d1, 1.08, 1.14, back, back + 0.03, SLOT.door);
  k.glazing(f, [d0, d1, 1.14, top - 0.04], back, id, false);
  k.box(f, d0, d1, top - 0.04, top, back, back + 0.03, SLOT.door);
  k.box(f, d0, d1, -0.1, 0.02, back, 0.04, SLOT.stone);
  for (const [p0, p1] of [[0, d0], [d1, len]]) k.box(f, p0, p1, FOOT, PLINTH, 0, 0.04, SLOT.stone);
  // under the cut: the soffit of the floors above
  k.face(WORLD, [[x0, BASE_TOP, z1 - CHAMFER], [x0 + CHAMFER, BASE_TOP, z1], [x0, BASE_TOP, z1]], [0, -1, 0], SLOT.panel);
  return id + 1;
}

/** The roof: gravel deck, parapets on three sides (tar flashing, coping), a flush coping on the south edge, the stair bulkhead. */
function roof(k: Builder, id: number) {
  const { x0, x1, z0, z1, roof: y, wall: t, parapet, bulkhead: b } = UNION;
  const top = y + parapet;
  const cap = top - 0.05;
  const lip = 0.2; // the south coping, flush with the deck
  k.face(WORLD, [[x0 + t, y, z0 + t], [x1 - t, y, z0 + t], [x1 - t, y, z1 - lip], [x0 + t, y, z1 - lip]], [0, 1, 0], SLOT.gravel);
  k.box(WORLD, x0 + t, x1 - t, UNION.cornice.top, y, z1 - lip, z1 + 0.02, SLOT.stone);
  // north, west, east
  const walls: [number, number, number, number][] = [[x0, x1, z0, z0 + t], [x0, x0 + t, z0 + t, z1], [x1 - t, x1, z0 + t, z1]];
  for (const [a0, a1, c0, c1] of walls) k.box(WORLD, a0, a1, UNION.cornice.top, cap, c0, c1, SLOT.stucco);
  k.box(WORLD, x0 + t, x1 - t, y, y + 0.07, z0 + t, z0 + t + 0.012, SLOT.tar);
  k.box(WORLD, x0 + t, x0 + t + 0.012, y, y + 0.07, z0 + t, z1 - lip, SLOT.tar);
  k.box(WORLD, x1 - t - 0.012, x1 - t, y, y + 0.07, z0 + t, z1 - lip, SLOT.tar);
  const o = 0.05;
  k.box(WORLD, x0 - o, x1 + o, cap, top, z0 - o, z0 + t + o, SLOT.stone);
  k.box(WORLD, x0 - o, x0 + t + o, cap, top, z0 + t + o, z1 + o, SLOT.stone);
  k.box(WORLD, x1 - t - o, x1 + o, cap, top, z0 + t + o, z1 + o, SLOT.stone);

  // The stair bulkhead: stucco on a tar flashing, a stone cap, a door with a glass lite facing west.
  const lid = b.top - 0.07;
  const body: Box2 = { x0: b.x - b.w / 2 + 0.05, x1: b.x + b.w / 2 - 0.05, z0: b.z - b.d / 2 + 0.05, z1: b.z + b.d / 2 - 0.05 };
  for (const { f, len, name } of sides(body)) {
    const door: Rect = [len / 2 - 0.28, len / 2 + 0.28, y, y + 0.82];
    const holes = name === "west" ? [door] : [];
    k.wall(f, 0, len, y, y + 0.08, holes, SLOT.tar);
    k.wall(f, 0, len, y + 0.08, lid, holes, SLOT.stucco);
    if (!holes.length) continue;
    const [a0, a1, , d1] = door;
    k.reveal(f, door, 0, -0.04, SLOT.trim);
    k.box(f, a0, a1, y, d1, -0.04, -0.015, SLOT.door);
    k.glazing(f, [a0 + 0.1, a1 - 0.1, y + 0.5, y + 0.74], -0.012, id++, false);
  }
  k.box(WORLD, b.x - b.w / 2, b.x + b.w / 2, lid, b.top, b.z - b.d / 2, b.z + b.d / 2, SLOT.stone);
  return id;
}

/** The Dewey Monument: a granite column on a stepped base, Victory on top with her trident. */
function monument(k: Builder) {
  const { x, z, base, top } = UNION.monument;
  const sq = (s: number, y0: number, y1: number, slot: number) => k.box(WORLD, x - s / 2, x + s / 2, y0, y1, z - s / 2, z + s / 2, slot);
  const round = (r: number, y0: number, y1: number, slot: number, n = 12) =>
    k.prism(WORLD, Array.from({ length: n }, (_, i): P2 => [x + r * Math.cos((i * 2 * Math.PI) / n), z + r * Math.sin((i * 2 * Math.PI) / n)]), y0, y1, slot);
  // granite: three steps, a pedestal with its cornice, the column with a torus at its foot and a capital
  sq(base, -0.1, 0.1, SLOT.stone);
  sq(base - 0.3, 0.1, 0.2, SLOT.stone);
  sq(base - 0.6, 0.2, 0.3, SLOT.stone);
  sq(0.62, 0.3, 1.1, SLOT.stone);
  sq(0.72, 1.1, 1.18, SLOT.stone);
  sq(0.46, 1.18, 1.3, SLOT.stone);
  round(0.2, 1.3, 1.38, SLOT.stone, 16);
  round(0.16, 1.38, 4.0, SLOT.stone, 16);
  round(0.2, 4.0, 4.06, SLOT.stone, 16);
  sq(0.5, 4.06, 4.16, SLOT.stone);
  // bronze Victory on a drum, a wreath held out and the trident raised
  round(0.12, 4.16, 4.26, SLOT.door);
  round(0.075, 4.26, 4.52, SLOT.door, 8);
  round(0.04, 4.52, 4.6, SLOT.door, 8);
  k.box(WORLD, x - 0.22, x - 0.06, 4.44, 4.47, z - 0.015, z + 0.015, SLOT.door);
  k.box(WORLD, x + 0.09, x + 0.11, 4.3, top, z - 0.01, z + 0.01, SLOT.door);
}

/** The building, its roof and the monument, in world x, z and y from the ground, in the house material's attributes. */
export function buildingGeometry() {
  const U = UNION;
  const r = FOOTPRINT;
  const k = builder();
  let id = 1;

  for (const { f, len, name, wraps } of sides(r)) {
    const spans = bays(len, wraps ? U.bays.x : U.bays.z);
    // the corner entrance cuts the base at the south end of the west wall and the west end of the south wall
    const [cut0, cut1] = [name === "south" ? CHAMFER : 0, name === "west" ? len - CHAMFER : len];

    // The shop base: plinth, openings between piers, a shopfront in each.
    const shops: Rect[] = shopSpans(len, name, wraps).map(([a0, a1]) => [a0, a1, PLINTH, MEZZANINE[1]]);
    k.wall(f, cut0, cut1, FOOT, BASE_TOP, shops, SLOT.panel);
    const e = wraps ? 0.04 : 0;
    k.box(f, cut0 > 0 ? cut0 : -e, cut1 < len ? cut1 : len + e, FOOT, PLINTH, 0, 0.04, SLOT.stone);
    for (const s of shops) shopfront(k, f, s, id++);

    // Offices: stucco walls, Chicago windows, piers between the bays, spandrel panels between the storeys.
    const windows: Rect[] = FLOORS.flatMap((y) => spans.map(([a0, a1]): Rect => [a0 + 0.08, a1 - 0.08, y + SILL, y + HEAD]));
    k.wall(f, 0, len, BASE_TOP, U.cornice.top, windows, SLOT.stucco);
    for (const w of windows) chicago(k, f, w, id++);
    const piers: Span[] = [[-0.05 * +wraps, CORNER], ...spans.slice(1).map(([a0]): Span => [a0 - PIER, a0]), [len - CORNER, len + 0.05 * +wraps]];
    for (const [p0, p1] of piers) k.box(f, p0, p1, BELT_TOP, FRIEZE, 0, 0.05, SLOT.stucco);
    for (const [a0, a1] of spans) {
      for (let j = 0; j < FLOORS.length - 1; j++) k.box(f, a0 + 0.08, a1 - 0.08, FLOORS[j] + HEAD + 0.06, FLOORS[j + 1] + SILL - 0.08, 0, 0.012, SLOT.panel);
    }
  }
  id = entrance(k, id);

  // Belt course over the shops, a band capping the piers, frieze and cornice, all round.
  moulding(k, r, [[0, BASE_TOP], [0.06, BASE_TOP], [0.1, BASE_TOP + 0.04], [0.1, BELT_TOP], [0, BELT_TOP]], SLOT.trim);
  moulding(k, r, [[0, FRIEZE - 0.05], [0.06, FRIEZE - 0.05], [0.06, FRIEZE], [0, FRIEZE]], SLOT.trim);
  const c = U.cornice;
  moulding(k, r, [[0, FRIEZE], [0.03, FRIEZE], [0.03, c.bottom], [0, c.bottom]], SLOT.panel);
  moulding(k, r, [[0, c.bottom], [0.05, c.bottom], [0.07, c.bottom + 0.03], [0.07, c.bottom + 0.08], [0.15, c.bottom + 0.16], [c.out, c.bottom + 0.17], [c.out, c.top], [0, c.top]], SLOT.trim);

  roof(k, id);
  monument(k);

  const g = k.geometry();
  g.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(U.palette), 1));
  return g;
}

// ---------- The billboard ----------

const UP = new Vector3(0, 1, 0);
/** A square steel member of width w from a to b. */
function member(a: V3, b: V3, w: number) {
  const [va, vb] = [new Vector3(...a), new Vector3(...b)];
  const dir = vb.clone().sub(va);
  const g = new BoxGeometry(w, dir.length(), w);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(UP, dir.normalize()));
  return g.translate(...(va.add(vb).multiplyScalar(0.5).toArray() as V3));
}

const UPRIGHTS = [-2.45, -0.95, 0.95, 2.45].map((d) => BOARD.x + d);
const LAMP_X = [-2.25, -0.8, 0.8, 2.25].map((d) => BOARD.x + d);
/** The gooseneck's path (z, y) from the top of the trim, up, over and down to the shade. */
const NECK: P2[] = [[6.97, 9.46], [6.97, 9.52], [7.11 - 0.14 * Math.cos(Math.PI / 6), 9.52 + 0.14 * Math.sin(Math.PI / 6)], [7.11 - 0.14 * Math.cos(Math.PI / 3), 9.52 + 0.14 * Math.sin(Math.PI / 3)], [7.11, 9.66], [7.4, 9.66], [7.47, 9.62]];
const AIM = new Vector3(0, 8.3 - 9.62, FACE_Z - 7.47).normalize();
/** The gooseneck lamps: the middle of each lens and where it points. */
export const LAMPS = LAMP_X.map((x) => ({ p: new Vector3(x, 9.62, 7.47).addScaledVector(AIM, 0.125).toArray() as V3, aim: AIM.toArray() as V3 }));

/** Steel: backing, trim frame, uprights and stringers, braced truss, kickers, catwalk with railing, gooseneck lamps. */
export function billboardGeometry() {
  const { x: bx, y: by } = UNION.board;
  const [w, h] = AD_PANEL;
  const y = UNION.roof;
  const [fx0, fx1, fy0, fy1] = [bx - w / 2, bx + w / 2, by - h / 2, by + h / 2];
  const t = 0.07; // trim
  const deck = 6.2;
  const front = 7.455;
  // The truss stands at the back of the box, flat members well behind the face: deep members close behind
  // it, seen edge-on, bleed through the face as dashed lines in software GL (headless Chrome).
  const zt = 6.69;
  const parts: BufferGeometry[] = [
    // backing and the trim frame round the face
    // (its front 4 cm behind the face: closer, the two fight for depth at a distance and the steel shows through)
    box([bx, by, FACE_Z - 0.065], [w + 2 * t, h + 2 * t, 0.05]),
    box([bx, fy1 + t / 2, 6.97], [w + 2 * t, t, 0.06]),
    box([bx, fy0 - t / 2, 6.97], [w + 2 * t, t, 0.06]),
    box([fx0 - t / 2, by, 6.97], [t, h, 0.06]),
    box([fx1 + t / 2, by, 6.97], [t, h, 0.06]),
    // stringers behind the face, the truss chords under it
    ...[6.85, 7.75, 8.65, 9.3].map((sy) => box([bx, sy, 6.8225], [w + 2 * t, 0.06, 0.025])),
    ...[5.5, deck - 0.05].map((sy) => box([bx, sy, zt], [UPRIGHTS[3] - UPRIGHTS[0] + 0.11, 0.06, 0.04])),
  ];
  UPRIGHTS.forEach((x, i) => {
    parts.push(
      box([x, (y + fy1 + t) / 2, zt], [0.11, fy1 + t - y, 0.04]),
      box([x, y + 0.015, zt], [0.16, 0.03, 0.07]),
      // a kicker forward to the roof, the catwalk bracket
      member([x, deck - 0.08, zt + 0.02], [x, y + 0.03, 7.6], 0.06),
      box([x, y + 0.015, 7.6], [0.14, 0.03, 0.14]),
      box([x, deck - 0.03, (zt + 7.46) / 2], [0.05, 0.05, 7.46 - zt]),
    );
    if (i === UPRIGHTS.length - 1) return;
    const n = UPRIGHTS[i + 1];
    // braced panels: under the face (in the truss) and behind it
    const [lo, hi] = i % 2 ? [5.5, deck - 0.05] : [deck - 0.05, 5.5];
    parts.push(member([x, lo, zt], [n, hi, zt], 0.05), member([x, 6.85, zt + 0.045], [n, 9.3, zt + 0.045], 0.03), member([x, 9.3, zt + 0.045], [n, 6.85, zt + 0.045], 0.03));
  });
  // the catwalk: deck, toe board, railing posts, mid and top rails, end rails
  const [c0, c1] = [bx - w / 2 - 0.08, bx + w / 2 + 0.08];
  parts.push(box([bx, deck + 0.015, 7.165], [c1 - c0, 0.03, 0.58]), box([bx, deck + 0.06, front], [c1 - c0, 0.06, 0.015]));
  for (let i = 0; i <= 8; i++) parts.push(box([c0 + 0.0125 + ((c1 - c0 - 0.025) * i) / 8, deck + 0.18, front], [0.025, 0.3, 0.025]));
  parts.push(box([bx, 6.565, front], [c1 - c0, 0.03, 0.03]), box([bx, 6.4, front], [c1 - c0, 0.02, 0.02]));
  for (const x of [c0 + 0.0125, c1 - 0.0125]) parts.push(box([x, 6.565, (6.94 + front) / 2], [0.025, 0.03, front - 6.94]));
  // gooseneck lamps: a bent pipe and a shade aimed at the face
  const turn = new Quaternion().setFromUnitVectors(UP, AIM.clone().negate());
  for (const x of LAMP_X) {
    for (let i = 0; i < NECK.length - 1; i++) parts.push(member([x, NECK[i][1], NECK[i][0]], [x, NECK[i + 1][1], NECK[i + 1][0]], 0.025));
    const c = new Vector3(x, 9.62, 7.47).addScaledVector(AIM, 0.06);
    parts.push(new CylinderGeometry(0.035, 0.085, 0.12, 10).applyQuaternion(turn).translate(c.x, c.y, c.z));
  }
  return merged(parts);
}

// ---------- Night glow ----------

const WARM: L3 = [1, 0.78, 0.5];

/**
 * What glows at night, added over everything (black by day): the billboard's
 * lamps. Vertex colour sets the strength. (The shops light themselves: displayGeometry.)
 */
export function glowGeometry() {
  const pos: number[] = [];
  const col: number[] = [];
  // lamps: a lens across each shade's mouth, facing the ad, and the bulb just out of it (seen from the street)
  const side = new Vector3(1, 0, 0);
  const up = new Vector3().crossVectors(AIM, side);
  const ring = 10;
  const bulb = new OctahedronGeometry(0.045).attributes.position;
  for (const { p: c } of LAMPS) {
    const o = new Vector3(...c);
    const at = (i: number) => o.clone().addScaledVector(side, 0.08 * Math.cos((i * 2 * Math.PI) / ring)).addScaledVector(up, 0.08 * Math.sin((i * 2 * Math.PI) / ring));
    for (let i = 0; i < ring; i++) for (const q of [o, at(i + 1), at(i)]) pos.push(q.x, q.y, q.z);
    const b = o.clone().addScaledVector(AIM, 0.02);
    for (let i = 0; i < bulb.count; i++) pos.push(b.x + bulb.getX(i), b.y + bulb.getY(i), b.z + bulb.getZ(i));
    for (let j = 0; j < ring * 3 + bulb.count; j++) col.push(...WARM.map((v) => v * 2));
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- Display windows and the lobby ----------

/** Display light: warm, from spots in the soffit. Baked into vertex colours: no real-time lights inside. */
const DISPLAY_LIGHT: L3 = [1, 0.93, 0.82];
const SPOT_LENS: L3 = [3, 2.75, 2.3];
const BRONZE = "#4a3f33";
const SOFFIT = "#ebe6dc";
/** Garments and goods: oat, camel, cognac, charcoal, olive, blush, ivory, slate, terracotta. All muted. */
const GOODS = ["#d6ccb8", "#b08a5e", "#866250", "#3d3d3f", "#7d7f5e", "#d8b4a6", "#ece6da", "#5b6370", "#b07a62"];
const FLOORS_DISPLAY = ["#cbb89a", "#d9d3c9"];

/** A light baked into the showcase: a spot aimed along `d`, or a bare bulb (no `d`). */
type Light = { p: Vector3; d?: Vector3; k: number };
/** Where a piece stands on the floor (x, z, radius): a soft contact shadow round it. */
type Foot = [number, number, number];

const color = new Color();
/** A part in one colour: non-indexed, no uvs. */
function paint(g: BufferGeometry, hex: string | L3) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  out.deleteAttribute("uv");
  if (typeof hex === "string") color.set(hex);
  else color.setRGB(...hex);
  const c = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < c.length; i += 3) color.toArray(c, i);
  out.setAttribute("color", new Float32BufferAttribute(c, 3));
  return out;
}
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Bake the light into the parts' colours (local frame: x along the window,
 * y up, z out through the glass): a soft bounce, daylight through the glass,
 * the lights by distance and angle, a warm gradient up the walls, darker
 * corners, contact shadows on the floor.
 */
function bake(g: BufferGeometry, lights: Light[], box: { x1: number; z0: number; y0: number; y1: number }, feet: Foot[]) {
  const { position: pos, normal: nrm, color: col } = g.attributes;
  const [p, n, l] = [new Vector3(), new Vector3(), new Vector3()];
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    let k = 0.34 + 0.12 * Math.max(0, n.z) + 0.06 * Math.max(0, n.y);
    for (const s of lights) {
      l.subVectors(s.p, p);
      const d2 = l.lengthSq();
      l.normalize();
      const cone = s.d ? smooth(0.45, 0.85, -l.dot(s.d)) : 1;
      k += (s.k * Math.max(0, n.dot(l)) * cone) / (1 + 7 * d2);
    }
    // corners and the foot of the walls fall darker; pieces shade the floor under them
    k *= 1 - 0.22 * (1 - smooth(0, 0.1, Math.min(p.x, box.x1 - p.x, p.z - box.z0)));
    if (n.y < 0.5) k *= (1 - 0.2 * (1 - smooth(0, 0.08, p.y - box.y0))) * (0.8 + 0.35 * smooth(box.y0, box.y1, p.y));
    if (n.y > 0.9) for (const [x, z, r] of feet) k *= 1 - 0.45 * Math.exp(-((p.x - x) ** 2 + (p.z - z) ** 2) / (r * r)) * (1 - smooth(0, 0.05, p.y - box.y0));
    col.setXYZ(i, col.getX(i) * k * DISPLAY_LIGHT[0], col.getY(i) * k * DISPLAY_LIGHT[1], col.getZ(i) * k * DISPLAY_LIGHT[2]);
  }
}

/** A box with its base at y. */
const block = (x: number, y: number, z: number, w: number, h: number, d: number, hex: string, r = 0) => paint(box([x, y + h / 2, z], [w, h, d], [0, r, 0]), hex);
/** A turned shape (radius, height) standing at y. */
const turned = (x: number, y: number, z: number, profile: P2[], hex: string, seg = 8) =>
  paint(placed(new LatheGeometry(profile.map(([r, h]) => new Vector2(r, h)), seg), [x, y, z]), hex);

/** A stylised mannequin: a round base, a rod, a smooth torso in the garment's colour, a head. */
function mannequin(x: number, y: number, z: number, garment: string, bust = false) {
  const rod = bust ? 0.04 : 0.1;
  const t = y + 0.015 + rod;
  return [
    paint(cyl([x, y + 0.0075, z], 0.06, 0.06, 0.015, 8), BRONZE),
    paint(cyl([x, y + 0.015 + rod / 2, z], 0.006, 0.006, rod, 4), BRONZE),
    turned(x, t, z, [[0, 0], [0.05, 0], [0.064, 0.05], [0.05, 0.13], [0.068, 0.21], [0.078, 0.26], [0.05, 0.295], [0, 0.3]], garment),
    paint(cyl([x, t + 0.31, z], 0.016, 0.018, 0.03, 6), "#e8e2d6"),
    paint(placed(new SphereGeometry(0.036, 10, 7), [x, t + 0.36, z]), "#e8e2d6"),
  ];
}
/** A shoe: sole, vamp and heel counter, toe along +x turned by r. */
function shoe(x: number, y: number, z: number, hex: string, r: number) {
  const [c, s] = [Math.cos(r), -Math.sin(r)];
  const at = (u: number): [number, number] => [x + u * c, z + u * s];
  return [
    block(...xz(at(0), y), 0.09, 0.012, 0.032, "#2e2a26", r),
    block(...xz(at(0.018), y + 0.012), 0.05, 0.022, 0.03, hex, r),
    block(...xz(at(-0.032), y + 0.012), 0.024, 0.03, 0.03, hex, r),
  ];
}
const xz = ([x, z]: [number, number], y: number): [number, number, number] => [x, y, z];
const pair = (x: number, y: number, z: number, hex: string) => [...shoe(x, y, z - 0.022, hex, 0.35), ...shoe(x + 0.01, y, z + 0.022, hex, 0.2)];
/** A handbag: body, flap and a strap arching over it. */
function handbag(x: number, y: number, z: number, hex: string) {
  return [
    block(x, y, z, 0.15, 0.1, 0.06, hex),
    block(x, y + 0.055, z + 0.031, 0.15, 0.045, 0.006, hex),
    paint(placed(new TorusGeometry(0.045, 0.006, 4, 10, Math.PI), [x, y + 0.1, z]), hex),
  ];
}
/** Folded knits or linens, stacked a little untidily. */
const stack = (x: number, y: number, z: number, hexes: string[]) => hexes.map((hex, i) => block(x + (i % 2 ? 0.006 : -0.004), y + i * 0.03, z, 0.15, 0.028, 0.11, hex, (i % 3) * 0.04 - 0.03));

/** What one window shows, in its frame (x 0..w, z out through the glass): pieces, and where they stand. */
function dress(theme: (typeof THEMES)[number], w: number, y: number, pick: (k: number) => string): { parts: BufferGeometry[]; feet: Foot[] } {
  const z = (SHOWCASE.back + -0.08) / 2 + 0.02;
  const pw = Math.min(0.18, w * 0.22);
  if (theme === "mannequins") {
    const xs = w > 1 ? [w * 0.33, w * 0.67] : [w * 0.5];
    return {
      parts: [block(w / 2, y, z, Math.min(w - 0.2, 0.9), 0.03, 0.26, "#e2dbcf"), ...xs.flatMap((x, i) => mannequin(x, y + 0.03, z - 0.02 * i, pick(i)))],
      feet: [[w / 2, z, 0.3]],
    };
  }
  if (theme === "leather") {
    const [x0, x1, x2] = [w * 0.24, w * 0.5, w * 0.76];
    return {
      parts: [block(x0, y, z, pw, 0.14, 0.14, "#e2dbcf"), block(x1, y, z - 0.03, pw, 0.24, 0.16, "#e2dbcf"), block(x2, y, z, pw, 0.08, 0.14, "#e2dbcf"), ...handbag(x1, y + 0.24, z - 0.03, pick(0)), ...pair(x0, y + 0.14, z, pick(1)), ...pair(x2, y + 0.08, z, pick(2))],
      feet: [[x0, z, 0.1], [x1, z - 0.03, 0.11], [x2, z, 0.1]],
    };
  }
  if (theme === "home") {
    const [x0, x1] = [w * 0.28, w * 0.72];
    return {
      parts: [
        block(x0, y, z - 0.04, pw, 0.2, 0.14, "#e2dbcf"),
        turned(x0, y + 0.2, z - 0.04, [[0, 0], [0.03, 0], [0.05, 0.05], [0.045, 0.12], [0.02, 0.19], [0.026, 0.22], [0, 0.22]], pick(0)),
        block(x1, y, z - 0.06, pw, 0.12, 0.14, "#e2dbcf"),
        turned(x1, y + 0.12, z - 0.06, [[0, 0], [0.03, 0], [0.065, 0.04], [0.07, 0.05], [0, 0.012]], pick(1)),
        ...stack(w * 0.5, y, z + 0.08, [pick(2), pick(3), pick(4)]),
      ],
      feet: [[x0, z - 0.04, 0.1], [x1, z - 0.06, 0.1], [w * 0.5, z + 0.08, 0.1]],
    };
  }
  const [x0, x1] = [w * 0.38, w * 0.78];
  const top = y + 0.2;
  return {
    parts: [
      block(x0, top - 0.025, z, 0.32, 0.025, 0.18, "#a88b6a"),
      block(x0 - 0.13, y, z, 0.02, 0.175, 0.16, "#a88b6a"),
      block(x0 + 0.13, y, z, 0.02, 0.175, 0.16, "#a88b6a"),
      ...stack(x0, top, z, [pick(0), pick(1), pick(2)]),
      ...mannequin(x1, y, z - 0.04, pick(3), true),
      ...pair(w * 0.12, y, z + 0.08, pick(4)),
    ],
    feet: [[x0, z, 0.16], [x1, z - 0.04, 0.07], [w * 0.12, z + 0.08, 0.06]],
  };
}

/** The lit box behind one display window, dressed, in its frame (x 0..w). */
function showcase(i: number, w: number) {
  const { back: zb, floor: y0, ceiling: y1 } = SHOWCASE;
  const zf = -0.08;
  const [d, h] = [zf - zb, y1 - y0];
  const bay = SHOP_BAYS[i];
  const pick = (k: number) => GOODS[(i * 3 + k * 2) % GOODS.length];
  const { parts, feet } = dress(bay.theme, w, y0, pick);
  const shell = [
    paint(placed(new PlaneGeometry(w, h, 5, 4), [w / 2, y0 + h / 2, zb]), bay.back),
    paint(placed(new PlaneGeometry(w, d, 6, 3), [w / 2, y0, zb + d / 2], [-Math.PI / 2, 0, 0]), FLOORS_DISPLAY[i % 2]),
    paint(placed(new PlaneGeometry(w, d), [w / 2, y1, zb + d / 2], [Math.PI / 2, 0, 0]), SOFFIT),
    paint(placed(new PlaneGeometry(d, h, 2, 3), [0, y0 + h / 2, zb + d / 2], [0, Math.PI / 2, 0]), bay.back),
    paint(placed(new PlaneGeometry(d, h, 2, 3), [w, y0 + h / 2, zb + d / 2], [0, -Math.PI / 2, 0]), bay.back),
  ];
  const n = w > 1 ? 3 : 2;
  const xs = Array.from({ length: n }, (_, k) => (w * (k + 0.5)) / n);
  const cans = xs.map((x) => paint(cyl([x, y1 - 0.01, -0.15], 0.028, 0.028, 0.02, 6), BRONZE));
  const lit = merged([...shell, ...parts, ...cans]);
  bake(lit, xs.map((x) => ({ p: new Vector3(x, y1 - 0.03, -0.15), d: new Vector3(0, -1, -0.45).normalize(), k: 0.5 })), { x1: w, z0: zb, y0, y1 }, feet);
  const lenses = xs.map((x) => paint(placed(new CircleGeometry(0.02, 6), [x, y1 - 0.021, -0.15], [Math.PI / 2, 0, 0]), SPOT_LENS));
  return merged([lit, ...lenses]);
}

/** The lobby behind the corner doors (x along the cut, z out): marble floor, brass elevator doors, a directory, a pendant. */
function lobby() {
  const { a0, a1, c0: zb, c1: zf, top } = LOBBY;
  const [w, d] = [a1 - a0, zf - zb];
  const xm = (a0 + a1) / 2;
  const zm = (zb + zf) / 2;
  const STONE = "#d6cdbd";
  const BRASS = "#b08d57";
  const tiles = Array.from({ length: 8 }, (_, k) => {
    const [i, j] = [k % 4, Math.floor(k / 4)];
    return paint(placed(new PlaneGeometry(w / 4, d / 2), [a0 + (w * (i + 0.5)) / 4, 0, zb + (d * (j + 0.5)) / 2], [-Math.PI / 2, 0, 0]), (i + j) % 2 ? "#4d4f4a" : "#e6dfd2");
  });
  const parts = [
    ...tiles,
    paint(placed(new PlaneGeometry(w, top, 3, 3), [xm, top / 2, zb]), STONE),
    paint(placed(new PlaneGeometry(w, d), [xm, top, zm], [Math.PI / 2, 0, 0]), SOFFIT),
    paint(placed(new PlaneGeometry(d, top, 1, 3), [a0, top / 2, zm], [0, Math.PI / 2, 0]), STONE),
    paint(placed(new PlaneGeometry(d, top, 1, 3), [a1, top / 2, zm], [0, -Math.PI / 2, 0]), STONE),
    // the elevator: a brass surround, two doors with a seam, the floor dial over them
    block(xm, 0, zb + 0.008, 0.4, 0.86, 0.016, "#9c7a48"),
    block(xm - 0.0925, 0, zb + 0.02, 0.175, 0.8, 0.012, BRASS),
    block(xm + 0.0925, 0, zb + 0.02, 0.175, 0.8, 0.012, BRASS),
    paint(placed(new CircleGeometry(0.05, 8, 0, Math.PI), [xm, 0.875, zb + 0.004]), BRASS),
    // the directory on the side wall: a dark board in a brass frame, its lines of names
    paint(box([a0 + 0.012, 0.62, zm], [0.012, 0.3, 0.2]), BRASS),
    paint(box([a0 + 0.02, 0.62, zm], [0.006, 0.27, 0.17]), "#2f2b27"),
    ...[0.7, 0.66, 0.62, 0.58, 0.54].map((y) => paint(box([a0 + 0.024, y, zm], [0.003, 0.012, 0.12]), "#d9cfb8")),
    // the pendant: a cord and a brass shade
    paint(box([xm, (top + 0.98) / 2, zm], [0.006, top - 0.98, 0.006]), BRONZE),
    turned(xm, 0.9, zm, [[0, 0.08], [0.02, 0.075], [0.06, 0.03], [0.075, 0], [0.07, 0], [0, 0.07]], BRASS),
  ];
  const lit = merged(parts);
  bake(lit, [{ p: new Vector3(xm, 0.86, zm), k: 0.9 }, { p: new Vector3(xm, top - 0.05, zf), d: new Vector3(0, -0.7, -1).normalize(), k: 0.4 }], { x1: a1, z0: zb, y0: 0, y1: top }, []);
  // the bulb under the shade
  const bulb = paint(placed(new OctahedronGeometry(0.026), [xm, 0.905, zm]), SPOT_LENS);
  return merged([lit, bulb]);
}

/** Maps a frame's (x along, y, z out) to the world, starting at `a` along it. */
function frameMatrix({ o, u }: Frame, a: number) {
  const along = new Vector3(...u);
  return new Matrix4().makeBasis(along, new Vector3(0, 1, 0), new Vector3(-u[2], 0, u[0])).setPosition(new Vector3(...o).addScaledVector(along, a));
}
/** A flat pane facing out of its frame, from a0 to a1 and y0 to y1, at depth c. */
function pane(f: Frame, a0: number, a1: number, y0: number, y1: number, c: number) {
  return placed(new PlaneGeometry(a1 - a0, y1 - y0), [(a0 + a1) / 2, (y0 + y1) / 2, c]).applyMatrix4(frameMatrix(f, 0)).deleteAttribute("uv");
}

/**
 * The display windows and the lobby, in world x, z and y from the ground:
 * `content` (vertex colours with the light baked in: back panels, floors,
 * soffits with their spots, the pieces on show) and `glass` (a clear pane over
 * each window and the lobby doors, for the shop glass material).
 */
export function displayGeometry() {
  const content = merged([
    ...SHOP_BAYS.map((b, i) => showcase(i, b.a1 - b.a0).applyMatrix4(frameMatrix(b.f, b.a0))),
    lobby().applyMatrix4(frameMatrix(LOBBY.f, 0)),
  ]);
  const glass = merged([
    ...SHOP_BAYS.map((b) => pane(b.f, b.a0, b.a1, SHOWCASE.floor, SHOWCASE.ceiling, SHOWCASE.glass)),
    pane(LOBBY.f, LOBBY.a0, LOBBY.a1, 0.02, 1.08, LOBBY.c1 + 0.002),
  ]);
  return { content, glass };
}

/** 12:00 Union Square: rooftop billboard with the visitor's ad, cable car below. */
export function UnionSquare() {
  const interior = useInterior();
  const ad = useSign(useBrand(), { bg: "#3d5afe", fg: "#ffffff", sub: "Weekend sale · 20% off", tracking: 0.08, panel: AD_PANEL });
  // No lap siding or shingles here: the siding texture fills both slots (as on the 06:00 apartment).
  const { siding } = useLandmarkTextures();
  const paint = useMemo(() => houseMaterial(siding, siding, palette()), [siding]);
  const building = useMemo(() => buildingGeometry(), []);
  const steelGeometry = useMemo(() => billboardGeometry(), []);
  const lampGeometry = useMemo(() => glowGeometry(), []);
  const display = useMemo(() => displayGeometry(), []);
  // the shops' own light, baked: readable by day, brighter at night
  const shops = useMemo(() => new MeshBasicMaterial({ vertexColors: true }), []);
  const shopGlass = useMemo(() => glassMaterial(), []);
  // Seen edge-on, thin members behind the ad face get unreliable depth in software GL and dot through it:
  // a slope-scaled offset pushes exactly those steep faces back.
  const steel = useMemo(() => new MeshStandardMaterial({ color: "#2c2c31", roughness: 0.55, metalness: 0.45, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }), []);
  const glow = useMemo(() => new MeshBasicMaterial({ vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false, side: DoubleSide }), []);
  useFrame(() => {
    glow.color.setScalar(rig.night);
    shops.color.setScalar(0.9 + 0.5 * rig.night);
  });
  // polygonOffset: the face always wins the depth test against the steel just behind it (low-precision depth buffers too)
  const adMat = useMemo(() => new MeshStandardMaterial({ map: ad, roughness: 0.6, emissive: "#ffffff", emissiveMap: ad, emissiveIntensity: 0.15, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), [ad]);
  useNightGlow(adMat, 0.75, 0.15);
  return (
    <group position-y={heightAt(7, 9)}>
      <mesh geometry={building} material={paint} castShadow receiveShadow />
      <mesh geometry={steelGeometry} material={steel} castShadow receiveShadow />
      <mesh geometry={lampGeometry} material={glow} />
      <mesh ref={interior} geometry={display.content} material={shops} />
      <mesh geometry={display.glass} material={shopGlass} />
      <mesh position={[BOARD.x, BOARD.y, FACE_Z]} material={adMat}>
        <planeGeometry args={AD_PANEL} />
      </mesh>
      {/* shuttles west of the Bay Bridge ramp */}
      <Rails x0={-2.5} x1={8} z={14} />
      <CableCar p={UNION_CAR.p} />
    </group>
  );
}
