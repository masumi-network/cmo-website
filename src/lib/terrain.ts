// The hills of the miniature San Francisco: a sum of smooth bumps, flat in
// between. Everything that stands on the ground asks heightAt().

type Hill = [x: number, z: number, height: number, radius: number];

const HILLS: Hill[] = [
  [-15, -16, 7, 9], // Russian Hill (the 06:00 rooftop)
  [-8, -6, 4, 8], // Nob Hill
  [2, -26, 6, 5.5], // Telegraph Hill (Coit Tower)
  [-34, 30, 10, 8], // Twin Peaks
  [-44, -20, 4, 12], // Pacific Heights
];

export function heightAt(x: number, z: number) {
  let h = 0;
  for (const [hx, hz, a, r] of HILLS) h += a * Math.exp(-((x - hx) ** 2 + (z - hz) ** 2) / (r * r));
  return h;
}

/** A point `y` above the ground at x, z. */
export const at = (x: number, y: number, z: number): readonly [number, number, number] => [x, y + heightAt(x, z), z];

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
const MARIN_ROAD_CTRL: [number, number][] = [[-80, -152], [-80, -162], [-83, -172], [-90, -184], [-100, -196], [-112, -206], [-126, -214]];
const MAX_GRADE = 0.18;

export const MARIN_ROAD: [number, number, number][] = (() => {
  const xz: [number, number][] = [];
  for (let i = 0; i < MARIN_ROAD_CTRL.length - 1; i++) {
    const [ax, az] = MARIN_ROAD_CTRL[i];
    const [bx, bz] = MARIN_ROAD_CTRL[i + 1];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az));
    for (let k = 0; k < n; k++) xz.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  xz.push(MARIN_ROAD_CTRL[MARIN_ROAD_CTRL.length - 1]);
  // Follow the hills, but never steeper than MAX_GRADE (forward, then backward).
  const y = xz.map(([x, z]) => Math.max(rawHeadland(x, z), -0.2) + 0.3);
  y[0] = 7;
  for (let i = 1; i < y.length; i++) y[i] = Math.min(Math.max(y[i], y[i - 1] - MAX_GRADE), y[i - 1] + MAX_GRADE);
  for (let i = y.length - 2; i > 0; i--) y[i] = Math.min(Math.max(y[i], y[i + 1] - MAX_GRADE), y[i + 1] + MAX_GRADE);
  y[0] = 7;
  return xz.map(([x, z], i) => [x, y[i], z]);
})();

export function headlandHeight(x: number, z: number) {
  const raw = rawHeadland(x, z);
  if (raw <= -1.5 || z > -146) return raw;
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

