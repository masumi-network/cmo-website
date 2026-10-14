"use client";

// Victorian row houses (Painted Ladies): six modelled variants (house-models.ts),
// scaled to the plot, each house in its own colour scheme. Per house: the
// front (its variant) and the body behind it (flat roof or gable). Houses are
// static, so they are merged by district (CELL): one draw call per district,
// and a district off screen or outside the sun's shadow box costs nothing.

import { useEffect, useMemo } from "react";
import { Float32BufferAttribute, Object3D, type BufferGeometry, type Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALK_OFFSET, WALK_Z } from "./grid";
import { BODY_DEPTH, PALETTES, RELIEF_DEPTH, VARIANTS, W, bodyGeometry, frontGeometry, palette } from "./house-models";
import { HOUSE_GAP, type House } from "./layout";
import { houseMaterial } from "./materials";
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

/** Victorian row houses: one modelled front per variant, lap-sided bodies, flat or gabled roofs. */
export function Houses({ houses, tex }: { houses: House[]; tex: { siding: Texture; shingles: Texture } }) {
  const material = useMemo(() => houseMaterial(tex.siding, tex.shingles, palette()), [tex.siding, tex.shingles]);
  const districts = useMemo(() => houseDistricts(houses), [houses]);
  useEffect(() => () => districts.forEach((g) => g.dispose()), [districts]);
  return (
    <>
      {districts.map((geometry, k) => (
        <mesh key={k} geometry={geometry} material={material} castShadow receiveShadow />
      ))}
    </>
  );
}
