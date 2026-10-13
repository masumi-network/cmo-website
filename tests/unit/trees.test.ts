import { Object3D, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { PARKS, groundAt } from "@/scene/grid";
import { CITY } from "@/scene/layout";
import {
  CROWN_RADIUS,
  CROWN_TOP,
  KINDS,
  PIT,
  SPREAD,
  TREE_BUDGET,
  TRUNK_RADIUS,
  VARIANTS,
  hasPit,
  kindOf,
  pitGeometry,
  pitPose,
  treeModels,
  treePose,
  triangles,
  variantOf,
  type Tree,
} from "@/scene/tree-models";

const models = treeModels();
const LODS = ["near", "far"] as const;

const each = (g: BufferGeometry, f: (x: number, y: number, z: number, i: number) => void) => {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) f(p.getX(i), p.getY(i), p.getZ(i), i);
};
/** Triangles for every tree in the city at one level of detail, pits included. */
const cityTriangles = (lod: (typeof LODS)[number]) =>
  CITY.trees.reduce((sum, t) => {
    const m = models[kindOf(t)][variantOf(t)][lod];
    return sum + triangles(m.bark) + triangles(m.leaves) + (hasPit(t) ? triangles(pitGeometry()) : 0);
  }, 0);

describe("trees", () => {
  it("streets get only planes and ficus; parks get every kind", () => {
    const kinds = CITY.trees.map(kindOf);
    for (const k of KINDS) expect(kinds).toContain(k);
    const inPark = (t: Tree) => PARKS.some(([x0, x1, z0, z1]) => t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1);
    const street = CITY.trees.filter((t) => !inPark(t)).map(kindOf);
    expect(street.every((k) => k === "plane" || k === "ficus")).toBe(true);
  });

  it("has a few seeded variants per kind, each different, and the city uses them all", () => {
    for (const k of KINDS) {
      expect(models[k]).toHaveLength(VARIANTS);
      const firsts = models[k].map((v) => v.near.leaves.attributes.position.getX(7).toFixed(4) + v.near.bark.attributes.position.count);
      expect(new Set(firsts).size, k).toBe(VARIANTS);
      const used = new Set(CITY.trees.filter((t) => kindOf(t) === k).map(variantOf));
      expect(used.size, k).toBe(VARIANTS);
    }
    // Seeded: built twice, the same.
    const again = treeModels();
    expect(Array.from(again.plane[1].near.leaves.attributes.position.array)).toEqual(Array.from(models.plane[1].near.leaves.attributes.position.array));
  });

  it.each(KINDS)("%s: geometry is finite, with bark, leaf cards and wind weights", (k) => {
    for (const v of models[k]) {
      for (const lod of LODS) {
        const { bark, leaves } = v[lod];
        for (const g of [bark, leaves]) {
          for (const name of ["position", "normal", "uv", "color"]) {
            expect(g.attributes[name], `${k} ${lod} ${name}`).toBeDefined();
            expect(Array.from(g.attributes[name].array).every(Number.isFinite), `${k} ${lod} ${name}`).toBe(true);
          }
          expect(g.index, "indexed (one batch)").not.toBeNull();
          const c = Array.from(g.attributes.color.array);
          expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
          expect(Math.max(...c)).toBeLessThanOrEqual(1.0001);
        }
        expect(leaves.attributes.aLeaf.itemSize).toBe(3);
        expect(Array.from(leaves.attributes.aLeaf.array).every((w) => Number.isFinite(w) && w >= 0 && w <= 1.5)).toBe(true);
      }
    }
  });

  it.each(KINDS)("%s: the crown stays inside its old bounds (house fronts, lamps, bridge roads, views)", (k) => {
    for (const v of models[k]) {
      for (const lod of LODS) {
        for (const g of [v[lod].leaves, v[lod].bark]) {
          each(g, (x, y, z) => {
            expect(Math.hypot(x, z), `${k} ${lod} radius`).toBeLessThanOrEqual(CROWN_RADIUS[k]);
            expect(y, `${k} ${lod} top`).toBeLessThan(CROWN_TOP);
            expect(y).toBeGreaterThan(-0.35);
          });
        }
      }
    }
    // Measured on the old blob canopies: never wider, never taller.
    expect(CROWN_RADIUS[k]).toBeLessThanOrEqual({ plane: 1.2, ficus: 1.01, cypress: 1.47, palm: 1.45 }[k]);
    expect(CROWN_TOP).toBeLessThan(3.1);
  });

  it.each(KINDS)("%s: a street tree's leaves start above head height; the park cypress may sweep lower", (k) => {
    const low = { plane: 0.9, ficus: 0.85, cypress: 0.45, palm: 1.2 }[k];
    for (const v of models[k]) each(v.near.leaves, (_, y) => expect(y, k).toBeGreaterThan(low));
  });

  it.each(KINDS)("%s: the trunk stands on the tree's spot, as thick as grass and furniture expect", (k) => {
    for (const v of models[k]) {
      for (const lod of LODS) {
        let ground = 0;
        let lowest = Infinity;
        each(v[lod].bark, (x, y, z) => {
          lowest = Math.min(lowest, y);
          if (y > -0.05 && y < 0.25) {
            const r = Math.hypot(x, z);
            expect(r, `${k} ${lod} trunk at the ground`).toBeLessThanOrEqual(TRUNK_RADIUS);
            ground = Math.max(ground, r);
          }
        });
        expect(lowest, "goes into the ground (slopes)").toBeLessThan(-0.2);
        expect(ground, "a real trunk").toBeGreaterThan(0.06);
      }
    }
    // grass.test keeps blades 0.18 * s from every trunk; the widest instance still fits.
    expect(TRUNK_RADIUS * (1 + SPREAD)).toBeLessThanOrEqual(0.18);
  });

  it("places each tree on its spot at its size, turned and a little uneven", () => {
    const o = new Object3D();
    const turns = new Set<string>();
    for (const t of CITY.trees) {
      o.position.set(9, 9, 9);
      treePose(t, kindOf(t), o);
      expect(o.position.toArray()).toEqual([t.x, t.y, t.z]);
      expect(o.scale.x / t.s).toBeGreaterThanOrEqual(1 - SPREAD - 1e-9);
      expect(o.scale.z / t.s).toBeLessThanOrEqual(1 + SPREAD + 1e-9);
      expect(o.scale.y / t.s).toBeLessThanOrEqual(1);
      turns.add(o.rotation.y.toFixed(2));
    }
    expect(turns.size).toBeGreaterThan(CITY.trees.length * 0.8);
  });

  it("puts a tree grate under street trees only, flat on the sidewalk", () => {
    const street = CITY.trees.filter(hasPit);
    expect(street.length).toBeGreaterThan(15);
    const o = new Object3D();
    for (const t of CITY.trees) {
      expect(hasPit(t)).toBe(groundAt(t.x, t.z) === "sidewalk");
      if (!hasPit(t)) continue;
      pitPose(t, o);
      o.updateMatrix();
      each(pitGeometry().clone().applyMatrix4(o.matrix), (x, y, z) => {
        expect(groundAt(x, z), `grate at ${t.x},${t.z}`).toBe("sidewalk");
        expect(Math.abs(y - heightAt(x, z)), "on the sidewalk").toBeLessThan(0.03);
        expect(y).toBeGreaterThan(heightAt(x, z));
      });
    }
    expect(PIT).toBeLessThan(0.7);
  });

  it("stays in budget: about 150k triangles for every tree up close, lite far cheaper", () => {
    const full = cityTriangles("near");
    const lite = cityTriangles("far");
    expect(full).toBeLessThanOrEqual(TREE_BUDGET);
    expect(lite).toBeLessThan(full * 0.5);
    for (const k of KINDS) {
      const n = CITY.trees.filter((t) => kindOf(t) === k).length;
      for (const v of models[k]) {
        const near = triangles(v.near.bark) + triangles(v.near.leaves);
        const far = triangles(v.far.bark) + triangles(v.far.leaves);
        expect(near * n, `${k}: its share of the budget`).toBeLessThan(TREE_BUDGET * 0.45);
        expect(far, `${k}: far is cheaper`).toBeLessThan(near * 0.55);
      }
    }
  });
});
