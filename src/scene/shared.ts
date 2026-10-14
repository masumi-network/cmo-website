// Small shared bits for the scene. Per-frame values live in plain objects so
// useFrame can read and write them without React re-renders.

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Vector2, Vector3, type Mesh, type MeshStandardMaterial } from "three";
import { chapters, type Vec3 } from "@/content/day";
import { shownHour } from "@/lib/navigate";
import { travel } from "@/lib/time";
import { useCity } from "@/lib/store";

export const rig = {
  /** Where the camera looks. The sun's shadow box follows it. */
  target: new Vector3(),
  /** Cuso's world position this frame, */
  cuso: new Vector3(),
  /** once he is in the scene (his model loads after the camera starts). */
  placed: false,
  /** Pointer in -1..1, from window events (the canvas sits under the page). */
  pointer: new Vector2(),
  /** Which way Cuso faces (radians around Y). */
  heading: 0,
  /** Where Cuso really is on the day (he walks at his own pace behind the scroll). */
  travel: { leg: 0, t: 0, s: 0, length: 1, moving: false },
  /** 0 = day, 1 = night. */
  night: 0,
};

/**
 * Layer for small details (grass, interiors, street furniture, cars): the
 * main camera draws them, the water mirror and the glass probe skip them
 * (too small to read in a reflection). Shadows follow `castShadow`, not layers.
 */
export const DETAIL = 1;
/** Keep `o` out of reflections. Use as a ref callback: `ref={detail}`. */
export const detail = (o: { layers: { set: (n: number) => void } } | null) => o?.layers.set(DETAIL);

/** How near (beyond its own size) the camera must be to draw an interior behind glass. */
export const INTERIOR_RANGE = 40;
const centre = new Vector3();

/**
 * For an interior behind glass (café, taqueria, showcases, market): drawn
 * only while the camera is within INTERIOR_RANGE (from farther it is a few
 * pixels), and never in reflections. Returns the mesh ref.
 */
export function useInterior() {
  const ref = useRef<Mesh>(null);
  useFrame(({ camera }) => {
    const m = ref.current;
    if (!m) return;
    m.layers.set(DETAIL);
    const s = m.geometry.boundingSphere ?? (m.geometry.computeBoundingSphere(), m.geometry.boundingSphere!);
    m.visible = camera.position.distanceTo(centre.copy(s.center).applyMatrix4(m.matrixWorld)) < INTERIOR_RANGE + s.radius;
  });
  return ref;
}

/**
 * What the page draws over the scene: the top bar and every card
 * (`data-card`), as screen rects. The camera rig and Cuso's bubble read them
 * every frame; measuring forces a layout, so it happens once per scroll
 * position and size, and at most every 0.25 s otherwise (a card that grows).
 */
const covers = { key: "", at: -Infinity, header: null as DOMRect | null, cards: [] as DOMRect[] };
export function overlays() {
  const key = `${window.scrollY},${window.innerWidth},${window.innerHeight}`;
  const now = performance.now();
  if (key !== covers.key || now - covers.at > 250) {
    covers.key = key;
    covers.at = now;
    covers.header = document.querySelector("header")?.getBoundingClientRect() ?? null;
    covers.cards = [...document.querySelectorAll("[data-card]")].map((el) => el.getBoundingClientRect());
  }
  return covers;
}

/** Where we are in the day right now. After a rail jump the hour (the light) eases over from where it was. */
export function dayNow() {
  const state = useCity.getState();
  const { from, to, t } = travel(state.progress, chapters.length);
  return { from, to, t, a: chapters[from], b: chapters[to], mode: state.mode, hour: shownHour(state, performance.now() / 1000) };
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
