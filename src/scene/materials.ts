// Textured materials for the city (art pass 3). Textures are generated
// (design/prompts/textures) and live in public/textures. Shader patches on
// MeshStandardMaterial map them in world units so nothing stretches, and light
// windows at night from the dark glass in each texture.

import { MeshStandardMaterial, type Texture } from "three";
import { facadeNight } from "./facade";
import { SLOT, SLOTS } from "./house-models";
import { LAWN_GLSL, lawnTexture } from "./lawn";

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

function patch(material: MeshStandardMaterial, key: string, opts: { uniforms: Record<string, { value: unknown }>; vertHead?: string; vert?: string; fragHead: string; color: string; emissive?: string; roughness?: string; normal?: string }) {
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
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>\n${opts.emissive ?? ""}`);
  };
  return material;
}

/**
 * Row houses (house-models.ts): painted wood in each house's colours. Vertex
 * attributes `aSlot` (which paint, SLOTS order), `aWin` (window id, 0 = not
 * glass) and `aPane` (where on its pane, for glass); instance attribute
 * `aPalette`. `palette` is linear RGB per palette and slot. Body walls get
 * lap siding, `scales` fish-scale shingles, roofs shingles.
 * Glass: a dark room behind it (some with a blind part way down, some with
 * curtains drawn to the sides) under a glossy pane that reflects the sky by
 * fresnel: near black looking straight in, brighter and bluer at a glancing
 * angle (the horizon is the fog colour, so it follows the time of day).
 * At night about half the windows light up, each as a whole (its id and the house).
 */
export function houseMaterial(siding: Texture, shingles: Texture, palette: Float32Array) {
  const n = SLOTS.length;
  return patch(new MeshStandardMaterial({ roughness: 0.82 }), "house", {
    uniforms: { uSiding: { value: siding }, uShingles: { value: shingles }, uPalette: { value: palette } },
    vertHead: "attribute float aSlot;\nattribute float aWin;\nattribute vec2 aPane;\nattribute float aPalette;\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;",
    vert: /* glsl */ `
      vSlot = aSlot;
      vWin = aWin;
      vPane = aPane;
      vPalette = aPalette;
      // One value per house (front and body share their origin), so a window lights up as a whole.
      #ifdef USE_INSTANCING
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vSeed = 0.0;
      #endif`,
    fragHead: `uniform sampler2D uSiding;\nuniform sampler2D uShingles;\nuniform vec3 uPalette[${palette.length / 3}];\nflat varying float vSlot;\nflat varying float vWin;\nflat varying float vPalette;\nflat varying float vSeed;\nvarying vec2 vPane;\nfloat fLit = 0.0;\nfloat fGlassy = 0.0;\nfloat fCloth = 0.0;`,
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
        float fFres = 0.04 + 0.85 * pow(1.0 - abs(dot(fV, fN)), 1.6);
        totalEmissiveRadiance += fSky * fFres * (1.0 - 0.6 * fCloth * uNight);
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
 * is (part, per-tower seed, floodlight height or 0). Parts: 0 curtain wall
 * (mullions, a spandrel at each floor, panes that differ a little), 1 punched
 * windows from the stone texture on a tinted wall (limestone, terracotta,
 * brick), 2 shop fronts (middle bay is the entrance), 3 plain, 4 metal. Flat tops of facades are
 * tar-and-gravel roofs. At night some windows light up (offices cooler, shops
 * warmer) and floodlit crowns get a warm wash that fades upward.
 */
export function downtownMaterial(stone: Texture) {
  return patch(new MeshStandardMaterial({ vertexColors: true }), "downtown", {
    uniforms: { uStone: { value: stone } },
    vertHead: "attribute vec2 aUv;\nattribute vec3 aInfo;\nvarying vec2 vTUv;\nvarying vec3 vInfo;",
    vert: "vTUv = aUv;\nvInfo = aInfo;",
    fragHead: /* glsl */ `
      uniform sampler2D uStone;
      varying vec2 vTUv;
      varying vec3 vInfo;
      float fLit = 0.0;
      vec3 fLitC = vec3(1.0, 0.8, 0.52);
      float fRough = 0.85;
      float fMetal = 0.0;
      // 1 near the grid lines of x (half width w, in cells), anti-aliased; the average once cells shrink under a pixel.
      float fLine(float x, float w) {
        float aa = fwidth(x);
        float d = abs(fract(x + 0.5) - 0.5);
        return mix(1.0 - smoothstep(w - aa, w + aa, d), 2.0 * w, smoothstep(0.2, 0.5, aa));
      }`,
    color: /* glsl */ `
      float fPart = floor(vInfo.x + 0.5);
      vec3 fTint = diffuseColor.rgb;
      float fFace = dot(floor(vFNormal.xz * 1.5 + 0.5), vec2(3.0, 7.0));
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
        // Offices: each floor is busy or quiet; lit panes come in runs of four, dimmer and cooler than homes, never on a sloped top.
        float fBusy = fHash(vec2(fCell.y, vInfo.y * 57.0) + fFace);
        float fOn = step(fHash(vec2(floor(vTUv.x / 4.0), fCell.y) + fKey), fBusy * 0.6);
        fLit = fPane * fOn * (0.18 + 0.1 * fRnd) * step(abs(vFNormal.y), 0.3);
        fLitC = vec3(1.0, 0.88, 0.7);
      } else if (fPart < 1.5) {
        vec3 fF = texture2D(uStone, vTUv / 4.0).rgb;
        float fWin = fGlass(fF);
        diffuseColor.rgb = mix(fTint * fLuma(fF) / 0.68, fF * 0.8, fWin);
        fRough = mix(0.85, 0.2, fWin);
        fLit = fWin * step(0.52, fRnd);
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
        fLit = (fGlz - fFrame) * step(0.45, fRnd) * (0.2 + 0.2 * smoothstep(0.1, 0.6, fY));
      } else if (fPart > 3.5) {
        fRough = 0.4;
        fMetal = 0.6;
      }`,
    emissive: /* glsl */ `
      roughnessFactor = fRough;
      metalnessFactor = fMetal;
      float fFl = vInfo.z > 0.5 ? smoothstep(vInfo.z, vInfo.z + 0.6, vFPos.y) * (1.0 - 0.45 * smoothstep(vInfo.z, vInfo.z + 5.0, vFPos.y)) : 0.0;
      totalEmissiveRadiance += (fLitC * fLit * 1.4 + diffuseColor.rgb * vec3(1.0, 0.8, 0.58) * fFl * 0.85) * uNight;`,
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
  return patch(new MeshStandardMaterial({ map: mask, roughness: 0.95 }), "ground", {
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
