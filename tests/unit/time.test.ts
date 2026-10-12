import { describe, expect, it } from "vitest";
import { activeIndex, lightingAt, mixHex, travel } from "@/lib/time";

describe("travel", () => {
  it("rests on a chapter for the first part of its section", () => {
    expect(travel(2, 8)).toEqual({ from: 2, to: 3, t: 0 });
    expect(travel(2.3, 8).t).toBe(0);
  });

  it("moves to the next chapter by the end of the section", () => {
    const mid = travel(2.7, 8);
    expect(mid.from).toBe(2);
    expect(mid.to).toBe(3);
    expect(mid.t).toBeGreaterThan(0);
    expect(mid.t).toBeLessThan(1);
    expect(travel(2.99, 8).t).toBeGreaterThan(0.95);
  });

  it("clamps outside the day", () => {
    expect(travel(-1, 8)).toEqual({ from: 0, to: 1, t: 0 });
    expect(travel(42, 8)).toEqual({ from: 7, to: 7, t: 0 });
  });
});

describe("activeIndex", () => {
  it("switches to the next chapter halfway through travel", () => {
    expect(activeIndex(2.1, 8)).toBe(2);
    expect(activeIndex(2.99, 8)).toBe(3);
    expect(activeIndex(100, 8)).toBe(7);
  });
});

describe("mixHex", () => {
  it("blends two colors", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("lightingAt", () => {
  it("is bright at noon and dark at night", () => {
    expect(lightingAt(12).night).toBe(0);
    expect(lightingAt(22).night).toBe(1);
    expect(lightingAt(12).sunIntensity).toBeGreaterThan(lightingAt(22).sunIntensity);
  });

  it("puts the sun high at noon and low at sunrise", () => {
    expect(lightingAt(12).elevation).toBeGreaterThan(lightingAt(6).elevation);
  });

  it("wraps past midnight to the next morning", () => {
    expect(lightingAt(30)).toEqual(lightingAt(6));
    expect(lightingAt(26).night).toBeGreaterThan(0);
  });
});
