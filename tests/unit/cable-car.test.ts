import { Box3 } from "three";
import { describe, expect, it } from "vitest";
import { CAR, GAUGE, carGeometry } from "@/scene/cable-car";
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
