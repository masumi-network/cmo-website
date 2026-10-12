import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { EDGE, PARKS, X_STREETS, Z_STREETS, groundAt, inPark, insideLand } from "@/scene/grid";
import { FOOTING } from "@/scene/materials";
import { CLEAR, generateCity } from "@/scene/layout";
import { PATHS, samplePath } from "@/scene/routes";
import { makeCars, pointAt } from "@/scene/traffic";

const city = generateCity();

/** Street segments between neighbouring intersections: [x0, z0, x1, z1]. */
const segments = [
  ...X_STREETS.flatMap((x) => Z_STREETS.slice(1).map((z, j) => [x, Z_STREETS[j], x, z])),
  ...Z_STREETS.flatMap((z) => X_STREETS.slice(1).map((x, i) => [X_STREETS[i], z, x, z])),
];
const mid = ([x0, z0, x1, z1]: number[]) => [(x0 + x1) / 2, (z0 + z1) / 2] as const;
const open = segments.filter((s) => insideLand(...mid(s)) && groundAt(...mid(s)) === "street");

describe("ground: streets, sidewalks and parks", () => {
  it("makes every park whole blocks, so grass always stops at a kerb", () => {
    for (const [x0, x1, z0, z1] of PARKS) {
      expect(X_STREETS).toContain(x0);
      expect(X_STREETS).toContain(x1);
      expect(Z_STREETS).toContain(z0);
      expect(Z_STREETS).toContain(z1);
    }
  });

  it("puts the open hilltops (Telegraph Hill, Twin Peaks) in parks", () => {
    expect(inPark(2, -23)).toBe(true); // Pioneer Park, Coit Tower
    expect(inPark(-35, 34)).toBe(true); // Twin Peaks
  });

  it("never has grass on an open street or its sidewalks", () => {
    const toSegment = (x: number, z: number, [x0, z0, x1, z1]: number[]) =>
      Math.hypot(x - Math.min(Math.max(x, x0), x1), z - Math.min(Math.max(z, z0), z1));
    for (let x = -90; x <= 45; x += 0.5) {
      for (let z = -60; z <= 52; z += 0.5) {
        const kind = groundAt(x, z);
        if (kind === "grass") {
          expect(inPark(x, z)).toBe(true);
          expect(open.every((s) => toSegment(x, z, s) >= EDGE - 1e-9), `grass on a street at ${x},${z}`).toBe(true);
        }
        if (open.some((s) => toSegment(x, z, s) < EDGE - 1e-9)) expect(kind, `${x},${z}`).not.toBe("grass");
      }
    }
  });

  it("keeps the street grid connected, no street running into grass", () => {
    const key = (x: number, z: number) => `${x},${z}`;
    const links = new Map<string, string[]>();
    for (const [x0, z0, x1, z1] of open) {
      links.set(key(x0, z0), [...(links.get(key(x0, z0)) ?? []), key(x1, z1)]);
      links.set(key(x1, z1), [...(links.get(key(x1, z1)) ?? []), key(x0, z0)]);
    }
    // Every street end meets another street (a corner, a T or a crossing) or runs to the sea wall.
    for (const [k, to] of links) {
      const [x, z] = k.split(",").map(Number);
      const atShore = [[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dz]) => !insideLand(x + dx, z + dz));
      if (!atShore) expect(to.length, `dead end at ${k}`).toBeGreaterThanOrEqual(2);
    }
    const start = links.keys().next().value!;
    const seen = new Set([start]);
    const todo = [start];
    while (todo.length) for (const n of links.get(todo.pop()!)!) if (!seen.has(n) && seen.add(n)) todo.push(n);
    expect(seen.size).toBe(links.size);
  });

  it("closes the streets inside parks", () => {
    expect(groundAt(-35, 30)).toBe("grass"); // x -35 through Twin Peaks
    expect(groundAt(5, -26)).toBe("grass"); // z -26 past Coit Tower
    expect(groundAt(-35, 20)).toBe("street"); // the park edge stays a street
  });

  it("keeps cars and Cuso on open streets or sidewalks, never on park grass", () => {
    const p = { x: 0, z: 0 };
    for (const car of makeCars()) {
      for (let s = 0; s < car.path.length; s += 0.5) {
        pointAt(car.path, s, p);
        expect(groundAt(p.x, p.z), `car at ${p.x},${p.z}`).toBe("street");
      }
    }
    for (const path of PATHS) {
      for (let k = 0; k <= 200; k++) {
        const { pos, mode } = samplePath(path, k / 200);
        if (mode !== "jump") expect(inPark(pos[0], pos[2]), `Cuso at ${pos[0]},${pos[2]}`).toBe(false);
      }
    }
  });

  it("plants trees on sidewalks or in parks, never on the road, and keeps summits open", () => {
    for (const t of city.trees) {
      expect(groundAt(t.x, t.z), `${t.x},${t.z}`).not.toBe("street");
      for (const [cx, cz, r] of CLEAR) expect(Math.hypot(t.x - cx, t.z - cz) >= r, `${t.x},${t.z}`).toBe(true);
    }
  });

  it("sits every building on the slope: nothing sunk, the footing covers the drop", () => {
    for (const b of [...city.houses, ...city.towers]) {
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]].map(([i, j]) => [b.x + (i * b.w) / 2, b.z + (j * b.d) / 2])) {
        const g = heightAt(x, z);
        expect(g, `sunk at ${b.x},${b.z}`).toBeLessThanOrEqual(b.y + 0.02);
        expect(g, `floats at ${b.x},${b.z}`).toBeGreaterThan(b.y - FOOTING + 0.05);
      }
    }
  });
});
