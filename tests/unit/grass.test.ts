import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { COIT } from "@/scene/coit-tower";
import { groundAt, inPark } from "@/scene/grid";
import { CITY } from "@/scene/layout";
import { LAWN, TRAILS, lawnField, lawnTexture, onTrail } from "@/scene/lawn";
import { GRASS_BUDGET, TUFT_BLADES, grassTufts, parkStones, tuftGeometry } from "@/scene/grass";
import { PATHS } from "@/scene/routes";

const full = grassTufts(false);
const lite = grassTufts(true);
const stones = parkStones();

/** Distance from x,z to Cuso's walking lines (every route polyline). */
const toRoute = (x: number, z: number) => {
  let best = Infinity;
  for (const { points } of PATHS) {
    for (let i = 1; i < points.length; i++) {
      const [ax, , az] = points[i - 1];
      const [bx, , bz] = points[i];
      const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
      best = Math.min(best, Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az)));
    }
  }
  return best;
};

/** Everything a blade or stone must stay off, for something of radius r at x,z. */
function expectClear(x: number, z: number, r: number, what: string) {
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) expect(groundAt(x + dx, z + dz), `${what} at ${x},${z}`).toBe("grass");
  expect(onTrail(x, z, r), `${what} on a trail at ${x},${z}`).toBe(false);
  expect(Math.hypot(x - COIT.x, z - COIT.z), `${what} on Coit's plaza at ${x},${z}`).toBeGreaterThan(COIT.plaza + 0.25 + r);
  for (const t of CITY.trees) expect(Math.hypot(x - t.x, z - t.z), `${what} in a trunk at ${x},${z}`).toBeGreaterThan(0.18 * t.s + r);
  expect(toRoute(x, z), `${what} on Cuso's route at ${x},${z}`).toBeGreaterThan(0.8);
  for (const c of chapters) expect(Math.hypot(x - c.spot[0], z - c.spot[2]), `${what} on a spot`).toBeGreaterThan(1);
}

describe("park trails and the lawn field", () => {
  it("keeps every trail on park grass and away from Coit Tower's plaza", () => {
    for (const { points, width } of TRAILS) {
      expect(points.length).toBeGreaterThan(4);
      for (const [x, z] of points) {
        expect(inPark(x, z) || inPark(x * 0.999 + 0.001, z), `trail at ${x},${z}`).toBe(true);
        expect(Math.hypot(x - COIT.x, z - COIT.z) - width / 2, `trail on the plaza at ${x},${z}`).toBeGreaterThan(COIT.plaza + 0.1);
      }
    }
  });

  it("is zero off the parks and in range everywhere", () => {
    expect(lawnField(-3, 4)).toEqual([0, 0, 0, 0]); // a junction
    for (let x = LAWN.x0; x < LAWN.x0 + LAWN.size; x += 0.7) {
      for (let z = LAWN.z0; z < LAWN.z0 + LAWN.size; z += 0.7) {
        const f = lawnField(x, z);
        for (const v of f) expect(v >= 0 && v <= 1, `${x},${z}: ${f}`).toBe(true);
        if (!inPark(x, z)) expect(f).toEqual([0, 0, 0, 0]);
      }
    }
  });

  it("bakes the field into a texture once, trails bright", () => {
    const t = lawnTexture();
    expect(lawnTexture()).toBe(t);
    const { width, height, data } = t.image as { width: number; height: number; data: Uint8Array };
    expect(width).toBe(LAWN.size * LAWN.px);
    expect(height).toBe(width);
    const [x, z] = TRAILS[0].points[Math.floor(TRAILS[0].points.length / 2)];
    const i = Math.floor((z - LAWN.z0) * LAWN.px) * width + Math.floor((x - LAWN.x0) * LAWN.px);
    expect(data[i * 4]).toBeGreaterThan(200);
  });
});

describe("grass blades", () => {
  it("grows only on park grass: never on a street, sidewalk, trail, plaza, trunk or Cuso's way", () => {
    for (const t of full) expectClear(t.x, t.z, t.spread, "tuft");
  }, 20_000); // checks every tuft against every solid: slow when the whole suite runs in parallel

  it("stands on the ground and holds only finite numbers", () => {
    for (const t of full) {
      for (const v of Object.values(t)) expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(t.y - heightAt(t.x, t.z))).toBeLessThan(0.03);
      expect(t.h).toBeGreaterThan(0.03);
      expect(t.h).toBeLessThan(0.5);
      expect(t.ny).toBeGreaterThan(0.7);
    }
    const g = tuftGeometry();
    expect(Array.from(g.attributes.position.array).every(Number.isFinite)).toBe(true);
  });

  it("stays within the triangle budget, with far fewer on phones", () => {
    const g = tuftGeometry();
    expect((g.index?.count ?? g.attributes.position.count) / 3).toBe(TUFT_BLADES);
    expect(full.length * TUFT_BLADES).toBeLessThanOrEqual(GRASS_BUDGET);
    expect(full.length * TUFT_BLADES).toBeGreaterThan(GRASS_BUDGET * 0.5);
    expect(lite.length).toBeLessThanOrEqual(full.length / 3);
  });

  it("covers every park, and is the same on every visit", () => {
    for (const [px, pz] of [[-50, 19], [-35, 30], [6, -21], [-11, 39]]) expect(full.some((t) => Math.hypot(t.x - px, t.z - pz) < 3), `${px},${pz}`).toBe(true);
    expect(grassTufts(false)).toEqual(full);
  });
});

describe("rocks and shrubs", () => {
  it("sit on park grass, off trails, plaza, trunks and Cuso's way", () => {
    expect(stones.rocks.length).toBeGreaterThan(8);
    expect(stones.shrubs.length).toBeGreaterThan(20);
    for (const s of [...stones.rocks, ...stones.shrubs]) {
      for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
      expectClear(s.x, s.z, s.s, "stone");
    }
  });

  it("puts rock outcrops near the Twin Peaks summits", () => {
    for (const [px, pz] of [[-40.5, 34], [-30, 34.5]]) expect(stones.rocks.filter((r) => Math.hypot(r.x - px, r.z - pz) < 3).length).toBeGreaterThanOrEqual(3);
  });
});
