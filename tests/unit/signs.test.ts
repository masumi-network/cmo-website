import { describe, expect, it } from "vitest";
import { ROUTE_BOARD } from "@/scene/cable-car";
import { AD_PANEL } from "@/scene/landmarks";
import { SHOP_SIGN } from "@/scene/shop";
import { signSize } from "@/scene/textures";

describe("brand signs", () => {
  it("draw on a canvas with the same shape as their panel, so text is never stretched", () => {
    for (const [panel, width] of [[AD_PANEL, 1024], [SHOP_SIGN, 1024], [ROUTE_BOARD, 1536]] as const) {
      const [w, h] = signSize(panel, width);
      expect(w / h).toBeCloseTo(panel[0] / panel[1], 1);
    }
  });
});
