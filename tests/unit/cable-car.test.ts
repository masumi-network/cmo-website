import { Box3, MeshStandardMaterial, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { CAR, GAUGE, carGeometry, carMaterials } from "@/scene/cable-car";
import { STREET } from "@/scene/grid";

describe("cable car", () => {
  it("fits its street and stands on the rails", () => {
    const parts = carGeometry();
    const bounds = new Box3();
    for (const g of Object.values(parts)) {
      g.computeBoundingBox();
      expect(g.attributes.position.count).toBeGreaterThan(0);
      expect(Number.isFinite(g.boundingBox!.min.x)).toBe(true);
      bounds.union(g.boundingBox!);
    }
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(CAR.length, 1);
    expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(CAR.width + 0.02);
    expect(CAR.width).toBeLessThan(STREET - 0.5);
    expect(bounds.max.y).toBeLessThanOrEqual(CAR.height);
    // Wheels rest on the rail tops, gauge inside the body.
    expect(bounds.min.y).toBeGreaterThan(0.015);
    expect(bounds.min.y).toBeLessThan(0.03);
    expect(GAUGE).toBeLessThan(CAR.width / 2);
  });
});

describe("cable car finish", () => {
  const parts = carGeometry();
  const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

  it("stays within its triangle budget (chamfers and slats on the hero car only)", () => {
    const total = Object.values(parts).reduce((sum, g) => sum + tris(g), 0);
    expect(total).toBeLessThan(16_000);
  });

  it("bakes contact shade into the vertex colours of every solid part", () => {
    for (const k of ["maroon", "cream", "gold", "dark", "wood", "roof"] as const) {
      const c = parts[k].attributes.color;
      expect(parts[k].attributes.aWood.count).toBe(c.count);
      let min = 1;
      for (let i = 0; i < c.count; i++) {
        expect(c.getX(i)).toBeGreaterThanOrEqual(0.2);
        expect(c.getX(i)).toBeLessThanOrEqual(1.15);
        min = Math.min(min, c.getX(i));
      }
      if (k === "wood") expect(min).toBeLessThan(0.6); // under the benches and in the floor joints
    }
  });

  it("on phones uses plain standard materials (no new shader program) and the shop glass", () => {
    const m = carMaterials(true);
    for (const k of ["maroon", "cream", "gold", "dark", "wood", "roof"] as const) {
      expect(m[k].constructor).toBe(MeshStandardMaterial);
      expect(m[k].onBeforeCompile).toBe(MeshStandardMaterial.prototype.onBeforeCompile);
      expect(m[k].vertexColors).toBe(true);
      expect(m[k].map).toBeNull();
    }
    expect(m.glass.customProgramCacheKey()).toBe("shop-glass");
    expect(new Set(["maroon", "cream", "gold", "dark", "wood", "roof"].map((k) => carMaterials(false)[k as "wood"].customProgramCacheKey())).size).toBe(1);
  });
});
