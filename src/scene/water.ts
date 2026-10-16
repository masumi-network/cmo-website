// The water's reflections and ripples (bay.tsx), as numbers and pure functions.
// The shader is built from the same numbers (`*_GLSL` below), so the tests in
// tests/unit/water.test.ts check what the screen shows.

export type RGB = readonly [number, number, number];

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const f = (v: number) => v.toFixed(4);

// ---------------------------------------------------------------------------
// Per hour.

/**
 * `smear`: how far the mirror's samples spread down the screen at a grazing
 * view (screen fraction): long streaks under the 22:00 lights, short by day.
 * `sky`: how much grazing waves show the sky's gradient (0 = as before).
 */
export type WaterHour = { smear: number; sky: number };

/** Hours run 6..30 like the look (look.ts): 30 is 06:00 the next morning. */
export const WATER_HOURS: [number, WaterHour][] = [
  [6, { smear: 0.012, sky: 1 }],
  [7, { smear: 0.01, sky: 0.7 }],
  [9, { smear: 0.009, sky: 0.5 }],
  [12, { smear: 0.009, sky: 0.5 }],
  [15, { smear: 0.01, sky: 0.6 }],
  [18, { smear: 0.015, sky: 1 }],
  [22, { smear: 0.045, sky: 0.6 }],
  [30, { smear: 0.012, sky: 1 }],
];

export function waterAt(hour: number): WaterHour {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < WATER_HOURS.length - 2 && WATER_HOURS[i + 1][0] <= h) i++;
  const [h0, a] = WATER_HOURS[i];
  const [h1, b] = WATER_HOURS[i + 1];
  const t = clamp((h - h0) / (h1 - h0), 0, 1);
  return { smear: mix(a.smear, b.smear, t), sky: mix(a.sky, b.sky, t) };
}

// ---------------------------------------------------------------------------
// Ripples (item 2): three layers of the same tileable texture.

/**
 * `scale`: texture repeats per metre; `turn`: degrees the layer is turned; `drift`: uv per second.
 * `weight`: its share of the surface's slope; `mirror`: its share of how far it moves the mirror (fine
 * chop there breaks the streaks into speckle).
 */
export const CHOP = [
  { scale: 0.043, offset: [0, 0], drift: [0.011, 0.004], weight: 0.45, mirror: 0.45, turn: 0 },
  { scale: 0.117, offset: [0.37, 0.71], drift: [-0.006, 0.015], weight: 0.35, mirror: 0.35, turn: 0 },
  // the fine chop: 2.9 m, turned so its waves don't line up with the others
  { scale: 0.345, offset: [0.13, 0.52], drift: [0.021, -0.017], weight: 0.3, mirror: 0.1, turn: 37 },
] as const;
export const CHOP_GAIN = 0.3;
/** How the ripples flatten with distance (the texture's mipmaps flatten what they can't show already). */
export const CALM = { amount: 0.55, near: 25, far: 220 };
export const calm = (distance: number) => 1 - CALM.amount * smoothstep(CALM.near, CALM.far, distance);

/** Sets `vec2 slope` and `mirrorSlope` (and r1, r2, r3: each layer's own) from `wp` (world xz), `uTime` and `camDist`. */
export const CHOP_GLSL = CHOP.map((l, i) => {
  const a = (l.turn * Math.PI) / 180;
  // a turned layer: look up at R * wp, turn its slope back with the transpose (v * R)
  const R = l.turn ? `mat2(${f(Math.cos(a))}, ${f(Math.sin(a))}, ${f(-Math.sin(a))}, ${f(Math.cos(a))})` : "";
  const uv = `${R ? `${R} * ` : ""}wp * ${f(l.scale)} + vec2(${f(l.offset[0])}, ${f(l.offset[1])}) + uTime * vec2(${f(l.drift[0])}, ${f(l.drift[1])})`;
  return `vec2 r${i + 1} = (texture2D(uRipples, ${uv}).xy * 2.0 - 1.0)${R ? ` * ${R}` : ""};`;
})
  .concat(
    `float calm = 1.0 - ${f(CALM.amount)} * smoothstep(${f(CALM.near)}, ${f(CALM.far)}, camDist);`,
    `vec2 slope = (${CHOP.map((l, i) => `r${i + 1} * ${f(l.weight)}`).join(" + ")}) * ${f(CHOP_GAIN)} * calm;`,
    `vec2 mirrorSlope = (${CHOP.map((l, i) => `r${i + 1} * ${f(l.mirror)}`).join(" + ")}) * ${f(CHOP_GAIN)} * calm;`,
  )
  .join("\n");

// ---------------------------------------------------------------------------
// Mirror smear (item 1, full mode).

export const SMEAR = {
  /** Sideways: slope x side / (w + 8), w the mirror's clip w (about the distance). Half of before. */
  side: 0.3,
  /** Toward the camera: bigger, times `graze`, falling off as 1 / (fall x w + 8), slower than sideways. */
  toward: 0.8,
  fall: 0.3,
  /** 1 / view y (a tilt toward the viewer moves the reflected ray most at grazing angles), capped here. */
  graze: 6,
  /** The furthest the ripples move the mirror, screen fraction. */
  max: 0.04,
  /** Samples along the screen's vertical, in units of the spread, and their weights. */
  taps: [
    [0, 0.34],
    [1, 0.22],
    [-1, 0.22],
    [2.2, 0.22],
  ] as [number, number][],
};

/** How far a ripple moves the mirror on screen: [sideways, vertical]. `side`/`toward`: slope across / along the view; `viewY`: the view ray's up component. */
export function mirrorShift(side: number, toward: number, viewY: number, w: number): [number, number] {
  const graze = clamp(1 / Math.max(viewY, 1e-3), 1, SMEAR.graze);
  return [clamp((side * SMEAR.side) / (w + 8), -SMEAR.max, SMEAR.max), clamp((toward * SMEAR.toward * graze) / (SMEAR.fall * w + 8), -SMEAR.max, SMEAR.max)];
}

/** How far apart the smear's samples are: the hour's `smear`, none from straight above, varied by the ripple (-1..1). */
export const smearSpread = (smear: number, viewY: number, ripple: number) => smear * (1 - clamp(viewY, 0, 1)) * (0.75 + 0.25 * ripple);

/** Sets `vec4 mirrored` from vMirror, mirrorSlope, V, r2 and uSmear. Mirrors mirrorShift and smearSpread. */
export const SMEAR_GLSL = /* glsl */ `
  vec2 camRt = normalize(vec2(viewMatrix[0][0], viewMatrix[2][0]));
  vec2 camFw = vec2(-camRt.y, camRt.x);
  float graze = clamp(1.0 / max(V.y, 1e-3), 1.0, ${f(SMEAR.graze)});
  vec2 shift = clamp(vec2(dot(mirrorSlope, camRt) * ${f(SMEAR.side)} / (vMirror.w + 8.0), dot(mirrorSlope, camFw) * ${f(SMEAR.toward)} * graze / (${f(SMEAR.fall)} * vMirror.w + 8.0)), -${f(SMEAR.max)}, ${f(SMEAR.max)});
  vec2 uv0 = vMirror.xy / vMirror.w + shift;
  float spread = uSmear * (1.0 - clamp(V.y, 0.0, 1.0)) * (0.75 + 0.25 * r2.y);
  vec4 mirrored = ${SMEAR.taps.map(([o, k]) => `${f(k)} * texture2D(uMirror, uv0 + vec2(0.0, ${f(o)} * spread))`).join("\n    + ")};`;

// ---------------------------------------------------------------------------
// The sky in the waves (item 4).

export const SKY = {
  /** How much of the ripple slope the sky gradient sees: before, and at a grazing view. */
  slope: [0.4, 0.65],
  /** The reflected ray's height is stretched by this: 1.8 puts the gradient's top (R.y 0.55) about 18 degrees up. */
  span: [1, 1.8],
  /** View ray heights (up component) between which it fades from grazing to as before. */
  graze: [0.1, 0.35],
};

export function skyShape(viewY: number, sky: number) {
  const k = sky * (1 - smoothstep(SKY.graze[0], SKY.graze[1], viewY));
  return { slope: mix(SKY.slope[0], SKY.slope[1], k), span: mix(SKY.span[0], SKY.span[1], k) };
}

/** Sets `vec3 R`, the ray the sky gradient sees, from V, slope and uSky. Mirrors skyShape. */
export const SKY_GLSL = /* glsl */ `
  float skyK = uSky * (1.0 - smoothstep(${f(SKY.graze[0])}, ${f(SKY.graze[1])}, V.y));
  vec2 skySlope = slope * mix(${f(SKY.slope[0])}, ${f(SKY.slope[1])}, skyK);
  vec3 R = reflect(-V, normalize(vec3(skySlope.x, 1.0, skySlope.y)));
  R.y *= mix(${f(SKY.span[0])}, ${f(SKY.span[1])}, skyK);`;

// ---------------------------------------------------------------------------
// Phones: the glass probe in the water (item 3, lite mode, no mirror).

/** Horizontal distance from the probe (reflections.ts, over the chapter's subject) over which it fades to the gradient. */
export const PROBE_FADE = { near: 15, far: 45 };
export const probeFade = (distance: number) => 1 - smoothstep(PROBE_FADE.near, PROBE_FADE.far, distance);

/** The probe where it is near, never darker than the gradient: night water never goes black. */
export const phoneReflection = (gradient: RGB, probe: RGB, fade: number): RGB =>
  gradient.map((g, i) => mix(g, Math.max(g, probe[i]), fade)) as unknown as RGB;

/** Changes `reflection` (the gradient) to phoneReflection. Needs uGlassEnv, uGlassMix, uProbePos, slope, V, camDist. */
export const PROBE_GLSL = /* glsl */ `
  float near = uGlassMix * (1.0 - smoothstep(${f(PROBE_FADE.near)}, ${f(PROBE_FADE.far)}, distance(vWorld.xz, uProbePos.xz)));
  // only near the probe: most of the water on screen skips the look-up
  if (near > 0.0) {
    vec3 Rp = reflect(-V, normalize(vec3(slope.x * 0.8, 1.0, slope.y * 0.8)));
    Rp.y = max(Rp.y, 0.01);
    vec3 probe = textureLod(uGlassEnv, Rp, mix(1.0, 3.0, smoothstep(10.0, 250.0, camDist))).rgb;
    reflection = mix(reflection, max(reflection, probe), near);
  }`;

// ---------------------------------------------------------------------------
// A leaner mirror (item 5).

/**
 * Material keys (customProgramCacheKey) the mirror leaves out on the city's
 * land (`onLand`: the mesh's middle): houses, the street ground, trees, shop
 * glass, small wood. From the water they hide behind the sea wall or are too
 * small to read. The same materials on the islands (Alcatraz's cellhouse)
 * stand at the water and stay, as do the sea wall, towers, landmarks, the
 * pier, the boats and the coast.
 */
export const LEAN_SKIP = ["house", "ground", "tree-leaves", "tree-bark", "shop-glass", "wood"];
/** Cuso, wherever he walks: his body's material and his eyes (their own meshes). */
const CUSO = { key: "cuso-back-fill", names: ["EyeL", "EyeR"] };
export const leanSkip = (key: string, name: string, onLand: boolean) => (onLand && LEAN_SKIP.includes(key)) || key === CUSO.key || CUSO.names.includes(name);

/** Camera height over the water (m) over which the mirror fades out: from high up it is a few pixels. */
export const MIRROR_HEIGHT = [55, 75];
/** 1 = draw the mirror, 0 = skip it (Explore, high overhead); in between it fades. */
export const mirrorWanted = (height: number, explore: boolean) => (explore ? 0 : 1 - smoothstep(MIRROR_HEIGHT[0], MIRROR_HEIGHT[1], height));
