import { describe, expect, it } from "vitest";
import { Box3, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { chapters } from "@/content/day";
import { CITY, blocksView, type Tower } from "@/scene/layout";
import { FOOTING } from "@/scene/materials";
import { REVEAL, ROOF_MARGIN, STYLES, floodlit, towerGeometry, towerPieces, towerStyle } from "@/scene/towers";

const towers = CITY.towers;
const bounds = (t: Tower) => {
  const { body, relief } = towerGeometry([t]);
  return new Box3().setFromBufferAttribute(body.attributes.position as never).union(new Box3().setFromBufferAttribute(relief.attributes.position as never));
};
const triangles = (g: BufferGeometry) => g.attributes.position.count / 3;
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

  it("builds finite, modest geometry for the whole skyline: a shadow-casting body and the window relief", () => {
    const { body, relief } = towerGeometry(towers);
    for (const g of [body, relief]) {
      for (const name of ["position", "normal", "aUv", "aInfo", "color"]) {
        expect(g.attributes[name], name).toBeDefined();
        expect(Array.from(g.attributes[name].array).every(Number.isFinite), name).toBe(true);
      }
      const n = g.attributes.normal.array;
      for (let i = 0; i < n.length; i += 3) expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeCloseTo(1, 4);
    }
    // The body casts the shadows: about what the whole skyline was before the relief.
    expect(triangles(body)).toBeLessThan(6000);
    expect(triangles(relief)).toBeGreaterThan(triangles(body));
    expect(triangles(body) + triangles(relief)).toBeLessThan(60000);
  });

  it("sets the glass back behind the wall: piers and fins stand in front of it, nothing covers it", () => {
    // One tower of each style; a sample of its windows.
    for (const style of STYLES) {
      const t = towers.find((x) => towerStyle(x).style === style)!;
      const { body, relief } = towerGeometry([t]);
      const solid = new MeshBasicMaterial({ side: DoubleSide });
      const meshes = [new Mesh(body, solid), new Mesh(relief, solid)];
      const ray = new Raycaster();
      const hit = (from: Vector3, dir: Vector3) => {
        ray.set(from, dir);
        return ray.intersectObjects(meshes, false)[0]?.distance;
      };
      // Glass faces: the punched panes in the relief, the curtain wall in the body.
      const glassPart = towerStyle(t).pane;
      const g = style === "glass" ? body : relief;
      const pos = g.attributes.position.array;
      const nor = g.attributes.normal.array;
      const info = g.attributes.aInfo.array;
      let checked = 0;
      for (let v = 0; v < pos.length / 3; v += style === "glass" ? 3 : 21) {
        if (Math.round(info[v * 3]) !== glassPart || Math.abs(nor[v * 3 + 1]) > 0.1) continue;
        const n = new Vector3(nor[v * 3], 0, nor[v * 3 + 2]);
        const c = new Vector3();
        for (let k = 0; k < 3; k++) c.add(new Vector3(pos[(v + k) * 3], pos[(v + k) * 3 + 1], pos[(v + k) * 3 + 2]));
        c.divideScalar(3);
        if (c.y < t.y + 2.5 || c.y > t.y + t.h - 2.3) continue; // between the lobby and the crown
        const id = `${style} tower at ${t.x},${t.z}, glass at ${c.toArray().map((x) => x.toFixed(2))}`;
        // A punched pane is exactly its opening: looking straight at it, it is the first thing the ray meets.
        if (style !== "glass") expect(hit(c.clone().addScaledVector(n, 1), n.clone().negate()), id).toBeCloseTo(1, 3);
        // Sweeping along the wall: the glass shows between piers (or fins), which stand in front of it.
        const along = new Vector3(-n.z, 0, n.x);
        let front = 0;
        let seen = false;
        for (let s = -0.6; s <= 0.6; s += 0.02) {
          const d = hit(c.clone().addScaledVector(n, 1).addScaledVector(along, s).setY(c.y + (style === "glass" ? Math.sin(s * 40) * 0.3 : 0)), n.clone().negate());
          if (d === undefined) continue;
          front = Math.max(front, 1 - d);
          seen ||= Math.abs(d - 1) < 1e-3;
        }
        expect(seen, id).toBe(true);
        expect(front, id).toBeGreaterThanOrEqual(style === "glass" ? 0.03 - 1e-4 : REVEAL - 1e-4);
        expect(front, id).toBeLessThanOrEqual(0.12 + 1e-4);
        checked++;
      }
      expect(checked, style).toBeGreaterThan(10);
    }
  });
});
