// Height-aware haze: the air is thickest near the water, so high ground far
// away keeps its silhouette (paler, but there) while the bay and the shore fog
// out exactly as linear fog. The fog shader (src/scene/haze.ts) does the same
// sum on the GPU; this is its mirror for tests.

/**
 * `y0`: at or below this world height the fog is three's linear fog (water, shore).
 * `y1`: from this height up the fog's far distance is (1 + gain) times longer.
 */
export const HAZE = { y0: 1, y1: 30, gain: 1 };

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 0 at or below HAZE.y0, 1 from HAZE.y1 up, eased between. */
export const hazeLift = (y: number) => smoothstep(HAZE.y0, HAZE.y1, y);

/** How much fog covers a point `depth` in front of the camera at world height `y` (0 clear, 1 fog colour). */
export const hazeFactor = (depth: number, y: number, near: number, far: number) =>
  smoothstep(near, far * (1 + HAZE.gain * hazeLift(y)), depth);
