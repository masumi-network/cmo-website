import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Color, MeshBasicMaterial, MeshStandardMaterial, Texture, Vector3 } from "three";
import { traceInfo } from "@/scene/trace-info";
import {
  TILE,
  addDirectional,
  cellDirection,
  decodeProbes,
  dilateProbes,
  encodeProbes,
  hourBlend,
  irradiance,
  parseProbeManifest,
  probeBytes,
  projectTile,
  tileOrigin,
  type ProbeManifest,
} from "@/lib/probes";
import { probeTexture, probeUniforms, withProbes } from "@/scene/probes";

/** The SH of radiance `f(direction)`, as the bake gets it: one sample per equal-area cell of a tile. */
const shOf = (f: (d: Vector3) => number) => {
  const tile = new Float32Array(TILE * TILE * 4);
  for (let c = 0; c < TILE * TILE; c++) {
    const v = f(cellDirection(c % TILE, Math.floor(c / TILE), 0.5, 0.5));
    tile.set([v, v, v, 1], c * 4);
  }
  return projectTile(tile, TILE, 0, 0);
};
const up = new Vector3(0, 1, 0);
const down = new Vector3(0, -1, 0);
const side = new Vector3(1, 0, 0);

describe("probe light (L1 spherical harmonics)", () => {
  it("cells cover the sphere evenly", () => {
    const mean = new Vector3();
    for (let c = 0; c < TILE * TILE; c++) mean.add(cellDirection(c % TILE, Math.floor(c / TILE), 0.5, 0.5));
    expect(mean.length() / (TILE * TILE)).toBeLessThan(1e-6);
    expect(cellDirection(0, 0, 0.5, 0.5).y).toBeGreaterThan(0.8); // the first row looks up
  });

  it("an even sky of radiance 1 gives irradiance pi from every side", () => {
    const sh = shOf(() => 1);
    for (const n of [up, down, side]) expect(irradiance(sh, n)[0]).toBeCloseTo(Math.PI, 2);
  });

  it("a bright upper half and a black ground light a floor fully and a ceiling not at all", () => {
    const sh = shOf((d) => (d.y > 0 ? 1 : 0));
    expect(irradiance(sh, up)[0]).toBeCloseTo(Math.PI, 1);
    expect(irradiance(sh, down)[0]).toBeCloseTo(0, 1);
    expect(irradiance(sh, side)[0]).toBeCloseTo(Math.PI / 2, 1);
  });

  it("adds a directional fill light (unshadowed, like the raster's studio light)", () => {
    const sh = new Float32Array(12);
    addDirectional(sh, up, [2, 2, 2]);
    expect(irradiance(sh, up)[0]).toBeCloseTo(1.5, 5); // L1 of max(0, n.l): 0.25 + 0.5 n.l, times 2
    expect(irradiance(sh, side)[0]).toBeCloseTo(0.5, 5);
  });
});

describe("probe bake layout", () => {
  it("gives each probe a tile of cells, row by row", () => {
    expect(tileOrigin(0, 4)).toEqual([0, 0]);
    expect(tileOrigin(1, 4)).toEqual([TILE, 0]);
    expect(tileOrigin(5, 4)).toEqual([TILE, TILE]);
  });
});

describe("probe bytes", () => {
  it("round-trip linear SH within 8-bit precision of the hour's brightest probe", () => {
    const sh = new Float32Array([0.8, 0.6, 0.4, 0.3, -0.2, 0.1, 0.5, 0.4, 0.3, -0.6, 0.0, 0.2, 0.1, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const { bytes, scale } = encodeProbes(sh);
    expect(bytes.length).toBe(24);
    const back = decodeProbes(bytes, scale);
    for (let i = 0; i < sh.length; i++) expect(Math.abs(back[i] - sh[i])).toBeLessThan(scale * 0.02);
  });

  it("lets a handful of glowing probes clip rather than set the scale (one inside a lit tower top)", () => {
    const sh = new Float32Array(2000 * 12);
    for (let p = 0; p < 2000; p++) sh.set([1, 1, 1], p * 12);
    sh.set([100, 100, 100], 7 * 12);
    const { bytes, scale } = encodeProbes(sh);
    expect(scale).toBeCloseTo(1, 5);
    expect(bytes[7 * 12]).toBe(255);
  });

  it("keeps a dark hour precise: the scale follows the hour", () => {
    const night = new Float32Array(12).fill(0.002);
    const { bytes, scale } = encodeProbes(night);
    expect(scale).toBeLessThan(0.01);
    expect(decodeProbes(bytes, scale)[0]).toBeCloseTo(0.002, 4);
  });
});

describe("probe hours", () => {
  const hours = [6, 7, 9, 12, 15, 18, 22, 30];

  it("rests on a baked hour", () => {
    expect(hourBlend(hours, 12)).toEqual({ a: 3, b: 3, t: 0 });
  });

  it("blends between the two hours around now, through the night to 06:00 tomorrow", () => {
    expect(hourBlend(hours, 8)).toEqual({ a: 1, b: 2, t: 0.5 });
    expect(hourBlend(hours, 8.5)).toEqual({ a: 1, b: 2, t: 0.75 });
    expect(hourBlend(hours, 26)).toEqual({ a: 6, b: 7, t: 0.5 });
    expect(hourBlend(hours, 2)).toEqual({ a: 6, b: 7, t: 0.5 }); // 02:00 is 26
    expect(hourBlend(hours, 31)).toEqual({ a: 7, b: 7, t: 0 });
  });
});

describe("probe manifest", () => {
  const ok: ProbeManifest = {
    file: "probes.bin.gz",
    min: [-96, -3, -96],
    size: [192, 42, 162],
    res: [64, 14, 54],
    hours: [
      { hour: 6, block: 0, scale: 1.2 },
      { hour: 30, block: 0, scale: 1.2 },
    ],
  };

  it("reads a valid manifest", () => {
    expect(parseProbeManifest(ok)).toEqual(ok);
  });

  it("rejects anything else rather than half-reading it", () => {
    expect(parseProbeManifest(null)).toBeNull();
    expect(parseProbeManifest({ ...ok, res: [64, 14] })).toBeNull();
    expect(parseProbeManifest({ ...ok, hours: [] })).toBeNull();
    expect(parseProbeManifest({ ...ok, file: "../x.bin" })).toBeNull();
  });
});

describe("probe light in the shaders", () => {
  const compile = (m: MeshStandardMaterial | MeshBasicMaterial) => {
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: "#include <common>\nvoid main() {}", fragmentShader: "#include <common>\nvoid main() {\n#include <lights_fragment_maps>\n}" };
    m.onBeforeCompile(shader as never, null as never);
    return shader;
  };

  it("swaps the ambient light for the probes, after the material's own patch, and shares the uniforms", () => {
    const m = new MeshStandardMaterial();
    m.onBeforeCompile = (s) => void (s.fragmentShader = s.fragmentShader.replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\nradiance *= 0.5;"));
    m.customProgramCacheKey = () => "house";
    withProbes(m);
    const s = compile(m);
    expect(s.fragmentShader).toContain("radiance *= 0.5;");
    expect(s.fragmentShader).toMatch(/lights_fragment_maps>[\s\S]*cityProbeIrradiance[\s\S]*radiance \*= 0.5/);
    expect(s.uniforms.cityProbes).toBe(probeUniforms.cityProbes);
    expect(m.customProgramCacheKey()).toBe("house|probes");
  });

  it("patches once, and leaves unlit materials alone", () => {
    const m = new MeshStandardMaterial();
    withProbes(m);
    withProbes(m);
    expect(compile(m).fragmentShader.match(/cityProbeIrradiance\(/g)?.length).toBe(2); // the function and its one use
    const basic = new MeshBasicMaterial();
    withProbes(basic);
    expect(compile(basic).fragmentShader).not.toContain("cityProbe");
  });

  it("leaves the water alone: its colour is its reflection, and the probes' sky light showed the grid as a pale square on the bay", () => {
    const water = new MeshStandardMaterial();
    traceInfo.set(water, { kind: "water", ripples: new Texture(), deep: new Color("#204060") });
    withProbes(water);
    expect(compile(water).fragmentShader).not.toContain("cityProbe");
  });
});

describe("probe texture", () => {
  it("lays each coefficient out as its own block along x and each hour along z", () => {
    // 2 x 1 x 1 probes, two hours: byte value = hour * 100 + probe * 12 + k
    const bytes = new Uint8Array(2 * 2 * 12).map((_, n) => Math.floor(n / 24) * 100 + (n % 24));
    const m = { file: "p.bin.gz", min: [0, 0, 0], size: [2, 1, 1], res: [2, 1, 1], hours: [{ hour: 6, block: 0, scale: 1 }, { hour: 7, block: 1, scale: 1 }] };
    const { texture, blocks } = probeTexture(bytes, m);
    expect(blocks).toBe(2);
    expect([texture.image.width, texture.image.height, texture.image.depth]).toEqual([8, 1, 2]);
    const texel = (x: number, z: number) => Array.from((texture.image.data as Uint8Array).subarray((z * 8 + x) * 4, (z * 8 + x) * 4 + 4));
    expect(texel(0, 0)).toEqual([0, 1, 2, 255]); // probe 0, L0
    expect(texel(1, 0)).toEqual([12, 13, 14, 255]); // probe 1, L0
    expect(texel(2 * 3 + 1, 0)).toEqual([21, 22, 23, 255]); // probe 1, L1z
    expect(texel(2, 1)).toEqual([103, 104, 105, 255]); // hour 2, probe 0, L1x
  });
});

describe("probes inside walls", () => {
  // a row of 4 probes, one number each (in the first of its 12)
  const row = (...v: number[]) => {
    const sh = new Float32Array(v.length * 12);
    v.forEach((x, p) => (sh[p * 12] = x));
    return sh;
  };
  const first = (sh: Float32Array) => Array.from({ length: sh.length / 12 }, (_, p) => sh[p * 12]);

  it("take the light of their outside neighbours, not the open sky they see through the wall", () => {
    const sh = row(1, 9, 3, 3);
    dilateProbes(sh, Uint8Array.from([1, 0, 1, 1]), [4, 1, 1], 1);
    expect(first(sh)).toEqual([1, 2, 3, 3]);
  });

  it("fill in from the outside one probe per pass, and keep what they had where no pass reaches", () => {
    const sh = row(4, 9, 9, 9);
    const valid = Uint8Array.from([1, 0, 0, 0]);
    dilateProbes(sh, valid, [4, 1, 1], 2);
    expect(first(sh)).toEqual([4, 4, 4, 9]);
  });
});

describe("probe download", () => {
  const raw = Uint8Array.from({ length: 300 }, (_, i) => i % 7);

  it("unzips the gzipped file", async () => {
    expect(await probeBytes(new Uint8Array(gzipSync(raw)).buffer)).toEqual(raw);
  });

  it("takes bytes a host already unzipped (Content-Encoding: gzip) as they are", async () => {
    expect(await probeBytes(raw.buffer)).toEqual(raw);
  });
});
