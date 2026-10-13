import { Object3D, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { BODY_DEPTH, FOOT, H, PALETTES, RELIEF_DEPTH, SLOT, SLOTS, VARIANTS, W, bodyGeometry, frontGeometry, palette } from "@/scene/house-models";
import { neighbours, paletteOf, placeBody, placeFront, reliefDepth, variantOf } from "@/scene/houses";
import { CITY, HOUSE_GAP } from "@/scene/layout";
import { FOOTING } from "@/scene/materials";

const EPS = 1e-6;
const tris = (g: BufferGeometry) => g.index!.count / 3;
const fronts = VARIANTS.map((_, v) => frontGeometry(v));
const bodies = { flat: bodyGeometry(false), gable: bodyGeometry(true) };
/** Triangles per model: a front per variant, and the shared body. */
const BUDGET = { front: 2400, body: 450, city: 300_000 };

function bounds(g: BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!.clone();
}

/** Every vertex finite, every slot a known paint, and glass (and only glass) carries a window id. */
function checkAttributes(g: BufferGeometry) {
  const pos = g.attributes.position;
  const slot = g.attributes.aSlot;
  const win = g.attributes.aWin;
  const nrm = g.attributes.normal;
  expect(slot.count).toBe(pos.count);
  expect(win.count).toBe(pos.count);
  for (let i = 0; i < pos.count; i++) {
    for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
    expect(win.getX(i) > 0).toBe(slot.getX(i) === SLOT.glass);
  }
}

/** Window ids, each with the normals of its glass: a whole window is flat, so one normal. */
function windows(g: BufferGeometry) {
  const win = g.attributes.aWin;
  const nrm = g.attributes.normal;
  const out = new Map<number, Set<string>>();
  for (let i = 0; i < win.count; i++) {
    const id = win.getX(i);
    if (!id) continue;
    if (!out.has(id)) out.set(id, new Set());
    out.get(id)!.add([nrm.getX(i), nrm.getY(i), nrm.getZ(i)].map((v) => v.toFixed(3)).join());
  }
  return out;
}

/** A model's box in the world once placed on a house. */
function placed(g: BufferGeometry, place: (o: Object3D) => void) {
  const o = new Object3D();
  place(o);
  o.updateMatrix();
  return bounds(g).applyMatrix4(o.matrix);
}

describe("row house models", () => {
  it("has the six Painted Ladies: blue, green, yellow, pink, sage, white", () => {
    expect(VARIANTS.map((v) => v.floors)).toEqual([2, 3, 2, 3, 2, 3]);
    expect(palette()).toHaveLength(PALETTES.length * SLOTS.length * 3);
    expect([...palette()].every((c) => c >= 0 && c <= 1)).toBe(true);
  });

  it.each(VARIANTS.map((v, i) => [i, v.name]))("variant %i (%s): a finite front on its own wall, within budget", (i) => {
    const g = fronts[i];
    checkAttributes(g);
    const b = bounds(g);
    // x across the facade, y up from the ground (down into the footing), z out of the front wall (recesses go in)
    expect(b.min.x).toBeGreaterThanOrEqual(-W / 2 - EPS);
    expect(b.max.x).toBeLessThanOrEqual(W / 2 + EPS);
    expect(b.min.y).toBeCloseTo(-FOOT, 6);
    expect(b.max.y).toBeLessThanOrEqual(H + EPS);
    expect(b.max.z).toBeLessThanOrEqual(RELIEF_DEPTH + EPS);
    expect(b.min.z).toBeGreaterThan(-0.6);
    expect(tris(g)).toBeLessThan(BUDGET.front);
  });

  it.each(VARIANTS.map((v, i) => [i, v.name]))("variant %i (%s): every window has its own id and is flat", (i) => {
    const ids = windows(fronts[i]);
    // bay windows on every storey, the flat-wall windows, the transom (and the garage lites)
    expect(ids.size).toBeGreaterThanOrEqual(VARIANTS[i].floors === 3 ? 11 : 8);
    for (const normals of ids.values()) expect(normals.size).toBe(1);
  });

  it("has a lap-sided body with side windows and a roof behind, inside the plot", () => {
    for (const [kind, g] of Object.entries(bodies)) {
      checkAttributes(g);
      const b = bounds(g);
      expect(b.min.x).toBeGreaterThanOrEqual(-W / 2 - 0.025);
      expect(b.max.x).toBeLessThanOrEqual(W / 2 + 0.025);
      expect(b.min.z).toBeCloseTo(-BODY_DEPTH, 6);
      expect(b.max.z).toBeLessThanOrEqual(0.12);
      expect(b.min.y).toBeCloseTo(-FOOT, 6);
      // a flat roof hides behind the false front; a gable stays inside the layout's roof allowance
      expect(b.max.y).toBeLessThanOrEqual(kind === "gable" ? H + 0.42 * W : H);
      expect(windows(g).size).toBeGreaterThanOrEqual(4);
      expect(tris(g)).toBeLessThan(BUDGET.body);
    }
    const slots = (g: BufferGeometry) => new Set(g.attributes.aSlot.array);
    expect(slots(bodies.gable).has(SLOT.roof) && slots(bodies.gable).has(SLOT.scales)).toBe(true);
    expect(slots(bodies.flat).has(SLOT.tar)).toBe(true);
  });

  it("sits every house in its plot: front out to its relief depth, body to the back, footing under the slope", () => {
    CITY.houses.forEach((h, i) => {
      const front = h.z + (h.facing * h.d) / 2;
      const body = h.roof === "gable" ? bodies.gable : bodies.flat;
      for (const b of [placed(fronts[variantOf(h, i)], (o) => placeFront(h, o)), placed(body, (o) => placeBody(h, o))]) {
        expect(b.min.x).toBeGreaterThanOrEqual(h.x - h.w / 2 - EPS);
        expect(b.max.x).toBeLessThanOrEqual(h.x + h.w / 2 + EPS);
        const out = [b.min.z, b.max.z].map((z) => (z - front) * h.facing);
        expect(Math.max(...out)).toBeLessThanOrEqual(reliefDepth(h) + EPS);
        expect(Math.min(...out)).toBeGreaterThanOrEqual(-h.d - EPS);
        expect(b.min.y).toBeLessThanOrEqual(h.y - FOOTING + EPS);
        expect(b.max.y).toBeLessThanOrEqual(h.y + h.h + (h.roof === "gable" ? h.w * 0.42 : 0) + EPS);
      }
      // the model keeps its proportions: as wide as the body, as tall as the house
      const b = placed(fronts[variantOf(h, i)], (o) => placeFront(h, o));
      expect(b.max.x - b.min.x).toBeCloseTo(h.w - HOUSE_GAP, 6);
      expect(b.max.y - h.y).toBeCloseTo(h.h, 6);
    });
  });

  it("is full depth except where Cuso walks past", () => {
    const depths = CITY.houses.map(reliefDepth);
    expect(depths.every((d) => d > 0.1 && d <= RELIEF_DEPTH)).toBe(true);
    // most houses get the whole relief (less on narrow houses, so the model keeps its proportions)
    const full = CITY.houses.filter((h, i) => Math.abs(depths[i] - RELIEF_DEPTH * Math.min(1, (h.w - HOUSE_GAP) / W)) < 1e-9);
    expect(full.length).toBeGreaterThan(CITY.houses.length * 0.7);
  });

  it("keeps the houses, and gives each one a variant with its number of floors", () => {
    expect(CITY.houses).toHaveLength(151);
    const used = new Set<number>();
    CITY.houses.forEach((h, i) => {
      const v = variantOf(h, i);
      expect(VARIANTS[v].floors).toBe(h.floors);
      used.add(v);
    });
    expect(used.size).toBe(VARIANTS.length);
  });

  it("paints neighbours in different colours, from the whole set of schemes", () => {
    const p = paletteOf(CITY.houses);
    expect(new Set(PALETTES.map((x) => x.body)).size).toBe(PALETTES.length);
    expect(p.every((k) => Number.isInteger(k) && k >= 0 && k < PALETTES.length)).toBe(true);
    expect(new Set(p).size).toBe(PALETTES.length);
    let pairs = 0;
    CITY.houses.forEach((a, i) =>
      CITY.houses.forEach((b, j) => {
        if (j <= i || !neighbours(a, b)) return;
        pairs++;
        expect(PALETTES[p[i]].body, `houses ${i} and ${j}`).not.toBe(PALETTES[p[j]].body);
      }),
    );
    expect(pairs).toBeGreaterThanOrEqual(100); // most houses stand in rows
    // and no colour takes over a neighbourhood: each scheme on at most a fifth of the houses
    for (let k = 0; k < PALETTES.length; k++) expect(p.filter((x) => x === k).length).toBeLessThan(CITY.houses.length / 5);
  });

  it("keeps the whole city of houses within its triangle budget", () => {
    const total = CITY.houses.reduce((sum, h, i) => sum + tris(fronts[variantOf(h, i)]) + tris(h.roof === "gable" ? bodies.gable : bodies.flat), 0);
    expect(total).toBeLessThan(BUDGET.city);
  });
});
