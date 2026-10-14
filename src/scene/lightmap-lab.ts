// Dev only (`?raytrace=uv`): how big a job lightmaps are. Unwraps every static
// city mesh with xatlas (a second UV set) and reports the time, the vertex
// growth from seams, and what kinds of meshes there are, on window.__uv.
// The wasm is copied into the gitignored public/lab/ (see photoreal.md).

// @ts-expect-error -- xatlas-web ships no types; XA below describes what we use
import XAtlas from "xatlas-web";
import type { BatchedMesh, InstancedMesh, Mesh, Scene } from "three";
import { splitScene } from "./plates";

type XA = {
  ready: Promise<unknown>;
  HEAPU16: Uint16Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
  createAtlas(): void;
  createMesh(vertices: number, indices: number, normals: boolean, uvs: boolean): { meshId: number; indexOffset: number; positionOffset: number; normalOffset: number; uvOffset: number };
  addMesh(): number;
  generateAtlas(): void;
  getMeshData(id: number): { newVertexCount: number; newIndexCount: number; uvOffset: number; indexOffset: number; originalIndexOffset: number };
  destroyAtlas(): void;
};

export type UvProbe = {
  meshes: number;
  instanced: { meshes: number; instances: number; vertices: number };
  batched: { meshes: number; vertices: number };
  plain: { meshes: number; vertices: number; triangles: number; unwrapped: number; failed: number; newVertices: number; ms: number };
  biggest: { name: string; vertices: number; ms: number; newVertices: number }[];
  error?: string;
};

export async function uvProbe(scene: Scene): Promise<UvProbe> {
  const xa = (XAtlas as (o: object) => XA)({ locateFile: (p: string) => (p.endsWith(".wasm") ? "/lab/xatlas-web.wasm" : p) });
  await xa.ready;
  const { catchers } = splitScene(scene);
  const out: UvProbe = {
    meshes: catchers.length,
    instanced: { meshes: 0, instances: 0, vertices: 0 },
    batched: { meshes: 0, vertices: 0 },
    plain: { meshes: 0, vertices: 0, triangles: 0, unwrapped: 0, failed: 0, newVertices: 0, ms: 0 },
    biggest: [],
  };
  const seen = new Set<unknown>();
  for (const mesh of catchers as Mesh[]) {
    const g = mesh.geometry;
    const v = g.attributes.position.count;
    if ((mesh as BatchedMesh).isBatchedMesh) {
      out.batched.meshes++;
      out.batched.vertices += v;
      continue;
    }
    if ((mesh as InstancedMesh).isInstancedMesh) {
      out.instanced.meshes++;
      out.instanced.instances += (mesh as InstancedMesh).count;
      out.instanced.vertices += v * (mesh as InstancedMesh).count;
      continue;
    }
    if (seen.has(g)) continue; // shared geometry: one unwrap
    seen.add(g);
    out.plain.meshes++;
    out.plain.vertices += v;
    const index = g.index ? Array.from(g.index.array) : Array.from({ length: v }, (_, i) => i);
    out.plain.triangles += index.length / 3;
    const t0 = performance.now();
    try {
      xa.createAtlas();
      const info = xa.createMesh(v, index.length, !!g.attributes.normal, false);
      if (v > 65535) xa.HEAPU32.set(index, info.indexOffset / 4);
      else xa.HEAPU16.set(index, info.indexOffset / 2);
      const p = g.attributes.position;
      const pos = new Float32Array(v * 3);
      for (let i = 0; i < v; i++) pos.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
      xa.HEAPF32.set(pos, info.positionOffset / 4);
      const n = g.attributes.normal;
      if (n) {
        const nor = new Float32Array(v * 3);
        for (let i = 0; i < v; i++) nor.set([n.getX(i), n.getY(i), n.getZ(i)], i * 3);
        xa.HEAPF32.set(nor, info.normalOffset / 4);
      }
      if (xa.addMesh() !== 0) throw new Error("addMesh");
      xa.generateAtlas();
      const d = xa.getMeshData(info.meshId);
      out.plain.newVertices += d.newVertexCount;
      out.plain.unwrapped++;
      const ms = performance.now() - t0;
      out.biggest.push({ name: mesh.name || mesh.parent?.name || mesh.type, vertices: v, ms: Math.round(ms), newVertices: d.newVertexCount });
    } catch {
      out.plain.failed++;
    } finally {
      xa.destroyAtlas();
    }
    out.plain.ms += performance.now() - t0;
    await new Promise((r) => setTimeout(r, 0)); // keep the page alive
  }
  out.plain.ms = Math.round(out.plain.ms);
  out.biggest = out.biggest.sort((a, b) => b.ms - a.ms).slice(0, 15);
  return out;
}
