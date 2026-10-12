// @vitest-environment node
// Cuso's rig on the real mesh: public/models/cuso.glb is decoded with the same
// draco decoder the site uses, rigged (rig.ts) and posed (gait.ts) on the CPU.
// Every pose must keep the mesh in one piece: no faces stretched between the
// legs, the feet or the freed hip hand, no holes, the fist never inside his body.
// His shoes point where he walks, and HULL still holds him.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Uint32BufferAttribute, Vector3, type SkinnedMesh } from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { CURL, fidget, pose, type PoseInput } from "@/scene/gait";
import { BONE, HULL, SCALE, rigCuso, type CusoRig } from "@/scene/rig";

// The few calls of the emscripten draco decoder we need.
type DracoArray = { GetValue(i: number): number };
type Draco = {
  DecoderBuffer: new () => { Init(data: Int8Array, size: number): void };
  Decoder: new () => {
    DecodeBufferToMesh(buffer: unknown, mesh: unknown): { ok(): boolean };
    GetAttributeByUniqueId(mesh: unknown, id: number): unknown;
    GetAttributeFloatForAllPoints(mesh: unknown, attribute: unknown, out: DracoArray): void;
    GetFaceFromMesh(mesh: unknown, face: number, out: DracoArray): void;
  };
  Mesh: new () => { num_points(): number; num_faces(): number };
  DracoFloat32Array: new () => DracoArray;
  DracoInt32Array: new () => DracoArray;
};
type Gltf = {
  meshes: { name: string; primitives: { extensions: { KHR_draco_mesh_compression: { bufferView: number; attributes: { POSITION: number; NORMAL: number; TEXCOORD_0: number } } } }[] }[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
};

const ROOT = join(__dirname, "../..");

/** Mesh0 (the body) of cuso.glb: positions, normals, uvs and triangles. */
async function loadBody() {
  const glb = readFileSync(join(ROOT, "public/models/cuso.glb"));
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as Gltf;
  const binStart = 20 + jsonLength + 8;
  const draco = gltf.meshes.find((m) => m.name === "Mesh0")!.primitives[0].extensions.KHR_draco_mesh_compression;
  const view = gltf.bufferViews[draco.bufferView];
  const data = new Int8Array(glb.buffer, glb.byteOffset + binStart + (view.byteOffset ?? 0), view.byteLength);

  const factory = createRequire(__filename)(join(ROOT, "public/draco/draco_decoder.js")) as () => Promise<Draco>;
  const d = await factory();
  const buffer = new d.DecoderBuffer();
  buffer.Init(data, data.length);
  const decoder = new d.Decoder();
  const mesh = new d.Mesh();
  if (!decoder.DecodeBufferToMesh(buffer, mesh).ok()) throw new Error("draco decode failed");

  const read = (id: number, size: number) => {
    const out = new d.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, decoder.GetAttributeByUniqueId(mesh, id), out);
    return Float32Array.from({ length: mesh.num_points() * size }, (_, i) => out.GetValue(i));
  };
  const { POSITION, NORMAL, TEXCOORD_0 } = draco.attributes;
  const face = new d.DracoInt32Array();
  const index = new Uint32Array(mesh.num_faces() * 3);
  for (let f = 0; f < mesh.num_faces(); f++) {
    decoder.GetFaceFromMesh(mesh, f, face);
    for (let k = 0; k < 3; k++) index[f * 3 + k] = face.GetValue(k);
  }
  return { position: read(POSITION, 3), normal: read(NORMAL, 3), uv: read(TEXCOORD_0, 2), index };
}

const STILL: PoseInput = { walk: 0, dash: 0, air: 0, wave: 0, cheer: 0, phase: 0, time: 0, lookX: 0, lookY: 0, talk: 0, fist: 0 };
const PHASES = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2);
const TIMES = Array.from({ length: 8 }, (_, i) => i * 0.087);
/** Standing, the moments a finger wiggle or tap peaks (the fidget clock is seeded, so these are fixed). */
const FIDGETS = Array.from({ length: 400 }, (_, i) => i * 0.1).filter((t) => {
  const { wiggle, tap } = fidget(t);
  return Math.abs(wiggle) > 0.6 || tap > 0.6;
});
const POSES: [string, PoseInput][] = [
  ["idle", { ...STILL, time: 1.3, lookX: 0.8, lookY: -0.5 }],
  ...TIMES.map((time): [string, PoseInput] => [`wave ${time.toFixed(2)}`, { ...STILL, wave: 1, time }]),
  ...TIMES.map((time): [string, PoseInput] => [`cheer ${time.toFixed(2)}`, { ...STILL, cheer: 1, air: 0.4, time }]),
  ["take-off", { ...STILL, air: 0.5, fist: 1 }],
  ["landing", { ...STILL, air: 0.3, fist: 0.5 }],
  ...[0.25, 0.5, 0.75].map((walk): [string, PoseInput] => [`stopping ${walk}`, { ...STILL, walk, phase: 2, fist: walk }]),
  ["jump", { ...STILL, air: 1, fist: 1 }],
  ["dash", { ...STILL, dash: 1, fist: 1 }],
  ["talk", { ...STILL, talk: 1 }],
  ["talk, waving", { ...STILL, talk: 1, wave: 1, time: 0.3 }],
  ...FIDGETS.map((time): [string, PoseInput] => [`fidget ${time.toFixed(2)}`, { ...STILL, time }]),
  ...PHASES.map((phase): [string, PoseInput] => [`walk ${phase.toFixed(2)}`, { ...STILL, walk: 1, phase, fist: 1 }]),
  ...PHASES.map((phase): [string, PoseInput] => [`walk to dash ${phase.toFixed(2)}`, { ...STILL, walk: 0.5, dash: 0.5, phase, fist: 1 }]),
];

let rest: Float32Array;
let index: ArrayLike<number>;
/** Open edges in the file's own mesh (welded by position). */
let openBefore: number;
let body: ReturnType<typeof volume> | undefined;
let fist: ReturnType<typeof volume> | undefined;
let rig: CusoRig;
let skinned: SkinnedMesh;
let scene: Group;

beforeAll(async () => {
  const file = await loadBody();
  openBefore = openEdges(file.position, file.index);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(file.position, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(file.normal, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(file.uv, 2));
  geometry.setIndex(new Uint32BufferAttribute(file.index, 1));
  const body = new Mesh(geometry, new MeshStandardMaterial());
  body.name = "Mesh0";
  scene = new Group();
  scene.add(body);
  rig = rigCuso(scene);
  skinned = scene.getObjectByName("Mesh0") as SkinnedMesh;
  // The rig cuts the hip hand free, so read the mesh back.
  rest = Float32Array.from(skinned.geometry.attributes.position.array);
  index = skinned.geometry.index!.array;
}, 60_000);

/** Edges with one face only, welding vertices that share a position: holes in the surface. */
function openEdges(p: Float32Array, tris: ArrayLike<number>) {
  const ids = new Map<string, number>();
  const id = (i: number) => {
    const k = [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]].map((v) => Math.round(v * 1e5)).join();
    if (!ids.has(k)) ids.set(k, ids.size);
    return ids.get(k)!;
  };
  const count = new Map<string, number>();
  for (let f = 0; f < tris.length; f += 3) {
    for (let k = 0; k < 3; k++) {
      const [a, b] = [id(tris[f + k]), id(tris[f + ((k + 1) % 3)])].sort((x, y) => x - y);
      count.set(`${a},${b}`, (count.get(`${a},${b}`) ?? 0) + 1);
    }
  }
  return [...count.values()].filter((c) => c === 1).length;
}

/** Vertex positions in a pose, as shown: Mesh0's space, mirrored like the rigged mesh. */
function posed(input: PoseInput) {
  pose(rig, input);
  scene.updateMatrixWorld(true);
  const out = new Float32Array(rest.length);
  const v = new Vector3();
  for (let i = 0; i < rest.length / 3; i++) {
    skinned.getVertexPosition(i, v).applyMatrix4(skinned.matrixWorld);
    out.set([v.x, v.y, v.z], i * 3);
  }
  return out;
}

const dist = (p: Float32Array, a: number, b: number) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);

/**
 * Edges stretched to more than 5 times their rest length and by more than 0.005
 * (3 cm on Cuso): a face pulled into a sheet between two parts. Rubber-hose bends
 * stay under 4.5 times.
 */
function torn(p: Float32Array) {
  const bad: string[] = [];
  for (let f = 0; f < index.length; f += 3) {
    for (const [a, b] of [[index[f], index[f + 1]], [index[f + 1], index[f + 2]], [index[f + 2], index[f]]]) {
      const before = dist(rest, a, b);
      const after = dist(p, a, b);
      if (after > before * 5 && after - before > 0.005) bad.push(`(${rest[a * 3].toFixed(4)}, ${rest[a * 3 + 1].toFixed(4)}) to (${rest[b * 3].toFixed(4)}, ${rest[b * 3 + 1].toFixed(4)}): ${before.toFixed(4)} -> ${after.toFixed(4)}`);
    }
  }
  return bad;
}

/** Angle in degrees between a shoe's long axis (seen from above) and his heading (+z). */
function shoeTurn(p: Float32Array, left: boolean) {
  let n = 0, mx = 0, mz = 0;
  const pts: [number, number][] = [];
  for (let i = 0; i < rest.length / 3; i++) {
    if (rest[i * 3 + 1] > -0.105 || rest[i * 3] < 0.002 !== left) continue;
    pts.push([p[i * 3], p[i * 3 + 2]]);
    mx += p[i * 3];
    mz += p[i * 3 + 2];
    n++;
  }
  mx /= n;
  mz /= n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) {
    sxx += (x - mx) ** 2;
    szz += (z - mz) ** 2;
    sxz += (x - mx) * (z - mz);
  }
  const fromX = (0.5 * Math.atan2(2 * sxz, sxx - szz) * 180) / Math.PI;
  return 90 - Math.abs(fromX);
}

/** How much of a vertex's weight is on these bones. */
function weightOn(i: number, bones: number[]) {
  const { skinIndex, skinWeight } = skinned.geometry.attributes;
  let w = 0;
  for (let k = 0; k < 4; k++) if (bones.includes(skinIndex.getComponent(i, k))) w += skinWeight.getComponent(i, k);
  return w;
}

/** Vertices bound fully to these bones. */
function boundTo(...bones: number[]) {
  const out: number[] = [];
  for (let i = 0; i < rest.length / 3; i++) if (weightOn(i, bones) > 0.999) out.push(i);
  return out;
}

const ARM_L = [BONE.armL, BONE.wristL, BONE.fingerL];
const ARM_R = [BONE.armR, BONE.wristR];

/**
 * Inside test for a closed part of him at rest (the faces whose every vertex
 * passes `keep`): per (x, y) column, the z where its surface crosses it. A point
 * is inside when an odd number of crossings lie above it; its depth is the
 * distance to the nearest of those vertices.
 */
function volume(keep: (i: number) => boolean) {
  const CELL = 0.0008;
  const cols = new Map<number, number[]>();
  const v = (i: number) => [rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]];
  for (let f = 0; f < index.length; f += 3) {
    const t = [index[f], index[f + 1], index[f + 2]];
    if (!t.every(keep)) continue;
    const [a, b, c] = t.map(v);
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(det) < 1e-14) continue;
    for (let cx = Math.ceil(Math.min(a[0], b[0], c[0]) / CELL); cx * CELL <= Math.max(a[0], b[0], c[0]); cx++) {
      for (let cy = Math.ceil(Math.min(a[1], b[1], c[1]) / CELL); cy * CELL <= Math.max(a[1], b[1], c[1]); cy++) {
        const [x, y] = [cx * CELL, cy * CELL];
        const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det;
        const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const key = cx * 100_000 + cy;
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key)!.push(l1 * a[2] + l2 * b[2] + (1 - l1 - l2) * c[2]);
      }
    }
  }
  // Body vertices on a grid, for the distance to the surface.
  const near = new Map<number, number[]>();
  const cell = (x: number, y: number, z: number) => (Math.floor(x / 0.003) + 100) * 1e6 + (Math.floor(y / 0.003) + 100) * 1e3 + Math.floor(z / 0.003) + 100;
  for (let i = 0; i < rest.length / 3; i++) {
    if (!keep(i)) continue;
    const k = cell(rest[i * 3], rest[i * 3 + 1], rest[i * 3 + 2]);
    if (!near.has(k)) near.set(k, []);
    near.get(k)!.push(i);
  }
  const distance = (x: number, y: number, z: number) => {
    let d = 0.003;
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
      for (const i of near.get(cell(x + dx * 0.003, y + dy * 0.003, z + dz * 0.003)) ?? []) d = Math.min(d, Math.hypot(rest[i * 3] - x, rest[i * 3 + 1] - y, rest[i * 3 + 2] - z));
    }
    return d;
  };
  /** How deep a point is inside (0 outside), up to 0.003. */
  return (x: number, y: number, z: number) => {
    const zs = cols.get(Math.round(x / CELL) * 100_000 + Math.round(y / CELL)) ?? [];
    return zs.filter((c) => c > z).length % 2 === 1 ? distance(x, y, z) : 0;
  };
}

describe("Cuso's rig", () => {
  it.each(POSES)("keeps the mesh in one piece: %s", (_, input) => {
    expect(torn(posed(input))).toEqual([]);
  });

  it.each(POSES)("points both shoes where he is going: %s", (_, input) => {
    const p = posed(input);
    expect(shoeTurn(p, true)).toBeLessThan(5);
    expect(shoeTurn(p, false)).toBeLessThan(5);
  });

  it("looks like the brand Cuso from the front: arrow tip up and left, thumbs-up on the right", () => {
    // Facing +z, toward a camera looking back at his face: the viewer's left is -x.
    const p = posed(STILL);
    let top = 0;
    for (let i = 0; i < p.length / 3; i++) if (p[i * 3 + 1] > p[top * 3 + 1]) top = i;
    expect(p[top * 3]).toBeLessThan(-0.02);
    const thumb = new Vector3().setFromMatrixPosition(rig.bones.armL.matrixWorld);
    expect(thumb.x).toBeGreaterThan(0.02);
  });

  it("frees the hip hand: the arm and fist move on their own bones", () => {
    expect(boundTo(...ARM_R).length).toBeGreaterThan(1500);
    expect(boundTo(BONE.wristR).length).toBeGreaterThan(800);
  });

  it("fidgets now and then while standing: finger wiggles and taps", () => {
    expect(FIDGETS.filter((t) => fidget(t).tap > 0).length).toBeGreaterThan(3);
    expect(FIDGETS.filter((t) => fidget(t).wiggle !== 0).length).toBeGreaterThan(3);
  });

  it("gives the raised hand a wrist and a two-jointed finger of its own", () => {
    expect(boundTo(BONE.wristL).length).toBeGreaterThan(800);
    expect(boundTo(BONE.fingerL, BONE.fingerTipL).length).toBeGreaterThan(200);
    expect(boundTo(BONE.fingerTipL).length).toBeGreaterThan(80);
  });

  it("brings the hands to life when he walks", () => {
    const cycle = PHASES.map((phase) => {
      pose(rig, { ...STILL, walk: 1, phase });
      return [rig.bones.wristL.rotation.x, rig.bones.wristR.rotation.x];
    });
    for (let k = 0; k < 2; k++) expect(Math.max(...cycle.map((c) => c[k])) - Math.min(...cycle.map((c) => c[k]))).toBeGreaterThan(0.2);
  });

  it("carries both hands as loose fists on the move, and points only when it means something", () => {
    const finger = (input: PoseInput) => {
      pose(rig, input);
      return [rig.bones.fingerL.rotation.x, rig.bones.fingerTipL.rotation.x];
    };
    for (const input of [{ walk: 1 }, { dash: 1 }, { air: 1 }, { walk: 0.5, dash: 0.5 }]) expect(finger({ ...STILL, ...input, phase: 1, fist: 1 })).toEqual([CURL, CURL]);
    for (const input of [{}, { talk: 1 }, { wave: 1 }, { cheer: 1, air: 0.4 }, { talk: 1, fist: 1 }, { cheer: 1, air: 0.4, fist: 1 }]) {
      const [base, tip] = finger({ ...STILL, ...input });
      expect(Math.abs(base)).toBeLessThan(0.5);
      expect(tip).toBe(0);
    }
  });

  it("curls and uncurls the finger smoothly as he starts and stops", () => {
    const steps = Array.from({ length: 41 }, (_, i) => {
      pose(rig, { ...STILL, walk: i / 40, fist: i / 40 });
      return rig.bones.fingerTipL.rotation.x;
    });
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1]);
      expect(steps[i] - steps[i - 1]).toBeLessThan(0.1);
    }
  });

  it.each(POSES.filter(([n]) => /walk|dash|jump/.test(n)))("lays the curled finger on its fist: %s", (_, input) => {
    const p = posed(input);
    const toHand = rig.bones.wristL.matrixWorld.clone().multiply(skinned.skeleton.boneInverses[BONE.wristL]).invert();
    const fistAt = boundTo(BONE.wristL);
    const v = new Vector3();
    let gap = 1;
    for (const i of boundTo(BONE.fingerTipL).filter((k) => rest[k * 3 + 1] > 0.0755)) {
      v.fromArray(p, i * 3).applyMatrix4(toHand);
      for (const j of fistAt) gap = Math.min(gap, Math.hypot(rest[j * 3] - v.x, rest[j * 3 + 1] - v.y, rest[j * 3 + 2] - v.z));
    }
    expect(gap).toBeLessThan(0.003);
  });

  it("keeps the hip hand exactly on his hip while he stands, talks or fidgets", () => {
    for (const input of [STILL, ...POSES.filter(([n]) => /idle|talk|fidget/.test(n)).map(([, i]) => i)]) {
      pose(rig, { ...input, wave: 0 });
      for (const bone of [rig.bones.armR, rig.bones.wristR]) expect([bone.rotation.x, bone.rotation.y, bone.rotation.z]).toEqual([0, 0, 0]);
    }
  });

  it.each([["cheer", { ...STILL, cheer: 1, air: 0.4 }], ["take-off", { ...STILL, air: 0.5 }], ["talk", { ...STILL, talk: 1 }], ["dash", { ...STILL, dash: 1 }]] as [string, PoseInput][])(
    "leaves no holes when the hands move: %s",
    (_, input) => {
      expect(openEdges(posed(input), index)).toBeLessThanOrEqual(openBefore);
    },
  );

  it.each(POSES)("keeps both fists out of his body: %s", (_, input) => {
    const depth = (body ??= volume((i) => weightOn(i, [...ARM_L, ...ARM_R]) === 0));
    const p = posed(input);
    // The hands (the upper arms bend into his shoulders like hoses, see above).
    // Into the body's own frame: the body bone carries both shoulders.
    const toBody = rig.bones.body.matrixWorld.clone().multiply(skinned.skeleton.boneInverses[BONE.body]).invert();
    const v = new Vector3();
    const inside = [...boundTo(BONE.wristL, BONE.fingerL), ...boundTo(BONE.wristR)].filter((i) => {
      v.fromArray(p, i * 3).applyMatrix4(toBody);
      return depth(v.x, v.y, v.z) > 0.0015;
    });
    expect(inside.length).toBe(0);
  });

  it.each(POSES)("keeps the raised finger out of its fist: %s", (_, input) => {
    const depth = (fist ??= volume((i) => weightOn(i, [BONE.wristL]) > 0.999));
    const p = posed(input);
    const toHand = rig.bones.wristL.matrixWorld.clone().multiply(skinned.skeleton.boneInverses[BONE.wristL]).invert();
    const v = new Vector3();
    const inside = boundTo(BONE.fingerL, BONE.fingerTipL).filter((i) => {
      v.fromArray(p, i * 3).applyMatrix4(toHand);
      return depth(v.x, v.y, v.z) > 0.001;
    });
    expect(inside.length).toBe(0);
  });

  it("HULL holds his standing mesh", () => {
    const p = posed(STILL);
    const out: string[] = [];
    for (let i = 0; i < p.length / 3; i++) {
      const [x, h, z] = [p[i * 3] * SCALE, (p[i * 3 + 1] + 0.1524) * SCALE, p[i * 3 + 2] * SCALE];
      const inside = HULL.some(([y0, y1, x0, x1, z0, z1]) => h >= y0 - 0.01 && h <= y1 + 0.01 && x >= x0 - 0.02 && x <= x1 + 0.02 && z >= z0 - 0.02 && z <= z1 + 0.02);
      if (!inside) out.push(`${x.toFixed(2)}, ${h.toFixed(2)}, ${z.toFixed(2)}`);
    }
    expect(out.slice(0, 10)).toEqual([]);
  });
});
