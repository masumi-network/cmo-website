"use client";

// The miniature San Francisco: land with streets, water, hills, Victorian row
// houses, downtown towers, trees, lamps and fog. Layout comes from layout.ts;
// named places live in landmarks.tsx.

import { Cloud, Clouds, MeshReflectorMaterial, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  InstancedBufferAttribute,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  IcosahedronGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  Float32BufferAttribute,
  Vector2,
  type BufferGeometry,
  type InstancedMesh,
  type Material,
  type Texture,
} from "three";
import { facadeMaterial } from "./facade";
import { chapters } from "@/content/day";
import { useCity } from "@/lib/store";
import { heightAt } from "@/lib/terrain";
import { activeIndex } from "@/lib/time";
import { WALK_X, WALK_Z } from "./grid";
import { CITY, LAND, LAND_BOUNDS, X_STREETS, Z_STREETS, insideLand, type House, type Tower } from "./layout";
import { rig, useNightGlow } from "./shared";
import { FOOTING, groundMaterial, houseMaterial, roofMaterial, towerMaterial } from "./materials";
import { groundMask } from "./textures";

const o = new Object3D();
const c = new Color();

/** One instanced mesh, filled once from a list. `place` sets o and returns a color. */
function Instances<T>({
  items,
  geometry,
  material,
  place,
  attributes,
  shadows = true,
}: {
  items: T[];
  geometry: BufferGeometry;
  material: Material;
  place: (item: T, o: Object3D, i: number) => string | void;
  /** Per-instance shader attributes, one float per item. */
  attributes?: Record<string, (item: T, i: number) => number>;
  shadows?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => {
    if (!attributes) return geometry;
    const g = geometry.clone();
    for (const [name, value] of Object.entries(attributes)) g.setAttribute(name, new InstancedBufferAttribute(Float32Array.from(items, value), 1));
    return g;
  }, [geometry, attributes, items]);
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
  return <instancedMesh ref={ref} args={[geo, material, items.length]} castShadow={shadows} receiveShadow />;
}

const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** A roof prism; the gable faces the street. */
const gable = new ExtrudeGeometry(new Shape([new Vector2(-0.5, 0), new Vector2(0.5, 0), new Vector2(0, 1)]), {
  depth: 1,
  bevelEnabled: false,
}).translate(0, 0, -0.5);

const TEXTURES = {
  atlas: "/textures/houses-atlas.jpg",
  siding: "/textures/siding.jpg",
  shingles: "/textures/shingles.jpg",
  asphalt: "/textures/asphalt.jpg",
  concrete: "/textures/concrete.jpg",
  grass: "/textures/grass.jpg",
  glass: "/textures/glass.jpg",
  stone: "/textures/stone.jpg",
  hills: "/textures/hills.jpg",
};
type Textures = Record<keyof typeof TEXTURES, Texture>;

export function City({ lite }: { lite: boolean }) {
  const city = CITY;
  const tex = useTexture(TEXTURES, (loaded) => {
    for (const [name, t] of Object.entries(loaded as Textures)) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      // Organic textures mirror (no visible seams); facades repeat exactly.
      t.wrapS = t.wrapT = ["glass", "stone", "atlas"].includes(name) ? RepeatWrapping : MirroredRepeatWrapping;
    }
  }) as Textures;
  return (
    <>
      <Land tex={tex} />
      <Water lite={lite} />
      <Hills />
      <Headlands map={tex.hills} />
      <Houses houses={city.houses} tex={tex} />
      <Towers towers={city.towers} tex={tex} />
      <Trees trees={city.trees} />
      <Lamps lamps={city.lamps} />
      <Cars />
      <Bay />
      <Fog />
    </>
  );
}

/** Cliffs around the shore, and the hilly ground on top with the street map. */
function Land({ tex }: { tex: Textures }) {
  const cliffs = useMemo(() => {
    const shape = new Shape(LAND.map(([x, z]) => new Vector2(x, -z)));
    const g = new ExtrudeGeometry(shape, { depth: 4, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  // Group 0 is the flat top (hidden: the terrain replaces it), group 1 the sides.
  const cliffMaterials = useMemo(() => [new MeshBasicMaterial({ visible: false }), new MeshStandardMaterial({ color: "#a89a82", roughness: 1 })], []);

  const terrain = useMemo(() => {
    const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
    const g = new PlaneGeometry(maxX - minX, maxZ - minZ, (maxX - minX) * 2, (maxZ - minZ) * 2);
    g.rotateX(-Math.PI / 2);
    g.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, insideLand(x, z) ? heightAt(x, z) : -1.2);
      uv.setXY(i, x, -z); // same mapping as groundMask() expects
    }
    g.computeVertexNormals();
    return g;
  }, []);
  const ground = useMemo(() => groundMaterial(groundMask(), tex.asphalt, tex.concrete, tex.grass), [tex]);

  return (
    <>
      <mesh geometry={cliffs} material={cliffMaterials} position={[0, -4.6, 0]} receiveShadow />
      <mesh geometry={terrain} material={ground} receiveShadow castShadow />
    </>
  );
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

// Marin Headlands across the Golden Gate: ridged hills of golden grass and
// scrub, a cove where the bridge lands, steeper slopes darker.
function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridges(x: number, z: number) {
  let h = 0;
  let amp = 1;
  let f = 1 / 55;
  for (let o = 0; o < 4; o++) {
    const n = valueNoise(x * f, z * f);
    h += amp * (o === 0 ? n : 1 - Math.abs(n * 2 - 1)); // rolling base, soft ridges on top
    amp *= 0.45;
    f *= 2.1;
  }
  return h / 1.7;
}
/** North shore of the strait; it bends north where the bridge lands (x -80). */
const marinShore = (x: number) => -128 - 25 * Math.exp(-(((x + 80) / 24) ** 2));

export function headlandHeight(x: number, z: number) {
  const shore = marinShore(x);
  if (z > shore) return -1.5;
  const t = Math.min(1, (shore - z) / 34);
  const rise = t * t * (3 - 2 * t);
  return -1.5 + rise * (5 + 20 * ridges(x, z));
}

function Headlands({ map }: { map: Texture }) {
  const geometry = useMemo(() => {
    const x0 = -210, x1 = 70, z0 = -290, z1 = -118;
    const g = new PlaneGeometry(x1 - x0, z1 - z0, (x1 - x0) / 1.2, (z1 - z0) / 1.2);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, headlandHeight(x, z));
      uv.setXY(i, x / 26, -z / 26);
    }
    g.computeVertexNormals();
    // Steeper and lower slopes a little darker (shade, scrub), crests sunlit gold.
    const n = g.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const steep = 1 - n.getY(i);
      const k = 1 - Math.min(0.45, steep * 0.9);
      colors.set([k, k * 0.98, k * 0.92], i * 3);
    }
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    return g;
  }, []);
  const material = useMemo(() => new MeshStandardMaterial({ map, vertexColors: true, roughness: 1 }), [map]);
  return <mesh geometry={geometry} material={material} receiveShadow castShadow />;
}

/** Atlas tiles: 2-storey fronts are 0, 2, 4; 3-storey are 1, 3, 5. Siding tint per tile. */
const TWO_STOREY = [0, 2, 4];
const THREE_STOREY = [1, 3, 5];
const SIDING = ["#d3e2ee", "#d4e6d6", "#f3e3b2", "#eccfd2", "#d3dccd", "#f1efe9"];
const tileOf = (h: House, i: number) => (h.h > 6 ? THREE_STOREY : TWO_STOREY)[(i * 7 + Math.round(h.x * 3)) % 3];

const houseAttributes = {
  aTile: (h: House, i: number) => tileOf(h, i),
  aFacing: (h: House) => h.facing,
};
const houseBody = (h: House, o: Object3D, i: number) => {
  o.position.set(h.x, h.y - FOOTING, h.z);
  o.scale.set(h.w - 0.06, h.h + FOOTING, h.d);
  return SIDING[tileOf(h, i)];
};
const houseCornice = (h: House, o: Object3D) => {
  o.position.set(h.x, h.y + h.h - 0.18, h.z + h.facing * 0.06);
  o.scale.set(h.w + 0.02, 0.22, h.d + 0.14);
  return h.trim;
};
const houseRoof = (h: House, o: Object3D) => {
  o.position.set(h.x, h.y + h.h, h.z);
  o.scale.set(h.w, h.w * 0.42, h.d);
  return "#8a8580";
};

/** Victorian row houses: a real facade on the street side, lap siding elsewhere, shingled gables. */
function Houses({ houses, tex }: { houses: House[]; tex: Textures }) {
  const walls = useMemo(() => houseMaterial(tex.atlas, tex.siding), [tex]);
  const trim = useMemo(() => new MeshStandardMaterial({ roughness: 0.7 }), []);
  const shingles = useMemo(() => roofMaterial(tex.shingles), [tex]);
  const gables = useMemo(() => houses.filter((h) => h.roof === "gable"), [houses]);
  return (
    <>
      <Instances items={houses} geometry={box} material={walls} place={houseBody} attributes={houseAttributes} />
      <Instances items={houses} geometry={box} material={trim} place={houseCornice} />
      <Instances items={gables} geometry={gable} material={shingles} place={houseRoof} />
    </>
  );
}

type TierItem = { tower: Tower; i: number };

const towerTier = ({ tower, i }: TierItem, o: Object3D) => {
  const t = tower.tiers[i];
  const footing = i === 0 ? FOOTING : 0;
  o.position.set(tower.x, tower.y + t.y - footing, tower.z);
  o.scale.set(t.w, t.h + footing, t.d);
  return tower.color;
};
const towerCap = (tower: Tower, o: Object3D) => {
  const top = tower.tiers[tower.tiers.length - 1];
  o.position.set(tower.x, tower.y + top.y + top.h, tower.z);
  o.scale.set(top.w * 0.45, 1.1, top.d * 0.45);
};
const tiersOf = (towers: Tower[], glass: boolean): TierItem[] =>
  towers.filter((t) => t.glass === glass).flatMap((tower) => tower.tiers.map((_, i) => ({ tower, i })));

/** Downtown: tiered towers in glass or limestone, with a roof box on top. */
function Towers({ towers, tex }: { towers: Tower[]; tex: Textures }) {
  const glass = useMemo(() => towerMaterial(tex.glass, { w: 4, h: 5.8 }, true), [tex]);
  const stone = useMemo(() => towerMaterial(tex.stone, { w: 4.8, h: 7.2 }, false), [tex]);
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

type Tree = { x: number; y: number; z: number; s: number };
const LEAVES = ["#7f9a68", "#6c8a58", "#8aa673", "#93a96f"];
const trunk = (t: Tree, o: Object3D) => {
  o.position.set(t.x, t.y - 0.2, t.z);
  o.scale.set(t.s, t.s * 1.4 + 0.2, t.s);
};
const canopy = (t: Tree, o: Object3D, i: number) => {
  o.position.set(t.x, t.y + t.s * 1.9, t.z);
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

type Lamp = { x: number; y: number; z: number };
const lampPole = (l: Lamp, o: Object3D) => void o.position.set(l.x, l.y, l.z);
const lampBulb = (l: Lamp, o: Object3D) => void o.position.set(l.x, l.y + 3.05, l.z);

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

/** Fog color by time of day. Unlit, so backlit fog never turns to dark smoke. */
const fogTint = (hour: number) => (hour >= 20 && hour < 29 ? "#3c4260" : hour >= 17 && hour < 20 ? "#f1c6a2" : "#fbf8f2");

/** Karl the fog rolling in from the ocean, and a few high clouds. */
function Fog() {
  const tint = useCity((s) => fogTint(chapters[activeIndex(s.progress, chapters.length)].hour));
  return (
    <Clouds texture="/textures/cloud.png" material={MeshBasicMaterial} limit={260}>
      <Cloud seed={1} segments={40} bounds={[22, 3, 30]} volume={18} position={[-92, 3, -30]} opacity={0.7} speed={0.05} growth={6} color={tint} />
      <Cloud seed={2} segments={30} bounds={[18, 4, 24]} volume={16} position={[-82, 5, -100]} opacity={0.65} speed={0.05} growth={6} color={tint} />
      {/* Karl the fog, low under the Golden Gate deck */}
      <Cloud seed={5} segments={36} bounds={[26, 1.2, 44]} volume={12} position={[-80, 2.2, -104]} opacity={0.6} speed={0.04} growth={5} color={tint} />
      <Cloud seed={4} segments={20} bounds={[40, 4, 40]} volume={20} position={[40, 46, -80]} opacity={0.45} speed={0.03} growth={6} color={tint} />
    </Clouds>
  );
}

// --- Life: cars and the bay ----------------------------------------------

const CAR_COLORS = ["#e2ded6", "#9aa3ad", "#5b6470", "#b85c48", "#2f3440", "#c9b28a", "#7c8a6a", "#f2efe8"];

type Lane = { alongX: boolean; c: number; dir: 1 | -1; from: number; to: number };
type Car = { lane: Lane; offset: number; speed: number; color: string };

function landSpan(alongX: boolean, c: number): [number, number] | null {
  let from = Infinity;
  let to = -Infinity;
  for (let t = -90; t <= 45; t += 0.5) {
    const inside = alongX ? insideLand(t, c) : insideLand(c, t);
    if (inside) {
      from = Math.min(from, t);
      to = Math.max(to, t);
    }
  }
  return to - from > 8 ? [from + 1, to - 1] : null;
}

function makeCars(): Car[] {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lanes: Lane[] = [];
  for (const z of Z_STREETS.filter((v) => !WALK_Z.includes(v))) {
    for (const dir of [1, -1] as const) {
      const span = landSpan(true, z + dir * 0.75);
      if (span) lanes.push({ alongX: true, c: z + dir * 0.75, dir, from: span[0], to: span[1] });
    }
  }
  for (const x of X_STREETS.filter((v) => !WALK_X.includes(v))) {
    for (const dir of [1, -1] as const) {
      const span = landSpan(false, x - dir * 0.75);
      if (span) lanes.push({ alongX: false, c: x - dir * 0.75, dir, from: span[0], to: span[1] });
    }
  }
  return lanes.flatMap((lane) =>
    Array.from({ length: Math.max(1, Math.floor((lane.to - lane.from) / 22)) }, () => ({
      lane,
      offset: rand() * (lane.to - lane.from),
      speed: 2.4 + rand() * 1.8,
      color: CAR_COLORS[Math.floor(rand() * CAR_COLORS.length)],
    })),
  );
}

/** Little cars driving the streets, following the hills. They stop for Cuso. */
function Cars() {
  const bodies = useRef<InstancedMesh>(null);
  const cabins = useRef<InstancedMesh>(null);
  const cars = useMemo(() => makeCars(), []);
  const driven = useMemo(() => Float32Array.from(cars, (car) => car.offset), [cars]);
  const bodyGeo = useMemo(() => new BoxGeometry(1.7, 0.7, 4).translate(0, 0.55, 0), []);
  const cabinGeo = useMemo(() => new BoxGeometry(1.5, 0.6, 2.1).translate(0, 1.2, -0.2), []);
  const paint = useMemo(() => new MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 }), []);
  const glass = useMemo(() => new MeshStandardMaterial({ color: "#2a3038", roughness: 0.15, metalness: 0.5 }), []);

  useLayoutEffect(() => {
    cars.forEach((car, i) => bodies.current?.setColorAt(i, c.set(car.color)));
    if (bodies.current?.instanceColor) bodies.current.instanceColor.needsUpdate = true;
  }, [cars]);

  useFrame((_, dt) => {
    const b = bodies.current;
    const k = cabins.current;
    if (!b || !k) return;
    cars.forEach((car, i) => {
      const { lane } = car;
      const length = lane.to - lane.from;
      const s = driven[i] % length;
      const along = lane.dir === 1 ? lane.from + s : lane.to - s;
      const x = lane.alongX ? along : lane.c;
      const z = lane.alongX ? lane.c : along;
      // Wait while Cuso is in the lane just ahead.
      const ahead = ((lane.alongX ? rig.cuso.x - x : rig.cuso.z - z) * lane.dir);
      const side = Math.abs(lane.alongX ? rig.cuso.z - z : rig.cuso.x - x);
      if (!(ahead > 0 && ahead < 5 && side < 2)) driven[i] += Math.min(dt, 0.1) * car.speed;
      o.position.set(x, heightAt(x, z), z);
      o.rotation.set(0, lane.alongX ? (lane.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : lane.dir === 1 ? 0 : Math.PI, 0);
      o.scale.set(1, 1, 1);
      o.updateMatrix();
      b.setMatrixAt(i, o.matrix);
      k.setMatrixAt(i, o.matrix);
    });
    b.instanceMatrix.needsUpdate = true;
    k.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[bodyGeo, paint, cars.length]} castShadow frustumCulled={false} />
      <instancedMesh ref={cabins} args={[cabinGeo, glass, cars.length]} castShadow frustumCulled={false} />
    </>
  );
}

const BOATS = [
  { cx: -20, cz: -62, r: 14, speed: 0.05, phase: 0 },
  { cx: 10, cz: -55, r: 10, speed: 0.07, phase: 2 },
  { cx: -40, cz: -70, r: 18, speed: 0.04, phase: 4 },
  { cx: 50, cz: 0, r: 12, speed: 0.06, phase: 1 },
  { cx: 55, cz: 35, r: 15, speed: 0.05, phase: 3 },
];

/** Alcatraz and a few sailboats drifting on the bay. */
function Bay() {
  const boats = useRef<(Object3D | null)[]>([]);
  const sail = useMemo(() => new ExtrudeGeometry(new Shape([new Vector2(0, 0), new Vector2(1.6, 0), new Vector2(0, 3.2)]), { depth: 0.04, bevelEnabled: false }), []);
  const block = useMemo(() => facadeMaterial({ floor: 1.4, window: 0.9 }), []);
  useFrame(({ clock }) => {
    BOATS.forEach((b, i) => {
      const boat = boats.current[i];
      if (!boat) return;
      const a = b.phase + clock.elapsedTime * b.speed;
      boat.position.set(b.cx + Math.cos(a) * b.r, -0.35, b.cz + Math.sin(a) * b.r);
      boat.rotation.y = -a;
    });
  });
  return (
    <>
      <group position={[-6, -0.5, -66]}>
        <mesh scale={[7, 2.6, 4.5]} castShadow receiveShadow>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color="#9a9078" roughness={1} />
        </mesh>
        <mesh position={[0.5, 2.6, 0]} scale={[5, 1.8, 1.8]} material={block} castShadow>
          <boxGeometry />
        </mesh>
        <mesh position={[-2.6, 3.6, 0.4]} castShadow>
          <cylinderGeometry args={[0.25, 0.32, 3.2, 10]} />
          <meshStandardMaterial color="#efe9dc" roughness={0.8} />
        </mesh>
      </group>
      {BOATS.map((b, i) => (
        <group key={i} ref={(el) => void (boats.current[i] = el)}>
          <mesh position={[0, 0.2, 0]} castShadow>
            <boxGeometry args={[0.9, 0.35, 2.6]} />
            <meshStandardMaterial color="#f4f1ea" roughness={0.6} />
          </mesh>
          <mesh geometry={sail} position={[0, 0.4, -0.6]} rotation-y={Math.PI / 2} castShadow>
            <meshStandardMaterial color="#ffffff" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}
