// What a shader-patched material needs to be rebuilt for the path tracer
// (photo-real spike, traced.ts). The tracer reads plain material values only,
// so each patched material records its inputs here. A WeakMap, not userData:
// material.clone() would JSON-copy the textures.

import type { Color, Material, Texture } from "three";

export type TraceInfo =
  /** `night`: the shader's uNight (about half the windows light up). */
  | { kind: "house"; siding: Texture; shingles: Texture; palette: Float32Array; night: { value: number } }
  | { kind: "world"; map: Texture; scale: number; top?: string }
  | { kind: "concrete"; map: Texture; color: Color }
  | { kind: "water"; ripples: Texture; deep: Color }
  /** Its colour is baked from its own shader (bake-ground.ts): the mask decides it per pixel. */
  | { kind: "ground"; mask: Texture }
  /** The shop (shop.tsx): vertex colours, `aMat` picks the surface, `aGlow` above 1.5 lights lamps; the canvas (`atlas`) for pictures and leaves. */
  | { kind: "painted"; atlas: { value: Texture | null } }
  /** Downtown towers (materials.ts downtownMaterial): vertex tint, `aUv` wall grid, `aInfo` (part, seed, flood); `night` is the shader's uNight. */
  | { kind: "downtown"; stone: Texture; night: { value: number } }
  /** Landmark stone (towerMaterial): a facade tile in world units on walls, darker tops. */
  | { kind: "tower"; facade: Texture; tile: { w: number; h: number }; glassy: boolean };

export const traceInfo = new WeakMap<Material, TraceInfo>();
