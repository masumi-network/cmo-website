import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { PLAZA, heightAt, surfaceAt } from "@/lib/terrain";
import { STREET } from "@/scene/grid";
import { ALUMINIUM, BEACON, FACADE, PYRAMID, SPIRE, WINGS, plazaWallGeometry, pyramidGeometry, pyramidHalf } from "@/scene/pyramid";
import { PART } from "@/scene/towers";

const g = pyramidGeometry();
const pos = g.attributes.position;
const nor = g.attributes.normal;
const info = g.attributes.aInfo;
const EPS = 1e-6;
/** The crown is 0.012 proud of the faces (collision.test.ts allows for it). */
const PROUD = 0.012;

const each = (fn: (x: number, y: number, z: number, i: number) => void) => {
  for (let i = 0; i < pos.count; i++) fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
};
const inWing = (x: number, y: number, z: number) =>
  WINGS.some(([side, y0, y1, w]) => y >= y0 - EPS && y <= y1 + EPS && Math.abs(z) <= w / 2 + EPS && side * x >= 0.4 - EPS && side * x <= pyramidHalf(y0) + EPS);
const inSpire = (x: number, y: number, z: number) =>
  y >= SPIRE.base - EPS && y <= SPIRE.top + EPS && Math.abs(x - SPIRE.x) <= SPIRE.half + EPS && Math.abs(z - SPIRE.z) <= SPIRE.half + EPS;

describe("Transamerica Pyramid model", () => {
  it("is finite, with unit normals", () => {
    for (const a of [pos, nor, info, g.attributes.color, g.attributes.aUv]) {
      for (let i = 0; i < a.array.length; i++) expect(Number.isFinite(a.array[i])).toBe(true);
    }
    for (let i = 0; i < nor.count; i++) expect(Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i))).toBeCloseTo(1, 5);
  });

  it("stays inside the body Cuso climbs (plus the crown's hair), the wings and the spire", () => {
    const out: string[] = [];
    each((x, y, z) => {
      const half = pyramidHalf(Math.max(0, y)) + PROUD + EPS;
      if (Math.max(Math.abs(x), Math.abs(z)) > half && !inWing(x, y, z) && !inSpire(x, y, z)) out.push(`${x.toFixed(3)}, ${y.toFixed(3)}, ${z.toFixed(3)}`);
    });
    expect(out.slice(0, 5)).toEqual([]);
  });

  it("keeps its base on its own block: no wider than the footprint, nothing under the plaza", () => {
    g.computeBoundingBox();
    const b = g.boundingBox!;
    for (const v of [b.min.x, b.min.z]) expect(v).toBeGreaterThanOrEqual(-PYRAMID.base - EPS);
    for (const v of [b.max.x, b.max.z]) expect(v).toBeLessThanOrEqual(PYRAMID.base + EPS);
    expect(b.min.y).toBeGreaterThan(-0.5);
  });

  it("puts the beacon on the tip of the spire", () => {
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeCloseTo(SPIRE.top, 6);
    expect(BEACON[0]).toBe(SPIRE.x);
    expect(BEACON[2]).toBe(SPIRE.z);
    expect(BEACON[1]).toBeGreaterThan(SPIRE.top);
    expect(BEACON[1]).toBeLessThan(SPIRE.top + 0.15);
  });

  it("sets the windows into the panels: all glass sits back from the face", () => {
    let glass = 0;
    each((x, y, z, i) => {
      if (Math.round(info.getX(i)) !== PART.glass) return;
      glass++;
      const back = pyramidHalf(y) - Math.max(Math.abs(x), Math.abs(z));
      if (y >= FACADE.arcade - EPS && y <= FACADE.crown + EPS) expect(back).toBeGreaterThanOrEqual(FACADE.depth - EPS);
    });
    expect(glass).toBeGreaterThan(0);
    expect(FACADE.depth).toBeGreaterThan(0.03);
  });

  it("floodlights the aluminium crown and spire at night, nothing else", () => {
    each((_x, y, _z, i) => {
      const metal = Math.round(info.getX(i)) === ALUMINIUM;
      expect(info.getZ(i) > 0).toBe(metal);
      if (metal) expect(y).toBeGreaterThanOrEqual(FACADE.crown - EPS);
    });
  });

  it("stays cheap: one geometry of a few thousand triangles", () => {
    expect(pos.count / 3).toBeLessThan(12000);
    expect(g.index).toBeNull();
  });
});

describe("the Pyramid's plaza", () => {
  const [cx, cz] = [6.5, -11];
  const base = heightAt(cx, cz);

  it("is cut level into the hill under the whole footprint and a small apron, at the Pyramid's base", () => {
    expect(PLAZA.y).toBe(base);
    // Cuso's 15:00 platform stays where it was: 28 over the base
    expect(chapters.find((c) => c.id === "seo")!.spot[1]).toBeCloseTo(base + PYRAMID.height, 9);
    const apron = 0.04;
    const half = PYRAMID.base + apron;
    for (let x = cx - half; x <= cx + half + 1e-9; x += 0.05) {
      for (let z = cz - half; z <= cz + PYRAMID.base + 1e-9; z += 0.05) expect(heightAt(x, z), `${x}, ${z}`).toBe(base);
    }
  });

  it("stays off the streets: they keep their own height", () => {
    // the north street (z -16) and the south one (z -6) end at their kerbs, outside the plaza
    expect(PLAZA.z0).toBeGreaterThan(-16 + STREET / 2);
    expect(PLAZA.z1).toBeLessThan(-6 - STREET / 2);
    for (let x = PLAZA.x0; x <= PLAZA.x1; x += 0.25) expect(surfaceAt(x, -16 + STREET / 2 - 0.01)).toBeGreaterThan(base);
  });

  it("closes the cut with retaining walls up to the ground outside it", () => {
    const w = plazaWallGeometry();
    const p = w.attributes.position;
    let top = 0;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = [p.getX(i) + cx, p.getY(i) + base, p.getZ(i) + cz];
      expect(Number.isFinite(y)).toBe(true);
      // on the plaza's edges, between the plaza and the ground just outside
      const onEdge = [Math.abs(x - PLAZA.x0), Math.abs(x - PLAZA.x1), Math.abs(z - PLAZA.z0)].some((d) => d < 1e-6);
      expect(onEdge, `${x}, ${z}`).toBe(true);
      expect(y).toBeGreaterThanOrEqual(base - 1e-6);
      top = Math.max(top, y - base);
    }
    expect(top).toBeGreaterThan(0.3); // the hill rises behind the north-west corner
  });
});
