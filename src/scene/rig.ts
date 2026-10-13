// Cuso's skeleton. The mascot.glb has no bones, so we add them at load time:
// skin weights come from where each vertex sits on the (flat) character.
// Coordinates are Mesh0's local space (model units): mesh centre at y 0, feet
// at y -0.152, facing +z. "L" is the model's -x side (the raised thumbs-up arm).
// The file is a mirror image of the brand character, so the rigged mesh is
// mirrored in x (`MIRROR`): bones, weights and poses all work in the file's space.

import { Bone, Float32BufferAttribute, Skeleton, SkinnedMesh, Uint16BufferAttribute, Uint32BufferAttribute, Vector3, type BufferGeometry, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";

/** Model units to world units: the model is 0.3 tall, Cuso is ~1.9 units (about door height). */
export const SCALE = 6.2;

/**
 * Cuso's body in world units, measured from the mesh in height bands:
 * [bottom, top, x0, x1, z0, z1] above his feet, in his own frame (he faces +z),
 * as he is shown (mirrored): the hip hand and the arrow tip are on his -x side.
 * Shoes, legs, the hip arm, both arms, the arrow tip. The collision test uses it,
 * rig.test.ts checks it still holds the mesh.
 */
export const HULL: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, 0.2, -0.33, 0.31, -0.18, 0.31],
  [0.2, 0.4, -0.28, 0.26, -0.15, 0.14],
  [0.4, 0.8, -0.63, 0.22, -0.14, 0.09],
  [0.8, 1.5, -0.63, 0.63, -0.14, 0.09],
  [1.5, 1.89, -0.42, -0.01, -0.14, 0.09],
];

/**
 * x scale of the rigged mesh. The brand Cuso, seen from the front, points his
 * arrow up and left like a real cursor, with the thumbs-up hand on the right;
 * cuso.glb has him the other way round.
 */
const MIRROR = -1;

export const BONE = { root: 0, hips: 1, body: 2, armL: 3, armR: 4, thighL: 5, shinL: 6, footL: 7, thighR: 8, shinR: 9, footR: 10 } as const;
export type BoneName = keyof typeof BONE;

type P = readonly [number, number, number?];
/** Joint positions (x, y, z = 0 unless given) traced from the mesh. Leg joints sit in the middle of the leg (z -0.008). */
export const JOINT = {
  root: [0, -0.152],
  hips: [-0.005, -0.06],
  shoulderL: [-0.058, 0.002],
  shoulderR: [0.074, 0.006, -0.007],
  hipL: [-0.02, -0.066, -0.008],
  kneeL: [-0.023, -0.088, -0.008],
  ankleL: [-0.021, -0.106, -0.008],
  hipR: [0.007, -0.066, -0.008],
  kneeR: [0.012, -0.088, -0.008],
  ankleR: [0.023, -0.106, -0.008],
} as const satisfies Record<string, P>;

const smooth = (edge0: number, edge1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * The shoes are modelled turned out (radians, each toe away from the other), like a
 * flat mascot standing with his heels together. The foot bones turn them to point ahead.
 */
const TOE_OUT = 0.85;

/** Up to four [bone, weight] pairs for a vertex at (x, y). Weights sum to 1. */
export function weightsAt(x: number, y: number): [number, number][] {
  const inLegs = y < -0.058 && x > -0.045 && x < 0.04 && !(x > 0.035 && y > -0.08);

  if (inLegs || y < -0.104) {
    // Below the crotch (y -0.078) the legs stand apart, the left one up to x -0.004,
    // the right one from x 0.008: each is all one side. Above it they join, so the
    // seam blends from one thigh to the other instead of tearing.
    const left = smooth(0.0075, -0.004, x);
    const footW = smooth(-0.098, -0.108, y);
    const shinW = smooth(-0.076, -0.094, y) * (1 - footW);
    const bodyW = smooth(-0.07, -0.058, y); // the top of the leg melts into the body
    const thighW = (1 - footW - shinW) * (1 - bodyW);
    const pairs: [number, number][] = [
      [BONE.footL, footW * left],
      [BONE.footR, footW * (1 - left)],
      [BONE.shinL, shinW * left],
      [BONE.shinR, shinW * (1 - left)],
      [BONE.thighL, thighW * left],
      [BONE.thighR, thighW * (1 - left)],
      [BONE.body, (1 - footW - shinW) * bodyW],
    ];
    return pairs.filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
  }

  // The thumbs-up arm bends like a rubber hose from the shoulder outwards.
  if (x < JOINT.shoulderL[0] + 0.004 && y > -0.035) {
    const w = smooth(JOINT.shoulderL[0] + 0.004, JOINT.shoulderL[0] - 0.012, x);
    return [[BONE.armL, w], [BONE.body, 1 - w]];
  }
  return [[BONE.body, 1]];
}

/**
 * Weights for the hip arm (vertices `freeHipHand` found): the upper arm bends like
 * a hose from the shoulder out to the elbow; the forearm and the fist are rigid.
 */
export function hipArmWeightsAt(x: number, y: number): [number, number][] {
  const w = Math.max(smooth(0.0725, 0.1, x), smooth(-0.005, -0.02, y));
  return [[BONE.armR, w], [BONE.body, 1 - w]];
}

export type CusoRig = { bones: Record<BoneName, Bone>; rest: Record<BoneName, { x: number; y: number; z: number }> };

/**
 * Turns Mesh0 into a SkinnedMesh with Cuso's bones. Idempotent: useGLTF caches
 * the scene, so a second call returns the first rig.
 */
export function rigCuso(scene: Object3D): CusoRig {
  if (scene.userData.rig) return scene.userData.rig as CusoRig;
  const mesh = scene.getObjectByName("Mesh0") as Mesh;
  const geometry = mesh.geometry;
  const arm = freeHipHand(geometry);
  const pos = geometry.attributes.position;

  const index = new Uint16Array(pos.count * 4);
  const weight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const pairs = (arm[i] ? hipArmWeightsAt : weightsAt)(pos.getX(i), pos.getY(i));
    const sum = pairs.reduce((s, [, w]) => s + w, 0) || 1;
    pairs.forEach(([b, w], k) => {
      index[i * 4 + k] = b;
      weight[i * 4 + k] = w / sum;
    });
  }
  geometry.setAttribute("skinIndex", new Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new Float32BufferAttribute(weight, 4));

  const make = (name: BoneName, at: P, parentAt: P) => {
    const b = new Bone();
    b.name = `cuso-${name}`;
    b.position.set(at[0] - parentAt[0], at[1] - parentAt[1], (at[2] ?? 0) - (parentAt[2] ?? 0));
    return b;
  };
  const J = JOINT;
  const bones: Record<BoneName, Bone> = {
    root: make("root", J.root, [0, 0]),
    hips: make("hips", J.hips, J.root),
    body: make("body", J.hips, J.hips),
    armL: make("armL", J.shoulderL, J.hips),
    armR: make("armR", J.shoulderR, J.hips),
    thighL: make("thighL", J.hipL, J.hips),
    shinL: make("shinL", J.kneeL, J.hipL),
    footL: make("footL", J.ankleL, J.kneeL),
    thighR: make("thighR", J.hipR, J.hips),
    shinR: make("shinR", J.kneeR, J.hipR),
    footR: make("footR", J.ankleR, J.kneeR),
  };
  bones.root.add(bones.hips);
  bones.hips.add(bones.body, bones.thighL, bones.thighR);
  bones.body.add(bones.armL, bones.armR);
  bones.thighL.add(bones.shinL);
  bones.shinL.add(bones.footL);
  bones.thighR.add(bones.shinR);
  bones.shinR.add(bones.footR);

  paintBack(mesh.material as Material);
  const skinned = new SkinnedMesh(geometry, mesh.material);
  skinned.name = mesh.name;
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.castShadow = skinned.receiveShadow = true;
  const parent = mesh.parent!;
  parent.add(skinned);
  skinned.add(bones.root);
  // The eyes ride on the body, not on the hips.
  for (const child of [...mesh.children]) skinned.add(child);
  parent.remove(mesh);
  scene.updateMatrixWorld(true);
  skinned.bind(new Skeleton(Object.keys(BONE).map((k) => bones[k as BoneName])));
  for (const eye of ["EyeL", "EyeR"]) {
    const o = skinned.getObjectByName(eye);
    if (o) bones.body.attach(o);
  }
  bones.footL.rotation.y = TOE_OUT;
  bones.footR.rotation.y = -TOE_OUT;
  // After binding, so the skeleton stays in the file's space; three.js flips the
  // face winding for a mirrored object, so lighting, shadows and the back paint hold.
  skinned.scale.x *= MIRROR;

  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }])) as CusoRig["rest"];
  const rig = { bones, rest };
  scene.userData.rig = rig;
  return rig;
}

/**
 * The hip hand is modelled fused to his side: one surface, where the arm leaves the
 * flat right edge of the arrow (x 0.072) through two holes, the shoulder and the wrist.
 * This cuts the wrist ring so the arm is a free limb: the arm gets its own copy of
 * the ring's vertices, and both openings (on his hip and on the fist) get a flat cap.
 * Nothing moves until the arm bone does. Returns 1 for every vertex of the arm.
 */
function freeHipHand(geometry: BufferGeometry): Uint8Array {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const tris = Array.from(geometry.index!.array);
  const faces = tris.length / 3;
  const corner = (f: number, k: number) => tris[f * 3 + (k % 3)];
  const at = (i: number) => new Vector3().fromBufferAttribute(pos, i);

  // One id per position (the mesh is split along its UV seams), and the faces on each edge.
  const ids = new Map<string, number>();
  const weld = Int32Array.from({ length: n }, (_, i) => {
    const k = [pos.getX(i), pos.getY(i), pos.getZ(i)].map((v) => Math.round(v * 1e5)).join();
    if (!ids.has(k)) ids.set(k, i);
    return ids.get(k)!;
  });
  const edge = (a: number, b: number) => Math.min(weld[a], weld[b]) * n + Math.max(weld[a], weld[b]);
  const edgeFaces = new Map<number, number[]>();
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const e = edge(corner(f, k), corner(f, k + 1));
      if (!edgeFaces.has(e)) edgeFaces.set(e, []);
      edgeFaces.get(e)!.push(f);
    }
  }
  // The arrow's right edge: faces looking right (within 40 degrees), left of x 0.0735.
  const edgeOfArrow = (f: number) => {
    const [a, b, c] = [0, 1, 2].map((k) => at(corner(f, k)));
    return b.clone().sub(a).cross(c.clone().sub(a)).normalize().x > 0.77 && (a.x + b.x + c.x) / 3 < 0.0735;
  };

  // Flood the arm from the outer side of the fist; it ends where it meets the arrow's edge.
  let seed = 0;
  for (let f = 0; f < faces; f++) if (pos.getY(corner(f, 0)) < -0.03 && pos.getX(corner(f, 0)) > pos.getX(corner(seed, 0))) seed = f;
  const inArm = new Uint8Array(faces);
  inArm[seed] = 1;
  for (const stack = [seed]; stack.length > 0; ) {
    const f = stack.pop()!;
    for (let k = 0; k < 3; k++) {
      for (const g of edgeFaces.get(edge(corner(f, k), corner(f, k + 1)))!) {
        if (!inArm[g] && !edgeOfArrow(g)) {
          inArm[g] = 1;
          stack.push(g);
        }
      }
    }
  }
  for (let f = 0; f < faces; f++) {
    // Leaked into the body: not the mesh this was written for, leave the hand on the hip.
    if (inArm[f] && pos.getX(corner(f, 0)) < 0.065) return new Uint8Array(n);
  }

  // The wrist ring (the shoulder ring stays joined), each edge as its face walks it.
  const seam: { a: number; b: number; arm: boolean }[] = [];
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const a = corner(f, k), b = corner(f, k + 1);
      const across = edgeFaces.get(edge(a, b))!.some((g) => inArm[g] !== inArm[f]);
      if (across && pos.getY(a) < -0.02) seam.push({ a, b, arm: inArm[f] === 1 });
    }
  }
  const ring = new Set(seam.map((s) => weld[s.a]));

  // New vertices copy an old one: `from[j]` is the source of vertex n + j.
  const from: number[] = [];
  const copy = (i: number) => n + from.push(i) - 1;
  // The arm stops sharing the ring's vertices with the body.
  const own = new Map<number, number>();
  for (let f = 0; f < faces; f++) {
    for (let k = 0; inArm[f] && k < 3; k++) {
      const i = tris[f * 3 + k];
      if (!ring.has(weld[i])) continue;
      if (!own.has(i)) own.set(i, copy(i));
      tris[f * 3 + k] = own.get(i)!;
    }
  }
  // A fan over each opening, walking the ring the other way round to its face.
  // Every cap vertex copies one ring vertex, so the cap is one flat black.
  const capped: { at: number; p: Vector3; normal: Vector3; arm: boolean }[] = [];
  for (const side of [false, true]) {
    const edges = seam.filter((s) => s.arm === side);
    const source = edges[0].a;
    const vertex = new Map<number, number>();
    const centre = new Vector3();
    for (const { a } of edges) {
      if (vertex.has(weld[a])) continue;
      vertex.set(weld[a], copy(source));
      centre.add(at(a));
    }
    centre.divideScalar(vertex.size);
    const mid = copy(source);
    const normal = new Vector3();
    for (const { a, b } of edges) {
      tris.push(vertex.get(weld[b])!, vertex.get(weld[a])!, mid);
      normal.add(at(a).sub(centre).cross(at(b).sub(centre)).negate());
    }
    normal.normalize();
    capped.push({ at: mid, p: centre, normal, arm: side });
    for (const [w, v] of vertex) capped.push({ at: v, p: at(w), normal, arm: side });
    // On his hip the ring now lies on the flat edge: shade it flat like the edge.
    for (let i = 0; i < n && !side; i++) if (ring.has(weld[i])) capped.push({ at: i, p: at(i), normal, arm: false });
  }

  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const size = attr.itemSize;
    const out = new Float32Array((n + from.length) * size);
    for (let i = 0; i < n + from.length; i++) {
      const src = i < n ? i : from[i - n];
      for (let c = 0; c < size; c++) out[i * size + c] = attr.getComponent(src, c);
    }
    for (const c of capped) {
      if (name === "position") c.p.toArray(out, c.at * 3);
      if (name === "normal") c.normal.toArray(out, c.at * 3);
    }
    geometry.setAttribute(name, new Float32BufferAttribute(out, size));
  }
  geometry.setIndex(new Uint32BufferAttribute(tris, 1));

  const arm = new Uint8Array(n + from.length);
  for (let f = 0; f < faces; f++) for (let k = 0; inArm[f] && k < 3; k++) arm[tris[f * 3 + k]] = 1;
  for (const c of capped) arm[c.at] = c.arm ? 1 : 0;
  return arm;
}

/**
 * Cuso is flat: from behind, his white face would read as a mirrored cursor.
 * Paint the back of the arrow body (faces pointing -z, above the legs) dark,
 * like his rubber outline. Shoes and legs keep their colours.
 */
function paintBack(material: Material) {
  const m = material as MeshStandardMaterial;
  m.customProgramCacheKey = () => "cuso-back";
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vBack;")
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\nvBack = smoothstep(-0.35, -0.75, objectNormal.z) * step(-0.062, position.y);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vBack;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.035, 0.04), vBack);");
  };
}
