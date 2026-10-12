// The four bridge ends. Each deck lane goes on as a real road: it leaves the
// deck level and in line, keeps a drivable grade, never goes under the ground
// or the sea wall, never runs through a building, tree or lamp, and meets a
// road on land (a city street, the Marin road, the Yerba Buena tunnel).

import { describe, expect, it } from "vitest";
import { MARIN_ROAD, headlandHeight, heightAt } from "@/lib/terrain";
import { HILLS, WATER_Y } from "@/scene/bay";
import { LAND, STREET, X_STREETS, Z_STREETS, groundAt, insideLand } from "@/scene/grid";
import { BAY_TOWER, BAY_TOWERS, GG, GG_TOWER } from "@/scene/landmarks";
import { CITY, insideBuilding } from "@/scene/layout";
import { CABLE, DECKS, DECK_Y, ISLAND, MAX_GRADE, RAIL, ROADS, ROAD_WIDTH, SLAB, bayDeckY, piers, railingGeometry, roadGeometry, spanGeometry, type Road } from "@/scene/roads";
import { DAY_LENGTH, sampleDay } from "@/scene/routes";

const road = (name: string) => ROADS.find((r) => r.name === name) as Road;
const HALF = ROAD_WIDTH / 2;

function segmentDistance(px: number, pz: number, [ax, az]: number[], [bx, bz]: number[]) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
const shoreDistance = (x: number, z: number) => Math.min(...LAND.map((p, i) => segmentDistance(x, z, LAND[(i + LAND.length - 1) % LAND.length], p)));

/** Yerba Buena Island as bay.tsx draws it (a dome on the water). */
function dome(x: number, z: number) {
  const d = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  return d < 1 ? ISLAND.y + ISLAND.h * Math.sqrt(1 - d * d) : -Infinity;
}

/** What is really under x, z: city ground and sea wall, the Marin hills, the island, or water. */
function surface(x: number, z: number) {
  if (z < -112) return headlandHeight(x, z);
  const city = insideLand(x, z) || shoreDistance(x, z) < 0.7 ? heightAt(x, z) : WATER_Y;
  return Math.max(city, dome(x, z));
}

/** Unit direction of the road at point i (towards the end). */
function heading(r: Road, i: number) {
  const a = r.points[Math.max(0, i - 1)];
  const b = r.points[Math.min(r.points.length - 1, i + 1)];
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  return [(b[0] - a[0]) / len, (b[2] - a[2]) / len];
}

/** Centre and both edges of the road at point i (just inside the kerb line). */
function across(r: Road, i: number) {
  const [x, y, z] = r.points[i];
  const [dx, dz] = heading(r, i);
  return [0.05 - HALF, 0, HALF - 0.05].map((u) => [x + dz * u, y, z - dx * u] as const);
}

const grades = (r: Road) =>
  r.points.slice(1).map((p, i) => {
    const q = r.points[i];
    return { g: (p[1] - q[1]) / Math.hypot(p[0] - q[0], p[2] - q[2]), ds: Math.hypot(p[0] - q[0], p[2] - q[2]) };
  });

/** Points before the tunnel (the Bay Bridge's east road dives into the island). */
const open = (r: Road) => r.points.map((_, i) => i).filter((i) => !r.tunnel || i < r.points.length - 1);

describe("roads at the bridge ends", () => {
  it("has a road at each of the four ends", () => {
    expect(ROADS.map((r) => r.name).sort()).toEqual(["bay-bridge-east", "bay-bridge-west", "golden-gate-north", "golden-gate-south"]);
  });

  it("is as wide as the decks and the city streets", () => {
    expect(ROAD_WIDTH).toBe(STREET);
  });

  const DECK_ENDS: Record<string, [x: number, z: number, dx: number, dz: number]> = {
    "golden-gate-south": [GG.x, GG.south, 0, 1],
    "golden-gate-north": [GG.x, GG.north, 0, -1],
    "bay-bridge-west": [BAY_TOWERS[0], 14, -1, 0],
    "bay-bridge-east": [BAY_TOWERS[BAY_TOWERS.length - 1], 14, 1, 0],
  };

  it.each(ROADS)("$name leaves its deck level and in line with it", (r) => {
    const [x, z, dx, dz] = DECK_ENDS[r.name];
    const [px, py, pz] = r.points[0];
    expect(Math.hypot(px - x, pz - z)).toBeLessThan(0.01);
    expect(py).toBeCloseTo(DECK_Y, 3);
    const [hx, hz] = heading(r, 1);
    expect(hx * dx + hz * dz).toBeGreaterThan(0.999);
    expect(Math.abs(grades(r)[0].g)).toBeLessThan(0.05);
  });

  it("the main decks are level at deck height, end to end with their roads", () => {
    for (const d of DECKS) for (const p of d.points) expect(p[1]).toBe(DECK_Y);
    const ends = DECKS.flatMap((d) => [d.points[0], d.points[d.points.length - 1]]).map(([x, , z]) => `${x},${z}`);
    for (const r of ROADS) expect(ends).toContain(`${r.points[0][0]},${r.points[0][2]}`);
  });

  it.each(ROADS)("$name keeps a smooth, drivable grade", (r) => {
    const gs = grades(r);
    for (const { g } of gs) expect(Math.abs(g)).toBeLessThanOrEqual(MAX_GRADE + 1e-6);
    for (let i = 1; i < gs.length; i++) expect(Math.abs(gs[i].g - gs[i - 1].g) / gs[i].ds, `kink at ${i}`).toBeLessThan(0.15);
    // points about every half to one unit: no jumps
    for (const { ds } of gs) expect(ds).toBeLessThan(1.2);
  });

  it.each(ROADS)("$name never goes under the ground, the sea wall or the island", (r) => {
    for (const i of open(r)) {
      for (const [x, y, z] of across(r, i)) expect(y, `${r.name} at ${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThanOrEqual(surface(x, z) - 0.05);
    }
  });

  it.each(ROADS)("$name never runs through a building, tree, lamp or landmark", (r) => {
    const buildings = [...CITY.houses, ...CITY.towers];
    for (let i = 0; i < r.points.length; i++) {
      for (const [x, y, z] of across(r, i)) {
        expect(insideBuilding(x, y + 0.2, z), `${r.name} at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
        for (const b of buildings) expect(Math.abs(x - b.x) < b.w / 2 + 0.2 && Math.abs(z - b.z) < b.d / 2 + 0.2 && y - SLAB < b.y + b.h).toBe(false);
        for (const t of CITY.trees) expect(Math.hypot(x - t.x, z - t.z) < 1 && y - SLAB < t.y + 3.2, `tree at ${t.x},${t.z}`).toBe(false);
        for (const l of CITY.lamps) expect(Math.hypot(x - l.x, z - l.z) < 0.4 && y - SLAB < l.y + 3.5, `lamp at ${l.x},${l.z}`).toBe(false);
      }
    }
  });

  it.each(["golden-gate-south", "bay-bridge-west"])("%s lands on a city street and drives on into the grid", (name) => {
    const r = road(name);
    const n = r.points.length - 1;
    const [x, y, z] = r.points[n];
    expect(Math.abs(y - heightAt(x, z))).toBeLessThanOrEqual(0.05);
    // in line with the street it joins, which goes on past the end
    const [dx, dz] = heading(r, n);
    const alongX = Math.abs(dx) > 0.999 && Z_STREETS.some((s) => Math.abs(s - z) < 1e-6);
    const alongZ = Math.abs(dz) > 0.999 && X_STREETS.some((s) => Math.abs(s - x) < 1e-6);
    expect(alongX || alongZ).toBe(true);
    for (let s = 0; s <= 3; s += 0.5) expect(groundAt(x + dx * s, z + dz * s)).toBe("street");
    // wherever it is at grade, the whole width is asphalt: no sidewalk, grass or block under it
    for (let i = 0; i <= n; i++) {
      if (r.points[i][1] - heightAt(r.points[i][0], r.points[i][2]) > 0.3) continue;
      for (const [ex, , ez] of across(r, i)) expect(groundAt(ex, ez), `${name} at ${ex.toFixed(1)},${ez.toFixed(1)}`).toBe("street");
    }
    // and it eases onto the street
    expect(Math.abs(grades(r)[n - 1].g)).toBeLessThan(0.05);
  });

  it("golden-gate-north rides the roadbed carved into the Marin hills", () => {
    const r = road("golden-gate-north");
    expect(r.points.length).toBe(MARIN_ROAD.length);
    r.points.forEach(([x, y, z], i) => {
      expect([x, y, z]).toEqual(MARIN_ROAD[i]);
      if (z < -156) expect(y - headlandHeight(x, z), `${x},${z}`).toBeCloseTo(0.3, 1);
    });
    // it runs on out of sight (the headlands end at z -290, deep in the fog)
    expect(r.points[r.points.length - 1][2]).toBeLessThan(-280);
  });

  it("bay-bridge-east goes into the Yerba Buena tunnel", () => {
    expect([ISLAND.x, ISLAND.z, ISLAND.r, ISLAND.h]).toEqual(HILLS[0].slice(0, 4));
    const r = road("bay-bridge-east");
    expect(r.tunnel).toBe(true);
    const [x, y, z] = r.points[r.points.length - 1];
    // the portal stands where the road meets the island's flank, with room above the road
    expect(Math.abs(dome(x, z) - y)).toBeLessThan(0.2);
    expect(dome(x + 2, z)).toBeGreaterThan(y + 1.2);
    expect(Math.abs(grades(r)[r.points.length - 2].g)).toBeLessThan(0.05);
  });

  it("the Bay Bridge deck follows its roads down the side spans", () => {
    expect(bayDeckY(80)).toBe(DECK_Y);
    for (const name of ["bay-bridge-west", "bay-bridge-east"]) for (const [x, y] of road(name).points) expect(bayDeckY(x)).toBeCloseTo(y, 5);
  });

  it("piers stand on the ground or the sea floor, never in a junction or on a cross street", () => {
    for (const r of ROADS) {
      for (const [x, z, base, top] of piers(r)) {
        expect(base).toBeLessThanOrEqual(surface(x, z) + 1e-6);
        expect(top).toBeGreaterThan(base + 0.5);
        const onX = X_STREETS.some((s) => Math.abs(x - s) < STREET / 2 + 0.6);
        const onZ = Z_STREETS.some((s) => Math.abs(z - s) < STREET / 2 + 0.6);
        if (insideLand(x, z)) expect(onX && onZ, `${r.name} pier at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
      }
    }
  });

  it("keeps every railing and parapet outside the road (cars use its whole width)", () => {
    expect(RAIL.inner).toBeGreaterThan(HALF);
    /** Horizontal distance to a centre line and the road surface height there. */
    const nearest = (points: readonly (readonly number[])[], x: number, z: number) => {
      let best = { d: Infinity, y: 0 };
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1], points[i]];
        const vx = b[0] - a[0];
        const vz = b[2] - a[2];
        const t = Math.min(1, Math.max(0, ((x - a[0]) * vx + (z - a[2]) * vz) / (vx * vx + vz * vz)));
        const d = Math.hypot(x - a[0] - vx * t, z - a[2] - vz * t);
        if (d < best.d) best = { d, y: a[1] + (b[1] - a[1]) * t };
      }
      return best;
    };
    const parts = [
      ...ROADS.map((r) => ({ points: r.points, g: roadGeometry(r).concrete })),
      ...ROADS.filter((r) => r.span > 0).map((r) => ({ points: r.points.slice(0, r.span + 1), g: spanGeometry(r) })),
      ...DECKS.map((d) => ({ points: d.points, g: railingGeometry(d.points) })),
    ];
    for (const { points, g } of parts) {
      const pos = g.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const { d, y } = nearest(points, pos[i], pos[i + 2]);
        if (pos[i + 1] > y + 0.02 && d < 3) expect(d, `at ${pos[i].toFixed(2)},${pos[i + 2].toFixed(2)}`).toBeGreaterThanOrEqual(HALF - 1e-3);
      }
    }
  });

  it("keeps the towers, cables and suspenders clear of the traffic on the decks", () => {
    const ROOF = DECK_Y + 1.3; // a car's roof
    const clearOfTraffic = (y0: number, y1: number) => y0 > ROOF || y1 < DECK_Y - SLAB;
    const outside = RAIL.inner + RAIL.parapet; // beyond the railings too
    // Golden Gate: legs step in on the outside only; struts span the road above the roofs
    expect(GG_TOWER.inner).toBeGreaterThanOrEqual(outside);
    for (const y of GG_TOWER.struts) expect(clearOfTraffic(y - GG_TOWER.strutH / 2, y + GG_TOWER.strutH / 2), `strut at ${y}`).toBe(true);
    // Bay Bridge: legs outside, bracing and struts above the roofs or under the deck
    expect(BAY_TOWER.inner).toBeGreaterThanOrEqual(outside);
    for (const y of BAY_TOWER.braces) expect(clearOfTraffic(y - BAY_TOWER.rise / 2 - 0.2, y + BAY_TOWER.rise / 2 + 0.2), `brace at ${y}`).toBe(true);
    for (const y of BAY_TOWER.struts) expect(clearOfTraffic(y - BAY_TOWER.strutH / 2, y + BAY_TOWER.strutH / 2), `strut at ${y}`).toBe(true);
    // main cables and suspenders: outside the railing, landing on the edge girder
    expect(CABLE - 0.2).toBeGreaterThan(RAIL.inner + 0.07);
    expect(CABLE).toBeLessThan(RAIL.girder);
    expect(CABLE).toBeGreaterThan(ROAD_WIDTH / 2);
  });

  it("the Golden Gate anchorages sit under the road", () => {
    expect(GG.anchorTop).toBeLessThanOrEqual(DECK_Y - SLAB);
  });

  it("Cuso has headroom where he walks under a road, and never walks into a pier", () => {
    const pierList = ROADS.flatMap((r) => piers(r));
    for (let d = 0; d <= DAY_LENGTH; d += 0.5) {
      const [cx, cy, cz] = sampleDay(d).pos;
      for (const r of ROADS) {
        for (const [x, y, z] of r.points) {
          if (Math.hypot(x - cx, z - cz) < HALF + 0.7) expect(y - SLAB, `${r.name} over Cuso at ${cx.toFixed(1)},${cz.toFixed(1)}`).toBeGreaterThan(cy + 2.2);
        }
      }
      for (const [x, z] of pierList) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(1.2);
    }
  });
});
