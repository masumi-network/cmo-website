// Photo-real mode (F12): light probes, baked per chapter hour. Pure parts, so
// they are unit tested; the shader side is src/scene/probes.tsx, the bake is
// the dev lab (src/scene/probe-lab.ts, scripts/probes.mjs).
//
// A probe holds the light arriving from every direction at one point of a grid
// over the city, as L1 spherical harmonics (12 numbers: RGB for the constant
// term and for x, y, z). The bake traces it without the sun's direct light, so
// it is the bounced light and the sky: what today's studio light and
// hemisphere light stand in for. Each hour is stored in 8 bits, scaled by its
// brightest probe.

import { Vector3 } from "three";
import { z } from "zod";

/** A probe's directions are a TILE x TILE square of equal-area cells (one bake pixel each). */
export const TILE = 8;

const Y0 = 0.282095; // SH basis, l = 0
const Y1 = 0.488603; // l = 1, times the direction
const A0 = Math.PI * Y0; // cosine lobe convolution, folded in: irradiance = A0 L00 + A1 (L1 . n)
const A1 = ((2 * Math.PI) / 3) * Y1;
const SQRT3 = Math.sqrt(3); // |L1| <= sqrt(3) L00 for any light that is never negative

/** Cell (i, j) of a tile, at (ru, rv) inside it (0..1). Row 0 looks up, the last row down. */
export function cellDirection(i: number, j: number, ru: number, rv: number, out = new Vector3()) {
  const y = 1 - (2 * (j + rv)) / TILE;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = (2 * Math.PI * (i + ru)) / TILE;
  return out.set(r * Math.cos(phi), y, r * Math.sin(phi));
}

/** Where probe `probe`'s tile starts in the bake image, `tilesX` tiles wide. */
export const tileOrigin = (probe: number, tilesX: number): [number, number] => [(probe % tilesX) * TILE, Math.floor(probe / tilesX) * TILE];

const dir = new Vector3();

/** The SH of the tile at (x0, y0) in an RGBA float image `width` pixels wide: 12 numbers. */
export function projectTile(pixels: Float32Array, width: number, x0: number, y0: number, out = new Float32Array(12)) {
  out.fill(0);
  const w = (4 * Math.PI) / (TILE * TILE);
  for (let j = 0; j < TILE; j++)
    for (let i = 0; i < TILE; i++) {
      cellDirection(i, j, 0.5, 0.5, dir);
      const p = ((y0 + j) * width + x0 + i) * 4;
      for (let c = 0; c < 3; c++) {
        const L = pixels[p + c] * w;
        out[c] += L * Y0;
        out[3 + c] += L * Y1 * dir.x;
        out[6 + c] += L * Y1 * dir.y;
        out[9 + c] += L * Y1 * dir.z;
      }
    }
  return out;
}

/** Adds a directional light of irradiance `color` from direction `d` (unshadowed) to a probe's SH. */
export function addDirectional(sh: Float32Array, d: Vector3, color: [number, number, number]) {
  for (let c = 0; c < 3; c++) {
    sh[c] += color[c] * Y0;
    sh[3 + c] += color[c] * Y1 * d.x;
    sh[6 + c] += color[c] * Y1 * d.y;
    sh[9 + c] += color[c] * Y1 * d.z;
  }
}

/** Irradiance on a surface facing `n`, from a probe's SH (what the shader does). */
export function irradiance(sh: ArrayLike<number>, n: Vector3) {
  return [0, 1, 2].map((c) => Math.max(0, A0 * sh[c] + A1 * (sh[3 + c] * n.x + sh[6 + c] * n.y + sh[9 + c] * n.z)));
}

/**
 * Probes inside a building see the open sky through the backs of its walls (the tracer passes through them), and a
 * wall's shading blends them in: shaded sides turned bright and blue. Each pass gives every probe that is not
 * `valid` the mean of its valid neighbours (6 around it), so the light reaches in one probe per pass.
 */
export function dilateProbes(sh: Float32Array, valid: Uint8Array, [nx, ny, nz]: number[], passes: number) {
  const ok = valid.slice();
  for (let pass = 0; pass < passes; pass++) {
    const next = ok.slice();
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const p = (k * ny + j) * nx + i;
          if (ok[p]) continue;
          const near = [i > 0 && p - 1, i < nx - 1 && p + 1, j > 0 && p - nx, j < ny - 1 && p + nx, k > 0 && p - nx * ny, k < nz - 1 && p + nx * ny].filter((q): q is number => q !== false && ok[q] === 1);
          if (!near.length) continue;
          for (let c = 0; c < 12; c++) sh[p * 12 + c] = near.reduce((sum, q) => sum + sh[q * 12 + c], 0) / near.length;
          next[p] = 1;
        }
    ok.set(next);
  }
}

/**
 * 8-bit bytes for many probes' SH (12 numbers each). The constant term 0..1, the rest signed around 0.5, scaled
 * by the brightest probe but the top 0.1%: a few probes inside glowing things (a lit tower top at night) clip.
 */
export function encodeProbes(sh: Float32Array) {
  const peaks = new Float32Array(sh.length / 12);
  for (let p = 0; p < peaks.length; p++) for (let k = 0; k < 12; k++) peaks[p] = Math.max(peaks[p], k < 3 ? sh[p * 12 + k] : Math.abs(sh[p * 12 + k]) / SQRT3);
  peaks.sort();
  const scale = Math.max(1e-6, peaks[Math.max(0, Math.ceil(peaks.length * 0.999) - 1)] ?? 0);
  const bytes = new Uint8Array(sh.length);
  for (let i = 0; i < sh.length; i++) {
    const v = i % 12 < 3 ? sh[i] / scale : (sh[i] / (SQRT3 * scale)) * 0.5 + 0.5;
    bytes[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return { bytes, scale };
}

/** Back to linear SH, as the shader reads it. */
export function decodeProbes(bytes: Uint8Array, scale: number) {
  const sh = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) sh[i] = i % 12 < 3 ? (bytes[i] / 255) * scale : (bytes[i] / 255 - 0.5) * 2 * SQRT3 * scale;
  return sh;
}

/** The shader's constants, kept next to the maths above. */
export const PROBE_GLSL_CONSTANTS = { A0, A1, SQRT3 };

/**
 * Which baked hours to blend now: `a` and `b` index `hours` (sorted, 06:00 to
 * 06:00 tomorrow as 30), `t` how far from a to b. Before 06:00 is the night.
 */
export function hourBlend(hours: number[], hour: number) {
  const h = hour < 6 ? hour + 24 : hour;
  let a = 0;
  while (a < hours.length - 1 && hours[a + 1] <= h) a++;
  if (hours[a] >= h || a === hours.length - 1) return { a, b: a, t: 0 };
  return { a, b: a + 1, t: (h - hours[a]) / (hours[a + 1] - hours[a]) };
}

const Vec = (n: number) => z.array(z.number().finite()).length(n);

const Manifest = z.object({
  file: z.string().regex(/^[\w.-]+$/),
  /** The grid's corner and size in world units: probe (i, j, k) sits at min + (i + 0.5) / res * size. */
  min: Vec(3),
  size: z.array(z.number().positive()).length(3),
  res: z.array(z.number().int().positive()).length(3),
  /** Each baked hour, the block of the file that holds it (06:00 tomorrow reuses 06:00) and its scale. */
  hours: z.array(z.object({ hour: z.number(), block: z.number().int().nonnegative(), scale: z.number().positive() })).min(1),
});
export type ProbeManifest = z.infer<typeof Manifest>;

/** The manifest, or null if it is not one: no probes rather than wrong ones. */
export function parseProbeManifest(json: unknown): ProbeManifest | null {
  const r = Manifest.safeParse(json);
  return r.success ? r.data : null;
}

/** Probes live here: manifest.json and the gzipped bytes it names. */
export const PROBES_DIR = "/probes";

/** The probe file's bytes: unzipped here, unless the host already did (served with Content-Encoding: gzip). */
export async function probeBytes(buffer: ArrayBuffer) {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  if (head[0] !== 0x1f || head[1] !== 0x8b) return new Uint8Array(buffer);
  return new Uint8Array(await new Response(new Response(buffer).body!.pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
}
