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

/** Inside a park's kerb: lawn. */
export const inPark = (x: number, z: number) =>
  PARKS.some(([x0, x1, z0, z1]) => x > x0 + EDGE && x < x1 - EDGE && z > z0 + EDGE && z < z1 - EDGE);

export type Ground = "street" | "sidewalk" | "grass" | "block";

/** What the ground is at x, z. The ground texture (groundMask) paints exactly this. */
export function groundAt(x: number, z: number): Ground {
  if (inPark(x, z)) return "grass";
  const d = Math.min(...X_STREETS.map((s) => Math.abs(x - s)), ...Z_STREETS.map((s) => Math.abs(z - s)));
  return d < STREET / 2 ? "street" : d < EDGE ? "sidewalk" : "block";
}
