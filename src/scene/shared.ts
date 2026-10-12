// Small shared bits for the scene. Per-frame values live in plain objects so
// useFrame can read and write them without React re-renders.

import { useEffect } from "react";
import { Vector2, Vector3, type MeshStandardMaterial } from "three";
import { chapters, type Vec3 } from "@/content/day";
import { travel } from "@/lib/time";
import { useCity } from "@/lib/store";

export const rig = {
  /** Where the camera looks. The sun's shadow box follows it. */
  target: new Vector3(),
  /** Cuso's world position this frame. */
  cuso: new Vector3(),
  /** Pointer in -1..1, from window events (the canvas sits under the page). */
  pointer: new Vector2(),
  /** 0 = day, 1 = night. */
  night: 0,
};

/** Where we are in the day right now. */
export function dayNow() {
  const { progress, mode } = useCity.getState();
  const { from, to, t } = travel(progress, chapters.length);
  const a = chapters[from];
  const b = chapters[to];
  return { from, to, t, a, b, mode, hour: a.hour + (b.hour - a.hour) * t };
}

export const setLerp = (out: Vector3, a: Vec3, b: Vec3, t: number) =>
  out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);

/** Frame-rate independent smoothing factor. */
export const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);

// Materials that glow at night (windows, lamps, bridge lights).
const glowing = new Map<MeshStandardMaterial, number>();

export function useNightGlow(material: MeshStandardMaterial, max: number, base = 0) {
  useEffect(() => {
    glowing.set(material, max);
    material.userData.glowBase = base;
    return () => void glowing.delete(material);
  }, [material, max, base]);
}

export function updateNightGlow(night: number) {
  for (const [material, max] of glowing) {
    material.emissiveIntensity = (material.userData.glowBase as number) + night * max;
  }
}
