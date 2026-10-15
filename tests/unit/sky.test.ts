import { describe, expect, it } from "vitest";
import { lightingAt } from "@/lib/time";
import { NOISE, TODAY, cloudColors, cloudNoise, horizonColor, skyAt, skyMaterial } from "@/scene/sky";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("sky through the day", () => {
  it("is today's clear sky at every hour not tuned yet", () => {
    for (const h of [0, 3, 6, 7, 9, 15, 18, 20, 22, 26, 30]) expect(skyAt(h), `${h}:00`).toEqual(TODAY);
    expect(TODAY.cover).toBe(0);
    expect(TODAY.haze).toBe(0);
    expect(TODAY.fogScale).toBe(1);
  });

  it("has scattered clouds and haze at 12:00", () => {
    const s = skyAt(12);
    expect(s.cover).toBeGreaterThanOrEqual(0.25);
    expect(s.cover).toBeLessThanOrEqual(0.5);
    expect(s.haze).toBeGreaterThan(0);
    expect(s.fogScale).toBeLessThan(1);
    expect(s.fogScale).toBeGreaterThan(0.5);
  });

  it("blends between hours, so a scroll from 09:00 to 12:00 never pops", () => {
    const a = skyAt(10.5);
    expect(a.cover).toBeGreaterThan(0);
    expect(a.cover).toBeLessThan(skyAt(12).cover);
    expect(a.fogScale).toBeLessThan(1);
    expect(a.fogScale).toBeGreaterThan(skyAt(12).fogScale);
    expect(skyAt(11.9).cover).toBeGreaterThan(skyAt(11).cover);
    expect(skyAt(13.5).haze).toBeGreaterThan(0);
    expect(skyAt(13.5).haze).toBeLessThan(skyAt(12).haze);
  });

  it("keeps today's horizon at untuned hours", () => {
    for (const h of [6, 9, 15, 18, 22]) expect(horizonColor(lightingAt(h), skyAt(h)), `${h}:00`).toBe(lightingAt(h).skyHorizon);
  });

  it("at 12:00 sits the horizon between the sky's horizon and the distance fog, so the city melts into it", () => {
    const L = lightingAt(12);
    const c = rgb(horizonColor(L, skyAt(12)));
    const a = rgb(L.skyHorizon);
    const b = rgb(L.fog);
    expect(horizonColor(L, skyAt(12))).not.toBe(L.skyHorizon);
    c.forEach((v, i) => {
      expect(v).toBeGreaterThanOrEqual(Math.min(a[i], b[i]));
      expect(v).toBeLessThanOrEqual(Math.max(a[i], b[i]));
    });
  });
});

describe("cloud colours", () => {
  it("are white by day, with darker undersides", () => {
    const { lit, shade } = cloudColors(lightingAt(12));
    expect(Math.min(...rgb(lit))).toBeGreaterThan(200); // the noon sun is a touch warm
    expect(luma(shade)).toBeLessThan(luma(lit));
  });

  it("are darker at night", () => {
    expect(luma(cloudColors(lightingAt(23)).lit)).toBeLessThan(luma(cloudColors(lightingAt(12)).lit) * 0.5);
  });

  it("are never brighter than the sun", () => {
    for (let h = 6; h <= 30; h += 0.5) {
      const L = lightingAt(h);
      expect(luma(cloudColors(L).lit), `${h}:00`).toBeLessThanOrEqual(luma(L.sunColor));
    }
  });
});

describe("cloud noise", () => {
  const n = cloudNoise();
  const at = (x: number, y: number) => n[(y % NOISE.size) * NOISE.size + (x % NOISE.size)];

  it("is deterministic", () => {
    expect(cloudNoise()).toEqual(n);
  });

  it("tiles without a seam: across the wrap it steps no more than inside", () => {
    let inside = 0;
    let wrap = 0;
    for (let y = 0; y < NOISE.size; y++) {
      for (let x = 0; x < NOISE.size - 1; x++) inside = Math.max(inside, Math.abs(at(x + 1, y) - at(x, y)), Math.abs(at(y, x + 1) - at(y, x)));
      wrap = Math.max(wrap, Math.abs(at(0, y) - at(NOISE.size - 1, y)), Math.abs(at(y, 0) - at(y, NOISE.size - 1)));
    }
    expect(wrap).toBeLessThanOrEqual(inside);
  });

  it("uses the whole range", () => {
    expect(Math.min(...n)).toBeLessThan(40);
    expect(Math.max(...n)).toBeGreaterThan(215);
  });
});

describe("sky material", () => {
  it("keeps the water's contract: back side, uniforms top and horizon", () => {
    for (const lite of [false, true]) {
      const m = skyMaterial(lite);
      expect(m.side).toBe(1); // BackSide
      expect(m.uniforms.top.value.isColor).toBe(true);
      expect(m.uniforms.horizon.value.isColor).toBe(true);
      expect(m.fog).toBe(false);
      expect(m.depthWrite).toBe(false);
    }
  });

  it("draws fewer noise octaves on phones", () => {
    expect(Number(skyMaterial(true).defines.OCTAVES)).toBeLessThan(Number(skyMaterial(false).defines.OCTAVES));
  });
});
