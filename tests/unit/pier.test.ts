import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { DECK, STRINGERS, plankLayout } from "@/scene/pier";

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
