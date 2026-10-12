// Textured materials for the city (art pass 3). Textures are generated
// (design/prompts/textures) and live in public/textures. Shader patches on
// MeshStandardMaterial map them in world units so nothing stretches, and light
// windows at night from the dark glass in each texture.

import { MeshStandardMaterial, type Texture } from "three";
import { facadeNight } from "./facade";

/** Footing below ground on every building (see city.tsx). */
export const FOOTING = 1.4;
/** House front atlas: 3 columns x 2 rows of facades. */
export const ATLAS_COLS = 3;
export const ATLAS_ROWS = 2;

const COMMON_VERT = /* glsl */ `
  vec4 fW = vec4(transformed, 1.0);
  vec3 fN = objectNormal;
  #ifdef USE_INSTANCING
    fW = instanceMatrix * fW;
    fN = mat3(instanceMatrix) * fN;
  #endif
  vFPos = (modelMatrix * fW).xyz;
  vFNormal = normalize(mat3(modelMatrix) * fN);`;

const COMMON_FRAG = /* glsl */ `
  uniform float uNight;
  varying vec3 vFPos;
  varying vec3 vFNormal;
  float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  float fLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  // Dark, slightly blue pixels are window glass.
  float fGlass(vec3 c) { return smoothstep(0.34, 0.16, fLuma(c)) * smoothstep(-0.04, 0.03, c.b - c.r); }`;

function patch(material: MeshStandardMaterial, key: string, opts: { uniforms: Record<string, { value: unknown }>; vertHead?: string; vert?: string; fragHead: string; color: string; emissive?: string; roughness?: string }) {
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uNight: facadeNight, ...opts.uniforms });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vFPos;\nvarying vec3 vFNormal;\n${opts.vertHead ?? ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${COMMON_VERT}\n${opts.vert ?? ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON_FRAG}\n${opts.fragHead}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${opts.color}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${opts.roughness ?? ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${opts.emissive ?? ""}`);
  };
  return material;
}

/**
 * Row houses: the street-facing side shows one facade from the atlas (per
 * instance `aTile`), the other walls get tinted lap siding.
 * Needs instance attributes `aTile` and `aFacing` (+1 faces +z, -1 faces -z).
 */
export function houseMaterial(atlas: Texture, siding: Texture) {
  return patch(new MeshStandardMaterial({ roughness: 0.85 }), "house", {
    uniforms: { uAtlas: { value: atlas }, uSiding: { value: siding } },
    vertHead: "attribute float aTile;\nattribute float aFacing;\nvarying vec2 vFront;\nvarying float vTile;\nvarying float vIsFront;",
    vert: /* glsl */ `
      float fSy = length(instanceMatrix[1].xyz);
      float fU = position.x + 0.5;
      vFront = vec2(aFacing > 0.0 ? fU : 1.0 - fU, (position.y * fSy - ${FOOTING.toFixed(2)}) / max(fSy - ${FOOTING.toFixed(2)}, 0.01));
      vTile = aTile;
      vIsFront = step(0.5, normal.z * aFacing);`,
    fragHead: "uniform sampler2D uAtlas;\nuniform sampler2D uSiding;\nvarying vec2 vFront;\nvarying float vTile;\nvarying float vIsFront;\nfloat fLit = 0.0;",
    color: /* glsl */ `
      vec3 fTint = diffuseColor.rgb;
      float fWall = 1.0 - step(0.5, abs(vFNormal.y));
      if (vIsFront > 0.5 && vFront.y >= 0.0) {
        vec2 fCell = vec2(mod(vTile, ${ATLAS_COLS}.0), floor(vTile / ${ATLAS_COLS}.0));
        vec2 fUv = (fCell + clamp(vFront, 0.002, 0.998)) / vec2(${ATLAS_COLS}.0, ${ATLAS_ROWS}.0);
        fUv.y = 1.0 - (fCell.y + 1.0 - clamp(vFront.y, 0.002, 0.998)) / ${ATLAS_ROWS}.0;
        vec3 fF = texture2D(uAtlas, fUv).rgb;
        diffuseColor.rgb = fF;
        float fWin = fHash(floor(vFront * vec2(3.0, 5.0)) + vTile * 7.0 + floor(vFPos.xz));
        fLit = fGlass(fF) * step(0.5, fWin);
      } else if (fWall > 0.5) {
        float fU2 = abs(vFNormal.x) > 0.5 ? vFPos.z : vFPos.x;
        diffuseColor.rgb = texture2D(uSiding, vec2(fU2, vFPos.y) / 2.4).rgb * fTint;
      } else {
        diffuseColor.rgb = fTint * 0.55;
      }`,
    emissive: "totalEmissiveRadiance += vec3(1.0, 0.74, 0.42) * fLit * uNight * 1.6;",
  });
}

/** Towers: a tileable facade texture repeated in world units (one tile = 4 x 4 windows). */
export function towerMaterial(facade: Texture, tile: { w: number; h: number }, glassy: boolean) {
  return patch(new MeshStandardMaterial({ roughness: glassy ? 0.35 : 0.8, metalness: glassy ? 0.25 : 0 }), `tower-${glassy ? 1 : 0}`, {
    uniforms: { uFacade: { value: facade }, uTile: { value: [tile.w, tile.h] } },
    fragHead: "uniform sampler2D uFacade;\nuniform vec2 uTile;\nfloat fLit = 0.0;\nfloat fIsGlass = 0.0;",
    color: /* glsl */ `
      float fWall = 1.0 - step(0.5, abs(vFNormal.y));
      if (fWall > 0.5) {
        float fU = abs(vFNormal.x) > 0.5 ? vFPos.z : vFPos.x;
        vec2 fUv = vec2(fU, vFPos.y) / uTile;
        vec3 fF = texture2D(uFacade, fUv).rgb;
        // Glass curtain walls are light blue (detect by blueness); stone has dark punched windows.
        fIsGlass = ${glassy ? "smoothstep(0.03, 0.14, fF.b - fF.r)" : "fGlass(fF)"};
        diffuseColor.rgb = fF * ${glassy ? "0.78" : "1.0"} * mix(vec3(1.0), diffuseColor.rgb * 1.15, 0.35);
        float fWin = fHash(floor(fUv * 4.0) + floor(vFNormal.xz + 0.5) * 17.0);
        fLit = fIsGlass * step(0.48, fWin);
      } else {
        diffuseColor.rgb *= 0.62;
      }`,
    roughness: "roughnessFactor = mix(roughnessFactor, 0.12, fIsGlass);",
    emissive: "totalEmissiveRadiance += vec3(1.0, 0.8, 0.52) * fLit * uNight * 1.4;",
  });
}

/** Gable roofs: shingles mapped from above. */
export function roofMaterial(shingles: Texture) {
  return patch(new MeshStandardMaterial({ roughness: 0.9 }), "roof", {
    uniforms: { uShingles: { value: shingles } },
    fragHead: "uniform sampler2D uShingles;",
    color: "diffuseColor.rgb = texture2D(uShingles, vFPos.xz / 2.0 + vFPos.y * 0.37).rgb * mix(vec3(1.0), diffuseColor.rgb, 0.5);",
  });
}

/**
 * The ground: the street map (mask: R asphalt, G sidewalk, B grass, white =
 * lane marks, black = plain block ground) blended with detail textures.
 */
export function groundMaterial(mask: Texture, asphalt: Texture, concrete: Texture, grass: Texture) {
  return patch(new MeshStandardMaterial({ map: mask, roughness: 0.95 }), "ground", {
    uniforms: { uAsphalt: { value: asphalt }, uConcrete: { value: concrete }, uGrass: { value: grass } },
    fragHead: "uniform sampler2D uAsphalt;\nuniform sampler2D uConcrete;\nuniform sampler2D uGrass;",
    color: /* glsl */ `
      vec3 fM = diffuseColor.rgb;
      float fMark = step(0.85, min(fM.r, min(fM.g, fM.b)));
      vec3 fAsphalt = texture2D(uAsphalt, vFPos.xz / 6.0).rgb;
      vec3 fConcrete = texture2D(uConcrete, vFPos.xz / 3.0).rgb;
      vec3 fGrass = texture2D(uGrass, vFPos.xz / 5.0).rgb;
      vec3 fBlock = fConcrete * vec3(0.86, 0.82, 0.76);
      vec3 fBase = fAsphalt * fM.r + fConcrete * fM.g + fGrass * fM.b + fBlock * clamp(1.0 - fM.r - fM.g - fM.b, 0.0, 1.0);
      diffuseColor.rgb = mix(fBase, vec3(0.86, 0.84, 0.78), fMark);`,
    roughness: "roughnessFactor = mix(roughnessFactor, 0.8, fM.r);",
  });
}

/** Any texture mapped in world units: walls by (along, height), tops by (x, z). */
export function worldMaterial(map: Texture, scale: number, top?: string) {
  return patch(new MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), `world-${top ?? "same"}`, {
    uniforms: { uMap: { value: map }, uScale: { value: scale } },
    fragHead: "uniform sampler2D uMap;\nuniform float uScale;",
    color: /* glsl */ `
      float fWall = 1.0 - step(0.5, abs(vFNormal.y));
      float fU = abs(vFNormal.x) > 0.5 ? vFPos.z : vFPos.x;
      vec3 fT = texture2D(uMap, (fWall > 0.5 ? vec2(fU, vFPos.y) : vFPos.xz) / uScale).rgb;
      diffuseColor.rgb = ${top ? `fWall > 0.5 ? fT : vec3(${hexToVec(top)})` : "fT"};`,
  });
}

function hexToVec(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => ((c / 255) ** 2.2).toFixed(3)).join(", ");
}
