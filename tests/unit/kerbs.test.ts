// Kerbs: the streets lie KERB below their sidewalks, with a crisp kerb face,
// curb ramps where crosswalks land, and zebra crosswalks at the junctions.

import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { heightAt, surfaceAt } from "@/lib/terrain";
import { CROSSWALKS, EDGE, KERB, LANE_MARKS, STREET, X_STREETS, Z_STREETS, groundAt, inPark, insideLand, streetDrop } from "@/scene/grid";
import { TILE, kerbGeometry, terrainGeometry, tiles } from "@/scene/ground";
import type { BufferGeometry } from "three";
import { HOP, PATHS, samplePath } from "@/scene/routes";

const KERB_X = X_STREETS.flatMap((s) => [s - STREET / 2, s + STREET / 2]);
const KERB_Z = Z_STREETS.flatMap((s) => [s - STREET / 2, s + STREET / 2]);
/** Inside the land with the whole mesh cell around it (the shore cells drop to the sea floor). */
const onLand = (x: number, z: number) => [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]].every(([dx, dz]) => insideLand(x + dx, z + dz));
const grid = (step: number, f: (x: number, z: number) => void) => {
  for (let x = -90; x <= 45; x += step) for (let z = -60; z <= 52; z += step) f(x, z);
};

describe("kerbs", () => {
  it("has one kerb height, readable at miniature scale", () => {
    expect(KERB).toBeGreaterThanOrEqual(0.1);
    expect(KERB).toBeLessThanOrEqual(0.2);
  });

  it("sets the streets down by exactly KERB and nothing else (blocks, park lawns)", () => {
    grid(0.37, (x, z) => {
      const kind = groundAt(x, z);
      const drop = heightAt(x, z) - surfaceAt(x, z);
      expect(drop).toBeCloseTo(streetDrop(x, z), 9);
      if (kind === "street") expect(drop, `${x},${z}`).toBeCloseTo(KERB, 9);
      if (kind === "block" || kind === "grass") expect(drop, `${x},${z}`).toBe(0);
      if (kind === "sidewalk") expect(drop, `${x},${z}`).toBeGreaterThanOrEqual(0);
      if (kind === "sidewalk") expect(drop, `${x},${z}`).toBeLessThanOrEqual(KERB + 1e-9);
    });
  });

  it("keeps a park's lawn level with the sidewalk around it, and closes a street at the park's kerb", () => {
    expect(inPark(-35, 30)).toBe(true);
    expect(surfaceAt(-35, 30)).toBe(heightAt(-35, 30));
    // Twin Peaks closes x -35 at the z 24 street: the park's sidewalk runs on across it.
    expect(groundAt(-35, 25.4)).toBe("street");
    expect(groundAt(-35, 25.6)).toBe("sidewalk");
    expect(groundAt(-35, 26.3)).toBe("sidewalk");
    expect(streetDrop(-35, 26)).toBe(0);
  });

  it("only changes height in a step at the kerb lines (so the ground mesh can show a crisp kerb)", () => {
    // Away from kerb lines, the drop never jumps.
    grid(0.31, (x, z) => {
      if (!insideLand(x, z)) return;
      if (KERB_X.some((k) => Math.abs(x - k) < 0.02) || KERB_Z.some((k) => Math.abs(z - k) < 0.02)) return;
      for (const [dx, dz] of [[0.01, 0], [0, 0.01]]) expect(Math.abs(streetDrop(x + dx, z + dz) - streetDrop(x, z)), `${x},${z}`).toBeLessThan(0.01);
    });
  });

  it("paints zebra crosswalks on the street at the junctions, and lane marks stop short of them", () => {
    expect(CROSSWALKS.length).toBeGreaterThan(20);
    for (const c of CROSSWALKS) {
      expect(groundAt((c.x0 + c.x1) / 2, (c.z0 + c.z1) / 2)).toBe("street");
      for (const [x0, z0, x1, z1] of LANE_MARKS) {
        const overlaps = Math.min(x0, x1) < c.x1 && Math.max(x0, x1) > c.x0 && Math.min(z0, z1) < c.z1 && Math.max(z0, z1) > c.z0;
        expect(overlaps, `lane mark through crosswalk at ${c.x0},${c.z0}`).toBe(false);
      }
    }
    // No lane mark runs through a junction either.
    for (const [x0, z0, x1, z1] of LANE_MARKS) {
      for (const s of X_STREETS) for (const t of Z_STREETS) {
        const inside = (x: number, z: number) => Math.abs(x - s) < EDGE && Math.abs(z - t) < EDGE;
        expect(inside(x0, z0) || inside(x1, z1) || inside((x0 + x1) / 2, (z0 + z1) / 2)).toBe(false);
      }
    }
  });

  it("puts a curb ramp, flush with the street, wherever Cuso crosses a street at a junction", () => {
    let crossings = 0;
    for (const path of PATHS) {
      let prev = samplePath(path, 0);
      for (let k = 1; k <= 4000; k++) {
        const now = samplePath(path, k / 4000);
        const [[x0, , z0], [x1, , z1]] = [prev.pos, now.pos];
        prev = now;
        if (now.mode === "jump") continue;
        // crossing a kerb line within a corner square (beside a cross street, not mid-block)?
        const corner = (v: number, streets: number[]) => streets.some((s) => Math.abs(v - s) > STREET / 2 && Math.abs(v - s) < EDGE);
        const crossesX = KERB_X.some((c) => (x0 - c) * (x1 - c) < 0) && corner(z1, Z_STREETS);
        const crossesZ = KERB_Z.some((c) => (z0 - c) * (z1 - c) < 0) && corner(x1, X_STREETS);
        if (!crossesX && !crossesZ) continue;
        crossings++;
        expect(Math.abs(streetDrop(x0, z0) - streetDrop(x1, z1)), `kerb at ${x1.toFixed(2)},${z1.toFixed(2)}`).toBeLessThan(0.02);
      }
    }
    expect(crossings).toBeGreaterThan(5);
  });

  it("stands every street-level spot on the street surface", () => {
    for (const c of chapters) expect(c.spot[1]).toBeGreaterThanOrEqual(surfaceAt(c.spot[0], c.spot[2]) - 1e-9);
    const learn = chapters.find((c) => c.id === "learn")!.spot;
    expect(learn[1]).toBeCloseTo(surfaceAt(learn[0], learn[2]), 9);
  });
});

/** Height of the ground mesh at x, z: the triangle under the point, interpolated. */
function meshHeight() {
  const g = terrainGeometry();
  const pos = g.attributes.position.array;
  const index = g.index!.array;
  const cells = new Map<string, number[]>();
  for (let t = 0; t < index.length; t += 3) {
    const xs = [0, 1, 2].map((k) => pos[index[t + k] * 3]);
    const zs = [0, 1, 2].map((k) => pos[index[t + k] * 3 + 2]);
    const key = `${Math.floor(Math.min(...xs) * 2)},${Math.floor(Math.min(...zs) * 2)}`;
    cells.set(key, [...(cells.get(key) ?? []), t]);
  }
  return (x: number, z: number) => {
    for (const t of cells.get(`${Math.floor(x * 2)},${Math.floor(z * 2)}`) ?? []) {
      const [a, b, c] = [0, 1, 2].map((k) => index[t + k] * 3);
      const det = (pos[b + 2] - pos[c + 2]) * (pos[a] - pos[c]) + (pos[c] - pos[b]) * (pos[a + 2] - pos[c + 2]);
      const l1 = ((pos[b + 2] - pos[c + 2]) * (x - pos[c]) + (pos[c] - pos[b]) * (z - pos[c + 2])) / det;
      const l2 = ((pos[c + 2] - pos[a + 2]) * (x - pos[c]) + (pos[a] - pos[c]) * (z - pos[c + 2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1];
    }
    return NaN;
  };
}

describe("ground mesh", () => {
  const g = terrainGeometry();

  it("costs no more triangles than the old plane (121k), kerbs included", () => {
    expect(g.index!.count / 3 + kerbGeometry().attributes.position.count / 3).toBeLessThanOrEqual(121_000);
  });

  it("follows surfaceAt, with every kerb a vertical face (no ramp from interpolation)", () => {
    const h = meshHeight();
    // Just either side of a kerb on flat ground: street and sidewalk heights, 2 cm apart.
    expect(h(-3 + 1.49, -1)).toBeCloseTo(surfaceAt(-3 + 1.49, -1), 3);
    expect(h(-3 + 1.51, -1)).toBeCloseTo(surfaceAt(-3 + 1.51, -1), 3);
    expect(h(-3 + 1.51, -1) - h(-3 + 1.49, -1)).toBeCloseTo(KERB, 2);
    grid(0.43, (x, z) => {
      if (!onLand(x, z) || KERB_X.some((k) => Math.abs(x - k) < 0.6) || KERB_Z.some((k) => Math.abs(z - k) < 0.6)) return;
      expect(Math.abs(h(x, z) - surfaceAt(x, z)), `${x},${z}`).toBeLessThan(0.03);
    });
  });

  it("builds each kerb from the ground on either side of it: a face between the levels, strips on them", () => {
    const k = kerbGeometry();
    const pos = k.attributes.position.array;
    expect(pos.length).toBeGreaterThan(0);
    const sides = (x: number, z: number) => [[0.03, 0], [-0.03, 0], [0, 0.03], [0, -0.03]].map(([dx, dz]) => surfaceAt(x + dx, z + dz));
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
      if (!onLand(x, z)) continue; // at the sea wall the ground drops to the sea floor
      const ys = sides(x, z);
      // never below the lower level nor above the higher one (plus the strips' lift)
      expect(y, `${x},${z}`).toBeGreaterThanOrEqual(Math.min(...ys) - 0.02);
      expect(y, `${x},${z}`).toBeLessThanOrEqual(Math.max(...ys) + 0.02);
    }
  });
});

/** Every triangle as its three corners, each corner with all its attributes (exact numbers, winding kept). */
function triangles(g: BufferGeometry) {
  const attrs = Object.values(g.attributes);
  const corner = (v: number) => attrs.map((a) => Array.from({ length: a.itemSize }, (_, c) => a.array[v * a.itemSize + c]).join(",")).join(";");
  const index = g.index?.array ?? Array.from({ length: g.attributes.position.count }, (_, i) => i);
  const out: string[] = [];
  for (let t = 0; t < index.length; t += 3) out.push([0, 1, 2].map((k) => corner(index[t + k])).join("|"));
  return out.sort();
}

describe("ground tiles", () => {
  it.each([
    ["terrain", terrainGeometry],
    ["kerbs", kerbGeometry],
  ])("cut the %s into tiles that cover it exactly once, edges shared to the bit (no cracks)", (_, make) => {
    const whole = make();
    const parts = tiles(whole);
    expect(parts.length).toBeGreaterThan(10);
    // The same triangles, each once, every corner with the same position, normal, uv and colour.
    expect(parts.flatMap(triangles).sort()).toEqual(triangles(whole));
    // Each tile inside one TILE square.
    for (const g of parts) {
      g.computeBoundingBox();
      const { min, max } = g.boundingBox!;
      expect(max.x - min.x).toBeLessThanOrEqual(TILE + 1e-6);
      expect(max.z - min.z).toBeLessThanOrEqual(TILE + 1e-6);
    }
  });
});

describe("Cuso and the kerbs", () => {
  const h = meshHeight();
  it("keeps his feet on the surface: never under it, only above it while hopping a kerb", () => {
    for (const path of PATHS) {
      for (let k = 0; k <= 2000; k++) {
        const { pos, mode } = samplePath(path, k / 2000);
        if (mode === "jump") continue;
        const [x, y, z] = pos;
        expect(y, `${x},${z}`).toBeGreaterThanOrEqual(surfaceAt(x, z) - 1e-6);
        const nearKerb = KERB_X.some((c) => Math.abs(x - c) <= HOP) || KERB_Z.some((c) => Math.abs(z - c) <= HOP);
        if (y - surfaceAt(x, z) > KERB + 1e-6) continue; // on a roof
        if (onLand(x, z) && !nearKerb) {
          expect(y - surfaceAt(x, z), `floats at ${x},${z}`).toBeLessThan(1e-6);
          expect(Math.abs(y - h(x, z)), `off the mesh at ${x},${z}`).toBeLessThan(0.03);
        }
      }
    }
  });
});
