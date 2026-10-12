// Building walls with windows, drawn in the shader from world position, so
// windows keep their size on any building and need no textures. At night a
// random share of windows lights up.

import { MeshStandardMaterial } from "three";

/** 0 = day, 1 = night. Atmosphere sets it every frame. */
export const facadeNight = { value: 0 };

type Facade = {
  /** Storey height in world units. */
  floor: number;
  /** Window spacing along the wall. */
  window: number;
  /** Curtain wall: big windows, thin mullions, a bit of metal. */
  glassy?: boolean;
  /** Share of windows lit at night (0..1). */
  lit?: number;
  roughness?: number;
};

export function facadeMaterial({ floor, window, glassy = false, lit = 0.45, roughness = 0.85 }: Facade) {
  const material = new MeshStandardMaterial({ roughness });
  material.customProgramCacheKey = () => `facade-${glassy ? 1 : 0}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeNight;
    shader.uniforms.uFloor = { value: floor };
    shader.uniforms.uWin = { value: window };
    shader.uniforms.uLit = { value: lit };
    shader.uniforms.uGlassy = { value: glassy ? 1 : 0 };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFPos;\nvarying vec3 vFNormal;")
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        vec4 fW = vec4(transformed, 1.0);
        vec3 fN = objectNormal;
        #ifdef USE_INSTANCING
          fW = instanceMatrix * fW;
          fN = mat3(instanceMatrix) * fN;
        #endif
        vFPos = (modelMatrix * fW).xyz;
        vFNormal = normalize(mat3(modelMatrix) * fN);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uNight, uFloor, uWin, uLit, uGlassy;
        varying vec3 vFPos;
        varying vec3 vFNormal;
        float fHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        float fWall = 1.0 - step(0.5, abs(vFNormal.y));
        float fU = abs(vFNormal.x) > 0.5 ? vFPos.z : vFPos.x;
        vec2 fCell = vec2(fU / uWin, vFPos.y / uFloor);
        vec2 fF = fract(fCell);
        float fPunched = step(0.22, fF.x) * step(fF.x, 0.78) * step(0.3, fF.y) * step(fF.y, 0.85);
        float fCurtain = step(0.05, fF.x) * step(fF.x, 0.95) * step(0.1, fF.y);
        float fWin = fWall * mix(fPunched, fCurtain, uGlassy) * step(0.9, vFPos.y);
        // Hash exact per-cell values only. The hash amplifies tiny errors, so an
        // interpolated normal or a wall-plane coordinate makes windows flicker per pixel.
        float fId = fHash(floor(fCell) + floor(vFNormal.xz + 0.5) * 17.0);
        vec3 fGlass = mix(vec3(0.12, 0.15, 0.2), vec3(0.46, 0.55, 0.66), fF.y * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, fGlass, fWin * (1.0 - 0.45 * uGlassy));
        float fLit = fWin * step(1.0 - uLit, fId);`,
      )
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.14, fWin);")
      .replace("#include <metalnessmap_fragment>", "#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.45, fWin * uGlassy);")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.76, 0.42) * fLit * uNight * 2.4;",
      );
  };
  return material;
}
