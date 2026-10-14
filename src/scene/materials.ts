// Textured materials for the city (art pass 3). Textures are generated
// (design/prompts/textures) and live in public/textures. Shader patches on
// MeshStandardMaterial map them in world units so nothing stretches, and light
// windows at night from the dark glass in each texture.

import { MeshStandardMaterial, type Texture } from "three";
import { facadeNight } from "./facade";
import { SLOT, SLOTS } from "./house-models";
import { LAWN_GLSL, lawnTexture } from "./lawn";
import { GLASS_ENV_GLSL, glassUniforms } from "./reflections";
import { traceInfo } from "./trace-info";

/** Footing below ground on every building (see city.tsx). */
export const FOOTING = 1.4;

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

function patch(material: MeshStandardMaterial, key: string, opts: { uniforms: Record<string, { value: unknown }>; vertHead?: string; vert?: string; fragHead: string; color: string; emissive?: string; roughness?: string; normal?: string; lights?: string }) {
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
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${opts.normal ?? ""}`)
      .replace("#include <lights_fragment_maps>", `#include <lights_fragment_maps>\n${opts.lights ?? ""}`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${opts.emissive ?? ""}`);
  };
  return material;
}

/** Smooth value noise, 0..1. */
const VALUE_NOISE = /* glsl */ `
  float fVNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + 1.0), f.x), f.y);
  }`;

/**
 * Row houses (house-models.ts): painted wood in each house's colours. Vertex
 * attributes `aSlot` (which paint, SLOTS order), `aWin` (window id, 0 = not
 * glass) and `aPane` (where on its pane, for glass); per house `aPalette`
 * and `aOrigin` (houses.tsx merges them by district). `palette` is linear RGB per palette and slot. Body walls get
 * lap siding, `scales` fish-scale shingles, roofs shingles; the 06:00
 * apartment's `stucco` a soft mottle and its `gravel` roof stones.
 * Glass: a dark room behind it (some with a blind part way down, some with
 * curtains drawn to the sides) under a glossy pane that reflects the city
 * (reflections.ts) by fresnel: the room looking straight in, the street, the
 * houses opposite and the sky at a glancing angle. Until the probe is ready it
 * reflects a painted sky (the horizon is the fog colour).
 * At night about half the windows light up, each as a whole (its id and the house).
 */
export function houseMaterial(siding: Texture, shingles: Texture, palette: Float32Array) {
  const n = SLOTS.length;
  const material = new MeshStandardMaterial({ roughness: 0.82 });
  traceInfo.set(material, { kind: "house", siding, shingles, palette });
  return patch(material, "house", {
    uniforms: { uSiding: { value: siding }, uShingles: { value: shingles }, uPalette: { value: palette }, ...glassUniforms },
    vertHead: "attribute float aSlot;\nattribute float aWin;\nattribute vec2 aPane;\nattribute float aPalette;\nattribute vec2 aOrigin;\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;",
    vert: /* glsl */ `
      vSlot = aSlot;
      vWin = aWin;
      vPane = aPane;
      vPalette = aPalette;
      // One value per house (front and body share their origin), so a window lights up as a whole.
      // Merged houses carry their front-wall origin (houses.tsx); other plain meshes have none (seed 0).
      #ifdef USE_INSTANCING
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vSeed = fract(sin(dot(aOrigin, vec2(12.9898, 78.233))) * 43758.5453);
      #endif`,
    fragHead: `uniform sampler2D uSiding;\nuniform sampler2D uShingles;\nuniform vec3 uPalette[${palette.length / 3}];\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;\nfloat fLit = 0.0;\nfloat fGlassy = 0.0;\nfloat fCloth = 0.0;\n${VALUE_NOISE}\n${GLASS_ENV_GLSL}`,
    color: /* glsl */ `
      int fSlot = int(vSlot + 0.5);
      vec3 fC = uPalette[int(vPalette + 0.5) * ${n} + fSlot];
      // along a wall, horizontally (any wall direction)
      vec2 fT = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
      float fAlong = dot(vFPos.xz, fT);
      bool fUpright = abs(vFNormal.y) < 0.5;
      if (fSlot == ${SLOT.body} && fUpright) {
        fC *= texture2D(uSiding, vec2(fAlong, vFPos.y) / 1.6).rgb * 1.12;
      } else if (fSlot == ${SLOT.scales}) {
        // fish-scale shingles: rows offset by half, round bottoms, a soft shadow line
        vec2 fP = vec2(fAlong, vFPos.y) * 6.0;
        float fRow = floor(fP.y);
        vec2 fQ = vec2(fract(fP.x + 0.5 * mod(fRow, 2.0)) - 0.5, fract(fP.y));
        float fR = length(vec2(fQ.x, fQ.y - 0.5));
        float fAa = fwidth(fR) + 0.02;
        float fRim = fQ.y < 0.5 ? smoothstep(0.5 - fAa * 2.0, 0.5, fR) : 0.0;
        fC *= 1.0 - 0.22 * fRim - 0.06 * fQ.y;
      } else if (fSlot == ${SLOT.stucco}) {
        // troweled stucco: a soft mottle, never a pattern
        vec2 fS = fUpright ? vec2(fAlong, vFPos.y) : vFPos.xz;
        fC *= 0.95 + 0.07 * fVNoise(fS * 3.0) + 0.04 * fVNoise(fS * 11.0);
      } else if (fSlot == ${SLOT.gravel}) {
        // tar and gravel: stones up close (gone once a pixel covers them), weathered patches
        vec2 fS = vFPos.xz;
        float fFine = 1.0 - smoothstep(0.012, 0.04, length(fwidth(fS)));
        float fStones = 0.6 * fVNoise(fS * 40.0) + 0.4 * fVNoise(fS * 97.0);
        fC *= (0.86 + 0.26 * fVNoise(fS * 1.3)) * mix(1.0, 0.62 + 0.76 * fStones, fFine);
      } else if (fSlot == ${SLOT.roof}) {
        // rows run along the slope, stacked up it
        vec2 fUv = vec2(fAlong, vFPos.y / max(0.3, length(vFNormal.xz))) / 1.3;
        fC = texture2D(uShingles, fUv).rgb * mix(vec3(1.0), fC, 0.6) * 1.1;
      } else if (fSlot == ${SLOT.glass}) {
        fGlassy = 1.0;
        fLit = step(0.5, fHash(vec2(vWin, vSeed * 31.0)));
        float fRoom = fHash(vec2(vWin * 1.7 + 3.0, vSeed * 17.0));
        vec2 fAa = fwidth(vPane) * 1.5 + 1e-4;
        // the room: dark, the ceiling a little lighter
        fC *= 0.8 + 0.9 * vPane.y;
        // a blind pulled part way down, or curtains drawn to both sides, or nothing
        float fDrop = 1.0 - (0.16 + 0.3 * fract(fRoom * 7.31));
        float fBlind = step(0.62, fRoom) * smoothstep(fDrop - fAa.y, fDrop + fAa.y, vPane.y);
        float fSide = min(vPane.x, 1.0 - vPane.x);
        float fCurt = step(fRoom, 0.34) * (1.0 - smoothstep(0.15 - fAa.x, 0.15 + fAa.x, fSide));
        fC = mix(fC, vec3(0.62, 0.58, 0.5), fBlind);
        fC = mix(fC, mix(vec3(0.55, 0.47, 0.4), vec3(0.6, 0.6, 0.56), step(0.17, fRoom)), fCurt);
        fCloth = max(fBlind, fCurt);
      }
      diffuseColor.rgb = fC;`,
    roughness: "roughnessFactor = mix(roughnessFactor, 0.1, fGlassy);",
    // glass reflects the city (below), not the studio environment
    lights: "radiance *= 1.0 - fGlassy * uGlassMix;",
    emissive: /* glsl */ `
      if (fGlassy > 0.5) {
        vec3 fV = normalize(vFPos - cameraPosition);
        vec3 fN = normalize(vFNormal);
        vec3 fRf = reflect(fV, fN);
        #ifdef USE_FOG
          vec3 fHor = fogColor;
        #else
          vec3 fHor = vec3(0.85, 0.86, 0.88);
        #endif
        vec3 fZen = mix(vec3(0.32, 0.48, 0.78), vec3(0.02, 0.03, 0.06), uNight);
        // the sky, bluer away from the horizon (looking down at a window, the
        // houses opposite and the street show a little darker)
        vec3 fSky = mix(fHor, fZen, smoothstep(0.0, 0.6, abs(fRf.y))) * (fRf.y > 0.0 ? 1.0 : 0.75);
        float fFres = 0.1 + 0.8 * pow(1.0 - abs(dot(fV, fN)), 1.2);
        totalEmissiveRadiance += glassEnv(vFPos, fRf, fSky) * fFres * (1.0 - 0.6 * fCloth * uNight);
      }
      totalEmissiveRadiance += vec3(1.0, 0.7, 0.38) * fLit * uNight * (1.1 + 0.5 * fCloth);`,
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

/**
 * Downtown towers (towers.tsx): one material for the whole skyline. Vertex
 * colour is the tint; `aUv` counts columns and storeys on each wall; `aInfo`
 * is (part, per-tower seed, floodlight height or 0). Parts (PART in towers.tsx):
 * 0 curtain wall (mullions, a spandrel at each floor, panes that differ a
 * little), 1 tar-and-gravel roof, 2 shop fronts (middle bay is the entrance),
 * 3 plain, 4 metal, 5 aluminium cladding, 6 and 8 a punched window pane (`aUv`
 * is its column and storey plus where on the pane: a one-over-one sash or a
 * steel factory window), 7 masonry (stone grain from the stone texture, tinted:
 * limestone, terracotta, brick). Flat tops of parts 0 to 2 are roofs. At night
 * whole floors are busy or quiet and lit windows come in runs (offices cooler,
 * shops warmer); floodlit crowns get a warm wash that fades upward.
 * All glass (curtain wall panes, punched windows, shop fronts) reflects the
 * city from the probe (reflections.ts) by fresnel; curtain walls are coated,
 * so they reflect more head-on than plain windows.
 */
export function downtownMaterial(stone: Texture) {
  return patch(new MeshStandardMaterial({ vertexColors: true }), "downtown", {
    uniforms: { uStone: { value: stone }, ...glassUniforms },
    // vInfo is flat: interpolating a constant is not exact on every GPU (SwiftShader), and the window
    // hashes amplify the tiniest error into per-pixel speckle.
    vertHead: "attribute vec2 aUv;\nattribute vec3 aInfo;\nvarying vec2 vTUv;\nflat varying vec3 vInfo;",
    vert: "vTUv = aUv;\nvInfo = aInfo;",
    fragHead: /* glsl */ `
      uniform sampler2D uStone;
      varying vec2 vTUv;
      flat varying vec3 vInfo;
      float fLit = 0.0;
      vec3 fLitC = vec3(1.0, 0.8, 0.52);
      float fRough = 0.85;
      float fMetal = 0.0;
      float fGl = 0.0;  // how much of this pixel is glass
      float fGlF0 = 0.06; // its head-on reflectance
      ${GLASS_ENV_GLSL}
      // 1 near the grid lines of x (half width w, in cells), anti-aliased; the average once cells shrink under a pixel.
      float fLine(float x, float w) {
        float aa = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        return mix(1.0 - smoothstep(w - aa, w + aa, d), 2.0 * w, smoothstep(0.2, 0.5, aa));
      }`,
    color: /* glsl */ `
      float fPart = floor(vInfo.x + 0.5);
      vec3 fTint = diffuseColor.rgb;
      // Which way the wall faces (-1, 0 or 1 per axis), well clear of floor()'s steps: at an exact step
      // (a normal of -1 scaled by 1.5, plus 0.5) interpolation error flips it per pixel, and every hash below speckles.
      float fFace = dot(floor(vFNormal.xz + 0.5), vec2(3.0, 7.0));
      vec2 fCell = floor(vTUv);
      vec2 fKey = vec2(fFace * 17.0 + vInfo.y * 113.0, fFace * 5.0 + vInfo.y * 31.0);
      float fRnd = fHash(fCell + fKey);
      if (abs(vFNormal.y) > 0.97 && fPart < 2.5) {
        // Flat roofs (and soffits): tar and gravel.
        diffuseColor.rgb = mix(fTint, vec3(0.2, 0.195, 0.185), 0.7);
      } else if (fPart < 0.5) {
        float fM = fLine(vTUv.x, 0.045);
        // Half the towers have deep spandrel bands, half read as nearly all glass.
        float fS = fLine(vTUv.y, mix(0.04, 0.11, step(0.5, vInfo.y)));
        float fPane = (1.0 - fM) * (1.0 - fS);
        vec3 fGlassC = fTint * (0.62 + 0.12 * fRnd);
        diffuseColor.rgb = mix(mix(fGlassC, fTint * 0.3, fS), vec3(0.5, 0.52, 0.54), fM);
        fRough = mix(0.5, 0.14, fPane);
        fMetal = mix(0.4, 0.2, fPane);
        fGl = fPane;
        fGlF0 = 0.16;
        // Offices: each floor is busy or quiet; lit panes come in runs of four, dimmer and cooler than homes, never on a sloped top.
        float fBusy = fHash(vec2(fCell.y, vInfo.y * 57.0) + fFace);
        float fOn = step(fHash(vec2(floor(vTUv.x / 4.0), fCell.y) + fKey), fBusy * 0.6);
        fLit = fPane * fOn * (0.18 + 0.1 * fRnd) * step(abs(vFNormal.y), 0.3);
        fLitC = vec3(1.0, 0.88, 0.7);
      } else if (fPart < 1.5) {
        // the hidden wall behind punched windows
        diffuseColor.rgb = fTint * 0.4;
      } else if (fPart < 2.5) {
        // Ground floor: plinth, stone piers between glazed bays, a bronze frame and transom, a sign band over them.
        // The middle bay (column 0) is the entrance: a lighter surround and glass doors up into the sign band.
        float fY = vTUv.y;
        float fDoor = 1.0 - step(0.5, abs(fCell.x));
        float fGlz = smoothstep(0.08, 0.1, fY) * (1.0 - smoothstep(0.72 + 0.12 * fDoor, 0.74 + 0.12 * fDoor, fY)) * (1.0 - fLine(vTUv.x, 0.07 + 0.08 * fDoor));
        fTint *= 1.0 + 0.3 * fDoor;
        float fFrame = fGlz * max(fLine(vTUv.x, 0.1), max(fLine((fY - 0.09) * 6.0, 0.08) * step(fY, 0.2), fLine((fY - 0.56) * 6.0, 0.06) * step(0.5, fY)));
        vec3 fShop = mix(vec3(0.035, 0.038, 0.042), vec3(0.11, 0.09, 0.07), fRnd * smoothstep(0.7, 0.2, fY)) + vec3(0.05, 0.06, 0.07) * smoothstep(0.35, 0.72, fY);
        diffuseColor.rgb = mix(mix(fTint, fShop, fGlz), vec3(0.08, 0.065, 0.05), fFrame);
        fRough = mix(0.75, 0.06, fGlz - fFrame);
        fMetal = 0.45 * (fGlz - fFrame);
        fGl = fGlz - fFrame;
        fLit = (fGlz - fFrame) * step(0.45, fRnd) * (0.2 + 0.2 * smoothstep(0.1, 0.6, fY));
      } else if (fPart > 6.5 && fPart < 7.5) {
        // Masonry: the stone grain of a window-free strip of the stone texture (stacked blocks about
        // 0.36 by 0.34), tinted. Walls by (along, height), sills and caps by (x, z).
        vec2 fT2 = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
        vec2 fS = abs(vFNormal.y) > 0.5 ? vFPos.xz : vec2(dot(vFPos.xz, fT2), vFPos.y);
        vec2 fQ = vec2(fS.x / 0.36 * 0.1, fS.y / 5.0);
        vec3 fF = textureGrad(uStone, vec2(0.45 + mod(fQ.x, 0.1), fQ.y), dFdx(fQ), dFdy(fQ)).rgb;
        diffuseColor.rgb = fTint * fLuma(fF) / 0.68;
      } else if (fPart > 5.5) {
        // A punched window pane: a frame and a meeting rail (sash) or a grid of muntins (steel), dark glass
        // with a room behind; some offices have a blind part way down.
        bool fSteel = fPart > 7.5;
        vec2 fP = fract(vTUv);
        // bars on whole numbers of the unwrapped coordinate (the frame is on the pane's edges): its derivatives never jump
        vec2 fG = vTUv * (fSteel ? vec2(3.0, 4.0) : vec2(1.0, 2.0));
        float fBar = max(fLine(fG.x, fSteel ? 0.05 : 0.07), fLine(fG.y, fSteel ? 0.05 : 0.045));
        float fDrop = 1.0 - (0.15 + 0.35 * fract(fRnd * 7.31));
        float fAa = fwidth(vTUv.y) + 0.005;
        float fBlind = step(fSteel ? 2.0 : 0.75, fRnd) * smoothstep(fDrop - fAa, fDrop + fAa, fP.y) * (1.0 - fBar);
        vec3 fRoom = fTint * (0.5 + 0.3 * fRnd) * (0.75 + 0.5 * fP.y);
        vec3 fFrame = fSteel ? vec3(0.035, 0.04, 0.045) : vec3(0.07, 0.055, 0.04);
        diffuseColor.rgb = mix(mix(fRoom, vec3(0.4, 0.38, 0.34), fBlind), fFrame, fBar);
        fGl = (1.0 - fBar) * (1.0 - fBlind);
        fRough = mix(0.6, 0.12, fGl);
        fMetal = fSteel ? 0.3 * fBar : 0.0;
        // Whole floors are busy or quiet; lit windows come in runs of three.
        float fBusy = fHash(vec2(fCell.y, vInfo.y * 57.0) + fFace);
        float fOn = step(fHash(vec2(floor(fCell.x / 3.0), fCell.y) + fKey), fBusy * 0.8);
        fLit = (1.0 - fBar) * fOn * (0.7 + 0.3 * fRnd);
      } else if (fPart > 4.5) {
        // Brushed aluminium cladding (the Pyramid's crown): light, only a little metallic, so it never goes dark.
        fRough = 0.5;
        fMetal = 0.15;
      } else if (fPart > 3.5) {
        fRough = 0.4;
        fMetal = 0.6;
      }`,
    emissive: /* glsl */ `
      roughnessFactor = fRough;
      metalnessFactor = fMetal;
      float fFl = vInfo.z > 0.5 ? smoothstep(vInfo.z, vInfo.z + 0.6, vFPos.y) * (1.0 - 0.45 * smoothstep(vInfo.z, vInfo.z + 5.0, vFPos.y)) : 0.0;
      fFl *= abs(fPart - 5.0) < 0.5 ? 0.4 : 1.0; // aluminium is pale: a softer wash keeps it calm
      if (fGl > 0.0) {
        vec3 fV = normalize(vFPos - cameraPosition);
        vec3 fN = normalize(vFNormal);
        // capped: set-back panes are shaded by their frames at a glancing angle
        float fF = min(0.5, fGlF0 + (1.0 - fGlF0) * pow(1.0 - abs(dot(fV, fN)), 5.0));
        totalEmissiveRadiance += glassEnv(vFPos, reflect(fV, fN), vec3(0.0)) * fF * fGl;
      }
      totalEmissiveRadiance += (fLitC * fLit * 1.4 + diffuseColor.rgb * vec3(1.0, 0.8, 0.58) * fFl * 0.85) * uNight;`,
    // once the probe is ready, glass reflects the city instead of the studio environment
    lights: "radiance *= 1.0 - fGl * uGlassMix;",
  });
}

/**
 * The ground: the street map (mask: R asphalt, G sidewalk, B grass, white =
 * lane marks, black = plain block ground) blended with detail textures.
 * Lawns come from lawn.ts (shared with the grass blades): muted green, gold
 * on the sunny faces of wild slopes (`dry`, the headlands texture), trails,
 * a darker edge at the kerb, and gullies bent into the normals.
 */
export function groundMaterial(mask: Texture, light: Texture, asphalt: Texture, concrete: Texture, grass: Texture, dry: Texture) {
  const material = new MeshStandardMaterial({ map: mask, roughness: 0.95 });
  traceInfo.set(material, { kind: "ground", mask });
  return patch(material, "ground", {
    uniforms: { uLamp: { value: light }, uAsphalt: { value: asphalt }, uConcrete: { value: concrete }, uGrass: { value: grass }, uDry: { value: dry }, uLawn: { value: lawnTexture() } },
    fragHead: /* glsl */ `
      uniform sampler2D uLamp;
      uniform sampler2D uAsphalt;
      uniform sampler2D uConcrete;
      uniform sampler2D uGrass;
      uniform sampler2D uDry;
      float fNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), f.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + 1.0), f.x), f.y);
      }
      ${LAWN_GLSL}`,
    color: /* glsl */ `
      vec3 fM = diffuseColor.rgb;
      // Paint is white in the mask, so its share is the smallest channel and the rest is what it lies on
      // (the filtered edge of a bar on asphalt is (1, p, p): paint p, asphalt 1 - p, never a grey halo).
      float fP = min(fM.r, min(fM.g, fM.b));
      fM = (fM - fP) / max(1.0 - fP, 1e-3);
      // Crisp edges up close (the mask sharpened to a screen pixel); far off, where a mask texel is
      // smaller than a pixel, its plain filtered coverage, so thin marks never shimmer.
      float fTexel = length(fwidth(vFPos.xz)) * 16.0;
      float fMark = mix(clamp((fP - 0.5) / max(fwidth(fP), 1e-3) + 0.5, 0.0, 1.0), fP, smoothstep(0.7, 1.6, fTexel));
      vec3 fAsphalt = texture2D(uAsphalt, vFPos.xz / 6.0).rgb;
      vec3 fConcrete = texture2D(uConcrete, vFPos.xz / 3.0).rgb;
      vec3 fBlock = fConcrete * vec3(0.86, 0.82, 0.76);
      // Lawn (lawn.ts): colour by wildness, sun, gullies and the kerb; worn trails with soft, wobbly edges,
      // packed dirt on the wild hills and fine gravel in the gardens.
      vec4 fLawn = texture2D(uLawn, lawnUv(vFPos.xz));
      vec3 fDry = texture2D(uDry, vFPos.xz / 8.0, 1.5).rgb; // a little blurred: its fine trails read as cracks up close
      vec3 fGrass = lawnColor(vFPos.xz, fLawn, vFNormal, lawnGreen(vFPos.xz), fDry);
      float fTrail = smoothstep(0.3, 0.7, fLawn.r + (fNoise(vFPos.xz * 2.3) - 0.5) * 0.35);
      vec3 fPath = mix(vec3(0.5, 0.46, 0.38), vec3(0.46, 0.37, 0.26), fLawn.g) * (0.82 + 0.3 * fNoise(vFPos.xz * 11.0)) * (0.92 + 0.16 * fNoise(vFPos.xz * 2.7));
      fGrass = mix(fGrass, fPath, fTrail);
      vec3 fBase = fAsphalt * fM.r + fConcrete * fM.g + fGrass * fM.b + fBlock * clamp(1.0 - fM.r - fM.g - fM.b, 0.0, 1.0);
      // Matte off-white road paint, worn thin in patches; the asphalt's grain shows through it.
      float fWear = smoothstep(0.45, 0.9, fNoise(vFPos.xz * 2.6)) * 0.4 + (fNoise(vFPos.xz * 9.0) - 0.5) * 0.3 * (1.0 - smoothstep(0.6, 1.6, fTexel));
      vec3 fPaint = vec3(0.6, 0.59, 0.55) * (0.8 + 0.6 * fLuma(fAsphalt));
      diffuseColor.rgb = mix(fBase, fPaint, fMark * (1.0 - fWear));`,
    roughness: "roughnessFactor = mix(roughnessFactor, 0.8, fM.r);",
    // The street lamps' light pools at night (lampLight in textures.ts).
    emissive: "totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.76, 0.48) * texture2D(uLamp, vMapUv).r * uNight * 1.3;",
    // Lawn relief: gullies down the hills, and fine clumps up close (gone once a pixel covers them).
    normal: /* glsl */ `
      if (fM.b > 0.01) {
        vec2 fSlope = lawnGullySlope(vFPos.xz) * 0.5 * (1.0 - 0.6 * fTrail);
        float fFine = 1.0 - smoothstep(0.02, 0.08, length(fwidth(vFPos.xz)));
        float fC = lNoise(vFPos.xz * 6.0);
        fSlope += vec2(lNoise(vFPos.xz * 6.0 + vec2(0.3, 0.0)) - fC, lNoise(vFPos.xz * 6.0 + vec2(0.0, 0.3)) - fC) * 0.3 * fFine;
        normal = normalize(normal - (viewMatrix * vec4(fSlope.x, 0.0, fSlope.y, 0.0)).xyz * fM.b);
      }`,
  });
}

/** Any texture mapped in world units: walls by (along, height), tops by (x, z). */
export function worldMaterial(map: Texture, scale: number, top?: string) {
  const material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 });
  traceInfo.set(material, { kind: "world", map, scale, top });
  return patch(material, `world-${top ?? "same"}`, {
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

/**
 * The bridges' concrete (anchorages, pylons, piers, walls, the tunnel portal),
 * in world units: pours 1.2 tall and panels 2.4 wide with fine joints, the
 * concrete texture's grain inside each panel (its own slab joints fall on
 * ours), form-tie dots up close, a soft mottle, rain streaks hanging from the
 * ledge above (vertex attribute `aTop`, roads.ts), grime up from the water and
 * a dark, glossier wet band at `waterline`.
 */
export function concreteMaterial(map: Texture, waterline: number) {
  const material = new MeshStandardMaterial({ color: "#b4aea3", roughness: 0.9 });
  traceInfo.set(material, { kind: "concrete", map, color: material.color });
  return patch(material, "concrete", {
    uniforms: { uConcrete: { value: map }, uWater: { value: waterline } },
    vertHead: "attribute float aTop;\nvarying float vTop;",
    vert: "vTop = aTop;",
    fragHead: /* glsl */ `
      uniform sampler2D uConcrete;
      uniform float uWater;
      varying float vTop;
      float fWet = 0.0;
      ${VALUE_NOISE}
      // 1 near the grid lines of x (half width w, in cells), anti-aliased; the average once cells shrink under a pixel.
      float fJoint(float x, float w) {
        float aa = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        return mix(1.0 - smoothstep(w - aa, w + aa, d), 2.0 * w, smoothstep(0.2, 0.5, aa));
      }`,
    color: /* glsl */ `
      float fUp = 1.0 - step(0.5, abs(vFNormal.y));
      vec2 fT2 = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
      vec2 fS = fUp > 0.5 ? vec2(dot(vFPos.xz, fT2), vFPos.y) : vFPos.xz;
      vec2 fQ = fS / 2.4;
      vec3 fTex = textureGrad(uConcrete, 0.04 + 0.92 * fract(fQ), dFdx(fQ) * 0.92, dFdy(fQ) * 0.92).rgb;
      float fGrain = mix(1.0, fLuma(fTex) / 0.26, 0.5);
      float fMottle = (0.9 + 0.14 * fVNoise(fS * 0.45 + 7.0)) * (0.96 + 0.08 * fVNoise(fS * 2.1));
      float fJ = max(fJoint(fS.y / (fUp > 0.5 ? 1.2 : 2.4), 0.012), fJoint(fQ.x, 0.006));
      vec2 fTie = (fract(fS / vec2(0.6, 0.4)) - 0.5) * vec2(0.6, 0.4);
      float fNear = 1.0 - smoothstep(0.004, 0.015, length(fwidth(fS)));
      float fDot = fUp * fNear * (1.0 - smoothstep(0.014, 0.022, length(fTie)));
      float fBelow = vTop - vFPos.y;
      float fStreak = fUp * step(0.0, fBelow) * exp(-fBelow / 1.6) * smoothstep(0.0, 0.1, fBelow)
        * smoothstep(0.4, 0.85, fVNoise(vec2(fS.x * 6.0, fS.y * 0.3))) * (0.5 + 0.5 * fVNoise(vec2(fS.x * 0.9, 3.7)));
      float fH = vFPos.y - uWater;
      float fGrime = smoothstep(1.8, 0.0, fH) * (0.75 + 0.25 * fVNoise(fS * vec2(3.0, 0.8)));
      fWet = smoothstep(0.32 + 0.08 * fVNoise(vec2(fS.x * 2.0, 0.0)), 0.12, fH);
      vec3 fC = diffuseColor.rgb * fGrain * fMottle;
      fC *= 1.0 - 0.32 * fJ - 0.35 * fDot - 0.28 * fStreak - 0.18 * fGrime;
      fC = mix(fC, fC * vec3(0.42, 0.45, 0.4), fWet);
      diffuseColor.rgb = fC * (1.0 + 0.05 * step(0.5, vFNormal.y));`,
    roughness: "roughnessFactor = mix(roughnessFactor, 0.35, fWet);",
  });
}

/**
 * Clear shop glass (the café, the taqueria, Union Square's showcases, the
 * Ferry arcade, Coit Tower): the room behind shows straight on, with no tint; at a glancing
 * angle the pane mirrors the street (the city probe, reflections.ts) by
 * fresnel, as real shop windows do. Black and lit only by its reflection, so
 * blending gives the room behind x (1 - F) + reflection x F; the studio environment is off.
 */
export function glassMaterial() {
  const m = new MeshStandardMaterial({ color: "#000000", roughness: 0.05, envMapIntensity: 0, transparent: true, depthWrite: false });
  m.customProgramCacheKey = () => "shop-glass";
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, { uNight: facadeNight, ...glassUniforms });
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGPos;\nvarying vec3 vGNrm;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGNrm = normalize(mat3(modelMatrix) * objectNormal);");
    s.fragmentShader = s.fragmentShader.replace("#include <common>", `#include <common>\nuniform float uNight;\nvarying vec3 vGPos;\nvarying vec3 vGNrm;\n${GLASS_ENV_GLSL}`).replace(
      "#include <emissivemap_fragment>",
      /* glsl */ `
      vec3 gV = normalize(vGPos - cameraPosition);
      vec3 gN = normalize(vGNrm);
      vec3 gR = reflect(gV, gN);
      #ifdef USE_FOG
        vec3 gHor = fogColor;
      #else
        vec3 gHor = vec3(0.85, 0.86, 0.88);
      #endif
      vec3 gZen = mix(vec3(0.32, 0.48, 0.78), vec3(0.02, 0.03, 0.06), uNight);
      vec3 gSky = mix(gHor, gZen, smoothstep(0.0, 0.6, abs(gR.y))) * (gR.y > 0.0 ? 1.0 : 0.75);
      totalEmissiveRadiance = glassEnv(vGPos, gR, gSky);
      diffuseColor.a = min(0.9, 0.03 + 0.97 * pow(1.0 - abs(dot(gV, gN)), 5.0));`,
    );
  };
  return m;
}
