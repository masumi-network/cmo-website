import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { chapters } from "@/content/day";
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
  it("is today's look at every hour not tuned yet", () => {
    for (const h of [6, 7, 8, 9, 15, 18, 20, 22, 26, 30, 3]) expect(lookFor(h), `${h}:00`).toEqual(TODAY);
  });

  it("today's look draws no AO, no depth of field and no grade (only the toy tilt-shift)", () => {
    expect(TODAY.ao).toBe(0);
    expect(TODAY.dof).toBe(0);
    expect(TODAY.tilt).toBeGreaterThan(0);
    expect(TODAY.gain).toEqual([1, 1, 1]);
    expect(TODAY.lift).toEqual([0, 0, 0]);
    expect(TODAY.contrast).toBe(0);
    expect(TODAY.grain).toBe(0);
  });

  it("at 12:00 has contact shadows, depth of field, a warm grade, grain and no tilt-shift", () => {
    const L = lookFor(12);
    expect(L).toEqual(NOON);
    expect(L.ao).toBeGreaterThan(0);
    expect(L.dof).toBeGreaterThan(0);
    expect(L.tilt).toBe(0);
    expect(L.gain[0]).toBeGreaterThan(L.gain[2]); // warm: more red than blue
    expect(L.grain).toBeGreaterThan(0);
    expect(L.grain).toBeLessThan(0.1); // light
    expect(L.env).toBeLessThan(TODAY.env); // less flat studio fill
  });

  it("blends between 09:00 and 12:00 and back by 15:00 (no pop while scrolling)", () => {
    const keys: (keyof Look)[] = ["ao", "dof", "tilt", "contrast", "grain", "env", "saturation"];
    for (const h of [10, 10.5, 11, 13, 14]) {
      const L = lookFor(h);
      for (const k of keys) {
        const [lo, hi] = [Math.min(TODAY[k] as number, NOON[k] as number), Math.max(TODAY[k] as number, NOON[k] as number)];
        expect(L[k] as number, `${k} at ${h}`).toBeGreaterThanOrEqual(lo);
        expect(L[k] as number, `${k} at ${h}`).toBeLessThanOrEqual(hi);
      }
    }
    expect(lookFor(10.5).ao).toBeCloseTo(NOON.ao / 2, 5);
    expect(lookFor(11).ao).toBeGreaterThan(lookFor(10).ao);
  });

  it("on phones keeps the grade and the grain, never AO or depth of field", () => {
    for (const h of [6, 10.5, 12, 22]) {
      const L = liteLook(lookFor(h));
      expect(L.ao).toBe(0);
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

describe("depth of field at 12:00", () => {
  const { position, forward, target } = shot(ads);
  const focus = focusGoal(position, forward, new Vector3(...ads.spot), target);

  it("keeps Cuso sharp from head to feet", () => {
    for (const y of [0, 0.95, 1.9]) {
      const p = new Vector3(ads.spot[0], ads.spot[1] + y, ads.spot[2]);
      expect(coc(position.distanceTo(p), focus, NOON.focusRange)).toBeLessThan(0.05);
    }
  });

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
