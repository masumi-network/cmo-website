import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { MAX_STREET_GRADE, at, heightAt, surfaceAt } from "@/lib/terrain";
import { groundAt, insideLand } from "@/scene/grid";

const spot = (id: string) => chapters.find((c) => c.id === id)!.spot;

describe("terrain", () => {
  it("is flat far from the hills", () => {
    expect(heightAt(60, 60)).toBeCloseTo(0, 3);
  });

  it("puts the 06:00 rooftop on Russian Hill", () => {
    expect(heightAt(-14, -10.4)).toBeGreaterThan(3);
  });

  it("keeps the street-level places nearly flat (cable car rails, shop, wall, pier)", () => {
    for (const [x, z] of [[-9.6, 14.6], [-2.8, 29.6], [7, 9], [6, 4], [28, 4], [20.9, 3], [33.6, 24.2]]) {
      expect(heightAt(x, z), `${x},${z}`).toBeLessThan(0.25);
    }
  });

  it("keeps every street and sidewalk climbable (SF steep, never a wall)", () => {
    const e = 0.05;
    let steepest = 0;
    for (let x = -90; x <= 45; x += 0.5) {
      for (let z = -60; z <= 52; z += 0.5) {
        const kind = groundAt(x, z);
        if (!insideLand(x, z) || (kind !== "street" && kind !== "sidewalk")) continue;
        const grade = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
        expect(grade, `grade at ${x},${z}`).toBeLessThan(MAX_STREET_GRADE);
        steepest = Math.max(steepest, grade);
      }
    }
    expect(steepest).toBeGreaterThan(0.2); // the streets do climb hills
  });

  it("gives each named hill a real summit", () => {
    // Russian Hill, Nob Hill, Telegraph Hill, Pacific Heights, Twin Peaks (both peaks).
    for (const [x, z, min] of [[-15, -13, 3.5], [-3, 6, 1.6], [2, -26, 4], [-47, -22, 2.8], [-40.5, 34, 4.5], [-30, 34.5, 4.3]]) {
      let top = { h: -1, d: 0 };
      for (let dx = -4; dx <= 4; dx += 0.25)
        for (let dz = -4; dz <= 4; dz += 0.25) if (heightAt(x + dx, z + dz) > top.h) top = { h: heightAt(x + dx, z + dz), d: Math.hypot(dx, dz) };
      expect(top.h, `${x},${z}`).toBeGreaterThan(min);
      expect(top.d, `${x},${z} summit inside the window`).toBeLessThan(3.5);
    }
  });

  it("places spots on the ground", () => {
    expect(at(-14, 8, -10.4)[1]).toBeCloseTo(8 + heightAt(-14, -10.4));
    for (const c of chapters) expect(c.spot[1]).toBeGreaterThanOrEqual(surfaceAt(c.spot[0], c.spot[2]) - 1e-9);
  });

  it("Cuso stands on top of the rooftop at 06:00", () => {
    const s = spot("arrive");
    expect(s[1]).toBeCloseTo(8 + heightAt(-14, -10.4), 5);
  });
});
