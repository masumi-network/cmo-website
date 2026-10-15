// Rail jumps (the time rail, Explore pins, Ask Cuso): a camera flight to
// the chapter's shot while Cuso pops in a few steps short of his spot and
// walks or hops the rest. Scrolling still walks the whole route.

import { afterEach, describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { chapters } from "@/content/day";
import { goToChapter, jumpEase, jumpTime, shownHour, sweepHour } from "@/lib/navigate";
import { initialCity, useCity } from "@/lib/store";
import { lightingAt } from "@/lib/time";
import { crossings } from "@/scene/cable-line";
import { flyAt, startFlight } from "@/scene/camera-rig";
import { insideBuilding } from "@/scene/layout";
import { DAY_LENGTH, arrival as plan, dayDistance, sampleDay, walkOn } from "@/scene/routes";

/** As cuso.tsx asks: clear of the Union Square cable car's crossings. */
const arrival = (i: number) => plan(i, crossings().windows);

describe("where Cuso starts on a rail jump", () => {
  it.each(chapters.map((c, i) => [c.id, i] as const))("%s: a few steps short of the spot, on his route into it", (_id, i) => {
    const { from, to } = arrival(i);
    expect(to).toBe(dayDistance(i, 0));
    expect(from).toBeGreaterThanOrEqual(0);
    expect(from).toBeLessThanOrEqual(DAY_LENGTH);
    // the last few steps, or the last jump onto a roof: never a long walk or another leg
    const run = Math.abs(to - from);
    expect(run).toBeGreaterThanOrEqual(2);
    expect(run).toBeLessThanOrEqual(9.5);
    // on the same leg as the spot he walks into (the first chapter: the start of the day)
    const leg = (d: number) => sampleDay(d).leg;
    expect(leg(from)).toBe(i === 0 ? 0 : leg(to - 1e-6));
  });

  it("never starts him where the Union Square cable car can reach him", () => {
    for (let i = 0; i < chapters.length; i++) {
      const { from } = arrival(i);
      for (const w of crossings().windows) expect(from <= w.a || from >= w.b, `${chapters[i].id} at ${from.toFixed(2)}`).toBe(true);
    }
  });

  it("starts on the ground before a roof jump, not in mid-air (except the tall pyramid leap)", () => {
    const ads = chapters.findIndex((c) => c.id === "ads");
    expect(sampleDay(arrival(ads).from).mode).toBe("walk");
    const seo = chapters.findIndex((c) => c.id === "seo");
    // the pyramid is 28 tall: he comes up over the platform's edge for the last bit of the leap
    const start = sampleDay(arrival(seo).from).pos[1];
    expect(start).toBeGreaterThan(chapters[seo].spot[1] - 7);
  });

  it("walks the rest in about the time the camera takes to settle", () => {
    for (let i = 0; i < chapters.length; i++) {
      const { from, to } = arrival(i);
      let d = from;
      let t = 0;
      while (Math.abs(to - d) > 0.02 && t < 10) {
        d = walkOn(d, to, 1 / 60);
        t += 1 / 60;
      }
      expect(t, chapters[i].id).toBeGreaterThan(0.5);
      expect(t, chapters[i].id).toBeLessThan(3);
    }
  });
});

describe("the jump's timing and light", () => {
  it("takes longer the farther it goes: under 2 s to a neighbour, 4 s at most across the city", () => {
    const shot = (i: number) => new Vector3(...chapters[i].camera.position);
    let worst = 0;
    for (let i = 0; i < chapters.length; i++) {
      for (let j = 0; j < chapters.length; j++) {
        if (i === j) continue;
        const t = jumpTime(i, j);
        expect(t).toBeGreaterThanOrEqual(1.6);
        expect(t).toBeLessThanOrEqual(4);
        // never a rush: the camera averages under 25 units a second
        worst = Math.max(worst, shot(i).distanceTo(shot(j)) / t);
      }
    }
    expect(worst).toBeLessThan(25);
    expect(jumpTime(1, 2)).toBeLessThan(2); // Hayes Valley to the Mission, next door, nothing tall between
    expect(jumpTime(6, 7)).toBeGreaterThan(2.5); // Embarcadero to Russian Hill, across town
    expect(jumpTime(2, 3)).toBeCloseTo(jumpTime(3, 2), 6);
  });

  it("eases from 0 to 1 over its time, with no speed at either end", () => {
    expect(jumpEase(10, 10, 2)).toBe(0);
    expect(jumpEase(10, 12, 2)).toBe(1);
    expect(jumpEase(10, 99, 2)).toBe(1);
    expect(jumpEase(10, 10.01, 2)).toBeLessThan(0.001);
    expect(1 - jumpEase(10, 11.99, 2)).toBeLessThan(0.001);
    expect(jumpEase(10, 11, 2)).toBeCloseTo(0.5);
  });

  it("cross-fades the light the short way round the clock", () => {
    expect(sweepHour(12, 15, 0.5)).toBeCloseTo(13.5);
    // 22:00 back to 06:00 goes on through the night, not back through the day
    expect(sweepHour(22, 6, 0.5)).toBeCloseTo(26);
    // 06:00 to 22:00 runs back through the night
    expect(lightingAt(sweepHour(6, 22, 0.5)).night).toBe(1);
    // tomorrow's 06:00 is today's
    expect(sweepHour(30, 6, 0.5)).toBeCloseTo(6);
    for (let u = 0; u <= 1; u += 0.05) {
      const h = sweepHour(7, 22, u);
      expect(h).toBeGreaterThanOrEqual(6);
      expect(h).toBeLessThan(30.0001);
    }
  });

  it("shows the hour the light was at when the jump began, easing to the new one", () => {
    const at = 100;
    const s = { progress: 4, jump: { index: 4, at, hour: 12, cut: false, time: 2.4 } };
    expect(shownHour(s, at)).toBeCloseTo(12);
    expect(shownHour(s, at + 2.4)).toBeCloseTo(15);
    expect(shownHour(s, at + 1.2)).toBeCloseTo(13.5);
    expect(shownHour({ ...s, jump: null }, at)).toBeCloseTo(15);
  });
});

describe("goToChapter", () => {
  const reduced = (on: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: on && q.includes("reduce") }));
  afterEach(() => {
    useCity.setState(initialCity);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("lands the page on the chapter at once (no smooth scroll that walks him through every leg)", () => {
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    reduced(false);
    goToChapter(3);
    expect(useCity.getState().progress).toBe(3);
    expect(useCity.getState().jump).toMatchObject({ index: 3, cut: false, time: jumpTime(0, 3) });
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  });

  it("cuts straight there with reduced motion", () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    reduced(true);
    goToChapter(5);
    expect(useCity.getState().jump).toMatchObject({ index: 5, cut: true });
  });
});

describe("the camera flight", () => {
  const pose = (x: number, y: number, z: number) => ({ pos: new Vector3(x, y, z), tgt: new Vector3(x, 0, z - 10) });

  it("starts where the camera is, ends on the live shot, and lifts gently on the way", () => {
    const f = startFlight(pose(0, 5, 0), 0);
    const to = pose(60, 5, 0);
    const out = pose(0, 0, 0);
    flyAt(f, 0, to, out);
    expect(out.pos.distanceTo(new Vector3(0, 5, 0))).toBeLessThan(1e-6);
    flyAt(f, f.time / 2, to, out);
    expect(out.pos.y).toBeGreaterThan(6);
    flyAt(f, f.time, to, out);
    expect(out.pos.distanceTo(to.pos)).toBeLessThan(1e-6);
    expect(out.tgt.distanceTo(to.tgt)).toBeLessThan(1e-6);
  });

  it("retargets mid-flight without a jump in position or speed (same at 30, 60 and 120 fps)", () => {
    // high over the city: no roof to clear, just the gentle lift
    const a = pose(60, 80, 0);
    const b = pose(-40, 83, 30);
    const worstAt = (fps: number) => {
      const dt = 1 / fps;
      let f = startFlight(pose(0, 80, 0), 0);
      let to = a;
      const out = pose(0, 0, 0);
      const path: Vector3[] = [];
      for (let t = 0; t < 5; t += dt) {
        if (to === a && t >= 0.6) {
          // another click at 0.6 s: fly on from wherever the first flight is
          f = startFlight(f, t, a);
          to = b;
        }
        flyAt(f, t, to, out);
        path.push(out.pos.clone());
      }
      expect(path.at(-1)!.distanceTo(b.pos)).toBeLessThan(1e-6);
      let worst = 0;
      for (let i = 2; i < path.length; i++) {
        const v1 = path[i - 1].clone().sub(path[i - 2]).divideScalar(dt);
        const v2 = path[i].clone().sub(path[i - 1]).divideScalar(dt);
        worst = Math.max(worst, v2.distanceTo(v1) / dt);
      }
      return worst;
    };
    const [w30, w60, w120] = [worstAt(30), worstAt(60), worstAt(120)];
    // a step in speed shows as an acceleration that grows with the frame rate (x4 from 30 to 120 fps)
    expect(w120 / w30).toBeLessThan(1.15);
    expect(w60 / w30).toBeLessThan(1.15);
    expect(w120).toBeLessThan(2000);
  });

  it("never rushes: from any chapter's shot to any other the camera stays under 60 units a second", () => {
    // it peaked at over 200 when every jump took 1.3 s, on two eases stacked
    const shot = (i: number, phone: boolean) => {
      const c = phone ? chapters[i].phone : chapters[i].camera;
      return { pos: new Vector3(...c.position), tgt: new Vector3(...c.target) };
    };
    const out = pose(0, 0, 0);
    const dt = 1 / 120;
    let worst = 0;
    for (const phone of [false, true]) {
      for (let i = 0; i < chapters.length; i++) {
        for (let j = 0; j < chapters.length; j++) {
          if (i === j) continue;
          const f = startFlight(shot(i, phone), 0);
          flyAt(f, 0, shot(j, phone), out);
          let prev = shot(i, phone).pos;
          for (let t = dt; t <= f.time + 1e-9; t += dt) {
            flyAt(f, t, shot(j, phone), out);
            worst = Math.max(worst, out.pos.distanceTo(prev) / dt);
            prev = out.pos.clone();
          }
        }
      }
    }
    expect(worst).toBeLessThan(60);
  });

  it("arcs over the roofs: from any chapter's shot to any other it never enters a building", () => {
    const shot = (i: number, phone: boolean) => {
      const c = phone ? chapters[i].phone : chapters[i].camera;
      return { pos: new Vector3(...c.position), tgt: new Vector3(...c.target) };
    };
    const out = pose(0, 0, 0);
    for (const phone of [false, true]) {
      for (let i = 0; i < chapters.length; i++) {
        for (let j = 0; j < chapters.length; j++) {
          if (i === j) continue;
          const f = startFlight(shot(i, phone), 0);
          const to = shot(j, phone);
          flyAt(f, 0, to, out);
          for (let t = 0; t <= f.time; t += 1 / 120) {
            flyAt(f, t, to, out);
            expect(insideBuilding(out.pos.x, out.pos.y, out.pos.z), `${chapters[i].id} → ${chapters[j].id}${phone ? " (phone)" : ""} at ${t.toFixed(2)} s`).toBe(false);
          }
        }
      }
    }
  });

  it("turns one way: from any chapter's shot to any other the aim never swings back, nor looks straight down", () => {
    // 06:00 to 09:00 turned -134, -49, back to -107, then -37 degrees: a bounce (2026-10-15)
    const shot = (i: number, phone: boolean) => {
      const c = phone ? chapters[i].phone : chapters[i].camera;
      return { pos: new Vector3(...c.position), tgt: new Vector3(...c.target) };
    };
    const deg = (r: number) => (r * 180) / Math.PI;
    const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
    const out = pose(0, 0, 0);
    let worstBack = 0;
    let worstPitch = 0;
    let at = "";
    for (const phone of [false, true]) {
      for (let i = 0; i < chapters.length; i++) {
        for (let j = 0; j < chapters.length; j++) {
          if (i === j) continue;
          const from = shot(i, phone);
          const to = shot(j, phone);
          const heading = (p: { pos: Vector3; tgt: Vector3 }) => deg(Math.atan2(p.tgt.x - p.pos.x, p.tgt.z - p.pos.z));
          const net = wrap(heading(to) - heading(from));
          const f = startFlight(from, 0);
          flyAt(f, 0, to, out);
          let turned = 0;
          let most = 0;
          let last = heading(from);
          for (let t = 1 / 120; t <= f.time; t += 1 / 120) {
            flyAt(f, t, to, out);
            const d = out.tgt.clone().sub(out.pos);
            worstPitch = Math.max(worstPitch, -deg(Math.asin(d.y / d.length())));
            const h = heading(out);
            turned += wrap(h - last) * Math.sign(net || 1);
            last = h;
            most = Math.max(most, turned);
            if (most - turned > worstBack) {
              worstBack = most - turned;
              at = `${chapters[i].id} → ${chapters[j].id}${phone ? " (phone)" : ""} at ${t.toFixed(2)} s`;
            }
          }
        }
      }
    }
    expect(worstBack, at).toBeLessThan(10);
    expect(worstPitch).toBeLessThan(65);
  });
});
