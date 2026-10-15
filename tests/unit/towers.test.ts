import { describe, expect, it } from "vitest";
import { Box3, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { chapters } from "@/content/day";
import { CITY, blocksView, type Tower } from "@/scene/layout";
import { FOOTING } from "@/scene/materials";
import { REVEAL, ROOF_MARGIN, STYLES, beltLevels, corniceProfile, floodlit, towerGeometry, towerPieces, towerStyle } from "@/scene/towers";

const towers = CITY.towers;
const bounds = (t: Tower) => {
  const { body, relief } = towerGeometry([t]);
  return new Box3().setFromBufferAttribute(body.attributes.position as never).union(new Box3().setFromBufferAttribute(relief.attributes.position as never));
};
const triangles = (g: BufferGeometry) => g.attributes.position.count / 3;
const EPS = 1e-6;
const of = (style: string) => towers.filter((t) => towerStyle(t).style === style);

/** The y extent of every window pane of a tower (punched panes live in the relief). */
const panes = (t: Tower) => {
  const { relief } = towerGeometry([t]);
  const pos = relief.attributes.position.array;
  const info = relief.attributes.aInfo.array;
  const out: [number, number][] = [];
  for (let v = 0; v < pos.length / 3; v += 3) {
    if (Math.round(info[v * 3]) !== towerStyle(t).pane) continue;
    const ys = [0, 1, 2].map((k) => pos[(v + k) * 3 + 1]);
    out.push([Math.min(...ys), Math.max(...ys)]);
  }
  return out;
};

type Tri = { n: Vector3; d: number; p: Vector3[]; look: string };
/**
 * Pairs of triangles that face the same way in the same plane, overlap by a real area and shade differently
 * (another part or colour): they would z-fight. Twins of one part and colour shade identically, so they never show.
 */
function coplanarOverlaps(gs: BufferGeometry[]) {
  const tris: Tri[] = [];
  for (const g of gs) {
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 9) {
      const p = [0, 1, 2].map((k) => new Vector3(pos[i + k * 3], pos[i + k * 3 + 1], pos[i + k * 3 + 2]));
      const n = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
      const v = i / 3;
      const look = [g.attributes.aInfo.array[v * 3], ...Array.from(g.attributes.color.array.slice(v * 3, v * 3 + 3), (c) => c.toFixed(3))].join();
      tris.push({ n, d: n.dot(p[0]), p, look });
    }
  }
  const buckets = new Map<string, Tri[]>();
  for (const t of tris) {
    const key = t.n.toArray().map((x) => Math.round(x * 1000)).join(",");
    buckets.set(key, [...(buckets.get(key) ?? []), t]);
  }
  /** Separating axis test in the plane: overlap only if every axis overlaps by more than a hair. */
  const overlap = (a: Tri, b: Tri) => {
    const u = Math.abs(a.n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    const e1 = u.cross(a.n).normalize();
    const e2 = a.n.clone().cross(e1);
    const flat = (t: Tri) => t.p.map((q) => [q.dot(e1), q.dot(e2)]);
    const A = flat(a);
    const B = flat(b);
    for (const poly of [A, B]) {
      for (let i = 0; i < 3; i++) {
        const [x0, y0] = poly[i];
        const [x1, y1] = poly[(i + 1) % 3];
        const ax = [y0 - y1, x1 - x0];
        const len = Math.hypot(ax[0], ax[1]);
        const proj = (P: number[][]) => P.map(([x, y]) => (x * ax[0] + y * ax[1]) / len);
        const pa = proj(A);
        const pb = proj(B);
        if (Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) < 1e-4) return false;
      }
    }
    return true;
  };
  const found: string[] = [];
  for (const list of buckets.values()) {
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && list[j].d - list[i].d < 1e-4; j++) {
        if (list[i].look !== list[j].look && overlap(list[i], list[j])) found.push(`${list[i].n.toArray().map((x) => x.toFixed(2))} at ${list[i].p[0].toArray().map((x) => x.toFixed(3))}`);
      }
    }
  }
  return found;
}

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

  it("profiles a strong cornice for stone and loft towers: the corona projects most, at the roof line, inside the tier", () => {
    expect(corniceProfile("glass", true)).toBeNull();
    for (const style of ["deco", "loft"] as const) {
      const inset = towerStyle(of(style)[0]).inset;
      expect(inset, style).toBeGreaterThanOrEqual(0.15);
      for (const top of [true, false]) {
        const c = corniceProfile(style, top)!;
        const outs = c.steps.map((s) => s.out);
        const id = `${style} ${top ? "crown" : "setback"}`;
        for (const s of c.steps) {
          expect(s.h, id).toBeGreaterThan(0);
          expect(s.out, id).toBeGreaterThan(0);
          expect(s.out, id).toBeLessThanOrEqual(inset + EPS);
        }
        // The corona: the deepest step, last under the roof line.
        expect(outs[outs.length - 1], id).toBe(Math.max(...outs));
        expect(Math.max(...outs), id).toBeGreaterThanOrEqual(top ? 0.15 : 0.12);
        expect(c.parapet.out, id).toBeLessThan(Math.max(...outs));
      }
      const height = (top: boolean) => corniceProfile(style, top)!.steps.reduce((s, x) => s + x.h, 0);
      expect(height(true), style).toBeGreaterThan(height(false));
    }
  });

  it("crowns every stone and loft tower with a projecting cornice that casts a shadow and stays inside the footprint", () => {
    for (const t of [...of("deco"), ...of("loft")]) {
      const s = towerStyle(t);
      const pieces = towerPieces(t, false);
      t.tiers.forEach((tier, i) => {
        const id = `tier ${i} of ${s.style} tower at ${t.x},${t.z}`;
        const cornice = pieces.filter(
          (p) =>
            p.shape === "band" &&
            !p.fine &&
            p.min[1] >= t.y + tier.y + 1 &&
            p.max[1] <= t.y + tier.y + tier.h + ROOF_MARGIN &&
            p.max[0] - p.min[0] >= tier.w - 2 * s.inset + 2 * 0.12 - EPS &&
            p.max[2] - p.min[2] >= tier.d - 2 * s.inset + 2 * 0.12 - EPS,
        );
        expect(cornice.length, id).toBeGreaterThan(0);
        for (const p of cornice) {
          expect(p.max[0] - p.min[0], id).toBeLessThanOrEqual(tier.w + EPS);
          expect(p.max[2] - p.min[2], id).toBeLessThanOrEqual(tier.d + EPS);
        }
      });
    }
  });

  it("runs belt courses on storey lines of stone towers, between a head and the sill above, never across glass", () => {
    for (const style of ["glass", "loft"]) for (const t of of(style)) t.tiers.forEach((_, i) => expect(beltLevels(t, i), style).toEqual([]));
    for (const t of of("deco")) {
      const id = `deco tower at ${t.x},${t.z}`;
      const levels = t.tiers.flatMap((_, i) => beltLevels(t, i));
      expect(levels.length, id).toBeGreaterThan(0);
      const belts = towerPieces(t, false).filter((p) => p.shape === "band" && p.fine);
      expect(belts.length, id).toBe(levels.length);
      const rows = panes(t);
      for (const y of levels) {
        const belt = belts.find((p) => p.min[1] < y && p.max[1] > y)!;
        expect(belt, `${id}, belt at ${y}`).toBeDefined();
        const [a, b] = [belt.min[1], belt.max[1]];
        for (const [lo, hi] of rows) expect(Math.min(b, hi) - Math.max(a, lo), `${id}, belt at ${y}`).toBeLessThan(1e-4);
        expect(rows.some(([, hi]) => hi <= a + 1e-4 && a - hi < 0.4), `${id}: a head under the belt at ${y}`).toBe(true);
        expect(rows.some(([lo]) => lo >= b - 1e-4 && lo - b < 0.4), `${id}: a sill over the belt at ${y}`).toBe(true);
      }
    }
  });

  it("never stacks two faces in one plane (no z-fighting between cornices, belts, piers and sills)", () => {
    for (const t of towers) {
      const { body, relief } = towerGeometry([t]);
      const found = coplanarOverlaps([body, relief]);
      expect(found.slice(0, 5), `${towerStyle(t).style} tower at ${t.x},${t.z}: ${found.length}`).toEqual([]);
    }
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
