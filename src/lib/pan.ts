// Explore mode: drag to move the map, pinch or wheel to zoom a little,
// Recenter to go back. Pure maths here; the pointer wiring is in
// src/scene/pins.tsx and the camera reads the state in camera-rig.tsx.

import { create } from "zustand";

export type Pan = { x: number; z: number };
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

/** A press becomes a drag after this many pixels (so a tap on a pin stays a tap). */
export const DRAG_PX = 6;
export const ZOOM = { min: 0.55, max: 1.25 };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const isDrag = (dx: number, dy: number) => dx * dx + dy * dy > DRAG_PX * DRAG_PX;

/** Keep the point the camera looks at (`center` + pan) inside the land, so the city never leaves the screen. */
export function clampPan(center: Pan, pan: Pan, bounds: Bounds): Pan {
  return {
    x: clamp(center.x + pan.x, bounds.minX, bounds.maxX) - center.x,
    z: clamp(center.z + pan.z, bounds.minZ, bounds.maxZ) - center.z,
  };
}

export const clampZoom = (zoom: number) => clamp(zoom, ZOOM.min, ZOOM.max);

/** Away from the fitted overview? Then Recenter shows. */
export const isMoved = ({ pan, zoom }: { pan: Pan; zoom: number }) => Math.hypot(pan.x, pan.z) > 0.5 || Math.abs(zoom - 1) > 0.02;

type PanState = { pan: Pan; zoom: number; set: (next: { pan?: Pan; zoom?: number }) => void; reset: () => void };

export const usePan = create<PanState>((set) => ({
  pan: { x: 0, z: 0 },
  zoom: 1,
  set: (next) => set(next),
  reset: () => set({ pan: { x: 0, z: 0 }, zoom: 1 }),
}));
