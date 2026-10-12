import { describe, expect, it } from "vitest";
import { CITY, PARKS } from "@/scene/layout";
import { KINDS, kindOf, treeGeometries, type Tree } from "@/scene/trees";

const geos = treeGeometries();

describe("trees", () => {
  it("streets get only planes and ficus; parks get every kind", () => {
    const kinds = CITY.trees.map(kindOf);
    for (const k of KINDS) expect(kinds).toContain(k);
    const inPark = (t: Tree) => PARKS.some(([x0, x1, z0, z1]) => t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1);
    const street = CITY.trees.filter((t) => !inPark(t)).map(kindOf);
    expect(street.every((k) => k === "plane" || k === "ficus")).toBe(true);
  });

  it("geometry is finite, cheap and about as tall as before (views stay clear)", () => {
    let triangles = 0;
    for (const k of KINDS) {
      for (const g of [geos[k].trunk, geos[k].crown]) {
        expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);
        expect(Array.from(g.attributes.normal.array).every(Number.isFinite)).toBe(true);
        g.computeBoundingBox();
        expect(g.boundingBox!.max.y).toBeLessThan(3.2);
        triangles += (g.index?.count ?? g.attributes.position.count) / 3;
      }
    }
    expect(triangles / KINDS.length).toBeLessThan(1500);
  });
});
