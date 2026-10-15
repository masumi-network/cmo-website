"use client";

// The Pacific coast as coast.ts plans it: Ocean Beach and the Lands End rock apron as
// one mesh, the boulders and sea stacks as one instanced draw of the parks'
// rock. Both on the DETAIL layer (not in the mirror or the glass probe),
// receive shadows, cast none. Sand darkens where it is wet and a lace of
// swash runs up and back; rock darkens and turns green at the water line.
// The surf itself is in the water shader (bay.tsx).

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { MeshStandardMaterial, type Object3D } from "three";
import { COAST_OFF, ROCKS, WATER_Y, coastGeometry, liteRocks, type Rock } from "./coast";
import { stoneGeometries } from "./grass";
import { Instances } from "./parts";
import { detail } from "./shared";

const f = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** World-space value noise, shared by both materials (every symbol c-prefixed). */
const NOISE_GLSL = /* glsl */ `
  float cHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 u = fract(p);
    u = u * u * (3.0 - 2.0 * u);
    return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x), mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // 0 dry .. 1 at the water line
  float cWet(float y) { return 1.0 - smoothstep(${f(WATER_Y + 0.02)}, ${f(WATER_Y + 0.2)}, y); }`;

/** Rock colour at a world point: grain, darker streaks, dark and a little green at the water line. */
const ROCK_GLSL = /* glsl */ `
  vec3 cRock(vec3 base, vec3 w) {
    vec3 c = base * (0.86 + 0.14 * cNoise(w.xz * 7.0 + w.y * 6.0) + 0.1 * cNoise(w.xz * 1.9 - w.y));
    c *= 1.0 - 0.25 * smoothstep(0.5, 0.8, cNoise(vec2(w.x + w.z, w.y * 6.0) * 2.3));
    float wet = cWet(w.y);
    return mix(c, c * vec3(0.5, 0.56, 0.48), wet);
  }`;

function coastMaterial(uniforms: { uTime: { value: number } }) {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  material.customProgramCacheKey = () => "coast-ground";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aRock;\nvarying vec3 vCoastW;\nvarying float vRock;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCoastW = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRock = aRock;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\nvarying vec3 vCoastW;\nvarying float vRock;\n${NOISE_GLSL}\n${ROCK_GLSL}`)
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float cW = cWet(vCoastW.y);
        // Sand: fine grain, darker where wet; a lace of swash runs up the wet sand and back.
        vec3 cSand = diffuseColor.rgb * (0.9 + 0.08 * cNoise(vCoastW.xz * 11.0) + 0.08 * cNoise(vCoastW.xz * 2.1));
        cSand *= mix(1.0, 0.66, cW);
        float cReach = ${f(WATER_Y + 0.025)} + 0.045 * (0.5 + 0.5 * sin(uTime * 0.6 + vCoastW.z * 0.23 + 2.0 * cNoise(vCoastW.xz * 0.4)));
        float cFilm = 1.0 - smoothstep(cReach - 0.004, cReach, vCoastW.y);
        float cLace = cFilm * smoothstep(cReach - 0.02, cReach - 0.004, vCoastW.y) * (0.55 + 0.45 * cNoise(vCoastW.xz * 7.0));
        cSand = mix(cSand, cSand * 0.9, cFilm);
        cSand = mix(cSand, vec3(0.92, 0.91, 0.87), cLace * (1.0 - vRock));
        diffuseColor.rgb = mix(cSand, cRock(diffuseColor.rgb, vCoastW), vRock);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, mix(0.35, 0.55, vRock), cW);",
      );
  };
  return material;
}

function rockMaterial() {
  const material = new MeshStandardMaterial({ roughness: 0.9, flatShading: true });
  material.customProgramCacheKey = () => "coast-rocks";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCoastW;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n#ifdef USE_INSTANCING\nvCoastW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvCoastW = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCoastW;\n${NOISE_GLSL}\n${ROCK_GLSL}`)
      // the sea stacks' tops are white with the birds
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>\ndiffuseColor.rgb = cRock(diffuseColor.rgb, vCoastW);\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.7, 0.68, 0.63), 0.55 * smoothstep(${f(WATER_Y + 0.55)}, ${f(WATER_Y + 1.1)}, vCoastW.y));`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, cWet(vCoastW.y));");
  };
  return material;
}

const TONES = ["#4f4c48", "#474541", "#57534d", "#43413e"];
function placeRock(r: Rock, o: Object3D, i: number) {
  o.position.set(r.x, r.y, r.z);
  o.rotation.set(0, r.yaw, 0);
  o.scale.set(r.s, r.s * r.tall, r.s);
  return TONES[i % TONES.length];
}

function CoastMeshes({ lite }: { lite: boolean }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const geometry = useMemo(() => coastGeometry(), []);
  const material = useMemo(() => coastMaterial(uniforms), [uniforms]);
  const rock = useMemo(() => stoneGeometries().rock, []);
  const rockMat = useMemo(() => rockMaterial(), []);
  const rocks = useMemo(() => (lite ? liteRocks(ROCKS) : ROCKS), [lite]);
  useEffect(() => () => [geometry, material, rock, rockMat].forEach((o) => o.dispose()), [geometry, material, rock, rockMat]);
  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <mesh ref={detail} geometry={geometry} material={material} receiveShadow />
      <Instances items={rocks} geometry={rock} material={rockMat} place={placeRock} shadows={false} detail />
    </>
  );
}

/** Ocean Beach, Lands End and the rocks off them. `?coast=off` (dev): the old sea wall. */
export const Coast = COAST_OFF ? () => null : CoastMeshes;
