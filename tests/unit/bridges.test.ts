// The bridges' masonry and concrete: the Golden Gate's anchorages, pylons and
// tower piers, its Fort Point arch, the Bay Bridge's anchorages and tower piers,
// the Yerba Buena tunnel portal and the approach piers. Modelled in depth but
// kept out of the road, the water lanes and Cuso's way, and on a triangle budget.

import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { surfaceAt } from "@/lib/terrain";
import { WATER_Y } from "@/scene/bay";
import { groundAt, insideLand } from "@/scene/grid";
import { BAY_TOWERS, GG, GG_PYLON, PORTAL, bayMasonry, ggArch, ggMasonry } from "@/scene/landmarks";
import { BAY_ANCHORS, DECK_Y, ISLAND, RAIL, ROADS, ROAD_WIDTH, SLAB, WATERLINE, bayDeckY, mason, masonryGeometry, pier, piers, roadGeometry, type Road } from "@/scene/roads";
import { DAY_LENGTH, sampleDay } from "@/scene/routes";

const gg = ggMasonry();
const arch = ggArch();
const bay = bayMasonry();
const roads = ROADS.map((r) => roadGeometry(r).concrete);
const road = (name: string) => ROADS.find((r) => r.name === name) as Road;

function* vertices(g: BufferGeometry) {
  const p = g.attributes.position.array;
  for (let i = 0; i < p.length; i += 3) yield [p[i], p[i + 1], p[i + 2]] as const;
}
const triangles = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Road surface height at z on the Golden Gate's south road (it runs along x = GG.x there). */
function ggSouthY(z: number) {
  const p = road("golden-gate-south").points;
  for (let i = 1; i < p.length; i++) if ((z - p[i - 1][2]) * (z - p[i][2]) <= 0 && Math.abs(p[i][0] - GG.x) < 0.01) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (z - p[i - 1][2])) / (p[i][2] - p[i - 1][2]);
  return DECK_Y;
}

/** Today's footings in the water (bay.tsx FOOTINGS): [x, z, half x, half z]. */
const FOOTINGS: [number, number, number, number][] = [
  ...[...GG.towers, GG.south, GG.north].map((z): [number, number, number, number] => [GG.x, z, GG.towers.includes(z) ? 3.2 : 2.3, 2]),
  ...BAY_TOWERS.map((x): [number, number, number, number] => [x, 14, 1.2, 2.7]),
  ...BAY_ANCHORS.map((x): [number, number, number, number] => [x, 14, 1.15, 2.25]),
];
const inFooting = (x: number, z: number, slack = 1e-3) => FOOTINGS.some(([fx, fz, hx, hz]) => Math.abs(x - fx) <= hx + slack && Math.abs(z - fz) <= hz + slack);
/** On the island, where the portal stands against its flank. */
const atPortal = (x: number, z: number) => x >= PORTAL.front - 0.05 && x <= PORTAL.x + 1 && Math.abs(z - PORTAL.z) <= 2.6 + 1e-3;
const islandDome = (x: number, z: number) => {
  const d = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  return d < 1 ? ISLAND.y + ISLAND.h * Math.sqrt(1 - d * d) : -Infinity;
};

describe("bridge masonry", () => {
  it("knows the water level", () => {
    expect(WATERLINE).toBe(WATER_Y);
  });

  it("is finite, flat shaded, and every vertex knows the ledge above it", () => {
    for (const g of [gg, bay.concrete, ...roads]) {
      const top = g.attributes.aTop.array;
      expect(top.length).toBe(g.attributes.position.count);
      for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
      for (const v of g.attributes.normal.array) expect(Number.isFinite(v)).toBe(true);
      for (const v of top) expect(Number.isFinite(v)).toBe(true);
    }
    for (const g of [arch, bay.tunnel]) for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
  });

  it("merges the parts of each mesh into one geometry with the same attributes", () => {
    const m = mason();
    const g = masonryGeometry(m);
    expect(g.attributes.position.count).toBe(0);
    expect(g.attributes.aTop.count).toBe(0);
  });

  it("keeps the Golden Gate anchorages under the road slab: only the pylons rise, beside the road", () => {
    const beside = RAIL.inner + RAIL.parapet;
    for (const [x, y, z] of vertices(gg)) {
      if (Math.min(Math.abs(z - GG.south), Math.abs(z - GG.north)) > 2.5) continue;
      if (Math.abs(x - GG.x) < beside) expect(y, `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBeLessThanOrEqual(GG.anchorTop + 1e-4);
    }
    expect(GG.anchorTop).toBeLessThanOrEqual(DECK_Y - SLAB);
    // the pylons: Art Deco towers beside the road, well under the main towers
    expect(GG_PYLON.inner).toBeGreaterThanOrEqual(beside);
    expect(GG_PYLON.top).toBeGreaterThan(DECK_Y + 2.5);
    expect(GG_PYLON.top).toBeLessThan(GG.top / 2);
    const tops = [...vertices(gg)].filter(([, , z]) => Math.abs(z - GG.south) < 2.5).map(([, y]) => y);
    expect(Math.max(...tops)).toBeCloseTo(GG_PYLON.top, 3);
  });

  it("stands in the water only on today's footings (boats keep their lanes)", () => {
    for (const g of [gg, bay.concrete]) {
      for (const [x, y, z] of vertices(g)) {
        if (y > 0.6) continue; // at and below the waterline
        const ok = inFooting(x, z) || insideLand(x, z) || atPortal(x, z) || islandDome(x, z) > y;
        expect(ok, `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBe(true);
      }
    }
  });

  it("keeps the Bay Bridge anchorages under the road and its tower piers under the deck truss", () => {
    for (const x0 of BAY_ANCHORS) {
      for (const [x, y, z] of vertices(bay.concrete)) {
        if (Math.abs(x - x0) > 1.3 || Math.abs(z - 14) > 2.4) continue;
        if (Math.abs(z - 14) < RAIL.inner + RAIL.parapet) expect(y, `${x.toFixed(2)},${z.toFixed(2)}`).toBeLessThanOrEqual(bayDeckY(x) - 0.05);
      }
    }
    for (const x0 of BAY_TOWERS) {
      const ys = [...vertices(bay.concrete)].filter(([x, , z]) => Math.abs(x - x0) < 1.3 && Math.abs(z - 14) < 2.8).map(([, y]) => y);
      expect(ys.length).toBeGreaterThan(0);
      expect(Math.max(...ys)).toBeLessThan(DECK_Y - 1.7); // under the truss
    }
  });

  it("gives the Yerba Buena tunnel an arched portal the traffic fits through, dark inside", () => {
    expect(PORTAL.half).toBeGreaterThanOrEqual(ROAD_WIDTH / 2 + 0.05);
    // nothing in a car's way in front of the dark face (cars are up to 1.3 tall, in lanes up to 1.2 off the centre line)
    for (const [x, y, z] of vertices(bay.concrete)) {
      const inEnvelope = x > PORTAL.x - 4 && x < PORTAL.x + 0.3 && Math.abs(z - PORTAL.z) < 1.25 && y > PORTAL.y + 0.01 && y < PORTAL.y + 1.4;
      expect(inEnvelope, `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBe(false);
    }
    // the opening at a car's outer edge is tall enough
    const at = (dz: number) => PORTAL.spring + PORTAL.rise * Math.sqrt(Math.max(0, 1 - (dz / PORTAL.half) ** 2));
    expect(at(1.2)).toBeGreaterThan(1.4);
    // the dark face fills the opening in front of the hill, short of the plane the traffic hides behind (PORTAL.x + 0.3)
    expect(PORTAL.plug).toBeLessThanOrEqual(PORTAL.x + 0.3);
    for (let dz = -PORTAL.half; dz <= PORTAL.half; dz += 0.1) expect(islandDome(PORTAL.plug, PORTAL.z + dz)).toBeLessThanOrEqual(PORTAL.y + 1e-3);
    const t = [...vertices(bay.tunnel)];
    expect(Math.min(...t.map(([x]) => x))).toBeGreaterThanOrEqual(PORTAL.front - 1e-3);
    const plug = t.filter(([x]) => Math.abs(x - PORTAL.plug) < 1e-3);
    expect(Math.max(...plug.map(([, , z]) => z - PORTAL.z))).toBeGreaterThanOrEqual(PORTAL.half - 1e-3);
    expect(Math.max(...plug.map(([, y]) => y - PORTAL.y))).toBeGreaterThanOrEqual(PORTAL.spring + PORTAL.rise - 1e-3);
  });

  it("springs the Fort Point arch from the anchorage to the land pier, under the road and over the street", () => {
    const ys = [...vertices(arch)];
    expect(ys.length).toBeGreaterThan(0);
    for (const [x, y, z] of ys) {
      const id = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
      expect(z, id).toBeGreaterThanOrEqual(GG.south + 2 - 0.3); // from the anchorage's south face
      expect(Math.abs(x - GG.x), id).toBeLessThan(ROAD_WIDTH / 2);
      expect(y, id).toBeLessThanOrEqual(ggSouthY(z) - SLAB + 1e-3);
      // traffic on the street under it has headroom
      if (groundAt(x, z) === "street") expect(y - surfaceAt(x, z), id).toBeGreaterThan(2.2);
      if (y < 0.6) expect(insideLand(x, z) || inFooting(x, z), id).toBe(true);
    }
  });

  it("builds approach piers as tapered columns under a crossbeam, inside their footprint and under the slab", () => {
    for (const r of ROADS) {
      for (const [x, z, base, top] of piers(r)) {
        const m = mason();
        pier(m, x, z, [1, 0], base, top);
        const g = masonryGeometry(m);
        const vs = [...vertices(g)];
        const half = (y0: number, y1: number) => Math.max(...vs.filter(([, y]) => y >= y0 && y <= y1).map(([vx, , vz]) => Math.max(Math.abs(vx - x), Math.abs(vz - z))));
        for (const [vx, vy, vz] of vs) {
          expect(vy).toBeLessThanOrEqual(top + 1e-6);
          expect(Math.abs(vz - z)).toBeLessThanOrEqual(ROAD_WIDTH / 2);
          expect(Math.abs(vx - x)).toBeLessThanOrEqual(0.6);
        }
        expect(half(base - 1, base + 0.1)).toBeLessThanOrEqual(0.5 + 1e-6); // in the water footing
        expect(half(top - 0.56, top - 0.49)).toBeLessThan(half(base - 1, base + 0.1)); // tapers
        expect(half(top - 0.05, top + 1e-4)).toBeGreaterThan(1.1); // a crossbeam under the slab
      }
    }
  });

  it("never gets in Cuso's way", () => {
    for (const g of [gg, arch, bay.concrete]) {
      g.computeBoundingBox();
      const box = g.boundingBox!;
      const vs = [...vertices(g)];
      for (let d = 0; d <= DAY_LENGTH; d += 0.5) {
        const [cx, cy, cz] = sampleDay(d).pos;
        if (cx < box.min.x - 0.6 || cx > box.max.x + 0.6 || cz < box.min.z - 0.6 || cz > box.max.z + 0.6) continue;
        for (const [x, y, z] of vs) if (y > cy && y < cy + 2.2) expect(Math.hypot(x - cx, z - cz), `at ${cx.toFixed(1)},${cz.toFixed(1)}`).toBeGreaterThan(0.6);
      }
    }
  });

  it("stays on a triangle budget (sized for how far away it is seen)", () => {
    const roadTris = roads.reduce((s, g) => s + triangles(g), 0);
    expect(triangles(gg)).toBeLessThan(9000);
    expect(triangles(arch)).toBeLessThan(2500);
    expect(triangles(bay.concrete)).toBeLessThan(9000);
    expect(triangles(bay.tunnel)).toBeLessThan(400);
    expect(roadTris).toBeLessThan(14000);
    // before this pass: about 7.6k triangles in all
    expect(triangles(gg) + triangles(arch) + triangles(bay.concrete) + triangles(bay.tunnel) + roadTris).toBeLessThan(7600 + 40000);
  });
});
