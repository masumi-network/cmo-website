"use client";

// Real 3D grass in the parks: tufts of thin blades (one triangle each), one
// instanced draw for all of them. Each tuft takes its colour from the lawn
// under it (LAWN_GLSL, the same as the ground shader), so the blades grow out
// of the ground's colour and shrink back into it with distance: taller grass
// stays visible farther. Blades sway in the wind, receive shadows, cast none.
// Wild slopes (Twin Peaks, Telegraph Hill) get tall dry grass, coyote brush
// shrubs and rock outcrops near the summits (two more instanced draws).

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  MeshStandardMaterial,
  Sphere,
  Vector3,
  type Object3D,
  type Texture,
} from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { COIT } from "./coit-tower";
import { PARKS, inPark } from "./grid";
import { CITY } from "./layout";
import { LAWN_GLSL, PEAKS, lawnTexture, noise, onTrail, wildness } from "./lawn";
import { Instances } from "./parts";
import { PATHS } from "./routes";
import { detail } from "./shared";

/** Most triangles the blades may cost (full mode). */
export const GRASS_BUDGET = 150_000;
/** Blades (triangles) per tuft. */
export const TUFT_BLADES = 9;

/** A tuft: root on the ground, turn, blade height, radius, ground normal. */
export type Tuft = { x: number; y: number; z: number; yaw: number; h: number; spread: number; nx: number; ny: number; nz: number };
/** A rock or shrub: radius s. */
export type Stone = { x: number; y: number; z: number; s: number; yaw: number };

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// What grass and stones stay off, near the parks only (so placement stays quick).
const near = (x: number, z: number, m: number) => PARKS.some(([x0, x1, z0, z1]) => x > x0 - m && x < x1 + m && z > z0 - m && z < z1 + m);
const TRUNKS = CITY.trees.filter((t) => near(t.x, t.z, 1));
const ROUTE: [number, number, number, number][] = PATHS.flatMap(({ points }) =>
  points.slice(1).map((b, i): [number, number, number, number] => [points[i][0], points[i][2], b[0], b[2]]),
).filter(([ax, az, bx, bz]) =>
  PARKS.some(([x0, x1, z0, z1]) => Math.max(ax, bx) > x0 - 1 && Math.min(ax, bx) < x1 + 1 && Math.max(az, bz) > z0 - 1 && Math.min(az, bz) < z1 + 1),
);
const SPOTS = chapters.map((c) => c.spot);

const toSegment = (x: number, z: number, [ax, az, bx, bz]: [number, number, number, number]) => {
  const l2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
  const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / l2));
  return Math.hypot(x - ax - t * (bx - ax), z - az - t * (bz - az));
};

/** True if something of radius r at x,z would sit off the lawn or in the way. */
function blocked(x: number, z: number, r: number) {
  // In a park, inPark is groundAt(...) === "grass" (grid.ts), and much quicker.
  if (!inPark(x, z) || !inPark(x + r, z) || !inPark(x - r, z) || !inPark(x, z + r) || !inPark(x, z - r)) return true;
  if (Math.hypot(x - COIT.x, z - COIT.z) < COIT.plaza + 0.3 + r) return true;
  if (TRUNKS.some((t) => Math.hypot(x - t.x, z - t.z) < 0.2 * t.s + r)) return true;
  if (SPOTS.some((p) => Math.hypot(x - p[0], z - p[2]) < 1.1)) return true;
  if (ROUTE.some((s) => toSegment(x, z, s) < 0.85)) return true;
  return onTrail(x, z, r);
}

/** The ground normal at x,z. */
function normalAt(x: number, z: number) {
  const e = 0.1;
  const n = new Vector3(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
  return { nx: n.x, ny: n.y, nz: n.z };
}

/**
 * The tufts, seeded. A jittered grid over the parks; mown lawns get short
 * tufts, the unmown strip along the kerb a little longer ones, wild slopes
 * tall dry grass. Lite (phones) keeps one tuft in four.
 */
export function grassTufts(lite: boolean): Tuft[] {
  const rand = seeded(7);
  const cell = 0.21;
  const tufts: Tuft[] = [];
  let count = 0;
  for (const [px0, px1, pz0, pz1] of PARKS) {
    for (let gx = px0; gx < px1; gx += cell) {
      for (let gz = pz0; gz < pz1; gz += cell) {
        const x = gx + rand() * cell;
        const z = gz + rand() * cell;
        const roll = rand();
        const pick = rand();
        const yaw = rand() * Math.PI * 2;
        const size = rand();
        if (!inPark(x, z)) continue;
        const wild = wildness(x, z) > pick;
        const kerb = PARKS.some(([x0, x1, z0, z1]) => x > x0 && x < x1 && z > z0 && z < z1 && Math.min(x - x0, x1 - x, z - z0, z1 - z) < 2.9);
        // Short and dense on mown lawns, a little longer along the kerb, tall and looser on wild slopes.
        if (roll > (wild ? 0.6 : 0.95)) continue;
        const h = wild ? 0.15 + size * 0.17 : kerb ? 0.08 + size * 0.04 : 0.05 + size * 0.03;
        const spread = wild ? 0.1 : 0.06;
        if ((lite && count++ % 4) || blocked(x, z, spread)) continue;
        tufts.push({ x, y: heightAt(x, z) - 0.01, z, yaw, h, spread, ...normalAt(x, z) });
      }
    }
  }
  return tufts;
}

/**
 * One tuft in unit size: TUFT_BLADES thin tapered blades (a triangle each)
 * leaning out from the middle, radius about 1, height up to 1.
 */
export function tuftGeometry() {
  const rand = seeded(3);
  const pos: number[] = [];
  for (let k = 0; k < TUFT_BLADES; k++) {
    const a = (k / TUFT_BLADES) * Math.PI * 2 + rand() * 0.6;
    const r = Math.sqrt(rand()) * 0.55;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const face = rand() * Math.PI; // which way the blade's flat side faces
    const w = 0.14 + rand() * 0.06;
    const h = 0.6 + rand() * 0.4;
    const lean = 0.15 + rand() * 0.3;
    const [cx, cz] = [Math.cos(face) * w, Math.sin(face) * w];
    pos.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + Math.cos(a) * lean, h, z + Math.sin(a) * lean);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

/** Rock outcrops by the Twin Peaks summits and on Telegraph Hill; coyote brush on the wild slopes. */
export function parkStones(): { rocks: Stone[]; shrubs: Stone[] } {
  const rand = seeded(11);
  const rocks: Stone[] = [];
  const shrubs: Stone[] = [];
  const add = (list: Stone[], x: number, z: number, s: number, sink: number, gap: number) => {
    if (blocked(x, z, s) || list.some((o) => Math.hypot(o.x - x, o.z - z) < (o.s + s) * gap)) return;
    list.push({ x, y: heightAt(x, z) - s * sink, z, s, yaw: rand() * Math.PI * 2 });
  };
  // A few outcrops on each summit: big rocks huddled together, smaller ones around them.
  const outcrop = (cx: number, cz: number, n: number, size: number) => {
    for (let k = 0; k < n * 3; k++) {
      const a = rand() * Math.PI * 2;
      const r = rand() * size * 1.6;
      add(rocks, cx + Math.cos(a) * r, cz + Math.sin(a) * r, size * (1 - (0.6 * r) / (size * 1.6)) * (0.6 + rand() * 0.4), 0.4, 0.75);
    }
  };
  for (const [px, pz] of PEAKS.slice(0, 2)) {
    outcrop(px + 0.2, pz - 0.6, 5, 0.42);
    outcrop(px - 1.3, pz + 0.4, 4, 0.3);
    outcrop(px + 1.6, pz - 1.6, 3, 0.26);
  }
  // Telegraph Hill's steep bay side.
  outcrop(8.6, -31.6, 4, 0.3);
  outcrop(9.6, -28.8, 3, 0.24);
  // Coyote brush in patches on wild ground, more on the shady north faces, none on the summits.
  for (let x = -48.5; x < 10.6; x += 0.45) {
    for (let z = -33.5; z < 41.6; z += 0.45) {
      const jx = x + (rand() - 0.5) * 0.4;
      const jz = z + (rand() - 0.5) * 0.4;
      const s = 0.26 + rand() * 0.2;
      const roll = rand();
      if (wildness(jx, jz) < 0.7 || PEAKS.some(([px, pz]) => Math.hypot(jx - px, jz - pz) < 3)) continue;
      const shade = -normalAt(jx, jz).nz * 4;
      if (noise(jx / 3.4, jz / 3.4) + shade * 0.12 > 0.72 && roll < 0.8) add(shrubs, jx, jz, s, 0.25, 0.8);
    }
  }
  return { rocks, shrubs };
}

/** Rock: a lumpy, faceted icosahedron, flatter than tall. Shrub: a soft round lump, darker underneath. */
function stoneGeometries() {
  const rock = new IcosahedronGeometry(1, 1);
  const p = rock.attributes.position;
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 0.75 + 0.5 * noise(v.x * 1.7 + 5, v.z * 1.7 + v.y * 1.3);
    p.setXYZ(i, v.x * k, v.y * k * 0.62, v.z * k);
  }
  rock.computeVertexNormals();
  // Shrub: three soft lumps of leaves, darker underneath and inside.
  const lumps: [number, number, number, number][] = [[0, 0.05, 0, 0.8], [0.5, -0.05, 0.25, 0.6], [-0.4, -0.08, -0.32, 0.55]];
  const shrub = mergeGeometries(
    lumps.map(([lx, ly, lz, r], k) => {
      const g = mergeVertices(new IcosahedronGeometry(1, k ? 0 : 1).deleteAttribute("normal").deleteAttribute("uv"));
      const q = g.attributes.position;
      const colors: number[] = [];
      for (let i = 0; i < q.count; i++) {
        v.fromBufferAttribute(q, i);
        const bump = 0.78 + 0.3 * noise(v.x * 2.3 + k * 7, v.z * 2.3 + v.y * 1.9) + 0.14 * noise(v.x * 6 + k, v.y * 6 - v.z * 4);
        const y = Math.max(v.y, -0.5) * bump * r * 0.85 + ly;
        q.setXYZ(i, v.x * bump * r + lx, y, v.z * bump * r + lz);
        const ao = (0.5 + 0.5 * Math.min(1, Math.max(0, (y + 0.45) / 1.1))) * (0.9 + 0.2 * noise(v.x * 5 + k, v.z * 5 - v.y * 3));
        colors.push(ao, ao, ao * 0.95);
      }
      g.setAttribute("color", new Float32BufferAttribute(colors, 3));
      g.computeVertexNormals();
      return g;
    }),
  )!;
  return { rock, shrub };
}

/** The blade material: shape, wind and distance fade in the vertex shader, lawn colour per tuft. */
function bladeMaterial(grass: Texture, dry: Texture, uniforms: { uTime: { value: number }; uFade: { value: [number, number] } }) {
  const material = new MeshStandardMaterial({ roughness: 0.88, side: DoubleSide });
  material.customProgramCacheKey = () => "grass-blades";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uLawn: { value: lawnTexture() }, uGrass: { value: grass }, uDry: { value: dry } });
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 aRoot;
        attribute vec4 aShape;
        uniform float uTime;
        uniform vec2 uFade;
        uniform sampler2D uGrass;
        uniform sampler2D uDry;
        varying vec3 vGrass;
        varying float vTip;
        ${LAWN_GLSL}`,
      )
      // Lit like the ground under it (its normal), so blades and lawn shade alike.
      .replace("#include <beginnormal_vertex>", "vec3 objectNormal = vec3(aShape.z, sqrt(max(0.0, 1.0 - dot(aShape.zw, aShape.zw))), aShape.w);")
      .replace(
        "#include <begin_vertex>",
        `vec3 transformed = aRoot.xyz;
        vTip = position.y;
        vGrass = vec3(0.0);
        // Shrink into the ground with distance (taller grass stays longer); none in the water's
        // mirror (its camera is below the water). Shrunk blades skip the rest.
        float gGrow = cameraPosition.y < 0.0 ? 0.0 : 1.0 - smoothstep(uFade.x, uFade.y, distance(cameraPosition, aRoot.xyz) / (0.55 + aShape.x * 4.0));
        if (gGrow > 0.0) {
          float gC = cos(aRoot.w);
          float gS = sin(aRoot.w);
          transformed = position;
          transformed.xz = mat2(gC, gS, -gS, gC) * transformed.xz * aShape.y;
          transformed.y *= aShape.x * gGrow;
          // Wind from the ocean (west): slow gusts rolling across, a quick flutter on top.
          float gBend = position.y * position.y * aShape.x * gGrow;
          float gGust = 0.55 + 0.45 * sin(uTime * 1.1 - aRoot.x * 0.25 + aRoot.z * 0.1);
          transformed.xz += (vec2(0.32, 0.08) * gGust + 0.07 * vec2(sin(uTime * 3.1 + aRoot.z * 2.3), cos(uTime * 2.6 + aRoot.x * 2.1))) * gBend;
          transformed += aRoot.xyz;
          vec4 gField = texture2D(uLawn, lawnUv(aRoot.xz));
          vGrass = lawnColor(aRoot.xz, gField, objectNormal, lawnGreen(aRoot.xz), texture2D(uDry, aRoot.xz / 8.0).rgb);
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGrass;\nvarying float vTip;")
      // Darker at the root (the blades shade each other), lighter and a touch warmer at the tip.
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = vGrass * mix(0.5, 1.15, vTip) * mix(vec3(1.0), vec3(1.05, 1.04, 0.9), vTip);")
      // Both sides lit as the ground (no flip for the back face).
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);\nnonPerturbedNormal = normal;");
  };
  return material;
}

/** Shrubs: leafy speckle from noise in shrub space (two sizes of leaf clusters). */
function shrubMaterial() {
  const material = new MeshStandardMaterial({ roughness: 1, vertexColors: true });
  material.customProgramCacheKey = () => "park-shrubs";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vShrubP;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvShrubP = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vShrubP;
        float sNoise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float n = dot(i, vec3(1.0, 57.0, 113.0));
          vec4 h = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0)) * 43758.5453);
          vec4 k = fract(sin(vec4(n, n + 1.0, n + 57.0, n + 58.0) + 113.0) * 43758.5453);
          vec2 a = mix(h.xz, h.yw, f.x);
          vec2 b = mix(k.xz, k.yw, f.x);
          return mix(mix(a.x, a.y, f.y), mix(b.x, b.y, f.y), f.z);
        }`,
      )
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 0.55 + 0.35 * sNoise(vShrubP * 7.0) + 0.3 * sNoise(vShrubP * 19.0);");
  };
  return material;
}

export function Grass({ lite, grass, dry }: { lite: boolean; grass: Texture; dry: Texture }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uFade: { value: (lite ? [12, 20] : [20, 34]) as [number, number] } }), [lite]);
  const material = useMemo(() => bladeMaterial(grass, dry, uniforms), [grass, dry, uniforms]);
  const geometry = useMemo(() => {
    const tufts = grassTufts(lite);
    const g = new InstancedBufferGeometry().copy(tuftGeometry() as InstancedBufferGeometry);
    g.setAttribute("aRoot", new InstancedBufferAttribute(Float32Array.from(tufts.flatMap((t) => [t.x, t.y, t.z, t.yaw])), 4));
    g.setAttribute("aShape", new InstancedBufferAttribute(Float32Array.from(tufts.flatMap((t) => [t.h, t.spread, t.nx, t.nz])), 4));
    g.instanceCount = tufts.length;
    // Bounds of all the parks, for frustum culling (the unit tuft's own bounds would cull wrongly).
    const xs = tufts.map((t) => t.x);
    const zs = tufts.map((t) => t.z);
    const c = new Vector3((Math.min(...xs) + Math.max(...xs)) / 2, 3, (Math.min(...zs) + Math.max(...zs)) / 2);
    g.boundingSphere = new Sphere(c, Math.hypot(Math.max(...xs) - c.x, Math.max(...zs) - c.z, 4));
    return g;
  }, [lite]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
  });

  const stones = useMemo(() => parkStones(), []);
  const geos = useMemo(() => stoneGeometries(), []);
  const mats = useMemo(
    () => ({
      rock: new MeshStandardMaterial({ roughness: 0.92, flatShading: true }),
      shrub: shrubMaterial(),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  useEffect(() => () => Object.values(geos).forEach((g) => g.dispose()), [geos]);
  return (
    <>
      <mesh ref={detail} geometry={geometry} material={material} receiveShadow />
      {/* lite: no shadows from rocks and brush (a phone shows them a few pixels tall) */}
      <Instances items={stones.rocks} geometry={geos.rock} material={mats.rock} place={placeRock} shadows={!lite} detail />
      <Instances items={stones.shrubs} geometry={geos.shrub} material={mats.shrub} place={placeShrub} shadows={!lite} detail />
    </>
  );
}

const ROCK = ["#6a625a", "#5f5953", "#726a60", "#5c564e"];
const SHRUB = ["#465a32", "#50623a", "#3f522e", "#5a6640"];
const pickOf = (list: string[], s: Stone) => list[Math.floor((s.yaw / (Math.PI * 2)) * list.length) % list.length];

function placeRock(s: Stone, o: Object3D) {
  o.position.set(s.x, s.y, s.z);
  o.rotation.set(0, s.yaw, 0);
  o.scale.setScalar(s.s);
  return pickOf(ROCK, s);
}
function placeShrub(s: Stone, o: Object3D) {
  o.position.set(s.x, s.y, s.z);
  o.rotation.set(0, s.yaw, 0);
  o.scale.set(s.s, s.s, s.s * 0.9);
  return pickOf(SHRUB, s);
}
