"use client";

// Victorian row houses (Painted Ladies): six modelled variants (house-models.ts),
// scaled to the plot, each house in its own colour scheme. Per house: the
// front (its variant) and the body behind it (flat roof or gable). Houses are
// static, so they are merged by district (CELL): one draw call per district,
// and a district off screen or outside the sun's shadow box costs nothing.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferGeometry, Float32BufferAttribute, Object3D, type Mesh, type Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALK_OFFSET, WALK_Z } from "./grid";
import { BODY_DEPTH, PALETTES, RELIEF_DEPTH, VARIANTS, W, bodyGeometry, frontGeometry, palette } from "./house-models";
import { HOUSE_GAP, type House } from "./layout";
import { houseMaterial } from "./materials";
import { shadowOnly } from "./parts";
import { HULL } from "./rig";

/** Variants: 2-storey are 0, 2, 4; 3-storey are 1, 3, 5. */
const TWO_STOREY = [0, 2, 4];
const THREE_STOREY = [1, 3, 5];
export const variantOf = (h: House, i: number) => (h.floors === 3 ? THREE_STOREY : TWO_STOREY)[(((i * 7 + Math.round(h.x * 3)) % 3) + 3) % 3];

/** True if b stands right next to a in the same row (they share a side wall). */
export const neighbours = (a: House, b: House) => a.facing === b.facing && Math.abs(a.z - b.z) < 1e-6 && Math.abs(Math.abs(a.x - b.x) - (a.w + b.w) / 2) < 1e-6;

/**
 * A colour scheme per house (PALETTES): seeded, and never the same as either
 * of the two houses before it in its row, so neighbours always differ.
 * Houses come in row order from the layout.
 */
export function paletteOf(houses: House[]) {
  const out: number[] = [];
  houses.forEach((h, i) => {
    const taken: number[] = [];
    if (i >= 1 && neighbours(h, houses[i - 1])) {
      taken.push(out[i - 1]);
      if (i >= 2 && neighbours(houses[i - 1], houses[i - 2])) taken.push(out[i - 2]);
    }
    let k = Math.floor(((Math.imul(i + 1, 2654435761) >>> 0) / 2 ** 32) * PALETTES.length);
    while (taken.includes(k)) k = (k + 1) % PALETTES.length;
    out.push(k);
  });
  return out;
}

/** The body is a little narrower than the plot (a seam between houses). The model is scaled to it. */
const scaleOf = (h: House) => (h.w - HOUSE_GAP) / W;

/** How far Cuso's body reaches sideways from his walking line (arms out), plus a little air. */
const REACH = Math.max(...HULL.map(([, , x0, x1]) => Math.max(-x0, x1))) + 0.04;

/**
 * How far this house's front stands out: RELIEF_DEPTH scaled with the model
 * (never deeper than the reference). Cuso walks the sidewalks of the WALK_Z
 * streets close to the house fronts on one side; there the front is
 * flattened so his arms clear it.
 */
export function reliefDepth(h: House) {
  const front = h.z + (h.facing * h.d) / 2;
  const gaps = WALK_Z.map((s) => (front - (s + WALK_OFFSET)) * -h.facing).filter((g) => g > 0 && g < 2);
  return Math.max(0, Math.min(RELIEF_DEPTH * Math.min(1, scaleOf(h)), ...gaps.map((g) => g - REACH)));
}

/** Both models start on the front wall at the ground, x across the facade, z out to the street. */
function onFrontWall(h: House, o: Object3D) {
  o.position.set(h.x, h.y, h.z + (h.facing * h.d) / 2);
  o.rotation.set(0, h.facing > 0 ? 0 : Math.PI, 0);
}
export function placeFront(h: House, o: Object3D) {
  onFrontWall(h, o);
  o.scale.set(scaleOf(h), scaleOf(h), reliefDepth(h) / RELIEF_DEPTH);
}
export function placeBody(h: House, o: Object3D) {
  onFrontWall(h, o);
  o.scale.set(scaleOf(h), scaleOf(h), h.d / BODY_DEPTH);
}

/** District size for merging houses (world units). Smaller: more draw calls, tighter culling. */
export const CELL = 40;

/**
 * Every house placed and merged, one geometry per district. Each vertex keeps
 * its house's colour scheme (aPalette) and front-wall origin (aOrigin, the
 * seed for which windows are lit).
 */
export function houseDistricts(houses: House[]): BufferGeometry[] {
  const palettes = paletteOf(houses);
  const fronts = VARIANTS.map((_, v) => frontGeometry(v));
  const bodies = { flat: bodyGeometry(false), gable: bodyGeometry(true) };
  const cells = new Map<string, BufferGeometry[]>();
  const o = new Object3D();
  houses.forEach((h, i) => {
    const key = `${Math.floor(h.x / CELL)},${Math.floor(h.z / CELL)}`;
    if (!cells.has(key)) cells.set(key, []);
    const parts: [BufferGeometry, typeof placeFront][] = [
      [fronts[variantOf(h, i)], placeFront],
      [h.roof === "gable" ? bodies.gable : bodies.flat, placeBody],
    ];
    for (const [model, place] of parts) {
      place(h, o);
      o.scale.z = Math.max(o.scale.z, 1e-4); // a flattened front stays invertible (normals)
      o.updateMatrix();
      const g = model.clone().applyMatrix4(o.matrix);
      const n = g.attributes.position.count;
      g.setAttribute("aPalette", new Float32BufferAttribute(new Float32Array(n).fill(palettes[i]), 1));
      const origin = new Float32Array(n * 2);
      for (let k = 0; k < n; k++) origin.set([o.position.x, o.position.z], k * 2);
      g.setAttribute("aOrigin", new Float32BufferAttribute(origin, 2));
      cells.get(key)!.push(g);
    }
  });
  return [...cells.values()].map((parts) => mergeGeometries(parts));
}

/** Lite: a district farther than FAR from the camera drops its faces under SMALL (square units). */
const FAR = 40;
const SMALL = 0.005;
/**
 * Lite: the shadows come from a stand-in with only the big faces (walls, roofs,
 * bays, cornices; a quarter of the triangles). The 1024 shadow map is about
 * 15 texels a unit: the trim it leaves out is under a texel.
 */
const SHADOW_FACES = 0.05;

/**
 * The same mesh without its smallest faces: dentils, the ends of sills, hoods
 * and brackets. From FAR on a phone they are a few pixels at most.
 */
export function withoutSmallFaces(g: BufferGeometry, area: number) {
  const p = g.attributes.position.array;
  const index = g.index!.array;
  const kept: number[] = [];
  const d = (a: number, b: number, k: number) => p[b * 3 + k] - p[a * 3 + k];
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const [ux, uy, uz, vx, vy, vz] = [d(a, b, 0), d(a, b, 1), d(a, b, 2), d(a, c, 0), d(a, c, 1), d(a, c, 2)];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 >= area) kept.push(a, b, c);
  }
  const out = new BufferGeometry(); // shares the vertex buffers: only the index is new
  for (const [name, attribute] of Object.entries(g.attributes)) out.setAttribute(name, attribute);
  out.setIndex(kept);
  return out;
}

/** Victorian row houses: one modelled front per variant, lap-sided bodies, flat or gabled roofs. */
export function Houses({ houses, tex, lite }: { houses: House[]; tex: { siding: Texture; shingles: Texture }; lite: boolean }) {
  const material = useMemo(() => houseMaterial(tex.siding, tex.shingles, palette()), [tex.siding, tex.shingles]);
  const districts = useMemo(
    () => houseDistricts(houses).map((near) => ({ near, far: lite ? withoutSmallFaces(near, SMALL) : null, shadow: lite ? withoutSmallFaces(near, SHADOW_FACES) : null })),
    [houses, lite],
  );
  useEffect(() => () => districts.forEach((d) => [d.near, d.far, d.shadow].forEach((g) => g?.dispose())), [districts]);
  const meshes = useRef<{ near: Mesh | null; far: Mesh | null }[]>([]);
  useFrame(({ camera }) => {
    if (!lite) return;
    districts.forEach(({ near }, k) => {
      const m = meshes.current[k];
      if (!m?.near || !m.far) return;
      const s = near.boundingSphere ?? (near.computeBoundingSphere(), near.boundingSphere!);
      const far = camera.position.distanceTo(s.center) - s.radius > FAR;
      m.near.visible = !far;
      m.far.visible = far;
    });
  });
  return (
    <>
      {districts.map(({ near, far, shadow }, k) => (
        <group key={k}>
          <mesh ref={(m) => void ((meshes.current[k] ??= { near: null, far: null }).near = m)} geometry={near} material={material} castShadow={!lite} receiveShadow />
          {far && <mesh ref={(m) => void ((meshes.current[k] ??= { near: null, far: null }).far = m)} geometry={far} material={material} receiveShadow visible={false} />}
          {shadow && <mesh ref={shadowOnly} geometry={shadow} material={material} />}
        </group>
      ))}
    </>
  );
}
