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
import { ATLAS, CAFE_MAT, PENDANTS, ROOM, SHOP, SHOP_SIGN, TABLES, cafeText, shopParts } from "@/scene/shop";
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
    // the cafe is a crafted miniature (turned chairs, a real espresso machine), still within budget
    expect(tris(parts.interior)).toBeLessThan(20_000);
    const total = Object.values(parts).reduce((s, g) => s + tris(g), 0);
    expect(total).toBeLessThan(26_000);
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

  it("dresses the cafe: floorboards, subway tile, wood, marble, glaze, beadboard, a chalk menu and leafy plants", () => {
    for (const g of [parts.front, parts.interior]) expect(g.attributes.aMat.count).toBe(g.attributes.position.count);
    const used = new Set(Array.from(parts.interior.attributes.aMat.array));
    for (const m of ["floor", "tile", "wood", "marble", "glaze", "boards", "leaf", "plaster", "chrome", "leather", "tin", "art"] as const) expect(used.has(CAFE_MAT[m]), m).toBe(true);
    // plants are many leaf cards, not a few blobs
    const leafTris = Array.from(parts.interior.attributes.aMat.array).filter((m) => m === CAFE_MAT.leaf).length / 3;
    expect(leafTris).toBeGreaterThanOrEqual(100);
  });

  it("puts the visitor's brand on the menu board and the coffee bags", () => {
    const { menu, bag } = cafeText("ACME");
    expect(menu[0]).toContain("ACME");
    expect(menu.length).toBeGreaterThanOrEqual(6);
    expect(bag).toContain("ACME");
    // the board and at least four bags are mapped onto those parts of the cafe's canvas
    const uv = parts.interior.attributes.uv;
    const mat = parts.interior.attributes.aMat;
    const onRegion = (r: readonly [number, number, number, number]) => {
      let n = 0;
      for (let i = 0; i < uv.count; i++) {
        if (mat.getX(i) !== CAFE_MAT.art) continue;
        const [x, y] = [uv.getX(i) * ATLAS.w, (1 - uv.getY(i)) * ATLAS.h];
        if (x >= r[0] - 0.01 && x <= r[0] + r[2] + 0.01 && y >= r[1] - 0.01 && y <= r[1] + r[3] + 0.01) n++;
      }
      return n;
    };
    expect(onRegion(ATLAS.menu)).toBeGreaterThanOrEqual(4);
    expect(onRegion(ATLAS.bag) / 6).toBeGreaterThanOrEqual(4); // a quad (two triangles, six vertices) per bag
  });

  it("hangs the pendants and stands the tables the cafe's light is baked around inside the room", () => {
    for (const [a, y, c] of PENDANTS) {
      expect(a > ROOM.a0 && a < ROOM.a1 && c > ROOM.c0 && c < 0).toBe(true);
      expect(y).toBeLessThan(ROOM.h);
    }
    for (const [a, c] of TABLES) expect(a > ROOM.a0 && a < ROOM.a1 && c > ROOM.c0 && c < 0).toBe(true);
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
    const pos = parts.interior.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const [a, b, c] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      expect(a >= ROOM.a0 - EPS && a <= ROOM.a1 + EPS && c >= ROOM.c0 - EPS && c <= EPS && b >= -EPS && b <= ROOM.h + EPS, `${a}, ${b}, ${c}`).toBe(true);
    }
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
