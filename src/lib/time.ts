// Scroll progress -> where Cuso is, and hour -> how the city is lit.
// Pure functions so they are easy to test.

/** Part of each section where the scene rests before moving on. */
const REST = 0.45;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * `progress` is scroll position in sections (2.5 = halfway through section 2).
 * Returns the chapter we leave, the one we go to, and eased travel 0..1.
 */
export function travel(progress: number, count: number) {
  const last = count - 1;
  if (progress >= last) return { from: last, to: last, t: 0 };
  const p = Math.max(0, progress);
  const from = Math.floor(p);
  return { from, to: from + 1, t: smoothstep(REST, 1, p - from) };
}

/** The chapter the HUD highlights. */
export function activeIndex(progress: number, count: number) {
  const { from, to, t } = travel(progress, count);
  return t < 0.5 ? from : to;
}

export function mixHex(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255;
    const y = (pb >> shift) & 255;
    return Math.round(x + (y - x) * t);
  };
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

export type Lighting = {
  /** Degrees above the horizon. Negative is the moon's turn. */
  elevation: number;
  /** Degrees around Y: 0 = south, 90 = east, 180 = north. */
  azimuth: number;
  sunColor: string;
  sunIntensity: number;
  skyTop: string;
  skyHorizon: string;
  fog: string;
  ambient: number;
  /** 0 = day, 1 = night (window lights, street lamps, bridge lights). */
  night: number;
};

// Art-directed keyframes, not astronomy. Hours run 6..30 (30 = 06:00 next day).
const KEYS: [number, Lighting][] = [
  // 06:00 opening shot: the low sun sits in the frame's upper left corner, by the title, so it backlights the
  // scene warm without glaring in the middle, and its glint on the bay falls low on the left. A fifth dimmer than the finale's.
  [6, { elevation: 14, azimuth: 250, sunColor: "#ffa456", sunIntensity: 2.88, skyTop: "#5583cc", skyHorizon: "#f7c08c", fog: "#eec9a6", ambient: 0.4, night: 0 }],
  [7, { elevation: 14, azimuth: 60, sunColor: "#ffcc98", sunIntensity: 3.5, skyTop: "#6d9ee0", skyHorizon: "#f0dcc6", fog: "#e6dfd6", ambient: 0.47, night: 0 }],
  [9, { elevation: 55, azimuth: 90, sunColor: "#ffe6c4", sunIntensity: 3.5, skyTop: "#6f9ee0", skyHorizon: "#dce5ee", fog: "#e8e5de", ambient: 0.45, night: 0 }],
  // 12:00 is the photo look test (F13): warm sun from the side, less fill, so shapes read.
  [12, { elevation: 54, azimuth: 50, sunColor: "#fff1dc", sunIntensity: 3.9, skyTop: "#5b8fe0", skyHorizon: "#cfe0f4", fog: "#dbe6f0", ambient: 0.45, night: 0 }],
  [15, { elevation: 28, azimuth: 0, sunColor: "#ffe4be", sunIntensity: 3.5, skyTop: "#6396e0", skyHorizon: "#cddcec", fog: "#dfe2e2", ambient: 0.45, night: 0 }],
  [18, { elevation: 12, azimuth: -30, sunColor: "#ff9548", sunIntensity: 3.2, skyTop: "#7c8ec8", skyHorizon: "#f7b47c", fog: "#f0c39c", ambient: 0.42, night: 0.15 }],
  [20, { elevation: 0, azimuth: -40, sunColor: "#8f8cc8", sunIntensity: 0.08, skyTop: "#232c5c", skyHorizon: "#a77f8f", fog: "#4b4566", ambient: 0.3, night: 0.7 }],
  [22, { elevation: -20, azimuth: 60, sunColor: "#9fb3ff", sunIntensity: 0.6, skyTop: "#0b1028", skyHorizon: "#4a3d74", fog: "#1e2142", ambient: 0.22, night: 1 }],
  [26, { elevation: 0, azimuth: 230, sunColor: "#9fb3ff", sunIntensity: 0.05, skyTop: "#070b1d", skyHorizon: "#1d2650", fog: "#10152b", ambient: 0.2, night: 1 }],
  [30, { elevation: 8, azimuth: 240, sunColor: "#ffa456", sunIntensity: 3.6, skyTop: "#5583cc", skyHorizon: "#f7c08c", fog: "#eec9a6", ambient: 0.42, night: 0 }],
];

export function lightingAt(hour: number): Lighting {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = clamp((h - h0) / (h1 - h0), 0, 1);
  if (t === 0) return a;
  if (t === 1) return b;
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    elevation: n(a.elevation, b.elevation),
    azimuth: n(a.azimuth, b.azimuth),
    sunColor: mixHex(a.sunColor, b.sunColor, t),
    sunIntensity: n(a.sunIntensity, b.sunIntensity),
    skyTop: mixHex(a.skyTop, b.skyTop, t),
    skyHorizon: mixHex(a.skyHorizon, b.skyHorizon, t),
    fog: mixHex(a.fog, b.fog, t),
    ambient: n(a.ambient, b.ambient),
    night: n(a.night, b.night),
  };
}
