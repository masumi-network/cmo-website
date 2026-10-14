"use client";

// Street and park trees, placed by layout.ts, modelled in tree-models.ts,
// textured by tree-textures.ts. Two batched draws for every tree in the city:
// bark (trunks, limbs, branches and the street trees' grates) and leaves
// (cards and palm fronds). Each tree draws its near or far model by distance
// (phones always far). Wind sways branches and flutters the outer leaves in
// the vertex shader, shadows included; backlit leaves let a little sun through.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BatchedMesh, Color, DoubleSide, MeshDepthMaterial, MeshStandardMaterial, Object3D, Vector3, type BufferGeometry, type Material } from "three";
import { barkAtlas, fullerLeaves, leafAtlas } from "./tree-textures";
import { traceInfo } from "./trace-info";
import { KINDS, LOD_DISTANCE, hasPit, kindOf, pitGeometry, pitPose, treeModels, treePose, variantOf, type Kind, type Tree } from "./tree-models";

/** Shared by bark, leaves and the leaves' shadow: sway with the gusts (wind from the ocean, west), flutter on top. */
const WIND = /* glsl */ `
uniform float uTime;
vec3 treeWind(vec3 p, vec3 n, float flutter, mat4 tM) {
  vec3 base = tM[3].xyz;
  float gust = 0.55 + 0.45 * sin(uTime * 0.8 - base.x * 0.12 + base.z * 0.05);
  float sway = 0.5 + 0.5 * sin(uTime * 1.7 + base.x * 0.9 + base.z * 0.6);
  vec3 wind = vec3(1.0, 0.0, 0.3) * gust * (0.35 + 0.65 * sway);
  // the world wind in tree units, whatever way the tree is turned
  vec3 local = transpose(mat3(tM)) * wind / max(dot(tM[0].xyz, tM[0].xyz), 1e-4);
  p += local * 0.02 * pow(max(p.y - 0.8, 0.0), 2.0);
  float ph = dot(p, vec3(9.1, 7.3, 8.7)) + base.x * 3.1;
  p += n * flutter * 0.03 * sin(uTime * 4.3 + ph) * gust;
  p.y += flutter * 0.022 * sin(uTime * 2.9 + ph * 1.7) * gust;
  return p;
}`;

type Uniforms = { uTime: { value: number } };

/** Baking a photo-real plate (dev lab, ?raytrace=plate): offline, so every tree draws its near model. */
const BAKING = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("raytrace") === "plate";

/** Adds the wind to a material's vertex shader. Leaves flutter by their aLeaf.x; bark only sways. */
function windy(shader: { uniforms: Record<string, unknown>; vertexShader: string }, uniforms: Uniforms, leaves: boolean) {
  shader.uniforms.uTime = uniforms.uTime;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${WIND}\n${leaves ? "attribute vec3 aLeaf;" : ""}`)
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_BATCHING
        transformed = treeWind(transformed, normal, ${leaves ? "aLeaf.x" : "0.0"}, batchingMatrix);
      #endif`,
    );
}

/** Mipmapped alpha thins out with distance; this keeps far crowns as full as near ones. */
const KEEP_ALPHA = /* glsl */ `#include <map_fragment>
#ifdef USE_MAP
  vec2 tTex = vMapUv * 1024.0;
  float tMip = max(0.0, 0.5 * log2(max(dot(dFdx(tTex), dFdx(tTex)), dot(dFdy(tTex), dFdy(tTex)))));
  diffuseColor.a *= 1.0 + tMip * 0.22;
#endif`;

function materials(uniforms: Uniforms) {
  // the bake's tracer reads the sprite at full size, without the raster's mip-boosted alpha: give it fuller leaves
  const leafMap = BAKING ? fullerLeaves(leafAtlas()) : leafAtlas();
  const barkMap = barkAtlas();
  const bark = new MeshStandardMaterial({ map: barkMap, vertexColors: true, roughness: 0.95 });
  bark.customProgramCacheKey = () => "tree-bark";
  traceInfo.set(bark, { kind: "batched" });
  bark.onBeforeCompile = (shader) => windy(shader, uniforms, false);

  const leaves = new MeshStandardMaterial({ map: leafMap, alphaTest: 0.5, side: DoubleSide, vertexColors: true, roughness: 0.8 });
  leaves.customProgramCacheKey = () => "tree-leaves";
  traceInfo.set(leaves, { kind: "batched" });
  leaves.onBeforeCompile = (shader) => {
    windy(shader, uniforms, true);
    // Light through the leaf, sky fill, and how much the leaf faces up (in the world).
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 vLeaf;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      #ifdef USE_BATCHING
        vLeaf = vec3(aLeaf.yz, normalize(mat3(batchingMatrix) * normal).y);
      #else
        vLeaf = vec3(aLeaf.yz, normal.y);
      #endif`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLeaf;")
      .replace("#include <map_fragment>", KEEP_ALPHA)
      // Both faces of a card share its normal (out of the crown): no flip for the back.
      .replace("#include <normal_fragment_begin>", "#include <normal_fragment_begin>\nnormal = normalize(vNormal);\nnonPerturbedNormal = normal;")
      // Outer leaves seen against the sun glow a little (light through the leaf). Cypress pads
      // (sky fill > 0) also pass sun through wherever they face away from it, and take sky light on top.
      .replace(
        "#include <lights_fragment_end>",
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
          float tBack = pow(saturate(dot(-geometryViewDir, directionalLights[0].direction)), 3.0);
          float tThrough = saturate(-dot(normal, directionalLights[0].direction));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * (tBack * 0.9 + tThrough * 0.45 * vLeaf.y) * vLeaf.x;
        #endif
        #if NUM_HEMI_LIGHTS > 0
          reflectedLight.indirectDiffuse += diffuseColor.rgb * hemisphereLights[0].skyColor * saturate(vLeaf.z) * vLeaf.y * 0.6;
        #endif`,
      );
  };
  // The leaves' shadow: the same cut-out, sway and distance fix as the leaves.
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = (shader) => {
    windy(shader, uniforms, true);
    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", KEEP_ALPHA);
  };
  return { bark, leaves, depth, maps: [leafMap, barkMap] };
}

/** One batched mesh for a set of geometries; returns it and each geometry's id. */
function batch(geometries: BufferGeometry[], instances: number, material: Material) {
  const vertices = geometries.reduce((n, g) => n + g.attributes.position.count, 0);
  const indices = geometries.reduce((n, g) => n + g.index!.count, 0);
  const mesh = new BatchedMesh(instances, vertices, indices, material);
  const ids = geometries.map((g) => mesh.addGeometry(g));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, ids };
}

const tint = new Color();
const crown = new Vector3();
const hash = (t: Tree, k: number) => {
  const v = Math.sin(t.x * 41.31 + t.z * 17.97 + k * 9.17) * 24634.6345;
  return v - Math.floor(v);
};
/** Leaves: from fresh yellow-green to deep blue-green, lighter and darker; bark a little lighter or darker. */
const leafTint = (t: Tree) => tint.setHSL(0.16 + hash(t, 1) * 0.16, 0.35, 0.5).lerp(new Color(1, 1, 1), 0.82).multiplyScalar(0.86 + hash(t, 2) * 0.2);
const barkTint = (t: Tree) => tint.setScalar(0.85 + hash(t, 3) * 0.2);

export function Trees({ trees, lite }: { trees: Tree[]; lite: boolean }) {
  const uniforms = useMemo<Uniforms>(() => ({ uTime: { value: 0 } }), []);
  const mats = useMemo(() => materials(uniforms), [uniforms]);
  const scene = useMemo(() => {
    const models = treeModels();
    const lods = lite ? (["far"] as const) : (["near", "far"] as const);
    const keys = KINDS.flatMap((k) => models[k].flatMap((v, i) => lods.map((lod) => ({ k, i, lod, m: v[lod] }))));
    const key = (k: Kind, i: number, lod: string) => keys.findIndex((x) => x.k === k && x.i === i && x.lod === lod);
    const pit = pitGeometry();
    const pits = trees.filter(hasPit);
    const bark = batch([...keys.map((x) => x.m.bark), pit], trees.length + pits.length, mats.bark);
    const leaves = batch(keys.map((x) => x.m.leaves), trees.length, mats.leaves);
    leaves.mesh.customDepthMaterial = mats.depth;
    const o = new Object3D();
    const items = trees.map((t) => {
      const k = kindOf(t);
      const v = variantOf(t);
      const ids = { near: key(k, v, lods[0]), far: key(k, v, "far") };
      treePose(t, k, o);
      o.updateMatrix();
      const b = bark.mesh.addInstance(bark.ids[ids.near]);
      bark.mesh.setMatrixAt(b, o.matrix);
      bark.mesh.setColorAt(b, barkTint(t));
      const l = leaves.mesh.addInstance(leaves.ids[ids.near]);
      leaves.mesh.setMatrixAt(l, o.matrix);
      leaves.mesh.setColorAt(l, leafTint(t));
      return { t, b, l, ids, far: lite };
    });
    for (const t of pits) {
      pitPose(t, o);
      o.updateMatrix();
      const b = bark.mesh.addInstance(bark.ids[keys.length]);
      bark.mesh.setMatrixAt(b, o.matrix);
      bark.mesh.setColorAt(b, tint.setScalar(1));
    }
    return { bark: bark.mesh, leaves: leaves.mesh, barkIds: bark.ids, leafIds: leaves.ids, items };
  }, [trees, lite, mats]);

  // Only the buffers: BatchedMesh.dispose() can't be undone, and Strict Mode unmounts once and mounts again.
  useEffect(() => () => [scene.bark, scene.leaves].forEach((m) => m.geometry.dispose()), [scene]);
  useEffect(
    () => () => {
      [mats.bark, mats.leaves, mats.depth].forEach((m) => m.dispose());
      mats.maps.forEach((t) => t.dispose());
    },
    [mats],
  );

  useFrame(({ camera, clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    if (lite) return;
    // Near model up close, far model past LOD_DISTANCE (a bigger tree switches a little later).
    for (const it of scene.items) {
      const far = !BAKING && camera.position.distanceTo(crown.set(it.t.x, it.t.y + 1.5 * it.t.s, it.t.z)) > LOD_DISTANCE * Math.max(1, it.t.s);
      if (far === it.far) continue;
      it.far = far;
      const id = far ? it.ids.far : it.ids.near;
      scene.bark.setGeometryIdAt(it.b, scene.barkIds[id]);
      scene.leaves.setGeometryIdAt(it.l, scene.leafIds[id]);
    }
  });

  return (
    <>
      <primitive object={scene.bark} />
      <primitive object={scene.leaves} />
    </>
  );
}
