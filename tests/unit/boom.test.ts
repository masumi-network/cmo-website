// The camera boom: when something comes between Cuso and the camera, the
// camera swings up and over him (and a little closer), smoothly, then settles
// back once he is in sight again.

import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { BOOM, PORTRAIT_FOV, boomNeed, fitBand, boomPose, follow, newBoom, newTrail, orbitLerp, stepBoom, trail } from "@/scene/camera-rig";
import { FERRY, PYRAMID, insideBuilding, sightClear } from "@/scene/layout";
import { rig } from "@/scene/shared";

const v = (p: readonly number[]) => new Vector3(p[0], p[1], p[2]);
const eyeOf = (spot: readonly number[]) => new Vector3(spot[0], spot[1] + 1.4, spot[2]);

describe("line of sight", () => {
  const g = heightAt(PYRAMID.x, PYRAMID.z);

  it("is blocked through the Pyramid and clear over it", () => {
    expect(sightClear(new Vector3(PYRAMID.x, g + 5, PYRAMID.z - 12), new Vector3(PYRAMID.x, g + 5, PYRAMID.z + 12))).toBe(false);
    expect(sightClear(new Vector3(PYRAMID.x, g + 31, PYRAMID.z - 12), new Vector3(PYRAMID.x, g + 31, PYRAMID.z + 12))).toBe(true);
  });

  it("agrees with insideBuilding: never clear if a point on the line is inside a building", () => {
    // random lines around downtown and the Ferry Building
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let blocked = 0;
    for (let n = 0; n < 400; n++) {
      const a = new Vector3(-20 + rnd() * 60, 0.5 + rnd() * 20, -25 + rnd() * 50);
      const b = new Vector3(-20 + rnd() * 60, 0.5 + rnd() * 20, -25 + rnd() * 50);
      if (insideBuilding(a.x, a.y, a.z)) continue; // the eye: solids around it are ignored
      const hits = Array.from({ length: 200 }, (_, k) => a.clone().lerp(b, k / 199)).some((p) => insideBuilding(p.x, p.y, p.z));
      if (hits) {
        blocked++;
        expect(sightClear(a, b), `${a.toArray()} → ${b.toArray()}`).toBe(false);
      }
    }
    expect(blocked).toBeGreaterThan(50);
  });

  it("ignores the building the eye is in (mid-jump up a wall)", () => {
    const a = new Vector3(PYRAMID.x, g + 10, PYRAMID.z);
    expect(sightClear(a, new Vector3(PYRAMID.x + 10, g + 40, PYRAMID.z + 10))).toBe(true);
    expect(sightClear(new Vector3(PYRAMID.x + 10, g + 40, PYRAMID.z + 10), a)).toBe(false); // from outside, it is in the way
  });
});

describe("the boom", () => {
  it("swings the camera up over Cuso and a little closer, and is the camera itself at 0", () => {
    const eye = new Vector3(0, 1.4, 0);
    const cam = new Vector3(0, 4, 10);
    const out = new Vector3();
    expect(boomPose(out, eye, cam, 0).distanceTo(cam)).toBeLessThan(1e-9);
    boomPose(out, eye, cam, 1);
    expect(out.y).toBeGreaterThan(cam.y + 4);
    expect(out.distanceTo(eye)).toBeLessThan(cam.distanceTo(eye));
    // never right over his head
    const flat = Math.hypot(out.x - eye.x, out.z - eye.z);
    expect(Math.atan2(out.y - eye.y, flat)).toBeLessThan((80 * Math.PI) / 180);
  });

  it("needs no lift in any chapter shot (desktop and phone): he is in sight at rest", () => {
    for (const c of chapters) {
      expect(boomNeed(eyeOf(c.spot), v(c.camera.position), 0), c.id).toBe(0);
      expect(boomNeed(eyeOf(c.spot), v(c.phone.position), 0), `${c.id} phone`).toBe(0);
    }
  });

  it("needs no lift on phones either, once the shot pulls back to fit him above the cards", () => {
    for (const [width, height, band] of [[375, 667, [76, 499]], [412, 915, [76, 747]]] as const) {
      for (const c of chapters) {
        const pos = v(c.phone.position);
        rig.cuso.set(...c.spot);
        fitBand(pos, v(c.phone.target), PORTRAIT_FOV, { width, height }, [band[0], band[1]]);
        expect(boomNeed(eyeOf(c.spot), pos, 0), `${c.id} ${width}x${height}`).toBe(0);
      }
    }
  });

  it("lifts when a building stands between them, until it can see over", () => {
    const g = heightAt(FERRY.x, FERRY.z);
    const eye = new Vector3(FERRY.x - 5.5, g + 1.4, FERRY.z + 4); // on the Embarcadero, the hall between (not the clock tower)
    const cam = new Vector3(FERRY.x + 8, g + 3, FERRY.z + 5);
    const need = boomNeed(eye, cam, 0);
    expect(need).toBeGreaterThan(0);
    expect(need).toBeLessThan(1);
    const out = boomPose(new Vector3(), eye, cam, need);
    expect(sightClear(eye, out)).toBe(true);
    expect(insideBuilding(out.x, out.y, out.z)).toBe(false);
  });

  it.each([30, 60, 120])("moves smoothly at %i fps: no jump in a frame, same path whatever the frame rate", (fps) => {
    const dt = 1 / fps;
    const b = newBoom();
    const trace: number[] = [];
    for (let t = 0; t < 6; t += dt) {
      // blocked from 0.5 s to 2 s (needs the whole lift), then clear
      stepBoom(b, t > 0.5 && t < 2 ? 1 : 0, dt);
      trace.push(b.x);
    }
    let worst = 0;
    for (let i = 1; i < trace.length; i++) worst = Math.max(worst, Math.abs(trace[i] - trace[i - 1]) / dt);
    expect(worst).toBeLessThan(BOOM.maxRate); // lift per second, never a step
    expect(Math.max(...trace)).toBeGreaterThan(0.9); // it gets up there
    expect(trace.at(-1)).toBeLessThan(0.02); // and back down
    expect(Math.min(...trace)).toBeGreaterThan(-0.05); // no dip under the shot
    // frame-rate independent: where it is at 1.5 s
    const at = trace[Math.round(1.5 * fps)];
    expect(at).toBeGreaterThan(0.85);
  });

  it("holds on for a moment once clear, so it does not flicker at the edge", () => {
    const b = newBoom();
    const dt = 1 / 60;
    for (let t = 0; t < 1; t += dt) stepBoom(b, 0.5, dt);
    const up = b.x;
    // the need flickers between 0 and 0.5 every few frames: it stays up
    for (let k = 0; k < 120; k++) stepBoom(b, k % 6 < 3 ? 0 : 0.5, dt);
    expect(b.x).toBeGreaterThan(up - 0.05);
    expect(b.goal).toBe(0.5);
    // clear for good: it comes down
    for (let t = 0; t < 4; t += dt) stepBoom(b, 0, dt);
    expect(b.x).toBeLessThan(0.02);
  });
});

describe("following the shot", () => {
  it.each([30, 60, 120])("eases after a shot that jumps 30 units (Cuso blinks) with no step in speed at %i fps", (fps) => {
    const dt = 1 / fps;
    const p = new Vector3();
    const v = new Vector3();
    const goal = new Vector3();
    let last = 0;
    let worst = 0;
    for (let t = 0; t < 3; t += dt) {
      if (t > 0.5) goal.set(30, 10, 0);
      follow(p, v, goal, 5, dt);
      worst = Math.max(worst, Math.abs(v.length() - last) / dt);
      last = v.length();
    }
    // speed builds up over frames (under 1000 units/s² whatever the frame rate); a first-order
    // lerp jumps from 0 to ~100 units/s in one frame: 3000 units/s² at 30 fps, 12000 at 120
    expect(worst).toBeLessThan(1000);
    expect(p.distanceTo(goal)).toBeLessThan(0.05);
  });

  it.each([30, 60, 120])("rides with Cuso dashing at 22 units/s (the lead cam stays ahead of him) at %i fps", (fps) => {
    const dt = 1 / fps;
    const cuso = new Vector3();
    const goal = new Vector3();
    const t = newTrail();
    let at = new Vector3();
    for (let s = 0; s < 3; s += dt) {
      cuso.x = 22 * s;
      goal.set(cuso.x + 7, 3.6, 3.2); // the lead cam: 7 ahead, off to the side
      at = trail(t, cuso, goal, 1, 5, dt).clone();
    }
    expect(at.distanceTo(goal)).toBeLessThan(0.01);
  });

  it.each([30, 60, 120])("stays put when he blinks 40 units, then eases over with no step in speed, at %i fps", (fps) => {
    const dt = 1 / fps;
    const cuso = new Vector3();
    const t = newTrail();
    const shot = (c: Vector3) => c.clone().add(new Vector3(4, 3, 8));
    let prev = trail(t, cuso, shot(cuso), 1, 5, dt).clone();
    let speed = 0;
    let worst = 0;
    let firstStep = -1;
    for (let s = dt; s < 3; s += dt) {
      if (s > 0.5 && cuso.x === 0) cuso.x = 40;
      const at = trail(t, cuso, shot(cuso), 1, 5, dt).clone();
      if (cuso.x === 40 && firstStep < 0) firstStep = at.distanceTo(prev);
      const v = at.distanceTo(prev) / dt;
      worst = Math.max(worst, Math.abs(v - speed) / dt);
      speed = v;
      prev = at;
    }
    expect(firstStep).toBeLessThan(0.5);
    expect(worst).toBeLessThan(1500);
    expect(prev.distanceTo(shot(cuso))).toBeLessThan(0.05);
  });

  it("keeps still at a chapter's shot while he hops about", () => {
    const cuso = new Vector3();
    const goal = new Vector3(4, 3, 8);
    const t = newTrail();
    let worst = 0;
    for (let s = 0; s < 2; s += 1 / 60) {
      cuso.y = Math.max(0, Math.sin(s * 9)) * 1.5; // hops
      worst = Math.max(worst, trail(t, cuso, goal, 0, 5, 1 / 60).distanceTo(goal));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("blends the shot behind him into the lead cam in front of him round him, never through him", () => {
    const center = new Vector3(0, 1.1, 0);
    const behind = new Vector3(0.3, 3, -9);
    const ahead = new Vector3(3.2, 3.6, 7);
    for (let t = 0; t <= 1; t += 0.05) {
      const p = orbitLerp(behind.clone(), center, ahead, t);
      expect(Math.hypot(p.x, p.z)).toBeGreaterThan(7);
    }
    expect(orbitLerp(behind.clone(), center, ahead, 1).distanceTo(ahead)).toBeLessThan(1e-9);
  });

  it.each([1 / 120, 1 / 30, 0.5, 2])("comes to a complete rest (frames %s s apart, software WebGL is that slow): same pose, zero speed", (dt) => {
    const p = new Vector3(300, 200, -150);
    const v = new Vector3();
    const goal = new Vector3(10, 60, 20);
    let t = 0;
    while (t < 6) {
      follow(p, v, goal, 3.2, dt);
      t += dt;
    }
    expect(p.equals(goal)).toBe(true);
    expect(v.length()).toBe(0);
    follow(p, v, goal, 3.2, dt);
    expect(p.equals(goal)).toBe(true);
  });

  it("settles in sim time, not in frames: three 2 s frames bring the boom down", () => {
    const b = newBoom();
    stepBoom(b, 1, 1 / 60);
    for (let i = 0; i < 30; i++) stepBoom(b, 1, 1 / 60);
    for (let i = 0; i < 4; i++) stepBoom(b, 0, 2);
    expect(b.x).toBe(0);
    expect(b.v).toBe(0);
  });
});
