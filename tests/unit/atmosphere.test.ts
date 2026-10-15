import { describe, expect, it } from "vitest";
import { fogRange, overhead } from "@/scene/atmosphere";

describe("distance fog", () => {
  it("is today's in every story shot (6 to 36 m from what the camera looks at)", () => {
    for (const d of [6, 12, 36, 50]) expect(fogRange(d, false)).toEqual({ near: 70, far: 340 });
  });

  it("is Explore's far fog in Explore, at any zoom", () => {
    for (const d of [40, 95, 215]) expect(fogRange(d, true)).toEqual({ near: 260, far: 900 });
  });

  it("eases from Explore's to the story's as the camera comes down after a pin (it switched at once: a white haze over the city)", () => {
    expect(fogRange(170, false)).toEqual({ near: 260, far: 900 });
    const mid = fogRange(85, false);
    expect(mid.near).toBeGreaterThan(70);
    expect(mid.near).toBeLessThan(260);
    expect(fogRange(70, false).near).toBeLessThan(mid.near);
  });
});

describe("how far above the story the camera is", () => {
  it("is 0 in every story shot and 1 from Explore's height, easing between (Karl the fog bank fades in by it)", () => {
    expect(overhead(36)).toBe(0);
    expect(overhead(50)).toBe(0);
    expect(overhead(170)).toBe(1);
    expect(overhead(85)).toBeGreaterThan(0);
    expect(overhead(85)).toBeLessThan(1);
  });
});
