import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { surfaceAt } from "@/lib/terrain";
import { insideLand } from "@/scene/grid";
import { generateCity } from "@/scene/layout";
import { DAY_LENGTH, LEG_START, PATHS, dayDistance, sampleDay, samplePath } from "@/scene/routes";

const city = generateCity();
const buildings = [...city.houses, ...city.towers];
const near = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;

describe("Cuso's walking routes", () => {
  it("has one route per move between chapters", () => {
    expect(PATHS.length).toBe(chapters.length - 1);
  });

  it.each(PATHS.map((p, i) => [chapters[i].id, chapters[i + 1].id, p] as const))("%s → %s starts and ends on the spots", (_a, _b, path) => {
    const i = PATHS.indexOf(path);
    expect(near(samplePath(path, 0).pos, chapters[i].spot)).toBe(true);
    expect(near(samplePath(path, 1).pos, chapters[i + 1].spot)).toBe(true);
  });

  it("walks on land or on the pier, on the ground, and never through a building", () => {
    for (const path of PATHS) {
      for (let k = 0; k <= 400; k++) {
        const { pos, mode } = samplePath(path, k / 400);
        if (mode === "jump") continue; // mid-air
        const [x, y, z] = pos;
        const onPier = x > 30.5 && x < 41 && z > 21.8 && z < 26.2;
        expect(insideLand(x, z) || onPier, `${x},${z}`).toBe(true);
        expect(y).toBeGreaterThanOrEqual(surfaceAt(x, z) - 1e-6);
        for (const b of buildings) {
          const inside = Math.abs(x - b.x) < b.w / 2 + 0.3 && Math.abs(z - b.z) < b.d / 2 + 0.3 && y < b.y + b.h;
          expect(inside, `walks into building at ${b.x},${b.z}`).toBe(false);
        }
      }
    }
  });

  it("moves smoothly (no teleports)", () => {
    for (const path of PATHS) {
      let prev = samplePath(path, 0).pos;
      for (let k = 1; k <= 1000; k++) {
        const { pos } = samplePath(path, k / 1000);
        expect(Math.hypot(pos[0] - prev[0], pos[2] - prev[2])).toBeLessThan(path.length / 1000 + 0.2);
        prev = pos;
      }
    }
  });

  it("walks near the places and dashes only in the middle of long street stretches", () => {
    for (const path of PATHS) {
      expect(samplePath(path, 0.002).mode).not.toBe("dash");
      expect(samplePath(path, 0.998).mode).not.toBe("dash");
    }
    expect(PATHS.some((p) => p.modes.includes("dash"))).toBe(true);
  });

  it("lays every move on one line through the day", () => {
    expect(LEG_START[0]).toBe(0);
    expect(DAY_LENGTH).toBeCloseTo(PATHS.reduce((s, p) => s + p.length, 0));
    expect(dayDistance(2, 0)).toBe(LEG_START[2]);
    expect(dayDistance(chapters.length - 1, 0)).toBe(DAY_LENGTH);
    const mid = sampleDay(LEG_START[3] + 1);
    expect(mid.leg).toBe(3);
    expect(near(sampleDay(DAY_LENGTH).pos, chapters[chapters.length - 1].spot)).toBe(true);
  });
});
