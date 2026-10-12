import { describe, expect, it } from "vitest";
import { clampPan, clampZoom, DRAG_PX, isDrag, isMoved, ZOOM } from "@/lib/pan";

const bounds = { minX: -90, maxX: 45, minZ: -60, maxZ: 52 };
const center = { x: 10, z: 5 };

describe("explore pan", () => {
  it("a press is a tap until it moves more than a few pixels", () => {
    expect(isDrag(0, 0)).toBe(false);
    expect(isDrag(DRAG_PX - 1, 0)).toBe(false);
    expect(isDrag(3, 4)).toBe(false); // 5 px
    expect(isDrag(DRAG_PX + 1, 0)).toBe(true);
    expect(isDrag(-5, -5)).toBe(true); // 7 px
  });

  it("keeps the view inside the land", () => {
    expect(clampPan(center, { x: 3, z: -4 }, bounds)).toEqual({ x: 3, z: -4 });
    expect(clampPan(center, { x: 500, z: 0 }, bounds)).toEqual({ x: 35, z: 0 }); // center.x + 35 = maxX
    expect(clampPan(center, { x: -500, z: -500 }, bounds)).toEqual({ x: -100, z: -65 });
    expect(clampPan(center, { x: 0, z: 500 }, bounds)).toEqual({ x: 0, z: 47 });
  });

  it("zooms within a small range", () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.01)).toBe(ZOOM.min);
    expect(clampZoom(9)).toBe(ZOOM.max);
  });

  it("shows Recenter only away from the fitted view", () => {
    expect(isMoved({ pan: { x: 0, z: 0 }, zoom: 1 })).toBe(false);
    expect(isMoved({ pan: { x: 0.2, z: 0.2 }, zoom: 1.01 })).toBe(false);
    expect(isMoved({ pan: { x: 2, z: 0 }, zoom: 1 })).toBe(true);
    expect(isMoved({ pan: { x: 0, z: 0 }, zoom: 0.8 })).toBe(true);
  });
});
