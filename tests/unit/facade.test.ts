import { describe, expect, it } from "vitest";
import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { ASHLAR, BRICK, BRICK_BR, FACADE_GLSL, OIL_CANNING, facadeNight, glassTint, isBrick, masonryCell } from "@/scene/facade";
import { CITY } from "@/scene/layout";
import { downtownMaterial } from "@/scene/materials";
import { towerStyle } from "@/scene/towers";

const RED_BRICK = ["#9e6450", "#8c5a4a"];
const ratio = (hex: string) => {
  const c = new Color(hex);
  return c.b / c.r;
};

describe("brick or stone", () => {
  const styles = CITY.towers.map(towerStyle);

  it("reads red brick lofts as brick, and nothing else", () => {
    expect(styles.some((s) => s.style === "loft" && RED_BRICK.includes(s.color))).toBe(true);
    for (const s of styles) {
      expect(isBrick(s.color)).toBe(s.style === "loft" && RED_BRICK.includes(s.color));
      expect(isBrick(s.trim)).toBe(false);
      expect(isBrick(s.base)).toBe(false);
    }
    for (const hex of RED_BRICK) expect(isBrick(hex)).toBe(true);
  });

  it("decides well clear of the threshold (vertex colours interpolate)", () => {
    for (const s of styles) for (const hex of [s.color, s.trim, s.base]) expect(Math.abs(ratio(hex) - BRICK_BR)).toBeGreaterThan(0.1);
  });
});

describe("masonry", () => {
  it("has thin joints", () => {
    for (const k of [ASHLAR, BRICK]) {
      expect(k.joint / k.course).toBeLessThan(0.16);
      expect(k.joint / k.length).toBeLessThan(0.06);
    }
  });

  it("sizes stone blocks and bricks like the real thing", () => {
    expect(ASHLAR.length / ASHLAR.course).toBeGreaterThan(1.8);
    expect(BRICK.length / BRICK.course).toBeGreaterThan(2.2);
    // a deco storey (1.25) holds a few stone courses and many brick ones
    expect(1.25 / ASHLAR.course).toBeGreaterThan(3);
    expect(1.4 / BRICK.course).toBeGreaterThan(12);
  });

  it("staggers each course by half a unit", () => {
    for (const brick of [false, true]) {
      const k = brick ? BRICK : ASHLAR;
      for (let row = -3; row < 3; row++) {
        for (let col = -3; col < 3; col++) {
          // a head joint in this course lands mid-unit in the next
          const x = (col + (row % 2 === 0 ? 0 : -0.5)) * k.length + 1e-6;
          const here = masonryCell(x, (row + 0.5) * k.course, brick);
          const above = masonryCell(x, (row + 1.5) * k.course, brick);
          expect(here.row).toBe(row);
          expect(here.fx).toBeLessThan(1e-3);
          expect(Math.abs(above.fx - 0.5)).toBeLessThan(1e-3);
        }
      }
    }
  });
});

describe("glass tints", () => {
  it("stay calm for every seed", () => {
    for (let i = 0; i <= 1000; i++) {
      const t = glassTint(i / 1000);
      for (const v of t) {
        expect(v).toBeGreaterThanOrEqual(0.85);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...t) / Math.min(...t)).toBeLessThan(1.18);
    }
  });

  it("vary between towers: neutral, green and bronze", () => {
    const kinds = new Set(Array.from({ length: 1000 }, (_, i) => glassTint(i / 1000).join()));
    expect(kinds.size).toBe(3);
  });
});

describe("downtown shader", () => {
  const compile = (m: MeshStandardMaterial) => {
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_maps>\n#include <emissivemap_fragment>" } as unknown as WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(shader, undefined as never);
    return shader.fragmentShader;
  };

  it("compiles with facade detail and keeps its program key", () => {
    const m = downtownMaterial({ isTexture: true } as never);
    const frag = compile(m);
    expect(m.customProgramCacheKey()).toBe("downtown");
    expect(frag).toContain(FACADE_GLSL);
    const body = frag.slice(frag.indexOf("#include <color_fragment>"));
    for (const call of ["facMasonry(", "facCurtain(", "facPane("]) expect(body).toContain(call);
    // pane bow and joint relief reach the lights and the reflections; panes tint what they reflect
    expect(body.slice(body.indexOf("#include <normal_fragment_maps>"))).toContain("facBend");
    expect(body.slice(body.indexOf("#include <emissivemap_fragment>"))).toMatch(/glassEnv\([^;]*facGlass/);
  });

  it("prefixes every facade GLSL symbol with fac", () => {
    // top level only: drop function bodies and argument lists
    let top = FACADE_GLSL.replace(/\/\/.*$/gm, "");
    for (let prev = ""; prev !== top; ) [prev, top] = [top, top.replace(/\{[^{}]*\}/g, ";").replace(/\([^()]*\)/g, "")];
    const names = [...top.matchAll(/\b(?:float|int|bool|void|vec[234]|mat[234])(?:\[\d+\])?\s+(\w+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(5);
    for (const n of names) expect(n).toMatch(/^(fac|FAC_)/);
  });

  it("keeps oil-canning subtle, so the city in the glass stays crisp", () => {
    // A pane 15 units from what it mirrors shifts the image by 2 x bow x 15: under a fifth of a pane (0.4 wide).
    expect(OIL_CANNING).toEqual({ pillow: expect.any(Number) });
    expect(OIL_CANNING.pillow).toBeLessThanOrEqual(0.008);
  });

  it("keeps the city in curtain glass whole: no per-pane lean, plenum band or weaker panes", () => {
    // Each of these broke the 12:00 tower's reflection into a grey haze (city-scene.md).
    const curtain = FACADE_GLSL.slice(FACADE_GLSL.indexOf("vec3 facCurtain("));
    expect(curtain.match(/vec2 a = [^;]*;/)?.[0]).not.toContain("rnd");
    expect(curtain).not.toContain("plenum");
    expect(curtain).not.toContain("out vec3 glass");
  });

  it("lets one material keep plain curtain glass (the Pyramid) on the same program", () => {
    const tex = { isTexture: true } as never;
    const [towers, pyramid] = [downtownMaterial(tex), downtownMaterial(tex, false)];
    const [a, b] = [towers, pyramid].map((m) => {
      const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>" } as unknown as WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, undefined as never);
      return shader;
    });
    expect(pyramid.customProgramCacheKey()).toBe(towers.customProgramCacheKey());
    expect(a.fragmentShader).toBe(b.fragmentShader);
    expect(a.uniforms.uCurtain).toEqual({ value: 1 });
    expect(b.uniforms.uCurtain).toEqual({ value: 0 });
    expect(a.fragmentShader).toContain("facCurtain(fTint, vTUv, vFNormal, fRnd, fS, fM, uCurtain,");
  });

  it("keeps the night level", () => {
    expect(facadeNight.value).toBe(0);
  });
});
