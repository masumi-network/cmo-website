import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { DECK, RAIL, STRINGERS, deckGeometry, plankLayout } from "@/scene/pier";

const planks = plankLayout();
const rows = new Map<number, typeof planks>();
for (const p of planks) rows.set(p.x, [...(rows.get(p.x) ?? []), p]);

describe("pier planks", () => {
  it("is the same every time (seeded)", () => {
    expect(plankLayout()).toEqual(planks);
  });

  it("covers the deck end to end, two boards per row", () => {
    expect(rows.size).toBe(50);
    const xs = [...rows.keys()];
    expect(Math.min(...xs) - planks[0].width / 2).toBeGreaterThanOrEqual(DECK.x0);
    expect(Math.max(...xs) + planks[0].width / 2).toBeLessThanOrEqual(DECK.x1);
    for (const row of rows.values()) {
      expect(row).toHaveLength(2);
      const span = row.reduce((sum, p) => sum + p.length, 0);
      expect(span).toBeGreaterThan(DECK.z1 - DECK.z0 - 0.05);
      expect(span).toBeLessThan(DECK.z1 - DECK.z0);
    }
  });

  it("joins boards over an inner stringer, never the same one twice in a row", () => {
    const joints = [...rows.values()].map(([a]) => a.z + a.length / 2);
    const inner = STRINGERS.slice(1, -1);
    for (const j of joints) expect(inner.some((s) => Math.abs(s - j) < 0.02)).toBe(true);
    for (let i = 1; i < joints.length; i++) expect(Math.abs(joints[i] - joints[i - 1])).toBeGreaterThan(0.5);
  });

  it("keeps the deck flat enough to stand on", () => {
    for (const p of planks) expect(Math.abs(p.lift)).toBeLessThanOrEqual(0.004);
  });

  it("holds Cuso's night spot at deck height", () => {
    const [x, y, z] = chapters.find((c) => c.id === "night")!.spot;
    expect(y).toBe(DECK.top);
    expect(x).toBeGreaterThan(DECK.x0);
    expect(x).toBeLessThan(DECK.x1);
    expect(z).toBeGreaterThan(DECK.z0);
    expect(z).toBeLessThan(DECK.z1);
  });
});

describe("pier deck and railing timber", () => {
  const g = deckGeometry();
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const col = g.attributes.color;

  it("stays within its triangle budget", () => {
    expect(pos.count / 3).toBeLessThan(10_000);
  });

  it("has nail heads on the planks, over the stringers", () => {
    // nail heads: up-facing, a hair above the deck, dark
    const nails = new Set<string>();
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.99 && pos.getY(i) > DECK.top && pos.getY(i) < DECK.top + 0.006 && col.getX(i) < 0.12) nails.add(`${pos.getX(i).toFixed(1)},${pos.getZ(i).toFixed(2)}`);
    }
    expect(nails.size).toBeGreaterThan(300);
    for (const key of nails) {
      const z = Number(key.split(",")[1]);
      expect(STRINGERS.some((s) => Math.abs(s - z) < 0.08)).toBe(true);
    }
  });

  it("is darker in the joints between planks than on top", () => {
    let top = 0;
    let topN = 0;
    let side = 0;
    let sideN = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < DECK.top - 0.05 || y > DECK.top + 0.004 || pos.getZ(i) > RAIL.z1 - 0.3 || pos.getZ(i) < RAIL.z + 0.3) continue;
      if (nrm.getY(i) > 0.99 && col.getX(i) > 0.12) [top, topN] = [top + col.getX(i), topN + 1]; // not the nails
      if (Math.abs(nrm.getX(i)) > 0.99 && y < DECK.top - 0.03) [side, sideN] = [side + col.getX(i), sideN + 1];
    }
    expect(side / sideN).toBeLessThan((top / topN) * 0.6);
  });

  it("keeps the railing within its collision box", () => {
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < DECK.top + 0.01) continue; // the deck
      expect(pos.getY(i)).toBeLessThanOrEqual(DECK.top + RAIL.top + 1e-4);
      const north = pos.getZ(i) <= RAIL.z + RAIL.half + 1e-4;
      const end = pos.getX(i) >= RAIL.x - RAIL.half - 1e-4;
      expect(north || end).toBe(true);
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(RAIL.z - RAIL.half - 1e-4);
      expect(pos.getX(i)).toBeLessThanOrEqual(RAIL.x + RAIL.half + 1e-4);
    }
  });
});
