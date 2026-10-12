import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { at, heightAt } from "@/lib/terrain";

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

  it("places spots on the ground", () => {
    expect(at(-14, 8, -10.4)[1]).toBeCloseTo(8 + heightAt(-14, -10.4));
    for (const c of chapters) expect(c.spot[1]).toBeGreaterThanOrEqual(heightAt(c.spot[0], c.spot[2]) - 1e-9);
  });

  it("Cuso stands on top of the rooftop at 06:00", () => {
    const s = spot("arrive");
    expect(s[1]).toBeCloseTo(8 + heightAt(-14, -10.4), 5);
  });
});
