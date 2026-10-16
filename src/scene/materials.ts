// Textured materials for the city (art pass 3). Textures are generated
// (design/prompts/textures) and live in public/textures. Shader patches on
// MeshStandardMaterial map them in world units so nothing stretches, and light
// windows at night from the dark glass in each texture.

import { MeshStandardMaterial, type Texture } from "three";
import { FACADE_GLSL, facadeNight } from "./facade";
import { EDGE, POSTER, SLOT, SLOTS, VINYL } from "./house-models";
import { LAWN_GLSL, lawnTexture } from "./lawn";
import { GLASS_ENV_GLSL, glassUniforms } from "./reflections";
import { GROUND_GLSL, TONE, WEATHER_GLSL, weather, type Weather } from "./weathering";

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

function patch(material: MeshStandardMaterial, key: string, opts: { uniforms: Record<string, { value: unknown }>; vertHead?: string; vert?: string; fragHead: string; color: string; emissive?: string; roughness?: string; metalness?: string; normal?: string; lights?: string; weather?: Weather }) {
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uNight: facadeNight, ...opts.uniforms }, opts.weather && { uWeather: { value: opts.weather.amount } });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vFPos;\nvarying vec3 vFNormal;\n${opts.vertHead ?? ""}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${COMMON_VERT}\n${opts.vert ?? ""}`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${COMMON_FRAG}\n${opts.fragHead}${opts.weather ? `\n${GROUND_GLSL}\n${WEATHER_GLSL}` : ""}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${opts.color}\n${opts.weather?.glsl ?? ""}`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${opts.roughness ?? ""}`)
      .replace("#include <metalnessmap_fragment>", `#include <metalnessmap_fragment>\n${opts.metalness ?? ""}`)
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
 * Surface detail for the house kit (needs VALUE_NOISE, and fPx set to a pixel's size in world units):
 * value noise with its gradient (x: value, yz: d/dp), and `fNear(k)`, 1 while noise of k cells per unit
 * is bigger than a couple of pixels and 0 once it would only shimmer.
 */
const DETAIL_GLSL = /* glsl */ `
  float fPx = 0.0;
  vec3 fVNoiseD(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    vec2 du = 6.0 * f * (1.0 - f);
    float a = fHash(i);
    float b = fHash(i + vec2(1.0, 0.0));
    float c = fHash(i + vec2(0.0, 1.0));
    float d = fHash(i + 1.0);
    float k = a - b - c + d;
    return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * (vec2(b - a, c - a) + k * u.yx));
  }
  float fNear(float k) { return 1.0 - smoothstep(0.3, 0.7, fPx * k); }`;

/**
 * The bevel (EDGE in house-models.ts): vEdge + EDGE.off is the distance to each of the face's edges.
 * Within the bevel of one, the normal leans toward it, 45 degrees at the edge itself, so every real
 * edge catches the light like a rounded one; gone once the bevel is under a pixel. The edge's direction
 * comes from the distances' screen derivatives (exact on a flat face). Adds to fBendW (world space).
 */
const BEVEL_GLSL = /* glsl */ `{
    vec3 fNw = normalize(vFNormal);
    vec3 fDpx = dFdx(vFPos);
    vec3 fDpy = dFdy(vFPos);
    vec3 fR1 = cross(fDpy, fNw);
    vec3 fR2 = cross(fNw, fDpx);
    float fDet = dot(fDpx, fR1);
    vec4 fE = vEdge + ${EDGE.off.toFixed(1)};
    vec4 fB = max(1.0 - fE / ${EDGE.bevel}, 0.0) * (1.0 - smoothstep(${EDGE.bevel * 0.5}, ${EDGE.bevel * 2}, fPx));
    vec3 fOut = -(fR1 * dot(dFdx(fE), fB) + fR2 * dot(dFdy(fE), fB)) * fDet / max(fDet * fDet, 1e-24);
    fBendW += fOut / max(1.0, length(fOut) / 1.4);
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
  return patch(material, "house", {
    uniforms: { uSiding: { value: siding }, uShingles: { value: shingles }, uPalette: { value: palette }, ...glassUniforms },
    vertHead: "attribute float aSlot;\nattribute float aWin;\nattribute vec2 aPane;\nattribute float aPalette;\nattribute vec2 aOrigin;\nattribute vec4 aEdge;\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;\nvarying vec4 vEdge;",
    vert: /* glsl */ `
      vSlot = aSlot;
      vEdge = aEdge;
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
    fragHead: `uniform sampler2D uSiding;\nuniform sampler2D uShingles;\nuniform vec3 uPalette[${palette.length / 3}];\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;\nvarying vec4 vEdge;\nfloat fLit = 0.0;\nfloat fGlassy = 0.0;\nfloat fCloth = 0.0;\nfloat fClean = 0.0;\nfloat fRoughK = -1.0;\nfloat fMetalK = 0.0;\nvec3 fGlowK = vec3(0.0);\nvec3 fBendW = vec3(0.0);\n${VALUE_NOISE}\n${DETAIL_GLSL}\n${GLASS_ENV_GLSL}`,
    color: /* glsl */ `
      int fSlot = int(vSlot + 0.5);
      vec3 fC = uPalette[int(vPalette + 0.5) * ${n} + fSlot];
      fPx = length(fwidth(vFPos));
      // along a wall, horizontally (any wall direction)
      vec2 fT = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
      float fAlong = dot(vFPos.xz, fT);
      bool fUpright = abs(vFNormal.y) < 0.5;
      // the face's own 2D coordinates (walls: along and up; tops: x and z) and their world directions
      vec2 fS = fUpright ? vec2(fAlong, vFPos.y) : vFPos.xz;
      vec3 fAx = fUpright ? vec3(fT.x, 0.0, fT.y) : vec3(1.0, 0.0, 0.0);
      vec3 fAy = fUpright ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
      if (fSlot == ${SLOT.body} && fUpright) {
        fC *= texture2D(uSiding, vec2(fAlong, vFPos.y) / 1.6).rgb * 1.12;
        // satin house paint, chalkier in patches
        fRoughK = 0.66 + 0.16 * fVNoise(fS * 1.3 + vSeed * 40.0);
      } else if (fSlot >= ${SLOT.trim} && fSlot <= ${SLOT.door}) {
        // gloss trim paint, dulled where weather and hands wear it
        float fWear = smoothstep(0.35, 0.85, fVNoise(fS * 2.3 + vSeed * 40.0));
        fRoughK = 0.42 + 0.3 * fWear;
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
        // troweled stucco: a soft mottle, never a pattern; trowel swirls and sand grain in relief
        // (they show in a raking sun), rougher where the sand stands out
        vec3 fTr = fVNoiseD(fS * 7.0 + 3.0);
        vec3 fSand = fVNoiseD(fS * 90.0);
        fC *= 0.95 + 0.07 * fVNoise(fS * 3.0) + 0.04 * fVNoise(fS * 11.0) + 0.05 * (fSand.x - 0.5) * fNear(90.0);
        vec2 fG = fTr.yz * 0.06 * fNear(7.0) + fSand.yz * 0.06 * fNear(90.0);
        fBendW = -(fG.x * fAx + fG.y * fAy);
        fRoughK = 0.84 + 0.1 * fTr.x;
      } else if (fSlot == ${SLOT.stone}) {
        // cast stone: a soft mottle, pits of the aggregate, edges a little chipped and dirtier
        // pits: a round hole in about one cell in four (cells turned, so they never line up with the edges)
        mat2 fRot = mat2(0.8, -0.6, 0.6, 0.8);
        vec2 fSp = fRot * fS;
        vec2 fPc = floor(fSp * 140.0);
        vec2 fPd = fract(fSp * 140.0) - 0.5 - (vec2(fHash(fPc + 3.0), fHash(fPc + 7.0)) - 0.5) * 0.4;
        float fPr = 0.12 + 0.18 * fHash(fPc + 13.0);
        float fPits = step(0.74, fHash(fPc)) * (1.0 - smoothstep(fPr * 0.5, fPr, length(fPd))) * fNear(140.0);
        float fEdge = min(min(vEdge.x, vEdge.y), min(vEdge.z, vEdge.w)) + ${EDGE.off.toFixed(1)};
        float fChip = (1.0 - smoothstep(0.004, 0.025, fEdge)) * smoothstep(0.6, 0.8, fVNoise(fSp * 24.0)) * fNear(24.0);
        fC *= (0.95 + 0.06 * fVNoise(fS * 2.2) + 0.04 * fVNoise(fSp * 9.0)) * (1.0 - 0.35 * fPits) * (1.0 - 0.14 * fChip);
        // each pit's sides lean in toward its middle
        vec2 fIn2 = -(fPd * fRot) / max(fPr, 1e-3) * fPits;
        fBendW = (fIn2.x * fAx + fIn2.y * fAy) * 0.6;
        fRoughK = 0.7 + 0.12 * fVNoise(fSp * 5.0) + 0.12 * fPits;
      } else if (fSlot == ${SLOT.gravel}) {
        // tar and gravel: rounded stones up close, each its own tone, tar between them (gone once a
        // pixel covers them), weathered patches
        vec2 fG2 = vFPos.xz * 55.0;
        vec2 fCi = floor(fG2);
        vec2 fF = fract(fG2);
        float fD1 = 8.0;
        vec2 fTo = vec2(0.0);
        vec2 fCell = fCi;
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 fO = vec2(float(i), float(j));
            vec2 fR = fO + 0.2 + 0.6 * vec2(fHash(fCi + fO), fHash(fCi + fO + 17.0)) - fF;
            float fDd = dot(fR, fR);
            if (fDd < fD1) { fD1 = fDd; fTo = fR; fCell = fCi + fO; }
          }
        }
        float fFine = fNear(55.0);
        // further off, a speckle until that too is under a pixel
        float fSpeck = mix(1.0, 0.62 + 0.76 * (0.6 * fVNoise(vFPos.xz * 40.0) + 0.4 * fVNoise(vFPos.xz * 97.0)), 1.0 - smoothstep(0.012, 0.04, fPx));
        float fH = fHash(fCell + 5.0);
        float fStone = 1.0 - smoothstep(0.36, 0.52, sqrt(fD1));
        float fH2 = fHash(fCell + 9.0);
        // grey, tan and the odd dark stone
        vec3 fPebble = (fH2 < 0.45 ? vec3(0.86, 0.85, 0.83) : (fH2 < 0.85 ? vec3(1.1, 1.0, 0.86) : vec3(0.55, 0.53, 0.5))) * (0.82 + 0.36 * fH);
        fC *= (0.86 + 0.26 * fVNoise(vFPos.xz * 1.3)) * mix(vec3(fSpeck), mix(vec3(0.5), fPebble, fStone), fFine);
        fBendW = -vec3(fTo.x, 0.0, fTo.y) * 1.6 * fStone * fFine;
        fRoughK = mix(0.92, mix(0.7, 0.88, fH), fStone * fFine);
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
        fClean = 1.0;
      } else if (fSlot == ${SLOT.poster}) {
        // a photo print with a white border (aPane: its column and row on the photo sheet, plus where on
        // the print), wheatpasted: wrinkles and bubbles, paper fibres, a satin sheen where the paste shows
        vec2 fCellP = floor(vPane);
        vec2 fL = (fract(vPane) - 0.05) / 0.9;
        vec2 fAaP = fwidth(fL) + 1e-4;
        vec2 fIn = smoothstep(${POSTER.border} - fAaP, ${POSTER.border} + fAaP, fL) * smoothstep(${POSTER.border} - fAaP, ${POSTER.border} + fAaP, 1.0 - fL);
        vec2 fUv = vec2(fCellP.x * 0.25 + 0.005, fCellP.y / 3.0 + 0.006) + clamp((fL - ${POSTER.border}) / ${1 - 2 * POSTER.border}, 0.0, 1.0) * vec2(0.24, 0.32);
        fC = mix(fC, texture2D(uShingles, fUv).rgb, fIn.x * fIn.y);
        vec3 fW = fVNoiseD(fS * 3.0 + 7.0);
        vec3 fW2 = fVNoiseD(fS * 13.0 + 3.0);
        fBendW = -((fW.y * fAx + fW.z * fAy) * 0.09 * fNear(3.0) + (fW2.y * fAx + fW2.z * fAy) * 0.05 * fNear(13.0));
        fC *= 0.98 + 0.04 * mix(fVNoise(fS * 240.0), 0.5, 1.0 - fNear(240.0));
        fRoughK = 0.68 - 0.18 * smoothstep(0.45, 0.8, fW.x);
        fGlowK = vec3(1.0, 0.9, 0.77) * 0.35 * uNight;
        fClean = 0.7;
      } else if (fSlot == ${SLOT.vinyl}) {
        // the billboard's printed face (aPane: 0..1 across it), pasted in sheets: hairline seams, each
        // sheet's overlap a touch lighter, the paper a little wavy, a satin sheen
        fC = texture2D(uShingles, vPane).rgb;
        vec2 fM = vPane * vec2(${VINYL.w}, ${VINYL.h});
        vec2 fQ = vPane * vec2(${VINYL.sheets[0]}.0, ${VINYL.sheets[1]}.0);
        vec2 fSd = abs(fract(fQ + 0.5) - 0.5) * vec2(${VINYL.w / VINYL.sheets[0]}, ${VINYL.h / VINYL.sheets[1]});
        float fSeam = max(1.0 - smoothstep(0.0012, 0.0012 + fPx, fSd.x), 1.0 - smoothstep(0.0012, 0.0012 + fPx, fSd.y));
        float fLap = max(1.0 - smoothstep(0.01, 0.01 + fPx, fSd.x), 1.0 - smoothstep(0.01, 0.01 + fPx, fSd.y)) * step(0.5, fract(fQ.x + 0.5));
        vec3 fW = fVNoiseD(fM * 4.0);
        vec3 fW2 = fVNoiseD(fM * vec2(1.5, 9.0) + 4.0); // wrinkles running down each sheet
        float fNearSeam = 1.0 - smoothstep(0.0, 0.12, min(fSd.x, fSd.y));
        fBendW = -((fW.y * fAx + fW.z * fAy) * (0.02 + 0.04 * fNearSeam) * fNear(4.0) + (fW2.y * fAx + fW2.z * fAy) * 0.012 * fNear(9.0));
        fC *= (1.0 - 0.3 * fSeam) * (1.0 + 0.04 * fLap) * (1.0 - 0.06 * (1.0 - smoothstep(0.0, 0.15, fM.y))) * (0.97 + 0.05 * fW.x);
        fRoughK = 0.5 + 0.08 * fW.x;
        fGlowK = vec3(0.15 + 0.75 * uNight);
        fClean = 0.6;
      } else if (fSlot == ${SLOT.steel}) {
        // satin steel: rolled streaks along each member (aPane: along it and across, in metres), never a mirror
        float fSt = fVNoise(vec2(vPane.x * 3.0, vPane.y * 90.0));
        fC *= 0.9 + 0.18 * fSt + 0.08 * (fVNoise(fS * 1.7) - 0.5);
        fRoughK = 0.4 + 0.14 * fSt;
        fMetalK = 0.4;
        fClean = 0.4;
      } else if (fSlot == ${SLOT.wood}) {
        // wood along the member (aPane: along it and across, in metres): fine grain lines, wider bands
        float fRing = mix(fVNoise(vec2(vPane.x * 2.5, vPane.y * 150.0)), 0.5, 1.0 - fNear(40.0));
        float fBand = fVNoise(vec2(vPane.x * 0.7, vPane.y * 28.0) + 5.0);
        float fLine = smoothstep(0.55, 0.85, fVNoise(vec2(vPane.x * 1.2, vPane.y * 60.0) + 9.0)) * fNear(30.0);
        fC *= (0.8 + 0.3 * fBand + 0.24 * (fRing - 0.5)) * (1.0 - 0.28 * fLine);
        fRoughK = 0.6 + 0.14 * fBand;
      }
      diffuseColor.rgb = fC;`,
    weather: weather("vSeed", "fClean", TONE.house),
    roughness: "if (fRoughK >= 0.0) roughnessFactor = fRoughK;\nroughnessFactor = mix(roughnessFactor, 0.1, fGlassy);",
    metalness: "metalnessFactor = fMetalK;",
    // relief and the bevel
    normal: `${BEVEL_GLSL}\nnormal = normalize(normal + mat3(viewMatrix) * fBendW);`,
    // glass reflects the city (below), not the sky light: neither its reflection nor its diffuse share
    lights: "radiance *= 1.0 - fGlassy * uGlassMix;\nirradiance *= 1.0 - fGlassy * uGlassMix;\niblIrradiance *= 1.0 - fGlassy * uGlassMix;",
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
      totalEmissiveRadiance += vec3(1.0, 0.7, 0.38) * fLit * uNight * (1.1 + 0.5 * fCloth);
      totalEmissiveRadiance += diffuseColor.rgb * fGlowK;`,
  });
}

/** Towers: a tileable facade texture repeated in world units (one tile = 4 x 4 windows). */
export function towerMaterial(facade: Texture, tile: { w: number; h: number }, glassy: boolean) {
  const material = new MeshStandardMaterial({ roughness: glassy ? 0.35 : 0.8, metalness: glassy ? 0.25 : 0 });
  return patch(material, `tower-${glassy ? 1 : 0}`, {
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
 * 3 plain, 4 metal, 5 the Pyramid's precast crown (`aUv`: panels across, bands up; v < 0 its aluminium
 * spire), 6 and 8 a punched window pane (`aUv`
 * is its column and storey plus where on the pane: a one-over-one sash or a
 * steel factory window), 7 masonry (limestone ashlar or running-bond brick with
 * stone grain, facade.ts). Flat tops of parts 0 to 2 are roofs. At night
 * whole floors are busy or quiet and lit windows come in runs (offices cooler,
 * shops warmer); floodlit crowns get a warm wash that fades upward.
 * All glass (curtain wall panes, punched windows, shop fronts) reflects the
 * city from the probe (reflections.ts) by fresnel; curtain walls are coated,
 * so they reflect more head-on than plain windows. `curtain` false keeps
 * curtain wall glass plain (no per-pane detail or oil-canning): the Pyramid.
 */
export function downtownMaterial(stone: Texture, curtain = true) {
  const material = new MeshStandardMaterial({ vertexColors: true });
  return patch(material, "downtown", {
    uniforms: { uStone: { value: stone }, uCurtain: { value: curtain ? 1 : 0 }, ...glassUniforms },
    // vInfo is flat: interpolating a constant is not exact on every GPU (SwiftShader), and the window
    // hashes amplify the tiniest error into per-pixel speckle.
    vertHead: "attribute vec2 aUv;\nattribute vec3 aInfo;\nvarying vec2 vTUv;\nflat varying vec3 vInfo;",
    vert: "vTUv = aUv;\nvInfo = aInfo;",
    fragHead: /* glsl */ `
      uniform sampler2D uStone;
      uniform float uCurtain; // curtain wall detail: 1, or 0 for plain glass (one program for both)
      varying vec2 vTUv;
      flat varying vec3 vInfo;
      float fLit = 0.0;
      vec3 fLitC = vec3(1.0, 0.8, 0.52);
      float fRough = 0.85;
      float fMetal = 0.0;
      float fGl = 0.0;  // how much of this pixel is glass
      float fGlF0 = 0.06; // its head-on reflectance
      ${VALUE_NOISE}
      ${GLASS_ENV_GLSL}
      // 1 near the grid lines of x (half width w, in cells), anti-aliased; the average once cells shrink under a pixel.
      float fLine(float x, float w) {
        float aa = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        return mix(1.0 - smoothstep(w - aa, w + aa, d), 2.0 * w, smoothstep(0.2, 0.5, aa));
      }
      ${FACADE_GLSL}`,
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
        diffuseColor.rgb = facCurtain(fTint, vTUv, vFNormal, fRnd, fS, fM, uCurtain, facBend);
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
        // Masonry (facade.ts): limestone ashlar or running-bond brick by the tint, stone grain per block.
        diffuseColor.rgb = facMasonry(vFPos, vFNormal, fTint, vInfo.y, uStone, facBend);
      } else if (fPart > 5.5) {
        // A punched window pane: a frame and a meeting rail (sash) or a grid of muntins (steel), dark glass
        // with a room behind; some have a blind part way down or curtains drawn to the sides.
        bool fSteel = fPart > 7.5;
        // bars on whole numbers of the unwrapped coordinate (the frame is on the pane's edges): its derivatives never jump
        vec2 fG = vTUv * (fSteel ? vec2(3.0, 4.0) : vec2(1.0, 2.0));
        float fBar = max(fLine(fG.x, fSteel ? 0.05 : 0.07), fLine(fG.y, fSteel ? 0.05 : 0.045));
        float fCover = 0.0; // blinds and curtains (facade.ts)
        diffuseColor.rgb = facPane(fTint, vTUv, fBar, fRnd, vInfo.y, fSteel, fCover, facGlass);
        fGl = (1.0 - fBar) * (1.0 - fCover);
        fRough = mix(0.6, 0.12, fGl);
        fMetal = fSteel ? 0.3 * fBar : 0.0;
        // Whole floors are busy or quiet; lit windows come in runs of three.
        float fBusy = fHash(vec2(fCell.y, vInfo.y * 57.0) + fFace);
        float fOn = step(fHash(vec2(floor(fCell.x / 3.0), fCell.y) + fKey), fBusy * 0.8);
        fLit = (1.0 - fBar) * fOn * (0.7 + 0.3 * fRnd);
      } else if (fPart > 4.5 && vTUv.y < -0.5) {
        // The Pyramid's spire: brushed aluminium, light and only a little metallic, so it never goes dark.
        fRough = 0.5;
        fMetal = 0.15;
      } else if (fPart > 4.5) {
        // The Pyramid's precast crown: exposed aggregate panels (aUv: panels across, bands up), a dark joint
        // between panels, the arrises along the joints and band edges chipped here and there, each panel
        // a hair different in tone.
        vec2 fP = vTUv;
        vec2 fT2 = normalize(vec2(-vFNormal.z, vFNormal.x) + vec2(1e-5, 0.0));
        vec2 fW = abs(vFNormal.y) > 0.97 ? vFPos.xz : vec2(dot(vFPos.xz, fT2), vFPos.y);
        float fPxW = length(fwidth(vFPos));
        // how far to the panel's edge (world units, about half a metre a panel and a band)
        float fE = 0.5 * min(abs(fract(fP.x + 0.5) - 0.5), min(fract(fP.y), 1.0 - fract(fP.y)));
        float fJoint = fLine(fP.x, 0.012);
        // aggregate: a grain in about every other 4 mm cell, dark or light; gone once grains are under a pixel
        vec2 fG = floor(fW * 260.0);
        float fGh = fHash(fG + vInfo.y * 7.0);
        float fGrain = (1.0 - smoothstep(0.3, 0.7, fPxW * 260.0)) * (fGh < 0.28 ? -0.16 : (fGh > 0.82 ? 0.1 : 0.0));
        float fChip = (1.0 - smoothstep(0.004, 0.022, fE)) * smoothstep(0.62, 0.8, fVNoise(fW * 22.0)) * (1.0 - smoothstep(0.02, 0.05, fPxW));
        float fPanel = fHash(floor(fP) + 3.0);
        // the cast's own texture: blotches, a fine speckle, rain darkening down from each band's top edge
        float fSpeck = mix(fVNoise(fW * 90.0), 0.5, smoothstep(0.3, 0.7, fPxW * 90.0));
        float fRain = (1.0 - smoothstep(0.0, 0.6, 1.0 - fract(fP.y))) * smoothstep(0.45, 0.8, fVNoise(vec2(fW.x * 7.0, fW.y * 0.6)));
        diffuseColor.rgb = fTint * (0.95 + 0.09 * fPanel) * (0.93 + 0.1 * fVNoise(fW * 1.7) + 0.06 * fVNoise(fW * 9.0)) * (0.94 + 0.12 * fSpeck) * (1.0 + fGrain) * (1.0 + 0.1 * fChip) * (1.0 - 0.1 * fRain);
        diffuseColor.rgb = mix(diffuseColor.rgb, fTint * 0.42, fJoint);
        fRough = 0.8 + 0.08 * fVNoise(fW * 6.0) + 0.08 * fChip;
        // the chips: their broken faces lean every way
        facBend = (vec3(fT2.x, 0.0, fT2.y) * (fVNoise(fW * 40.0) - 0.5) + vec3(0.0, 1.0, 0.0) * (fVNoise(fW * 40.0 + 9.0) - 0.5)) * 0.8 * fChip;
      } else if (fPart > 3.5) {
        fRough = 0.4;
        fMetal = 0.6;
      }`,
    weather: weather("vInfo.y", "fGl", TONE.downtown),
    emissive: /* glsl */ `
      roughnessFactor = fRough;
      metalnessFactor = fMetal;
      float fFl = vInfo.z > 0.5 ? smoothstep(vInfo.z, vInfo.z + 0.6, vFPos.y) * (1.0 - 0.45 * smoothstep(vInfo.z, vInfo.z + 5.0, vFPos.y)) : 0.0;
      fFl *= abs(fPart - 5.0) < 0.5 ? 0.4 : 1.0; // the crown is pale: a softer wash keeps it calm
      if (fGl > 0.0) {
        vec3 fV = normalize(vFPos - cameraPosition);
        vec3 fN = normalize(vFNormal + facBend);
        // capped: set-back panes are shaded by their frames at a glancing angle
        float fF = min(0.5, fGlF0 + (1.0 - fGlF0) * pow(1.0 - abs(dot(fV, fN)), 5.0));
        totalEmissiveRadiance += glassEnv(vFPos, reflect(fV, fN), vec3(0.0)) * fF * fGl * facGlass;
      }
      totalEmissiveRadiance += (fLitC * fLit * 1.4 + diffuseColor.rgb * vec3(1.0, 0.8, 0.58) * fFl * 0.85) * uNight;`,
    // pane bow and joint grooves (facade.ts)
    normal: "normal = normalize(normal + mat3(viewMatrix) * facBend);",
    // once the probe is ready, glass reflects the city instead of the sky light, and takes none of its diffuse
    // light either (a pane lit by the whole sky read as a grey haze over the curtain walls)
    lights: "radiance *= 1.0 - fGl * uGlassMix;\nirradiance *= 1.0 - fGl * uGlassMix;\niblIrradiance *= 1.0 - fGl * uGlassMix;",
  });
}

/**
 * The ground: the street map (mask: R asphalt, G sidewalk, B grass, white =
 * lane marks, black = plain block ground) blended with detail textures.
 * Lawns come from lawn.ts (shared with the grass blades): muted green, gold
 * on the sunny faces of wild slopes (`dry`, the headlands texture), trails,
 * a darker edge at the kerb, and gullies bent into the normals.
 * `light` (lampLight in textures.ts): lamp pools in red, a soft shade where buildings meet the ground in green.
 */
export function groundMaterial(mask: Texture, light: Texture, asphalt: Texture, concrete: Texture, grass: Texture, dry: Texture) {
  const material = new MeshStandardMaterial({ map: mask, roughness: 0.95 });
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
      diffuseColor.rgb = mix(fBase, fPaint, fMark * (1.0 - fWear));
      // soft shade where buildings meet the ground (contactRects in textures.ts)
      diffuseColor.rgb *= 1.0 - 0.45 * texture2D(uLamp, vMapUv).g;`,
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
