// Cuso's skeleton. The mascot.glb has no bones, so we add them at load time:
// skin weights come from where each vertex sits on the (flat) character.
// Coordinates are Mesh0's local space (model units): mesh centre at y 0, feet
// at y -0.152, facing +z. "L" is the model's -x side (the raised thumbs-up arm).

import { Bone, Float32BufferAttribute, Skeleton, SkinnedMesh, Uint16BufferAttribute, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from "three";

export const BONE = { root: 0, hips: 1, body: 2, armL: 3, armR: 4, thighL: 5, shinL: 6, footL: 7, thighR: 8, shinR: 9, footR: 10 } as const;
export type BoneName = keyof typeof BONE;

type P = readonly [number, number];
/** Joint positions (x, y) traced from the front view. */
export const JOINT = {
  root: [0, -0.152],
  hips: [-0.005, -0.06],
  shoulderL: [-0.058, 0.002],
  shoulderR: [0.077, 0.002],
  hipL: [-0.02, -0.066],
  kneeL: [-0.023, -0.088],
  ankleL: [-0.026, -0.106],
  hipR: [0.007, -0.066],
  kneeR: [0.012, -0.088],
  ankleR: [0.017, -0.106],
} as const satisfies Record<string, P>;

const smooth = (edge0: number, edge1: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Up to four [bone, weight] pairs for a vertex at (x, y). Weights sum to 1. */
export function weightsAt(x: number, y: number): [number, number][] {
  const left = x < -0.005;
  const inLegs = y < -0.062 && x > -0.045 && x < 0.04 && !(x > 0.035 && y > -0.08);

  if (inLegs || y < -0.104) {
    const thigh = left ? BONE.thighL : BONE.thighR;
    const shin = left ? BONE.shinL : BONE.shinR;
    const foot = left ? BONE.footL : BONE.footR;
    const footW = smooth(-0.098, -0.108, y);
    const shinW = smooth(-0.076, -0.094, y) * (1 - footW);
    const bodyW = smooth(-0.07, -0.058, y); // the top of the leg melts into the body
    const thighW = (1 - footW - shinW) * (1 - bodyW);
    return [
      [foot, footW],
      [shin, shinW],
      [thigh, thighW],
      [BONE.hips, (1 - footW - shinW) * bodyW],
    ];
  }

  // Arms bend like rubber hoses from the shoulder outwards.
  if (x < JOINT.shoulderL[0] + 0.004 && y > -0.035) {
    const w = smooth(JOINT.shoulderL[0] + 0.004, JOINT.shoulderL[0] - 0.012, x);
    return [[BONE.armL, w], [BONE.body, 1 - w]];
  }
  if (x > JOINT.shoulderR[0] - 0.002 && y > -0.075 && y < 0.035) {
    const w = smooth(JOINT.shoulderR[0] - 0.002, JOINT.shoulderR[0] + 0.008, x);
    return [[BONE.armR, w], [BONE.body, 1 - w]];
  }
  return [[BONE.body, 1]];
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
  const pos = geometry.attributes.position;

  const index = new Uint16Array(pos.count * 4);
  const weight = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const pairs = weightsAt(pos.getX(i), pos.getY(i));
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
    b.position.set(at[0] - parentAt[0], at[1] - parentAt[1], 0);
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

  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z }])) as CusoRig["rest"];
  const rig = { bones, rest };
  scene.userData.rig = rig;
  return rig;
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
