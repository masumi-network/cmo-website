// What a shader-patched material needs to be rebuilt for the path tracer
// (photo-real spike, traced.ts). The tracer reads plain material values only,
// so each patched material records its inputs here. A WeakMap, not userData:
// material.clone() would JSON-copy the textures.

import type { Color, Material, Texture } from "three";

export type TraceInfo =
  | { kind: "house"; siding: Texture; shingles: Texture; palette: Float32Array }
  | { kind: "world"; map: Texture; scale: number; top?: string }
  | { kind: "concrete"; map: Texture; color: Color }
  | { kind: "water"; ripples: Texture; deep: Color }
  /** Its colour is baked from its own shader (bake-ground.ts): the mask decides it per pixel. */
  | { kind: "ground"; mask: Texture };

export const traceInfo = new WeakMap<Material, TraceInfo>();
