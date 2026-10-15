import { describe, expect, it } from "vitest";
import { DoubleSide, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3, type BufferGeometry } from "three";
import { chapters } from "@/content/day";
import { CITY, generateCity, type House, type Tower } from "@/scene/layout";
import { bodyGeometry } from "@/scene/house-models";
import { placeBody } from "@/scene/houses";
import { towerGeometry, towerPieces } from "@/scene/towers";
import { LITE_KINDS, SIZE, footprint, roofClutter, roofs, type Item } from "@/scene/roof-clutter";
import { clutterGeometry } from "@/scene/clutter";

const full = roofClutter(false);
const lite = roofClutter(true);
const ROOFS = roofs();
const EPS = 1e-3;

/** The building an item stands on. */
const building = (it: Item) => ROOFS[it.roof].on;

/** World-space solid of one building, for a ray straight down. */
const solids = new Map<string, Mesh>();
function solidOf(on: { tower: Tower } | { house: House }) {
  const key = "tower" in on ? `t${on.tower.x},${on.tower.z}` : `h${on.house.x},${on.house.z}`;
  if (!solids.has(key)) {
    let g: BufferGeometry;
    if ("tower" in on) g = towerGeometry([on.tower]).body;
    else {
      const o = new Object3D();
      placeBody(on.house, o);
      o.updateMatrix();
      g = bodyGeometry(false).clone().applyMatrix4(o.matrix);
    }
    solids.set(key, new Mesh(g, new MeshBasicMaterial({ side: DoubleSide })));
  }
  return solids.get(key)!;
}
const ray = new Raycaster();
const firstHit = (m: Mesh, x: number, z: number) => {
  ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
  return ray.intersectObject(m)[0]?.point.y ?? -Infinity;
};

const overlap = (a: { x0: number; x1: number; z0: number; z1: number }, b: typeof a, gap = 0) =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.z0 < b.z1 + gap && b.z0 < a.z1 + gap;

/** Same test as layout.ts blocksView, over every chapter's desktop and phone shot. */
const blocksShot = (x: number, z: number, h: number, r: number) =>
  chapters.some((c) =>
    [c.camera, c.phone].some(({ position: p, target: q }) => {
      for (let s = 0; s <= 1.0001; s += 0.04) {
        const px = p[0] + (q[0] - p[0]) * s;
        const py = p[1] + (q[1] - p[1]) * s;
        const pz = p[2] + (q[2] - p[2]) * s;
        if (Math.hypot(px - x, pz - z) < r + 1.2 && py < h + 0.8) return true;
      }
      return false;
    }),
  );

describe("rooftop clutter", () => {
  it("is the same on every visit and leaves the layout alone", () => {
    expect(roofClutter(false)).toEqual(full);
    expect(roofClutter(true)).toEqual(lite);
    expect(JSON.stringify(generateCity())).toBe(JSON.stringify(CITY));
  });

  it("stands on the real roof of its building: towers on the top tier, houses on the flat roof behind the false front, never a gable", () => {
    for (const it of full) {
      const on = building(it);
      if ("house" in on) expect(on.house.roof).toBe("flat");
      const m = solidOf(on);
      const f = footprint(it);
      // A 3 by 3 grid over the footprint: the first thing under each point is the roof at the item's foot.
      for (const u of [0.02, 0.5, 0.98])
        for (const v of [0.02, 0.5, 0.98]) {
          const y = firstHit(m, f.x0 + (f.x1 - f.x0) * u, f.z0 + (f.z1 - f.z0) * v);
          expect(Math.abs(y - it.y), `${it.kind} at ${it.x.toFixed(2)},${it.z.toFixed(2)}`).toBeLessThan(EPS);
        }
    }
  });

  it("keeps off roof edges, the towers' own rooftop parts, the chimneys and each other", () => {
    for (const it of full) {
      const on = building(it);
      const f = footprint(it);
      if ("tower" in on) {
        const parts = towerPieces(on.tower, false).filter((p) => p.group !== undefined);
        for (const p of parts) expect(overlap(f, { x0: p.min[0], x1: p.max[0], z0: p.min[2], z1: p.max[2] }, 0.1)).toBe(false);
        // The usable roof is inside the parapet or the curtain wall's metal rim.
        const t = on.tower;
        const top = t.tiers[t.tiers.length - 1];
        expect(f.x0).toBeGreaterThan(t.x - top.w / 2 + 0.3);
        expect(f.x1).toBeLessThan(t.x + top.w / 2 - 0.3);
        expect(f.z0).toBeGreaterThan(t.z - top.d / 2 + 0.3);
        expect(f.z1).toBeLessThan(t.z + top.d / 2 - 0.3);
      } else {
        const h = on.house;
        const front = h.z + (h.facing * h.d) / 2;
        // Behind the false front and its cornice, inside the side walls.
        expect(Math.min(Math.abs(f.z0 - front), Math.abs(f.z1 - front))).toBeGreaterThan(0.3);
        expect(f.x0).toBeGreaterThan(h.x - h.w / 2 + 0.1);
        expect(f.x1).toBeLessThan(h.x + h.w / 2 - 0.1);
      }
    }
    for (let i = 0; i < full.length; i++)
      for (let j = i + 1; j < full.length; j++) expect(overlap(footprint(full[i]), footprint(full[j]), 0.05)).toBe(false);
  });

  it("stays off every roof Cuso stands on and out of every chapter shot, desktop and phone", () => {
    for (const it of full) {
      for (const c of chapters) expect(Math.hypot(it.x - c.spot[0], it.z - c.spot[2])).toBeGreaterThan(4);
      expect(blocksShot(it.x, it.z, it.y + SIZE[it.kind].h, Math.max(SIZE[it.kind].w, SIZE[it.kind].d) / 2)).toBe(false);
    }
  });

  it("is restrained: a few items on some roofs, not every roof", () => {
    const perRoof = new Map<number, number>();
    for (const it of full) perRoof.set(it.roof, (perRoof.get(it.roof) ?? 0) + 1);
    expect(Math.max(...perRoof.values())).toBeLessThanOrEqual(3);
    const houseRoofs = ROOFS.filter((r) => "house" in r.on).length;
    const houseUsed = [...perRoof.keys()].filter((k) => "house" in ROOFS[k].on).length;
    expect(houseUsed / houseRoofs).toBeGreaterThan(0.25);
    expect(houseUsed / houseRoofs).toBeLessThan(0.7);
    const towerUsed = [...perRoof.keys()].filter((k) => "tower" in ROOFS[k].on).length;
    expect(towerUsed).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(40);
    expect(full.length).toBeLessThan(260);
    // Gables never carry anything; every flat house roof and flat-topped tower is a candidate.
    expect(ROOFS.every((r) => !("house" in r.on) || r.on.house.roof === "flat")).toBe(true);
  });

  it("gives phones fewer, bigger items: a subset of the full set", () => {
    expect(lite.length).toBeLessThan(full.length * 0.8);
    expect(lite.length).toBeGreaterThan(0);
    for (const it of lite) {
      expect(LITE_KINDS).toContain(it.kind);
      expect(full).toContainEqual(it);
    }
  });

  it("builds one small merged mesh: finite, low triangle counts, lite lighter", () => {
    const count = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const g = clutterGeometry(full, false);
    const gl = clutterGeometry(lite, true);
    for (const v of g.attributes.position.array) expect(Number.isFinite(v)).toBe(true);
    expect(count(g)).toBeLessThan(12_000);
    expect(count(gl)).toBeLessThan(count(g) * 0.6);
    expect(g.attributes.color).toBeDefined();
  });
});
