// Street furniture: SF post-top lamps, fire hydrants and green street-name
// signs. All of it stands on a sidewalk near the kerb (never on the asphalt,
// a curb ramp, a stoop or a house front), off Cuso's routes and under no
// bridge road, and is drawn with a few instanced meshes.

import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { EDGE, STREET, WALK_X, WALK_Z, X_STREETS, Z_STREETS, groundAt, streetDrop } from "@/scene/grid";
import { CITY, KERB_SET, blocksView, type Fixture } from "@/scene/layout";
import { onRoad } from "@/scene/roads";
import { PATHS } from "@/scene/routes";
import { HYDRANT, LAMP, SIGN, STREET_PARTS } from "@/scene/street";

const { lamps, hydrants, signs, trees } = CITY;
const kinds = [
  ["lamp", lamps, LAMP],
  ["hydrant", hydrants, HYDRANT],
  ["sign", signs, SIGN],
] as const;
const all: Fixture[] = [...lamps, ...hydrants, ...signs];
const id = (f: { x: number; z: number }) => `${f.x.toFixed(2)},${f.z.toFixed(2)}`;
const nearest = (list: number[], v: number) => Math.min(...list.map((s) => Math.abs(v - s)));

/** Cuso's whole day, every 0.25 in x and z (jumps included, from above counts too). */
const ROUTE: [number, number][] = PATHS.flatMap(({ points }) =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);

describe("street furniture", () => {
  it("has lamps, a few hydrants and a few street signs", () => {
    expect(lamps.length).toBeGreaterThan(25);
    expect(hydrants.length).toBeGreaterThanOrEqual(10);
    expect(hydrants.length).toBeLessThanOrEqual(30);
    expect(signs.length).toBeGreaterThanOrEqual(5);
    expect(signs.length).toBeLessThanOrEqual(16);
  });

  it.each(kinds)("stands every %s on a flat sidewalk, near the kerb, on the ground", (_, list, dims) => {
    for (const f of list) {
      expect([f.x, f.y, f.z, f.turn].every(Number.isFinite), id(f)).toBe(true);
      expect(f.y, id(f)).toBeCloseTo(heightAt(f.x, f.z), 9);
      // its whole base on sidewalk, no curb ramp under it
      for (let a = 0; a < 16; a++) {
        const x = f.x + Math.cos((a / 8) * Math.PI) * dims.base;
        const z = f.z + Math.sin((a / 8) * Math.PI) * dims.base;
        expect(groundAt(x, z), id(f)).toBe("sidewalk");
        expect(streetDrop(x, z), id(f)).toBe(0);
      }
      // KERB_SET in from the kerb of the street it stands by, clear of the block behind
      const d = Math.min(nearest(X_STREETS, f.x), nearest(Z_STREETS, f.z));
      expect(d, id(f)).toBeCloseTo(STREET / 2 + KERB_SET, 9);
      expect(EDGE - (d + dims.reach), id(f)).toBeGreaterThan(0.05);
      expect(d - dims.base - STREET / 2, id(f)).toBeGreaterThan(0.1);
    }
  });

  it("stands lamps on street corners, in front of no house (no door, stoop or garage behind them)", () => {
    for (const l of lamps) {
      expect(nearest(X_STREETS, l.x), id(l)).toBeCloseTo(STREET / 2 + KERB_SET, 9);
      expect(nearest(Z_STREETS, l.z), id(l)).toBeCloseTo(STREET / 2 + KERB_SET, 9);
    }
  });

  it("keeps hydrants and signs on the north-south streets, beside the houses' side walls (no doors, no stoops)", () => {
    for (const f of [...hydrants, ...signs]) expect(nearest(X_STREETS, f.x), id(f)).toBeCloseTo(STREET / 2 + KERB_SET, 9);
  });

  it("puts street signs only at junctions on Cuso's walking streets", () => {
    for (const s of signs) {
      const sx = X_STREETS.find((v) => Math.abs(v - s.x) < STREET);
      const sz = Z_STREETS.find((v) => Math.abs(v - s.z) < 4);
      expect(sx !== undefined && sz !== undefined, id(s)).toBe(true);
      expect(WALK_X.includes(sx!) || WALK_Z.includes(sz!), id(s)).toBe(true);
    }
  });

  it("keeps everything off Cuso's routes, with room for his arms", () => {
    for (const f of all) {
      const close = Math.min(...ROUTE.map(([x, z]) => Math.hypot(x - f.x, z - f.z)));
      expect(close, id(f)).toBeGreaterThan(1.2);
    }
  });

  it("keeps everything apart, and off trees", () => {
    const things = [...all, ...trees];
    for (const f of all) {
      for (const g of things) if (g !== f) expect(Math.hypot(g.x - f.x, g.z - f.z), `${id(f)} and ${id(g)}`).toBeGreaterThan(0.9);
    }
  });

  it.each(kinds)("keeps every %s out from under the bridge roads and out of the chapter shots", (_, list, dims) => {
    for (const f of list) {
      expect(onRoad(f.x, f.z), id(f)).toBeUndefined();
      expect(blocksView(f.x, f.z, f.y + dims.height, dims.reach), id(f)).toBe(false);
    }
  });

  it("builds small, finite parts that fit the sizes the tests use", () => {
    for (const [name, g] of Object.entries(STREET_PARTS)) {
      const pos = g.attributes.position.array;
      expect(Array.from(pos).every(Number.isFinite), name).toBe(true);
      const tris = (g.index?.count ?? g.attributes.position.count) / 3;
      expect(tris, name).toBeLessThanOrEqual(name === "pool" ? 50_000 : 700);
    }
    for (const [name, dims, geos] of [
      ["lamp", LAMP, [STREET_PARTS.lampIron, STREET_PARTS.lampGlass]],
      ["hydrant", HYDRANT, [STREET_PARTS.hydrant]],
      ["sign", SIGN, [STREET_PARTS.sign]],
    ] as const) {
      for (const g of geos) {
        g.computeBoundingBox();
        const b = g.boundingBox!;
        expect(b.min.y, name).toBeGreaterThanOrEqual(-1e-6);
        expect(b.max.y, name).toBeLessThanOrEqual(dims.height + 1e-6);
        expect(Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z), name).toBeLessThanOrEqual(dims.reach + 1e-6);
      }
    }
  });
});
