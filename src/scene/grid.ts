// The street grid and shoreline, shared by the city layout and Cuso's routes.

// Shoreline (x east, z south). Downtown is the north-east corner.
export const LAND: [number, number][] = [
  [-66, -28], [-84, -46], [-76, -53], [-52, -38], [-30, -35], [-10, -33], [5, -36], [20, -34], [31, -28],
  [31, 10], [31, 30], [26, 46], [0, 48], [-30, 47], [-63, 46], [-65, 10],
];

/** Land bounds, for the ground mesh and its texture. */
export const LAND_BOUNDS = { minX: -90, maxX: 45, minZ: -60, maxZ: 52 };

export const STREET = 3;
export const SIDEWALK = 0.9;
/** Street centre lines. The grid is SF-like: long blocks east to west. */
export const X_STREETS = [-67, -51, -35, -19, -3, 13, 29];
export const Z_STREETS = [-46, -36, -26, -16, -6, 4, 14, 24, 34, 44];

export function insideLand(x: number, z: number) {
  let inside = false;
  for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) {
    const [xi, zi] = LAND[i];
    const [xj, zj] = LAND[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Streets Cuso walks on. No cars here; sidewalks kept clear of trees and lamps. */
export const WALK_X = [-3, 29];
export const WALK_Z = [-6, 4, 14];
/** Cuso keeps to the south (z) or east (x) side of a walking street, clear of the cable cars. */
export const WALK_OFFSET = 1.6;

/** Half a street plus one sidewalk: where the kerb meets a block. */
export const EDGE = STREET / 2 + SIDEWALK;

/**
 * Parks: whole blocks [x0, x1, z0, z1] in street coordinates. Streets on a
 * park's edge stay open (with their sidewalk as the kerb); streets inside it
 * are closed, so a street that reaches a park always ends at a T junction.
 */
export const PARKS: [number, number, number, number][] = [
  [-67, -35, 14, 24], // Golden Gate Park
  [-51, -19, 24, 44], // Twin Peaks, open grass on top
  [-3, 13, -36, -16], // Pioneer Park on Telegraph Hill (Coit Tower)
  [-19, -3, 34, 44], // Dolores Park
];

const inParkBox = (x: number, z: number, inset: number) =>
  PARKS.some(([x0, x1, z0, z1]) => x > x0 + inset && x < x1 - inset && z > z0 + inset && z < z1 - inset);
/** Inside a park's kerb: lawn. */
export const inPark = (x: number, z: number) => inParkBox(x, z, EDGE);

export type Ground = "street" | "sidewalk" | "grass" | "block";

/**
 * What the ground is at x, z. The ground texture (groundMask) paints exactly this.
 * A street a park closes ends at the park's kerb line: its sidewalk runs on across it.
 */
export function groundAt(x: number, z: number): Ground {
  if (inPark(x, z)) return "grass";
  const d = Math.min(...X_STREETS.map((s) => Math.abs(x - s)), ...Z_STREETS.map((s) => Math.abs(z - s)));
  if (d < STREET / 2 && !inParkBox(x, z, STREET / 2)) return "street";
  return d < EDGE ? "sidewalk" : "block";
}

/** Kerb height: every street lies this far below its sidewalks (a house is about 4 tall). */
export const KERB = 0.14;
/** A curb ramp is flush with the street this far in from the kerb, then climbs to the sidewalk's back edge. */
const RAMP_FLAT = 0.15;

const openStreet = (x: number, z: number) => insideLand(x, z) && groundAt(x, z) === "street";

/** A zebra crosswalk: the rectangle it covers, and which way its bars run (along the street it crosses). */
export type Crosswalk = { x0: number; x1: number; z0: number; z1: number; along: "x" | "z" };

/**
 * Crosswalks at the junctions of the walking streets (where Cuso and the
 * people walk; elsewhere the corners keep a plain kerb, so the map stays
 * calm), each in line with the sidewalks it joins, and the corners they land
 * on, which get a curb ramp. A crosswalk only lands on real corners: both
 * streets open there (not where a park closes one, which leaves a straight
 * sidewalk).
 */
const { CROSSWALKS, RAMPS } = (() => {
  const crosswalks: Crosswalk[] = [];
  const ramps = new Set<string>();
  const leg = STREET / 2 + 0.1; // just past the cross street's kerb line
  for (const s of X_STREETS) {
    for (const t of Z_STREETS) {
      if (!openStreet(s, t) || !(WALK_X.includes(s) || WALK_Z.includes(t))) continue;
      const [w, e, n, so] = [openStreet(s - leg, t), openStreet(s + leg, t), openStreet(s, t - leg), openStreet(s, t + leg)];
      /** A crosswalk wholly on land (not out over the sea wall). */
      const ashore = ({ x0, x1, z0, z1 }: Crosswalk) => [x0, x1].every((x) => [z0, z1].every((z) => insideLand(x, z)));
      for (const side of [-1, 1]) {
        // across the x street, on the north (-1) or south (+1) side of the junction
        const [z0, z1] = side < 0 ? [t - EDGE, t - STREET / 2] : [t + STREET / 2, t + EDGE];
        const acrossX: Crosswalk = { x0: s - STREET / 2, x1: s + STREET / 2, z0, z1, along: "z" };
        if (w && e && (side < 0 ? n : so) && ashore(acrossX)) {
          crosswalks.push(acrossX);
          ramps.add(`${s},${t},-1,${side}`).add(`${s},${t},1,${side}`);
        }
        // across the z street, on the west (-1) or east (+1) side
        const [x0, x1] = side < 0 ? [s - EDGE, s - STREET / 2] : [s + STREET / 2, s + EDGE];
        const acrossZ: Crosswalk = { x0, x1, z0: t - STREET / 2, z1: t + STREET / 2, along: "x" };
        if (n && so && (side < 0 ? w : e) && ashore(acrossZ)) {
          crosswalks.push(acrossZ);
          ramps.add(`${s},${t},${side},-1`).add(`${s},${t},${side},1`);
        }
      }
    }
  }
  return { CROSSWALKS: crosswalks, RAMPS: ramps };
})();
export { CROSSWALKS };

const nearest = (list: number[], v: number) => list.reduce((a, b) => (Math.abs(v - b) < Math.abs(v - a) ? b : a));

/**
 * How far the ground is set down at x, z (the hills come on top, see
 * surfaceAt in terrain.ts): KERB on a street, 0 on sidewalks, blocks and
 * lawns, and on a corner where a crosswalk lands a curb ramp: the whole corner
 * dips to the street, flush along both kerbs near the corner, back up at the
 * sidewalk's back edges.
 */
export function streetDrop(x: number, z: number) {
  const kind = groundAt(x, z);
  if (kind === "street") return KERB;
  if (kind !== "sidewalk") return 0;
  const s = nearest(X_STREETS, x);
  const t = nearest(Z_STREETS, z);
  const a = Math.abs(x - s) - STREET / 2;
  const b = Math.abs(z - t) - STREET / 2;
  if (a < 0 || b < 0 || a > SIDEWALK || b > SIDEWALK || !RAMPS.has(`${s},${t},${Math.sign(x - s)},${Math.sign(z - t)}`)) return 0;
  return KERB * Math.min(1, Math.max(0, (SIDEWALK - Math.max(a, b)) / (SIDEWALK - RAMP_FLAT)));
}

/**
 * Dashed centre lines, street by street between junctions: [x0, z0, x1, z1].
 * They stop short of every junction and its crosswalks, and none runs on a
 * street a park closes (a T junction stays a T).
 */
export const LANE_MARKS: [number, number, number, number][] = (() => {
  const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
  const gap = EDGE + 0.3;
  const out: [number, number, number, number][] = [];
  const runs = (cross: number[], lo: number, hi: number) => {
    const stops = [lo - gap, ...cross, hi + gap];
    return stops.slice(1).map((b, i) => [stops[i] + gap, b - gap] as const).filter(([a, b]) => b - a > 0.5);
  };
  for (const x of X_STREETS) for (const [z0, z1] of runs(Z_STREETS, minZ, maxZ)) if (!inParkBox(x, (z0 + z1) / 2, STREET / 2)) out.push([x, z0, x, z1]);
  for (const z of Z_STREETS) for (const [x0, x1] of runs(X_STREETS, minX, maxX)) if (!inParkBox((x0 + x1) / 2, z, STREET / 2)) out.push([x0, z, x1, z]);
  return out;
})();
