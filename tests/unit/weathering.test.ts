import { describe, expect, it } from "vitest";
import { MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from "three";
import { HILLS, PLAZA, heightAt } from "@/lib/terrain";
import { LAND_BOUNDS } from "@/scene/grid";
import { CITY } from "@/scene/layout";
import { downtownMaterial, groundMaterial, houseMaterial } from "@/scene/materials";
import { CONTACT, contactRects } from "@/scene/textures";
import { FOOT, GRIME_TOP, GROUND_GLSL, MAX_GRIME, TONE, WEATHER_GLSL, grime, tone, weather } from "@/scene/weathering";

const seeds = Array.from({ length: 200 }, (_, i) => (i * 0.618034) % 1);
const noises = [0, 0.25, 0.5, 0.75, 1];

/** Evaluates GROUND_GLSL in TypeScript: the plaza test, then one dome per `h +=` line. */
function glslGround(x: number, z: number) {
  const num = String.raw`(-?[\d.e-]+)`;
  const plaza = GROUND_GLSL.match(new RegExp(String.raw`p\.x > ${num} && p\.x < ${num} && p\.y > ${num} && p\.y <= ${num}\) return ${num};`))!;
  const [x0, x1, z0, z1, y] = plaza.slice(1).map(Number);
  if (x > x0 && x < x1 && z > z0 && z <= z1) return y;
  const dome = new RegExp(String.raw`wD = \(p - vec2\(${num}, ${num}\)\) / vec2\(${num}, ${num}\); wT = max\(1\.0 - dot\(wD, wD\), 0\.0\); wH \+= ${num} \* wT \* wT;`, "g");
  let h = 0;
  for (const m of GROUND_GLSL.matchAll(dome)) {
    const [hx, hz, rx, rz, a] = m.slice(1).map(Number);
    const t = Math.max(1 - (((x - hx) / rx) ** 2 + ((z - hz) / rz) ** 2), 0);
    h += a * t * t;
  }
  return h;
}

const compile = (m: MeshStandardMaterial) => {
  const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <normal_fragment_maps>\n#include <lights_fragment_maps>\n#include <emissivemap_fragment>" } as unknown as WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, undefined as never);
  return shader;
};

describe("ground level in the shader", () => {
  it("has every hill and the plaza", () => {
    expect(GROUND_GLSL.match(/wH \+=/g)).toHaveLength(HILLS.length);
    for (const v of [PLAZA.x0, PLAZA.x1, PLAZA.z0, PLAZA.z1, PLAZA.y]) expect(GROUND_GLSL).toContain(String(v));
  });

  it("matches heightAt over the land, plaza edges included", () => {
    const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
    const pts: [number, number][] = [];
    for (let x = minX; x <= maxX; x += 0.5) for (let z = minZ; z <= maxZ; z += 0.5) pts.push([x, z]);
    for (const x of [PLAZA.x0, PLAZA.x1, (PLAZA.x0 + PLAZA.x1) / 2]) for (const z of [PLAZA.z0, PLAZA.z1, (PLAZA.z0 + PLAZA.z1) / 2]) for (const e of [-1e-3, 0, 1e-3]) pts.push([x + e, z + e], [x - e, z + e]);
    for (const [x, z] of pts) expect(glslGround(x, z), `${x},${z}`).toBeCloseTo(heightAt(x, z), 9);
  });
});

describe("grime", () => {
  it("darkens most at the ground and is gone above GRIME_TOP", () => {
    for (const s of seeds) {
      for (const n of noises) {
        for (const st of noises) {
          let last = Infinity;
          for (let h = -0.5; h <= GRIME_TOP + 0.5; h += 0.05) {
            const g = grime(h, s, n, st);
            expect(g).toBeLessThanOrEqual(last + 1e-12);
            last = g;
          }
          expect(grime(0, s, n, st)).toBeGreaterThan(0.25);
          expect(grime(GRIME_TOP, s, n, st)).toBe(0);
          expect(grime(GRIME_TOP + 3, s, n, st)).toBe(0);
        }
      }
    }
  });

  it("never darkens more than MAX_GRIME", () => {
    // 0.5, not 0.3: lit walls sit in the tone curve's shoulder, where 0.3 at the ground did not show at the chapter cameras.
    expect(MAX_GRIME).toBeLessThanOrEqual(0.5);
    for (const s of seeds) for (const n of noises) for (const st of noises) for (const h of [-2, -0.1, 0, 0.1]) expect(grime(h, s, n, st)).toBeLessThanOrEqual(MAX_GRIME + 1e-12);
  });

  it("reads as a band, not a line: still there half a storey up", () => {
    for (const s of seeds) expect(grime(0.5, s, 0.5, 0.5)).toBeGreaterThan(0.06);
    // the foot line is a thin share of it
    expect(FOOT.h).toBeLessThan(0.3);
    expect(FOOT.share).toBeLessThan(0.5);
  });

  it("varies from building to building and stain to stain", () => {
    const at0 = seeds.map((s) => grime(0.3, s, 0.5, 0.5));
    expect(Math.max(...at0) - Math.min(...at0)).toBeGreaterThan(0.03);
    expect(grime(0.3, 0.5, 0.5, 1) - grime(0.3, 0.5, 0.5, 0)).toBeGreaterThan(0.05);
  });
});

describe("tone per building", () => {
  it("stays within the material's range, around 1 on average", () => {
    for (const a of [TONE.house, TONE.downtown]) {
      const tones = seeds.map((s) => tone(s, a));
      for (const t of tones) for (const c of t) expect(Math.abs(c - 1)).toBeLessThanOrEqual(a + 1e-9);
      const mean = tones.reduce((m, t) => m + (t[0] + t[1] + t[2]) / 3, 0) / tones.length;
      expect(mean).toBeCloseTo(1, 2);
      expect(new Set(tones.map((t) => t[0].toFixed(4))).size).toBeGreaterThan(50);
    }
  });

  it("is subtle: houses keep their curated palettes", () => {
    expect(TONE.downtown).toBeLessThanOrEqual(0.04);
    expect(TONE.house).toBeLessThanOrEqual(0.02);
  });
});

describe("contact shade on the ground", () => {
  it("covers every house, tower and landmark footprint, a little past its walls", () => {
    const landmarks = [{ x: 7, z: 9, w: 7, d: 5.2 }];
    const rects = contactRects(CITY, landmarks);
    expect(rects).toHaveLength(CITY.houses.length + CITY.towers.length + 1);
    expect(CITY.houses.length + CITY.towers.length).toBeGreaterThan(50);
    [...CITY.houses, ...CITY.towers, ...landmarks].forEach(({ x, z, w, d }, i) => {
      const [x0, x1, z0, z1] = rects[i];
      expect(x0).toBeLessThan(x - w / 2);
      expect(x1).toBeGreaterThan(x + w / 2);
      expect(z0).toBeLessThan(z - d / 2);
      expect(z1).toBeGreaterThan(z + d / 2);
      expect(x1 - x0 - w).toBeCloseTo(2 * CONTACT.pad, 9);
      expect(CONTACT.pad).toBeLessThanOrEqual(0.3);
    });
  });

  it("darkens the ground under it, at most 0.45", () => {
    const s = compile(groundMaterial(...(Array(6).fill({ isTexture: true }) as Parameters<typeof groundMaterial>)));
    expect(s.fragmentShader).toMatch(/diffuseColor\.rgb \*= 1\.0 - 0\.45 \* texture2D\(uLamp, vMapUv\)\.g;/);
  });
});

describe("weather in the materials", () => {
  const tex = { isTexture: true } as never;
  const cases = [
    { m: houseMaterial(tex, tex, new Float32Array(3 * 30)), key: "house", glass: "fGlassy", tone: TONE.house },
    { m: downtownMaterial(tex), key: "downtown", glass: "fGl", tone: TONE.downtown },
  ];

  it("compiles into houses and downtown and keeps their program keys", () => {
    for (const { m, key, glass, tone: a } of cases) {
      const s = compile(m);
      expect(m.customProgramCacheKey()).toBe(key);
      expect(s.fragmentShader).toContain("float wGround(vec2 p)");
      expect(s.fragmentShader).toContain("wGrime(");
      expect(s.uniforms.uWeather).toEqual({ value: a });
      // after the material's own colour, so it weathers whatever the material drew
      const snippet = s.fragmentShader.slice(s.fragmentShader.indexOf("#include <color_fragment>"));
      expect(snippet.indexOf("wGround(vFPos.xz)")).toBeGreaterThan(0);
      expect(snippet).toContain(glass);
    }
  });

  it("keeps glass clean", () => {
    const { glsl } = weather("vSeed", "fGlassy", TONE.house);
    expect(glsl).toMatch(/diffuseColor\.rgb = mix\(wC, diffuseColor\.rgb, wGl\);\s*\}$/);
  });

  it("names every symbol with a w prefix (no clash with the materials' own f names)", () => {
    const src = [GROUND_GLSL, WEATHER_GLSL, weather("vSeed", "fGlassy", TONE.house).glsl].join("\n");
    // declarations (functions, constants, locals); parameters are local to their function
    const names = [...src.matchAll(/(?:^|[;{])\s*(?:const\s+)?(?:float|vec2|vec3|vec4|int|bool)\s+([A-Za-z_]\w*)/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) expect(n, n).toMatch(/^(w[A-Z]|W_)/);
  });
});
