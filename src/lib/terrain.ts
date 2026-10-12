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
