"use client";

// Shared kit for the landmark buildings: textures, merged-part helpers, materials.

import { useTexture } from "@react-three/drei";
import { useMemo } from "react";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { towerMaterial } from "./materials";
import { type V3 } from "./parts";
import { BoxGeometry, BufferGeometry, CanvasTexture, CylinderGeometry, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Texture } from "three";

export const LANDMARK_TEXTURES = {
  posts: "/textures/posts.jpg",
  stone: "/textures/stone.jpg",
  siding: "/textures/siding.jpg",
  ggsteel: "/textures/ggsteel.jpg",
  baysteel: "/textures/baysteel.jpg",
  asphalt: "/textures/asphalt.jpg",
  concrete: "/textures/concrete.jpg",
};
export type LandmarkTextures = Record<keyof typeof LANDMARK_TEXTURES, Texture>;

export function useLandmarkTextures() {
  return useTexture(LANDMARK_TEXTURES, (loaded) => {
    for (const t of Object.values(loaded as LandmarkTextures)) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = RepeatWrapping;
    }
  }) as LandmarkTextures;
}

/** Limestone walls (same as the downtown towers), for landmark boxes. */
export function useStone() {
  const { stone } = useLandmarkTextures();
  return useMemo(() => towerMaterial(stone, { w: 4.8, h: 7.2 }, false), [stone]);
}

// Landmark detail is built from simple parts merged into one geometry per
// material, so a whole building is a handful of draw calls.
export const placer = new Object3D();
export function placed(g: BufferGeometry, p: V3, r: V3 = [0, 0, 0]) {
  placer.position.set(...p);
  placer.rotation.set(...r);
  placer.updateMatrix();
  return g.applyMatrix4(placer.matrix);
}
/** A box at `p` (centre) of size `s`. */
export const box = (p: V3, s: V3, r?: V3) => placed(new BoxGeometry(...s), p, r);
/** An upright cylinder at `p` (centre). */
export const cyl = (p: V3, top: number, bottom: number, h: number, seg = 12, r?: V3) => placed(new CylinderGeometry(top, bottom, h, seg), p, r);
/** Flat-shaded copy (hard edges on low-poly solids like the pyramid). */
export const faceted = (g: BufferGeometry) => {
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
};
/** Parts merged into one geometry. */
export function merged(parts: BufferGeometry[]) {
  const out = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of parts) g.dispose();
  return out;
}

export function useMat(color: string, roughness = 0.85, metalness = 0) {
  return useMemo(() => new MeshStandardMaterial({ color, roughness, metalness }), [color, roughness, metalness]);
}

/** Flat roofs: tar and gravel (the concrete texture, darker and warm). */
export function useRoof(w: number, d: number) {
  const { concrete } = useLandmarkTextures();
  return useMemo(() => {
    const map = concrete.clone();
    map.repeat.set(w / 2.6, d / 2.6);
    return new MeshStandardMaterial({ map, color: "#b9b0a4", roughness: 0.95 });
  }, [concrete, w, d]);
}

/** A texture drawn once with the 2D canvas (clock faces, facades, envelopes). */
export function drawn(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  if (color) texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

