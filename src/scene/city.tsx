"use client";

// The miniature San Francisco: land with streets, water, hills, Victorian row
// houses, downtown towers, trees, lamps and fog. Layout comes from layout.ts;
// named places live in landmarks.tsx.

import { Cloud, Clouds, MeshReflectorMaterial } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  IcosahedronGeometry,
  MeshLambertMaterial,
  MeshStandardMaterial,
  Object3D,
  Shape,
  SphereGeometry,
  Vector2,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
} from "three";
import { facadeMaterial } from "./facade";
import { LAND, generateCity, type House, type Tower } from "./layout";
import { useNightGlow } from "./shared";
import { groundTexture } from "./textures";

const o = new Object3D();
const c = new Color();

/** One instanced mesh, filled once from a list. `place` sets o and returns a color. */
function Instances<T>({
  items,
  geometry,
  material,
  place,
  shadows = true,
}: {
  items: T[];
  geometry: BufferGeometry;
  material: Material;
  place: (item: T, o: Object3D, i: number) => string | void;
  shadows?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      const color = place(item, o, i);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (color) mesh.setColorAt(i, c.set(color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, place]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={shadows} receiveShadow />;
}

const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** A roof prism; the gable faces the street. */
const gable = new ExtrudeGeometry(new Shape([new Vector2(-0.5, 0), new Vector2(0.5, 0), new Vector2(0, 1)]), {
  depth: 1,
  bevelEnabled: false,
}).translate(0, 0, -0.5);

export function City({ lite }: { lite: boolean }) {
  const city = useMemo(() => generateCity(), []);
  return (
    <>
      <Land />
      <Water lite={lite} />
      <Hills />
      <Houses houses={city.houses} />
      <Towers towers={city.towers} />
      <Trees trees={city.trees} />
      <Lamps lamps={city.lamps} />
      <Fog />
    </>
  );
}

function Land() {
  const geometry = useMemo(() => {
    const shape = new Shape(LAND.map(([x, z]) => new Vector2(x, -z)));
    const g = new ExtrudeGeometry(shape, { depth: 4, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  // Group 0 is the top (streets map), group 1 the cliff sides.
  const materials = useMemo(
    () => [new MeshStandardMaterial({ map: groundTexture(), roughness: 0.95 }), new MeshStandardMaterial({ color: "#a89a82", roughness: 1 })],
    [],
  );
  return <mesh geometry={geometry} material={materials} position={[0, -4.6, 0]} receiveShadow />;
}

function Water({ lite }: { lite: boolean }) {
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -0.45, 0]}>
      <planeGeometry args={[1400, 1400]} />
      {lite ? (
        <meshStandardMaterial color="#58798c" roughness={0.35} metalness={0.2} />
      ) : (
        <MeshReflectorMaterial resolution={512} mirror={0.6} mixStrength={1.6} blur={[400, 120]} mixBlur={1} roughness={0.75} metalness={0.35} color="#58798c" depthScale={0} />
      )}
    </mesh>
  );
}

const HILLS: [number, number, number, number, string][] = [
  // x, z, radius, height, color
  [2, -26, 7.5, 4.6, "#a3a07a"],
  [-34, 30, 11, 9, "#98a073"],
  [-86, -185, 46, 24, "#7f8a62"],
  [-36, -196, 40, 18, "#86906a"],
  [-130, -170, 36, 16, "#7a8560"],
  [142, 14, 9, 4.5, "#8f8a68"],
];

function Hills() {
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

const ROOFS = ["#5d5a5c", "#6e5a4f", "#4f5a62", "#7a5c4a"];

const houseBody = (h: House, o: Object3D) => {
  o.position.set(h.x, 0, h.z);
  o.scale.set(h.w - 0.06, h.h, h.d);
  return h.color;
};
const houseBay = (h: House, o: Object3D) => {
  o.position.set(h.x + h.w * 0.14, 1.1, h.z + h.facing * (h.d / 2 + 0.28));
  o.scale.set(h.w * 0.48, h.h - 1.7, 0.56);
  return h.color;
};
const houseCornice = (h: House, o: Object3D) => {
  o.position.set(h.x, h.h - 0.32, h.z + h.facing * 0.1);
  o.scale.set(h.w + 0.04, 0.32, h.d + 0.25);
  return h.trim;
};
const houseRoof = (h: House, o: Object3D, i: number) => {
  o.position.set(h.x, h.h, h.z);
  o.scale.set(h.w, h.w * 0.42, h.d);
  return ROOFS[i % ROOFS.length];
};
const houseDoor = (h: House, o: Object3D) => {
  o.position.set(h.x - h.w * 0.28, 0, h.z + h.facing * (h.d / 2 + 0.02));
  o.scale.set(0.8, 1.9, 0.06);
  return "#3a3330";
};

/** Victorian row houses: body, bay window, cornice, gable roof, door. */
function Houses({ houses }: { houses: House[] }) {
  const walls = useMemo(() => facadeMaterial({ floor: 2.2, window: 1.15, lit: 0.45 }), []);
  const plain = useMemo(() => new MeshStandardMaterial({ roughness: 0.8 }), []);
  const bays = useMemo(() => houses.filter((h) => h.bay), [houses]);
  const gables = useMemo(() => houses.filter((h) => h.roof === "gable"), [houses]);
  return (
    <>
      <Instances items={houses} geometry={box} material={walls} place={houseBody} />
      <Instances items={bays} geometry={box} material={walls} place={houseBay} />
      <Instances items={houses} geometry={box} material={plain} place={houseCornice} />
      <Instances items={gables} geometry={gable} material={plain} place={houseRoof} />
      <Instances items={houses} geometry={box} material={plain} place={houseDoor} shadows={false} />
    </>
  );
}

type TierItem = { tower: Tower; i: number };

const towerTier = ({ tower, i }: TierItem, o: Object3D) => {
  const t = tower.tiers[i];
  o.position.set(tower.x, t.y, tower.z);
  o.scale.set(t.w, t.h, t.d);
  return tower.color;
};
const towerCap = (tower: Tower, o: Object3D) => {
  const top = tower.tiers[tower.tiers.length - 1];
  o.position.set(tower.x, top.y + top.h, tower.z);
  o.scale.set(top.w * 0.45, 1.1, top.d * 0.45);
};
const tiersOf = (towers: Tower[], glass: boolean): TierItem[] =>
  towers.filter((t) => t.glass === glass).flatMap((tower) => tower.tiers.map((_, i) => ({ tower, i })));

/** Downtown: tiered towers in glass or stone, with a roof box on top. */
function Towers({ towers }: { towers: Tower[] }) {
  const glass = useMemo(() => facadeMaterial({ floor: 1.45, window: 1.0, glassy: true, lit: 0.55, roughness: 0.6 }), []);
  const stone = useMemo(() => facadeMaterial({ floor: 1.8, window: 1.2, lit: 0.5 }), []);
  const plain = useMemo(() => new MeshStandardMaterial({ color: "#a6a4a0", roughness: 0.8 }), []);
  const glassTiers = useMemo(() => tiersOf(towers, true), [towers]);
  const stoneTiers = useMemo(() => tiersOf(towers, false), [towers]);
  return (
    <>
      <Instances items={glassTiers} geometry={box} material={glass} place={towerTier} />
      <Instances items={stoneTiers} geometry={box} material={stone} place={towerTier} />
      <Instances items={towers} geometry={box} material={plain} place={towerCap} />
    </>
  );
}

type Tree = { x: number; z: number; s: number };
const LEAVES = ["#7f9a68", "#6c8a58", "#8aa673", "#93a96f"];
const trunk = (t: Tree, o: Object3D) => {
  o.position.set(t.x, 0, t.z);
  o.scale.set(t.s, t.s * 1.4, t.s);
};
const canopy = (t: Tree, o: Object3D, i: number) => {
  o.position.set(t.x, t.s * 1.9, t.z);
  o.scale.set(t.s * 1.05, t.s * 1.2, t.s * 1.05);
  o.rotation.y = i;
  return LEAVES[i % LEAVES.length];
};

function Trees({ trees }: { trees: Tree[] }) {
  const trunkGeo = useMemo(() => new CylinderGeometry(0.08, 0.12, 1, 6).translate(0, 0.5, 0), []);
  const leafGeo = useMemo(() => new IcosahedronGeometry(1, 1), []);
  const bark = useMemo(() => new MeshStandardMaterial({ color: "#6b5440", roughness: 1 }), []);
  const leaves = useMemo(() => new MeshStandardMaterial({ roughness: 0.9, flatShading: true }), []);
  return (
    <>
      <Instances items={trees} geometry={trunkGeo} material={bark} place={trunk} />
      <Instances items={trees} geometry={leafGeo} material={leaves} place={canopy} />
    </>
  );
}

type Lamp = { x: number; z: number };
const lampPole = (l: Lamp, o: Object3D) => void o.position.set(l.x, 0, l.z);
const lampBulb = (l: Lamp, o: Object3D) => void o.position.set(l.x, 3.05, l.z);

function Lamps({ lamps }: { lamps: Lamp[] }) {
  const poleGeo = useMemo(() => new BoxGeometry(0.08, 3, 0.08).translate(0, 1.5, 0), []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.15, 10, 8), []);
  const metal = useMemo(() => new MeshStandardMaterial({ color: "#2e2e33", roughness: 0.6 }), []);
  const bulb = useMemo(() => new MeshStandardMaterial({ color: "#3a3630", emissive: new Color("#ffd58f"), emissiveIntensity: 0 }), []);
  useNightGlow(bulb, 3.5);
  return (
    <>
      <Instances items={lamps} geometry={poleGeo} material={metal} place={lampPole} />
      <Instances items={lamps} geometry={bulbGeo} material={bulb} place={lampBulb} shadows={false} />
    </>
  );
}

/** Karl the fog rolling in from the ocean, and a few high clouds. */
function Fog() {
  return (
    <Clouds texture="/textures/cloud.png" material={MeshLambertMaterial} limit={260}>
      <Cloud seed={1} segments={40} bounds={[22, 3, 30]} volume={18} position={[-92, 3, -30]} opacity={0.75} speed={0.05} growth={6} />
      <Cloud seed={2} segments={30} bounds={[18, 4, 24]} volume={16} position={[-82, 5, -100]} opacity={0.7} speed={0.05} growth={6} />
      <Cloud seed={4} segments={20} bounds={[40, 4, 40]} volume={20} position={[40, 46, -80]} opacity={0.5} speed={0.03} growth={6} />
    </Clouds>
  );
}
