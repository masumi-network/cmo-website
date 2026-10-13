import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { downtownMaterial, houseMaterial } from "@/scene/materials";
import { glassUniforms, PROBE_SIZE, probeDue, probeSpot, type ProbeKey } from "@/scene/reflections";

const key = (o: Partial<ProbeKey> = {}): ProbeKey => ({ index: 1, hour: 7, explore: false, time: 10, settled: true, ...o });

describe("probe update policy", () => {
  it("renders once after load", () => {
    expect(probeDue(null, key(), false)).toBe(true);
    expect(probeDue(null, key(), true)).toBe(true);
  });

  it("never re-renders a still view", () => {
    for (const lite of [false, true]) expect(probeDue(key(), key({ time: 99 }), lite)).toBe(false);
  });

  it("re-renders when the chapter or mode changes", () => {
    expect(probeDue(key(), key({ index: 2, settled: false }), false)).toBe(true);
    expect(probeDue(key(), key({ explore: true }), false)).toBe(true);
  });

  it("follows the hour while travelling, in steps and not too often", () => {
    const last = key({ hour: 18, settled: false });
    expect(probeDue(last, key({ hour: 18.2, time: 11, settled: false }), false)).toBe(false);
    expect(probeDue(last, key({ hour: 18.6, time: 10.1, settled: false }), false)).toBe(false);
    expect(probeDue(last, key({ hour: 18.6, time: 11, settled: false }), false)).toBe(true);
  });

  it("catches up with the exact hour once the chapter settles", () => {
    expect(probeDue(key({ hour: 21.8, settled: false }), key({ hour: 22 }), false)).toBe(true);
  });

  it("lite waits for the chapter to settle: one render per chapter", () => {
    expect(probeDue(key(), key({ index: 2, hour: 8, settled: false }), true)).toBe(false);
    expect(probeDue(key(), key({ index: 2, hour: 9 }), true)).toBe(true);
    expect(probeDue(key({ index: 2, hour: 9 }), key({ index: 2, hour: 9, time: 50 }), true)).toBe(false);
  });

  it("is smaller in lite", () => {
    expect(PROBE_SIZE.lite).toBeLessThan(PROBE_SIZE.full);
  });
});

describe("probe placement", () => {
  it("sits over each chapter's subject, above the ground, inside its box", () => {
    chapters.forEach((c, i) => {
      const { position: p, min, max } = probeSpot(i, false);
      expect(Math.hypot(p[0] - c.camera.target[0], p[2] - c.camera.target[2])).toBeLessThan(0.01);
      expect(p[1]).toBeGreaterThan(heightAt(p[0], p[2]) + 1);
      for (let k = 0; k < 3; k++) {
        expect(min[k]).toBeLessThan(p[k]);
        expect(max[k]).toBeGreaterThan(p[k]);
      }
      // the box floor is the street, so reflections looking down land on it
      expect(min[1]).toBeLessThanOrEqual(heightAt(p[0], p[2]));
    });
  });

  it("explore mode looks over the whole city", () => {
    const { min, max } = probeSpot(0, true);
    expect(max[0] - min[0]).toBeGreaterThan(100);
  });
});

describe("glass samples the probe", () => {
  const compile = (m: MeshStandardMaterial) => {
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_maps>\n#include <emissivemap_fragment>" } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, undefined as never);
    return shader;
  };

  it("houses and downtown glass share the probe uniforms", () => {
    const tex = { isTexture: true } as never;
    for (const m of [houseMaterial(tex, tex, new Float32Array(3 * 30)), downtownMaterial(tex)]) {
      const s = compile(m);
      expect(s.uniforms.uGlassEnv).toBe(glassUniforms.uGlassEnv);
      expect(s.uniforms.uProbePos).toBe(glassUniforms.uProbePos);
      expect(s.fragmentShader).toContain("glassEnv(");
      // the studio light no longer shows in glass; the city does
      expect(s.fragmentShader).toMatch(/radiance \*=/);
    }
  });
});
