"use client";

// The miniature San Francisco: land with streets, water, hills, Victorian row
// houses, downtown towers, trees, lamps and fog. Layout comes from layout.ts;
// named places live in landmarks.tsx.

import { useTexture } from "@react-three/drei";
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
import { Coast } from "./seashore";
import { HEADLANDS, heightAt, headlandHeight } from "@/lib/terrain";
import { LAND, streetDrop } from "./grid";
import { kerbGeometry, relief, terrainGeometry, tiles } from "./ground";
import { CITY, FERRY } from "./layout";
import { MISSION } from "./mission";
import { ROOFTOP } from "./rooftop";
import { SHOP } from "./shop";
import { UNION } from "./union-square";
import { groundMaterial, worldMaterial } from "./materials";
import { Grass } from "./grass";
import { Houses } from "./houses";
import { contactRects, groundMask, lampLight, type Footprint } from "./textures";
import { StreetFurniture } from "./street";
import { Towers } from "./towers";
import { Trees } from "./trees";
import { Cars } from "./traffic";
import { Fog } from "./fog";
import { Shadowless } from "./parts";
import { detail } from "./shared";


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
      <Land tex={tex} lite={lite} />
      <Water lite={lite} />
      <Hills map={tex.hills} />
      <Headlands map={tex.hills} lite={lite} />
      <Coast lite={lite} />
      <Houses houses={city.houses} tex={tex} lite={lite} />
      <Towers towers={city.towers} tex={tex} />
      <Trees trees={city.trees} lite={lite} />
      <Grass lite={lite} grass={tex.grass} dry={tex.hills} />
      <Shadowless when={lite}>
        <StreetFurniture lamps={city.lamps} hydrants={city.hydrants} signs={city.signs} />
        <Bay />
      </Shadowless>
      <Cars lite={lite} />
      <Fog lite={lite} />
    </>
  );
}

/** Lite: only tiles that rise more than HILL cast shadows (a flat tile has nothing lower to shade). */
const HILL = 1.5;

/** Cliffs around the shore, and the hilly ground on top with the street map. */
/** The landmark buildings that stand on the street, for the contact shade: their walls plus what stands out of them (the shopfront), the Ferry Building's plinth. */
const LANDMARKS: Footprint[] = [
  ...([[SHOP, SHOP.relief], [UNION, UNION.relief], [MISSION, 0], [ROOFTOP, 0]] as const).map(([{ x0, x1, z0, z1 }, out]) => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0 + 2 * out, d: z1 - z0 + 2 * out })),
  { x: FERRY.x, z: FERRY.z, w: FERRY.plinth[0], d: FERRY.plinth[2] },
];

function Land({ tex, lite }: { tex: Textures; lite: boolean }) {
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
  const cliffMaterials = useMemo(() => [new MeshBasicMaterial({ visible: false }), worldMaterial(tex.concrete, 3)], [tex.concrete]);

  // Lite: in tiles, so what is out of view (or out of the sun's shadow box) is culled. A desktop
  // draws the ground whole: there the draw calls (main, shadow and mirror passes) cost more than the triangles.
  const terrain = useMemo(() => (lite ? tiles(terrainGeometry()) : [terrainGeometry()]).map((geometry) => ({ geometry, hill: relief(geometry) > HILL })), [lite]);
  const kerbs = useMemo(() => (lite ? tiles(kerbGeometry()) : [kerbGeometry()]), [lite]);
  // Concrete kerbs: the shade (top edge, face, gutter) is in the vertex colours.
  const kerbMaterial = useMemo(() => new MeshStandardMaterial({ map: tex.concrete, vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), [tex.concrete]);
  const ground = useMemo(() => groundMaterial(groundMask(), lampLight(CITY.lamps, contactRects(CITY, LANDMARKS)), tex.asphalt, tex.concrete, tex.grass, tex.hills), [tex.asphalt, tex.concrete, tex.grass, tex.hills]);

  return (
    <>
      <mesh geometry={cliffs} material={cliffMaterials} position={[0, -4.6, 0]} receiveShadow />
      {terrain.map(({ geometry, hill }, i) => (
        <mesh key={i} geometry={geometry} material={ground} receiveShadow castShadow={hill || !lite} />
      ))}
      {kerbs.map((geometry, i) => (
        <mesh key={i} ref={detail} geometry={geometry} material={kerbMaterial} receiveShadow />
      ))}
    </>
  );
}

/** Where the Marin road ends: north of it the headlands only slope down to the sea. */
const FAR_COAST = -290;

// Marin Headlands across the Golden Gate: ridged hills of golden grass and
// scrub, a cove where the bridge lands, steeper slopes darker.
function Headlands({ map, lite }: { map: Texture; lite: boolean }) {
  const geometry = useMemo(() => {
    const { x0, x1, z0, z1 } = HEADLANDS;
    // Far across the water: lite takes a coarser grid (a quarter of the triangles). The north
    // coast past the road's end (in the fog, seen only from far in Explore) rows twice as far apart.
    const step = lite ? 2.4 : 1.2;
    const rows = [
      ...Array.from({ length: Math.round((FAR_COAST - z0) / (2 * step)) }, (_, j) => z0 + (j * (FAR_COAST - z0)) / Math.round((FAR_COAST - z0) / (2 * step))),
      ...Array.from({ length: Math.round((z1 - FAR_COAST) / step) + 1 }, (_, j) => FAR_COAST + (j * (z1 - FAR_COAST)) / Math.round((z1 - FAR_COAST) / step)),
    ];
    const columns = Math.round((x1 - x0) / step);
    const g = new PlaneGeometry(x1 - x0, 1, columns, rows.length - 1);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, 0);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = rows[Math.floor(i / (columns + 1))];
      pos.setZ(i, z);
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
  }, [lite]);
  const material = useMemo(() => new MeshStandardMaterial({ map, vertexColors: true, roughness: 1 }), [map]);
  // No shadows cast: a far backdrop whose own shadows never showed in a chapter shot (67k triangles a frame).
  return <mesh geometry={geometry} material={material} receiveShadow />;
}
