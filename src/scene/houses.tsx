"use client";

// Victorian row houses (Painted Ladies): six modelled variants (house-models.ts),
// each instanced over its houses and scaled to the plot, each house in its own
// colour scheme. Per house: the front
// (one mesh per variant) and the body behind it (one mesh for all flat roofs,
// one for all gables). Eight draw calls for the whole city of houses.

import { useMemo } from "react";
import type { Object3D, Texture } from "three";
import { WALK_OFFSET, WALK_Z } from "./grid";
import { BODY_DEPTH, PALETTES, RELIEF_DEPTH, VARIANTS, W, bodyGeometry, frontGeometry, palette } from "./house-models";
import { HOUSE_GAP, type House } from "./layout";
import { houseMaterial } from "./materials";
import { Instances } from "./parts";
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

type Item = { h: House; v: number; p: number };
const paletteAttribute = { aPalette: (it: Item) => it.p };
const front = (it: Item, o: Object3D) => placeFront(it.h, o);
const body = (it: Item, o: Object3D) => placeBody(it.h, o);

/** Victorian row houses: one modelled front per variant, lap-sided bodies, flat or gabled roofs. */
export function Houses({ houses, tex }: { houses: House[]; tex: { siding: Texture; shingles: Texture } }) {
  const material = useMemo(() => houseMaterial(tex.siding, tex.shingles, palette()), [tex]);
  const meshes = useMemo(() => {
    const palettes = paletteOf(houses);
    const items = houses.map((h, i) => ({ h, v: variantOf(h, i), p: palettes[i] }));
    return [
      ...VARIANTS.map((_, v) => ({ geometry: frontGeometry(v), items: items.filter((it) => it.v === v), place: front })),
      { geometry: bodyGeometry(false), items: items.filter((it) => it.h.roof !== "gable"), place: body },
      { geometry: bodyGeometry(true), items: items.filter((it) => it.h.roof === "gable"), place: body },
    ];
  }, [houses]);
  return (
    <>
      {meshes.map(({ geometry, items, place }, k) => (
        <Instances key={k} items={items} geometry={geometry} material={material} place={place} attributes={paletteAttribute} />
      ))}
    </>
  );
}
