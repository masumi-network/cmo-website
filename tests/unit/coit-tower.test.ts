import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { COIT, coitSeat } from "@/scene/coit-tower";
import { CLEAR, PARKS } from "@/scene/layout";

/** Points on a fine grid inside radius r around the tower. */
function disc(r: number) {
  const out: [number, number][] = [];
  for (let dx = -r; dx <= r; dx += 0.05) for (let dz = -r; dz <= r; dz += 0.05) if (Math.hypot(dx, dz) <= r) out.push([COIT.x + dx, COIT.z + dz]);
  return out;
}

describe("Coit Tower on Telegraph Hill", () => {
  const seat = coitSeat();

  it("has a level plaza that the hill never pokes through", () => {
    for (const [x, z] of disc(COIT.plaza)) expect(heightAt(x, z)).toBeLessThanOrEqual(seat.top);
  });

  it("sits on the summit, not floating above it", () => {
    expect(seat.top - heightAt(COIT.x, COIT.z)).toBeLessThan(0.1);
  });

  it("hides the plaza wall's foot in the hill all the way round, so it never floats", () => {
    for (const [x, z] of disc(COIT.plaza + 0.04)) expect(heightAt(x, z) - seat.bottom).toBeGreaterThan(0.3);
  });

  it("keeps the lobby inside the plaza wall", () => {
    expect((COIT.lobby.w / 2) * Math.SQRT2).toBeLessThan(COIT.plaza - COIT.parapet.t);
  });

  it("stands in Pioneer Park, inside its clear lawn", () => {
    const [x0, x1, z0, z1] = PARKS.find(([a, b, c, d]) => COIT.x > a && COIT.x < b && COIT.z > c && COIT.z < d)!;
    expect(COIT.x - COIT.plaza).toBeGreaterThan(x0);
    expect(COIT.x + COIT.plaza).toBeLessThan(x1);
    expect(COIT.z - COIT.plaza).toBeGreaterThan(z0);
    expect(COIT.z + COIT.plaza).toBeLessThan(z1);
    const clear = CLEAR.find(([x, z]) => x === COIT.x && z === COIT.z);
    expect(clear?.[2]).toBeGreaterThan(COIT.plaza + 0.5);
  });
});
