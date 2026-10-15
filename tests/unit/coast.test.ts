import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BEACH_W,
  COAST_PATH,
  EXPOSURE,
  KEEP_CLEAR,
  LANDS_END,
  OCEAN_BEACH,
  ROCKS,
  ROCK_RADIUS,
  ROCK_TOP,
  SURF,
  SURF_GLSL,
  WATER_Y as COAST_WATER_Y,
  coastAt,
  coastGeometry,
  coastHeight,
  coastSurface,
  liteRocks,
  surfExposure,
  wallTop,
} from "@/scene/coast";
import { GG } from "@/scene/landmarks";
import { ROUTES, WATER_Y, bakeShore, boatAt, shoreDistance, track } from "@/scene/bay";
import { ROADS, piers } from "@/scene/roads";
import { insideLand } from "@/scene/grid";

const shore = bakeShore();
const plain = bakeShore(false);

/** A point d out from the shore (into the sea) at arc length s along the ocean shore. */
function out(s: number, d: number): [number, number] {
  let i = 1;
  let acc = 0;
  for (; i < COAST_PATH.length; i++) {
    const l = Math.hypot(COAST_PATH[i][0] - COAST_PATH[i - 1][0], COAST_PATH[i][1] - COAST_PATH[i - 1][1]);
    if (acc + l >= s) break;
    acc += l;
  }
  const [ax, az] = COAST_PATH[i - 1];
  const [bx, bz] = COAST_PATH[i];
  const l = Math.hypot(bx - ax, bz - az);
  const t = (s - acc) / l;
  // inland normal is (az - bz, bx - ax) / l
  return [ax + (bx - ax) * t - ((az - bz) / l) * d, az + (bz - az) * t - ((bx - ax) / l) * d];
}

describe("the ocean shore", () => {
  it("uses the water's level", () => expect(COAST_WATER_Y).toBe(WATER_Y));

  it("measures from the shore line, positive on the water", () => {
    const [x, z] = out(30, 2);
    expect(coastAt(x, z).d).toBeCloseTo(2, 3);
    expect(coastAt(...out(30, -1)).d).toBeCloseTo(-1, 3);
  });

  it("has Ocean Beach the whole length of the west shore: dry sand past the wall", () => {
    for (let s = OCEAN_BEACH.from + OCEAN_BEACH.fade; s <= OCEAN_BEACH.to - OCEAN_BEACH.fade; s += 2) {
      const [x, z] = out(s, 1.2);
      const p = coastSurface(x, z);
      expect(p, `${x},${z}`).not.toBeNull();
      expect(p!.rock, `${x},${z}`).toBe(false);
      expect(p!.y, `${x},${z}`).toBeGreaterThan(WATER_Y + 0.1);
    }
  });

  it("keeps the sea wall on the bay shores (Marina, Embarcadero, south shore)", () => {
    for (const [x, z] of [[-40, -37.5], [-60, -45], [33, 0], [33, -20], [-20, 49], [10, 49.5], [-45, 48]]) {
      expect(insideLand(x, z), `${x},${z}`).toBe(false);
      expect(coastHeight(x, z), `${x},${z}`).toBe(-Infinity);
      expect(shoreDistance(shore, x, z), `${x},${z}`).toBeCloseTo(shoreDistance(plain, x, z), 2);
    }
  });

  describe("Ocean Beach", () => {
    const full = Array.from({ length: 30 }, (_, i) => OCEAN_BEACH.from + OCEAN_BEACH.fade + (i * (OCEAN_BEACH.to - OCEAN_BEACH.from - 2 * OCEAN_BEACH.fade)) / 29);
    it("is flush with the top of the wall and under water by BEACH_W", () => {
      for (const s of full) {
        const [x, z] = out(s, 0);
        const [wx, wz] = out(s, BEACH_W);
        expect(coastHeight(x, z), `${s}`).toBeCloseTo(wallTop(x, z) - 0.02, 2);
        expect(coastHeight(wx, wz), `${s}`).toBeLessThan(WATER_Y - 0.2);
      }
    });
    it("is never steeper than 0.3 (along the shore: past the wall, where a street's end may lower it a kerb)", () => {
      for (const s of full) {
        for (let d = 0; d < BEACH_W + 1; d += 0.25) {
          const y = coastHeight(...out(s, d));
          expect(Math.abs(coastHeight(...out(s, d + 0.1)) - y) / 0.1, `across ${s},${d}`).toBeLessThan(0.3);
          if (d >= 1) expect(Math.abs(coastHeight(...out(s + 0.1, d)) - y) / 0.1, `along ${s},${d}`).toBeLessThan(0.3);
        }
      }
    });
    it("buries the wall's rounded lip (0.18 down 0.42 out, 0.6 down 0.6 out)", () => {
      for (const s of full) {
        const top = wallTop(...out(s, 0));
        expect(coastHeight(...out(s, 0.42)), `${s}`).toBeGreaterThan(top - 0.18);
        expect(coastHeight(...out(s, 0.6)), `${s}`).toBeGreaterThan(top - 0.6);
      }
    });
  });

  describe("Lands End", () => {
    // (the rock's edge wanders 2.5 either way along the shore)
    const rocky = Array.from({ length: 40 }, (_, i) => LANDS_END.from + LANDS_END.fade + 2.5 + (i * (LANDS_END.to - LANDS_END.from - 2 * LANDS_END.fade - 2.5)) / 39);
    it("drops into the sea in rock, within a few units of the wall", () => {
      for (const s of rocky) {
        const p = coastSurface(...out(s, 0.3));
        expect(p?.rock, `${s}`).toBe(true);
        let wet = Infinity;
        for (let d = 0; d < 6; d += 0.25) if (coastHeight(...out(s, d)) < WATER_Y) wet = Math.min(wet, d);
        expect(wet, `${s}`).toBeLessThan(4.5);
        expect(wet, `${s}`).toBeGreaterThan(0.4);
      }
    });
    it("never stands higher than the land behind it, and covers the wall's lip", () => {
      for (const s of rocky) {
        const top = wallTop(...out(s, 0));
        for (let d = 0; d < 6; d += 0.2) {
          const [x, z] = out(s, d);
          const p = coastSurface(x, z);
          if (p) expect(p.y, `${s},${d}`).toBeLessThanOrEqual(p.top - 0.02 + 1e-9);
        }
        expect(coastHeight(...out(s, 0.42)), `${s}`).toBeGreaterThan(top - 0.18);
      }
    });
    it("has boulders on it no taller than the land behind them", () => {
      const boulders = ROCKS.filter((r) => !r.stack);
      expect(boulders.length).toBeGreaterThan(25);
      for (const r of boulders) {
        const p = coastSurface(r.x, r.z);
        expect(p, `${r.x},${r.z}`).not.toBeNull();
        expect(r.y + r.s * r.tall * ROCK_TOP, `${r.x},${r.z}`).toBeLessThanOrEqual(p!.top);
        expect(r.y, `${r.x},${r.z}`).toBeLessThan(Math.max(p!.y, WATER_Y)); // sits in the ground or the water
      }
    });
  });

  describe("rocks", () => {
    it("include Seal Rocks off the beach's north end and Mile Rock off Lands End, standing out of the water", () => {
      const stacks = ROCKS.filter((r) => r.stack && r.tall > 1.5 && r.y < WATER_Y);
      expect(stacks.length).toBe(4);
      for (const r of stacks) {
        expect(coastAt(r.x, r.z).d, `${r.x},${r.z}`).toBeGreaterThan(4.5);
        expect(r.y + r.s * r.tall * ROCK_TOP, `${r.x},${r.z}`).toBeGreaterThan(WATER_Y + 0.4);
      }
    });
    it("stand clear of every boat route, the Golden Gate's piers and its south road", () => {
      for (const route of ROUTES) {
        const t = track(route);
        const p = { x: 0, z: 0, heading: 0 };
        for (let s = 0; s < t.period; s += 0.5) {
          boatAt(t, s, p);
          for (const r of ROCKS) expect(Math.hypot(p.x - r.x, p.z - r.z) - r.s * ROCK_RADIUS, `${route.name} ${r.x},${r.z}`).toBeGreaterThan(3);
        }
      }
      const road = ROADS.find((r) => r.name === "golden-gate-south")!;
      const posts = [...road.points.map(([x, , z]) => [x, z, 1.6]), ...piers(road).map(([x, z]) => [x, z, 0.6]), ...GG.towers.map((z) => [GG.x, z, 3.2]), [GG.x, GG.south, 2.4]];
      for (const r of ROCKS) for (const [x, z, w] of posts) expect(Math.hypot(r.x - x, r.z - z) - r.s * ROCK_RADIUS, `${r.x},${r.z}`).toBeGreaterThan(w);
      for (const r of ROCKS) for (const [x, z, w] of KEEP_CLEAR) expect(Math.hypot(r.x - x, r.z - z), `${r.x},${r.z}`).toBeGreaterThan(w);
    });
    it("never stand on the land", () => {
      for (const r of ROCKS) expect(insideLand(r.x, r.z), `${r.x},${r.z}`).toBe(false);
    });
    it("lite keeps the stacks and about half the boulders", () => {
      const lite = liteRocks(ROCKS);
      expect(lite.filter((r) => r.stack)).toHaveLength(ROCKS.filter((r) => r.stack).length);
      expect(lite.length).toBeLessThan(ROCKS.length * 0.8);
    });
  });

  describe("the shore field (where the water's foam starts)", () => {
    it("knows the beach: land out to the new water line, foam from there", () => {
      for (let s = OCEAN_BEACH.from + OCEAN_BEACH.fade; s <= LANDS_END.from; s += 4) {
        expect(shoreDistance(shore, ...out(s, 1.5)), `${s}`).toBeLessThan(0);
        let line = 0;
        for (let d = 0; d < 6; d += 0.05) if (coastHeight(...out(s, d)) > WATER_Y) line = d;
        expect(Math.abs(shoreDistance(shore, ...out(s, line))), `${s}`).toBeLessThan(0.35);
        expect(shoreDistance(shore, ...out(s, line + 3)), `${s}`).toBeCloseTo(3, 0);
      }
    });
    it("knows the rocks: foam rings round the stacks", () => {
      for (const r of ROCKS.filter((q) => q.stack && q.tall > 1.5 && q.y < WATER_Y)) {
        expect(shoreDistance(shore, r.x, r.z), `${r.x},${r.z}`).toBeLessThan(0);
        expect(shoreDistance(plain, r.x, r.z), `${r.x},${r.z}`).toBeGreaterThan(3);
      }
    });
  });
});

describe("surf", () => {
  it("is full off Ocean Beach, Lands End, Seal Rocks, Mile Rock and the Marin coast out to Point Bonita", () => {
    for (let s = 0; s <= LANDS_END.to; s += 2) expect(surfExposure(...out(s, 3)), `${s}`).toBeGreaterThan(s < 6 ? 0.6 : 0.97);
    for (const [x, z] of [[-74, -31], [-97, -57], [-208, -200], [-205, -150], [-160, -140], [-200, -320]]) expect(surfExposure(x, z), `${x},${z}`).toBeGreaterThan(0.97);
  });

  it("fades through the Golden Gate", () => {
    expect(surfExposure(-115, -100)).toBeGreaterThan(0.9);
    expect(surfExposure(-95, -100)).toBeGreaterThan(0.1);
    expect(surfExposure(-95, -100)).toBeLessThan(0.9);
    expect(surfExposure(-70, -100)).toBe(0);
  });

  it("is none in the bay: Alcatraz, the Marina, the Embarcadero, under the Bay Bridge, Treasure Island, Sausalito", () => {
    for (const [x, z] of [[-6, -66], [-20, -40], [35, 0], [70, 14], [52, 14], [143, -7], [60, -150], [0, 52]]) expect(surfExposure(x, z), `${x},${z}`).toBe(0);
  });

  it("changes smoothly (no step over 0.1 a unit)", () => {
    for (let x = -240; x < 220; x += 1) {
      for (let z = -350; z < 120; z += 1) {
        const e = surfExposure(x, z);
        expect(Math.abs(surfExposure(x + 1, z) - e)).toBeLessThan(0.1);
        expect(Math.abs(surfExposure(x, z + 1) - e)).toBeLessThan(0.1);
      }
    }
  });

  it("runs in the water shader with the same constants", () => {
    const n = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
    expect(SURF_GLSL).toContain(`smoothstep(${n(EXPOSURE.x0)}, ${n(EXPOSURE.x1)}, p.x + ${n(EXPOSURE.k)} * clamp(${n(EXPOSURE.z0)} - p.y, 0.0, ${n(EXPOSURE.cap)}))`);
    for (const v of [SURF.spacing, SURF.speed, SURF.reach, SURF.sheet]) expect(SURF_GLSL).toContain(n(v));
    const bay = readFileSync("src/scene/bay.tsx", "utf8");
    expect(bay).toContain("${SURF_GLSL}");
    expect(bay).toMatch(/coastSurf\(/);
    expect(bay).toMatch(/coastExposure\(/);
  });
});

describe("coast mesh", () => {
  const g = coastGeometry();
  it("is finite and under 8k triangles", () => {
    for (const key of ["position", "normal", "color", "aRock"]) {
      expect(Array.from(g.attributes[key].array as Float32Array).every(Number.isFinite), key).toBe(true);
    }
    expect(g.attributes.position.count / 3).toBeLessThan(8000);
    expect(g.attributes.position.count / 3).toBeGreaterThan(1500);
  });
  it("has both sand and rock", () => {
    const rock = Array.from(g.attributes.aRock.array as Float32Array);
    expect(rock.filter((v) => v === 1).length).toBeGreaterThan(300);
    expect(rock.filter((v) => v === 0).length).toBeGreaterThan(300);
  });
  it("never rises above the land behind it", () => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const top = wallTop(coastAt(p.getX(i), p.getZ(i)).px, coastAt(p.getX(i), p.getZ(i)).pz);
      expect(p.getY(i), `${p.getX(i)},${p.getZ(i)}`).toBeLessThanOrEqual(top - 0.02 + 1e-5);
    }
  });
  it("rocks are finite", () => {
    for (const r of ROCKS) expect([r.x, r.y, r.z, r.s, r.tall, r.yaw].every(Number.isFinite)).toBe(true);
  });
});
