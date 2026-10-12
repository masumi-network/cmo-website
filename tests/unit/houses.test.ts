import { Box3, Matrix4, Object3D, Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { FACADES, FLAT, RELIEF_DEPTH, WINDOW_MAP, placeRelief, reliefDepth, reliefGeometry, tileOf, windowIds } from "@/scene/houses";
import { APARTMENT, ROOFTOP, apartmentPhotoWidth, apartmentRelief, apartmentWalls } from "@/scene/landmarks";
import { CITY, HOUSE_GAP } from "@/scene/layout";

const inside = (x: number, lo: number, hi: number) => x >= lo - 1e-6 && x <= hi + 1e-6;
/** Texels in one atlas tile, and in apartment.jpg. */
const TILE = { w: 2048 / 3, h: 1024 };
const APT = { w: 768, h: 1152 };

/**
 * The worst stretch of the photo on any relief face, placed by `m`: texels per
 * world unit along each edge over the wall's own density (1 = true scale).
 * Flat-colour faces must be one sample (no strip at all).
 */
function stretch(g: BufferGeometry, m: Matrix4, tex: { w: number; h: number }, density: number) {
  const pos = g.attributes.position;
  const uv = g.attributes.aUv;
  const idx = g.index!;
  const p = [new Vector3(), new Vector3(), new Vector3()];
  let lo = Infinity;
  let hi = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const k = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    if (k.every((i) => uv.getX(i) > 1.5)) {
      expect(k.every((i) => uv.getX(i) === uv.getX(k[0]) && uv.getY(i) === uv.getY(k[0]))).toBe(true);
      continue;
    }
    k.forEach((i, j) => p[j].fromBufferAttribute(pos, i).applyMatrix4(m));
    for (let j = 0; j < 3; j++) {
      const [a, b] = [k[j], k[(j + 1) % 3]];
      const len = p[j].distanceTo(p[(j + 1) % 3]);
      if (len < 0.02) continue;
      const texels = Math.hypot((uv.getX(a) - uv.getX(b)) * tex.w, (uv.getY(a) - uv.getY(b)) * tex.h);
      const r = texels / len / density;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  }
  return { lo, hi };
}

describe("row house facades", () => {
  it("measures all six atlas tiles, inside the tile", () => {
    expect(FACADES).toHaveLength(6);
    for (const f of FACADES) {
      const rects = [f.bay.wall, f.bay.front, ...f.windows.map((r) => r.slice(0, 2)), ...f.ledges.map((r) => r.slice(0, 2)), ...f.posts.map((r) => r.slice(0, 2)), f.entry.slice(0, 2), f.steps.slice(0, 2)];
      for (const [a, b] of rects) expect(inside(a, 0, 1) && inside(b, 0, 1) && a < b).toBe(true);
      const vs = [f.cornice, ...f.windows.flatMap((r) => r.slice(2)), ...f.bay.v, ...f.bay.bands.flat(), ...f.ledges.flatMap((r) => r.slice(2)), ...f.posts.flatMap((r) => r.slice(2)), ...f.entry.slice(2), ...f.steps.slice(2)];
      for (const v of vs) expect(inside(v, 0, 1)).toBe(true);
      for (const u of f.brackets) expect(inside(u, 0, 1)).toBe(true);
      // the bay's front sits inside its walls
      expect(f.bay.front[0]).toBeGreaterThan(f.bay.wall[0]);
      expect(f.bay.front[1]).toBeLessThan(f.bay.wall[1]);
    }
  });

  it.each(FACADES.map((_, i) => i))("tile %i: relief is finite, maps inside the photo and stays on its wall", (tile) => {
    const g = reliefGeometry(tile);
    const pos = g.attributes.position;
    const uv = g.attributes.aUv;
    expect(pos.count).toBeGreaterThan(50);
    expect(uv.count).toBe(pos.count);
    for (let i = 0; i < pos.count; i++) {
      for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), uv.getX(i), uv.getY(i)]) expect(Number.isFinite(v)).toBe(true);
      const u = uv.getX(i) > 1.5 ? uv.getX(i) - FLAT : uv.getX(i);
      expect(inside(u, 0, 1) && inside(uv.getY(i), 0, 1)).toBe(true);
      // local frame: x is a share of the width, y of the height, z is world units out from the wall
      expect(inside(pos.getX(i), -0.5, 0.5)).toBe(true);
      expect(inside(pos.getY(i), -0.25, 1)).toBe(true);
      expect(inside(pos.getZ(i), 0, RELIEF_DEPTH)).toBe(true);
    }
  });

  it("never sticks far into the sidewalk or into the next house", () => {
    expect(RELIEF_DEPTH).toBeLessThanOrEqual(0.6);
    const o = new Object3D();
    const m = new Matrix4();
    const geos = FACADES.map((_, t) => reliefGeometry(t));
    CITY.houses.forEach((h, i) => {
      const g = geos[tileOf(h, i)];
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      placeRelief(h, o);
      o.updateMatrix();
      g.computeBoundingBox();
      const b = new Box3().copy(g.boundingBox!).applyMatrix4(m.copy(o.matrix));
      const front = h.z + (h.facing * h.d) / 2;
      expect(b.min.x).toBeGreaterThanOrEqual(h.x - h.w / 2 - 1e-6);
      expect(b.max.x).toBeLessThanOrEqual(h.x + h.w / 2 + 1e-6);
      // out from the front wall only, on the street side
      const out = [b.min.z, b.max.z].map((z) => (z - front) * h.facing);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(-1e-6);
      expect(Math.max(...out)).toBeLessThanOrEqual(reliefDepth(h) + 1e-6);
      expect(b.max.y).toBeLessThanOrEqual(h.y + h.h + 1e-6);
      // the front of the photo: local (0, 0.5, 0) is the middle of the facade
      const mid = new Vector3(0, 0.5, 0).applyMatrix4(o.matrix);
      expect(mid.x).toBeCloseTo(h.x, 6);
      expect(mid.z).toBeCloseTo(front, 6);
    });
  });

  it("gives every window its own id, and the walls none", () => {
    const ids = windowIds();
    const { width, height } = WINDOW_MAP;
    // (u, v) on tile t to the map, as the shader samples the atlas
    const at = (t: number, u: number, v: number) => {
      const x = Math.floor((((t % 3) + u) / 3) * width);
      const y = Math.floor((t < 3 ? 0.5 + v / 2 : v / 2) * height);
      return ids[y * width + x];
    };
    const seen = new Set<number>();
    FACADES.forEach((f, t) => {
      expect(f.windows.length).toBeGreaterThanOrEqual(7);
      for (const [u0, u1, v0, v1] of f.windows) {
        const id = at(t, (u0 + u1) / 2, (v0 + v1) / 2);
        expect(id).toBeGreaterThan(0);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      expect(at(t, 0.5, 0.98)).toBe(0); // cornice
      expect(at(t, 0.01, 0.01)).toBe(0); // bottom corner
    });
  });

  it("is full depth except where Cuso walks past", () => {
    const depths = CITY.houses.map(reliefDepth);
    expect(depths.every((d) => d >= 0 && d <= RELIEF_DEPTH)).toBe(true);
    // most houses get the whole relief (less on narrow houses, so bays keep their angle)
    const full = CITY.houses.filter((h, i) => Math.abs(depths[i] - RELIEF_DEPTH * Math.min(1, (h.w - HOUSE_GAP) / 3)) < 1e-9);
    expect(full.length).toBeGreaterThan(CITY.houses.length * 0.7);
  });

  it("keeps the houses and their tiles as they are", () => {
    expect(CITY.houses).toHaveLength(151);
    CITY.houses.forEach((h, i) => expect(h.floors === 3 ? [1, 3, 5] : [0, 2, 4]).toContain(tileOf(h, i)));
  });

  it("never stretches a facade photo: square texels on every house and the apartment", () => {
    for (const h of CITY.houses) {
      const across = TILE.w / (h.w - HOUSE_GAP);
      const up = TILE.h / h.h;
      expect(Math.abs(across / up - 1)).toBeLessThan(0.03);
    }
    const g = apartmentWalls();
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (const f of [0, 1, 4, 5]) {
      // corners 0 and 1 run across the wall, 0 and 2 up it
      const [a, b, c] = [f * 4, f * 4 + 1, f * 4 + 2];
      const wide = Math.hypot(pos.getX(a) - pos.getX(b), pos.getZ(a) - pos.getZ(b));
      const across = (Math.abs(uv.getX(a) - uv.getX(b)) * APT.w) / wide;
      const up = (Math.abs(uv.getY(a) - uv.getY(c)) * APT.h) / Math.abs(pos.getY(a) - pos.getY(c));
      expect(Math.abs(across / up - 1)).toBeLessThan(0.03);
    }
    expect(apartmentPhotoWidth()).toBeCloseTo((ROOFTOP.roof - ROOFTOP.base) / APARTMENT.aspect, 9);
  });

  it("never smears the photo on a relief face (sides and tops are flat colour, bay sides at most 1.7x)", () => {
    const o = new Object3D();
    const geos = FACADES.map((_, t) => reliefGeometry(t));
    let worst = { lo: Infinity, hi: 0 };
    CITY.houses.forEach((h, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      placeRelief(h, o);
      o.updateMatrix();
      const r = stretch(geos[tileOf(h, i)], o.matrix, TILE, TILE.w / (h.w - HOUSE_GAP));
      worst = { lo: Math.min(worst.lo, r.lo), hi: Math.max(worst.hi, r.hi) };
    });
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(apartmentPhotoWidth(), ROOFTOP.roof - ROOFTOP.base, 1);
    o.updateMatrix();
    const apt = stretch(apartmentRelief(), o.matrix, APT, APT.w / apartmentPhotoWidth());
    for (const r of [worst, apt]) {
      // a bay side shows the photo's foreshortened side window unfolded: up to 1.7x wider, never a thin strip
      expect(r.lo).toBeGreaterThan(1 / 1.7);
      expect(r.hi).toBeLessThan(1.05);
    }
  });
});
