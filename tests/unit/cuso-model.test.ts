// @vitest-environment node
// The light cuso.glb (scripts/convert-cuso.mjs): a triangle and texture budget
// read straight from the GLB, and the names rig.ts and cuso.tsx look up.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Gltf = {
  nodes: { name?: string }[];
  meshes: { name: string; primitives: { indices: number }[] }[];
  accessors: { count: number }[];
  images: { name?: string; bufferView: number; mimeType: string }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  animations?: { name: string }[];
};

const glb = readFileSync(join(__dirname, "../../public/models/cuso.glb"));
const jsonLength = glb.readUInt32LE(12);
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as Gltf;
const bin = 20 + jsonLength + 8;

/** Width and height from a WebP header (lossy VP8, lossless VP8L or extended VP8X). */
function webpSize(b: Buffer): [number, number] {
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

const triangles = (name: string) => gltf.meshes.find((m) => m.name === name)!.primitives.reduce((s, p) => s + gltf.accessors[p.indices].count / 3, 0);

describe("cuso.glb", () => {
  it("keeps the names the rig reads and the baked clips", () => {
    expect(gltf.nodes.map((n) => n.name)).toEqual(expect.arrayContaining(["Mesh0", "EyeL", "EyeR"]));
    expect(gltf.animations?.map((a) => a.name)).toEqual(["Idle", "Hop", "Hello", "Spin", "Blink"]);
  });

  it("stays within its triangle budget (the original was 67.7k)", () => {
    expect(triangles("Mesh0")).toBeLessThan(20_000);
    expect(triangles("EyeL") + triangles("EyeR")).toBeLessThan(400);
  });

  it("has no map over 1024, and a 512 metal-roughness map", () => {
    const sizes: Record<string, [number, number]> = Object.fromEntries(
      gltf.images.map((im) => {
        const v = gltf.bufferViews[im.bufferView];
        const start = bin + (v.byteOffset ?? 0);
        expect(im.mimeType).toBe("image/webp");
        return [im.name ?? "", webpSize(glb.subarray(start, start + v.byteLength))];
      }),
    );
    for (const [w, h] of Object.values(sizes)) expect(Math.max(w, h)).toBeLessThanOrEqual(1024);
    expect(sizes["texture_0_metallic_roughness"]).toEqual([512, 512]);
  });
});
