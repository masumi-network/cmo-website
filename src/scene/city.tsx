"use client";

// The miniature San Francisco: land with streets, water, hills, Victorian row
// houses, downtown towers, trees, lamps and fog. Layout comes from layout.ts;
// named places live in landmarks.tsx.

import { Cloud, Clouds, useTexture } from "@react-three/drei";
import { useMemo } from "react";
import {
  ExtrudeGeometry,
  MirroredRepeatWrapping,
  RepeatWrapping,
  SRGBColorSpace,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  Float32BufferAttribute,
  Vector2,
  type Texture,
} from "three";
import { Bay, Hills, Water } from "./bay";
import { chapters } from "@/content/day";
import { useCity } from "@/lib/store";
import { heightAt, headlandHeight } from "@/lib/terrain";
import { activeIndex } from "@/lib/time";
import { LAND, streetDrop } from "./grid";
import { kerbGeometry, terrainGeometry } from "./ground";
import { CITY } from "./layout";
import { groundMaterial, worldMaterial } from "./materials";
import { Grass } from "./grass";
import { Houses } from "./houses";
import { groundMask, lampLight } from "./textures";
import { StreetFurniture } from "./street";
import { Towers } from "./towers";
import { Trees } from "./trees";
import { Cars } from "./traffic";


const TEXTURES = {
  siding: "/textures/siding.jpg",
  shingles: "/textures/shingles.jpg",
  asphalt: "/textures/asphalt.jpg",
  concrete: "/textures/concrete.jpg",
  grass: "/textures/grass.jpg",
  stone: "/textures/stone.jpg",
  hills: "/textures/hills.jpg",
};
export type Textures = Record<keyof typeof TEXTURES, Texture>;

export function City({ lite }: { lite: boolean }) {
  const city = CITY;
  const tex = useTexture(TEXTURES, (loaded) => {
    for (const [name, t] of Object.entries(loaded as Textures)) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      // Organic textures mirror (no visible seams); facades repeat exactly.
      t.wrapS = t.wrapT = ["glass", "stone"].includes(name) ? RepeatWrapping : MirroredRepeatWrapping;
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
      <Grass lite={lite} grass={tex.grass} dry={tex.hills} />
      <StreetFurniture lamps={city.lamps} hydrants={city.hydrants} signs={city.signs} />
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
    // Raise the top of the wall to the ground behind it (Telegraph Hill meets the bay as a cliff),
    // never above a street that runs to it (streets lie a kerb below the sidewalks).
    const pos = g.attributes.position;
    const top = (x: number, z: number) => heightAt(x, z) - Math.max(...[-0.6, 0, 0.6].flatMap((dx) => [-0.6, 0, 0.6].map((dz) => streetDrop(x + dx, z + dz))));
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 2) pos.setY(i, pos.getY(i) + top(pos.getX(i), pos.getZ(i)));
    g.computeVertexNormals();
    return g;
  }, []);
  // Group 0 is the flat top (hidden: the terrain replaces it), group 1 the sides.
  // Shore: a concrete sea wall.
  const cliffMaterials = useMemo(() => [new MeshBasicMaterial({ visible: false }), worldMaterial(tex.concrete, 3)], [tex]);

  const terrain = useMemo(() => terrainGeometry(), []);
  const kerbs = useMemo(() => kerbGeometry(), []);
  // Concrete kerbs: the shade (top edge, face, gutter) is in the vertex colours.
  const kerbMaterial = useMemo(() => new MeshStandardMaterial({ map: tex.concrete, vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), [tex]);
  const ground = useMemo(() => groundMaterial(groundMask(), lampLight(CITY.lamps), tex.asphalt, tex.concrete, tex.grass, tex.hills), [tex]);

  return (
    <>
      <mesh geometry={cliffs} material={cliffMaterials} position={[0, -4.6, 0]} receiveShadow />
      <mesh geometry={terrain} material={ground} receiveShadow castShadow />
      <mesh geometry={kerbs} material={kerbMaterial} receiveShadow />
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

