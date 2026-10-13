"use client";

// 06:00 Russian Hill rooftop: the Edwardian apartment Cuso stands on, modelled
// with the row houses' kit (house-models.ts) and painted by their material:
// a rusticated stone base with the front door, bays stacked up every wall
// with recessed sash windows, belt courses, a bracketed cornice, and on the
// roof a gravel deck, a parapet with coping stones and the stair bulkhead.
// One mesh, one draw call.

import { useMemo } from "react";
import { Float32BufferAttribute } from "three";
import { heightAt } from "@/lib/terrain";
import { PALETTES, SLOT, builder, moulding, palette, sides, type Box2, type Builder, type Frame, type P2, type Rect, type Span } from "./house-models";
import { useLandmarkTextures } from "./landmark-kit";
import { houseMaterial } from "./materials";

/**
 * The 06:00 building, y from the ground at its centre: walls, roof height,
 * parapet (thickness, top above the roof incl. coping), cornice ring and the
 * stair bulkhead. Cuso stands on its north edge at x -14, z -12.9 and jumps up
 * from the south, so the middle stays clear. The collision test reads it.
 */
export const ROOFTOP = {
  x0: -17.5, x1: -10.5, z0: -13.6, z1: -7.4, roof: 8, base: -0.6,
  wall: 0.16, parapet: 0.355,
  cornice: { out: 0.24, bottom: 7.55, top: 7.97 },
  bulkhead: { x: -16.25, z: -8.6, w: 1.62, d: 1.42, top: 9.175 },
};

const COURSE = 1.75 / 4;

/** The facade, in world units along each wall (a, from its left end) and up from the ground (y 0). */
export const APARTMENT = {
  /** Paint scheme (PALETTES): cream stucco, white trim, warm brown sashes and doors. */
  palette: PALETTES.findIndex((p) => p.name === "cream"),
  /** The rusticated base: stone courses from the footing up to the belt course. */
  course: COURSE,
  foot: -3 * COURSE,
  belt: [1.75, 1.9] as Span,
  /** Floor lines of the four storeys above the base; the top one ends under the frieze. */
  floors: [1.9, 3.25, 4.6, 5.95],
  frieze: 7.3,
  /** Windows above their floor line: sill and head. */
  window: [0.28, 1.08] as Span,
  /** Two bays per wall, from each end: where their sides meet the wall, their front, how deep (inside the cornice line). */
  bay: { wall: [0.3, 2.1] as Span, front: [0.65, 1.75] as Span, depth: 0.2 },
  /** The vent stack on the roof (x, z), by the south parapet. */
  vent: [-15.2, -7.85] as P2,
};

const RUST = 0.04; // how far the base courses stand out
const BASE = SLOT.panel; // the base's stone: the scheme's deeper cream
const WORLD: Frame = { o: [0, 0, 0], u: [1, 0, 0] };

/** A point in a wall's frame (a along it, c out of it), in the world. */
const at = ({ o, u }: Frame, a: number, c: number): P2 => [o[0] + u[0] * a - u[2] * c, o[2] + u[2] * a + u[0] * c];

/** Runs from a0 to a1 with the openings' spans left out. */
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

/** A bay from the belt course to the frieze: three faces with a room (one window id) per storey, posts, bands, corbels. */
function bay(k: Builder, f: Frame, wall: Span, front: Span, room: number) {
  const A = APARTMENT;
  const D = A.bay.depth;
  const [bot, top] = [A.belt[1], A.frieze];
  const plan: P2[] = [[wall[0], 0], [front[0], D], [front[1], D], [wall[1], 0]];
  for (let i = 0; i < 3; i++) {
    const [p, q] = [plan[i], plan[i + 1]];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [ox, oz] = at(f, p[0], p[1]);
    const [ex, ez] = at(f, q[0], q[1]);
    const face: Frame = { o: [ox, 0, oz], u: [(ex - ox) / len, 0, (ez - oz) / len] };
    const m = i === 1 ? 0.1 : 0.07;
    const holes: Rect[] = A.floors.map((y) => [m, len - m, y + A.window[0], y + A.window[1]]);
    k.wall(face, 0, len, bot, top, holes, SLOT.stucco);
    holes.forEach((r, j) => {
      k.window(face, r, room + j);
      // the front window: a white casing, a raised panel under it
      if (i !== 1) return;
      k.ring2(face, r, 0.035, 0.012, SLOT.trim);
      k.box(face, m + 0.02, len - m - 0.02, A.floors[j] + 0.1, r[2] - 0.06, 0, 0.02, SLOT.panel);
    });
  }
  for (const [a, c] of plan) k.box(f, a - 0.04, a + 0.04, bot, top, Math.max(0, c - 0.03), c + 0.035, SLOT.trim);
  // floor bands round the bay (out to the cornice line), its top, and corbels under it
  const g = 0.04;
  const grown: P2[] = [[wall[0] - g, 0], [front[0] - g * 0.4, D + g], [front[1] + g * 0.4, D + g], [wall[1] + g, 0]];
  for (const y of A.floors) k.prism(f, grown, y, y + 0.07, SLOT.trim);
  k.prism(f, grown, top - 0.1, top, SLOT.trim);
  for (const a of front) k.profile(f, a - 0.05, a + 0.05, [[0, bot - 0.45], [0.06, bot - 0.45], [D, bot], [0, bot]], SLOT.trim);
  return room + A.floors.length;
}

/** The front door: a recessed porch with a panelled door and transom, pilasters, a hood, steps down to the street. */
function entry(k: Builder, f: Frame, [a0, a1]: Span, top: number, ground: number, id: number) {
  const back = -0.3;
  k.reveal(f, [a0, a1, 0, top], 0, back, BASE);
  k.quad(f, a0, a1, 0, top, back, BASE);
  const mid = (a0 + a1) / 2;
  const [d0, d1] = [mid - 0.3, mid + 0.3];
  k.box(f, d0, d1, 0, 1.0, back, back + 0.03, SLOT.door);
  for (const [p0, p1] of [[0.08, 0.42], [0.5, 0.92]]) k.box(f, d0 + 0.07, d1 - 0.07, p0, p1, back + 0.03, back + 0.045, SLOT.door);
  k.glazing(f, [d0, d1, 1.04, top - 0.04], back + 0.005, ++id, false);
  // pilasters with capitals, and a hood over them
  for (const [p0, p1] of [[a0 - 0.14, a0], [a1, a1 + 0.14]]) {
    k.box(f, p0, p1, APARTMENT.foot, top, 0, RUST + 0.04, SLOT.trim);
    k.box(f, p0 - 0.02, p1 + 0.02, top - 0.1, top, 0, RUST + 0.07, SLOT.trim);
  }
  k.box(f, a0 - 0.16, a1 + 0.16, top, top + 0.12, 0, 0.12, SLOT.frieze);
  k.box(f, a0 - 0.2, a1 + 0.2, top + 0.12, top + 0.19, 0, 0.2, SLOT.trim);
  // steps from the sidewalk up into the porch, the last one its floor
  const n = Math.max(1, Math.round(-ground / 0.18));
  const [out, inner] = [0.22, -0.08];
  const tread = (out - inner) / n;
  for (let i = 1; i <= n; i++) {
    const c1 = out - (i - 1) * tread;
    k.box(f, a0, a1, APARTMENT.foot, ground * (1 - i / n), i === n ? back : c1 - tread, c1, SLOT.stone);
  }
  return id;
}

/** The roof: gravel deck, parapet (tar flashing at its foot, coping stones on top), stair bulkhead, vent. */
function roof(k: Builder, r: Box2, id: number) {
  const { roof: y, wall: t, parapet, bulkhead: b } = ROOFTOP;
  const cap = y + parapet;
  const top = cap - 0.055;
  k.face(WORLD, [[r.x0 + t, y, r.z0 + t], [r.x1 - t, y, r.z0 + t], [r.x1 - t, y, r.z1 - t], [r.x0 + t, y, r.z1 - t]], [0, 1, 0], SLOT.gravel);
  moulding(k, r, [[0, top], [-t, top]], SLOT.tar);
  moulding(k, r, [[-t, top], [-t, y + 0.08]], SLOT.stucco);
  moulding(k, r, [[-t, y + 0.08], [-t, y]], SLOT.tar);
  // coping stones, about 0.6 long with thin joints, overhanging a little each side
  for (const { f, len, wraps } of sides(r)) {
    const [a0, a1] = wraps ? [-0.05, len + 0.05] : [t + 0.01, len - t - 0.01];
    const n = Math.round((a1 - a0) / 0.6);
    for (let i = 0; i < n; i++) {
      const s0 = a0 + ((a1 - a0) * i) / n;
      const s1 = a0 + ((a1 - a0) * (i + 1)) / n - (i < n - 1 ? 0.012 : 0);
      k.box(f, s0, s1, top, cap, -t - 0.01, 0.05, SLOT.stone);
    }
  }

  // The stair bulkhead: stucco on a tar flashing, a stone cap, a door with a glass lite on the east.
  const body: Box2 = { x0: b.x - b.w / 2 + 0.06, x1: b.x + b.w / 2 - 0.06, z0: b.z - b.d / 2 + 0.06, z1: b.z + b.d / 2 - 0.06 };
  const lid = b.top - 0.07;
  for (const { f, len, name } of sides(body)) {
    const door: Rect = [len / 2 - 0.3, len / 2 + 0.3, y, y + 0.9];
    const holes = name === "east" ? [door] : [];
    k.wall(f, 0, len, y, y + 0.08, holes, SLOT.tar);
    k.wall(f, 0, len, y + 0.08, lid, holes, SLOT.stucco);
    if (name !== "east") continue;
    const [a0, a1, , d1] = door;
    k.reveal(f, door, 0.03, -0.04, SLOT.trim);
    for (const [q0, q1, r0, r1] of [[a0 - 0.05, a0, y, d1 + 0.05], [a1, a1 + 0.05, y, d1 + 0.05], [a0, a1, d1, d1 + 0.05]]) k.quad(f, q0, q1, r0, r1, 0.03, SLOT.trim);
    k.box(f, a0, a1, y, d1, -0.04, -0.015, SLOT.door);
    k.box(f, a0 + 0.07, a1 - 0.07, y + 0.08, y + 0.45, -0.015, -0.003, SLOT.door);
    k.glazing(f, [a0 + 0.1, a1 - 0.1, y + 0.55, y + 0.8], -0.012, ++id, false);
    k.box(f, a0 - 0.05, a1 + 0.05, y, y + 0.03, -0.04, 0.06, SLOT.stone);
  }
  k.box(WORLD, b.x - b.w / 2, b.x + b.w / 2, lid, b.top, b.z - b.d / 2, b.z + b.d / 2, SLOT.stone);
  // the vent stack: an octagonal pipe and its cap
  const oct = (rad: number): P2[] => Array.from({ length: 8 }, (_, i) => [APARTMENT.vent[0] + rad * Math.cos((i * Math.PI) / 4), APARTMENT.vent[1] + rad * Math.sin((i * Math.PI) / 4)]);
  k.prism(WORLD, oct(0.05), y, y + 0.44, SLOT.tar);
  k.prism(WORLD, oct(0.08), y + 0.44, y + 0.5, SLOT.tar);
  return id;
}

/** The whole building in world x, z and y from the ground at its centre, in the house material's attributes. */
export function apartmentGeometry() {
  const A = APARTMENT;
  const R = ROOFTOP;
  const r: Box2 = { x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1 };
  const k = builder();
  const g0 = heightAt(-14, -10.4);
  let id = 0;

  for (const { f, len, wraps, name } of sides(r)) {
    const mid = len / 2;
    const [b0, b1] = A.bay.wall;
    const [f0, f1] = A.bay.front;
    const bays: [Span, Span][] = [[[b0, b1], [f0, f1]], [[len - b1, len - b0], [len - f1, len - f0]]];

    // The base: rusticated courses round the ground-floor windows (and the door on the street).
    const sill = COURSE;
    const head = 3 * COURSE;
    const ground: Rect[] = [0.75, 1.65, len - 1.65, len - 0.75].map((a) => [a - 0.25, a + 0.25, sill, head]);
    const door: Span | null = name === "south" ? [mid - 0.45, mid + 0.45] : null;
    if (!door) ground.push([mid - 0.3, mid + 0.3, sill, head]);
    const openings: Rect[] = door ? [...ground, [door[0], door[1], A.foot, head]] : ground;
    k.wall(f, 0, len, A.foot, A.belt[0], openings, BASE);
    // courses from just under the lowest ground along this wall (below it, the plain footing)
    const e = wraps ? RUST : 0;
    let low = Infinity;
    for (let a = 0; a <= len; a += 0.5) low = Math.min(low, heightAt(...at(f, a, 0.3)) - g0);
    for (let y = Math.max(A.foot, Math.floor(low / COURSE) * COURSE); y < A.belt[0] - 1e-6; y += COURSE) {
      const y1 = Math.min(A.belt[0], y + COURSE);
      const gaps = openings.filter((o) => o[2] < y1 - 1e-6 && o[3] > y + 1e-6).map((o) => [o[0], o[1]] as Span);
      for (const [s0, s1] of runs(-e, len + e, gaps)) {
        k.profile(f, s0, s1, [[0, y + 0.01], [RUST - 0.02, y + 0.01], [RUST, y + 0.03], [RUST, y1 - 0.02], [RUST - 0.02, y1], [0, y1]], BASE);
      }
    }
    for (const w of ground) {
      k.window(f, w, ++id);
      const c = (w[0] + w[1]) / 2;
      k.box(f, w[0] - 0.05, w[1] + 0.05, sill - 0.05, sill, 0, RUST + 0.05, BASE);
      k.box(f, c - 0.08, c + 0.08, head - 0.03, head + 0.2, 0, RUST + 0.025, BASE); // keystone
    }
    if (door) {
      const [x, z] = at(f, mid, 0.3);
      id = entry(k, f, door, head, heightAt(x, z) - g0, id);
    }

    // Above: stucco up to the parapet, the middle column of windows with casings and hoods, the bays.
    const middle: Rect[] = A.floors.map((y) => [mid - 0.33, mid + 0.33, y + A.window[0], y + A.window[1]]);
    k.wall(f, 0, len, A.belt[0], R.roof + R.parapet - 0.055, middle, SLOT.stucco);
    for (const w of middle) k.window(f, w, ++id, { hood: "cap" });
    for (const [wall, front] of bays) id = bay(k, f, wall, front, id + 1) - 1;

    // Modillions under the cornice's crown.
    const n = Math.round((len - 0.3) / 0.44);
    for (let i = 0; i <= n; i++) {
      const a = 0.15 + ((len - 0.3) * i) / n;
      k.profile(f, a - 0.035, a + 0.035, [[0, 7.6], [0.06, 7.6], [0.19, 7.79], [0, 7.79]], SLOT.trim);
    }
  }

  // Belt courses, frieze and cornice, all round.
  moulding(k, r, [[0, 1.75], [0.08, 1.75], [0.1, 1.77], [0.1, 1.86], [0.07, 1.9], [0, 1.9]], SLOT.trim);
  for (const y of A.floors.slice(1)) moulding(k, r, [[0, y - 0.035], [0.045, y - 0.035], [0.045, y + 0.035], [0, y + 0.035]], SLOT.trim);
  const c = R.cornice;
  moulding(k, r, [[0, A.frieze], [0.05, A.frieze], [0.05, c.bottom], [0, c.bottom]], SLOT.frieze);
  moulding(k, r, [[0, c.bottom], [0.08, c.bottom], [0.1, 7.6], [0, 7.6]], SLOT.trim);
  moulding(k, r, [[0, 7.79], [0.2, 7.79], [0.2, 7.83], [c.out, 7.87], [c.out, c.top], [0, c.top]], SLOT.trim);

  roof(k, r, id);
  const geometry = k.geometry();
  geometry.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(A.palette), 1));
  return geometry;
}

/** 06:00 Russian Hill rooftop. Cuso stands on its north edge, over the bay. */
export function Rooftop() {
  // The apartment paints no lap siding or shingles: the siding texture fills both slots.
  const { siding } = useLandmarkTextures();
  const material = useMemo(() => houseMaterial(siding, siding, palette()), [siding]);
  const geometry = useMemo(() => apartmentGeometry(), []);
  return (
    <group position-y={heightAt(-14, -10.4)}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
    </group>
  );
}
