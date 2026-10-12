"use client";

// A few Teslas circling the city: mostly the sedan, one Cybertruck, one
// Roadster. Each loop runs clockwise on the inner lane, so every turn is a
// right turn and no two loops ever cross. Cars follow the hills, keep their
// distance and stop for Cuso. The models come from scripts/convert-cars.mjs.

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  type BufferGeometry,
  type InstancedMesh,
  type Mesh,
} from "three";
import { heightAt } from "@/lib/terrain";
import { rig, useNightGlow } from "./shared";

// ---------------------------------------------------------------------------
// Layout and driving (pure, tested in tests/unit/traffic.test.ts)

/**
 * The models at city scale (Cuso is ~1.9 units tall, a lane is 1.5 wide).
 * Metres are the GLB's own size (its node extras, checked by a test): length,
 * width over mirrors and wheels, wheelbase. The Cybertruck is scaled down a
 * little so it still fits its lane.
 */
const model = (url: string, scale: number, metres: { length: number; width: number; wheelbase: number }) => ({
  url,
  metres,
  scale,
  length: metres.length * scale,
  width: metres.width * scale,
  wheelbase: metres.wheelbase * scale,
});
export const MODELS = {
  model: model("/models/cars/model.glb", 0.72, { length: 4.69, width: 2.018, wheelbase: 2.773 }),
  cybertruck: model("/models/cars/cybertruck.glb", 0.66, { length: 5.68, width: 2.229, wheelbase: 3.702 }),
  roadster: model("/models/cars/roadster.glb", 0.72, { length: 4.3, width: 1.84, wheelbase: 2.731 }),
};
export type CarType = keyof typeof MODELS;
const TYPES = Object.keys(MODELS) as CarType[];

const LANE = 0.75;
const TURN = 1.2;
const STEP = 0.25;

/** A closed loop sampled every ~STEP units. */
export type Path = { pts: Float32Array; length: number };
export type Car = { path: Path; offset: number; speed: number; color: string; type: CarType };
export type Pose = { x: number; y: number; z: number; yaw: number; pitch: number; roll: number };

/** Tesla paints: pearl white, solid black, stealth grey, quicksilver, deep blue, ultra red. */
const PAINTS = ["#e9e8e3", "#0f1012", "#3d4045", "#a2a5a8", "#1d3563", "#a3151d"];
/** Which model each car is, in order: the Cybertruck in quicksilver, the Roadster in red. */
const LINEUP: CarType[] = ["model", "model", "model", "cybertruck", "model", "roadster", "model"];

/**
 * Loops the cars circle, [x0, x1, z0, z1] on car streets, and how many cars each.
 * No two loops share a corner: two cars turning at one corner would touch.
 */
const LOOPS: [number, number, number, number, number][] = [
  [-19, 13, -16, 34, 5], // below Russian Hill, past Union Square and SoMa, back by the Mission wall
  [-51, -35, -26, -16, 2], // Pacific Heights
];

/** Clockwise round [x0, x1, z0, z1] on the inner lane, corners rounded. */
function loop(x0: number, x1: number, z0: number, z1: number): Path {
  const a = x0 + LANE + TURN;
  const b = x1 - LANE - TURN;
  const c = z0 + LANE + TURN;
  const d = z1 - LANE - TURN;
  const dense: [number, number][] = [];
  // Arc centres NE, SE, SW, NW; angle 0 is +x (east), +90 is +z (south).
  [[b, c], [b, d], [a, d], [a, c]].forEach(([cx, cz], k) => {
    for (let i = 0; i <= 12; i++) {
      const t = ((k - 1 + i / 12) * Math.PI) / 2;
      dense.push([cx + Math.cos(t) * TURN, cz + Math.sin(t) * TURN]);
    }
  });
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const [px, pz] = dense[i - 1];
    const [qx, qz] = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(qx - px, qz - pz));
  }
  const length = cum[cum.length - 1];
  const n = Math.round(length / STEP);
  const pts = new Float32Array(n * 2);
  for (let i = 0, j = 0; i < n; i++) {
    const s = (i * length) / n;
    while (cum[j + 1] < s) j++;
    const u = (s - cum[j]) / (cum[j + 1] - cum[j]);
    const [px, pz] = dense[j];
    const [qx, qz] = dense[(j + 1) % dense.length];
    pts[i * 2] = px + (qx - px) * u;
    pts[i * 2 + 1] = pz + (qz - pz) * u;
  }
  return { pts, length };
}

export function makeCars(): Car[] {
  let seed = 11;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let k = 0;
  return LOOPS.flatMap(([x0, x1, z0, z1, count]) => {
    const path = loop(x0, x1, z0, z1);
    const start = rand() * path.length;
    const speed = 2.3 + rand() * 0.9; // one speed per loop, so cars on it keep their spacing
    return Array.from({ length: count }, (_, i) => ({
      path,
      offset: (start + (i * path.length) / count) % path.length,
      speed,
      color: PAINTS[k % PAINTS.length],
      type: LINEUP[k++] ?? "model",
    }));
  });
}

/** Point `s` units along a path (wraps). */
export function pointAt({ pts, length }: Path, s: number, out: { x: number; z: number }) {
  const n = pts.length / 2;
  const f = ((((s % length) + length) % length) / length) * n;
  const i = Math.floor(f) % n;
  const j = (i + 1) % n;
  const u = f - Math.floor(f);
  out.x = pts[i * 2] + (pts[j * 2] - pts[i * 2]) * u;
  out.z = pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * u;
  return out;
}

const front = { x: 0, z: 0 };
const back = { x: 0, z: 0 };

/** Where a car `s` along its loop stands: wheels on the path, tilted to the ground. */
export function carPose(car: Car, s: number, out: Pose): Pose {
  const { wheelbase, width } = MODELS[car.type];
  const half = wheelbase / 2;
  pointAt(car.path, s + half, front);
  pointAt(car.path, s - half, back);
  const dx = front.x - back.x;
  const dz = front.z - back.z;
  const span = Math.hypot(dx, dz);
  const hf = heightAt(front.x, front.z);
  const hb = heightAt(back.x, back.z);
  out.x = (front.x + back.x) / 2;
  out.z = (front.z + back.z) / 2;
  out.y = (hf + hb) / 2;
  out.yaw = Math.atan2(dx, dz);
  out.pitch = -Math.atan2(hf - hb, span);
  // Left is (cos yaw, -sin yaw); a positive roll lifts the left side.
  const w = width / 2;
  const lx = (dz / span) * w;
  const lz = (-dx / span) * w;
  out.roll = Math.atan2(heightAt(out.x + lx, out.z + lz) - heightAt(out.x - lx, out.z - lz), width);
  return out;
}

const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };

/** How far apart two cars on a loop keep their centres: half of each plus a gap. */
export const spacing = (back: Car, front: Car) => (MODELS[back.type].length + MODELS[front.type].length) / 2 + 1.4;

/**
 * Moves every car on, unless Cuso or the car in front is just ahead. `rolled`
 * adds up how far each car really went (no wrap), for its wheels.
 */
export function driveCars(cars: Car[], driven: Float32Array, dt: number, cuso: { x: number; z: number }, rolled?: Float64Array) {
  const step = Math.min(dt, 0.1);
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    let blocked = false;
    for (let j = 0; j < cars.length && !blocked; j++) {
      if (j === i || cars[j].path !== car.path) continue;
      const gap = (((driven[j] - driven[i]) % car.path.length) + car.path.length) % car.path.length;
      blocked = gap < spacing(car, cars[j]);
    }
    if (!blocked) {
      carPose(car, driven[i], pose);
      const fx = Math.sin(pose.yaw);
      const fz = Math.cos(pose.yaw);
      const rx = cuso.x - pose.x;
      const rz = cuso.z - pose.z;
      const ahead = rx * fx + rz * fz;
      blocked = ahead > 0 && ahead < MODELS[car.type].length / 2 + 2.4 && Math.abs(rx * fz - rz * fx) < 1.2;
    }
    if (blocked) continue;
    driven[i] = (driven[i] + step * car.speed) % car.path.length; // wrap: keeps float32 precise
    if (rolled) rolled[i] += step * car.speed;
  }
}

/** How far a wheel of `radius` (city units) has turned after rolling `distance`, in radians. */
export const wheelAngle = (distance: number, radius: number) => distance / radius;

// ---------------------------------------------------------------------------
// Rendering: one instanced mesh per (model, material), materials shared. The
// wheel (tyre and rim) is its own mesh, four instances per car, rolled by distance.

const PARTS = ["paint", "glass", "trim", "light_front", "light_rear", "tyre", "rim"] as const;
type Part = (typeof PARTS)[number];
const isWheel = (part: Part) => part === "tyre" || part === "rim";

function useMaterials(): Record<Part, MeshStandardMaterial> {
  return useMemo(() => {
    const side = DoubleSide;
    return {
      paint: new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04, side }),
      // Tinted glass that mirrors the sky.
      glass: new MeshPhysicalMaterial({ color: "#35424f", roughness: 0.05, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0, side }),
      trim: new MeshStandardMaterial({ color: "#121315", roughness: 0.7, side }),
      rim: new MeshStandardMaterial({ color: "#6c7177", roughness: 0.45, metalness: 0.35, side }),
      tyre: new MeshStandardMaterial({ color: "#0d0d0e", roughness: 0.9, side }),
      light_front: new MeshStandardMaterial({ color: "#16181c", emissive: "#f4f8ff", roughness: 0.15, side }),
      light_rear: new MeshStandardMaterial({ color: "#6e0b10", emissive: "#ff2a24", roughness: 0.3, side }),
    };
  }, []);
}

/** A wheel spot on the car: from the car's pose to the wheel's axle, and its radius in city units. */
type Spot = { at: Matrix4; radius: number; flip: boolean };
type Piece = { key: string; type: CarType; part: Part; geometry: BufferGeometry; local: Matrix4; spots: Spot[] };

/** Every (model, material) piece, with the matrix from a car's pose to the piece (scale and the GLB's quantization). */
function usePieces(): Piece[] {
  const gltfs = useGLTF(TYPES.map((type) => MODELS[type].url));
  return useMemo(
    () =>
      gltfs.flatMap(({ scene }, t) => {
        const type = TYPES[t];
        const scale = MODELS[type].scale;
        scene.updateMatrixWorld(true);
        // [x, y, z, radius] in metres per wheel (scripts/convert-cars.mjs); the GLB's wheel is the first.
        let wheels: number[][] = [];
        scene.traverse((o) => void (o.userData.wheels && (wheels = o.userData.wheels)));
        const spots = wheels.map(([x, y, z, r]) => ({
          // The right side is the same wheel turned round, so its rim faces out.
          at: new Matrix4()
            .makeScale(scale, scale, scale)
            .multiply(new Matrix4().makeTranslation(x, y, z))
            .multiply(new Matrix4().makeRotationY(x < 0 ? Math.PI : 0))
            .multiply(new Matrix4().makeScale(r / wheels[0][3], r / wheels[0][3], r / wheels[0][3])),
          radius: r * scale,
          flip: x < 0,
        }));
        const pieces: Piece[] = [];
        scene.traverse((o) => {
          const mesh = o as Mesh;
          const part = (mesh.material as MeshStandardMaterial | undefined)?.name as Part;
          if (!mesh.isMesh || !PARTS.includes(part)) return;
          const local = isWheel(part) ? mesh.matrixWorld.clone() : new Matrix4().makeScale(scale, scale, scale).multiply(mesh.matrixWorld);
          pieces.push({ key: `${type}-${part}`, type, part, geometry: mesh.geometry, local, spots: isWheel(part) ? spots : [] });
        });
        return pieces;
      }),
    [gltfs],
  );
}

/** A soft dark blob, drawn under each car where it meets the road. */
function useContactShadow() {
  return useMemo(() => {
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
  }, []);
}

const o = new Object3D();
o.rotation.order = "YXZ";
const m4 = new Matrix4();
const spin = new Matrix4();
const blob = new Matrix4();
const c = new Color();

/** A few Teslas circling blocks, following the hills. They stop for Cuso. */
export function Cars() {
  const cars = useMemo(() => makeCars(), []);
  const driven = useMemo(() => Float32Array.from(cars, (car) => car.offset), [cars]);
  const rolled = useMemo(() => new Float64Array(cars.length), [cars]);
  /** Each car's instance slot among the cars of its model. */
  const slot = useMemo(() => cars.map((car, i) => cars.slice(0, i).filter((other) => other.type === car.type).length), [cars]);
  const count = (type: CarType) => cars.filter((car) => car.type === type).length;
  const material = useMaterials();
  const pieces = usePieces();
  const shadow = useContactShadow();
  useNightGlow(material.light_front, 0.9, 0.03);
  useNightGlow(material.light_rear, 1.8, 0.25);
  const meshes = useRef<(InstancedMesh | null)[]>([]);
  const shadows = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    pieces.forEach((piece, k) => {
      const mesh = meshes.current[k];
      if (piece.part !== "paint" || !mesh) return;
      cars.forEach((car, i) => car.type === piece.type && mesh.setColorAt(slot[i], c.set(car.color)));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [cars, pieces, slot]);

  useFrame((_, dt) => {
    // At night the sky no longer lights the paint and glass.
    material.paint.envMapIntensity = material.glass.envMapIntensity = 1 - 0.8 * rig.night;
    driveCars(cars, driven, dt, rig.cuso, rolled);
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      carPose(car, driven[i], pose);
      o.position.set(pose.x, pose.y, pose.z);
      o.rotation.set(pose.pitch, pose.yaw, pose.roll);
      o.updateMatrix();
      pieces.forEach((piece, k) => {
        const mesh = meshes.current[k];
        if (piece.type !== car.type || !mesh) return;
        if (!piece.spots.length) return mesh.setMatrixAt(slot[i], m4.multiplyMatrices(o.matrix, piece.local));
        piece.spots.forEach((spot, w) => {
          // Turned round on the right, so it spins the other way to roll forward.
          spin.makeRotationX(wheelAngle(rolled[i], spot.radius) * (spot.flip ? -1 : 1));
          mesh.setMatrixAt(slot[i] * 4 + w, m4.multiplyMatrices(o.matrix, spot.at).multiply(spin).multiply(piece.local));
        });
      });
      const { length, width } = MODELS[car.type];
      shadows.current?.setMatrixAt(i, blob.multiplyMatrices(o.matrix, m4.makeScale(width * 1.1, 1, length * 1.08)));
    }
    for (const mesh of [...meshes.current, shadows.current]) if (mesh) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      {pieces.map((piece, k) => (
        <instancedMesh
          key={piece.key}
          ref={(mesh) => {
            meshes.current[k] = mesh;
          }}
          args={[piece.geometry, material[piece.part], count(piece.type) * Math.max(1, piece.spots.length)]}
          castShadow={piece.part === "paint" || piece.part === "glass"}
          receiveShadow={piece.part === "paint"}
          frustumCulled={false}
        />
      ))}
      <instancedMesh ref={shadows} args={[shadow.geometry, shadow.material, cars.length]} frustumCulled={false} renderOrder={-1} />
    </>
  );
}

// Start loading with the rest of the scene (not in unit tests, which only drive the cars).
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") useGLTF.preload(TYPES.map((type) => MODELS[type].url));
