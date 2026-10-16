import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { WATER_Y } from "@/scene/bay";
import {
  CHOP,
  CHOP_GAIN,
  LEAN_SKIP,
  MIRROR_HEIGHT,
  PROBE_FADE,
  SKY,
  SMEAR,
  WATER_HOURS,
  calm,
  leanSkip,
  mirrorShift,
  mirrorWanted,
  phoneReflection,
  probeFade,
  skyShape,
  smearSpread,
  waterAt,
} from "@/scene/water";

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Before the water pass (2026-10-16). */
const TODAY = {
  shift: (slope: number, w: number) => (slope * 0.6) / (w + 8),
  calm: (d: number) => 1 - 0.8 * smoothstep(15, 180, d),
  sky: { slope: 0.4, span: 1 },
};
const hours = Array.from({ length: 481 }, (_, i) => 6 + i * 0.05);

describe("mirror smear (item 1)", () => {
  it("shifts the mirror sideways half as much as before (less wobble across the streaks)", () => {
    const [x, y] = mirrorShift(0.2, 0.2, 1, 40);
    expect(x).toBeCloseTo(TODAY.shift(0.2, 40) / 2, 6);
    expect(Math.abs(y)).toBeGreaterThanOrEqual(Math.abs(x));
  });

  it("moves more toward the camera than sideways, and more at grazing angles", () => {
    for (const w of [5, 20, 80, 300]) {
      const [x, y] = mirrorShift(0.2, 0.2, 0.15, w);
      expect(Math.abs(y), `w ${w}`).toBeGreaterThan(2 * Math.abs(x));
      expect(Math.abs(mirrorShift(0, 0.2, 0.08, w)[1])).toBeGreaterThanOrEqual(Math.abs(mirrorShift(0, 0.2, 0.3, w)[1]));
    }
  });

  it("fades with distance, more slowly than today", () => {
    const at = (w: number) => Math.abs(mirrorShift(0, 0.1, 1, w)[1]);
    expect(at(10)).toBeGreaterThan(at(100));
    expect(at(100) / at(10)).toBeGreaterThan(TODAY.shift(0.1, 100) / TODAY.shift(0.1, 10));
  });

  it("stays within bounds, however steep the ripple or low the view", () => {
    for (const s of [-1, -0.4, 0, 0.4, 1])
      for (const v of [0, 0.02, 0.2, 1])
        for (const w of [0.5, 3, 30, 500]) {
          const [x, y] = mirrorShift(s, s, v, w);
          expect(Math.abs(x)).toBeLessThanOrEqual(SMEAR.max);
          expect(Math.abs(y)).toBeLessThanOrEqual(SMEAR.max);
        }
    const most = Math.max(...WATER_HOURS.map(([, h]) => h.smear));
    const far = Math.max(...SMEAR.taps.map(([o]) => Math.abs(o))) * smearSpread(most, 0, 1);
    expect(SMEAR.max + far).toBeLessThan(0.2);
  });

  it("takes four samples along the screen's vertical, weights adding up to one", () => {
    expect(SMEAR.taps).toHaveLength(4);
    expect(SMEAR.taps.reduce((s, [, k]) => s + k, 0)).toBeCloseTo(1, 6);
    expect(smearSpread(0.02, 1, 1)).toBe(0); // from straight above: no streak
    expect(smearSpread(0.02, 0.1, 1)).toBeGreaterThan(smearSpread(0.02, 0.5, 1));
    expect(smearSpread(0.02, 0.1, -1)).toBeGreaterThanOrEqual(0);
  });

  it("runs longest at night, under the 22:00 lights", () => {
    const night = waterAt(22).smear;
    for (const c of chapters) if (c.hour !== 22) expect(waterAt(c.hour).smear, c.id).toBeLessThan(night);
    expect(night).toBeGreaterThan(1.5 * waterAt(12).smear);
  });

  it("moves the mirror mostly with the long ripples: the fine chop would break streaks into speckle", () => {
    expect(CHOP[2].mirror).toBeLessThan(CHOP[2].weight / 2);
    expect(CHOP[0].mirror).toBe(CHOP[0].weight);
  });
});

describe("finer chop (item 2)", () => {
  it("adds a third ripple layer about 2.9 m across, turned about 37 degrees", () => {
    expect(CHOP).toHaveLength(3);
    const [a, b, c] = CHOP;
    expect(1 / c.scale).toBeGreaterThan(2.7);
    expect(1 / c.scale).toBeLessThan(3.1);
    expect(a.turn).toBe(0);
    expect(b.turn).toBe(0);
    expect(c.turn).toBeCloseTo(37, 0);
    expect(c.scale).toBeGreaterThan(2 * b.scale);
    // and it drifts its own way
    const angle = (d: readonly number[]) => Math.atan2(d[1], d[0]);
    for (const l of [a, b]) expect(Math.abs(Math.sin(angle(c.drift) - angle(l.drift)))).toBeGreaterThan(0.3);
  });

  it("keeps about today's ripple strength near the camera (was (0.55 + 0.45) x 0.26)", () => {
    const strength = CHOP.reduce((s, l) => s + l.weight, 0) * CHOP_GAIN;
    expect(strength / 0.26).toBeGreaterThan(0.85);
    expect(strength / 0.26).toBeLessThan(1.4);
  });

  it("flattens less with distance than today (the texture's mipmaps already do)", () => {
    for (let d = 0; d <= 400; d += 5) {
      expect(calm(d), `${d}`).toBeGreaterThanOrEqual(TODAY.calm(d) - 1e-9);
      expect(calm(d)).toBeLessThanOrEqual(1);
      expect(calm(d + 5)).toBeLessThanOrEqual(calm(d) + 1e-9);
    }
    expect(calm(400)).toBeGreaterThan(0.3);
  });
});

describe("phones reflect the glass probe (item 3)", () => {
  it("fades out away from the probe, back to today's gradient", () => {
    expect(probeFade(0)).toBe(1);
    expect(probeFade(PROBE_FADE.near)).toBe(1);
    expect(probeFade(PROBE_FADE.far)).toBe(0);
    expect(probeFade(PROBE_FADE.far + 100)).toBe(0);
    for (let d = 0; d < 200; d += 2) expect(probeFade(d + 2)).toBeLessThanOrEqual(probeFade(d));
  });

  it("is never darker than today's gradient, so night water never goes black", () => {
    const sky: [number, number, number] = [0.05, 0.07, 0.12];
    for (const probe of [[0, 0, 0], [0.01, 0.2, 0.01], [0.9, 0.6, 0.3]] as [number, number, number][])
      for (const f of [0, 0.3, 1]) {
        const c = phoneReflection(sky, probe, f);
        for (let i = 0; i < 3; i++) expect(c[i]).toBeGreaterThanOrEqual(sky[i]);
      }
    expect(phoneReflection(sky, [0.9, 0.6, 0.3], 0)).toEqual(sky);
    phoneReflection(sky, [0.9, 0.6, 0.3], 1).forEach((v, i) => expect(v).toBeCloseTo([0.9, 0.6, 0.3][i], 9));
  });
});

describe("milder sky in the waves (item 4)", () => {
  it("keeps today's sky from above (15:00, the finale: no flecks)", () => {
    for (const v of [SKY.graze[1], 0.5, 0.8, 1]) for (const s of [0, 0.5, 1]) expect(skyShape(v, s)).toEqual(TODAY.sky);
  });

  it("at grazing views, sees more of the slope and spans about the first 17 degrees over the horizon", () => {
    const g = skyShape(0, 1);
    expect(g.slope).toBeGreaterThan(TODAY.sky.slope);
    expect(g.slope).toBeLessThan(0.85); // the prototype's strength: too blue
    const top = (Math.asin(0.55 / g.span) * 180) / Math.PI; // the gradient tops out at R.y 0.55 / span
    expect(top).toBeGreaterThan(15);
    expect(top).toBeLessThan(20);
  });

  it("is a per-hour amount between 0 and 1, strongest at 06:00 and 18:00", () => {
    for (const [, h] of WATER_HOURS) {
      expect(h.sky).toBeGreaterThanOrEqual(0);
      expect(h.sky).toBeLessThanOrEqual(1);
    }
    for (const c of chapters) expect(waterAt(c.hour).sky, c.id).toBeLessThanOrEqual(Math.min(waterAt(6).sky, waterAt(18).sky));
  });
});

describe("per-hour table", () => {
  it("covers the day, 06:00 to 06:00 the next morning, and wraps without a jump", () => {
    expect(WATER_HOURS[0][0]).toBe(6);
    expect(WATER_HOURS.at(-1)![0]).toBe(30);
    expect(waterAt(30).smear).toBeCloseTo(waterAt(6).smear, 9);
    expect(waterAt(30).sky).toBeCloseTo(waterAt(6).sky, 9);
    expect(waterAt(3)).toEqual(waterAt(27)); // before 06:00 is the night before
  });

  it("never pops: small steps in the hour change it a little", () => {
    for (let i = 1; i < hours.length; i++) {
      const a = waterAt(hours[i - 1]);
      const b = waterAt(hours[i]);
      expect(Math.abs(b.smear - a.smear), `${hours[i]}`).toBeLessThan(0.002);
      expect(Math.abs(b.sky - a.sky), `${hours[i]}`).toBeLessThan(0.05);
    }
  });
});

describe("leaner mirror (item 5)", () => {
  it("leaves out the city's houses, street ground, trees, shop glass and small wood, and Cuso anywhere", () => {
    for (const k of ["house", "ground", "tree-leaves", "tree-bark", "shop-glass", "wood"]) expect(leanSkip(k, "", true), k).toBe(true);
    expect(LEAN_SKIP).toHaveLength(6);
    expect(leanSkip("cuso-back-fill", "Mesh0", false)).toBe(true); // on the pier, over the water
    for (const n of ["EyeL", "EyeR"]) expect(leanSkip("", n, false), n).toBe(true);
  });

  it("keeps what stands at or over the water: island buildings, towers, landmarks, the pier, boats, the sea wall, the coast", () => {
    expect(leanSkip("house", "", false)).toBe(false); // Alcatraz's cellhouse, Treasure Island
    for (const k of ["", "downtown", "concrete", "coit", "ferry-market", "wood-pier", "wood-boards", "bay-sailcloth", "taqueria", "shop-painted", "coast-rocks"])
      for (const land of [true, false]) expect(leanSkip(k, "Mesh", land), k).toBe(false);
  });

  it("draws the mirror at every chapter camera, desktop and phone, and never in Explore or high overhead", () => {
    for (const c of chapters) {
      expect(mirrorWanted(c.camera.position[1] - WATER_Y, false), c.id).toBe(1);
      expect(mirrorWanted(c.phone.position[1] - WATER_Y, false), `${c.id} phone`).toBe(1);
    }
    expect(mirrorWanted(10, true)).toBe(0);
    expect(mirrorWanted(MIRROR_HEIGHT[1], false)).toBe(0);
    expect(mirrorWanted(MIRROR_HEIGHT[1] + 100, false)).toBe(0);
    for (let h = 0; h < 120; h++) expect(mirrorWanted(h + 1, false)).toBeLessThanOrEqual(mirrorWanted(h, false));
  });
});
