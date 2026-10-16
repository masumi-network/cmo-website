import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { chapters } from "@/content/day";
import { lightingAt } from "@/lib/time";
import { SHADOW, fogRange, overhead, shadowBox, shadowHalf, sunDirection } from "@/scene/atmosphere";
import { PORTRAIT_FOV } from "@/scene/camera-rig";

describe("distance fog", () => {
  it("is today's in every story shot (6 to 36 m from what the camera looks at)", () => {
    for (const d of [6, 12, 36, 50]) expect(fogRange(d, false)).toEqual({ near: 70, far: 340 });
  });

  it("is Explore's far fog in Explore, at any zoom", () => {
    for (const d of [40, 95, 215]) expect(fogRange(d, true)).toEqual({ near: 260, far: 900 });
  });

  it("eases from Explore's to the story's as the camera comes down after a pin (it switched at once: a white haze over the city)", () => {
    expect(fogRange(170, false)).toEqual({ near: 260, far: 900 });
    const mid = fogRange(85, false);
    expect(mid.near).toBeGreaterThan(70);
    expect(mid.near).toBeLessThan(260);
    expect(fogRange(70, false).near).toBeLessThan(mid.near);
  });
});

describe("how far above the story the camera is", () => {
  it("is 0 in every story shot and 1 from Explore's height, easing between (Karl the fog bank fades in by it)", () => {
    expect(overhead(36)).toBe(0);
    expect(overhead(50)).toBe(0);
    expect(overhead(170)).toBe(1);
    expect(overhead(85)).toBeGreaterThan(0);
    expect(overhead(85)).toBeLessThan(1);
  });
});

describe("haze (the sky's fog scale)", () => {
  it("brings the story fog in, in proportion", () => {
    expect(fogRange(12, false, 0.8)).toEqual({ near: 56, far: 272 });
    expect(fogRange(12, false, 1)).toEqual(fogRange(12, false));
  });

  it("leaves Explore's fog alone", () => {
    for (const d of [40, 95, 215]) expect(fogRange(d, true, 0.8)).toEqual({ near: 260, far: 900 });
    expect(fogRange(170, false, 0.8)).toEqual({ near: 260, far: 900 });
  });

  it("still eases from Explore's as the camera comes down after a pin", () => {
    const mid = fogRange(85, false, 0.8);
    expect(mid.near).toBeGreaterThan(56);
    expect(mid.near).toBeLessThan(260);
    expect(fogRange(70, false, 0.8).near).toBeLessThan(mid.near);
  });
});

/** Each chapter's camera at rest, desktop (1440x900) and phone (portrait), at its hour's sun. */
const shots = chapters.flatMap((c) => [
  { id: `${c.id} desktop`, hour: c.hour, position: new Vector3(...c.camera.position), target: new Vector3(...c.camera.target), fov: 35, aspect: 1.6 },
  { id: `${c.id} phone`, hour: c.hour, position: new Vector3(...c.phone.position), target: new Vector3(...c.phone.target), fov: PORTRAIT_FOV, aspect: 390 / 844 },
]);

/** Light space as three's shadow camera sees it: x and y across the sun's rays. */
function lightXY(p: Vector3, target: Vector3, sun: Vector3) {
  const x = new Vector3(0, 1, 0).cross(sun).normalize();
  const y = sun.clone().cross(x);
  const d = p.clone().sub(target);
  return [d.dot(x), d.dot(y)];
}

describe("the sun's shadow box", () => {
  it("is tight at every chapter at rest: about 1.6 cm per texel on a 2048 map (was 3.3)", () => {
    // Wide shots: the finale, and 23:00's (by moonlight, where shadows are faint), a half-metre step over.
    for (const s of shots.filter((s) => !s.id.startsWith("join") && s.id !== "pricing desktop")) {
      const half = shadowBox(s, sunDirection(lightingAt(s.hour)));
      expect(half, s.id).toBeGreaterThanOrEqual(SHADOW.min);
      expect((2 * half) / 2048, s.id).toBeLessThan(0.02);
    }
  });

  it("covers what the camera sees around its subject: from the lens to well past the target", () => {
    for (const s of shots) {
      const sun = sunDirection(lightingAt(s.hour));
      const half = shadowBox(s, sun);
      const forward = s.target.clone().sub(s.position).normalize();
      const right = forward.clone().cross(new Vector3(0, 1, 0)).normalize();
      const up = right.clone().cross(forward);
      const d = s.position.distanceTo(s.target);
      const t = Math.tan(((s.fov / 2) * Math.PI) / 180);
      for (let i = 0; i <= 10; i++) {
        const depth = 1 + ((d + 4 - 1) * i) / 10;
        for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1], [0, 0]]) {
          const p = s.position.clone().addScaledVector(forward, depth).addScaledVector(right, sx * depth * t * s.aspect).addScaledVector(up, sy * depth * t);
          for (const v of lightXY(p, s.target, sun)) expect(Math.abs(v), `${s.id} depth ${depth.toFixed(1)}`).toBeLessThanOrEqual(half + 1e-6);
        }
      }
    }
  });

  it("never grows past the travel box (the finale's wide shot needs nearly all of it)", () => {
    for (const s of shots) expect(shadowBox(s, sunDirection(lightingAt(s.hour))), s.id).toBeLessThanOrEqual(SHADOW.travel);
    const finale = shots.find((s) => s.id === "join desktop")!;
    expect(shadowBox(finale, sunDirection(lightingAt(finale.hour)))).toBeGreaterThan(25);
  });

  it("grows as the camera pulls back", () => {
    const s = shots[0];
    const sun = sunDirection(lightingAt(s.hour));
    const far = { ...s, position: s.target.clone().lerp(s.position, 3) };
    expect(shadowBox(far, sun)).toBeGreaterThan(shadowBox(s, sun));
  });

  it("blends back to the travel box while the camera moves, and to Explore's in Explore", () => {
    expect(shadowHalf(16, 0, false)).toBe(16);
    expect(shadowHalf(16, 1, false)).toBe(SHADOW.travel);
    const mid = shadowHalf(16, 0.5, false);
    expect(mid).toBeGreaterThan(16);
    expect(mid).toBeLessThan(SHADOW.travel);
    expect(shadowHalf(16, 0, true)).toBe(SHADOW.explore);
  });
});

describe("the sun's direction", () => {
  it("is a unit vector up in the sky; the moon stands in at night, high", () => {
    for (const h of [6, 12, 18, 22]) {
      const s = sunDirection(lightingAt(h));
      expect(s.length()).toBeCloseTo(1, 6);
      expect(s.y, `${h}`).toBeGreaterThan(0);
    }
    expect(sunDirection(lightingAt(22)).y).toBeCloseTo(Math.sin((38 * Math.PI) / 180), 6);
  });
});
