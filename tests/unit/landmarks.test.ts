import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { PYRAMID, SPIRE, box, cyl, merged, pyramidHalf } from "@/scene/landmarks";
import { STREET } from "@/scene/layout";

describe("landmark parts", () => {
  it("merges boxes and cylinders into one geometry that spans them all", () => {
    const g = merged([box([0, 0.5, 0], [1, 1, 1]), box([3, 1, 0], [1, 2, 1], [0, Math.PI / 4, 0]), cyl([-2, 2, 0], 0.2, 0.2, 4)]);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    expect(b.min.x).toBeCloseTo(-2.2, 1);
    expect(b.max.x).toBeCloseTo(3 + Math.SQRT1_2, 2);
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(4);
    expect(g.index).toBeNull();
  });

  it("tapers the pyramid from its base to Cuso's platform, with the spire beside him", () => {
    expect(pyramidHalf(0)).toBeCloseTo(PYRAMID.base);
    // the flat top of the crown is where Cuso stands: 28 above the ground (PYRAMID_TIP in day.ts)
    expect(PYRAMID.height).toBe(28);
    expect(pyramidHalf(PYRAMID.height)).toBeCloseTo(PYRAMID.top);
    expect(PYRAMID.top).toBeGreaterThan(0.5);
    // the spire rises just past the platform's edge (Cuso turns on the platform without touching it)
    // and starts inside the body, so it never floats
    const reach = Math.max(Math.abs(SPIRE.x), Math.abs(SPIRE.z));
    expect(reach - SPIRE.half).toBeGreaterThan(PYRAMID.top);
    expect(reach + SPIRE.half).toBeLessThan(pyramidHalf(SPIRE.base));
  });

  it("keeps the pyramid's base off the streets on either side (cars drive at z -16)", () => {
    const centreZ = -11;
    expect(centreZ - PYRAMID.base).toBeGreaterThan(-16 + STREET / 2);
    expect(centreZ + PYRAMID.base).toBeLessThan(-6 - STREET / 2);
  });
});
