// The street grid and shoreline, shared by the city layout and Cuso's routes.

// Shoreline (x east, z south). Downtown is the north-east corner.
export const LAND: [number, number][] = [
  [-66, -28], [-84, -46], [-76, -53], [-52, -38], [-30, -35], [-10, -33], [5, -36], [20, -34], [31, -28],
  [31, 10], [31, 30], [26, 46], [0, 48], [-30, 47], [-63, 46], [-65, 10],
];

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
