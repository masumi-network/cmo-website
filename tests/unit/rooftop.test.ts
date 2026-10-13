// The 06:00 apartment: a modelled Edwardian block in the row houses' paints
// (house-models.ts), on the fixed roof Cuso stands on.

import { describe, expect, it } from "vitest";
import { Vector3, type BufferGeometry } from "three";
import { heightAt } from "@/lib/terrain";
import { PALETTES, SLOT, SLOTS } from "@/scene/house-models";
import { APARTMENT, ROOFTOP, apartmentGeometry } from "@/scene/rooftop";

const g = apartmentGeometry();
const R = ROOFTOP;
const EPS = 1e-6;
const pos = g.attributes.position;
const slot = g.attributes.aSlot;
const P = (i: number) => new Vector3().fromBufferAttribute(pos, i);
const verts = Array.from({ length: pos.count }, (_, i) => i);

/** Triangles (as vertex triples) painted with `s`. */
function faces(geo: BufferGeometry, s: number) {
  const idx = geo.index!;
  const out: [Vector3, Vector3, Vector3][] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const k = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    if (slot.getX(k[0]) === s) out.push([P(k[0]), P(k[1]), P(k[2])]);
  }
  return out;
}

describe("the 06:00 apartment", () => {
  it("keeps the roof Cuso stands on (Cuso's jump and the collision solids read it)", () => {
    expect(ROOFTOP).toEqual({
      x0: -17.5, x1: -10.5, z0: -13.6, z1: -7.4, roof: 8, base: -0.6,
      wall: 0.16, parapet: 0.355,
      cornice: { out: 0.24, bottom: 7.55, top: 7.97 },
      bulkhead: { x: -16.25, z: -8.6, w: 1.62, d: 1.42, top: 9.175 },
    });
  });

  it("is a finite model in the row houses' paints, cream, where glass (and only glass) has a window id", () => {
    expect(PALETTES[APARTMENT.palette].name).toBe("cream");
    const win = g.attributes.aWin;
    const pal = g.attributes.aPalette;
    const nrm = g.attributes.normal;
    for (const i of verts) {
      for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
      expect(win.getX(i) > 0).toBe(slot.getX(i) === SLOT.glass);
      expect(pal.getX(i)).toBe(APARTMENT.palette);
    }
    // stucco walls, a stone base, trim, glass, a gravel roof; no lap siding or shingles
    const used = new Set(slot.array);
    for (const s of ["stucco", "stone", "trim", "glass", "gravel", "door"] as const) expect(used.has(SLOT[s]), s).toBe(true);
    for (const s of ["body", "roof", "scales"] as const) expect(used.has(SLOT[s]), s).toBe(false);
  });

  it("stands out of its walls no further than the cornice line, which is where the collision ring is", () => {
    const out = R.cornice.out;
    for (const i of verts) {
      const p = P(i);
      expect(p.x).toBeGreaterThanOrEqual(R.x0 - out - EPS);
      expect(p.x).toBeLessThanOrEqual(R.x1 + out + EPS);
      expect(p.z).toBeGreaterThanOrEqual(R.z0 - out - EPS);
      expect(p.z).toBeLessThanOrEqual(R.z1 + out + EPS);
      // above the cornice only the parapet's coping overhangs (by 0.05, the collision ring)
      if (p.y > R.cornice.top + EPS) {
        expect(p.x).toBeGreaterThanOrEqual(R.x0 - 0.05 - EPS);
        expect(p.x).toBeLessThanOrEqual(R.x1 + 0.05 + EPS);
        expect(p.z).toBeGreaterThanOrEqual(R.z0 - 0.05 - EPS);
        expect(p.z).toBeLessThanOrEqual(R.z1 + 0.05 + EPS);
      }
    }
    // the crown reaches the cornice line all round, between the ring's bottom and top
    const crown = verts.map(P).filter((p) => Math.abs(p.x - (R.x1 + out)) < EPS && p.y > APARTMENT.frieze + EPS);
    expect(crown.length).toBeGreaterThan(0);
    expect(Math.min(...crown.map((p) => p.y))).toBeGreaterThanOrEqual(R.cornice.bottom - EPS);
    expect(Math.max(...crown.map((p) => p.y))).toBeCloseTo(R.cornice.top, 6);
  });

  it("keeps the roof clear: above the deck only the parapet, the stair bulkhead and a vent", () => {
    const { bulkhead: b, wall: t } = R;
    const inn = t + 0.01;
    for (const i of verts) {
      const p = P(i);
      if (p.y <= R.roof + EPS) continue;
      const parapet = (p.x < R.x0 + inn + EPS || p.x > R.x1 - inn - EPS || p.z < R.z0 + inn + EPS || p.z > R.z1 - inn - EPS) && p.y <= R.roof + R.parapet + EPS;
      const bulkhead = Math.abs(p.x - b.x) <= b.w / 2 + EPS && Math.abs(p.z - b.z) <= b.d / 2 + EPS && p.y <= b.top + EPS;
      const vent = Math.hypot(p.x - APARTMENT.vent[0], p.z - APARTMENT.vent[1]) <= 0.1 && p.y <= R.roof + 0.5;
      expect(parapet || bulkhead || vent, `${p.toArray()}`).toBe(true);
    }
    // nothing near where Cuso stands (x -14, z -12.9) but the parapet
    expect(Math.hypot(APARTMENT.vent[0] + 14, APARTMENT.vent[1] + 12.9)).toBeGreaterThan(3);
  });

  it("has a tar-and-gravel deck at exactly roof height, wall to wall inside the parapet", () => {
    const deck = faces(g, SLOT.gravel);
    let area = 0;
    for (const [a, b, c] of deck) {
      expect([a.y, b.y, c.y].every((y) => Math.abs(y - R.roof) < EPS)).toBe(true);
      const n = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
      expect(n.y).toBeGreaterThan(0);
      area += n.length() / 2;
    }
    expect(area).toBeCloseTo((R.x1 - R.x0 - 2 * R.wall) * (R.z1 - R.z0 - 2 * R.wall), 4);
  });

  it("reaches into the ground all round, so it never floats on the slope", () => {
    const g0 = heightAt(-14, -10.4);
    let low = Infinity;
    for (let x = R.x0; x <= R.x1 + EPS; x += 0.5) for (const z of [R.z0, R.z1]) low = Math.min(low, heightAt(x, z) - g0);
    for (let z = R.z0; z <= R.z1 + EPS; z += 0.5) for (const x of [R.x0, R.x1]) low = Math.min(low, heightAt(x, z) - g0);
    expect(Math.min(...verts.map((i) => pos.getY(i)))).toBeLessThan(low - 0.1);
  });

  it("has its front door on the street side (south), where Cuso jumps up", () => {
    const doors = faces(g, SLOT.door).flat();
    const front = doors.filter((p) => p.z > R.z1 - 0.4 && p.z < R.z1);
    expect(front.length).toBeGreaterThan(0);
    for (const p of front) expect(Math.abs(p.x + 14)).toBeLessThan(0.5);
    // and the bulkhead has its own door, on its east side
    const stair = doors.filter((p) => p.y > R.roof);
    expect(stair.length).toBeGreaterThan(0);
    for (const p of stair) expect(p.x).toBeGreaterThan(R.bulkhead.x);
  });

  it("models windows on every wall and storey: rooms light up whole at night", () => {
    const win = g.attributes.aWin;
    const ids = new Set<number>();
    const walls = { north: 0, south: 0, east: 0, west: 0 };
    for (const i of verts) {
      const id = win.getX(i);
      if (!id || ids.has(id)) continue;
      ids.add(id);
      const p = P(i);
      if (p.y > R.roof) continue;
      const d = { north: p.z - R.z0, south: R.z1 - p.z, west: p.x - R.x0, east: R.x1 - p.x };
      const near = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (Math.abs(d[a]) < Math.abs(d[b]) ? a : b));
      walls[near]++;
    }
    // per wall: two bays on four storeys (a room each), the middle column, the ground floor
    for (const n of Object.values(walls)) expect(n).toBeGreaterThanOrEqual(2 * 4 + 4 + 4);
    // glass is recessed: it never stands out past the bays' sashes
    for (const [a, b, c] of faces(g, SLOT.glass)) {
      for (const p of [a, b, c]) {
        if (p.y > R.roof) continue;
        const out = Math.max(R.x0 - p.x, p.x - R.x1, R.z0 - p.z, p.z - R.z1);
        expect(out).toBeLessThan(APARTMENT.bay.depth);
      }
    }
  });

  it("stays within its triangle budget", () => {
    expect(g.index!.count / 3).toBeLessThan(9000);
  });
});
