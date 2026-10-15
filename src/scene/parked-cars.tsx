"use client";

// Parked cars along the kerbs (placed by parked.ts). The moving cars' Tesla
// models (traffic.tsx), each baked into one geometry with its parts' colours
// and finishes, all drawn as one batched mesh: one draw call for every parked
// car in view, paint per car, lights off. Desktop draws the full model up close
// and the lite one further off; phones draw the lite models and about half the
// cars. Under each car a soft blob, like the moving cars; no real shadow.

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BatchedMesh,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Frustum,
  Matrix3,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Sphere,
  Vector3,
  type InstancedMesh,
  type Material,
  type Mesh,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { parkCars, type ParkedCar } from "./parked";
import { DETAIL, rig } from "./shared";
import { MODELS, type CarType } from "./traffic";

/** Dev only: `?parked=off` hides the parked cars, for before and after screenshots. Compiled out of production builds. */
const OFF = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("parked") === "off";

const TYPES: CarType[] = ["model3", "modely", "cybertruck"];

/** Per part: paint (takes the car's colour), roughness, metalness and base colour (the moving cars' materials, lights off). */
const FINISH: Record<string, [number, number, number, string]> = {
  paint: [1, 0.3, 0.25, "#ffffff"],
  glass: [0, 0.08, 0.55, "#35424f"],
  trim: [0, 0.7, 0, "#121315"],
  rim: [0, 0.45, 0.35, "#6c7177"],
  tyre: [0, 0.9, 0, "#0d0d0e"],
  light_front: [0, 0.15, 0.3, "#8d929a"],
  light_rear: [0, 0.3, 0, "#6e0b10"],
};

const v = new Vector3();
const normals = new Matrix3();
const tone = new Color();

/** A part as plain floats in car units, with its colour and finish per vertex (so every part shares one material). */
function plain(g: BufferGeometry, m: Matrix4, [paint, rough, metal, hex]: [number, number, number, string]) {
  const { position, normal } = g.attributes;
  const n = position.count;
  const [pos, nor, col, fin] = [0, 1, 2, 3].map(() => new Float32Array(n * 3));
  normals.getNormalMatrix(m);
  tone.set(hex);
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(m).toArray(pos, i * 3);
    v.fromBufferAttribute(normal, i).applyMatrix3(normals).normalize().toArray(nor, i * 3);
    tone.toArray(col, i * 3);
    fin.set([paint, rough, metal], i * 3);
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  out.setAttribute("color", new Float32BufferAttribute(col, 3));
  out.setAttribute("finish", new Float32BufferAttribute(fin, 3));
  out.setIndex(g.index ? Array.from(g.index.array) : Array.from({ length: n }, (_, i) => i));
  return out;
}

/** One car model as one geometry in city units, its wheel at all four wheel spots (scripts/convert-cars.mjs). */
function bake(scene: Object3D, scale: number) {
  scene.updateMatrixWorld(true);
  let wheels: number[][] = [];
  scene.traverse((o) => void (o.userData.wheels && (wheels = o.userData.wheels)));
  const toCar = new Matrix4().makeScale(scale, scale, scale);
  // the right side is the same wheel turned round, so its rim faces out (as traffic.tsx does)
  const spots = wheels.map(([x, y, z, r]) =>
    toCar
      .clone()
      .multiply(new Matrix4().makeTranslation(x, y, z))
      .multiply(new Matrix4().makeRotationY(x < 0 ? Math.PI : 0))
      .multiply(new Matrix4().makeScale(r / wheels[0][3], r / wheels[0][3], r / wheels[0][3])),
  );
  const parts: BufferGeometry[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    const name = (mesh.material as Material | undefined)?.name ?? "";
    if (!mesh.isMesh || !(name in FINISH)) return;
    const wheel = name === "tyre" || name === "rim";
    for (const at of wheel ? spots : [toCar]) parts.push(plain(mesh.geometry, at.clone().multiply(mesh.matrixWorld), FINISH[name]));
  });
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

/** Vertex colours and finishes; the car's paint colour only on its paint. */
function carMaterial() {
  const m = new MeshStandardMaterial({ vertexColors: true, side: DoubleSide });
  m.customProgramCacheKey = () => "parked-car";
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 finish;\nvarying vec2 vFinish;")
      .replace(
        "#include <color_vertex>",
        `vColor = vec4(color, 1.0);
        #ifdef USE_BATCHING_COLOR
          vColor.rgb *= mix(vec3(1.0), getBatchingColor(getIndirectIndex(gl_DrawID)).rgb, finish.x);
        #endif
        vFinish = finish.yz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFinish;")
      .replace("#include <roughnessmap_fragment>", "float roughnessFactor = vFinish.x;")
      .replace("#include <metalnessmap_fragment>", "float metalnessFactor = vFinish.y;");
  };
  return m;
}

/** A soft dark blob under a car where it meets the street (as under the moving cars). */
function blob() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.6, "rgba(0,0,0,0.35)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return {
    geometry: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    material: new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  };
}

/** Up to here the full model (desktop): the lite one strays up to 2 cm, under a pixel from about 19 units off at 1440x900. */
const LOD_DISTANCE = 16;

/** Placed once per visit (it reads every moving car's route). */
let placed: ParkedCar[] | null = null;

const o = new Object3D();
o.rotation.order = "YXZ";
const m4 = new Matrix4();
const frustum = new Frustum();
const sphere = new Sphere();

function ParkedCars({ lite }: { lite: boolean }) {
  const cars = useMemo(() => (placed ??= parkCars()).filter((c) => !lite || c.lite), [lite]);
  // desktop: the full models up close, the lite ones further off; phones: the lite ones
  const gltfs = useGLTF([...(lite ? [] : TYPES.map((t) => MODELS[t].url)), ...TYPES.map((t) => MODELS[t].liteUrl)]);
  const shadow = useMemo(() => blob(), []);
  const blobs = useRef<InstancedMesh>(null);

  const { mesh, poses } = useMemo(() => {
    const geometries = gltfs.map(({ scene }, k) => bake(scene, MODELS[TYPES[k % TYPES.length]].scale));
    const vertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
    const indices = geometries.reduce((n, g) => n + g.index!.count, 0);
    const mesh = new BatchedMesh(cars.length, vertices, indices, carMaterial());
    const ids = geometries.map((g) => mesh.addGeometry(g));
    geometries.forEach((g) => g.dispose());
    mesh.receiveShadow = true;
    mesh.layers.set(DETAIL); // no parked cars in reflections
    const poses = cars.map((c) => {
      o.position.set(c.x, c.y, c.z);
      o.rotation.set(c.pitch, c.yaw, c.roll);
      o.updateMatrix();
      const t = TYPES.indexOf(c.type);
      const near = ids[t];
      const far = ids[ids.length - TYPES.length + t];
      const id = mesh.addInstance(far);
      mesh.setMatrixAt(id, o.matrix);
      mesh.setColorAt(id, tone.set(c.color));
      const { length, width } = MODELS[c.type];
      return { id, near, far, lod: far, at: o.position.clone(), reach: length / 2, blob: o.matrix.clone().multiply(m4.makeScale(width * 1.1, 1, length * 1.08)) };
    });
    return { mesh, poses };
  }, [gltfs, cars]);

  // Only the buffers: BatchedMesh.dispose() can't be undone, and Strict Mode unmounts once and mounts again.
  useEffect(() => () => mesh.geometry.dispose(), [mesh]);
  useEffect(() => () => [shadow.geometry, shadow.material, shadow.material.map].forEach((x) => x?.dispose()), [shadow]);

  useFrame(({ camera }) => {
    // at night the sky no longer lights the paint and glass (as on the moving cars)
    (mesh.material as MeshStandardMaterial).envMapIntensity = 1 - 0.8 * rig.night;
    // desktop: the full model within LOD_DISTANCE (past it the lite model's error is under a pixel)
    for (const p of poses) {
      const lod = camera.position.distanceTo(p.at) < LOD_DISTANCE ? p.near : p.far;
      if (lod !== p.lod) mesh.setGeometryIdAt(p.id, (p.lod = lod));
    }
    // only the blobs of cars in view, so none in view costs no draw call
    const b = blobs.current;
    if (!b) return;
    frustum.setFromProjectionMatrix(m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let n = 0;
    for (const p of poses) if (frustum.intersectsSphere(sphere.set(p.at, p.reach))) b.setMatrixAt(n++, p.blob);
    b.count = n;
    b.visible = n > 0;
    b.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={mesh} />
      <instancedMesh ref={blobs} args={[shadow.geometry, shadow.material, cars.length]} frustumCulled={false} renderOrder={-1} layers={DETAIL} />
    </>
  );
}

/** The parked cars, unless `?parked=off` (dev). */
export function Parked({ lite }: { lite: boolean }) {
  return OFF ? null : <ParkedCars lite={lite} />;
}
