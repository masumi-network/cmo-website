import { describe, expect, it } from "vitest";
import { Box3 } from "three";
import { chapters } from "@/content/day";
import { CITY, blocksView, type Tower } from "@/scene/layout";
import { FOOTING } from "@/scene/materials";
import { ROOF_MARGIN, STYLES, floodlit, towerGeometry, towerPieces, towerStyle } from "@/scene/towers";

const towers = CITY.towers;
const bounds = (t: Tower) => new Box3().setFromBufferAttribute(towerGeometry([t]).attributes.position as never);
const EPS = 1e-6;

describe("towers", () => {
  it("gives every tower a style from its own data, and the city all three", () => {
    const styles = towers.map((t) => towerStyle(t).style);
    for (const s of styles) expect(STYLES).toContain(s);
    for (const s of STYLES) expect(styles).toContain(s);
    for (const t of towers) expect(towerStyle({ ...t, tiers: t.tiers.map((x) => ({ ...x })) })).toEqual(towerStyle(t));
  });

  it("keeps every part inside the footprint, down to the footing and at most ROOF_MARGIN over the top", () => {
    expect(ROOF_MARGIN).toBeLessThanOrEqual(1);
    for (const t of towers) {
      const b = bounds(t);
      const id = `tower at ${t.x},${t.z}`;
      expect(b.min.x, id).toBeGreaterThanOrEqual(t.x - t.w / 2 - EPS);
      expect(b.max.x, id).toBeLessThanOrEqual(t.x + t.w / 2 + EPS);
      expect(b.min.z, id).toBeGreaterThanOrEqual(t.z - t.d / 2 - EPS);
      expect(b.max.z, id).toBeLessThanOrEqual(t.z + t.d / 2 + EPS);
      expect(b.min.y, id).toBeCloseTo(t.y - FOOTING, 5);
      expect(b.max.y, id).toBeLessThanOrEqual(t.y + t.h + ROOF_MARGIN + EPS);
      // The silhouette still reaches the tower's height.
      expect(b.max.y, id).toBeGreaterThanOrEqual(t.y + t.h - EPS);
    }
  });

  it("sets rooftop parts on a roof of their own tower, never floating", () => {
    for (const t of towers) {
      const pieces = towerPieces(t, false);
      const solids = pieces.filter((p) => p.shape === "box" && p.group === undefined);
      const groups = new Set(pieces.flatMap((p) => (p.group === undefined ? [] : [p.group])));
      for (const g of groups) {
        const parts = pieces.filter((p) => p.group === g);
        const lo = [0, 1, 2].map((k) => Math.min(...parts.map((p) => p.min[k])));
        const hi = [0, 1, 2].map((k) => Math.max(...parts.map((p) => p.max[k])));
        const under = solids.find(
          (s) => Math.abs(s.max[1] - lo[1]) < EPS && s.min[0] <= lo[0] + EPS && s.max[0] >= hi[0] - EPS && s.min[2] <= lo[2] + EPS && s.max[2] >= hi[2] - EPS,
        );
        expect(under, `rooftop item ${g} on tower at ${t.x},${t.z}`).toBeDefined();
      }
    }
    // Calm, not cluttered: a few rooftop items per tower.
    const counts = towers.map((t) => new Set(towerPieces(t, false).flatMap((p) => (p.group === undefined ? [] : [p.group]))).size);
    expect(Math.max(...counts)).toBeLessThanOrEqual(4);
    expect(counts.some((c) => c > 0)).toBe(true);
  });

  it("keeps the Transamerica Pyramid the tallest thing around, rooftop parts included", () => {
    const seo = chapters.find((c) => c.id === "seo")!;
    for (const t of towers) {
      if (Math.hypot(t.x - seo.spot[0], t.z - seo.spot[2]) < 22) expect(bounds(t).max.y).toBeLessThan(seo.spot[1] - 8);
    }
  });

  it("keeps every camera's view clear, rooftop parts included", () => {
    for (const t of towers) expect(blocksView(t.x, t.z, bounds(t).max.y, Math.max(t.w, t.d) / 2)).toBe(false);
  });

  it("floodlights one or two stone crowns at night", () => {
    const lit = floodlit(towers);
    expect(lit.size).toBeGreaterThanOrEqual(1);
    expect(lit.size).toBeLessThanOrEqual(2);
    for (const t of lit) expect(towerStyle(t).style).toBe("deco");
  });

  it("builds finite, modest geometry for the whole skyline", () => {
    const g = towerGeometry(towers);
    for (const name of ["position", "normal", "aUv", "aInfo", "color"]) {
      expect(g.attributes[name], name).toBeDefined();
      expect(Array.from(g.attributes[name].array).every(Number.isFinite), name).toBe(true);
    }
    const n = g.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 4);
    const triangles = g.attributes.position.count / 3;
    expect(triangles).toBeLessThan(12000);
  });
});
