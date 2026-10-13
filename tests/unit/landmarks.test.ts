import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Object3D, Vector3, type BufferGeometry } from "three";
import { APARTMENT, FLAT, PYRAMID, ROOFTOP, SPIRE, apartmentPhotoWidth, apartmentRelief, apartmentWalls, box, cyl, merged, pyramidHalf } from "@/scene/landmarks";
import { STREET } from "@/scene/layout";

describe("landmark parts", () => {
  it("merges boxes and cylinders into one geometry that spans them all", () => {
    const g = merged([box([0, 0.5, 0], [1, 1, 1]), box([3, 1, 0], [1, 2, 1], [0, Math.PI / 4, 0]), cyl([-2, 2, 0], 0.2, 0.2, 4)]);
    g.computeBoundingBox();
    const b = g.boundingBox as Box3;
    expect(b.min.x).toBeCloseTo(-2.2, 1);
    expect(b.max.x).toBeCloseTo(3 + Math.SQRT1_2, 2);
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(4);
    expect(g.index).toBeNull();
  });

  it("tapers the pyramid from its base to Cuso's platform, with the spire beside him", () => {
    expect(pyramidHalf(0)).toBeCloseTo(PYRAMID.base);
    // the flat top of the crown is where Cuso stands: 28 above the ground (PYRAMID_TIP in day.ts)
    expect(PYRAMID.height).toBe(28);
    expect(pyramidHalf(PYRAMID.height)).toBeCloseTo(PYRAMID.top);
    expect(PYRAMID.top).toBeGreaterThan(0.5);
    // the spire rises just past the platform's edge (Cuso turns on the platform without touching it)
    // and starts inside the body, so it never floats
    const reach = Math.max(Math.abs(SPIRE.x), Math.abs(SPIRE.z));
    expect(reach - SPIRE.half).toBeGreaterThan(PYRAMID.top);
    expect(reach + SPIRE.half).toBeLessThan(pyramidHalf(SPIRE.base));
  });

  it("keeps the pyramid's base off the streets on either side (cars drive at z -16)", () => {
    const centreZ = -11;
    expect(centreZ - PYRAMID.base).toBeGreaterThan(-16 + STREET / 2);
    expect(centreZ + PYRAMID.base).toBeLessThan(-6 - STREET / 2);
  });
});

/** Texels in apartment.jpg. */
const APT = { w: 768, h: 1152 };

/**
 * The worst stretch of the photo on any relief face, placed by `m`: texels per
 * world unit along each edge over the wall's own density (1 = true scale).
 * Flat-colour faces must be one sample (no strip at all).
 */
function stretch(g: BufferGeometry, m: Matrix4, density: number) {
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
      const texels = Math.hypot((uv.getX(a) - uv.getX(b)) * APT.w, (uv.getY(a) - uv.getY(b)) * APT.h);
      const r = texels / len / density;
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
  }
  return { lo, hi };
}

describe("the 06:00 apartment facade", () => {
  it("never stretches the photo: square texels on every wall", () => {
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

  it("never smears the photo on its relief (sides and tops are flat colour, bay sides at most 1.7x)", () => {
    const g = apartmentRelief();
    const uv = g.attributes.aUv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i) > 1.5 ? uv.getX(i) - FLAT : uv.getX(i);
      expect(u >= 0 && u <= 1 && uv.getY(i) >= 0 && uv.getY(i) <= 1).toBe(true);
    }
    const o = new Object3D();
    o.scale.set(apartmentPhotoWidth(), ROOFTOP.roof - ROOFTOP.base, 1);
    o.updateMatrix();
    const r = stretch(g, o.matrix, APT.w / apartmentPhotoWidth());
    // a bay side shows the photo's foreshortened side window unfolded: up to 1.7x wider, never a thin strip
    expect(r.lo).toBeGreaterThan(1 / 1.7);
    expect(r.hi).toBeLessThan(1.05);
  });
});
