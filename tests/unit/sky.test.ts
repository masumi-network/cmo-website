import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { lightingAt } from "@/lib/time";
import { NOISE, TODAY, cloudColors, cloudNoise, horizonColor, skyAt, skyMaterial } from "@/scene/sky";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luma = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("sky through the day", () => {
  it("has haze and a nearer story fog at every chapter; today's clear sky stays for `?look=off`", () => {
    for (const c of chapters) {
      const s = skyAt(c.hour);
      expect(s.haze, c.id).toBeGreaterThan(0);
      expect(s.cover, c.id).toBeLessThanOrEqual(0.6);
      expect(s.fogScale, c.id).toBeLessThan(1);
      expect(s.fogScale, c.id).toBeGreaterThanOrEqual(0.5);
    }
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

  it("never pops while scrolling: every value moves a little at a time through the whole day", () => {
    for (let h = 6; h < 30; h += 0.05) {
      const a = skyAt(h);
      const b = skyAt(h + 0.05);
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect(Math.abs(b[k] - a[k]), `${k} at ${h.toFixed(2)}`).toBeLessThan(k === "scale" ? 0.1 : 0.03);
    }
  });

  it("at every chapter sits the horizon between the sky's horizon and the distance fog", () => {
    for (const ch of chapters) {
      const L = lightingAt(ch.hour);
      const c = rgb(horizonColor(L, skyAt(ch.hour)));
      const a = rgb(L.skyHorizon);
      const b = rgb(L.fog);
      c.forEach((v, i) => {
        expect(v, ch.id).toBeGreaterThanOrEqual(Math.min(a[i], b[i]));
        expect(v, ch.id).toBeLessThanOrEqual(Math.max(a[i], b[i]));
      });
    }
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
