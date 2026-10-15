import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PerspectiveCamera, ShaderChunk, ShaderLib, Vector3 } from "three";
import { chapters } from "@/content/day";
import { HAZE, hazeFactor, hazeLift } from "@/lib/haze";
import { HEADLANDS, headlandHeight } from "@/lib/terrain";
import { fogRange } from "@/scene/atmosphere";
import { applyHaze } from "@/scene/haze";
import { skyAt } from "@/scene/sky";

const WATER_Y = -0.45; // bay.tsx
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

describe("height-aware haze", () => {
  it("leaves the near city clear: no fog inside the fog's near distance, at any height", () => {
    for (const y of [-0.45, 0, 5, 30, 80]) for (const d of [0, 20, 48]) expect(hazeFactor(d, y, 49, 238)).toBe(0);
  });

  it("leaves the water and the shore exactly as linear fog (at or below HAZE.y0)", () => {
    for (const y of [WATER_Y, 0, 0.5, HAZE.y0])
      for (const d of [60, 150, 238, 300, 600]) expect(hazeFactor(d, y, 49, 238)).toBe(smoothstep(49, 238, d));
    expect(hazeLift(HAZE.y0)).toBe(0);
  });

  it("keeps a 25 high crest past the fog's far distance at least 40% clear", () => {
    for (const s of [0.7, 0.75, 0.8, 0.85]) {
      const { near, far } = fogRange(12, false, s);
      expect(hazeFactor(far + 10, 25, near, far), `fogScale ${s}`).toBeLessThanOrEqual(0.6);
    }
  });

  it("is smooth and monotonic: less fog higher up, more fog farther away", () => {
    const [near, far] = [49, 238];
    for (let d = 0; d <= 600; d += 5) {
      let last = hazeFactor(d, -1, near, far);
      for (let y = -1; y <= 60; y += 0.25) {
        const f = hazeFactor(d, y, near, far);
        expect(f).toBeLessThanOrEqual(last + 1e-12);
        expect(last - f, `d ${d} y ${y}`).toBeLessThan(0.02);
        last = f;
      }
    }
    for (const y of [0, 10, 25, 40]) {
      let last = 0;
      for (let d = 0; d <= 600; d += 1) {
        const f = hazeFactor(d, y, near, far);
        expect(f).toBeGreaterThanOrEqual(last - 1e-12);
        expect(f - last).toBeLessThan(0.02);
        last = f;
      }
      expect(last).toBeLessThanOrEqual(1);
    }
  });

  it("at every chapter keeps the Marin crest: never foggier than before, and readable where the water under it is fog", () => {
    // The crest: the highest ground in each 20 unit band across the headlands.
    const crest: Vector3[] = [];
    for (let x = HEADLANDS.x0 + 10; x < HEADLANDS.x1 - 10; x += 20) {
      let best = new Vector3(x, -Infinity, 0);
      for (let z = HEADLANDS.z0; z <= HEADLANDS.z1; z += 2) {
        const y = headlandHeight(x, z);
        if (y > best.y) best = new Vector3(x, y, z);
      }
      if (best.y > 10) crest.push(best);
    }
    expect(crest.length).toBeGreaterThan(5);
    let fogged = 0;
    for (const ch of chapters) {
      for (const shot of [ch.camera, ch.phone]) {
        const cam = new PerspectiveCamera();
        cam.position.set(...shot.position);
        cam.lookAt(new Vector3(...shot.target));
        cam.updateMatrixWorld();
        const { near, far } = fogRange(cam.position.distanceTo(new Vector3(...shot.target)), false, skyAt(ch.hour).fogScale);
        const depth = (p: Vector3) => -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
        for (const p of crest) {
          const d = depth(p);
          const id = `${ch.id} crest at x ${p.x}`;
          expect(hazeFactor(d, p.y, near, far), id).toBeLessThanOrEqual(smoothstep(near, far, d));
          if (hazeFactor(depth(new Vector3(p.x, WATER_Y, p.z)), WATER_Y, near, far) < 0.95) continue;
          fogged++;
          expect(hazeFactor(d, p.y, near, far), id).toBeLessThan(0.75);
        }
      }
    }
    expect(fogged).toBeGreaterThan(20);
  });
});

describe("the fog chunks", () => {
  const KEYS = ["fog_pars_vertex", "fog_vertex", "fog_pars_fragment", "fog_fragment"] as const;

  it("keep three's names, so every material and Karl still fog", () => {
    expect(ShaderChunk.fog_pars_vertex).toContain("varying float vFogDepth;");
    expect(ShaderChunk.fog_vertex).toContain("vFogDepth = - mvPosition.z;");
    for (const name of ["fogColor", "vFogDepth", "fogNear", "fogFar", "fogDensity"]) expect(ShaderChunk.fog_pars_fragment).toContain(name);
    expect(ShaderChunk.fog_fragment).toContain("mix( gl_FragColor.rgb, fogColor, fogFactor )");
  });

  it("lift only the linear fog; exp2 fog stays three's", () => {
    expect(ShaderChunk.fog_fragment).toContain("1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth )");
    expect(ShaderChunk.fog_fragment).not.toContain("float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );");
    expect(ShaderChunk.fog_fragment).toContain(`float fogFactor = mix( fogLow, fogHigh, smoothstep( ${HAZE.y0.toFixed(3)}, ${HAZE.y1.toFixed(3)}, vFogY ) );`);
    expect(ShaderChunk.fog_fragment).toContain(`${HAZE.reach.toFixed(3)} * fogFar`);
  });

  it("apply once, also when applied again (hot reload), and switch off back to three's", () => {
    const patched = KEYS.map((k) => ShaderChunk[k]);
    applyHaze(true);
    applyHaze(true);
    expect(KEYS.map((k) => ShaderChunk[k])).toEqual(patched);
    for (const k of KEYS) expect(ShaderChunk[k].split("vFogY").length - 1, k).toBeLessThanOrEqual(2);
    applyHaze(false);
    expect(ShaderChunk.fog_fragment).not.toContain("vFogY");
    expect(ShaderChunk.fog_vertex).not.toContain("vFogY");
    applyHaze(true);
    expect(KEYS.map((k) => ShaderChunk[k])).toEqual(patched);
  });

  it("find the world height from the view space position (the vertex chunk's sum)", () => {
    const cam = new PerspectiveCamera();
    cam.position.set(-20, 31, 14);
    cam.lookAt(-80, 4, -200);
    cam.updateMatrixWorld();
    const v = cam.matrixWorldInverse.elements; // column major: column 1 is v[4..6], column 3 v[12..14]
    for (const p of [new Vector3(-150, 22, -260), new Vector3(10, -0.45, -40), new Vector3(0, 60, 0)]) {
      const mv = p.clone().applyMatrix4(cam.matrixWorldInverse);
      const y = v[4] * (mv.x - v[12]) + v[5] * (mv.y - v[13]) + v[6] * (mv.z - v[14]);
      expect(y).toBeCloseTo(p.y, 6);
    }
    expect(ShaderChunk.fog_vertex).toContain("dot( viewMatrix[ 1 ].xyz, mvPosition.xyz - viewMatrix[ 3 ].xyz )");
  });

  it("only meet vertex shaders that define mvPosition first: three's own and Karl's", () => {
    const shaders = Object.entries(ShaderLib).map(([k, s]) => [k, s.vertexShader] as const);
    shaders.push(["fog.tsx", readFileSync("src/scene/fog.tsx", "utf8")]);
    let checked = 0;
    for (const [name, src] of shaders) {
      const fog = src.indexOf("#include <fog_vertex>");
      if (fog < 0) continue;
      checked++;
      const mv = Math.max(src.indexOf("#include <project_vertex>"), src.indexOf("vec4 mvPosition ="));
      expect(mv, name).toBeGreaterThanOrEqual(0);
      expect(mv, name).toBeLessThan(fog);
    }
    expect(checked).toBeGreaterThan(5);
  });
});
