"use client";

// 09:00 Mission: a three-storey corner building, modelled with the row
// houses' kit and painted by their material (house-models.ts), in warm
// apricot stucco. A taqueria on the ground floor faces Dolores Park (south):
// pilasters, a panelled stall riser, display glass with a transom, a
// recessed corner door, a sign band and a canvas awning; the flats' own door
// at the west end. Two floors of flats above in two bay windows, under a
// bracketed cornice. The side wall on Cuso's street (east) is a broad, flat
// party wall: a painted base band and a line over the visitor's posts,
// pasted up in a 4 x 3 grid. Two gooseneck lamps over the posts wash the
// wall at night. A wooden ladder leans on it; a paint pail stands on the
// sidewalk.
//
// Draw calls: building 1, props (ladder, pail, lamps) 1, lamp bulbs 1,
// sign 1, night wash 1; posts 4 (cards, photos, and the new post's two).

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { AdditiveBlending, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry, type Group, type Texture } from "three";
import { heightAt } from "@/lib/terrain";
import { useCity } from "@/lib/store";
import { PALETTES, SLOT, builder, palette, type Builder, type Frame, type P2, type Rect, type Span } from "./house-models";
import { box, cyl, drawn, merged, placed, useLandmarkTextures, useMat } from "./landmark-kit";
import { facadeNight } from "./facade";
import { houseMaterial, glassMaterial } from "./materials";
import { useGlow, type V3 } from "./parts";
import { rig, useInterior, useNightGlow } from "./shared";
import { useSign } from "./textures";

/** Where each post hangs on the side wall (4 x 3), and which one is new. */
export const POSTS = Array.from({ length: 12 }, (_, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { row, col, y: 1.2 + row * 1.35, z: 27.1 + col * 1.25, fresh: row === 1 && col === 2 };
});

/** One post's square of the 4 x 3 photo grid in posts.jpg (a small inset hides the seams). */
export function postUv(g: BufferGeometry, row: number, col: number) {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, col * 0.25 + 0.005 + uv.getX(i) * 0.24, row / 3 + 0.006 + uv.getY(i) * 0.32);
  return g;
}

// The footprint: the east end of the block, its full depth. Heights from the ground at the wall.
const [X0, X1, Z0, Z1] = [-10.4, -5.4, 26.4, 31.6];
const W = X1 - X0; // along the front
const D = Z1 - Z0; // along the side wall
const STORE = 2.9; // top of the shopfront (its cornice)
const FLOORS = [2.9, 4.5]; // the flats
const WIN: Span = [0.38, 1.3]; // their windows, above the floor
const FRIEZE = 6.05;
const BED = 6.25; // the roof, and the foot of the crown
const TOP = 6.45;
const OVER = 0.4; // the crown's reach
const PARAPET = 0.14;
const BAY_D = 0.3;
const AWNING = { a: [1.2, 3.84] as Span, top: 2.4, low: 2.0, out: 0.62, valance: 0.13 };

/** The taqueria's room, inside the shopfront (y up to its ceiling). */
const GROUND = heightAt(-5.7, 29);
const ROOM = (() => {
  const [x0, x1, z0, z1] = [X0 + 1.1, X1 - 0.12, 28.3, Z1 - 0.07];
  // the floor clears the ground (it rises a little to the west) everywhere inside
  let top = -Infinity;
  for (let x = x0; x <= x1 + 1e-6; x += (x1 - x0) / 8) for (let z = z0; z <= z1 + 1e-6; z += (z1 - z0) / 8) top = Math.max(top, heightAt(x, z));
  return { x0, x1, z0, z1, floor: top - GROUND + 0.01, h: 2.42 };
})();

/** The building, ladder and pail in world terms, for the tests and the collision check. */
export const MISSION = {
  x0: X0, x1: X1, z0: Z0, z1: Z1,
  /** Everything stands on the ground at the side wall (posts included). */
  ground: GROUND,
  top: TOP,
  /** The crown starts here and reaches `overhang` out over the front. */
  cornice: BED,
  overhang: OVER,
  /** The furthest anything reaches over the front sidewalk (the awning), and the lowest it hangs out there. */
  reach: AWNING.out + 0.02,
  awning: AWNING.low - AWNING.valance,
  ladder: { x: -4.75, z: 28.5, lean: 0.18, h: 3.2 },
  bucket: { x: -4.9, z: 27.6, r: 0.24, h: 0.44 },
  room: ROOM,
  /** The two lamps over the posts: along the wall (z), their arm's height, how far they reach out. */
  lamps: { z: [27.75, 30.25], y: 5.05, out: 0.5 },
  /** The taqueria's sign on the front: centre (local a along the front, y) and size. */
  sign: { a: 3.0, y: 2.62, size: [3.2, 0.28] as const },
};

// Walls, each facing out: a runs along it, c out of it (house-models.ts).
const SOUTH: Frame = { o: [X0, 0, Z1], u: [1, 0, 0] }; // the front, a from the west end
const EAST: Frame = { o: [X1, 0, Z1], u: [0, 0, -1] }; // the side wall, a from the front corner
const NORTH: Frame = { o: [X1, 0, Z0], u: [-1, 0, 0] }; // the back street, a from the east corner
const WEST: Frame = { o: [X0, 0, Z0], u: [0, 0, 1] }; // the party wall to the houses
const at = ({ o, u }: Frame, a: number, c: number): P2 => [o[0] + u[0] * a - u[2] * c, o[2] + u[2] * a + u[0] * c];

/** A bay over the shopfront up to the cornice: three faces, a room (one window id) per floor, posts, floor bands, a cap. */
function bay(k: Builder, f: Frame, wall: Span, front: Span, id: number) {
  const plan: P2[] = [[wall[0], 0], [front[0], BAY_D], [front[1], BAY_D], [wall[1], 0]];
  for (let i = 0; i < 3; i++) {
    const [p, q] = [plan[i], plan[i + 1]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [ox, oz] = at(f, p[0], p[1]);
    const [ex, ez] = at(f, q[0], q[1]);
    const face: Frame = { o: [ox, 0, oz], u: [(ex - ox) / len, 0, (ez - oz) / len] };
    const m = i === 1 ? 0.12 : 0.07;
    const holes: Rect[] = FLOORS.map((y) => [m, len - m, y + WIN[0], y + WIN[1]]);
    k.wall(face, 0, len, STORE, BED, holes, SLOT.stucco);
    holes.forEach((r, j) => {
      k.window(face, r, id + j);
      if (i === 1) k.box(face, m + 0.02, len - m - 0.02, FLOORS[j] + 0.1, r[2] - 0.07, 0, 0.02, SLOT.panel);
    });
  }
  for (const [a, c] of plan) k.box(f, a - 0.04, a + 0.04, STORE, BED, Math.max(0, c - 0.03), c + 0.035, SLOT.trim);
  const g = 0.04;
  const grown: P2[] = [[wall[0] - g, 0], [front[0] - g * 0.4, BAY_D + g], [front[1] + g * 0.4, BAY_D + g], [wall[1] + g, 0]];
  k.prism(f, grown, STORE, STORE + 0.08, SLOT.trim);
  k.prism(f, grown, FLOORS[1] - 0.04, FLOORS[1] + 0.04, SLOT.trim);
  k.prism(f, grown, FRIEZE, BED, SLOT.frieze);
  return id + FLOORS.length;
}

/** A plain window punched in stucco: glass and sash, a sill and a flat head, both just proud of the wall. */
function punched(k: Builder, f: Frame, r: Rect, id: number) {
  k.window(f, r, id);
  k.box(f, r[0] - 0.05, r[1] + 0.05, r[2] - 0.05, r[2], 0, 0.05, SLOT.trim);
  k.box(f, r[0] - 0.03, r[1] + 0.03, r[3], r[3] + 0.06, 0, 0.03, SLOT.trim);
}

/** A pilaster on the shopfront: plinth, shaft, capital. */
function pilaster(k: Builder, a0: number, a1: number) {
  const [g0, g1] = [Math.max(0, a0 - 0.015), Math.min(W, a1 + 0.015)]; // flush at the corners
  k.box(SOUTH, g0, g1, -0.6, 0.32, 0, 0.12, SLOT.stone);
  k.box(SOUTH, a0, a1, 0.32, 2.42, 0, 0.09, SLOT.trim);
  k.box(SOUTH, g0, g1, 2.3, 2.42, 0, 0.11, SLOT.trim);
}

/** The shopfront's openings along the front (a) and the height of their heads. */
const OPENINGS = { flats: [0.16, 0.98] as Span, display: [1.14, 3.9] as Span, door: [4.06, 4.82] as Span, head: 2.38 };

/** The building in world x, z and y from the ground, in the house material's attributes. */
function shellGeometry() {
  const k = builder();
  let id = 0;

  // The front: the taqueria and the flats' door, then two bays up to the cornice.
  const { flats, display, door, head } = OPENINGS;
  k.wall(SOUTH, 0, W, -1.7, STORE, [[flats[0], flats[1], 0, head], [display[0], display[1], 0.5, head], [door[0], door[1], 0, head]], SLOT.stucco);
  for (const [a0, a1] of [[0, 0.16], [0.98, 1.14], [3.9, 4.06], [4.82, W]]) pilaster(k, a0, a1);

  // the display: stall riser with two raised panels, a sill, two lights and a transom (the clear glass is shopGlass)
  k.box(SOUTH, display[0], display[1], -0.3, 0.5, 0, 0.05, SLOT.door);
  for (const [p0, p1] of [[1.24, 2.47], [2.57, 3.8]]) k.box(SOUTH, p0, p1, 0.1, 0.4, 0.05, 0.065, SLOT.door);
  k.box(SOUTH, display[0], display[1], 0.5, 0.56, 0, 0.11, SLOT.trim);
  k.reveal(SOUTH, [display[0], display[1], 0.56, head], 0, -0.06, SLOT.trim);
  const mid = (display[0] + display[1]) / 2;
  k.box(SOUTH, mid - 0.035, mid + 0.035, 0.56, head, -0.06, 0.0, SLOT.door);
  k.box(SOUTH, display[0], display[1], 2.0, 2.06, -0.06, 0.0, SLOT.door);
  for (const a of [display[0] + 0.69, display[1] - 0.69]) k.box(SOUTH, a - 0.02, a + 0.02, 2.06, head, -0.06, -0.02, SLOT.door);

  // the shop door, recessed at the corner: a glazed door, a transom, a stone step
  k.reveal(SOUTH, [door[0], door[1], 0, head], 0, -0.3, SLOT.trim);
  k.box(SOUTH, door[0], door[1], -0.6, 0.02, -0.3, 0.06, SLOT.stone);
  const [d0, d1] = [door[0] + 0.06, door[1] - 0.06];
  k.box(SOUTH, d0, d1, 0.02, 0.5, -0.3, -0.27, SLOT.door);
  k.box(SOUTH, d0, d1, 1.92, 2.0, -0.3, -0.27, SLOT.door);
  for (const [a0, a1] of [[d0, d0 + 0.08], [d1 - 0.08, d1]]) k.box(SOUTH, a0, a1, 0.5, 1.92, -0.3, -0.27, SLOT.door);
  k.box(SOUTH, door[0], door[1], 2.0, 2.06, -0.3, -0.24, SLOT.door);

  // the flats' door: recessed, panelled, a transom light
  k.reveal(SOUTH, [flats[0], flats[1], 0, head], 0, -0.25, SLOT.trim);
  k.box(SOUTH, flats[0], flats[1], -0.6, 0.02, -0.25, 0.05, SLOT.stone);
  const [f0, f1] = [flats[0] + 0.1, flats[1] - 0.1];
  k.quad(SOUTH, flats[0], flats[1], 0, head, -0.25, SLOT.trim);
  k.box(SOUTH, f0, f1, 0.02, 1.95, -0.25, -0.22, SLOT.door);
  for (const [p0, p1] of [[0.12, 0.85], [1.0, 1.82]]) k.box(SOUTH, f0 + 0.08, f1 - 0.08, p0, p1, -0.22, -0.205, SLOT.door);
  k.glazing(SOUTH, [f0, f1, 2.0, head - 0.04], -0.235, ++id, false);

  // the sign band over the shop (the sign itself is its own mesh), its cornice across the whole front
  k.box(SOUTH, 0.16, W, 2.42, 2.8, 0, 0.06, SLOT.trim);
  k.box(SOUTH, 0, W, 2.76, 2.8, 0, 0.1, SLOT.trim);
  k.box(SOUTH, 0, W, 2.8, STORE, 0, 0.18, SLOT.frieze);
  const { a: sa, y: sy, size: [sw, sh] } = MISSION.sign;
  for (const [a0, a1, b0, b1] of [[sa - sw / 2 - 0.03, sa + sw / 2 + 0.03, sy + sh / 2, sy + sh / 2 + 0.03], [sa - sw / 2 - 0.03, sa + sw / 2 + 0.03, sy - sh / 2 - 0.03, sy - sh / 2]]) k.box(SOUTH, a0, a1, b0, b1, 0.06, 0.08, SLOT.door);

  // the canvas awning over the display: a sloped skin, a valance, open triangle sides
  const { a: [w0, w1], top, low, out, valance } = AWNING;
  k.profile(SOUTH, w0, w1, [[0, top], [out, low], [out, low - 0.025], [0, top - 0.025]], SLOT.brick);
  k.profile(SOUTH, w0, w1, [[out - 0.015, low], [out + 0.005, low], [out + 0.005, low - valance], [out - 0.015, low - valance]], SLOT.brick);
  for (const [a, s] of [[w0, -1], [w1, 1]] as const) {
    k.face(SOUTH, [[a, top, 0], [a, low, out], [a, low, 0.02]], [s, 0, 0], SLOT.brick);
    k.face(SOUTH, [[a, top, 0], [a, low, out], [a, low, 0.02]], [-s, 0, 0], SLOT.brick);
  }

  // the flats: two bays, the wall between and beside them, the cornice on brackets
  k.wall(SOUTH, 0, W, STORE, BED, [], SLOT.stucco);
  id = bay(k, SOUTH, [0.32, 2.28], [0.58, 2.02], id + 1);
  id = bay(k, SOUTH, [2.72, 4.68], [2.98, 4.42], id + 1);
  k.box(SOUTH, 0, W, FRIEZE, BED - 0.05, 0, 0.05, SLOT.frieze);
  k.box(SOUTH, 0, W, BED - 0.05, BED, 0, 0.12, SLOT.trim);
  // the crown: a fascia, a cove out to its reach, a cap
  k.box(SOUTH, 0, W, BED, BED + 0.08, 0, OVER - 0.14, SLOT.trim);
  k.profile(SOUTH, 0, W, [[0, BED + 0.08], [OVER - 0.14, BED + 0.08], [OVER - 0.02, BED + 0.16], [0, BED + 0.16]], SLOT.trim);
  k.box(SOUTH, 0, W, BED + 0.16, TOP, 0, OVER, SLOT.trim);
  for (const a of [0.12, 2.5, 4.88]) k.profile(SOUTH, a - 0.05, a + 0.05, [[0, FRIEZE - 0.2], [0.06, FRIEZE - 0.2], [OVER - 0.03, BED], [0, BED]], SLOT.trim);
  for (let a = 0.06; a < W - 0.05; a += 0.16) k.box(SOUTH, a, a + 0.08, BED - 0.13, BED - 0.05, 0.12, 0.2, SLOT.trim); // dentils

  // The side wall: flat stucco, a painted base band and a line over the posts.
  k.wall(EAST, 0, D, -1.7, TOP - 0.04, [], SLOT.stucco);
  k.quad(EAST, 0, D, -0.05, 0.34, 0.003, SLOT.brick);
  k.quad(EAST, 0, D, 4.64, 4.72, 0.003, SLOT.brick);

  // The back street: the shop's back door, a small window, two floors of plain windows.
  const back: Rect[] = [[0.9, 1.6, 0, 1.95], [2.6, 3.2, 1.0, 1.9], ...FLOORS.flatMap((y) => [1.3, 3.7].map((a): Rect => [a - 0.36, a + 0.36, y + WIN[0], y + WIN[1]]))];
  k.wall(NORTH, 0, W, -1.7, TOP - 0.04, back, SLOT.stucco);
  k.reveal(NORTH, back[0], 0, -0.08, SLOT.trim);
  k.box(NORTH, 0.9, 1.6, 0, 1.95, -0.08, -0.05, SLOT.door);
  k.box(NORTH, 0.84, 1.66, 1.95, 2.03, 0, 0.04, SLOT.trim);
  for (const r of back.slice(1)) punched(k, NORTH, r, ++id);

  // The party wall to the houses, and the roof: tar behind a parapet with a stone coping.
  k.wall(WEST, 0, D, -1.7, TOP - 0.04, [], SLOT.stucco);
  k.face(SOUTH, [[PARAPET, BED, 0], [W - PARAPET, BED, 0], [W - PARAPET, BED, -D + PARAPET], [PARAPET, BED, -D + PARAPET]], [0, 1, 0], SLOT.tar);
  for (const [f, len] of [[EAST, D], [NORTH, W], [WEST, D]] as const) {
    k.quad(f, 0, len, BED, TOP - 0.04, -PARAPET, SLOT.stucco, 0, -1);
    k.box(f, 0, len, TOP - 0.04, TOP, -PARAPET - 0.01, 0, SLOT.stone);
  }
  k.box(NORTH, 4.2, 4.6, BED, BED + 0.55, -1.4, -1.0, SLOT.brick); // a chimney
  k.box(NORTH, 4.16, 4.64, BED + 0.55, BED + 0.6, -1.44, -0.96, SLOT.stone);

  const g = k.geometry();
  g.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(g.attributes.position.count).fill(PAINT), 1));
  return g;
}

/** Warm apricot stucco, cream trim, deep brown doors (PALETTES). */
const PAINT = PALETTES.findIndex((p) => p.name === "apricot");

// ---------------------------------------------------------------------------
// Props: vertex-coloured.

const C = { wood: "#b38a5a", rung: "#a27a4c", foot: "#2d2a27", tin: "#a8adb0", rim: "#8e9397", paint: "#3d5afe", iron: "#2e3230" };

function tint(g: BufferGeometry, hex: string) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  g.setAttribute("color", new Float32BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return g.index ? g.toNonIndexed() : g;
}

/** A wooden ladder, its foot at the origin, in the y-z plane: tapered rails and round rungs, rubber feet. */
function ladder(h: number) {
  const out: BufferGeometry[] = [];
  const [bottom, topW] = [0.34, 0.27]; // half widths
  const splay = Math.atan2(bottom - topW, h);
  const half = (y: number) => bottom - ((bottom - topW) * y) / h;
  for (const s of [-1, 1]) {
    out.push(tint(box([0, h / 2, s * half(h / 2)], [0.075, h, 0.035], [-s * splay, 0, 0]), C.wood));
    out.push(tint(box([0, 0.03, s * bottom], [0.085, 0.06, 0.05]), C.foot));
  }
  for (let y = 0.32; y < h - 0.1; y += 0.36) out.push(tint(cyl([0, y, 0], 0.02, 0.02, 2 * half(y) + 0.05, 8, [Math.PI / 2, 0, 0]), C.rung));
  return out;
}

/** A galvanised pail, full of blue paint, a wire handle and drips down its side. */
function pail(r: number, h: number) {
  const r0 = r - 0.04;
  const radius = (y: number) => r0 + ((r - r0) * y) / h;
  const out: BufferGeometry[] = [
    tint(cyl([0, h / 2, 0], r, r0, h, 24), C.tin),
    tint(placed(new TorusGeometry(r, 0.014, 6, 24), [0, h, 0], [Math.PI / 2, 0, 0]), C.rim),
    ...[0.16, 0.3].map((y) => tint(placed(new TorusGeometry(radius(y) + 0.002, 0.008, 4, 24), [0, y, 0], [Math.PI / 2, 0, 0]), C.rim)),
    tint(cyl([0, h + 0.002, 0], r - 0.012, r - 0.012, 0.004, 24), C.paint),
    // the handle: a wire arc between two ears
    tint(placed(new TorusGeometry(r + 0.01, 0.007, 4, 20, Math.PI), [0, h - 0.04, 0], [0, 0.5, 0]), C.iron),
    ...[1, -1].map((s) => tint(box([s * (r + 0.004) * Math.cos(0.5), h - 0.04, -s * (r + 0.004) * Math.sin(0.5)], [0.025, 0.05, 0.03], [0, 0.5, 0]), C.rim)),
    // a small puddle beside it
    tint(cyl([0.18, 0.003, 0.24], 0.1, 0.1, 0.006, 16), C.paint),
  ];
  // drips from the rim, each with a bead at its end
  for (const [turn, len] of [[0.2, 0.16], [0.9, 0.08], [1.5, 0.24], [2.4, 0.12], [3.3, 0.19], [4.4, 0.1], [5.4, 0.15]]) {
    const y = h - len / 2;
    const rr = radius(y) + 0.003;
    out.push(tint(box([rr * Math.cos(turn), y, -rr * Math.sin(turn)], [0.006, len, 0.024], [0, turn, 0]), C.paint));
    const yb = h - len;
    const rb = radius(yb) + 0.005;
    out.push(tint(placed(new SphereGeometry(0.016, 6, 4), [rb * Math.cos(turn), yb, -rb * Math.sin(turn)]), C.paint));
  }
  return out;
}

/** Two gooseneck lamps over the posts: wall plate, arm, shade facing the wall; the bulbs separately (they glow). */
const { z: LAMPS, y: LAMP_Y } = MISSION.lamps;
function lamps() {
  const iron: BufferGeometry[] = [];
  const bulbs: BufferGeometry[] = [];
  for (const z of LAMPS) {
    iron.push(tint(box([X1 + 0.015, LAMP_Y, z], [0.03, 0.16, 0.12]), C.iron));
    iron.push(tint(box([X1 + 0.2, LAMP_Y + 0.02, z], [0.36, 0.025, 0.025]), C.iron));
    iron.push(tint(box([X1 + 0.39, LAMP_Y - 0.02, z], [0.025, 0.1, 0.025]), C.iron));
    // the shade: an open cone tilted back at the wall
    iron.push(tint(cyl([X1 + 0.38, LAMP_Y - 0.11, z], 0.035, 0.13, 0.13, 16, [0, 0, -0.6]), C.iron));
    bulbs.push(placed(new SphereGeometry(0.05, 10, 6), [X1 + 0.33, LAMP_Y - 0.19, z]));
  }
  return { iron, bulbs };
}

// ---------------------------------------------------------------------------
// The taqueria inside: seen through the display and the door. Plain parts
// with a vertex colour, a glow (`aGlow`: 1 the room, its light baked in the
// shader; more for things lit from inside: the menu, the cooler, the bulbs)
// and a surface (`aMat`, TAQUERIA_MAT) the shader dresses.

/** Surfaces the taqueria's material draws. */
export const TAQUERIA_MAT = { plain: 0, wood: 1, floor: 2, tile: 3, plaster: 4, metal: 5, glaze: 6, menu: 7, leaf: 8, paper: 9, flag: 10 } as const;
type TMat = (typeof TAQUERIA_MAT)[keyof typeof TAQUERIA_MAT];

/** The menu on the back wall: plain words and prices. */
export const MENU: [string, string][] = [
  ["Tacos", "3.50"],
  ["Burrito", "11"],
  ["Quesadilla", "9"],
  ["Torta", "10"],
  ["Nachos", "8"],
  ["Tamales", "4"],
  ["Horchata", "3.50"],
  ["Agua fresca", "3.50"],
];

const T = TAQUERIA_MAT;
const TABLE_AT: P2[] = [[-8.65, 30.95], [-7.4, 30.95]];
const PENDANT_AT: V3[] = TABLE_AT.map(([x, z]): V3 => [x, 2.02, z]);
const COUNTER = { x0: -8.6, x1: -6.0, z0: 28.75, z1: 29.35, top: 0.97 };
const COOLER = { x0: -9.25, x1: -8.7, z0: 28.32, z1: 28.95, top: 1.95 };
const MENU_BOARD = { x0: -8.45, x1: -6.15, y0: 1.36, y1: 2.04 };
const POT: P2 = [-6.75, 31.08];

const K = {
  saltillo: "#b97c5c",
  plaster: "#efe4cf",
  ceiling: "#f1e8d6",
  tile: "#c99a4e",
  wood: "#5a3b28",
  panel: "#6e4a32",
  top: "#b9bcbd",
  iron: "#2e3230",
  enamel: "#efe6d2",
  bulb: "#fff1d8",
  pot: "#b5724f",
  soil: "#3b2c22",
  leaf: "#4d6a3d",
  leaf2: "#5f7d48",
  cactus: "#5d7a4a",
  cooler: "#e5e3dd",
  coolerBack: "#f4f0e6",
  board: "#2a2522",
  flags: ["#c4704f", "#d6a347", "#efe4cf", "#93a585", "#c98a7e"],
  salsas: ["#9a3b2a", "#6f7f3a", "#c8792f", "#e8dfcf", "#6b3b2a"],
  bottles: ["#8e2f3a", "#eee4d2", "#8a5a35", "#b07a3a", "#5f7a52"],
};

function dress(g: BufferGeometry, hex: string, mat: TMat, glow = 1) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  g.setAttribute("color", new Float32BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(n).fill(glow), 1));
  g.setAttribute("aMat", new Float32BufferAttribute(new Float32Array(n).fill(mat), 1));
  return g;
}

const up = new Vector3(0, 1, 0);
const rodMatrix = new Matrix4();
/** A round rod from a to b (chair legs, posts, cords). */
function rod(a: V3, b: V3, r: number, seg = 6) {
  const d = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const q = new Quaternion().setFromUnitVectors(up, d.normalize());
  rodMatrix.compose(new Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new Vector3(1, 1, 1));
  return new CylinderGeometry(r, r, len, seg, 1, true).applyMatrix4(rodMatrix);
}

/** A plane at p facing `face` (+x, -x, +y, -y, +z). */
function sheet(w: number, h: number, p: V3, face: "+x" | "-x" | "+y" | "-y" | "+z") {
  const r: Record<typeof face, V3> = { "+x": [0, Math.PI / 2, 0], "-x": [0, -Math.PI / 2, 0], "+y": [-Math.PI / 2, 0, 0], "-y": [Math.PI / 2, 0, 0], "+z": [0, 0, 0] };
  return placed(new PlaneGeometry(w, h), p, r[face]);
}

/** A bentwood chair at x, z facing `turn` (0: towards +z): round seat, splayed legs, a leg ring, a hooped back. */
function chair(out: BufferGeometry[], x: number, z: number, turn: number) {
  const [fx, fz] = [Math.sin(turn), Math.cos(turn)];
  // u across the chair, v forward
  const at = (u: number, y: number, v: number): V3 => [x + u * fz + v * fx, y, z - u * fx + v * fz];
  const seat = 0.46;
  out.push(dress(cyl([x, seat, z], 0.17, 0.165, 0.035, 14), K.wood, T.wood));
  for (const [u, v] of [[-0.12, 0.1], [0.12, 0.1], [-0.11, -0.1], [0.11, -0.1]]) out.push(dress(rod(at(u, seat - 0.02, v), at(u * 1.25, 0.008, v * 1.3), 0.012), K.wood, T.wood));
  out.push(dress(placed(new TorusGeometry(0.135, 0.008, 4, 18), [x, 0.2, z], [Math.PI / 2, 0, 0]), K.wood, T.wood));
  // the back: two posts up from the back legs, bent into a hoop
  const [bu, bv, top] = [0.11, -0.13, 0.78];
  for (const s of [-1, 1]) out.push(dress(rod(at(s * bu, seat, bv), at(s * bu, top, bv - 0.04), 0.012), K.wood, T.wood));
  const hoop = new TorusGeometry(bu, 0.012, 4, 10, Math.PI);
  out.push(dress(placed(hoop, at(0, top, bv - 0.04), [0, turn, 0]), K.wood, T.wood));
  out.push(dress(placed(new TorusGeometry(0.075, 0.009, 4, 8, Math.PI), at(0, 0.6, bv - 0.02), [Math.PI, turn, 0]), K.wood, T.wood));
}

/** A cafe table: a round wooden top, an iron column, a cross foot; a napkin box and a hot sauce on it. */
function table(out: BufferGeometry[], [x, z]: P2) {
  out.push(dress(cyl([x, 0.74, z], 0.24, 0.24, 0.03, 20), "#7a5236", T.wood));
  out.push(dress(cyl([x, 0.715, z], 0.07, 0.07, 0.02, 10), K.iron, T.metal));
  out.push(dress(cyl([x, 0.37, z], 0.028, 0.028, 0.68, 8), K.iron, T.metal));
  for (const r of [Math.PI / 4, -Math.PI / 4]) out.push(dress(box([x, 0.02, z], [0.44, 0.03, 0.045], [0, r, 0]), K.iron, T.metal));
  out.push(dress(box([x - 0.05, 0.8, z - 0.05], [0.1, 0.09, 0.06]), "#c9cccb", T.metal));
  out.push(dress(cyl([x + 0.07, 0.8, z + 0.02], 0.022, 0.022, 0.09, 8), "#8e2f3a", T.glaze));
  out.push(dress(cyl([x + 0.07, 0.855, z + 0.02], 0.009, 0.012, 0.03, 6), "#efe6d2", T.glaze));
}

/** The walls of the room, inside: a tiled wainscot with a wooden cap, plaster above. */
function walls(out: BufferGeometry[]) {
  const r = ROOM;
  const [w, d] = [r.x1 - r.x0, r.z1 - r.z0];
  const [cx, cz] = [(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2];
  const dado = 0.95;
  out.push(dress(sheet(w, d, [cx, 0, cz], "+y"), K.saltillo, T.floor));
  out.push(dress(sheet(w, d, [cx, r.h, cz], "-y"), K.ceiling, T.plaster));
  const sides: [number, "+x" | "-x" | "+z", (y: number) => V3][] = [
    [w, "+z", (y) => [cx, y, r.z0]],
    [d, "+x", (y) => [r.x0, y, cz]],
    [d, "-x", (y) => [r.x1, y, cz]],
  ];
  for (const [len, face, at] of sides) {
    out.push(dress(sheet(len, dado, at(dado / 2), face), K.tile, T.tile));
    out.push(dress(sheet(len, r.h - dado, at((dado + r.h) / 2), face), K.plaster, T.plaster));
  }
  // the wooden cap on the wainscot
  out.push(dress(box([cx, dado + 0.02, r.z0 + 0.02], [w, 0.04, 0.04]), K.wood, T.wood));
  for (const x of [r.x0 + 0.02, r.x1 - 0.02]) out.push(dress(box([x, dado + 0.02, cz], [0.04, 0.04, d]), K.wood, T.wood));
}

/** The counter along the back: panelled wood, a steel top, a salsa bar under glass, the till, bottles, a cactus. */
function counter(out: BufferGeometry[], glass: BufferGeometry[]) {
  const c = COUNTER;
  const [cx, cz, w, d] = [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, c.x1 - c.x0, c.z1 - c.z0];
  out.push(dress(box([cx, 0.06, cz - 0.03], [w, 0.12, d - 0.06]), "#2e2a26", T.plain)); // kick
  out.push(dress(box([cx, 0.54, cz], [w, 0.84, d]), K.wood, T.wood));
  for (let i = 0; i < 4; i++) {
    const x = c.x0 + (w / 4) * (i + 0.5);
    out.push(dress(box([x, 0.53, c.z1 + 0.006], [w / 4 - 0.12, 0.6, 0.012]), K.panel, T.wood));
  }
  out.push(dress(box([cx, c.top - 0.015, cz + 0.02], [w + 0.08, 0.03, d + 0.08]), K.top, T.metal));
  // the salsa bar: a steel tray, five bowls, a sloped glass front and a glass lid on a steel frame
  const [s0, s1, sz0, sz1] = [-7.95, -6.95, 28.88, 29.24];
  const base = c.top;
  out.push(dress(box([(s0 + s1) / 2, base + 0.03, (sz0 + sz1) / 2], [s1 - s0, 0.06, sz1 - sz0]), K.top, T.metal));
  K.salsas.forEach((hex, i) => {
    const x = s0 + 0.11 + i * 0.195;
    out.push(dress(cyl([x, base + 0.09, 29.06], 0.075, 0.06, 0.06, 14), "#d8d4cc", T.glaze));
    out.push(dress(cyl([x, base + 0.117, 29.06], 0.068, 0.068, 0.008, 14), hex, T.glaze));
  });
  const [gy0, gy1, gz] = [base + 0.06, base + 0.34, sz1 - 0.12];
  for (const x of [s0, s1]) out.push(dress(box([x, (gy0 + gy1) / 2, (sz0 + sz1) / 2], [0.02, gy1 - gy0, sz1 - sz0]), K.top, T.metal));
  out.push(dress(box([(s0 + s1) / 2, gy1, (sz0 + gz) / 2], [s1 - s0, 0.015, gz - sz0]), K.top, T.metal));
  const slope = Math.atan2(sz1 - gz, gy1 - gy0);
  const front = new PlaneGeometry(s1 - s0 - 0.02, Math.hypot(sz1 - gz, gy1 - gy0));
  glass.push(placed(front, [(s0 + s1) / 2, (gy0 + gy1) / 2, (sz1 + gz) / 2], [-slope, 0, 0]));
  glass.push(sheet(s1 - s0 - 0.02, gz - sz0, [(s0 + s1) / 2, gy1 - 0.008, (sz0 + gz) / 2], "+y"));
  // the till, three squeeze bottles, a cactus in a pot
  out.push(dress(box([-6.35, base + 0.06, 29.0], [0.3, 0.12, 0.26]), K.iron, T.metal));
  out.push(dress(box([-6.35, base + 0.16, 28.95], [0.24, 0.12, 0.02], [-0.5, 0, 0]), "#1d2021", T.glaze));
  ["#9a3b2a", "#c8792f", "#6f7f3a"].forEach((hex, i) => {
    out.push(dress(cyl([-8.4 + i * 0.08, base + 0.08, 29.15], 0.028, 0.03, 0.16, 8), hex, T.glaze));
    out.push(dress(cyl([-8.4 + i * 0.08, base + 0.18, 29.15], 0.004, 0.018, 0.04, 6), "#efe6d2", T.glaze));
  });
  out.push(dress(cyl([-6.12, base + 0.05, 29.15], 0.06, 0.05, 0.1, 10), K.pot, T.plain));
  out.push(dress(cyl([-6.12, base + 0.2, 29.15], 0.035, 0.04, 0.22, 8), K.cactus, T.leaf));
  for (const s of [-1, 1]) {
    out.push(dress(rod([-6.12, base + 0.17, 29.15], [-6.12 + s * 0.07, base + 0.17, 29.15], 0.018, 6), K.cactus, T.leaf));
    out.push(dress(cyl([-6.12 + s * 0.07, base + 0.22 + (s > 0 ? 0.03 : 0), 29.15], 0.018, 0.018, 0.1 + (s > 0 ? 0.06 : 0), 6), K.cactus, T.leaf));
  }
}

/** The drinks cooler in the back corner: an enamel cabinet lit inside, bottles on four shelves, a glass door. */
function cooler(out: BufferGeometry[], glass: BufferGeometry[]) {
  const c = COOLER;
  const [cx, cz, w, d] = [(c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2, c.x1 - c.x0, c.z1 - c.z0];
  for (const x of [c.x0 + 0.02, c.x1 - 0.02]) out.push(dress(box([x, c.top / 2, cz], [0.04, c.top, d]), K.cooler, T.glaze));
  out.push(dress(box([cx, c.top - 0.12, cz], [w, 0.24, d]), K.cooler, T.glaze)); // header
  out.push(dress(box([cx, c.top - 0.12, c.z1 + 0.002], [w - 0.12, 0.1, 0.004]), "#c4704f", T.plain, 1.8)); // a lit strip
  out.push(dress(box([cx, 0.08, cz], [w, 0.16, d]), K.cooler, T.glaze)); // base
  out.push(dress(sheet(w - 0.08, c.top - 0.4, [cx, 0.16 + (c.top - 0.4) / 2, c.z0 + 0.03], "+z"), K.coolerBack, T.plain, 2.4));
  for (let s = 0; s < 4; s++) {
    const y = 0.22 + s * 0.38;
    out.push(dress(box([cx, y, cz], [w - 0.08, 0.012, d - 0.08]), "#cfd2d2", T.metal, 1.6));
    for (let i = 0; i < 5; i++) {
      const x = c.x0 + 0.09 + i * 0.093;
      const hex = K.bottles[(i + s * 2) % K.bottles.length];
      out.push(dress(cyl([x, y + 0.1, cz + 0.12], 0.034, 0.034, 0.19, 8), hex, T.glaze, 1.6));
      out.push(dress(cyl([x, y + 0.225, cz + 0.12], 0.012, 0.026, 0.06, 6), hex, T.glaze, 1.6));
    }
  }
  // the door: a steel frame, a long handle, the glass
  const [fy0, fy1] = [0.16, c.top - 0.24];
  for (const x of [c.x0 + 0.025, c.x1 - 0.025]) out.push(dress(box([x, (fy0 + fy1) / 2, c.z1 + 0.012], [0.05, fy1 - fy0, 0.025]), "#b9bcbd", T.metal));
  for (const y of [fy0 + 0.025, fy1 - 0.025]) out.push(dress(box([cx, y, c.z1 + 0.012], [w, 0.05, 0.025]), "#b9bcbd", T.metal));
  out.push(dress(box([c.x1 - 0.08, (fy0 + fy1) / 2, c.z1 + 0.04], [0.02, 0.7, 0.02]), "#b9bcbd", T.metal));
  glass.push(sheet(w - 0.1, fy1 - fy0 - 0.1, [cx, (fy0 + fy1) / 2, c.z1 + 0.01], "+z"));
  // a pothos on top, trailing down the side
  out.push(dress(cyl([c.x0 + 0.18, c.top + 0.06, cz], 0.08, 0.06, 0.12, 10), K.pot, T.plain));
  const rand = seeded(7);
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const p: V3 = [c.x0 + 0.1 + 0.4 * rand(), c.top + 0.14 - (t > 0.5 ? (t - 0.5) * 1.2 : 0), cz - 0.2 + 0.4 * rand()];
    if (t > 0.5) [p[0], p[2]] = [c.x1 + 0.03, cz + 0.25 * (rand() - 0.5)];
    out.push(dress(placed(new IcosahedronGeometry(0.045 + 0.02 * rand(), 0), p, [rand() * 3, rand() * 3, 0]).scale(1, 0.55, 1).translate(0, p[1] * 0.45, 0), i % 2 ? K.leaf : K.leaf2, T.leaf));
  }
}

/** Strings of papel picado across the ceiling: small paper flags in muted colours on a sagging string. */
function papel(out: BufferGeometry[]) {
  const r = ROOM;
  const rand = seeded(3);
  [29.9, 30.5, 31.1].forEach((z, k) => {
    const [a, b] = [r.x0 + 0.05, r.x1 - 0.05];
    const y = (x: number) => r.h - 0.08 - 0.14 * 4 * ((x - a) / (b - a)) * (1 - (x - a) / (b - a));
    const n = 16;
    for (let i = 0; i < n; i++) {
      const [x0, x1] = [a + ((b - a) * i) / n, a + ((b - a) * (i + 1)) / n];
      out.push(dress(rod([x0, y(x0), z], [x1, y(x1), z], 0.004, 3), "#d8d0c0", T.paper));
      const x = (x0 + x1) / 2;
      out.push(dress(box([x, y(x) - 0.09, z], [0.15, 0.17, 0.004], [0.15 * (rand() - 0.5), 0.3 * (rand() - 0.5), 0]), K.flags[(i + k * 2) % K.flags.length], T.flag));
    }
  });
}

/** Enamel pendant lamps over the tables: a cord, a cream cone shade, a bulb under it. */
function pendants(out: BufferGeometry[]) {
  for (const [x, y, z] of PENDANT_AT) {
    out.push(dress(rod([x, y + 0.08, z], [x, ROOM.h, z], 0.006, 4), K.iron, T.plain));
    out.push(dress(cyl([x, y + 0.08, z], 0.025, 0.03, 0.04, 8), K.iron, T.metal));
    out.push(dress(cyl([x, y, z], 0.03, 0.15, 0.13, 18), K.enamel, T.glaze));
    out.push(dress(placed(new SphereGeometry(0.04, 10, 6), [x, y - 0.075, z]), K.bulb, T.plain, 5));
  }
}

/** A snake plant by the window: a terracotta pot and tall flat blades. */
function snakePlant(out: BufferGeometry[]) {
  const [x, z] = POT;
  out.push(dress(cyl([x, 0.14, z], 0.15, 0.12, 0.28, 16), K.pot, T.plain));
  out.push(dress(cyl([x, 0.285, z], 0.15, 0.15, 0.012, 16), K.soil, T.plain));
  const rand = seeded(11);
  for (let i = 0; i < 9; i++) {
    const h = 0.45 + 0.3 * rand();
    const turn = (i / 9) * Math.PI * 2 + rand();
    const lean = 0.08 + 0.18 * rand();
    const blade = new ConeGeometry(0.04, h, 4).scale(1, 1, 0.3).translate(0, h / 2, 0);
    out.push(dress(placed(blade, [x + 0.06 * Math.cos(turn), 0.28, z + 0.06 * Math.sin(turn)], [Math.sin(turn) * lean, turn, -Math.cos(turn) * lean]), i % 2 ? K.leaf : K.leaf2, T.leaf));
  }
}

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** The taqueria's room and everything in it; `glass`: the shopfront's clear panes and the coolers' glass. */
function taqueria() {
  const out: BufferGeometry[] = [];
  const glass: BufferGeometry[] = [];
  walls(out);
  counter(out, glass);
  cooler(out, glass);
  // the menu: a dark wooden frame, the board lit from inside (the canvas texture)
  const m = MENU_BOARD;
  const [mx, my, mw, mh] = [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2, m.x1 - m.x0, m.y1 - m.y0];
  out.push(dress(box([mx, my, ROOM.z0 + 0.02], [mw + 0.08, mh + 0.08, 0.04]), K.wood, T.wood));
  out.push(dress(sheet(mw, mh, [mx, my, ROOM.z0 + 0.042], "+z"), "#ffffff", T.menu, 2));
  for (const t of TABLE_AT) {
    table(out, t);
    chair(out, t[0] - 0.42, t[1], Math.PI / 2);
    chair(out, t[0] + 0.42, t[1], -Math.PI / 2);
  }
  papel(out);
  pendants(out);
  snakePlant(out);
  // all of it stands on the room's floor
  for (const g of [...out, ...glass]) g.translate(0, ROOM.floor, 0);

  // the shopfront's glass, from the street side
  const { display, door, head } = OPENINGS;
  const pane = (a0: number, a1: number, b0: number, b1: number, c: number) => sheet(a1 - a0, b1 - b0, [X0 + (a0 + a1) / 2, (b0 + b1) / 2, Z1 + c], "+z");
  glass.push(pane(display[0], display[1], 0.56, head, -0.06));
  const [d0, d1] = [door[0] + 0.06, door[1] - 0.06];
  glass.push(pane(d0 + 0.08, d1 - 0.08, 0.5, 1.92, -0.29));
  glass.push(pane(door[0], door[1], 2.06, head, -0.29));
  return { interior: merged(out), glass: merged(glass) };
}

/** The menu board's face: dark, with the dishes and prices in two columns, lit from behind. */
function menuTexture() {
  const [w, h] = [1024, Math.round((1024 * (MENU_BOARD.y1 - MENU_BOARD.y0)) / (MENU_BOARD.x1 - MENU_BOARD.x0))];
  return drawn(w, h, (ctx) => {
    ctx.fillStyle = K.board;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#d6a347";
    ctx.lineWidth = 4;
    ctx.strokeRect(14, 14, w - 28, h - 28);
    const font = getComputedStyle(document.body).fontFamily || "sans-serif";
    ctx.fillStyle = "#d6a347";
    ctx.font = `600 34px ${font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("MENU", w / 2, 48);
    ctx.font = `500 32px ${font}`;
    const rows = Math.ceil(MENU.length / 2);
    MENU.forEach(([name, price], i) => {
      const col = Math.floor(i / rows);
      const y = 100 + (i % rows) * ((h - 130) / rows);
      const [x0, x1] = [60 + col * (w / 2), w / 2 - 50 + col * (w / 2)];
      ctx.fillStyle = "#f3e6c8";
      ctx.textAlign = "left";
      ctx.fillText(name, x0, y);
      ctx.textAlign = "right";
      ctx.fillText(price, x1, y);
    });
  });
}

/**
 * The taqueria's material. Vertex colour, `aGlow` (a warm emissive whose
 * intensity follows the hour) and `aMat` (TAQUERIA_MAT). The room's light is
 * baked: daylight through the shopfront fading to the back, darker corners,
 * soft contact shadows under the tables, chairs, counter, cooler and pot,
 * warm pools under the pendants (brighter at night).
 */
function taqueriaMaterial(menu: Texture) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, emissive: "#ffc98c", emissiveIntensity: 0 });
  const glsl = (list: number[][]) => list.map((v) => `vec${v.length}(${v.map((n) => n.toFixed(3)).join(", ")})`).join(", ");
  const chairs = TABLE_AT.flatMap(([x, z]) => [[x - 0.42, z], [x + 0.42, z]]);
  const r = ROOM;
  m.customProgramCacheKey = () => "taqueria";
  m.onBeforeCompile = (s) => {
    s.uniforms.uNight = facadeNight;
    s.uniforms.uMenu = { value: menu };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aGlow;\nattribute float aMat;\nvarying float vGlow;\nvarying float vMat;\nvarying vec3 vLocal;\nvarying vec3 vObjN;\nvarying vec2 vTUv;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGlow = aGlow;\nvMat = aMat;\nvLocal = position;\nvObjN = normal;\nvTUv = uv;");
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uNight;
        uniform sampler2D uMenu;
        varying float vGlow;
        varying float vMat;
        varying vec3 vLocal;
        varying vec3 vObjN;
        varying vec2 vTUv;
        float tRough = -1.0;
        float tMetal = 0.0;
        float tGloss = 0.0;
        float tPool = 0.0;
        const vec2 TABLES[${TABLE_AT.length}] = vec2[](${glsl(TABLE_AT)});
        const vec2 CHAIRS[${chairs.length}] = vec2[](${glsl(chairs)});
        const vec3 PENDANTS[${PENDANT_AT.length}] = vec3[](${glsl(PENDANT_AT)});
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), f.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + 1.0), f.x), f.y);
        }
        float tLine(float x, float size, float w) {
          float d = abs(fract(x / size + 0.5) - 0.5) * size;
          return 1.0 - smoothstep(w, w + fwidth(x) * 1.2, d);
        }
        float tBox(vec2 p, vec2 c, vec2 h, float soft) {
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
          vec3 p = vLocal - vec3(0.0, ${ROOM.floor.toFixed(3)}, 0.0);
          vec3 n = normalize(vObjN);
          float along = abs(n.z) > abs(n.x) ? p.x : p.z;
          if (mat == ${T.wood}) {
            vec2 q = abs(n.y) > 0.5 ? vec2(p.x * 2.0, p.z * 46.0) : vec2(along * 2.0, p.y * 46.0);
            diffuseColor.rgb *= 0.8 + 0.36 * (0.6 * tNoise(q) + 0.4 * tNoise(q * vec2(3.0, 0.35) + 7.0));
            tRough = 0.5;
            tGloss = 0.15;
          } else if (mat == ${T.floor}) {
            // saltillo tiles 0.3 square, each its own tone, sealed and a little glossy
            vec2 cell = floor(p.xz / 0.3);
            float grout = max(tLine(p.x, 0.3, 0.006), tLine(p.z, 0.3, 0.006));
            diffuseColor.rgb *= (0.8 + 0.3 * tHash(cell)) * (0.9 + 0.18 * tNoise(p.xz * 9.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.58, 0.52) * 0.8, grout);
            tRough = mix(0.35, 0.9, grout);
            tGloss = 0.35 * (1.0 - grout);
          } else if (mat == ${T.tile}) {
            // glazed square tiles 0.12, a little uneven in tone
            float grout = max(tLine(p.y, 0.12, 0.003), tLine(along, 0.12, 0.003));
            diffuseColor.rgb *= 0.9 + 0.16 * tHash(floor(vec2(along, p.y) / 0.12));
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.82, 0.74), grout);
            tRough = mix(0.12, 0.8, grout);
            tGloss = 0.7 * (1.0 - grout);
          } else if (mat == ${T.plaster}) {
            vec2 q = abs(n.y) > 0.5 ? p.xz : vec2(along, p.y);
            diffuseColor.rgb *= 0.95 + 0.06 * tNoise(q * 3.0) + 0.03 * tNoise(q * 13.0);
            tRough = 0.92;
          } else if (mat == ${T.metal}) {
            tRough = 0.28;
            tMetal = 0.6;
            tGloss = 0.5;
          } else if (mat == ${T.glaze}) {
            tRough = 0.18;
            tGloss = 0.9;
          } else if (mat == ${T.menu}) {
            diffuseColor.rgb = texture2D(uMenu, vTUv).rgb;
            tRough = 0.6;
          } else if (mat == ${T.leaf}) {
            diffuseColor.rgb *= 0.85 + 0.25 * tNoise(p.xy * 40.0);
            tRough = 0.45;
            tGloss = 0.3;
          } else if (mat == ${T.paper}) {
            tRough = 0.95;
          } else if (mat == ${T.flag}) {
            // papel picado: a zigzag fringe, a cut flower in the middle, small diamonds round it
            vec2 u = vTUv;
            float fringe = 0.1 - 0.08 * abs(fract(u.x * 7.0) - 0.5) * 2.0;
            vec2 c = (u - vec2(0.5, 0.56)) * vec2(1.0, 1.15);
            float a = atan(c.y, c.x);
            float petal = 0.17 + 0.07 * cos(a * 5.0);
            float flower = step(length(c), petal) * step(0.06, length(c));
            vec2 g = fract(u * vec2(4.0, 5.0)) - 0.5;
            float diamond = step(abs(g.x) + abs(g.y), 0.16) * step(0.3, abs(u.x - 0.5) + abs(u.y - 0.56) * 0.9);
            if (u.y < fringe || flower > 0.5 || (diamond > 0.5 && u.y > 0.2 && u.y < 0.92)) discard;
            tRough = 0.95;
          }

          if (vGlow > 0.5 && vGlow < 1.5) {
            // daylight in through the shopfront: bright by the glass, dim at the back
            float depth = clamp((${r.z1.toFixed(3)} - p.z) / ${(r.z1 - r.z0).toFixed(3)}, 0.0, 1.0);
            float day = mix(1.3, 0.45, smoothstep(0.0, 1.0, depth)) * (0.88 + 0.24 * clamp(n.z, 0.0, 1.0));
            float ao = 1.0;
            ao *= mix(1.0, smoothstep(-0.05, 0.5, p.y), 0.5 * (1.0 - abs(n.y)));
            ao *= mix(1.0, smoothstep(-0.05, 0.8, ${r.h.toFixed(2)} - p.y), 0.45 * (1.0 - abs(n.y)));
            ao *= mix(1.0, smoothstep(-0.05, 0.9, p.z - ${r.z0.toFixed(2)}), 0.5 * (1.0 - abs(n.z)));
            ao *= mix(1.0, smoothstep(-0.05, 0.8, min(p.x - (${r.x0.toFixed(2)}), ${r.x1.toFixed(2)} - p.x)), 0.5 * (1.0 - abs(n.x)));
            // contact shadows on the floor
            if (n.y > 0.5 && p.y < 0.06) {
              for (int i = 0; i < ${TABLE_AT.length}; i++) ao *= 1.0 - 0.45 * (1.0 - smoothstep(0.05, 0.4, length(p.xz - TABLES[i])));
              for (int i = 0; i < ${chairs.length}; i++) ao *= 1.0 - 0.3 * (1.0 - smoothstep(0.05, 0.3, length(p.xz - CHAIRS[i])));
              ao *= 1.0 - 0.55 * tBox(p.xz, vec2(${((COUNTER.x0 + COUNTER.x1) / 2).toFixed(2)}, ${((COUNTER.z0 + COUNTER.z1) / 2).toFixed(2)}), vec2(${((COUNTER.x1 - COUNTER.x0) / 2).toFixed(2)}, ${((COUNTER.z1 - COUNTER.z0) / 2).toFixed(2)}), 0.3);
              ao *= 1.0 - 0.5 * tBox(p.xz, vec2(${((COOLER.x0 + COOLER.x1) / 2).toFixed(2)}, ${((COOLER.z0 + COOLER.z1) / 2).toFixed(2)}), vec2(${((COOLER.x1 - COOLER.x0) / 2).toFixed(2)}, ${((COOLER.z1 - COOLER.z0) / 2).toFixed(2)}), 0.25);
              ao *= 1.0 - 0.45 * (1.0 - smoothstep(0.1, 0.32, length(p.xz - vec2(${POT[0].toFixed(2)}, ${POT[1].toFixed(2)}))));
            }
            for (int i = 0; i < ${PENDANT_AT.length}; i++) {
              vec3 d = p - PENDANTS[i];
              float below = max(-d.y, 0.0);
              float spread = 0.08 + 0.2 * below;
              tPool += exp(-dot(d.xz, d.xz) / spread) * (d.y < 0.0 ? 0.45 + 0.55 * max(n.y, 0.0) : 0.2) / (1.0 + below * 0.6);
            }
            vec3 tone = mix(vec3(0.98, 0.99, 1.0), vec3(1.05, 0.96, 0.84), depth);
            diffuseColor.rgb *= mix(day * tone, vec3(0.8), uNight) * ao;
          }
        }`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nif (tRough >= 0.0) roughnessFactor = tRough;")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = max(metalnessFactor, tMetal);")
      .replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `totalEmissiveRadiance *= diffuseColor.rgb * vGlow;
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.78, 0.5) * tPool * (0.8 + 0.7 * uNight);
        totalEmissiveRadiance += vec3(1.0, 0.95, 0.86) * tGloss * pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 4.0) * 0.18;`,
      );
  };
  return m;
}

/** Everything but the posts and the sign (the taqueria and its glass included), as geometry in world x, z and y from the ground. */
export function missionParts() {
  const { ladder: l, bucket: b } = MISSION;
  const { iron, bulbs } = lamps();
  const props = merged([
    ...ladder(l.h).map((g) => placed(g, [l.x, 0, l.z], [0, 0, l.lean])),
    ...pail(b.r, b.h).map((g) => placed(g, [b.x, heightAt(b.x, b.z) - MISSION.ground, b.z])),
    ...iron,
  ]);
  return { shell: shellGeometry(), props, bulbs: merged(bulbs), ...taqueria() };
}

/** The night wash from the two lamps: soft warm cones down the wall, brightest under the lamps. */
function washTexture() {
  return drawn(256, 256, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 256, 256);
    ctx.globalCompositeOperation = "lighter";
    for (const u of [0.25, 0.75]) {
      ctx.save();
      ctx.translate(u * 256, 0);
      ctx.scale(1, 2.2);
      const g = ctx.createRadialGradient(0, 4, 4, 0, 4, 120);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.45, "rgba(255,255,255,0.45)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(-128, 0, 256, 128);
      ctx.restore();
    }
  });
}
const WASH = { y0: 0.3, y1: LAMP_Y - 0.15 };

/** 09:00 Mission building and its wall of posts. A new post appears when you approve. */
export function MuralWall() {
  const interior = useInterior();
  const approved = useCity((s) => s.approved);
  const { posts, siding } = useLandmarkTextures();
  const fresh = useRef<Group>(null);
  // the posts glow a little at night, as if the lamps light them
  const photo = useMemo(() => new MeshStandardMaterial({ map: posts, roughness: 0.6, emissive: "#ffe6c4", emissiveMap: posts, emissiveIntensity: 0 }), [posts]);
  useNightGlow(photo, 0.35, 0);
  const paper = useMat("#fbf8f2", 0.8);
  const m = useMemo(() => ({ house: houseMaterial(siding, siding, palette()), props: new MeshStandardMaterial({ vertexColors: true, roughness: 0.65 }) }), [siding]);
  const bulb = useGlow("#ffd9a0", 5, 0.2);
  const sign = useSign("TAQUERIA", { bg: "#f3ece0", fg: "#6b4230", panel: MISSION.sign.size, tracking: 0.3 });
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.7, emissive: "#fff1d8", emissiveMap: sign, emissiveIntensity: 0 }), [sign]);
  useNightGlow(signMat, 0.5, 0);
  // the taqueria: lit a little by day, warm at night; clear shop glass (shop.tsx)
  const inside = useMemo(() => taqueriaMaterial(menuTexture()), []);
  useNightGlow(inside, 1.1, 0.3);
  const shopGlass = useMemo(() => glassMaterial(), []);
  const wash = useMemo(() => new MeshBasicMaterial({ map: washTexture(), color: "#000", transparent: true, depthWrite: false, blending: AdditiveBlending }), []);
  const parts = useMemo(() => {
    // Posts face east (+x) towards the street, on the side wall at x -5.4.
    const card = (y: number, z: number) => box([-5.39, y, z], [0.022, 1.18, 1.18]);
    const pic = ({ row, col }: { row: number; col: number }) => postUv(new PlaneGeometry(1.1, 1.1), row, col);
    const on = (g: BufferGeometry, y: number, z: number, x = -5.374) => placed(g, [x, y, z], [0, Math.PI / 2, 0]);
    const freshPost = POSTS.find((p) => p.fresh)!;
    return {
      ...missionParts(),
      cards: merged(POSTS.filter((p) => !p.fresh).map((p) => card(p.y, p.z))),
      photos: merged(POSTS.filter((p) => !p.fresh).map((p) => on(pic(p), p.y, p.z))),
      freshCard: box([-0.015, 0, 0], [0.022, 1.18, 1.18]),
      freshPhoto: placed(pic(freshPost), [0.001, 0, 0], [0, Math.PI / 2, 0]),
      freshAt: [-5.375, freshPost.y, freshPost.z] as V3,
    };
  }, []);

  useFrame((_, dt) => {
    wash.color.setRGB(1, 0.78, 0.5).multiplyScalar(0.32 * rig.night);
    const g = fresh.current;
    if (!g) return;
    const s = g.scale.x + ((approved ? 1 : 0.001) - g.scale.x) * Math.min(1, dt * 6);
    g.scale.setScalar(s);
  });

  const { a: sa, y: sy } = MISSION.sign;
  return (
    <group position-y={MISSION.ground}>
      <mesh geometry={parts.shell} material={m.house} castShadow receiveShadow />
      <mesh geometry={parts.props} material={m.props} castShadow receiveShadow />
      <mesh geometry={parts.bulbs} material={bulb} />
      <mesh ref={interior} geometry={parts.interior} material={inside} receiveShadow />
      <mesh geometry={parts.glass} material={shopGlass} />
      <mesh position={[X0 + sa, sy, Z1 + 0.065]} material={signMat}>
        <planeGeometry args={MISSION.sign.size} />
      </mesh>
      <mesh position={[X1 + 0.03, (WASH.y0 + WASH.y1) / 2, (Z0 + Z1) / 2]} rotation-y={Math.PI / 2} material={wash} renderOrder={1}>
        <planeGeometry args={[D - 0.1, WASH.y1 - WASH.y0]} />
      </mesh>
      <mesh geometry={parts.cards} material={paper} castShadow receiveShadow />
      <mesh geometry={parts.photos} material={photo} receiveShadow />
      <group ref={fresh} position={parts.freshAt} scale={0.001}>
        <mesh geometry={parts.freshCard} material={paper} castShadow receiveShadow />
        <mesh geometry={parts.freshPhoto} material={photo} />
      </group>
    </group>
  );
}
