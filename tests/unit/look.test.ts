import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { chapters } from "@/content/day";
import { lightingAt } from "@/lib/time";
import { NOON, TODAY, coc, dofAmount, focusGoal, gradePixel, liteLook, lookFor, passOn, stepFocus, type Look } from "@/lib/look";
import { AD_PANEL, FACE_Z, UNION } from "@/scene/union-square";

const ads = chapters.find((c) => c.id === "ads")!;

/** The desktop camera at rest on a chapter: where it stands and which way it looks. */
const shot = (c: (typeof chapters)[number]) => {
  const position = new Vector3(...c.camera.position);
  const forward = new Vector3(...c.camera.target).sub(position).normalize();
  return { position, forward, target: new Vector3(...c.camera.target) };
};

const middle = (spot: readonly [number, number, number]) => new Vector3(spot[0], spot[1] + 0.95, spot[2]);

describe("look per hour", () => {
  it("has no ambient occlusion at any hour (dropped 2026-10-15: about 3 ms for a little shading under cornices)", () => {
    for (const h of [6, 9, 10.5, 12, 15, 22]) expect(Object.keys(lookFor(h)), `${h}:00`).not.toContain("ao");
    expect(readFileSync("src/scene/post.tsx", "utf8")).not.toMatch(/N8AO/);
  });

  it("is tuned at every chapter: depth of field, a light grain, no tilt-shift, deeper shadows than today", () => {
    for (const c of chapters) {
      const L = lookFor(c.hour);
      expect(L, c.id).not.toEqual(TODAY);
      expect(L.dof, c.id).toBeGreaterThan(0);
      expect(L.tilt, c.id).toBe(0);
      expect(L.grain, c.id).toBeGreaterThan(0);
      expect(L.grain, c.id).toBeLessThan(0.1);
      expect(L.env, c.id).toBeLessThanOrEqual(TODAY.env);
    }
  });

  it("is warm by day (more red than blue) and never crushes the shadows", () => {
    for (const c of chapters) {
      const L = lookFor(c.hour);
      if (!c.dark) expect(L.gain[0], c.id).toBeGreaterThan(L.gain[2]);
      for (const v of L.lift) expect(v, c.id).toBeGreaterThanOrEqual(0);
      expect(L.contrast, c.id).toBeLessThanOrEqual(0.3);
    }
  });

  it("keeps the night's lit windows bright and its dark sky out of black", () => {
    const night = lookFor(chapters.find((c) => c.id === "night")!.hour);
    const window = gradePixel([0.85, 0.6, 0.3], night, 0.5);
    expect(window[0]).toBeGreaterThan(0.75);
    for (const c of gradePixel([0.004, 0.006, 0.02], night, 0.5)) expect(c).toBeGreaterThan(0.002);
  });

  it("never pops while scrolling: every value moves a little at a time through the whole day", () => {
    const nums = (L: Look) => [L.dof, L.focusRange / 20, L.tilt, L.saturation, ...L.gain, ...L.lift, L.contrast, L.grain, L.env, L.cusoFill / 2, L.bloom];
    for (let h = 6; h < 30; h += 0.05) {
      const a = nums(lookFor(h));
      const b = nums(lookFor(h + 0.05));
      a.forEach((v, i) => expect(Math.abs(b[i] - v), `value ${i} at ${h.toFixed(2)}`).toBeLessThan(0.03));
    }
  });

  it("blends between two chapters (each value between its neighbours)", () => {
    const hours = chapters.map((c) => c.hour);
    for (let i = 0; i < hours.length - 1; i++) {
      const [a, b] = [lookFor(hours[i]), lookFor(hours[i + 1])];
      const mid = lookFor((hours[i] + hours[i + 1]) / 2);
      for (const k of ["dof", "contrast", "grain", "env", "saturation", "cusoFill", "bloom"] as const) {
        expect(mid[k], `${k} ${hours[i]}..${hours[i + 1]}`).toBeGreaterThanOrEqual(Math.min(a[k], b[k]) - 1e-9);
        expect(mid[k], `${k} ${hours[i]}..${hours[i + 1]}`).toBeLessThanOrEqual(Math.max(a[k], b[k]) + 1e-9);
      }
    }
  });

  it("softens the bloom by a fifth at 06:00, where the low sun glints off the bay in frame; full bloom elsewhere", () => {
    expect(lookFor(6).bloom).toBeCloseTo(0.8);
    for (const c of chapters.filter((c) => c.id !== "arrive")) expect(lookFor(c.hour).bloom, c.id).toBe(1);
    expect(TODAY.bloom).toBe(1);
  });

  it("lights Cuso's face with a soft fill at 06:00, where the low sun is behind him; no fill at the other chapters", () => {
    expect(lookFor(6).cusoFill).toBeGreaterThan(0);
    expect(lookFor(6).cusoFill).toBeLessThan(lightingAt(6).sunIntensity / 2); // soft: well under the sun
    expect(lookFor(6.5).cusoFill).toBeLessThan(lookFor(6).cusoFill); // fades out toward 07:00
    expect(lookFor(6.5).cusoFill).toBeGreaterThan(0);
    for (const c of chapters.filter((c) => c.id !== "arrive")) expect(lookFor(c.hour).cusoFill, c.id).toBe(0);
    expect(TODAY.cusoFill).toBe(0);
    expect(liteLook(lookFor(6)).cusoFill).toBe(lookFor(6).cusoFill); // phones too
  });

  it("today's look draws no AO, no depth of field and no grade (only the toy tilt-shift)", () => {
    expect(TODAY.dof).toBe(0);
    expect(TODAY.tilt).toBeGreaterThan(0);
    expect(TODAY.gain).toEqual([1, 1, 1]);
    expect(TODAY.lift).toEqual([0, 0, 0]);
    expect(TODAY.contrast).toBe(0);
    expect(TODAY.grain).toBe(0);
  });

  it("at 12:00 has depth of field, a warm grade, grain and no tilt-shift", () => {
    const L = lookFor(12);
    expect(L).toEqual(NOON);
    expect(L.dof).toBeGreaterThan(0);
    expect(L.tilt).toBe(0);
    expect(L.gain[0]).toBeGreaterThan(L.gain[2]); // warm: more red than blue
    expect(L.grain).toBeGreaterThan(0);
    expect(L.grain).toBeLessThan(0.1); // light
    expect(L.env).toBeLessThan(TODAY.env); // less flat studio fill
  });

  it("on phones keeps the grade and the grain, never depth of field", () => {
    for (const h of [...chapters.map((c) => c.hour), 10.5, 3]) {
      const L = liteLook(lookFor(h));
      expect(L.dof).toBe(0);
      expect(L.gain).toEqual(lookFor(h).gain);
      expect(L.grain).toBe(lookFor(h).grain);
    }
    expect(liteLook(NOON).grain).toBeGreaterThan(0);
  });
});

describe("focus", () => {
  it("is on Cuso's middle at every chapter's desktop shot", () => {
    for (const c of chapters) {
      const { position, forward, target } = shot(c);
      const goal = focusGoal(position, forward, new Vector3(...c.spot), target);
      expect(goal, c.id).toBeCloseTo(position.distanceTo(middle(c.spot)), 5);
    }
  });

  it("falls back to what the camera looks at when Cuso is behind it, far away or not placed yet (flights)", () => {
    const { position, forward, target } = shot(ads);
    const behind = position.clone().addScaledVector(forward, -5);
    expect(focusGoal(position, forward, behind, target)).toBeCloseTo(position.distanceTo(target), 5);
    const far = position.clone().addScaledVector(forward, 300);
    expect(focusGoal(position, forward, far, target)).toBeCloseTo(position.distanceTo(target), 5);
    expect(focusGoal(position, forward, null, target)).toBeCloseTo(position.distanceTo(target), 5);
  });

  it("eases toward the goal, frame rate independent, and starts on it", () => {
    expect(stepFocus(null, 9, 1 / 60)).toBe(9);
    const a = stepFocus(20, 9, 1 / 60);
    expect(a).toBeLessThan(20);
    expect(a).toBeGreaterThan(9);
    let b = 20;
    for (let i = 0; i < 2; i++) b = stepFocus(b, 9, 1 / 120);
    expect(b).toBeCloseTo(a, 2);
    expect(stepFocus(20, 9, 10)).toBeCloseTo(9, 3);
  });
});

describe("depth of field at every chapter", () => {
  it.each(chapters.map((c) => [c.id, c] as const))("keeps Cuso sharp from head to feet at %s", (_, c) => {
    const { position, forward, target } = shot(c);
    const L = lookFor(c.hour);
    const focus = focusGoal(position, forward, new Vector3(...c.spot), target);
    for (const y of [0, 0.95, 1.9]) {
      const p = new Vector3(c.spot[0], c.spot[1] + y, c.spot[2]);
      expect(coc(position.distanceTo(p), focus, L.focusRange)).toBeLessThan(0.05);
    }
  });
});

describe("depth of field at 12:00", () => {
  const { position, forward, target } = shot(ads);
  const focus = focusGoal(position, forward, new Vector3(...ads.spot), target);

  it("keeps the billboard ad nearly sharp, corners included", () => {
    const [W, H] = AD_PANEL;
    for (const sx of [-0.5, 0, 0.5])
      for (const sy of [-0.5, 0, 0.5]) {
        const p = new Vector3(UNION.board.x + sx * W, UNION.board.y + sy * H, FACE_Z);
        expect(coc(position.distanceTo(p), focus, NOON.focusRange), `${sx},${sy}`).toBeLessThan(0.3);
      }
  });

  it("softens the far city", () => {
    expect(coc(focus + 40, focus, NOON.focusRange)).toBeGreaterThan(0.9);
    expect(coc(400, focus, NOON.focusRange)).toBe(1);
  });

  it("never blurs Explore or the camera high above the city, and fades between", () => {
    expect(dofAmount(NOON, 1)).toBe(0);
    expect(dofAmount(NOON, 0)).toBe(NOON.dof);
    expect(dofAmount(NOON, 0.5)).toBeGreaterThan(0);
    expect(dofAmount(NOON, 0.5)).toBeLessThan(NOON.dof);
    expect(dofAmount(TODAY, 0)).toBe(0);
  });
});

describe("grade", () => {
  const samples = [0, 0.001, 0.02, 0.18, 0.5, 0.9, 1];

  it("is the identity in today's look", () => {
    for (const v of samples) for (const n of [0, 0.5, 1]) gradePixel([v, v, v], TODAY, n).forEach((c) => expect(c).toBeCloseTo(v, 6));
  });

  it("stays within 0..1 at 12:00, whatever the grain", () => {
    for (const r of samples)
      for (const b of samples)
        for (const n of [0, 0.5, 1])
          for (const c of gradePixel([r, 0.5, b], NOON, n)) {
            expect(c).toBeGreaterThanOrEqual(0);
            expect(c).toBeLessThanOrEqual(1);
          }
  });

  it("warms a grey and never crushes the shadows to black", () => {
    const [r, , b] = gradePixel([0.18, 0.18, 0.18], NOON, 0.5);
    expect(r).toBeGreaterThan(b);
    const dark = gradePixel([0.01, 0.01, 0.01], NOON, 0.5);
    for (const c of dark) expect(c).toBeGreaterThan(0.005);
  });

  it("adds grain to mid-tones, not to pure black or white", () => {
    const lo = gradePixel([0.2, 0.2, 0.2], NOON, 0);
    const hi = gradePixel([0.2, 0.2, 0.2], NOON, 1);
    expect(hi[1] - lo[1]).toBeGreaterThan(0);
    expect(gradePixel([1, 1, 1], NOON, 0)[1]).toBeCloseTo(gradePixel([1, 1, 1], NOON, 1)[1], 6);
  });
});

describe("passes", () => {
  it("stay on until every shader is compiled, then only while they do something", () => {
    expect(passOn(0, false)).toBe(true);
    expect(passOn(0, true)).toBe(false);
    expect(passOn(0.4, true)).toBe(true);
  });
});
