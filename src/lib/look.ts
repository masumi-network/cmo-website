// The photo look (F13): how the post effects grade the city, per hour.
// Pure functions so they are easy to test; src/scene/post.tsx applies them.

export type RGB = readonly [number, number, number];

export type Look = {
  /** Depth of field strength (bokeh scale). 0 = off. */
  dof: number;
  /** World units around the focus over which things go from sharp to fully soft. */
  focusRange: number;
  /** The toy-model tilt-shift blur. 0 = off. */
  tilt: number;
  saturation: number;
  /** Grade after tone mapping, per channel: gain scales, lift raises the shadows. */
  gain: RGB;
  lift: RGB;
  /** 0 = none, 1 = a full S curve. */
  contrast: number;
  /** Film grain in the mid-tones. */
  grain: number;
  /** Studio fill (scene.environmentIntensity). Lower = deeper shadows. */
  env: number;
  /** Bloom strength, times this (1 = full). */
  bloom: number;
  /** A soft light on Cuso alone, from the camera (rig.ts). 0 = off. For shots where the sun is behind him. */
  cusoFill: number;
};

/** Today's look: the toy-model city. Every hour not tuned yet keeps it. */
export const TODAY: Look = {
  dof: 0,
  focusRange: 14,
  tilt: 0.04,
  saturation: 0.08,
  gain: [1, 1, 1],
  lift: [0, 0, 0],
  contrast: 0,
  grain: 0,
  env: 0.5,
  bloom: 1,
  cusoFill: 0,
};

// One look per chapter hour (F13). Each moves toward its concept (public/concepts): depth of field on Cuso,
// a warm grade, light grain, less studio fill so the shadows read. Hours run 6..30 like lightingAt (time.ts).

/** 06:00, Russian Hill: a low sun beside the Golden Gate, warm light, cool shadows. */
const SUNRISE: Look = {
  dof: 1.4,
  focusRange: 14,
  tilt: 0,
  saturation: 0.08,
  gain: [1.05, 1, 0.92],
  lift: [0.012, 0.016, 0.03],
  contrast: 0.2,
  grain: 0.035,
  env: 0.32,
  // the sun glints off the bay in frame: a softer bloom keeps it from blowing out
  bloom: 0.8,
  // the sun is behind him: without it his face goes grey
  cusoFill: 1.2,
};

/** 07:00, Hayes Valley: soft warm morning, mist up the street. */
const MORNING: Look = {
  dof: 1.5,
  focusRange: 14,
  tilt: 0,
  saturation: 0.06,
  gain: [1.07, 1.03, 0.97],
  lift: [0.012, 0.016, 0.028],
  contrast: 0.16,
  grain: 0.035,
  env: 0.45,
  bloom: 1,
  cusoFill: 0,
};

/** 09:00, the Mission: bright, warm, crisp shadows on the mural wall. */
const LATE_MORNING: Look = {
  dof: 1.5,
  focusRange: 14,
  tilt: 0,
  saturation: 0.08,
  gain: [1.04, 1, 0.92],
  lift: [0.02, 0.015, 0.01],
  contrast: 0.18,
  grain: 0.035,
  env: 0.38,
  bloom: 1,
  cusoFill: 0,
};

/** 12:00, Union Square: the look test. Restrained and photographic. */
export const NOON: Look = {
  dof: 1.5,
  focusRange: 14,
  tilt: 0,
  saturation: 0.05,
  gain: [1.03, 1, 0.94],
  lift: [0.02, 0.015, 0.01],
  contrast: 0.18,
  grain: 0.035,
  env: 0.38,
  bloom: 1,
  cusoFill: 0,
};

/** 15:00, on the Pyramid: golden afternoon, the city soft far below. */
const AFTERNOON: Look = {
  dof: 1.3,
  focusRange: 14,
  tilt: 0,
  saturation: 0.06,
  gain: [1.05, 1, 0.92],
  lift: [0.022, 0.017, 0.01],
  contrast: 0.16,
  grain: 0.035,
  env: 0.38,
  bloom: 1,
  cusoFill: 0,
};

/** 18:00, the Ferry Building: sunset, deep orange, long shadows. */
const SUNSET: Look = {
  dof: 1.5,
  focusRange: 14,
  tilt: 0,
  saturation: 0.1,
  gain: [1.07, 0.99, 0.86],
  lift: [0.035, 0.022, 0.014],
  contrast: 0.2,
  grain: 0.04,
  env: 0.38,
  bloom: 1,
  cusoFill: 0,
};

/** 22:00, the Embarcadero: blue night, the lamps and windows warm. */
const NIGHT: Look = {
  dof: 1.5,
  focusRange: 14,
  tilt: 0,
  saturation: 0.06,
  gain: [1.03, 1, 0.98],
  lift: [0.008, 0.01, 0.022],
  contrast: 0.14,
  grain: 0.045,
  env: 0.45,
  bloom: 1,
  cusoFill: 0,
};

/** 06:00 tomorrow, high over Russian Hill: the sunrise again, the city a soft miniature. */
const FINALE: Look = { ...SUNRISE, dof: 1, focusRange: 24, saturation: 0.12, gain: [1.03, 0.98, 0.9], contrast: 0.24, bloom: 1, cusoFill: 0 };

const KEYS: [number, Look][] = [
  [6, SUNRISE],
  [7, MORNING],
  [9, LATE_MORNING],
  [12, NOON],
  [15, AFTERNOON],
  [18, SUNSET],
  [22, NIGHT],
  [30, FINALE],
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function lookFor(hour: number): Look {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = clamp01((h - h0) / (h1 - h0));
  if (a === b || t === 0) return a;
  if (t === 1) return b;
  return {
    dof: mix(a.dof, b.dof, t),
    focusRange: mix(a.focusRange, b.focusRange, t),
    tilt: mix(a.tilt, b.tilt, t),
    saturation: mix(a.saturation, b.saturation, t),
    gain: mix3(a.gain, b.gain, t),
    lift: mix3(a.lift, b.lift, t),
    contrast: mix(a.contrast, b.contrast, t),
    grain: mix(a.grain, b.grain, t),
    env: mix(a.env, b.env, t),
    bloom: mix(a.bloom, b.bloom, t),
    cusoFill: mix(a.cusoFill, b.cusoFill, t),
  };
}

/** Phones and weak GPUs: the grade and the grain (nearly free), no depth of field. */
export const liteLook = (look: Look): Look => ({ ...look, dof: 0 });

/** Depth of field fades out as the camera rises over the city (`overhead` 0..1; 1 in Explore). */
export const dofAmount = (look: Look, overhead: number) => look.dof * (1 - clamp01(overhead));

/** Cuso is ~1.9 tall: focus on his middle. */
const CUSO_MIDDLE = 0.95;
/** Farther than this, or off to the side, he is not the subject (a flight over the roofs). */
const FOCUS_MAX = 40;
const FOCUS_CONE = 0.8; // cos of ~37 degrees off the view axis

type V3 = { x: number; y: number; z: number };

/**
 * How far to focus: on Cuso's middle while he is in front of the camera and near, else on what the camera
 * looks at. `forward` is the camera's unit view direction; `cuso` his feet, null until he is placed.
 */
export function focusGoal(camera: V3, forward: V3, cuso: V3 | null, target: V3): number {
  const dist = (p: V3, dy = 0) => Math.hypot(p.x - camera.x, p.y + dy - camera.y, p.z - camera.z);
  if (cuso) {
    const d = dist(cuso, CUSO_MIDDLE);
    const ahead = (cuso.x - camera.x) * forward.x + (cuso.y + CUSO_MIDDLE - camera.y) * forward.y + (cuso.z - camera.z) * forward.z;
    if (d < FOCUS_MAX && ahead > 1 && ahead > FOCUS_CONE * d) return d;
  }
  return dist(target);
}

/** Eases the focus toward `goal` like a lens pulling focus. Starts on the goal. */
export function stepFocus(current: number | null, goal: number, dt: number) {
  if (current === null || !Number.isFinite(current)) return goal;
  return current + (goal - current) * (1 - Math.exp(-4 * dt));
}

/** Blur 0..1 at `distance` (the depth of field shader's circle of confusion). */
export const coc = (distance: number, focus: number, range: number) => smoothstep(0, range, Math.abs(distance - focus));

/**
 * The grade, as the shader does it (grade.ts), on a tone-mapped linear colour: into a display-like curve,
 * gain and lift, a gentle S curve, grain in the mid-tones (`noise` 0..1), and back.
 */
export function gradePixel(rgb: RGB, look: Look, noise: number): RGB {
  const out = rgb.map((v, i) => {
    let p = Math.sqrt(clamp01(v));
    p = clamp01(p * look.gain[i] + look.lift[i] * (1 - p));
    p = mix(p, p * p * (3 - 2 * p), look.contrast);
    p = clamp01(p + (noise - 0.5) * look.grain * 4 * p * (1 - p));
    return p * p;
  });
  return [out[0], out[1], out[2]];
}

/** A pass draws until every shader is compiled (behind the poster), then only while it does something. */
export const passOn = (amount: number, ready: boolean) => !ready || amount > 0;
