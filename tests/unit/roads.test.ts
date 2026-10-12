import { describe, expect, it } from "vitest";
import { X_STREETS, Z_STREETS } from "@/scene/grid";
import { ROADS } from "@/scene/roads";

const onStreet = (x: number, z: number) => X_STREETS.some((s) => Math.abs(s - x) < 1.6) || Z_STREETS.some((s) => Math.abs(s - z) < 1.6);

describe("roads to the bridges", () => {
  it("has the Golden Gate approaches and the Bay Bridge ramp", () => {
    expect(ROADS.map((r) => r.name).sort()).toEqual(["bay-bridge-ramp", "golden-gate-north", "golden-gate-south"]);
  });

  it.each(ROADS)("$name starts on its bridge deck", (road) => {
    const [x, y, z] = road.points[0];
    expect(y).toBeCloseTo(7, 1);
    expect(road.deckEnd).toEqual([x, z]);
  });

  it.each(ROADS.filter((r) => r.name !== "golden-gate-north"))("$name lands on a city street", (road) => {
    const [x, y, z] = road.points[road.points.length - 1];
    expect(onStreet(x, z)).toBe(true);
    expect(y - road.ground(x, z)).toBeLessThan(0.2);
  });

  it.each(ROADS)("$name never goes under the ground and stays drivable", (road) => {
    for (let i = 1; i < road.points.length; i++) {
      const [x0, y0, z0] = road.points[i - 1];
      const [x, y, z] = road.points[i];
      expect(y).toBeGreaterThanOrEqual(road.ground(x, z) - 1e-6);
      expect(Math.abs(y - y0) / Math.hypot(x - x0, z - z0)).toBeLessThan(0.45);
    }
  });
});
