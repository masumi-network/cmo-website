// Photo-real plates (F12): the ground's colour for the path tracer. The ground
// shader (groundMaterial in materials.ts) decides each pixel from its mask:
// asphalt grain, worn lane paint, crosswalks, sidewalks, lawns and trails. The
// tracer reads plain textures only, so the ground is drawn once in its own uv
// space with its own shader, stopped right after the colour (no light), and
// read back as one texture over the whole land. Dev only (raytrace-lab.tsx).

import { DataTexture, DoubleSide, LinearFilter, Mesh, OrthographicCamera, Scene, SRGBColorSpace, UnsignedByteType, WebGLRenderTarget, type Material, type MeshStandardMaterial, type Object3D, type WebGLRenderer } from "three";
import { LAND_BOUNDS } from "./grid";
import { traceInfo } from "./trace-info";

/** Texels per world unit: about 3 cm. */
export const GROUND_PX = 32;

export function bakeGround(gl: WebGLRenderer, scene: Object3D, px = GROUND_PX) {
  const groups = new Map<MeshStandardMaterial, Mesh[]>();
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material) || traceInfo.get(mesh.material)?.kind !== "ground") return;
    const list = groups.get(mesh.material as MeshStandardMaterial) ?? [];
    groups.set(mesh.material as MeshStandardMaterial, [...list, mesh]);
  });

  const out = new Map<Material, DataTexture>();
  const w = Math.round((LAND_BOUNDS.maxX - LAND_BOUNDS.minX) * px);
  const h = Math.round((LAND_BOUNDS.maxZ - LAND_BOUNDS.minZ) * px);
  for (const [material, meshes] of groups) {
    const info = traceInfo.get(material);
    if (info?.kind !== "ground") continue;
    // the ground's own shader, drawn where its uv says and stopped once it knows the colour
    const bake = material.clone();
    const patch = material.onBeforeCompile;
    bake.onBeforeCompile = (shader, renderer) => {
      patch.call(material, shader, renderer);
      shader.vertexShader = shader.vertexShader.replace("#include <project_vertex>", "#include <project_vertex>\ngl_Position = vec4(vMapUv * 2.0 - 1.0, 0.0, 1.0);");
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <roughnessmap_fragment>",
        "gl_FragColor = linearToOutputTexel(vec4(diffuseColor.rgb, 1.0));\nreturn;\n#include <roughnessmap_fragment>",
      );
    };
    bake.customProgramCacheKey = () => "ground-bake";
    Object.assign(bake, { side: DoubleSide, depthTest: false, depthWrite: false, fog: false });

    const flat = new Scene();
    for (const mesh of meshes) {
      const copy = new Mesh(mesh.geometry, bake);
      copy.frustumCulled = false;
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(mesh.matrixWorld); // the shader works in world units
      flat.add(copy);
    }
    const target = new WebGLRenderTarget(w, h, { type: UnsignedByteType, colorSpace: SRGBColorSpace });
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.clear();
    gl.render(flat, new OrthographicCamera());
    const pixels = new Uint8Array(w * h * 4);
    gl.readRenderTargetPixels(target, 0, 0, w, h, pixels);
    gl.setRenderTarget(previous);
    target.dispose();
    bake.dispose();

    // laid out as the mask is: same repeat and offset over the same uv
    const texture = new DataTexture(pixels, w, h);
    texture.colorSpace = SRGBColorSpace;
    texture.repeat.copy(info.mask.repeat);
    texture.offset.copy(info.mask.offset);
    texture.magFilter = texture.minFilter = LinearFilter;
    texture.needsUpdate = true;
    out.set(material, texture);
  }
  return out;
}
