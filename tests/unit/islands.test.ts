// Alcatraz and Treasure Island (islands.tsx): modelled buildings on the
// islands' fixed footprints. Boat routes and the shore foam read those
// footprints, so nothing above the water reaches past them (the Alcatraz pier
// is the one thing that stands in the water), and every mesh is finite (one
// NaN blanks the screen through bloom).

import { Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { ROUTES, boatAt, track } from "@/scene/bay";
import { PALETTES, SLOT } from "@/scene/house-models";
import { LANTERN, ROAD, TREASURE_ISLAND, TREASURE_Y, alcatrazAt, alcatrazColumn, alcatrazRho, islandGeometries, roundedBoxDistance, toWorld } from "@/scene/islands";

const g = islandGeometries();
const EPS = 1e-6;
const tris = (geo: BufferGeometry) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
const points = (geo: BufferGeometry) => {
  const p = geo.attributes.position;
  return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i));
};

describe("island meshes", () => {
  it("are finite", () => {
    for (const [name, geo] of Object.entries(g)) {
      for (const [key, a] of Object.entries(geo.attributes)) {
        expect(Array.from(a.array as Float32Array).every(Number.isFinite), `${name}.${key}`).toBe(true);
      }
    }
  });

  it("stay within their triangle budgets", () => {
    expect(tris(g.alcatraz)).toBeLessThan(4000);
    expect(tris(g.alcatrazBuildings) + tris(g.alcatrazPier)).toBeLessThan(6500);
    expect(tris(g.alcatrazLights)).toBeLessThan(150);
    expect(tris(g.treasureBuildings)).toBeLessThan(4500);
  });
});

describe("Alcatraz", () => {
  it("keeps its footprint: nothing of the rock above the water reaches past the water line", () => {
    for (const p of points(g.alcatraz)) if (p.y > 0) expect(alcatrazRho(p.x, p.z), `${p.x},${p.z}`).toBeLessThanOrEqual(1 + EPS);
  });

  it("has every building on the island", () => {
    for (const p of points(g.alcatrazBuildings)) expect(alcatrazRho(p.x, p.z), `${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeLessThan(0.99);
  });

  it("has a short pier into the water, clear of the boat that sails round the island", () => {
    const pier = points(g.alcatrazPier);
    expect(Math.max(...pier.map((p) => alcatrazRho(p.x, p.z)))).toBeGreaterThan(1);
    const route = ROUTES.findIndex((r) => r.name === "around Alcatraz");
    const t = track(ROUTES[route]);
    const pose = { x: 0, z: 0, heading: 0 };
    let min = Infinity;
    for (let s = 0; s < t.period; s += 0.5) {
      boatAt(t, s, pose);
      for (const p of pier) {
        const [x, z] = toWorld(p.x, p.z);
        min = Math.min(min, Math.hypot(x - pose.x, z - pose.z));
      }
    }
    expect(min).toBeGreaterThan(3);
  });

  it("paints its buildings in the house material, white and black, with glass that never lights up (a ruin)", () => {
    const b = g.alcatrazBuildings;
    const slot = b.attributes.aSlot;
    const win = b.attributes.aWin;
    const pal = b.attributes.aPalette;
    const scheme = PALETTES.findIndex((p) => p.name === "white and black");
    let glass = 0;
    for (let i = 0; i < slot.count; i++) {
      expect(win.getX(i)).toBe(0);
      expect(pal.getX(i)).toBe(scheme);
      if (slot.getX(i) === SLOT.glass) glass++;
    }
    expect(glass).toBeGreaterThan(100);
  });

  it("lights only the lantern, where the beam turns, and a few lamps and windows", () => {
    const lights = points(g.alcatrazLights);
    const box = lights.filter((p) => p.distanceTo(new Vector3(LANTERN.u, LANTERN.y, LANTERN.v)) < 0.25);
    expect(box.length).toBeGreaterThan(0);
    expect(tris(g.alcatrazLights)).toBeLessThan(150);
  });

  it("has cliffs in layers: each column steps down outwards and never folds back", () => {
    for (let k = 0; k < 96; k++) {
      const col = alcatrazColumn((k / 96) * Math.PI * 2);
      for (let i = 1; i < col.length; i++) expect(col[i].rho).toBeGreaterThanOrEqual(col[i - 1].rho);
      const lip = col.findIndex((r) => r.band === "rock");
      for (let i = lip + 1; i < col.length; i++) expect(col[i].y).toBeLessThanOrEqual(col[i - 1].y + EPS);
    }
  });

  it("has a switchback road from the dock to the top, never steeper than a city street", () => {
    // the road runs on the cliff's benches; sample both legs along the sector
    const legs: [number, number][][] = [[], []];
    for (let t = ROAD.from; t <= ROAD.to + 1e-9; t += (ROAD.to - ROAD.from) / 40) {
      const col = alcatrazColumn(t);
      const roads = col.filter((r) => r.band === "road");
      expect(roads.length, `${t}`).toBe(2);
      roads.forEach((r, i) => legs[i].push([t, r.y]));
    }
    for (const leg of legs) {
      for (let i = 1; i < leg.length; i++) {
        const [p, q] = [alcatrazAt(leg[i - 1][0], 0.86), alcatrazAt(leg[i][0], 0.86)];
        const run = Math.hypot(q[0] - p[0], q[1] - p[1]);
        expect(Math.abs(leg[i][1] - leg[i - 1][1]) / run).toBeLessThan(0.36);
      }
    }
    // the upper leg reaches the top, the lower one starts at the dock, and they meet at the hairpin
    const top = alcatrazColumn(ROAD.from);
    expect(legs[0][0][1]).toBeGreaterThan(top[top.findIndex((r) => r.band === "rock")].y - 0.05);
    expect(legs[1][0][1]).toBeLessThan(0.3);
    expect(Math.abs(legs[0][legs[0].length - 1][1] - legs[1][legs[1].length - 1][1])).toBeLessThan(0.05);
  });
});

describe("Treasure Island", () => {
  it("keeps its buildings, trees and roads on the island, pale and low", () => {
    const sage = PALETTES.findIndex((p) => p.name === "sage");
    const pal = g.treasureBuildings.attributes.aPalette;
    points(g.treasureBuildings).forEach((p, i) => {
      const inside = Math.min(...TREASURE_ISLAND.map((part) => roundedBoxDistance(p.x, p.z, part)));
      expect(inside, `${p.x.toFixed(2)},${p.z.toFixed(2)}`).toBeLessThan(0);
      expect(p.y).toBeGreaterThan(TREASURE_Y - 0.5);
      expect(p.y).toBeLessThan(TREASURE_Y + 1.6);
      expect(pal.getX(i)).toBe(sage);
    });
  });
});
