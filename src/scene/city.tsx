"use client";

// The miniature San Francisco: land, water, hills, generic buildings and trees.
// Named places (pyramid, bridges, the shop...) live in landmarks.tsx.

import { MeshReflectorMaterial } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, ConeGeometry, ExtrudeGeometry, IcosahedronGeometry, MeshStandardMaterial, Object3D, Shape, Vector2, type InstancedMesh } from "three";
import { chapters } from "@/content/day";
import { useNightGlow } from "./shared";
import { windowsTexture } from "./textures";

// Shoreline (x east, z south). Downtown is the north-east corner.
const LAND: [number, number][] = [
  [-66, -28], [-84, -46], [-76, -53], [-52, -38], [-30, -35], [-10, -33], [5, -36], [20, -34], [31, -28],
  [31, 10], [31, 30], [26, 46], [0, 48], [-30, 47], [-63, 46], [-65, 10],
];

function insideLand(x: number, z: number) {
  let inside = false;
  for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) {
    const [xi, zi] = LAND[i];
    const [xj, zj] = LAND[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Places the generator keeps clear: [x, z, radius]. */
const CLEAR: [number, number, number][] = [
  [-14, -10.4, 5.5], // rooftop
  [-20, 11, 5.5], // shop
  [-4, 24.5, 6], // mural wall
  [7, 5, 5.5], // Union Square
  [10, -10, 6.5], // pyramid
  [2, -26, 8.5], // Telegraph Hill
  [29.5, -3, 4.5], // Ferry Building
  [-34, 30, 11.5], // Twin Peaks
  [-12, 31, 5.5], // Dolores Park
];

const blocksView = (x: number, z: number, h: number, r: number) =>
  chapters.some(({ camera: { position: p, target: q } }) => {
    for (let s = 0; s <= 1.0001; s += 0.05) {
      const px = p[0] + (q[0] - p[0]) * s;
      const py = p[1] + (q[1] - p[1]) * s;
      const pz = p[2] + (q[2] - p[2]) * s;
      if (Math.hypot(px - x, pz - z) < r + 1.2 && py < h + 0.8) return true;
    }
    return false;
  });

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const HOUSES = ["#efe4d2", "#e6d2b8", "#d9c3a6", "#f3ebe0", "#cdb89a", "#cbd2d6", "#dcc8c0", "#c9d6cc", "#e9d9c9"];
const TOWERS = ["#d9d6d0", "#c3c6cb", "#adb2b9", "#e4e1dc", "#cfc9bf"];

type Block = { x: number; z: number; w: number; d: number; h: number; color: string; roof: boolean };

function generateBlocks(): Block[] {
  const rand = rng(42);
  const blocks: Block[] = [];
  for (let x = -60; x <= 29; x += 4.4) {
    for (let z = -31; z <= 45; z += 4.4) {
      const jx = x + (rand() - 0.5) * 0.6;
      const w = 2.6 + rand() * 1.1;
      const d = 2.6 + rand() * 1.1;
      if (!insideLand(jx - w / 2, z - d / 2) || !insideLand(jx + w / 2, z + d / 2)) continue;
      if (CLEAR.some(([cx, cz, r]) => Math.hypot(jx - cx, z - cz) < r)) continue;
      if (z > 0.4 && z < 4.2 && jx > 6) continue; // California St cable car
      if (z > 10 && z < 14 && jx > -1 && jx < 22) continue; // Union Square street
      if (rand() < 0.07) continue; // little parks
      const downtown = jx > -3 && jx < 31 && z > -24 && z < 16;
      const h = downtown ? 3 + rand() ** 2 * 15 : 1.6 + rand() * 2.8;
      if (blocksView(jx, z, h, Math.max(w, d) / 2)) continue;
      const palette = downtown ? TOWERS : HOUSES;
      blocks.push({ x: jx, z, w, d, h, color: palette[Math.floor(rand() * palette.length)], roof: !downtown });
    }
  }
  return blocks;
}

function generateTrees() {
  const rand = rng(7);
  const trees: [number, number, number][] = [];
  const scatter = (cx: number, cz: number, rx: number, rz: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * 2 * rx;
      const z = cz + (rand() - 0.5) * 2 * rz;
      if (insideLand(x, z) && !blocksView(x, z, 1.6, 0.8)) trees.push([x, z, 0.6 + rand() * 0.6]);
    }
  };
  scatter(-12, 31, 4.5, 4, 22); // Dolores Park
  scatter(-47, 20, 13, 4, 70); // Golden Gate Park
  scatter(2, -26, 6, 6, 18); // Telegraph Hill
  scatter(-34, 30, 9, 9, 30); // Twin Peaks
  return trees;
}

export function Land() {
  const geometry = useMemo(() => {
    const shape = new Shape(LAND.map(([x, z]) => new Vector2(x, -z)));
    const g = new ExtrudeGeometry(shape, { depth: 4, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  return (
    <mesh geometry={geometry} position={[0, -4, 0]} receiveShadow>
      <meshStandardMaterial color="#c9bba4" roughness={1} />
    </mesh>
  );
}

export function Water({ lite }: { lite: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.45, 0]}>
      <planeGeometry args={[1400, 1400]} />
      {lite ? (
        <meshStandardMaterial color="#58798c" roughness={0.35} metalness={0.2} />
      ) : (
        <MeshReflectorMaterial
          resolution={512}
          mirror={0.6}
          mixStrength={1.6}
          blur={[400, 120]}
          mixBlur={1}
          roughness={0.75}
          metalness={0.35}
          color="#58798c"
          depthScale={0}
        />
      )}
    </mesh>
  );
}

const HILLS: [number, number, number, number, string][] = [
  // x, z, radius, height, color
  [2, -26, 7.5, 4.6, "#a99b78"],
  [-34, 30, 11, 9, "#9e9472"],
  [-86, -185, 46, 24, "#7f8a62"],
  [-36, -196, 40, 18, "#86906a"],
  [-130, -170, 36, 16, "#7a8560"],
  [142, 14, 9, 4.5, "#8f8a68"],
];

export function Hills() {
  return (
    <>
      {HILLS.map(([x, z, r, h, color]) => (
        <mesh key={`${x}${z}`} position={[x, -0.6, z]} scale={[r, h, r]} castShadow receiveShadow>
          <sphereGeometry args={[1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={1} />
        </mesh>
      ))}
    </>
  );
}

export function Buildings() {
  const ref = useRef<InstancedMesh>(null);
  const blocks = useMemo(() => generateBlocks(), []);
  const geometry = useMemo(() => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), []);
  const material = useMemo(
    () => new MeshStandardMaterial({ roughness: 0.85, emissive: new Color("#ffc679"), emissiveMap: windowsTexture(), emissiveIntensity: 0 }),
    [],
  );
  useNightGlow(material, 1.6);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    const c = new Color();
    blocks.forEach((b, i) => {
      o.position.set(b.x, 0, b.z);
      o.scale.set(b.w, b.h, b.d);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [blocks]);

  return (
    <>
      <instancedMesh ref={ref} args={[geometry, material, blocks.length]} castShadow receiveShadow />
      <Roofs blocks={blocks} />
    </>
  );
}

const ROOFS = ["#7b5e4f", "#6c7279", "#8a6a55", "#5f6a66"];

/** Hip roofs on the houses, so the neighbourhoods read as San Francisco. */
function Roofs({ blocks }: { blocks: Block[] }) {
  const ref = useRef<InstancedMesh>(null);
  const houses = useMemo(() => blocks.filter((b) => b.roof), [blocks]);
  const geometry = useMemo(() => new ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    const c = new Color();
    houses.forEach((b, i) => {
      o.position.set(b.x, b.h, b.z);
      o.scale.set(b.w * 1.04, Math.min(b.w, b.d) * 0.42, b.d * 1.04);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(ROOFS[i % ROOFS.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [houses]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, houses.length]} castShadow receiveShadow>
      <meshStandardMaterial roughness={0.9} flatShading />
    </instancedMesh>
  );
}

export function Trees() {
  const ref = useRef<InstancedMesh>(null);
  const trees = useMemo(() => generateTrees(), []);
  const geometry = useMemo(() => new IcosahedronGeometry(1, 1), []);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    trees.forEach(([x, z, s], i) => {
      o.position.set(x, s * 0.9, z);
      o.scale.set(s, s * 1.1, s);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [trees]);
  return (
    <instancedMesh ref={ref} args={[geometry, undefined, trees.length]} castShadow receiveShadow>
      <meshStandardMaterial color="#7f9a68" roughness={0.9} flatShading />
    </instancedMesh>
  );
}
