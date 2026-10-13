// Coit Tower in Pioneer Park (coit-tower.tsx): the fluted shaft, the open
// observation arcade and the crown on a rounded Art Deco base, seated on its
// summit plaza. Everything stays on the plaza, inside the tower's camera
// obstacle (layout.ts) above the parapet, and costs two draw calls.

import { Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { BENCHES, COIT, KIND, LAMPS, WALKS, coitParts, coitSeat } from "@/scene/coit-tower";
import { CLEAR, OBSTACLES, PARKS } from "@/scene/layout";
import { TRAILS } from "@/scene/lawn";

const EPS = 1e-6;

/** Points on a fine grid inside radius r around the tower. */
function disc(r: number) {
  const out: [number, number][] = [];
  for (let dx = -r; dx <= r; dx += 0.05) for (let dz = -r; dz <= r; dz += 0.05) if (Math.hypot(dx, dz) <= r) out.push([COIT.x + dx, COIT.z + dz]);
  return out;
}
const points = (g: BufferGeometry) => Array.from({ length: g.attributes.position.count }, (_, i) => new Vector3().fromBufferAttribute(g.attributes.position, i));
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
/** Shortest distance from (x, z) to a polyline. */
function toLine(x: number, z: number, line: [number, number][]) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
    best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
  }
  return best;
}

describe("Coit Tower on Telegraph Hill", () => {
  const seat = coitSeat();

  it("has a level plaza that the hill never pokes through", () => {
    for (const [x, z] of disc(COIT.plaza)) expect(heightAt(x, z)).toBeLessThanOrEqual(seat.top);
  });

  it("sits on the summit, not floating above it", () => {
    expect(seat.top - heightAt(COIT.x, COIT.z)).toBeLessThan(0.1);
  });

  it("hides the plaza wall's foot in the hill all the way round, so it never floats", () => {
    for (const [x, z] of disc(COIT.plaza + COIT.batter)) expect(heightAt(x, z) - seat.bottom).toBeGreaterThan(0.3);
  });

  it("keeps the lobby inside the plaza wall", () => {
    expect((COIT.lobby.w / 2) * Math.SQRT2).toBeLessThan(COIT.plaza - COIT.parapet.t);
  });

  it("stands in Pioneer Park, inside its clear lawn, with the ring trail outside the plaza", () => {
    const [x0, x1, z0, z1] = PARKS.find(([a, b, c, d]) => COIT.x > a && COIT.x < b && COIT.z > c && COIT.z < d)!;
    expect(COIT.x - COIT.plaza).toBeGreaterThan(x0);
    expect(COIT.x + COIT.plaza).toBeLessThan(x1);
    expect(COIT.z - COIT.plaza).toBeGreaterThan(z0);
    expect(COIT.z + COIT.plaza).toBeLessThan(z1);
    const clear = CLEAR.find(([x, z]) => x === COIT.x && z === COIT.z);
    expect(clear?.[2]).toBeGreaterThan(COIT.plaza + 0.5);
    for (const { points: pts, width } of TRAILS) for (const [x, z] of pts) expect(Math.hypot(x - COIT.x, z - COIT.z) - width / 2).toBeGreaterThan(COIT.plaza + COIT.batter + 0.05);
  });
});

describe("the Coit Tower model", () => {
  const { solid, glass } = coitParts();
  const all = points(solid);
  const wallH = coitSeat().top - coitSeat().bottom;

  it("is two finite meshes (solid parts and glass) in a modest triangle budget", () => {
    for (const g of [solid, glass]) for (const v of [...g.attributes.position.array, ...g.attributes.normal.array]) expect(Number.isFinite(v)).toBe(true);
    const kinds = new Set<number>(Object.values(KIND));
    for (const k of solid.attributes.aKind.array) expect(kinds.has(k)).toBe(true);
    for (const k of Object.values(KIND)) expect(solid.attributes.aKind.array.includes(k), `kind ${k}`).toBe(true);
    expect(solid.attributes.color.count).toBe(solid.attributes.position.count);
    expect(tris(solid)).toBeLessThan(14000);
    expect(tris(glass)).toBeGreaterThan(0);
    expect(tris(glass)).toBeLessThan(200);
  });

  it("keeps its height, and above the parapet its footprint inside the camera obstacle", () => {
    const top = Math.max(...all.map((p) => p.y));
    expect(top).toBeCloseTo(COIT.top, 6);
    const box = OBSTACLES.find((b) => b.minX < COIT.x && b.maxX > COIT.x && b.minZ < COIT.z && b.maxZ > COIT.z)!;
    expect(box.top).toBeGreaterThan(coitSeat().top + COIT.top);
    for (const p of [...all, ...points(glass)]) {
      if (p.y <= COIT.lobby.h - 0.1) continue; // lamps and benches stand lower
      expect(COIT.x + p.x).toBeGreaterThanOrEqual(box.minX - EPS);
      expect(COIT.x + p.x).toBeLessThanOrEqual(box.maxX + EPS);
      expect(COIT.z + p.z).toBeGreaterThanOrEqual(box.minZ - EPS);
      expect(COIT.z + p.z).toBeLessThanOrEqual(box.maxZ + EPS);
    }
  });

  it("stays on the plaza: inside its wall, down to the wall's foot in the hill", () => {
    for (const p of all) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(COIT.plaza + COIT.batter + EPS);
      expect(p.y).toBeGreaterThanOrEqual(-wallH - EPS);
    }
  });

  it("opens the base on the west, with the painted walls behind the door and every window", () => {
    const mural = all.filter((_, i) => solid.attributes.aKind.getX(i) === KIND.mural);
    const half = COIT.lobby.w / 2;
    // every side has windows into the murals; the vestibule behind the west door is the deepest
    expect(mural.some((p) => p.z > half - 0.2)).toBe(true);
    expect(mural.some((p) => p.z < -half + 0.2)).toBe(true);
    expect(mural.some((p) => p.x > half - 0.2)).toBe(true);
    expect(Math.min(...mural.map((p) => p.x))).toBeGreaterThan(-half);
    expect(Math.min(...mural.filter((p) => p.x < 0 && Math.abs(p.z) < 0.15).map((p) => -p.x))).toBeLessThan(half - 0.25);
    // the observation deck and its lit interior (core, floor and ceiling)
    const room = all.filter((_, i) => solid.attributes.aKind.getX(i) === KIND.room);
    expect(room.some((p) => p.y > COIT.deck.bottom && p.y < COIT.deck.top)).toBe(true);
  });
});

describe("the plaza: lamps and benches", () => {
  const inner = COIT.plaza - COIT.parapet.t;
  /** Clear of the base building and its podium (a square of half `half` with rounded corners). */
  const offBuilding = (x: number, z: number, r: number) => Math.max(Math.abs(x), Math.abs(z)) > COIT.lobby.w / 2 + COIT.lobby.podium + r;
  const things = [
    ...LAMPS.map(([x, z]) => ({ what: "lamp", x, z, r: 0.03 })),
    ...BENCHES.map(([x, z]) => ({ what: "bench", x, z, r: 0.12 })),
  ];

  it("keeps every piece on the paving, clear of the building, the parapet and each other", () => {
    for (const t of things) {
      expect(Math.hypot(t.x, t.z) + t.r, `${t.what} at ${t.x},${t.z}`).toBeLessThan(inner - 0.02);
      expect(offBuilding(t.x, t.z, t.r), `${t.what} at ${t.x},${t.z}`).toBe(true);
    }
    for (let i = 0; i < things.length; i++)
      for (let j = i + 1; j < things.length; j++) expect(Math.hypot(things[i].x - things[j].x, things[i].z - things[j].z)).toBeGreaterThan(things[i].r + things[j].r + 0.1);
  });

  it("keeps them off the walks: round the base and out of the door", () => {
    expect(WALKS.length).toBeGreaterThan(0);
    for (const t of things) for (const w of WALKS) expect(toLine(t.x, t.z, w), `${t.what} on a walk`).toBeGreaterThan(t.r + 0.08);
    // the door walk leaves the west face
    expect(WALKS.some((w) => w.some(([x, z]) => Math.abs(x + COIT.lobby.w / 2) < 0.1 && Math.abs(z) < EPS))).toBe(true);
  });
});
