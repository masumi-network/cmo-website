"use client";

// Explore mode: a pin on every place. Click one and Cuso goes there.
// Drag the map to move around, pinch or wheel to zoom a little.

import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Plane, Raycaster, Vector2, Vector3, type Camera } from "three";
import { chapters, type ChapterId } from "@/content/day";
import { clampPan, clampZoom, isDrag, usePan } from "@/lib/pan";
import { useCity } from "@/lib/store";
import { overviewCenter } from "./camera-rig";
import { LAND_BOUNDS } from "./grid";

/** Pins that line up from the bird's-eye view lean apart (phones have less room, so more of them lean). */
const LEAN: Partial<Record<ChapterId, string>> = {
  arrive: "-translate-x-full",
  seo: "translate-x-0 max-md:-translate-x-3/4 max-md:-translate-y-[150%]",
  ads: "-translate-x-1/2 max-md:translate-x-0",
};

const ground = new Plane(new Vector3(0, 1, 0), 0);
const ray = new Raycaster();
const ndc = new Vector2();
const hit0 = new Vector3();
const hit = new Vector3();

/** Where the pointer meets the ground, seen from `camera`. */
function groundAt(out: Vector3, x: number, y: number, el: HTMLElement, camera: Camera) {
  const r = el.getBoundingClientRect();
  ray.setFromCamera(ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
  return ray.ray.intersectPlane(ground, out);
}

/** Drag (mouse or one finger) pans, two fingers pinch, the wheel zooms. Returns whether the last press was a drag. */
function useMapDrag() {
  const { camera, gl, events } = useThree();
  const dragged = useRef(false);

  useEffect(() => {
    // The canvas's event root: the pins (drei Html) live inside it too.
    const el = (events.connected as HTMLElement | undefined) ?? gl.domElement.parentElement;
    if (!el) return;
    const points = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0, pan: usePan.getState().pan, zoom: 1, spread: 0 };
    let view: Camera = camera.clone();
    const spread = () => {
      const [a, b] = [...points.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const begin = (x: number, y: number) => {
      const { pan, zoom } = usePan.getState();
      start = { x, y, pan, zoom, spread: points.size === 2 ? spread() : 0 };
      view = camera.clone(); // the drag maps the ground as seen when it started
    };

    const down = (e: PointerEvent) => {
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragged.current = false;
      begin(e.clientX, e.clientY);
    };
    const move = (e: PointerEvent) => {
      if (!points.has(e.pointerId)) return;
      points.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (points.size === 2) {
        dragged.current = true;
        usePan.getState().set({ zoom: clampZoom((start.zoom * start.spread) / Math.max(1, spread())) });
        return;
      }
      if (!dragged.current && !isDrag(e.clientX - start.x, e.clientY - start.y)) return;
      dragged.current = true;
      el.style.cursor = "grabbing";
      if (!groundAt(hit0, start.x, start.y, el, view) || !groundAt(hit, e.clientX, e.clientY, el, view)) return;
      const pan = { x: start.pan.x + hit0.x - hit.x, z: start.pan.z + hit0.z - hit.z };
      usePan.getState().set({ pan: clampPan(overviewCenter(), pan, LAND_BOUNDS) });
    };
    const up = (e: PointerEvent) => {
      points.delete(e.pointerId);
      el.style.cursor = "grab";
      const [rest] = [...points.values()];
      if (rest) begin(rest.x, rest.y); // pinch ended: the other finger carries on panning
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      usePan.getState().set({ zoom: clampZoom(usePan.getState().zoom * Math.exp(e.deltaY * 0.0015)) });
    };
    // Swallow the click that ends a drag, so a pin under the finger does not fire.
    const click = (e: MouseEvent) => {
      if (dragged.current) e.stopPropagation();
    };

    el.style.touchAction = "none"; // the page must not scroll while dragging the map
    el.style.cursor = "grab";
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("click", click, true);
    usePan.getState().reset();
    return () => {
      el.style.touchAction = "";
      el.style.cursor = "";
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("click", click, true);
      usePan.getState().reset(); // leaving Explore forgets the pan
    };
  }, [camera, gl, events]);
}

function PinMap({ onGo }: { onGo: (index: number) => void }) {
  const setMode = useCity((s) => s.setMode);
  useMapDrag();
  return (
    <>
      {chapters.map((c, i) =>
        c.id === "join" ? null : (
          <Html key={c.id} position={[c.spot[0], c.spot[1] + 2.4, c.spot[2]]} zIndexRange={[30, 0]}>
            <button
              type="button"
              onClick={() => {
                setMode("story");
                onGo(i);
              }}
              className={`flex ${LEAN[c.id] ?? "-translate-x-1/2"} -translate-y-full cursor-pointer items-center gap-2.5 rounded-full bg-[#f7f6f2] py-1.5 pr-4 pl-1.5 text-left whitespace-nowrap text-[#111114] shadow-[0_6px_20px_rgb(17_17_20/0.16)] transition-transform hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-[#3d5afe]/60 focus-visible:outline-none`}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-[#111114] font-mono text-[11px] text-[#f7f6f2]">{c.time.slice(0, 2)}</span>
              <span className="flex flex-col">
                <span className="text-sm leading-tight font-semibold">{c.label}</span>
                <span className="text-xs leading-tight text-[#5e5e66]">{c.place}</span>
              </span>
            </button>
          </Html>
        ),
      )}
    </>
  );
}

export function Pins({ onGo }: { onGo: (index: number) => void }) {
  const mode = useCity((s) => s.mode);
  return mode === "explore" ? <PinMap onGo={onGo} /> : null;
}
