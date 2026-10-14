import { describe, expect, it } from "vitest";
import { HILLS, MAST_TOP, ROUTES, SHORE, WATER_Y, bakeShore, bayGeometries, boatAt, shoreDistance, sailTrim, track, yerbaBuenaHeight } from "@/scene/bay";
import { BAY_ANCHORS, ISLAND, ROADS, piers } from "@/scene/roads";
import { insideLand } from "@/scene/layout";
import { HEADLANDS, MARIN_ROAD, headlandHeight } from "@/lib/terrain";

const shore = bakeShore();
const tracks = ROUTES.map(track);
const pose = () => ({ x: 0, z: 0, heading: 0 });

/** Points along a route, about every half unit. */
function samples(i: number) {
  const t = tracks[i];
  const out: [number, number][] = [];
  const p = pose();
  for (let s = 0; s < t.period; s += 0.5 / ROUTES[i].speed) {
    boatAt(t, s, p);
    out.push([p.x, p.z]);
  }
  return out;
}

describe("shore distance (the water shader's foam and shallows)", () => {
  it("is land in the city, on Alcatraz, Treasure Island and the Marin Headlands", () => {
    for (const [x, z] of [[0, 0], [-40, 20], [-6, -66], [142, 14], [0, -150], [-120, -170]]) {
      expect(shoreDistance(shore, x, z), `${x},${z}`).toBeLessThan(0);
    }
  });

  it("is open water in the strait and the bay", () => {
    for (const [x, z] of [[-40, -95], [60, -60], [90, 40], [-120, -60]]) {
      expect(shoreDistance(shore, x, z), `${x},${z}`).toBeGreaterThan(8);
    }
  });

  it("knows the bridge towers and the Ferry Building stand in the water", () => {
    expect(shoreDistance(shore, -80, -134)).toBeLessThan(0.5);
    expect(shoreDistance(shore, 70, 14)).toBeLessThan(0.5);
    expect(shoreDistance(shore, 35.5, -3)).toBeLessThan(0.5);
    for (const x of BAY_ANCHORS) expect(shoreDistance(shore, x, 14), `anchorage ${x}`).toBeLessThan(0.5);
    const inWater = ROADS.flatMap((r) => piers(r)).filter(([, , ground]) => ground < WATER_Y);
    expect(inWater.length).toBeGreaterThan(0);
    for (const [x, z] of inWater) expect(shoreDistance(shore, x, z), `pier ${x},${z}`).toBeLessThan(0.6);
  });

  it("has Treasure Island as flat land north of Yerba Buena", () => {
    expect(shoreDistance(shore, 143, -7)).toBeLessThan(0);
    expect(shoreDistance(shore, 141.5, 4)).toBeLessThan(0); // the causeway
    expect(shoreDistance(shore, 120, -7)).toBeGreaterThan(8);
  });

  it("has open water along its west and north borders (the shader clamps them out to the horizon)", () => {
    for (let z = -300; z <= 0; z += 2) expect(shoreDistance(shore, -231, z), `-231,${z}`).toBeGreaterThan(8);
    const north = SHORE.z0 + 0.5;
    for (let x = -232; x <= 216; x += 2) expect(shoreDistance(shore, x, north), `${x},${north}`).toBeGreaterThan(8);
  });

  describe("the Marin hills fall into the water before their mesh ends", () => {
    // A cut edge standing in the air showed in the water mirror as a pale arc in the strait.
    const { x0, x1, z0, z1 } = HEADLANDS;
    it("at Point Bonita (west)", () => {
      for (let z = z0; z <= z1; z += 0.5) expect(headlandHeight(x0, z), `${x0},${z}`).toBeLessThan(WATER_Y);
      expect(shoreDistance(shore, -214, -200)).toBeGreaterThan(3);
    });
    it("toward Sausalito (east)", () => {
      for (let z = z0; z <= z1; z += 0.5) expect(headlandHeight(x1, z), `${x1},${z}`).toBeLessThan(WATER_Y);
      expect(shoreDistance(shore, 74, -200)).toBeGreaterThan(3);
    });
    it("in the north, the road's end included", () => {
      for (let x = x0; x <= x1; x += 0.5) expect(headlandHeight(x, z0), `${x},${z0}`).toBeLessThan(WATER_Y);
    });
    it("past the Marin road's end, down a gentle slope (no bluff)", () => {
      const [ex, , ez] = MARIN_ROAD[MARIN_ROAD.length - 1];
      for (let z = ez; z > z0; z -= 1) expect(Math.abs(headlandHeight(ex, z - 1) - headlandHeight(ex, z)), `${ex},${z}`).toBeLessThan(0.8);
    });
    it("and stay hills inland", () => {
      for (const [x, z] of [[-160, -200], [40, -200], [-60, -260], [-174, -286], [-174, -300]]) expect(shoreDistance(shore, x, z), `${x},${z}`).toBeLessThan(0);
    });
    it("along the strait in coves and points, not a ruler line, and still land the bridge", () => {
      // Seen from the bay, a straight shore read as the hills' mesh cut off at the water.
      const shoreAt = (x: number) => {
        for (let z = z1; z > z0; z -= 0.25) if (headlandHeight(x, z) > WATER_Y) return z;
        return NaN;
      };
      for (let from = -200; from <= 30; from += 20) {
        if (Math.abs(from + 20 + 80) < 30) continue; // the cove where the bridge lands bends anyway
        const zs = Array.from({ length: 41 }, (_, i) => shoreAt(from + i));
        expect(Math.max(...zs) - Math.min(...zs), `${from}..${from + 40}`).toBeGreaterThan(3);
      }
      expect(shoreAt(-80)).toBeCloseTo(-153.25, 0);
      for (let x = x0; x <= x1; x += 0.5) expect(headlandHeight(x, z1), `${x},${z1}`).toBeLessThan(WATER_Y);
    });
  });

  it("measures distance in world units", () => {
    // The east shore of the city is at x = 31 (plus the sea wall bevel).
    expect(shoreDistance(shore, 41, 24)).toBeGreaterThan(8.5);
    expect(shoreDistance(shore, 41, 24)).toBeLessThan(10);
  });
});

describe("boat routes", () => {
  it("has five sailboats and a ferry", () => {
    expect(ROUTES.filter((r) => r.kind === "sail")).toHaveLength(5);
    expect(ROUTES.filter((r) => r.kind === "ferry")).toHaveLength(1);
  });

  it.each(ROUTES.map((r, i) => [r.name, i] as const))("%s stays on open water", (_, i) => {
    const margin = ROUTES[i].kind === "ferry" ? 4 : 3;
    for (const [x, z] of samples(i)) {
      expect(insideLand(x, z), `${x},${z}`).toBe(false);
      expect(shoreDistance(shore, x, z), `${x.toFixed(1)},${z.toFixed(1)}`).toBeGreaterThan(margin);
    }
  });

  it("keeps the routes apart, so boats never collide", () => {
    const all = ROUTES.map((_, i) => samples(i));
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        let min = Infinity;
        for (const [ax, az] of all[i]) for (const [bx, bz] of all[j]) min = Math.min(min, Math.hypot(ax - bx, az - bz));
        expect(min, `${ROUTES[i].name} / ${ROUTES[j].name}`).toBeGreaterThan(6);
      }
    }
  });

  it("loops: a boat is back where it started after one period", () => {
    for (const t of tracks) {
      const a = boatAt(t, 3, pose());
      const b = boatAt(t, 3 + t.period, pose());
      expect(b.x).toBeCloseTo(a.x, 4);
      expect(b.z).toBeCloseTo(a.z, 4);
    }
  });

  it("is deterministic and moves smoothly", () => {
    const t = tracks[0];
    expect(boatAt(t, 12.5, pose())).toEqual(boatAt(track(ROUTES[0]), 12.5, pose()));
    const p = pose();
    const q = pose();
    for (let s = 0; s < t.period; s += 0.25) {
      boatAt(t, s, p);
      boatAt(t, s + 0.25, q);
      expect(Math.hypot(q.x - p.x, q.z - p.z)).toBeLessThan(0.25 * ROUTES[0].speed * 1.6);
      const turn = Math.abs(Math.atan2(Math.sin(q.heading - p.heading), Math.cos(q.heading - p.heading)));
      expect(turn).toBeLessThan(0.2);
    }
  });

  it("faces where it is going", () => {
    const t = tracks[1];
    const p = boatAt(t, 20, pose());
    const q = boatAt(t, 20.2, pose());
    const heading = Math.atan2(q.x - p.x, q.z - p.z);
    expect(Math.cos(heading - p.heading)).toBeGreaterThan(0.98);
  });

  it("masts clear the bridge decks", () => {
    expect(MAST_TOP).toBeLessThan(5.5);
  });
});

describe("sail trim (wind from the west)", () => {
  it("lets the boom out to leeward and heels the boat away from the wind", () => {
    // Heading north or south is a beam reach: the boom goes out on opposite sides.
    const north = sailTrim(Math.PI);
    const south = sailTrim(0);
    expect(Math.sign(north.boom)).toBe(-Math.sign(south.boom));
    expect(Math.abs(north.boom)).toBeGreaterThan(0.4);
    expect(Math.sign(north.heel)).toBe(-Math.sign(south.heel));
    expect(Math.abs(north.heel)).toBeGreaterThan(0.05);
  });

  it("luffs head to wind and sheets in close-hauled", () => {
    const west = sailTrim(-Math.PI / 2); // heading straight into the wind
    expect(Math.abs(west.camber)).toBeLessThan(0.35);
    expect(Math.abs(west.heel)).toBeLessThan(0.02);
    const reach = sailTrim(Math.PI);
    const run = sailTrim(Math.PI / 2 + 0.4);
    expect(Math.abs(run.boom)).toBeGreaterThan(Math.abs(reach.boom));
  });
});

describe("Yerba Buena", () => {
  it("is the dome roads.ts plans the tunnel on, so the portal sits in the hillside", () => {
    expect(HILLS[0].slice(0, 4)).toEqual([ISLAND.x, ISLAND.z, ISLAND.r, ISLAND.h]);
    const east = ROADS.find((r) => r.name === "bay-bridge-east");
    const [x, y, z] = east!.points[east!.points.length - 1];
    expect(yerbaBuenaHeight(x, z)).toBeCloseTo(y, 1);
    // the road comes in over open water and ground lower than itself
    for (const [px, py, pz] of east!.points) expect(Math.max(WATER_Y, yerbaBuenaHeight(px, pz))).toBeLessThan(py + 0.2);
    // and the hill covers the tunnel behind the portal
    expect(yerbaBuenaHeight(x + 2, z)).toBeGreaterThan(y + 1.5);
  });

  it("is a hill that peaks in the middle and meets the water at its radius", () => {
    expect(yerbaBuenaHeight(ISLAND.x, ISLAND.z)).toBeGreaterThan(ISLAND.y + ISLAND.h * 0.9);
    expect(yerbaBuenaHeight(ISLAND.x + ISLAND.r * 0.999, ISLAND.z)).toBeLessThan(WATER_Y + 0.3);
    expect(yerbaBuenaHeight(ISLAND.x + ISLAND.r + 0.1, ISLAND.z)).toBe(-Infinity);
  });
});

describe("bay meshes", () => {
  it("have only finite vertices, normals and colours", () => {
    for (const [name, g] of Object.entries(bayGeometries())) {
      for (const key of ["position", "normal", "color"]) {
        const a = g.attributes[key];
        if (!a) continue;
        expect(Array.from(a.array as Float32Array).every(Number.isFinite), `${name}.${key}`).toBe(true);
      }
    }
  });
});
