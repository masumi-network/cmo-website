import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { largestGap } from "@/scene/camera-rig";
import { insideBuilding } from "@/scene/layout";

describe("phone framing", () => {
  it("finds the biggest free stretch between the top bar and the cards", () => {
    // top bar 0..76, two cards stacked at the bottom of an 844 px screen
    expect(largestGap([[0, 76], [449, 630], [642, 829]], 844)).toEqual([76, 449]);
    // hero: bar, text and form on top, the scroll button at the bottom
    expect(largestGap([[0, 76], [96, 478], [770, 818]], 844)).toEqual([478, 770]);
    // overlapping and unsorted edges
    expect(largestGap([[500, 900], [0, 80], [60, 120]], 844)).toEqual([120, 500]);
    // nothing in the way
    expect(largestGap([], 600)).toEqual([0, 600]);
  });

  it("every chapter has a phone shot that starts outside buildings", () => {
    for (const c of chapters) expect(insideBuilding(...c.phone.position), c.id).toBe(false);
  });
});
