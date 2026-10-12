"use client";

// The miniature San Francisco: land with streets, water, hills, Victorian row
// houses, downtown towers, trees, lamps and fog. Layout comes from layout.ts;
// named places live in landmarks.tsx.

import { Cloud, Clouds, useTexture } from "@react-three/drei";
import { useMemo } from "react";
import {
  BoxGeometry,
  Color,
  ExtrudeGeometry,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  Float32BufferAttribute,
  Vector2,
  type Texture,
} from "three";
import { Bay, Hills, Water } from "./bay";
import { chapters } from "@/content/day";
import { useCity } from "@/lib/store";
import { heightAt, headlandHeight } from "@/lib/terrain";
import { activeIndex } from "@/lib/time";
import { LAND, LAND_BOUNDS, insideLand } from "./grid";
import { CITY, type House, type Tower } from "./layout";
import { useNightGlow } from "./shared";
import { FOOTING, groundMaterial, houseMaterial, roofMaterial, towerMaterial, worldMaterial } from "./materials";
import { Instances } from "./parts";
import { groundMask } from "./textures";
import { Trees } from "./trees";
import { Cars } from "./traffic";

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
      <Hills map={tex.hills} />
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
    // One point per unit along the shore, so the wall's top can follow the hills.
    const shore = LAND.flatMap(([x, z], i) => {
      const [nx, nz] = LAND[(i + 1) % LAND.length];
      const n = Math.ceil(Math.hypot(nx - x, nz - z));
      return Array.from({ length: n }, (_, k) => new Vector2(x + ((nx - x) * k) / n, -(z + ((nz - z) * k) / n)));
    });
    const g = new ExtrudeGeometry(new Shape(shore), { depth: 4, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.6, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    // Raise the top of the wall to the ground behind it (Telegraph Hill meets the bay as a cliff).
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 2) pos.setY(i, pos.getY(i) + heightAt(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, []);
  // Group 0 is the flat top (hidden: the terrain replaces it), group 1 the sides.
  // Shore: a concrete sea wall.
  const cliffMaterials = useMemo(() => [new MeshBasicMaterial({ visible: false }), worldMaterial(tex.concrete, 3)], [tex]);

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
  const ground = useMemo(() => groundMaterial(groundMask(), tex.asphalt, tex.concrete, tex.grass, tex.hills), [tex]);

  return (
    <>
      <mesh geometry={cliffs} material={cliffMaterials} position={[0, -4.6, 0]} receiveShadow />
      <mesh geometry={terrain} material={ground} receiveShadow castShadow />
    </>
  );
}

// Marin Headlands across the Golden Gate: ridged hills of golden grass and
// scrub, a cove where the bridge lands, steeper slopes darker.
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
  // From the bird's-eye map, fog banks read as puffs: leave them to the close shots.
  const explore = useCity((s) => s.mode === "explore");
  if (explore) return null;
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

