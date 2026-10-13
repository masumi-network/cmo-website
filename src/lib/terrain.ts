// The hills of the miniature San Francisco, flat in between. Everything that
// stands on the ground asks heightAt() (sidewalks, blocks, lawns), or
// surfaceAt() where it may stand on a street (a kerb lower: cars, Cuso).
//
// Each hill is a smooth dome on an ellipse that is exactly flat outside it, so
// the flat places (the shop, the wall, the cable car) stay flat. Sizes keep
// every street at or under MAX_STREET_GRADE (tested): SF streets climb straight
// up, but never a wall. The steep tops (Telegraph Hill, Twin Peaks) are parks.

import { streetDrop } from "@/scene/grid";

/** [x, z, height, radius x, radius z]. */
type Hill = [x: number, z: number, height: number, rx: number, rz: number];

/** Steepest a street or sidewalk may get (rise over run). SF's steepest are about 0.32. */
export const MAX_STREET_GRADE = 0.36;

const HILLS: Hill[] = [
  [-15, -13, 3.8, 17, 18], // Russian Hill (the 06:00 rooftop)
  [-3, 6, 1.8, 9, 9], // Nob Hill, a low round top west of downtown
  [4.5, -28.5, 3.6, 17, 18], // Telegraph Hill by the bay ...
  [2, -26, 1.1, 2.6, 2.6], // ... and its knob under Coit Tower (in Pioneer Park)
  [-47, -22, 3, 22, 14], // Pacific Heights, a long east to west ridge
  [-35, 33, 2, 30, 18], // Twin Peaks: a wide base ...
  [-35, 34, 1.6, 13.6, 7.6], // ... the steep part, inside its park ...
  [-40.5, 34, 1.8, 6, 5.5], // ... and the two peaks
  [-30, 34.5, 1.5, 6, 5.5],
];

function hills(x: number, z: number) {
  let h = 0;
  for (const [hx, hz, a, rx, rz] of HILLS) {
    const q = ((x - hx) / rx) ** 2 + ((z - hz) / rz) ** 2;
    if (q < 1) h += a * (1 - q) ** 2;
  }
  return h;
}

/**
 * The Transamerica Pyramid's plaza (centre 6.5, -11): the foot of Telegraph
 * Hill cut level at the hill's height under the centre, over the footprint
 * (half 3.4) and a small apron. The north edge runs just inside the sidewalk's
 * kerb line, the south edge is the footprint's (the ground there is flat
 * already). The cut's edges are crisp steps: ground.ts doubles their grid lines
 * and pyramid.tsx builds the retaining walls.
 */
export const PLAZA = { x0: 2.9, x1: 10.1, z0: -14.45, z1: -7.6, y: hills(6.5, -11) };
const inPlaza = (x: number, z: number) => x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z <= PLAZA.z1;

export function heightAt(x: number, z: number) {
  return inPlaza(x, z) ? PLAZA.y : hills(x, z);
}

/**
 * The ground surface people and cars stand on: the hills, with the streets
 * set down KERB below their sidewalks (and curb ramps at the crosswalks).
 * Buildings, trees and lamps stand on sidewalks and blocks, where it is heightAt.
 */
export const surfaceAt = (x: number, z: number) => heightAt(x, z) - streetDrop(x, z);

/** A point `y` above the ground surface at x, z. */
export const at = (x: number, y: number, z: number): readonly [number, number, number] => [x, y + surfaceAt(x, z), z];

// Marin Headlands across the Golden Gate (outside the city land).
function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridges(x: number, z: number) {
  let h = 0;
  let amp = 1;
  let f = 1 / 55;
  for (let o = 0; o < 4; o++) {
    const n = valueNoise(x * f, z * f);
    h += amp * (o === 0 ? n : 1 - Math.abs(n * 2 - 1)); // rolling base, soft ridges on top
    amp *= 0.45;
    f *= 2.1;
  }
  return h / 1.7;
}
/** North shore of the strait; it bends north where the bridge lands (x -80). */
const marinShore = (x: number) => -128 - 25 * Math.exp(-(((x + 80) / 24) ** 2));

function rawHeadland(x: number, z: number) {
  const shore = marinShore(x);
  if (z > shore) return -1.5;
  const t = Math.min(1, (shore - z) / 34);
  const rise = t * t * (3 - 2 * t);
  return -1.5 + rise * (5 + 20 * ridges(x, z));
}

/**
 * The road from the Golden Gate's north end into the headlands. Like a real
 * road it cuts and fills: its grade is limited, and the hills are carved
 * around it (see headlandHeight).
 */
// It runs on north-west over the ridges and out of sight into the fog (the headlands end at z -290).
const MARIN_ROAD_CTRL: [number, number][] = [[-80, -152], [-80, -162], [-83, -172], [-90, -184], [-100, -196], [-112, -206], [-126, -214], [-141, -224], [-154, -238], [-164, -254], [-171, -272], [-174, -288]];
const MARIN_GRADE = 0.18;

/** The deck's road surface; the first few units stay level with it. */
const MARIN_DECK = 7;
const MARIN_LEVEL = 4;

export const MARIN_ROAD: [number, number, number][] = (() => {
  // Smooth curves through the control points (Catmull-Rom), about one point per unit.
  const c = (i: number) => MARIN_ROAD_CTRL[Math.min(MARIN_ROAD_CTRL.length - 1, Math.max(0, i))];
  const xz: [number, number][] = [];
  for (let i = 0; i < MARIN_ROAD_CTRL.length - 1; i++) {
    const [p0, p1, p2, p3] = [c(i - 1), c(i), c(i + 1), c(i + 2)];
    const n = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const f = (a: number, b: number, d: number, e: number) => 0.5 * (2 * b + (d - a) * t + (2 * a - 5 * b + 4 * d - e) * t * t + (3 * b - a - 3 * d + e) * t * t * t);
      xz.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  xz.push(MARIN_ROAD_CTRL[MARIN_ROAD_CTRL.length - 1]);
  // Follow the hills, but never steeper than MARIN_GRADE (forward, then backward)...
  const y = xz.map(([x, z], i) => (i < MARIN_LEVEL ? MARIN_DECK : Math.max(rawHeadland(x, z), -0.2) + 0.3));
  for (let i = MARIN_LEVEL; i < y.length; i++) y[i] = Math.min(Math.max(y[i], y[i - 1] - MARIN_GRADE), y[i - 1] + MARIN_GRADE);
  for (let i = y.length - 2; i >= MARIN_LEVEL; i--) y[i] = Math.min(Math.max(y[i], y[i + 1] - MARIN_GRADE), y[i + 1] + MARIN_GRADE);
  // ... then round off the crests and dips (a 5 point average keeps the grade limit).
  const at = (i: number) => y[Math.min(y.length - 1, Math.max(0, i))];
  const smooth = y.map((_, i) => (at(i - 2) + at(i - 1) + at(i) + at(i + 1) + at(i + 2)) / 5);
  return xz.map(([x, z], i) => [x, smooth[i], z]);
})();

/** Where the carve can reach (the road plus its 6 unit blend), so the rest of the hills skip the search. */
const MARIN_BOX = {
  x0: Math.min(...MARIN_ROAD.map(([x]) => x)) - 6,
  x1: Math.max(...MARIN_ROAD.map(([x]) => x)) + 6,
  z0: Math.min(...MARIN_ROAD.map(([, , z]) => z)) - 6,
};

export function headlandHeight(x: number, z: number) {
  const raw = rawHeadland(x, z);
  if (raw <= -1.5 || z > -146 || x < MARIN_BOX.x0 || x > MARIN_BOX.x1 || z < MARIN_BOX.z0) return raw;
  // Carve the roadbed: within 2 units the ground meets the road; it blends out by 6.
  let best = Infinity;
  let roadY = 0;
  for (const [rx, ry, rz] of MARIN_ROAD) {
    const d = (rx - x) ** 2 + (rz - z) ** 2;
    if (d < best) {
      best = d;
      roadY = ry;
    }
  }
  const d = Math.sqrt(best);
  if (d > 6) return raw;
  const w = 1 - Math.min(1, Math.max(0, (d - 2) / 4));
  const k = w * w * (3 - 2 * w);
  return raw + (roadY - 0.3 - raw) * k;
}

