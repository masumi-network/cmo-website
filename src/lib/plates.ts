// Photo-real mode (F12): pre-traced chapter plates. Pure parts, so they are
// unit tested; the WebGL side is src/scene/plates.tsx, the bake is the dev lab.
//
// A plate is one chapter's rest view, path-traced once without the live objects
// (Cuso, cars, boats). It is 2:1, so any narrower screen shows its middle (the
// vertical field of view is fixed). Colour is linear, divided by PLATE_RANGE
// and sRGB-encoded in 8 bits, so the post chain tone-maps it with the live objects.

import { z } from "zod";
import { HOLD } from "./live-trace";

/** Linear colour above this clips (sun glints only). */
export const PLATE_RANGE = 2;

/** Plates and the switch live here. */
export const PLATES_DIR = "/plates";

const Vec = (n: number) => z.array(z.number().finite()).length(n);

const Entry = z.object({
  chapter: z.number().int().nonnegative(),
  hour: z.number(),
  file: z.string().regex(/^[\w.-]+\.webp$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fov: z.number().positive(),
  position: Vec(3),
  quaternion: Vec(4),
});
export type PlateEntry = z.infer<typeof Entry>;

const Manifest = z.object({ range: z.number().positive(), plates: z.array(Entry) });
export type PlateManifest = z.infer<typeof Manifest>;

/** The manifest, or null if it is not one: a broken file means no plates, not half of them. */
export function parseManifest(json: unknown): PlateManifest | null {
  const r = Manifest.safeParse(json);
  return r.success ? r.data : null;
}

export const plateFor = (m: PlateManifest, chapter: number) => m.plates.find((p) => p.chapter === chapter) ?? null;

export type PhotorealChoice = "on" | "off";

/**
 * Never on phones or in lite mode. Otherwise, first that applies: `?photoreal`
 * (or `?photoreal=0`) for development, NEXT_PUBLIC_PHOTOREAL=1, the visitor's
 * setting, and else on by itself where the GPU has a WebGPU adapter.
 */
export function photorealOn({ lite, search, env, webgpu, choice }: { lite: boolean; search: string; env?: string; webgpu: boolean; choice: PhotorealChoice | null }) {
  if (lite) return false;
  const flag = new URLSearchParams(search).get("photoreal");
  if (flag !== null) return flag !== "0";
  if (env === "1") return true;
  return choice ? choice === "on" : webgpu;
}

type Gpu = { requestAdapter: () => Promise<unknown> };

/** A real WebGPU adapter: the sign of a capable desktop GPU (a software fallback does not count). */
export async function webgpuCapable(gpu: Gpu | undefined) {
  try {
    const adapter = (await gpu?.requestAdapter()) as { info?: { isFallbackAdapter?: boolean } } | null | undefined;
    return !!adapter && !adapter.info?.isFallbackAdapter;
  } catch {
    return false;
  }
}

/** Where the settings switch is remembered. */
export const PHOTOREAL_KEY = "cmo.photoreal";

/** The visitor's setting, or null if they never picked (or storage is blocked). */
export function readPhotorealChoice(): PhotorealChoice | null {
  try {
    const v = localStorage.getItem(PHOTOREAL_KEY);
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function savePhotorealChoice(choice: PhotorealChoice) {
  try {
    localStorage.setItem(PHOTOREAL_KEY, choice);
  } catch {} // private window: the switch still works for this visit
}

const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const fromSrgb = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear RGBA floats to the plate's 8-bit sRGB pixels (alpha always opaque). */
export function encodePlate(linear: Float32Array, range: number) {
  const out = new Uint8ClampedArray(linear.length);
  for (let i = 0; i < linear.length; i += 4) {
    for (let k = 0; k < 3; k++) out[i + k] = Math.round(toSrgb(Math.min(Math.max(linear[i + k] / range, 0), 1)) * 255);
    out[i + 3] = 255;
  }
  return out;
}

/**
 * RGBA floats read back from a WebGPU texture, without the padding: the GPU copies rows 256 bytes apart (16 pixels),
 * so a width that is not a multiple of 16 comes back with gaps that skew every row (a 1633-wide window traced as streaks).
 */
export function unpadRows(data: Float32Array, width: number, height: number) {
  const stride = Math.ceil((width * 16) / 256) * 64; // floats a row (256 bytes = 64 floats)
  if (stride === width * 4) return data;
  const rows = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) rows.set(data.subarray(y * stride, y * stride + width * 4), y * width * 4);
  return rows;
}

/** The plate's pixels back to linear colour, as the GPU does it (an sRGB texture, times the range). */
export function decodePlate(pixels: Uint8ClampedArray, range: number) {
  const out = new Float32Array(pixels.length);
  for (let i = 0; i < pixels.length; i++) out[i] = i % 4 === 3 ? pixels[i] / 255 : fromSrgb(pixels[i] / 255) * range;
  return out;
}

/** How much of the plate's width a screen shows (its middle), or null if the screen is wider than the plate. */
export function cropScale(plateAspect: number, screenAspect: number) {
  return screenAspect > plateAspect + 1e-6 ? null : Math.min(1, screenAspect / plateAspect);
}

type V3 = { x: number; y: number; z: number };
type Q = V3 & { w: number };

/** Within `dist` metres and `angle` radians of the plate's camera. */
function poseWithin(position: V3, quaternion: Q, plate: PlateEntry, dist: number, angle: number) {
  const [px, py, pz] = plate.position;
  const [qx, qy, qz, qw] = plate.quaternion;
  const dot = Math.abs(quaternion.x * qx + quaternion.y * qy + quaternion.z * qz + quaternion.w * qw);
  return Math.hypot(position.x - px, position.y - py, position.z - pz) < dist && dot > Math.cos(angle / 2);
}

/** The camera stands on the plate's view: within about 2 cm and a quarter of a degree. */
export const poseNear = (position: V3, quaternion: Q, plate: PlateEntry) => poseWithin(position, quaternion, plate, 0.02, 0.0044);

/**
 * The rig follows Cuso, so where it comes to rest varies by a few centimetres
 * up to about 20 (where he stopped walking). A camera that has settled within
 * REACH of a plate glides onto it in GLIDE seconds, and lets go when it moves on.
 */
const REACH = { dist: 0.6, angle: (5 * Math.PI) / 180 };
const GLIDE = 0.5;
/** Slower than this (m/s) counts as settled. */
const SETTLED = 0.05;

export type Settle = { plate: PlateEntry | null; pull: number; still: number; last: V3 | null };
export const newSettle = (): Settle => ({ plate: null, pull: 0, still: 0, last: null });

/**
 * One frame of settling, from the rig's own (eased) camera. `pull` goes 0 to 1:
 * how far the camera is moved onto `plate`; at 1 it stands on it.
 */
export function settle(s: Settle, position: V3, quaternion: Q, plates: PlateEntry[], dt: number) {
  const moved = s.last ? Math.hypot(position.x - s.last.x, position.y - s.last.y, position.z - s.last.z) : Infinity;
  s.last = { x: position.x, y: position.y, z: position.z };
  s.still = dt > 0 && moved / dt < SETTLED ? s.still + dt : 0;
  const near = plates.find((p) => poseWithin(position, quaternion, p, REACH.dist, REACH.angle)) ?? null;
  if (s.pull === 0) s.plate = near; // switch plates only once let go
  const hold = s.plate !== null && s.plate === near && s.still > 0.25;
  s.pull = Math.min(1, Math.max(0, s.pull + ((hold ? 1 : -1) * dt) / GLIDE));
  return s;
}

/** A live plate (Explore's trace, explore-trace.tsx) holds while the camera stays on the pose it was traced from (lib/live-trace.ts HOLD). */
export const holdsLive = (live: PlateEntry | null, position: V3, quaternion: Q) => !!live && poseWithin(position, quaternion, live, HOLD.dist, HOLD.angle);
