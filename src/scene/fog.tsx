"use client";

// Karl the fog: one low bank off the ocean that rolls in through the Golden
// Gate under the deck. A stack of horizontal layers in one draw call, shaded
// with drifting noise stretched by the west wind. Where the bank sits and how
// deep it is comes from a small baked map (bakeFog): its depth over the water,
// and the ground under it, so the fog thins out softly before it meets the
// water, the cliffs and the headlands. Unlit.

import { useFrame } from "@react-three/fiber";
import { useMemo } from "react";
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, RGBAFormat, ShaderMaterial, UniformsLib, UniformsUtils, Vector4 } from "three";
import { chapters } from "@/content/day";
import { useCity } from "@/lib/store";
import { mixHex } from "@/lib/time";
import { headlandHeight, heightAt } from "@/lib/terrain";
import { WATER_Y } from "./bay";
import { insideLand } from "./grid";
import { GG } from "./landmarks";
import { dayNow, detail } from "./shared";

const PALE = "#fbf8f2";
const SUNSET = "#f1c6a2";
const NIGHT = "#3c4260";
/** Fog colour through the day, [hour, colour]: pale by day, warm at sunset, blue-grey at night. */
const TINTS: [number, string][] = [[16, PALE], [17.5, SUNSET], [19.5, SUNSET], [21, NIGHT], [28, NIGHT], [30, PALE]];

/** Fog colour at an hour (0 to 30, past 24 is the next morning). Unlit, so backlit fog never turns to dark smoke. */
export function fogTint(hour: number) {
  if (hour <= TINTS[0][0]) return PALE;
  const i = TINTS.findIndex(([h]) => h >= hour);
  if (i < 0) return PALE;
  const [h0, c0] = TINTS[i - 1];
  const [h1, c1] = TINTS[i];
  return mixHex(c0, c1, (hour - h0) / (h1 - h0));
}

/** The map's extent and cell size (world units). */
export const FOG_BOX = { x0: -300, z0: -210, x1: -20, z1: 40, cell: 1.25 };
/** Deepest bank, over the open ocean: its mean top this far above the water. */
export const FOG_DEPTH = 5;
/** The noise lifts the top up to this times the depth (the shader's 0.35 + 1.1 puff). */
export const TOP_SCALE = 1.45;
/** Layers from just over the water to under the Golden Gate's truss. */
export const LAYER_Y: [number, number] = [WATER_Y + 0.2, 5];
const DEPTH_RANGE = 8; // map R channel: depth / DEPTH_RANGE
const GROUND_RANGE = 16; // map G channel: (ground - WATER_Y) / GROUND_RANGE

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export type FogMap = { w: number; h: number; depth: Float32Array; ground: Float32Array };

/**
 * Depth of the bank (mean top above the water) and the ground height, per cell.
 * The bank fills the ocean, thins east through the strait and fades out past
 * the bridge along the Marin shore. It stays off the city.
 */
export function bakeFog(): FogMap {
  const { x0, z0, x1, z1, cell } = FOG_BOX;
  const w = Math.round((x1 - x0) / cell);
  const h = Math.round((z1 - z0) / cell);
  const cx = (i: number) => x0 + (i + 0.5) * cell;
  const cz = (j: number) => z0 + (j + 0.5) * cell;

  const land = new Float32Array(w * h);
  const raw = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = cx(i);
      const z = cz(j);
      const k = j * w + i;
      const city = insideLand(x, z);
      land[k] = city ? 1 : 0;
      let g = city ? heightAt(x, z) : WATER_Y;
      if (x > -210 && z < -118) g = Math.max(g, headlandHeight(x, z));
      raw[k] = g;
    }
  }
  // The ground a cell away counts too, so the fog thins before it reaches a wall, not at it.
  // Near the shore it also rises gently over the water, so the fog fades out over a few
  // units instead of at a line (a sharp edge aliases into stripes at grazing views).
  const dilated = filter(raw, w, h, 1, Math.max, -Infinity);
  const ramp = blur(filter(raw, w, h, 3, Math.max, -Infinity), w, h, 3);
  const ground = dilated.map((g, k) => Math.max(g, ramp[k]));
  const near = blur(land, w, h, 6); // how much city is around: the fog keeps well back from it
  const depth = new Float32Array(w * h);
  const cam = chapters[0].camera.position;
  const spot = chapters[0].spot;
  const len = Math.hypot(spot[0] - cam[0], spot[2] - cam[2]);
  const look = [(spot[0] - cam[0]) / len, (spot[2] - cam[2]) / len];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = cx(i);
      const z = cz(j);
      const k = j * w + i;
      // Deep over the ocean, thinning east through the strait under the deck. Past the bridge
      // it hugs the Marin shore; the city side stays clear (Cuso stands against it at 06:00).
      const end = -60 + 25 * smooth(-62, -125, z);
      const west = smooth(end, end - 30, x);
      // Soft at the map's edges, so no layer ever shows its border.
      const edge = smooth(x0, x0 + 40, x) * smooth(z0, z0 + 30, z) * smooth(z1, z1 - 30, z) * smooth(x1, x1 - 15, x);
      // Thin straight behind Cuso in the 06:00 shot (desktop and phone look along the same line),
      // this side of the bridge (the deck hides what is beyond).
      const vx = x - cam[0], vz = z - cam[2];
      const along = vx * look[0] + vz * look[1];
      const angle = along > 0 ? Math.atan2(Math.abs(vx * look[1] - vz * look[0]), along) : Math.PI;
      const clear = 1 - 0.7 * (1 - smooth(0.07, 0.14, angle)) * smooth(-92, -82, x);
      depth[k] = FOG_DEPTH * west * edge * clear * (1 - Math.min(1, near[k] * 2.2)) * (land[k] ? 0 : 1);
    }
  }
  return { w, h, depth, ground };
}

/** Square neighbourhood (radius r cells) reduced with `op`, edges clamped. */
function filter(src: Float32Array, w: number, h: number, r: number, op: (a: number, b: number) => number, start: number) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let v = start;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) v = op(v, src[Math.min(h - 1, Math.max(0, j + dj)) * w + Math.min(w - 1, Math.max(0, i + di))]);
      out[j * w + i] = v;
    }
  }
  return out;
}

/** Box blur, radius r cells. */
const blur = (src: Float32Array, w: number, h: number, r: number) => filter(src, w, h, r, (a, b) => a + b, 0).map((v) => v / (2 * r + 1) ** 2);

/** The bank's mean depth at a point (nearest cell), for tests and placement. */
export function fogDepthAt(map: FogMap, x: number, z: number) {
  const i = Math.floor((x - FOG_BOX.x0) / FOG_BOX.cell);
  const j = Math.floor((z - FOG_BOX.z0) / FOG_BOX.cell);
  if (i < 0 || j < 0 || i >= map.w || j >= map.h) return 0;
  return map.depth[j * map.w + i];
}

/** Heights of the layers: `count` of them, evenly from just over the water to under the deck. */
export const layerHeights = (count: number) => Array.from({ length: count }, (_, k) => LAYER_Y[0] + ((LAYER_Y[1] - LAYER_Y[0]) * k) / (count - 1));

/** The Golden Gate's towers and anchorages, where the layers cross something tall: [x, z, half x, half z]. */
const SOLIDS = [...GG.towers.map((z) => new Vector4(GG.x, z, 3.4, 2.2)), ...[GG.south, GG.north].map((z) => new Vector4(GG.x, z, 2.5, 2.2))];

/** Tiles of the map (TILE cells square) that each layer covers: only where fog can reach its height. */
const TILE = 8;
function layerGeometry(map: FogMap, count: number) {
  const { x0, z0, cell } = FOG_BOX;
  const heights = layerHeights(count);
  const half = (heights[1] - heights[0]) / 2; // the shader's dither reaches half a layer up or down
  const margin = 3; // cells: the map's bilinear filter and the dither's sideways reach
  const far: number[] = [];
  const near: number[] = [];
  for (const y of heights) {
    for (let tj = 0; tj < map.h; tj += TILE) {
      for (let ti = 0; ti < map.w; ti += TILE) {
        let hit = false;
        for (let j = Math.max(0, tj - margin); !hit && j < Math.min(map.h, tj + TILE + margin); j++) {
          for (let i = Math.max(0, ti - margin); i < Math.min(map.w, ti + TILE + margin); i++) {
            const k = j * map.w + i;
            if (map.depth[k] > 0.02 && WATER_Y + map.depth[k] * TOP_SCALE + 0.5 + half >= y && map.ground[k] <= y) {
              hit = true;
              break;
            }
          }
        }
        if (!hit) continue;
        const ax = x0 + ti * cell, bx = x0 + Math.min(map.w, ti + TILE) * cell;
        const az = z0 + tj * cell, bz = z0 + Math.min(map.h, tj + TILE) * cell;
        const bridge = SOLIDS.some((b) => ax < b.x + b.z + 4 && bx > b.x - b.z - 4 && az < b.y + b.w + 4 && bz > b.y - b.w - 4);
        (bridge ? near : far).push(ax, y, az, ax, y, bz, bx, y, bz, ax, y, az, bx, y, bz, bx, y, az);
      }
    }
  }
  // Group 0: open water. Group 1: round the bridge's towers and anchorages, depth-tested per sample.
  const g = new BufferGeometry().setAttribute("position", new Float32BufferAttribute([...far, ...near], 3));
  g.addGroup(0, far.length / 3, 0);
  g.addGroup(far.length / 3, near.length / 3, 1);
  return g;
}

function mapTexture(map: FogMap) {
  const data = new Uint8Array(map.w * map.h * 4);
  for (let k = 0; k < map.w * map.h; k++) {
    data[k * 4] = Math.round(255 * Math.min(1, map.depth[k] / DEPTH_RANGE));
    data[k * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, (map.ground[k] - WATER_Y) / GROUND_RANGE)));
    data[k * 4 + 3] = 255;
  }
  const t = new DataTexture(data, map.w, map.h, RGBAFormat);
  t.magFilter = t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Tileable smooth value noise (NOISE_CELLS cells across), so the shader reads noise instead of computing it. */
const NOISE_CELLS = 32;
function noiseTexture() {
  const size = 256;
  const step = size / NOISE_CELLS;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const grid = Array.from({ length: NOISE_CELLS * NOISE_CELLS }, rand);
  const at = (i: number, j: number) => grid[(j % NOISE_CELLS) * NOISE_CELLS + (i % NOISE_CELLS)];
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = Math.floor(x / step), j = Math.floor(y / step);
      const fx = smooth(0, 1, x / step - i), fy = smooth(0, 1, y / step - j);
      const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
      const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
      data[y * size + x] = Math.round(255 * (top + (bottom - top) * fy));
    }
  }
  const t = new DataTexture(data, size, size, RedFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const vertexShader = /* glsl */ `
  #include <fog_pars_vertex>
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    vec4 mvPosition = viewMatrix * vec4(vWorld, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform sampler2D uNoise;
  uniform vec4 uBox;
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uSpacing;
  uniform mat4 projectionMatrix;
  varying vec3 vWorld;

  float noise(vec2 p) {
    return texture2D(uNoise, p * ${(1 / NOISE_CELLS).toFixed(5)}).r;
  }
  float fbm(vec2 p) {
    float v = 0.5 * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    v += 0.3 * noise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    v += 0.2 * noise(p);
    return v;
  }

  // Interleaved gradient noise: a per-pixel dither that reads as smooth, not as a pattern.
  float ign(vec2 c) {
    return fract(52.9829189 * fract(dot(c, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    // Each layer samples the fog where the view ray is up to half a layer above or below it, by a
    // per-pixel dither: at grazing views the slices melt into one smooth volume instead of lines.
    float k = floor((vWorld.y - ${LAYER_Y[0].toFixed(2)}) / uSpacing + 0.5);
    float j = ign(gl_FragCoord.xy + k * 5.588238) - 0.5;
    vec3 p = vWorld + dir * (j * uSpacing / max(abs(dir.y), 0.03));
    #ifdef SAMPLE_DEPTH
      // Round the bridge, depth-test the sample where it really is: a tower crossing the layers
      // then fogs over in a smooth ramp instead of one step per layer. (Costly: only there.)
      vec4 clip = projectionMatrix * viewMatrix * vec4(p, 1.0);
      gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
    #endif
    vec4 m = texture2D(uMap, (p.xz - uBox.xy) * uBox.zw);
    float depth = m.r * ${DEPTH_RANGE.toFixed(1)};
    // The ground fade is smooth by itself: read it where the layer really is, not dithered
    // (on a slope the dither would land on very different ground and show as grain).
    float ground = ${WATER_Y.toFixed(2)} + texture2D(uMap, (vWorld.xz - uBox.xy) * uBox.zw).g * ${GROUND_RANGE.toFixed(1)};
    float y = p.y;
    // Above the highest the bank can reach here, or under the ground: nothing to draw.
    if (depth < 0.02 || y > ${WATER_Y.toFixed(2)} + depth * ${TOP_SCALE.toFixed(2)} + 0.5 || vWorld.y < ground) discard;
    // Rolling soft mounds on top, drifting east on the wind, only a little stretched by it.
    vec2 q = vec2((p.x - uTime * 0.35) * 0.032, p.z * 0.05);
    float puff = smoothstep(0.25, 0.75, fbm(q));
    float top = ${WATER_Y.toFixed(2)} + depth * (0.35 + 1.1 * puff);
    // Soft where it meets water; softer still over land, so it never draws contour lines on a slope.
    float fade = 1.4 + 2.1 * smoothstep(0.0, 1.5, ground - ${WATER_Y.toFixed(2)});
    // A layer at the eye's own height is seen edge on, as a line: let it go.
    float edgeOn = smoothstep(0.5, 2.0, abs(cameraPosition.y - vWorld.y) / uSpacing);
    float a = edgeOn * smoothstep(top + 0.5, top - 2.9, y) * smoothstep(ground, ground + fade, vWorld.y);
    if (a < 0.004) discard;
    // Brighter on top, where the sky lights it; softer and a little darker underneath.
    gl_FragColor = vec4(uColor * (0.76 + 0.2 * smoothstep(top - 2.5, top, y)), a * uAlpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export function Fog({ lite }: { lite: boolean }) {
  // From the bird's-eye map a low bank reads as a smear: leave it to the close shots.
  const explore = useCity((s) => s.mode === "explore");
  const count = lite ? 10 : 14;
  const map = useMemo(() => bakeFog(), []);
  const geometry = useMemo(() => layerGeometry(map, count), [map, count]);
  const materials = useMemo(() => {
    const { x0, z0, x1, z1 } = FOG_BOX;
    // One set of uniforms for both materials (open water, and round the bridge).
    const uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uMap: { value: mapTexture(map) },
        uNoise: { value: noiseTexture() },
        uBox: { value: [x0, z0, 1 / (x1 - x0), 1 / (z1 - z0)] },
        uColor: { value: new Color() },
        // The whole stack at full density lets a few percent of what is behind through.
        uAlpha: { value: 1 - Math.pow(0.06, 1 / count) },
        uTime: { value: 0 },
        uSpacing: { value: (LAYER_Y[1] - LAYER_Y[0]) / (count - 1) },
      },
    ]);
    const make = (defines: Record<string, string>) =>
      new ShaderMaterial({ vertexShader, fragmentShader, uniforms, defines, transparent: true, depthWrite: false, fog: true });
    return [make({}), make({ SAMPLE_DEPTH: "" })];
  }, [map, count]);

  useFrame(({ clock }) => {
    const u = materials[0].uniforms;
    u.uTime.value = clock.elapsedTime;
    (u.uColor.value as Color).set(fogTint(dayNow().hour));
  });

  if (explore) return null;
  // Out of the water mirror and the glass probe: low fog over the water hides its own reflection.
  return <mesh geometry={geometry} material={materials} ref={detail} />;
}
