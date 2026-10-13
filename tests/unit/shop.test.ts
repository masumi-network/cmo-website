// The 07:00 Hayes Valley coffee shop (shop.tsx): a modelled two-storey
// corner building with a painted timber shopfront, real glass and a cafe
// inside. Everything stays in its footprint or on its own sidewalk, off the
// street and off Cuso's routes, in a handful of draw calls.

import { Vector3, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { SLOT, SLOTS } from "@/scene/house-models";
import { groundAt, streetDrop } from "@/scene/grid";
import { PATHS } from "@/scene/routes";
import { SHOP, SHOP_SIGN, shopParts } from "@/scene/shop";
import { LAMP } from "@/scene/street";

const parts = shopParts();
const EPS = 1e-6;

/** Every vertex of a part in world coordinates. */
function points(g: BufferGeometry) {
  const pos = g.attributes.position;
  return Array.from({ length: pos.count }, (_, i) => new Vector3(SHOP.x + pos.getX(i), SHOP.ground + pos.getY(i), SHOP.z + pos.getZ(i)));
}
const inFootprint = (p: Vector3, grow = 0) => p.x >= SHOP.x0 - grow - EPS && p.x <= SHOP.x1 + grow + EPS && p.z >= SHOP.z0 - grow - EPS && p.z <= SHOP.z1 + grow + EPS;
const inBox = (p: Vector3, b: (typeof SHOP.furniture)[number]) => p.x >= b.x0 - EPS && p.x <= b.x1 + EPS && p.z >= b.z0 - EPS && p.z <= b.z1 + EPS && p.y >= b.y0 - EPS && p.y <= b.y1 + EPS;
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Cuso's whole day, every 0.25 in x and z. */
const ROUTE: [number, number][] = PATHS.flatMap(({ points: pts }) =>
  pts.slice(1).flatMap((b, i) => {
    const a = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);

describe("the Hayes Valley shop", () => {
  it("is a few parts with finite vertices and a modest triangle count", () => {
    for (const [name, g] of Object.entries(parts)) {
      const pos = g.attributes.position;
      expect(pos.count, name).toBeGreaterThan(0);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]), name).toBe(true);
    }
    const total = Object.values(parts).reduce((s, g) => s + tris(g), 0);
    expect(total).toBeLessThan(12_000);
  });

  it("paints the building with the row houses' material: known paints, every pane a window", () => {
    const { shell } = parts;
    const slot = shell.attributes.aSlot;
    const win = shell.attributes.aWin;
    expect(slot.count).toBe(shell.attributes.position.count);
    for (let i = 0; i < slot.count; i++) {
      expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
      expect(win.getX(i) > 0).toBe(slot.getX(i) === SLOT.glass);
    }
    // upper windows on the front, the corner side and the far side
    expect(new Set(Array.from(win.array).filter((w) => w > 0)).size).toBeGreaterThanOrEqual(7);
  });

  it("gives the painted parts a colour and a glow, the cafe inside glowing and the street side not", () => {
    for (const [name, g] of [["front", parts.front], ["interior", parts.interior]] as const) {
      expect(g.attributes.color.count, name).toBe(g.attributes.position.count);
      expect(g.attributes.aGlow.count, name).toBe(g.attributes.position.count);
    }
    expect(Math.min(...parts.interior.attributes.aGlow.array)).toBeGreaterThan(0);
  });

  it("keeps the building in its footprint; only the shopfront relief and the cornice reach over the sidewalk", () => {
    for (const p of points(parts.shell)) {
      expect(inFootprint(p, SHOP.overhang), `${p.x}, ${p.z}`).toBe(true);
      if (!inFootprint(p)) expect(p.y - SHOP.ground, `${p.x}, ${p.y}, ${p.z}`).toBeGreaterThan(SHOP.storeTop - EPS);
    }
    const front = points(parts.front);
    for (const p of front) {
      if (inFootprint(p)) continue;
      const relief = p.z <= SHOP.z1 + SHOP.relief + EPS && p.x >= SHOP.x0 - SHOP.relief - EPS && p.x <= SHOP.x1 + SHOP.relief + EPS;
      const high = p.y - SHOP.ground > SHOP.storeTop - EPS && inFootprint(p, SHOP.overhang);
      expect(relief || high || SHOP.furniture.some((b) => inBox(p, b)), `${p.x}, ${p.y}, ${p.z}`).toBe(true);
    }
  });

  it("keeps the cafe inside the walls, under the ceiling, and the glass in the shopfront", () => {
    for (const p of points(parts.interior)) {
      expect(inFootprint(p), `${p.x}, ${p.z}`).toBe(true);
      expect(p.y - SHOP.ground).toBeGreaterThan(-0.1);
      expect(p.y - SHOP.ground).toBeLessThan(SHOP.storeTop);
    }
    for (const p of points(parts.glass)) {
      expect(inFootprint(p, 0.01), `${p.x}, ${p.z}`).toBe(true);
      expect(p.y - SHOP.ground).toBeLessThan(SHOP.storeTop);
    }
  });

  it("stands its sidewalk furniture and the corner lamp on the sidewalk, never on the street", () => {
    const things = [...SHOP.furniture, { name: "lamp", x0: SHOP.lamp.x - LAMP.base, x1: SHOP.lamp.x + LAMP.base, z0: SHOP.lamp.z - LAMP.base, z1: SHOP.lamp.z + LAMP.base, y0: SHOP.lamp.y, y1: SHOP.lamp.y + LAMP.height }];
    for (const b of things) {
      for (const [x, z] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) {
        expect(groundAt(x, z), b.name).not.toBe("street");
        expect(streetDrop(x, z), b.name).toBe(0);
        // the lamp stands on Nob Hill's foot like the street's lamps (its centre on the ground, tested below)
        if (b.name !== "lamp") expect(Math.abs(heightAt(x, z) - b.y0), b.name).toBeLessThan(0.02);
      }
      // outside the building
      expect(b.z0, b.name).toBeGreaterThan(SHOP.z1 - EPS);
    }
    // every furniture vertex on the sidewalk or above it, none under it
    for (const p of points(parts.front)) if (!inFootprint(p, SHOP.relief)) expect(p.y).toBeGreaterThan(heightAt(p.x, p.z) - 0.02);
    // the corner lamp: an SF acorn lamp like the others, 0.3 in from the kerb
    expect(groundAt(SHOP.lamp.x, SHOP.lamp.z)).toBe("sidewalk");
    expect(SHOP.lamp.y).toBeCloseTo(heightAt(SHOP.lamp.x, SHOP.lamp.z), 9);
  });

  it("keeps everything at least 1.2 off Cuso's routes", () => {
    const all = [...points(parts.shell), ...points(parts.front)];
    const xs = all.map((p) => p.x);
    const zs = all.map((p) => p.z);
    const box = { x0: Math.min(...xs, SHOP.lamp.x - LAMP.reach), x1: Math.max(...xs, SHOP.lamp.x + LAMP.reach), z0: Math.min(...zs), z1: Math.max(...zs, SHOP.lamp.z + LAMP.reach) };
    for (const [x, z] of ROUTE) {
      const dx = Math.max(box.x0 - x, 0, x - box.x1);
      const dz = Math.max(box.z0 - z, 0, z - box.z1);
      expect(Math.hypot(dx, dz), `${x}, ${z}`).toBeGreaterThan(1.2);
    }
  });

  it("hangs the brand sign on the fascia, in front of it and inside the shopfront", () => {
    const [x, y, z] = SHOP.sign;
    expect(x).toBeCloseTo(0);
    expect(SHOP.x + x - SHOP_SIGN[0] / 2).toBeGreaterThan(SHOP.x0);
    expect(SHOP.x + x + SHOP_SIGN[0] / 2).toBeLessThan(SHOP.x1);
    expect(y + SHOP_SIGN[1] / 2).toBeLessThan(SHOP.storeTop);
    // in front of everything painted behind it (the fascia), so it never flickers
    const behind = points(parts.front).filter((p) => Math.abs(p.x - SHOP.x - x) < SHOP_SIGN[0] / 2 - 0.05 && Math.abs(p.y - SHOP.ground - y) < SHOP_SIGN[1] / 2 - 0.05);
    expect(Math.max(...behind.map((p) => p.z - SHOP.z))).toBeLessThan(z - 0.002);
  });
});
