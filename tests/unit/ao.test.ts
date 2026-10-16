import { describe, expect, it } from "vitest";
import { hemisphere, vertexAO, type Box } from "@/scene/ao";

const up = (n: number) => Array.from({ length: n }, () => [0, 1, 0]).flat();
const floor = (points: number[][]) => ({ positions: points.flat(), normals: up(points.length) });

describe("vertexAO", () => {
  it("leaves an open vertex fully lit", () => {
    const { positions, normals } = floor([[0, 0, 0]]);
    expect([...vertexAO(positions, normals, [], 16)]).toEqual([1]);
  });

  it("darkens a vertex under a low roof", () => {
    const { positions, normals } = floor([[0, 0, 0]]);
    const roof: Box = { min: [-1, 0.05, -1], max: [1, 0.1, 1] };
    expect(vertexAO(positions, normals, [roof], 16)[0]).toBeLessThan(0.3);
  });

  it("ignores boxes behind the surface and beyond reach", () => {
    const { positions, normals } = floor([[0, 0, 0]]);
    const below: Box = { min: [-1, -1, -1], max: [1, -0.01, 1] };
    const far: Box = { min: [-1, 2, -1], max: [1, 3, 1] };
    expect(vertexAO(positions, normals, [below, far], 16, 0.5)[0]).toBe(1);
  });

  it("darkens a corner more than the open floor beside one wall", () => {
    const walls: Box[] = [
      { min: [-0.1, 0, -1], max: [0, 1, 1] },
      { min: [-1, 0, -0.1], max: [1, 1, 0] },
    ];
    const { positions, normals } = floor([[0.01, 0, 0.01], [0.01, 0, 0.5], [0.6, 0, 0.6]]);
    const [corner, wall, open] = vertexAO(positions, normals, walls, 32, 0.4);
    expect(corner).toBeLessThan(wall);
    expect(wall).toBeLessThan(open);
  });

  it("is black inside a box, always within 0..1 and deterministic", () => {
    const box: Box = { min: [-1, -1, -1], max: [1, 1, 1] };
    const { positions, normals } = floor([[0, 0, 0], [0, 1.0, 0], [3, 0, 0]]);
    const a = vertexAO(positions, normals, [box], 12);
    expect(a[0]).toBe(0);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect([...vertexAO(positions, normals, [box], 12)]).toEqual([...a]);
  });

  it("spreads its rays over the upper hemisphere", () => {
    const d = hemisphere(24);
    expect(d.length).toBe(72);
    let mean = 0;
    for (let i = 0; i < 24; i++) {
      const [x, y, z] = [d[i * 3], d[i * 3 + 1], d[i * 3 + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(z).toBeGreaterThan(0);
      mean += x / 24;
    }
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });
});
