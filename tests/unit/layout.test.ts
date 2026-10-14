import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { CLEAR, FERRY, PYRAMID, WINGS, X_STREETS, Z_STREETS, STREET, blocksView, generateCity, insideBuilding, insideLand, pyramidHalf, sightClear } from "@/scene/layout";
import { BAY_ANCHORS, BAY_TOWERS, ROADS, bayDeckY, piers } from "@/scene/roads";

const city = generateCity();
const corners = (b: { x: number; z: number; w: number; d: number }) => [
  [b.x - b.w / 2, b.z - b.d / 2],
  [b.x + b.w / 2, b.z - b.d / 2],
  [b.x - b.w / 2, b.z + b.d / 2],
  [b.x + b.w / 2, b.z + b.d / 2],
];
const buildings = [...city.houses, ...city.towers];

describe("city layout", () => {
  it("is the same every time (seeded)", () => {
    expect(generateCity()).toEqual(city);
  });

  it("has neighbourhoods and a downtown", () => {
    expect(city.houses.length).toBeGreaterThan(150);
    expect(city.towers.length).toBeGreaterThanOrEqual(15);
    expect(city.trees.length).toBeGreaterThan(80);
    expect(city.lamps.length).toBeGreaterThan(25); // walking streets keep their sidewalks clear
  });

  it("keeps every building on land", () => {
    for (const b of buildings) for (const [x, z] of corners(b)) expect(insideLand(x, z), `${b.x},${b.z}`).toBe(true);
  });

  it("keeps streets free", () => {
    for (const b of buildings) {
      for (const sx of X_STREETS) expect(Math.abs(b.x - sx) >= b.w / 2 + STREET / 2 - 0.01, `x street ${sx}`).toBe(true);
      for (const sz of Z_STREETS) expect(Math.abs(b.z - sz) >= b.d / 2 + STREET / 2 - 0.01, `z street ${sz}`).toBe(true);
    }
  });

  it("leaves landmarks and camera views clear", () => {
    for (const b of buildings) {
      for (const [cx, cz, r] of CLEAR) expect(Math.hypot(b.x - cx, b.z - cz) >= r).toBe(true);
      expect(blocksView(b.x, b.z, b.y + b.h, Math.max(b.w, b.d) / 2)).toBe(false);
    }
  });

  it("keeps the Transamerica Pyramid the tallest thing around (Cuso stands on it)", () => {
    const seo = chapters.find((c) => c.id === "seo")!;
    for (const t of city.towers) {
      if (Math.hypot(t.x - seo.spot[0], t.z - seo.spot[2]) < 22) expect(t.y + t.h).toBeLessThan(seo.spot[1] - 8);
    }
  });

  it("never starts a chapter shot inside a building", () => {
    for (const c of chapters) expect(insideBuilding(...c.camera.position), c.id).toBe(false);
  });

  it("keeps the camera out of the Transamerica Pyramid, its wings and the Ferry Building", () => {
    const g = heightAt(PYRAMID.x, PYRAMID.z);
    // inside the tapered body, low and high, and just outside its faces
    expect(insideBuilding(PYRAMID.x + 2, g + 2, PYRAMID.z)).toBe(true);
    expect(insideBuilding(PYRAMID.x, g + 20, PYRAMID.z - pyramidHalf(20) + 0.1)).toBe(true);
    expect(insideBuilding(PYRAMID.x, g + 20, PYRAMID.z - pyramidHalf(20) - 0.8)).toBe(false); // north face: no wing there
    expect(insideBuilding(PYRAMID.x, g + PYRAMID.height + 1, PYRAMID.z)).toBe(false); // over the platform, where Cuso stands
    for (const [side, y0, y1] of WINGS) expect(insideBuilding(PYRAMID.x + side * (pyramidHalf(y1) + 0.2), g + (y0 + y1) / 2, PYRAMID.z)).toBe(true);
    const fg = heightAt(FERRY.x, FERRY.z);
    expect(insideBuilding(FERRY.x, fg + 2, FERRY.z + 4)).toBe(true); // the hall
    expect(insideBuilding(FERRY.x, fg + 9, FERRY.z)).toBe(true); // the clock tower
    expect(insideBuilding(FERRY.x - FERRY.plinth[0], fg + 2, FERRY.z)).toBe(false); // the Embarcadero in front
  });

  it("keeps the camera out of the Bay Bridge's anchorage, tower piers and towers, and the roads' piers (it passed through the anchorage on the way to the pier)", () => {
    const [west] = BAY_ANCHORS;
    expect(insideBuilding(west, bayDeckY(west) - 2, 14)).toBe(true);
    expect(insideBuilding(west + 1.3, 3, 14)).toBe(true); // within the air around its face
    for (const x of BAY_TOWERS) {
      expect(insideBuilding(x, 1.5, 14)).toBe(true); // the pier
      expect(insideBuilding(x, 20, 14 + 2.2)).toBe(true); // a steel leg
    }
    for (const road of ROADS) for (const [x, z, g, top] of piers(road)) expect(insideBuilding(x, (g + top) / 2, z)).toBe(true);
    // but only as wide as it is: the approach pier beside the waterfront street leaves its sidewalk clear
    expect(insideBuilding(27.4, 1.5, 14)).toBe(false);
    // under the deck between the towers is open water: the camera may fly there
    expect(insideBuilding(61, 3, 14)).toBe(false);
    // from the 18:00 shot to the 22:00 one at street height, the anchorage is in the way
    expect(sightClear({ x: west, y: 3, z: 5 }, { x: west, y: 3, z: 24 })).toBe(false);
  });

  it("never puts a building on Cuso's spot", () => {
    for (const c of chapters) {
      for (const b of buildings) {
        const inside = Math.abs(c.spot[0] - b.x) < b.w / 2 && Math.abs(c.spot[2] - b.z) < b.d / 2 && c.spot[1] < b.y + b.h;
        expect(inside, `${c.id} inside building at ${b.x},${b.z}`).toBe(false);
      }
    }
  });
});
