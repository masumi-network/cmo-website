import { BoxGeometry, type BufferGeometry } from "three";
import { describe, expect, it } from "vitest";
import { EDGE, SLOT, asKit, builder, edgeDistances, type Frame, type L3 } from "@/scene/house-models";

const FRONT: Frame = { o: [0, 0, 0], u: [1, 0, 0] };

/** Decoded distances (aEdge + EDGE.off) of vertex i: the four edges of its face. */
const edges = (g: BufferGeometry, i: number) => [0, 1, 2, 3].map((k) => g.attributes.aEdge.array[i * 4 + k] + EDGE.off);

/** The active edges of every triangle's face as segments (both ends at distance 0), deduplicated. */
function activeEdges(g: BufferGeometry) {
  const pos = g.attributes.position;
  const idx = g.index!.array;
  const seen = new Set<string>();
  const out: [L3, L3][] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]];
    for (let k = 0; k < 4; k++) {
      const on = vs.filter((v) => Math.abs(edges(g, v)[k]) < 1e-6);
      if (on.length < 2) continue;
      const [a, b] = on.map((v) => [pos.getX(v), pos.getY(v), pos.getZ(v)].map((x) => +x.toFixed(4)) as L3);
      const key = [a, b].map((p) => p.join()).sort().join("|");
      if (seen.has(key)) continue;
      out.push([a, b]);
      seen.add(key);
    }
  }
  return out;
}

describe("edge distances (the shader bevel's attribute)", () => {
  it("gives each corner its distance to every edge of a rectangle, less the offset", () => {
    const d = edgeDistances([[0, 0, 0], [2, 0, 0], [2, 1, 0], [0, 1, 0]], [true, true, true, true]);
    expect(d).toHaveLength(16);
    const at = (v: number) => d.slice(v * 4, v * 4 + 4).map((x) => +(x + EDGE.off).toFixed(9));
    // edges: 0 bottom, 1 right, 2 top, 3 left
    expect(at(0)).toEqual([0, 2, 1, 0]);
    expect(at(1)).toEqual([0, 0, 1, 2]);
    expect(at(2)).toEqual([1, 0, 0, 2]);
    expect(at(3)).toEqual([1, 2, 0, 0]);
  });

  it("interpolates exactly: anywhere in the face, the true distance to each edge line", () => {
    const pts: L3[] = [[0, 0, 0], [3, 0, 0], [2.4, 1.2, 0], [0.4, 1.2, 0]]; // a trapezoid (a mitred moulding face)
    const d = edgeDistances(pts, [true, true, true, true]);
    // barycentric mix of the fan's first triangle (0, 1, 2)
    const w = [0.2, 0.5, 0.3];
    const p = [0, 1, 2].map((k) => w.reduce((s, wi, v) => s + wi * pts[v][k], 0));
    const lerp = (k: number) => w.reduce((s, wi, v) => s + wi * (d[v * 4 + k] + EDGE.off), 0);
    const line = (a: L3, b: L3) => {
      const [ux, uy] = [b[0] - a[0], b[1] - a[1]];
      return Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux) / Math.hypot(ux, uy);
    };
    for (let k = 0; k < 4; k++) expect(lerp(k)).toBeCloseTo(line(pts[k], pts[(k + 1) % 4]), 9);
  });

  it("leaves an edge out as 0: it decodes to the offset, never inside the bevel", () => {
    const d = edgeDistances([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], [true, false, true, false]);
    for (let v = 0; v < 4; v++) {
      expect(d[v * 4 + 1]).toBe(0);
      expect(d[v * 4 + 3]).toBe(0);
    }
    expect(EDGE.off).toBeGreaterThan(EDGE.bevel * 100);
  });

  it("bevels triangles on their three edges and leaves polygons of more than four edges plain", () => {
    const tri = edgeDistances([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [true, true, true]);
    expect(tri.filter((_, i) => i % 4 === 3).every((x) => x === 0)).toBe(true);
    expect(tri[4 * 2 + 0] + EDGE.off).toBeCloseTo(1, 9);
    const hex = Array.from({ length: 6 }, (_, i): L3 => [Math.cos(i), Math.sin(i), 0]);
    expect(edgeDistances(hex, hex.map(() => true)).every((x) => x === 0)).toBe(true);
  });
});

describe("the kit's edges", () => {
  it("gives every vertex its four edge distances", () => {
    const k = builder();
    k.box(FRONT, 0, 1, 0, 1, 0, 0.2, SLOT.trim);
    const g = k.geometry();
    expect(g.attributes.aEdge.itemSize).toBe(4);
    expect(g.attributes.aEdge.count).toBe(g.attributes.position.count);
  });

  it("bevels a box's outer edges, not the ones against the wall", () => {
    const k = builder();
    k.box(FRONT, 0, 1, 0, 1, 0, 0.2, SLOT.trim);
    const active = activeEdges(k.geometry());
    expect(active.length).toBeGreaterThan(0);
    // the front face's four edges are there; none lies in the wall's plane (c = 0, a concave corner)
    expect(active.some(([a, b]) => a[2] === 0.2 && b[2] === 0.2)).toBe(true);
    for (const [a, b] of active) expect(a[2] === 0 && b[2] === 0, `${a} ${b}`).toBe(false);
  });

  it("bevels a wall round its hole and at its ends, never along the seams between its rectangles", () => {
    const k = builder();
    k.wall(FRONT, 0, 3, 0, 3, [[1, 2, 1, 2]], SLOT.stucco);
    const active = activeEdges(k.geometry());
    expect(active.length).toBeGreaterThan(0);
    for (const [a, b] of active) {
      const vertical = a[0] === b[0];
      expect(vertical, `${a} ${b}`).toBe(true);
      expect([0, 1, 2, 3]).toContain(a[0]);
    }
    // the hole's jambs are bevelled
    expect(active.some(([a]) => a[0] === 1)).toBe(true);
    expect(active.some(([a]) => a[0] === 2)).toBe(true);
  });

  it("maps a poster or the billboard's vinyl 0..1 across its face, like glass", () => {
    for (const slot of [SLOT.glass, SLOT.poster, SLOT.vinyl]) {
      const k = builder();
      k.quad(FRONT, 2, 4, 1, 2, 0, slot);
      const pane = k.geometry().attributes.aPane;
      const us = Array.from({ length: pane.count }, (_, i) => pane.getX(i));
      const vs = Array.from({ length: pane.count }, (_, i) => pane.getY(i));
      expect([Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)]).toEqual([0, 1, 0, 1]);
    }
  });

  it("turns a plain box into a kit part: its paint, no uvs, no bevel, where it is along its member", () => {
    const g = asKit(new BoxGeometry(0.1, 2, 0.1).translate(0, 1, 0), SLOT.wood, [0, 1, 0]);
    const pos = g.attributes.position;
    expect(g.index).toBeNull();
    expect(g.attributes.uv).toBeUndefined();
    for (const a of ["aSlot", "aWin", "aPane", "aEdge"]) expect(g.attributes[a].count, a).toBe(pos.count);
    for (let i = 0; i < pos.count; i++) {
      expect(g.attributes.aSlot.getX(i)).toBe(SLOT.wood);
      expect(g.attributes.aPane.getX(i)).toBeCloseTo(pos.getY(i), 6);
      expect(Math.abs(g.attributes.aPane.getY(i))).toBeLessThanOrEqual(0.05 + 1e-6);
    }
    expect(Array.from(g.attributes.aEdge.array).every((x) => x === 0)).toBe(true);
  });
});
