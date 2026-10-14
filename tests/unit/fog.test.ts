import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { FOG_DEPTH, LAYER_Y, bakeFog, fogDepthAt, fogTint } from "@/scene/fog";
import { insideLand } from "@/scene/grid";
import { GG } from "@/scene/landmarks";

const map = bakeFog();

describe("Karl the fog", () => {
  it("is pale by day, warm at sunset and blue-grey at night", () => {
    expect(fogTint(6)).toBe("#fbf8f2");
    expect(fogTint(12)).toBe("#fbf8f2");
    expect(fogTint(18)).toBe("#f1c6a2");
    expect(fogTint(22)).toBe("#3c4260");
    expect(fogTint(30)).toBe("#fbf8f2");
    // in between it blends, so a scroll never makes it jump
    expect(fogTint(20)).not.toBe("#f1c6a2");
    expect(fogTint(20)).not.toBe("#3c4260");
  });

  it("never reaches a chapter spot, a chapter camera or the city", () => {
    for (const c of chapters) {
      for (const [x, , z] of [c.spot, c.camera.position, c.phone.position]) expect(fogDepthAt(map, x, z), `${c.id} ${x},${z}`).toBe(0);
    }
    for (let x = -64; x < 30; x += 4) for (let z = -30; z < 46; z += 4) if (insideLand(x, z)) expect(fogDepthAt(map, x, z), `${x},${z}`).toBe(0);
  });

  it("fills the ocean and rolls in under the Golden Gate, round its north tower", () => {
    expect(fogDepthAt(map, -150, -90)).toBeCloseTo(FOG_DEPTH);
    expect(fogDepthAt(map, GG.x - 12, -100)).toBeGreaterThan(FOG_DEPTH * 0.6);
    expect(fogDepthAt(map, GG.x, GG.towers[1])).toBeGreaterThan(FOG_DEPTH * 0.6);
    // gone well inside the bay
    expect(fogDepthAt(map, -30, -100)).toBe(0);
  });

  it("stays under the deck", () => {
    expect(LAYER_Y[1]).toBeLessThan(GG.deck - 1.5);
  });

  it("is thin straight behind Cuso in the 06:00 shot, this side of the bridge", () => {
    const { camera, spot } = chapters[0];
    const [cx, , cz] = camera.position;
    const len = Math.hypot(spot[0] - cx, spot[2] - cz);
    const [dx, dz] = [(spot[0] - cx) / len, (spot[2] - cz) / len];
    for (let t = len; ; t += 2) {
      const x = cx + dx * t;
      const z = cz + dz * t;
      if (x < GG.x) break;
      expect(fogDepthAt(map, x, z), `${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThan(FOG_DEPTH * 0.35);
    }
  });
});
