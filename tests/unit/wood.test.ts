import { BoxGeometry, MeshStandardMaterial } from "three";
import { describe, expect, it } from "vitest";
import { chamferBox, tagBoard, woodBoard, woodMaterial, WOOD_LOOKS } from "@/scene/wood";

describe("wood boards", () => {
  it("gives each board its own seed and tone, the same every time", () => {
    const boards = Array.from({ length: 200 }, (_, i) => woodBoard(i, 3));
    expect(Array.from({ length: 200 }, (_, i) => woodBoard(i, 3))).toEqual(boards);
    expect(new Set(boards.map((b) => b.seed.toFixed(6))).size).toBe(200);
    for (const b of boards) {
      expect(b.seed).toBeGreaterThanOrEqual(0);
      expect(b.seed).toBeLessThan(1);
      expect(b.tone).toBeGreaterThan(0.8);
      expect(b.tone).toBeLessThan(1.15);
    }
    expect(woodBoard(0, 1)).not.toEqual(woodBoard(0, 2));
  });

  it("tags every vertex with its board's centre, axis and seed", () => {
    const g = tagBoard(new BoxGeometry(1, 0.1, 0.2), [1, 2, 3], 2, { seed: 0.25, tone: 0.9 });
    const w = g.attributes.aWood;
    const c = g.attributes.color;
    expect(w.count).toBe(g.attributes.position.count);
    for (let i = 0; i < w.count; i++) {
      expect([w.getX(i), w.getY(i), w.getZ(i)]).toEqual([1, 2, 3]);
      expect(Math.floor(w.getW(i))).toBe(2);
      expect(w.getW(i) % 1).toBeCloseTo(0.25, 5);
      expect(c.getX(i)).toBeCloseTo(0.9, 5);
    }
  });
});

describe("chamferBox", () => {
  it("is a closed box with cut edges in 44 triangles", () => {
    const g = chamferBox(1, 0.2, 0.4, 0.02);
    expect(g.attributes.position.count / 3).toBe(44);
    expect(g.attributes.uv.count).toBe(g.attributes.position.count);
    g.computeBoundingBox();
    [-0.5, -0.1, -0.2].forEach((v, i) => expect(g.boundingBox!.min.getComponent(i)).toBeCloseTo(v, 6));
    [0.5, 0.1, 0.2].forEach((v, i) => expect(g.boundingBox!.max.getComponent(i)).toBeCloseTo(v, 6));
    // every face points outwards
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i += 3) {
      const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3;
      const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
      const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
      expect(cx * n.getX(i) + cy * n.getY(i) + cz * n.getZ(i)).toBeGreaterThan(0);
    }
  });
});

describe("woodMaterial", () => {
  it("on phones is a plain standard material with vertex colours (no new shader program)", () => {
    for (const look of Object.values(WOOD_LOOKS)) {
      const m = woodMaterial("#8a5a36", look, true);
      expect(m.constructor).toBe(MeshStandardMaterial);
      expect(m.onBeforeCompile).toBe(MeshStandardMaterial.prototype.onBeforeCompile);
      expect(m.customProgramCacheKey).toBe(MeshStandardMaterial.prototype.customProgramCacheKey);
      expect(m.vertexColors).toBe(true);
      expect(m.roughness).toBeGreaterThanOrEqual(look.rough[0]);
      expect(m.roughness).toBeLessThanOrEqual(look.rough[1]);
    }
  });

  it("on desktop shares one program for every look", () => {
    const keys = new Set(Object.values(WOOD_LOOKS).map((look) => woodMaterial("#8a5a36", look).customProgramCacheKey()));
    expect(keys.size).toBe(1);
  });
});
