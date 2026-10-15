// Night for every building material: 0 = day, 1 = night. Atmosphere sets it
// every frame; the window shaders read it as their `uNight` uniform.
//
// Small-scale facade detail for `downtownMaterial` (materials.ts): stone and
// brick coursing, punched window panes, curtain wall panes. Large-scale tone
// and dirt are not here (weathering runs after this colour). Every GLSL symbol
// is fac-prefixed; the TS mirrors below use the same numbers and arithmetic.

import { Color } from "three";

/** 0 = day, 1 = night. Atmosphere sets it every frame. */
export const facadeNight = { value: 0 };

/** Limestone ashlar: course height, block length, joint width (world units). */
export const ASHLAR = { course: 0.34, length: 0.72, joint: 0.012 };
/** Running-bond brick: course height, brick length, mortar joint width (world units). */
export const BRICK = { course: 0.085, length: 0.21, joint: 0.011 };
/** A masonry tint is brick when its blue is under this share of its red (linear RGB). */
export const BRICK_BR = 0.45;
/** Window glass per tower (multiplies the room behind, and partly what it reflects): neutral, green, bronze. */
export const GLASS_TINTS: [number, number, number][] = [
  [1, 1, 1],
  [0.92, 1, 0.95],
  [1, 0.94, 0.86],
];
/** Seed thresholds between the glass tints. */
const GLASS_SPLIT = [0.5, 0.78];
/**
 * Oil-canning on curtain walls: each pane leans up to `tilt` (about a third of
 * a degree) and bows `pillow` across. Reflections travel far, so a little goes
 * a long way: more and the city in the glass breaks up into a blur.
 */
export const OIL_CANNING = { tilt: 0.006, pillow: 0.006 };
/** Masonry reads this much darker than its tint on average (as before this pass). */
const LEVEL = 0.85;
/**
 * Grain comes from joint-free windows of the stone texture (rows from the top
 * of the 1024 px image, each WIN px tall, columns U0..U0+DU inside one pier);
 * GRAIN is their mean linear luma.
 */
const WINDOWS = [45, 120, 302, 377, 560, 634, 817, 889];
const WIN = 60;
const U0 = 466 / 1024;
const DU = 92 / 1024;
const GRAIN = 0.575;

const fract = (x: number) => x - Math.floor(x);
const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));
const vec3 = (v: number[]) => `vec3(${v.map(f).join(", ")})`;

/** True when a masonry tint (hex, sRGB) is red brick; mirrors the shader. */
export function isBrick(hex: string) {
  const c = new Color(hex);
  return c.b < BRICK_BR * c.r;
}

/** Glass tint for a tower seed; mirrors `facGlassTint`. */
export function glassTint(seed: number): [number, number, number] {
  const t = fract(seed * 7.13);
  return GLASS_TINTS[t < GLASS_SPLIT[0] ? 0 : t < GLASS_SPLIT[1] ? 1 : 2];
}

/** Which unit (column, course) a wall point x, y falls in, and where in it (0..1); mirrors `facMasonry`. */
export function masonryCell(x: number, y: number, brick: boolean) {
  const k = brick ? BRICK : ASHLAR;
  const gy = y / k.course;
  const row = Math.floor(gy);
  // running bond: every other course shifts half a unit
  const gx = x / k.length + 0.5 * (((row % 2) + 2) % 2);
  const col = Math.floor(gx);
  return { col, row, fx: gx - col, fy: gy - row };
}

/**
 * GLSL for the end of downtownMaterial's fragment head (uses fHash, fLuma).
 * - facMasonry: ashlar or brick by the tint, grain per block from the stone
 *   texture, joints that fade to their average before they alias, and a
 *   joint groove bent into the normal (`bend`, world space) only up close.
 * - facPane: a punched window pane: per-tower frame colour and glass tint,
 *   reveal shadow, blinds and curtains. `glass` is the reflection's tint and strength.
 * - facCurtain: a curtain wall cell: per-pane tint, a darker plenum band at
 *   the top of each pane, shadow-box spandrels; `bend` leans each pane a little.
 * The caller adds `facBend` to the normal (lights and reflections) and
 * multiplies the glass reflection by `facGlass`.
 */
export const FACADE_GLSL = /* glsl */ `
  const float FAC_BRICK_BR = ${f(BRICK_BR)};
  const vec3 FAC_ASHLAR = ${vec3([ASHLAR.length, ASHLAR.course, ASHLAR.joint])};
  const vec3 FAC_BRICK = ${vec3([BRICK.length, BRICK.course, BRICK.joint])};
  const float FAC_LEVEL = ${f(LEVEL)};
  const float FAC_GRAIN = ${f(GRAIN)};
  const float FAC_WIN[${WINDOWS.length}] = float[${WINDOWS.length}](${WINDOWS.map((s) => f((1024 - s - WIN) / 1024)).join(", ")});
  const vec4 FAC_WIN_UV = vec4(${f(U0)}, ${f(DU)}, ${f(WIN / 1024)}, 0.0);
  vec3 facGlass = vec3(1.0); // glass reflection tint and strength
  vec3 facBend = vec3(0.0);  // world-space nudge to the normal

  // 1 on grid lines at whole numbers of x (half width w, pixel size aa, both in units); their average once units shrink.
  float facJoint(float x, float w, float aa) {
    float d = abs(fract(x + 0.5) - 0.5);
    return mix(1.0 - smoothstep(w - aa, w + aa, d), 2.0 * w, smoothstep(0.15, 0.4, aa));
  }

  vec3 facGlassTint(float seed) {
    float t = fract(seed * 7.13);
    return t < ${f(GLASS_SPLIT[0])} ? ${vec3(GLASS_TINTS[0])} : (t < ${f(GLASS_SPLIT[1])} ? ${vec3(GLASS_TINTS[1])} : ${vec3(GLASS_TINTS[2])});
  }

  vec3 facMasonry(vec3 pos, vec3 n, vec3 tint, float seed, sampler2D grainMap, out vec3 bend) {
    // Walls by (along, height), sills and caps by (x, z).
    vec2 t2 = normalize(vec2(-n.z, n.x) + vec2(1e-5, 0.0));
    bool horiz = abs(n.y) > 0.5;
    vec2 s = horiz ? pos.xz : vec2(dot(pos.xz, t2), pos.y);
    vec3 ax = horiz ? vec3(1.0, 0.0, 0.0) : vec3(t2.x, 0.0, t2.y);
    vec3 ay = horiz ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    float brick = tint.b < FAC_BRICK_BR * tint.r ? 1.0 : 0.0;
    vec3 k = brick > 0.5 ? FAC_BRICK : FAC_ASHLAR;
    vec2 q = s / k.xy;
    vec2 aa = fwidth(q);
    vec2 g = vec2(q.x + 0.5 * mod(floor(q.y), 2.0), q.y);
    vec2 cell = floor(g);
    vec2 f = g - cell;
    vec2 w = 0.5 * k.z / k.xy;
    vec2 j = vec2(facJoint(g.x, w.x, aa.x), facJoint(g.y, w.y, aa.y));
    float joint = 1.0 - (1.0 - j.x) * (1.0 - j.y);
    // per block (an exact per-cell value, kept small for sin())
    float h = fHash(mod(cell, 251.0) + seed * 17.0);
    float h2 = fract(h * 31.7);
    float h3 = fract(h * 57.3);
    // grain: a clean window of the stone texture, picked and flipped per block (bricks take half of it)
    vec2 lf = mix(f, 1.0 - f, step(0.5, vec2(h3, fract(h * 13.1))));
    vec2 uv = vec2(FAC_WIN_UV.x, FAC_WIN[int(h2 * ${f(WINDOWS.length)})]) + lf * FAC_WIN_UV.yz;
    float grain = fLuma(textureGrad(grainMap, uv, dFdx(q) * FAC_WIN_UV.yz, dFdy(q) * FAC_WIN_UV.yz).rgb) / FAC_GRAIN;
    grain = mix(1.0, grain, 1.0 - 0.5 * brick);
    // tone per block (calm for stone, livelier for brick), gone once blocks are a few pixels
    float near = 1.0 - smoothstep(0.15, 0.4, max(aa.x, aa.y));
    vec3 tone = 1.0 + near * (mix(0.04, 0.09, brick) * (2.0 * h - 1.0) + mix(0.012, 0.03, brick) * (2.0 * h3 - 1.0) * vec3(1.0, 0.0, -1.0));
    // stone joints are shadow; brick mortar is a pale sandy grey. The blocks make up for it, so the average stays the tint.
    vec3 mean = tint * FAC_LEVEL;
    vec3 mortar = brick > 0.5 ? mix(vec3(fLuma(mean)), mean, 0.3) * 1.5 : mean * 0.72;
    float share = 1.0 - (1.0 - 2.0 * w.x) * (1.0 - 2.0 * w.y);
    vec3 block = max((mean - share * mortar) / (1.0 - share), 0.0);
    // the groove: each side of a joint faces into it, only while the joint is a couple of pixels wide
    vec2 d = fract(g + 0.5) - 0.5;
    vec2 lean = -sign(d) * j * 0.5 * (1.0 - smoothstep(0.5, 1.0, max(aa.x / w.x, aa.y / w.y)));
    bend = ax * lean.x + ay * lean.y;
    return mix(block * grain * tone, mortar, joint);
  }

  vec3 facPane(vec3 tint, vec2 uv, float bar, float rnd, float seed, bool steel, out float cover, out vec3 glass) {
    vec2 p = fract(uv);
    vec2 aa = fwidth(uv) + 0.005;
    float r2 = fract(rnd * 31.7);
    float r3 = fract(rnd * 57.3);
    float t = fract(seed * 13.37);
    // Office blinds part way down (a quarter of sash windows, a few loft ones); curtains drawn to the sides on others.
    float drop = 1.0 - (0.15 + 0.35 * fract(rnd * 7.31));
    float blind = step(steel ? 0.85 : 0.75, rnd) * smoothstep(drop - aa.y, drop + aa.y, p.y);
    float cw = 0.1 + 0.1 * r3;
    float sides = max(1.0 - smoothstep(cw - aa.x, cw + aa.x, p.x), smoothstep(1.0 - cw - aa.x, 1.0 - cw + aa.x, p.x));
    float curtains = steel ? 0.0 : step(0.6, rnd) * step(rnd, 0.75) * sides;
    cover = max(blind, curtains) * (1.0 - bar);
    vec3 blindC = r2 < 0.4 ? vec3(0.42, 0.4, 0.35) : (r2 < 0.75 ? vec3(0.5, 0.49, 0.46) : vec3(0.3, 0.29, 0.27));
    vec3 coverC = rnd >= 0.75 ? blindC : vec3(0.3, 0.25, 0.2) * (0.85 + 0.3 * r2);
    // Glass: the tower's tint, a hair different per pane.
    vec3 tg = facGlassTint(seed) * (1.0 + 0.04 * (r3 - 0.5));
    vec3 room = tint * (0.5 + 0.3 * rnd) * (0.75 + 0.5 * p.y) * tg;
    // Frames per tower: sashes dark bronze or painted white, steel windows near black or dark green.
    vec3 frame = steel ? mix(vec3(0.035, 0.04, 0.045), vec3(0.03, 0.045, 0.04), step(0.5, t)) : mix(vec3(0.07, 0.055, 0.04), vec3(0.5, 0.49, 0.45), step(0.6, t));
    // The reveal: the head shades the top of the pane, one jamb its side.
    float shade = (1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.18, 1.0 - p.y))) * (1.0 - 0.2 * (1.0 - smoothstep(0.0, 0.2, p.x)));
    glass = mix(vec3(1.0), tg, 0.6) * (0.88 + 0.12 * r2) * mix(0.7, 1.0, shade);
    return mix(mix(room, coverC, cover), frame, bar) * shade;
  }

  // k: 1 for the full detail, 0 for plain glass (the Pyramid keeps its own look).
  vec3 facCurtain(vec3 tint, vec2 uv, vec3 n, float rnd, float spandrel, float mullion, float k, out vec3 glass, out vec3 bend) {
    vec2 p = fract(uv);
    float aa = fwidth(uv.y);
    float r2 = fract(rnd * 31.7);
    // Each pane a little lighter or darker, a hair warmer or cooler.
    vec3 c = tint * (0.62 + 0.12 * rnd) * (1.0 + k * 0.03 * (2.0 * r2 - 1.0) * vec3(1.0, 0.0, -1.0));
    // The ceiling void behind the top of each pane reads darker (its average once storeys get small).
    float plenum = mix(smoothstep(0.8 - aa, 0.8 + aa, p.y), 0.2, smoothstep(0.2, 0.5, aa));
    c *= 1.0 - k * 0.35 * plenum;
    // Shadow-box spandrels: the same glass over a dark panel.
    vec3 col = mix(mix(c, mix(tint * 0.3, c * 0.5, 0.5 * k), spandrel), vec3(0.5, 0.52, 0.54), mullion);
    glass = vec3(1.0 - k * 0.1 * fract(rnd * 5.3));
    // Oil-canning: each pane leans a little (a flat per-pane hash) and bows across.
    vec3 tx = normalize(vec3(-n.z, 0.0, n.x) + vec3(1e-5, 0.0, 0.0));
    vec3 ty = normalize(cross(n, tx));
    vec2 a = (vec2(fract(rnd * 17.3), fract(rnd * 43.1)) - 0.5) * ${f(2 * OIL_CANNING.tilt)} + (p - 0.5) * ${f(OIL_CANNING.pillow)};
    bend = (tx * a.x + ty * a.y) * (1.0 - spandrel) * (1.0 - mullion) * k;
    return col;
  }`;
