// Procedural wood (and the satin paint and brass that share its shader) for
// hero props: the cable car and the pier. No textures: growth rings, fibres
// and knots are computed per pixel from each board's own seed, so no two
// boards match and nothing repeats.
//
// How to use it:
// 1. Build each board as a geometry (`chamferBox` gives cut edges) and tag it
//    with `tagBoard(g, centre, axis, woodBoard(i, salt))`: the centre (where
//    its log sits), the grain axis (0 x, 1 y, 2 z) and the seed go into the
//    `aWood` attribute, the tone into vertex colours. Merge the boards.
// 2. Draw them with `woodMaterial(color, WOOD_LOOKS.teak, lite)`. Multiply
//    baked AO (ao.ts) into the vertex colours.
// Desktop: one shader program for every look. Phones (`lite`): a plain
// MeshStandardMaterial with vertex colours, a program the city already
// compiles, so phones pay no new shader compile.

import { BufferGeometry, Float32BufferAttribute, MeshStandardMaterial, Vector3, type ColorRepresentation } from "three";

export type WoodLook = {
  /** Growth rings per unit across the grain. 0: no rings; `contrast` darkens soft blotches instead (paint, brass). */
  rings: number;
  /** How dark the late wood of a ring (or a blotch) is, 0..1. */
  contrast: number;
  /** Fine fibre streaks along the grain, 0..1. */
  fibre: number;
  /** Knot chances per unit along a board (0: none). */
  knots: number;
  /** Roughness from polished (varnish, wet, handled brass) to worn. */
  rough: [number, number];
  /** Grain relief depth in units (a bump on the normal). */
  relief: number;
  metal?: number;
};

export const WOOD_LOOKS = {
  /** Varnished teak: tight rings, few knots, a glossy coat worn in patches. */
  teak: { rings: 60, contrast: 0.42, fibre: 0.16, knots: 0.25, rough: [0.2, 0.42], relief: 0.0004 },
  /** Weathered deck planks: open grain, knots, matte. The pier adds its wet patches on top. */
  deck: { rings: 32, contrast: 0.5, fibre: 0.32, knots: 0.9, rough: [0.66, 0.92], relief: 0.0012 },
  /** Satin enamel. */
  paint: { rings: 0, contrast: 0.06, fibre: 0.02, knots: 0, rough: [0.32, 0.48], relief: 0.00015 },
  /** Brass: polished where hands touch it, tarnished elsewhere. */
  brass: { rings: 0, contrast: 0.35, fibre: 0.06, knots: 0, rough: [0.16, 0.5], relief: 0, metal: 0.85 },
} satisfies Record<string, WoodLook>;

/** Seed (0..1) and tone (colour multiplier) of board `index`; `salt` keeps different props apart. */
export function woodBoard(index: number, salt = 0) {
  let h = Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  return { seed: next(), tone: 0.86 + next() * 0.24 };
}

/** Writes the board's `aWood` (centre xyz, axis + seed) and its tone as vertex colour on every vertex. */
export function tagBoard<G extends BufferGeometry>(g: G, centre: readonly [number, number, number], axis: 0 | 1 | 2, board: { seed: number; tone: number }) {
  const n = g.attributes.position.count;
  const wood = new Float32Array(n * 4);
  const color = new Float32Array(n * 3).fill(board.tone);
  const w = axis + Math.min(board.seed, 0.999);
  for (let i = 0; i < n; i++) wood.set([centre[0], centre[1], centre[2], w], i * 4);
  g.setAttribute("aWood", new Float32BufferAttribute(wood, 4));
  g.setAttribute("color", new Float32BufferAttribute(color, 3));
  return g;
}

/**
 * A box sx x sy x sz centred on the origin with every edge cut at 45 degrees
 * by `c` (44 triangles, flat normals, uv per face over its size: on the top
 * face u runs along x and v along z).
 */
export function chamferBox(sx: number, sy: number, sz: number, c: number) {
  const h = [sx / 2, sy / 2, sz / 2];
  const cut = Math.min(c, ...h.map((v) => v * 0.45));
  /** The corner with signs `s`, on its face across axis `a`. */
  const at = (s: number[], a: number) => s.map((si, k) => si * (k === a ? h[k] : h[k] - cut));
  const polys: number[][][] = [];
  const S = [-1, 1];
  const signs = (a: number, sa: number, b: number, sb: number, d: number, sd: number) => {
    const s = [0, 0, 0];
    s[a] = sa;
    s[b] = sb;
    s[d] = sd;
    return s;
  };
  for (let a = 0; a < 3; a++) {
    const [b, d] = [(a + 1) % 3, (a + 2) % 3];
    for (const sa of S) polys.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sb, sd]) => at(signs(a, sa, b, sb, d, sd), a)));
    // the cut along each edge parallel to a
    for (const sb of S) for (const sd of S) polys.push([at(signs(a, -1, b, sb, d, sd), b), at(signs(a, 1, b, sb, d, sd), b), at(signs(a, 1, b, sb, d, sd), d), at(signs(a, -1, b, sb, d, sd), d)]);
  }
  for (const x of S) for (const y of S) for (const z of S) polys.push([0, 1, 2].map((a) => at([x, y, z], a)));

  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const e1 = new Vector3();
  const e2 = new Vector3();
  const n = new Vector3();
  const mid = new Vector3();
  for (let p of polys) {
    e1.fromArray(p[1]).sub(new Vector3().fromArray(p[0]));
    e2.fromArray(p[2]).sub(new Vector3().fromArray(p[0]));
    n.crossVectors(e1, e2).normalize();
    mid.set(0, 0, 0);
    for (const v of p) mid.add(new Vector3().fromArray(v));
    if (n.dot(mid) < 0) {
      p = [...p].reverse();
      n.negate();
    }
    const a = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].reduce((best, v, i, all) => (v > all[best] ? i : best), 0);
    for (let i = 1; i < p.length - 1; i++) {
      for (const v of [p[0], p[i], p[i + 1]]) {
        pos.push(...v);
        nrm.push(n.x, n.y, n.z);
        uv.push(v[(a + 2) % 3] / (h[(a + 2) % 3] * 2) + 0.5, v[(a + 1) % 3] / (h[(a + 1) % 3] * 2) + 0.5);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

/** Shared GLSL: hash and value noise. */
const WOOD_HEAD = /* glsl */ `
  uniform vec4 uWdGrain; // rings, contrast, fibre, knots
  uniform vec3 uWdRough; // polished, worn, relief
  varying vec3 vWdP;
  varying vec3 vWdW;
  varying vec4 vWood;
  float wdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wdNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wdHash(i), wdHash(i + vec2(1.0, 0.0)), f.x), mix(wdHash(i + vec2(0.0, 1.0)), wdHash(i + 1.0), f.x), f.y);
  }`;

/**
 * The pattern, after vertex colours. Board space: wdA along the grain, the
 * log's pith beside or under the board (per seed), rings around it warped
 * along the length, knots pointing out of the pith toward the board with the
 * rings swirling round them. Sets wdRough and wdH (relief) for later chunks.
 */
const WOOD_COLOR = /* glsl */ `
  float wdAxis = floor(vWood.w);
  float wdSeed = fract(vWood.w);
  vec3 wdD = vWdP - vWood.xyz;
  vec3 wdQ = wdAxis < 0.5 ? wdD : wdAxis < 1.5 ? wdD.yzx : wdD.zxy;
  float wdA = wdQ.x;
  vec2 wdPith = vec2(wdHash(vec2(wdSeed, 1.7)), wdHash(vec2(wdSeed, 5.3))) - 0.5;
  wdPith = wdPith * 0.5 + sign(wdPith) * 0.06;
  vec2 wdC = wdQ.yz - wdPith;
  float wdWarp = (wdNoise(vec2(wdA * 2.3 + wdSeed * 37.0, wdSeed * 11.0)) - 0.5) * 0.05 + (wdNoise(vec2(wdA * 11.0, wdSeed * 23.0)) - 0.5) * 0.006;
  float wdR = length(wdC) + wdWarp;
  float wdKnot = 0.0;
  float wdSwirl = 0.0;
  if (uWdGrain.w > 0.0) {
    float k = floor(wdA * uWdGrain.w + wdSeed * 7.0);
    if (wdHash(vec2(k, wdSeed * 91.0)) < 0.55) {
      float kc = (k + 0.2 + 0.6 * wdHash(vec2(k, wdSeed * 13.0)) - wdSeed * 7.0) / uWdGrain.w;
      float ka = atan(-wdPith.y, -wdPith.x) + (wdHash(vec2(k, wdSeed * 29.0)) - 0.5) * 0.5;
      float da = abs(mod(atan(wdC.y, wdC.x) - ka + 3.14159, 6.28318) - 3.14159);
      float kd = length(vec2((wdA - kc) * 0.7, wdR * da));
      float kr = 0.005 + 0.011 * wdHash(vec2(k, wdSeed * 47.0));
      wdKnot = 1.0 - smoothstep(kr * 0.55, kr, kd);
      wdSwirl = exp(-kd * kd / (kr * kr * 10.0));
    }
  }
  float wdRings = wdR * uWdGrain.x + wdSwirl * 1.6;
  float wdRing = fract(wdRings);
  float wdLate = smoothstep(0.5, 0.9, wdRing) * (1.0 - smoothstep(0.9, 1.0, wdRing));
  wdLate = mix(0.3, wdLate, 1.0 - smoothstep(0.3, 0.8, fwidth(wdRings)));
  float wdFibreX = wdR * 380.0 + wdSeed * 91.0;
  float wdFib = (wdNoise(vec2(wdA * 6.0 + wdSeed * 50.0, wdFibreX)) - 0.5) * (1.0 - smoothstep(0.4, 1.0, fwidth(wdFibreX)));
  float wdBlotch = wdNoise(vWdP.xy * 5.0 + vWdP.z * 3.7) * 0.6 + wdNoise(vWdP.zy * 13.0 + vWdP.x * 2.1) * 0.4;
  float wdMark = uWdGrain.x > 0.0 ? wdLate : wdBlotch;
  vec3 wdLateCol = mix(vec3(1.0), vec3(0.55, 0.42, 0.32), uWdGrain.y);
  diffuseColor.rgb *= mix(vec3(1.0), wdLateCol, wdMark) * (1.0 + wdFib * uWdGrain.z) * mix(1.0, 0.4, wdKnot);
  float wdRough = mix(uWdRough.x, uWdRough.y, clamp(0.6 * wdBlotch + 0.25 * wdMark + 0.3 * wdKnot - 0.1, 0.0, 1.0));
  float wdH = (wdFib * 0.8 - wdMark * 0.4 - wdKnot * 0.4) * uWdRough.z;`;

/** Bends the normal by the relief (three's bump formula without the per-pixel normalisation, so wdH is in units). */
const WOOD_NORMAL = /* glsl */ `
  {
    vec3 wdSx = dFdx(-vViewPosition);
    vec3 wdSy = dFdy(-vViewPosition);
    vec2 wdDh = vec2(dFdx(wdH), dFdy(wdH));
    vec3 wdR1 = cross(wdSy, normal);
    vec3 wdR2 = cross(normal, wdSx);
    float wdDet = dot(wdSx, wdR1) * faceDirection;
    if (wdDet != 0.0) normal = normalize(abs(wdDet) * normal - sign(wdDet) * (wdDh.x * wdR1 + wdDh.y * wdR2));
  }`;

/**
 * Extra GLSL run after the pattern (its own program key). It may read vWdW
 * (world position), vWdP, vWood, wdSeed, wdA, wdKnot and change diffuseColor,
 * wdRough and wdH. The pier uses it for wet edges and the worn path.
 */
export type WoodSurface = { key: string; glsl: string };

/** Wood (or satin paint, or brass) for merged geometry tagged by `tagBoard`. Not for instanced meshes. */
export function woodMaterial(color: ColorRepresentation, look: WoodLook, lite = false, surface?: WoodSurface) {
  const metalness = look.metal ?? 0;
  if (lite) return new MeshStandardMaterial({ color, metalness, roughness: (look.rough[0] + look.rough[1]) / 2, vertexColors: true });
  const m = new MeshStandardMaterial({ color, metalness, roughness: look.rough[0], vertexColors: true });
  const uniforms = {
    uWdGrain: { value: [look.rings, look.contrast, look.fibre, look.knots] },
    uWdRough: { value: [look.rough[0], look.rough[1], look.relief] },
  };
  m.userData.wood = uniforms;
  m.customProgramCacheKey = () => (surface ? `wood-${surface.key}` : "wood");
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aWood;\nvarying vec3 vWdP;\nvarying vec3 vWdW;\nvarying vec4 vWood;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWdP = transformed;\nvWood = aWood;\nvWdW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\n${WOOD_HEAD}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${WOOD_COLOR}\n${surface?.glsl ?? ""}`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = wdRough;")
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>\n${WOOD_NORMAL}`);
  };
  return m;
}
