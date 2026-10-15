import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { PLAZA, heightAt } from "@/lib/terrain";
import { CABLE_RAILS, EDGE, SIDEWALK, STREET, WALK_X, WALK_Z, groundAt, insideLand, streetDrop } from "@/scene/grid";
import { CITY, CLEAR, OBSTACLES, generateCity } from "@/scene/layout";
import { MORE_TREES, cityTrees, moreTrees, reachOf } from "@/scene/more-trees";
import { onRoad } from "@/scene/roads";
import { PATHS } from "@/scene/routes";
import { CROWN_TOP, PIT, hasPit, treeModels, triangles, variantOf } from "@/scene/tree-models";

const all = MORE_TREES;
/** Cuso's whole day in x, y, z, every 0.25. */
const route = PATHS.flatMap(({ points }) =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k) => a.map((v, j) => v + ((b[j] - v) * k) / n));
  }),
);
/** The four corners of a tree's grate. */
const pit = (t: { x: number; z: number }) => [-1, 1].flatMap((a) => [-1, 1].map((b) => [t.x + (a * PIT) / 2, t.z + (b * PIT) / 2] as const));

describe("more trees", () => {
  it("is seeded on its own: the same every time, and the layout (towers, skyline) is untouched", () => {
    expect(moreTrees()).toEqual(MORE_TREES);
    expect(JSON.stringify(generateCity())).toBe(JSON.stringify(CITY));
  });

  it("adds a restrained number of street trees, half of them on phones", () => {
    expect(all.length).toBeGreaterThan(40);
    expect(all.length).toBeLessThan(CITY.trees.length * 0.6);
    const lite = all.filter((t) => t.lite).length;
    expect(lite).toBeGreaterThan(all.length * 0.3);
    expect(lite).toBeLessThan(all.length * 0.6);
  });

  it("hands <Trees> one stable list: the city's trees, then the extra ones (lite: the phone half)", () => {
    expect(cityTrees(false)).toBe(cityTrees(false));
    expect(cityTrees(false)).toEqual([...CITY.trees, ...all]);
    expect(cityTrees(true)).toEqual([...CITY.trees, ...all.filter((t) => t.lite)]);
  });

  it("stands on land, on a sidewalk, its grate wholly on it and off the curb ramps", () => {
    for (const t of all) {
      const at = `${t.x.toFixed(2)},${t.z.toFixed(2)}`;
      expect(insideLand(t.x, t.z), at).toBe(true);
      expect(t.y).toBeCloseTo(heightAt(t.x, t.z), 6);
      expect(hasPit(t), at).toBe(true);
      for (const [x, z] of pit(t)) {
        expect(groundAt(x, z), `grate at ${at}`).toBe("sidewalk");
        expect(streetDrop(x, z), `curb ramp at ${at}`).toBe(0);
      }
    }
  });

  it("keeps the walking streets' sidewalks and Cuso's whole day clear, crown included", () => {
    for (const t of all) {
      for (const x of WALK_X) expect(Math.abs(t.x - x), `${t.x},${t.z}`).toBeGreaterThanOrEqual(EDGE);
      for (const z of WALK_Z) expect(Math.abs(t.z - z), `${t.x},${t.z}`).toBeGreaterThanOrEqual(EDGE);
      for (const [x, , z] of route) expect(Math.hypot(t.x - x, t.z - z), `${t.x},${t.z}`).toBeGreaterThan(Math.max(1.3, reachOf(t) + 0.5));
      for (const c of chapters) expect(Math.hypot(t.x - c.spot[0], t.z - c.spot[2])).toBeGreaterThan(2);
    }
  });

  it("keeps out of the cable line, the bridge roads and the traffic lanes", () => {
    const [x0, x1, rz] = CABLE_RAILS[0];
    for (const t of all) {
      const dx = Math.max(x0 - t.x, 0, t.x - x1);
      expect(Math.hypot(dx, t.z - rz), "cable car").toBeGreaterThan(STREET / 2 + reachOf(t));
      for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) expect(onRoad(t.x + Math.cos(a) * 1.5, t.z + Math.sin(a) * 1.5), `road by ${t.x},${t.z}`).toBeUndefined();
      expect(groundAt(t.x, t.z)).not.toBe("street");
    }
  });

  it("keeps clear of street furniture, other trees, landmarks and buildings", () => {
    const furniture = [...CITY.lamps, ...CITY.hydrants, ...CITY.signs];
    for (const t of all) {
      const at = `${t.x.toFixed(2)},${t.z.toFixed(2)}`;
      for (const f of furniture) expect(Math.hypot(t.x - f.x, t.z - f.z), at).toBeGreaterThan(1.2);
      for (const o of [...CITY.trees, ...all]) if (o !== t) expect(Math.hypot(t.x - o.x, t.z - o.z), at).toBeGreaterThan(2.2);
      for (const [x, z, r] of CLEAR) expect(Math.hypot(t.x - x, t.z - z), at).toBeGreaterThanOrEqual(r);
      expect(t.x > PLAZA.x0 - 1 && t.x < PLAZA.x1 + 1 && t.z > PLAZA.z0 - 1 && t.z < PLAZA.z1 + 1, `Pyramid plaza ${at}`).toBe(false);
      for (const b of OBSTACLES) expect(t.x > b.minX - 0.3 && t.x < b.maxX + 0.3 && t.z > b.minZ - 0.3 && t.z < b.maxZ + 0.3, `in a building ${at}`).toBe(false);
    }
  });

  it("stands in front of no house: stoops, entries and garages keep their sidewalk", () => {
    for (const t of all) {
      for (const h of CITY.houses) {
        const front = h.z + (h.facing * h.d) / 2;
        const along = Math.abs(t.x - h.x) < h.w / 2 + 0.4;
        const before = (t.z - front) * h.facing > -0.01 && (t.z - front) * h.facing < SIDEWALK + 0.3;
        expect(along && before, `${t.x},${t.z} before the house at ${h.x},${h.z}`).toBe(false);
      }
    }
  });

  it("blocks no chapter's view, desktop or phone", () => {
    for (const t of all) {
      const top = t.y + CROWN_TOP * t.s + 0.3;
      for (const c of chapters) {
        for (const { position: p, target: q } of [c.camera, c.phone]) {
          for (let s = 0; s <= 1.0001; s += 0.02) {
            const [x, y, z] = [0, 1, 2].map((i) => p[i] + (q[i] - p[i]) * s);
            expect(Math.hypot(x - t.x, z - t.z) < reachOf(t) + 1 && y < top, `${t.x},${t.z} in the ${c.id} shot`).toBe(false);
          }
        }
      }
    }
  });

  it("grows the city's street kinds, planes and ficus, and palms in the Mission", () => {
    expect(all.every((t) => t.kind === "plane" || t.kind === "ficus" || t.kind === "palm")).toBe(true);
    const palms = all.filter((t) => t.kind === "palm");
    expect(palms.length).toBeGreaterThanOrEqual(3);
    for (const t of palms) expect(t.x > -21 && t.x < 0 && t.z > 19, `palm at ${t.x},${t.z}`).toBe(true);
    expect(new Set(all.map(variantOf)).size).toBe(3);
  });

  it("costs little: every extra tree up close under 80k triangles, the phone half far under 12k", () => {
    const models = treeModels();
    const cost = (lod: "near" | "far", ts: typeof all) =>
      ts.reduce((n, t) => {
        const m = models[t.kind][variantOf(t)][lod];
        return n + triangles(m.bark) + triangles(m.leaves);
      }, 0);
    expect(cost("near", all)).toBeLessThan(80_000);
    expect(cost("far", all.filter((t) => t.lite))).toBeLessThan(12_000);
  });
});
