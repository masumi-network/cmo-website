// The 18:00 Ferry Building, modelled: a Beaux-Arts hall over an arcade on its
// pier deck, and the clock tower after the Giralda, in the row houses' paints
// (house-models.ts); behind the arcade's clear glass, the marketplace. Its
// collision boxes (FERRY) are fixed.

import { describe, expect, it } from "vitest";
import { Color, Mesh, Raycaster, SRGBColorSpace, Vector3, type BufferGeometry } from "three";
import { WATER_Y } from "@/scene/bay";
import { FERRY, FERRY_CAR, CLOCK, HALL, MARKET, MARKET_MAT, PAINT, SIGN_WORDS, clockGeometry, hallParts, marketGeometry, towerGeometry } from "@/scene/ferry";
import { PALETTES, SLOT, SLOTS } from "@/scene/house-models";

const { shell: hall, glass } = hallParts();
const market = marketGeometry();
const tower = towerGeometry();
const EPS = 1e-4; // positions are float32: about 4e-6 at x 36
const { x: X, z: Z, plinth, hall: H, tower: T } = FERRY;

const points = (g: BufferGeometry) => {
  const p = g.attributes.position;
  return Array.from({ length: p.count }, (_, i) => new Vector3().fromBufferAttribute(p, i));
};
/** Triangles painted with slot `s`, as vertex index triples. */
function tris(g: BufferGeometry, s: number) {
  const idx = g.index!;
  const out: number[][] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const k = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
    if (g.attributes.aSlot.getX(k[0]) === s) out.push(k);
  }
  return out;
}
/** Glass panes by window id: their vertices. */
function panes(g: BufferGeometry) {
  const win = g.attributes.aWin;
  const pos = points(g);
  const out = new Map<number, Vector3[]>();
  pos.forEach((p, i) => {
    const id = win.getX(i);
    if (id) out.set(id, [...(out.get(id) ?? []), p]);
  });
  return out;
}
/** Where a horizontal ray from `from` along `dir` first meets the model. */
function hit(g: BufferGeometry, from: Vector3, dir: Vector3) {
  const r = new Raycaster(from, dir.clone().normalize());
  return r.intersectObject(new Mesh(g))[0]?.point ?? null;
}
const inBox = (p: Vector3, hx: number, hz: number, y0: number, y1: number) =>
  Math.abs(p.x - X) <= hx + EPS && Math.abs(p.z - Z) <= hz + EPS && p.y >= y0 - EPS && p.y <= y1 + EPS;
const inPlinth = (p: Vector3) => inBox(p, plinth[0] / 2, plinth[2] / 2, -0.6, plinth[1]);
const inHall = (p: Vector3) => inBox(p, H[0] / 2, H[2] / 2, plinth[1], H[1]);
const inTower = (p: Vector3) => inBox(p, T[0] / 2, T[0] / 2, H[1], T[1]);

describe("the 18:00 Ferry Building", () => {
  it("keeps the boxes the collision test and Cuso's 18:00 route read", () => {
    expect(FERRY).toEqual({ x: 33.4, z: -3, plinth: [5, 0.3, 14], hall: [3.16, 4.05, 12.16], tower: [1.62, 11.65] });
    expect(FERRY_CAR).toEqual({ p: [18.4, 0, 4] });
  });

  it("is a finite model in the row houses' paints (cream stone), where glass and only glass has a window id", () => {
    expect(PALETTES[PAINT].name).toBe("cream");
    for (const g of [hall, tower]) {
      const { normal: n, aSlot: slot, aWin: win, aPalette: pal } = g.attributes;
      for (let i = 0; i < g.attributes.position.count; i++) {
        for (const v of [n.getX(i), n.getY(i), n.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
        expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
        expect(win.getX(i) > 0).toBe(slot.getX(i) === SLOT.glass);
        expect(pal.getX(i)).toBe(PAINT);
      }
      for (const p of points(g)) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
    }
    // stone walls with lighter trim, a copper roof, glass; no lap siding, shingles or fish scales
    const used = new Set(hall.attributes.aSlot.array);
    for (const s of ["stucco", "trim", "glass", "copper", "stone"] as const) expect(used.has(SLOT[s]), s).toBe(true);
    for (const s of ["body", "roof", "scales"] as const) expect(used.has(SLOT[s]), s).toBe(false);
  });

  it("stays inside its collision boxes: the plinth, the hall over it, the tower over the hall", () => {
    for (const p of points(hall)) expect(inPlinth(p) || inHall(p), `${p.toArray()}`).toBe(true);
    for (const p of points(tower)) expect(inHall(p) || inTower(p), `${p.toArray()}`).toBe(true);
    // and fills them: the cornice reaches the hall's box, the flagpole the tower's top
    const hp = points(hall);
    expect(Math.min(...hp.map((p) => p.x))).toBeCloseTo(X - plinth[0] / 2, 6);
    expect(Math.min(...hp.filter((p) => p.y > HALL.wall - 0.2).map((p) => p.x))).toBeCloseTo(X - H[0] / 2, 6);
    expect(Math.max(...hp.filter((p) => p.y > HALL.wall - 0.2).map((p) => p.z))).toBeCloseTo(Z + H[2] / 2, 6);
    expect(Math.max(...points(tower).map((p) => p.y))).toBeCloseTo(T[1], 6);
  });

  it("has a real arcade on the city side: round arches with the glass set well back", () => {
    // the arcade's glass is one clear mesh: tell the arches apart by where they are along the wall
    const panesWest = points(glass).filter((p) => p.x < HALL.x0 + 0.4).sort((a, b) => a.z - b.z);
    const west: Vector3[][] = [];
    for (const p of panesWest) {
      const last = west.at(-1);
      if (last && p.z - last.at(-1)!.z < 0.15) last.push(p);
      else west.push([p]);
    }
    west.splice(0, west.length, ...west.filter((ps) => ps.every((p) => p.y < HALL.belt)));
    for (const ps of west) for (const p of ps) expect(p.x).toBeCloseTo(ps[0].x, 4);
    expect(west.length).toBeGreaterThanOrEqual(14);
    for (const ps of west) {
      // recessed behind the wall face
      expect(ps[0].x - HALL.x0).toBeGreaterThanOrEqual(0.15);
      // arched: the head rises over the springing by about half the width
      const zs = ps.map((p) => p.z);
      const w = Math.max(...zs) - Math.min(...zs);
      const ys = ps.map((p) => p.y);
      const atSide = ps.filter((p) => Math.abs(p.z - Math.min(...zs)) < EPS).map((p) => p.y);
      expect(Math.max(...ys) - Math.max(...atSide)).toBeCloseTo(w / 2, 2);
    }
    // a ray through an arch (beside its mullion) passes the wall and meets the glass deep in the opening
    const arch = west[2];
    const [za, zb] = [Math.min(...arch.map((p) => p.z)), Math.max(...arch.map((p) => p.z))];
    const from = new Vector3(X - 4, 0.7, za + (zb - za) / 4);
    expect(hit(hall, from, new Vector3(1, 0, 0))).toBeNull();
    expect(hit(glass, from, new Vector3(1, 0, 0))!.x).toBeCloseTo(arch[0].x, 3);
    // the arcade is the only house-material glass left below the belt course: the upper windows keep theirs
    for (const ps of panes(hall).values()) for (const p of ps) expect(p.y).toBeGreaterThan(HALL.belt);
  });

  it("has a marketplace behind the arcade glass, inside the hall", () => {
    const pts = points(market);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
      expect(inHall(p), `${p.toArray()}`).toBe(true);
      // behind the glass (the glass sits 0.22 back; the portal's 0.3) and under the ceiling
      expect(p.x).toBeGreaterThanOrEqual(MARKET.x0 - EPS);
      expect(p.x).toBeLessThanOrEqual(MARKET.x1 + EPS);
      expect(p.z).toBeGreaterThanOrEqual(MARKET.z0 - EPS);
      expect(p.z).toBeLessThanOrEqual(MARKET.z1 + EPS);
      expect(p.y).toBeGreaterThanOrEqual(MARKET.floor - EPS);
      expect(p.y).toBeLessThanOrEqual(MARKET.ceiling + EPS);
    }
    expect(MARKET.x0).toBeCloseTo(HALL.x0 + 0.22, 6);
    for (const k of ["color", "aGlow", "aMat", "normal"]) expect(market.attributes[k], k).toBeDefined();
  });

  it("shows something behind every arch on the city side, different from its neighbours, and deeper through the portal", () => {
    const panesWest = points(glass).filter((p) => p.x < HALL.x0 + 0.4).sort((a, b) => a.z - b.z);
    const arches: [number, number, number][] = []; // z0, z1, top
    for (const p of panesWest) {
      const last = arches.at(-1);
      if (last && p.z - last[1] < 0.1) {
        last[1] = p.z;
        last[2] = Math.max(last[2], p.y);
      } else arches.push([p.z, p.z, p.y]);
    }
    const col = market.attributes.color;
    const seen: string[] = [];
    for (const [z0, z1, top] of arches) {
      const zc = (z0 + z1) / 2;
      const r = new Raycaster(new Vector3(MARKET.x0 - 0.01, 0.62, zc + (z1 - z0) / 4), new Vector3(1, 0, 0));
      const h = r.intersectObject(new Mesh(market))[0];
      expect(h, `arch at z ${zc}`).toBeDefined();
      if (top > HALL.belt) {
        // the portal: deeper, through a passage into the nave
        expect(h.point.x).toBeGreaterThan(X - 0.4);
        continue;
      }
      expect(h.point.x).toBeLessThan(X - 0.2);
      // what's there, by its colours
      const c = new Set<string>();
      for (const p of points(market).map((p, i) => [p, i] as const)) {
        if (p[0].x < X - 0.25 && Math.abs(p[0].z - zc) < 0.2 && p[0].y < 1.2) c.add(new Color(col.getX(p[1]), col.getY(p[1]), col.getZ(p[1])).getHexString().slice(0, 2));
      }
      seen.push([...c].sort().join());
    }
    expect(arches.length).toBeGreaterThanOrEqual(17);
    for (let i = 1; i < seen.length; i++) if (seen[i] && seen[i - 1]) expect(seen[i], `arch ${i}`).not.toBe(seen[i - 1]);
    expect(new Set(seen).size).toBeGreaterThanOrEqual(5);
  });

  it("keeps the market calm and muted (no rainbow), with lamps and lit shopfronts that carry the night", () => {
    const col = market.attributes.color;
    const glow = market.attributes.aGlow;
    const hsl = { h: 0, s: 0, l: 0 };
    let lamps = 0;
    for (let i = 0; i < col.count; i++) {
      // 1: lit by the room's baked light; more: glowing (bulbs, lit shop windows)
      expect(glow.getX(i)).toBeGreaterThanOrEqual(1);
      if (glow.getX(i) > 1.5) {
        lamps++;
        continue;
      }
      new Color(col.getX(i), col.getY(i), col.getZ(i)).getHSL(hsl, SRGBColorSpace);
      expect(hsl.s, `vertex ${i}`).toBeLessThanOrEqual(0.62);
    }
    expect(lamps).toBeGreaterThan(0);
  });

  it("dresses the market in real surfaces: tiled floor, wood, slatted crates, zinc, glaze, marble, bread, plaster, signs", () => {
    const used = new Set(Array.from(market.attributes.aMat.array, (v) => Math.round(v)));
    for (const [name, id] of Object.entries(MARKET_MAT)) expect(used.has(id), name).toBe(true);
  });

  it("names each shop on a sign in plain words", () => {
    for (const w of SIGN_WORDS) expect(w).toMatch(/^[A-Z][a-z]+$/);
    expect(SIGN_WORDS).toEqual(expect.arrayContaining(["Produce", "Bakery", "Flowers", "Cheese", "Coffee"]));
    // every sign face reads one row of the word atlas
    const mat = market.attributes.aMat;
    const uv = market.attributes.uv;
    const rows = new Set<number>();
    for (let i = 0; i < mat.count; i++) {
      if (Math.round(mat.getX(i)) !== MARKET_MAT.sign) continue;
      const v = uv.getY(i);
      expect(v).toBeGreaterThanOrEqual(-EPS);
      expect(v).toBeLessThanOrEqual(1 + EPS);
      rows.add(Math.max(0, Math.min(SIGN_WORDS.length - 1, Math.floor((1 - v) * SIGN_WORDS.length - EPS))));
    }
    expect(rows.size).toBe(SIGN_WORDS.length);
  });

  it("closes the passage under the tower: neither portal looks through the building", () => {
    for (const [o, d] of [[new Vector3(MARKET.x0 - 0.01, 0.62, Z + 0.05), new Vector3(1, 0, 0)], [new Vector3(MARKET.x1 + 0.01, 0.62, Z - 0.05), new Vector3(-1, 0, 0)]] as const) {
      const h = new Raycaster(o, d).intersectObject(new Mesh(market))[0];
      expect(h).toBeDefined();
      expect(Math.abs(h.point.x - X)).toBeLessThan(0.1);
      // and obliquely, towards the far corners of the passage
      for (const dz of [-0.35, 0.35]) {
        const far = new Vector3(2 * X - o.x, 0.62, Z + dz);
        const r = new Raycaster(o, far.clone().sub(o).normalize()).intersectObject(new Mesh(market))[0];
        expect(r).toBeDefined();
        expect(Math.abs(r.point.x - X)).toBeLessThan(0.1);
      }
    }
  });

  it("keeps the market and the clear glass within budget", () => {
    expect(market.attributes.position.count / 3).toBeLessThan(16000);
    expect((glass.index ? glass.index.count : glass.attributes.position.count) / 3).toBeLessThan(1000);
  });

  it("has two storeys of windows over the arcade on every side", () => {
    const sides = { west: [0, 0], east: [0, 0], north: [0, 0], south: [0, 0] };
    for (const ps of panes(hall).values()) {
      const c = ps.reduce((s, p) => s.add(p), new Vector3()).divideScalar(ps.length);
      if (c.y < HALL.belt || c.y > HALL.wall) continue;
      const d = { west: c.x - HALL.x0, east: HALL.x1 - c.x, north: c.z - HALL.z0, south: HALL.z1 - c.z };
      const side = (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (Math.abs(d[a]) < Math.abs(d[b]) ? a : b));
      if (Math.abs(d[side]) > 0.2) continue;
      sides[side][c.y < HALL.attic ? 0 : 1]++;
    }
    expect(sides.west[0]).toBeGreaterThanOrEqual(14);
    expect(sides.east[0]).toBeGreaterThanOrEqual(14);
    for (const [name, [low, high]] of Object.entries(sides)) {
      expect(low, name).toBeGreaterThanOrEqual(3);
      expect(high, name).toBeGreaterThanOrEqual(3);
    }
  });

  it("has a low roof with a long skylight down the middle, clear of the tower", () => {
    const sky = [...panes(hall).values()].flat().filter((p) => p.y > HALL.wall + EPS);
    expect(sky.length).toBeGreaterThan(0);
    for (const p of sky) {
      expect(Math.abs(p.x - X)).toBeLessThan(0.6);
      expect(Math.abs(p.z - Z)).toBeGreaterThan(T[0] / 2 - 0.1);
    }
    const zs = sky.map((p) => p.z);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(9);
    // copper on the slopes between the cornice and the skylight
    const roof = tris(hall, SLOT.copper).flat().map((i) => points(hall)[i]);
    expect(Math.min(...roof.map((p) => p.y))).toBeCloseTo(HALL.wall, 6);
  });

  it("stands on a pier deck: paved on the city side, a sea wall into the water on the others", () => {
    const pos = points(hall);
    const stone = tris(hall, SLOT.stone).map((k) => k.map((i) => pos[i]));
    // the plaza between the steps and the arcade is paved at deck level
    const plaza = stone.filter((t) => t.every((p) => Math.abs(p.y - plinth[1]) < EPS && p.x < HALL.x0 + EPS && p.x > X - plinth[0] / 2 - EPS));
    expect(plaza.length).toBeGreaterThan(0);
    // steps down to the sidewalk on the city side
    const steps = stone.filter((t) => t.every((p) => p.y > EPS && p.y < plinth[1] - 0.05 && Math.abs(p.y - t[0].y) < EPS));
    expect(steps.length).toBeGreaterThan(0);
    // granite courses below the waterline on the north, east and south
    const low = pos.filter((p) => p.y < WATER_Y);
    for (const side of [(p: Vector3) => p.x > X + 2.3, (p: Vector3) => p.z < Z - 6.8, (p: Vector3) => p.z > Z + 6.8]) expect(low.some(side)).toBe(true);
  });

  it("has a tower after the Giralda: a shaft, the clock stage, two open belfry stages, a domed lantern, stepping in", () => {
    const pts = points(tower);
    const half = (y0: number, y1: number) => Math.max(...pts.filter((p) => p.y > y0 && p.y < y1).map((p) => Math.max(Math.abs(p.x - X), Math.abs(p.z - Z))));
    const t = HALL.tower;
    expect(half(t.shaft[0] + 0.3, t.shaft[1] - 0.3)).toBeLessThan(0.72);
    expect(half(t.clock[0] + 0.05, t.clock[1] - 0.05)).toBeLessThan(0.76);
    expect(half(t.belfry[0][0] + 0.05, t.belfry[0][1] - 0.05)).toBeLessThan(0.62);
    expect(half(t.belfry[1][0] + 0.05, t.belfry[1][1] - 0.05)).toBeLessThan(0.48);
    expect(half(t.dome[0] + 0.01, t.dome[1])).toBeLessThan(0.35);
    // the belfries are open: through an arch, a ray reaches well inside before it meets the core
    for (const [y0, y1] of t.belfry) {
      const y = (y0 + y1) / 2;
      for (const [o, d] of [[new Vector3(X - 3, y, Z), new Vector3(1, 0, 0)], [new Vector3(X, y, Z + 3), new Vector3(0, 0, -1)]]) {
        const p = hit(tower, o, d)!;
        expect(Math.max(Math.abs(p.x - X), Math.abs(p.z - Z))).toBeLessThan(0.36);
      }
    }
    // the shaft is solid
    const shaft = hit(tower, new Vector3(X - 3, (t.shaft[0] + t.shaft[1]) / 2 + 0.2, Z + 0.4), new Vector3(1, 0, 0))!;
    expect(X - shaft.x).toBeGreaterThan(0.6);
  });

  it("has four clock faces on the clock stage, one per side, facing out", () => {
    const g = clockGeometry();
    const pts = points(g);
    for (const p of pts) expect(inTower(p)).toBe(true);
    const n = g.attributes.normal;
    const faces = new Set<string>();
    pts.forEach((p, i) => {
      expect(p.y).toBeGreaterThan(HALL.tower.clock[0]);
      expect(p.y).toBeLessThan(HALL.tower.clock[1]);
      const out = new Vector3(n.getX(i), n.getY(i), n.getZ(i));
      const radial = new Vector3(p.x - X, 0, p.z - Z);
      expect(out.dot(radial)).toBeGreaterThan(0);
      faces.add(`${Math.round(out.x)},${Math.round(out.z)}`);
    });
    expect(faces.size).toBe(4);
    expect(CLOCK.r).toBeGreaterThan(0.4);
  });

  it("stays within its triangle budget", () => {
    const n = (g: BufferGeometry) => g.index!.count / 3;
    expect(n(hall) + n(tower)).toBeLessThan(40000);
  });
});
