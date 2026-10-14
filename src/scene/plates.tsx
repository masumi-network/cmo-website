"use client";

// Photo-real mode (F12, docs/features/photoreal.md). When the camera comes to
// rest on a chapter that has a plate (its static city, path-traced once), the
// plate fades in over the city. Then the city is drawn only as a shadow
// catcher: its depth hides the live objects behind walls, and their shadows
// darken the plate. The live objects (LIVE in shared.ts: Cuso, cars, boats, the
// visitor's brand) draw as usual, and the post chain tone-maps plate and live
// objects alike. As soon as the camera moves, the city comes back as it was.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  MultiplyBlending,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  SrcAlphaFactor,
  TextureLoader,
  WebGLRenderTarget,
  Matrix4,
  Sphere,
  Vector3,
  Vector4,
  type DirectionalLight,
  type InstancedMesh,
  type Material,
  type Object3D,
  type Scene,
  type Texture,
} from "three";
import { PLATES_DIR, cropScale, parseManifest, plateFor, type PlateEntry, type PlateManifest } from "@/lib/plates";
import { dayNow, rig } from "./shared";

/** Seconds the plate takes to fade in over the city. */
const FADE = 0.4;
/** How dark a live object's shadow is on the plate. */
const SHADOW = 0.45;
/**
 * How far (beyond its bounding sphere) a live object's shadow may fall on the
 * plate. The catcher's shadow map holds the live casters only, so nothing
 * static stops a shadow: at dawn Cuso's, from his roof, ran 20 m across the
 * street and down the facade below him. A point whose ray to the sun passes
 * through a live object farther than this is not shadowed by it (a long throw).
 * Live shadows fall only on what faces up: a low sun threw cars' and Cuso's
 * shadows up the facades. Contact shadows (under him, cars, boats) stay.
 */
const REACH = 2.5;
/** Live objects the catcher knows about (a uniform array). */
const CASTERS = 64;

const sphere = new Sphere();
const sunAt = new Vector3();
const sunTo = new Vector3();
const instance = new Matrix4();
/** Where the live objects are, as world bounding spheres (one per instance): the `max` nearest to `from` (if given). */
export function liveSpheres(live: Object3D[], max: number, from?: Vector3): Vector4[] {
  const out: Vector4[] = [];
  const add = (geometry: BufferGeometry, matrix: Matrix4) => {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    sphere.copy(geometry.boundingSphere!).applyMatrix4(matrix);
    out.push(new Vector4(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius));
  };
  for (const root of live) {
    root.traverseVisible((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as InstancedMesh).isInstancedMesh) {
        const many = mesh as InstancedMesh;
        for (let i = 0; i < many.count; i++) add(mesh.geometry, instance.multiplyMatrices(mesh.matrixWorld, (many.getMatrixAt(i, instance), instance)));
      } else add(mesh.geometry, mesh.matrixWorld);
    });
  }
  if (from) out.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z) - a.w - (Math.hypot(b.x - from.x, b.y - from.y, b.z - from.z) - b.w));
  return out.slice(0, max);
}

/**
 * The scene, as plates need it:
 * - `live`: drawn as usual (marked LIVE),
 * - `catchers`: the static city's meshes, drawn as shadow catchers at rest,
 * - `hidden`: what the plate already shows (the sky dome, lines, transparent bits),
 * - everything else (custom shader effects such as the fog bank) stays as it is.
 */
export function splitScene(scene: Scene) {
  const live: Object3D[] = [];
  const catchers: Mesh[] = [];
  const hidden: Object3D[] = [];
  const walk = (o: Object3D) => {
    if (o.userData.live) return void live.push(o);
    const mesh = o as Mesh;
    if (o.name === "sky" || (o as { isLine?: boolean }).isLine || (o as { isPoints?: boolean }).isPoints) return void hidden.push(o);
    if (mesh.isMesh) {
      const materials = [mesh.material].flat();
      if (materials.some((m) => (m as ShaderMaterial).isShaderMaterial)) return; // drawn live: the plate leaves them out
      if (materials.some((m) => m.transparent)) hidden.push(o);
      else catchers.push(mesh);
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  return { live, catchers, hidden };
}

/** Multiplies the plate by its shadow (live casters only, within REACH of one) and writes the city's depth. */
function catcherMaterial() {
  const m = new ShadowMaterial({ opacity: SHADOW });
  Object.assign(m, { transparent: false, premultipliedAlpha: true, blending: MultiplyBlending, depthWrite: true, fog: false });
  const casters = { uCasters: { value: Array.from({ length: CASTERS }, () => new Vector4()) }, uCount: { value: 0 }, uSun: { value: new Vector3(0, 1, 0) } };
  m.userData.casters = casters;
  m.customProgramCacheKey = () => "plate-catcher";
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, casters);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCatch;\nvarying float vUp;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvCatch = worldPosition.xyz;\nvUp = inverseTransformDirection(transformedNormal, viewMatrix).y;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vCatch;\nvarying float vUp;\nuniform vec4 uCasters[${CASTERS}];\nuniform int uCount;\nuniform vec3 uSun;`)
      .replace(
        "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
        `// a long throw: the ray to the sun passes through a live object that is farther than REACH
        bool far = false;
        for (int i = 0; i < ${CASTERS}; i++) {
          if (i >= uCount) break;
          vec3 c = uCasters[i].xyz - vCatch;
          float along = dot(c, uSun);
          if (along > 0.0 && length(c - uSun * along) < uCasters[i].w && length(c) - uCasters[i].w > ${REACH.toFixed(2)}) far = true;
        }
        // and only on what faces up (roofs, streets, water): on walls a low sun threw cars' and Cuso's shadows up the facades
        float mask = mix(1.0, far ? 1.0 : getShadowMask(), smoothstep(0.35, 0.6, vUp));
        gl_FragColor = vec4( vec3( 1.0 - opacity * ( 1.0 - mask ) ), 1.0 );`,
      );
  };
  return m;
}

/** A full-screen triangle at the far plane showing the middle of the plate, its colour scaled back up to linear. */
function plateQuad() {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new ShaderMaterial({
    uniforms: { map: { value: null }, range: { value: 1 }, scale: { value: 1 }, opacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = position.xy * 0.5 + 0.5;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform float range, scale, opacity;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(texture2D(map, vec2(0.5 + (vUv.x - 0.5) * scale, vUv.y)).rgb * range, opacity);
      }`,
    depthTest: false,
    depthWrite: false,
    fog: false,
    blending: CustomBlending,
    blendSrc: SrcAlphaFactor,
    blendDst: OneMinusSrcAlphaFactor,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  quad.visible = false;
  return { quad, material };
}

type Saved = { mesh: Mesh; material: Material | Material[]; castShadow: boolean; receiveShadow: boolean; renderOrder: number };

export function Plates() {
  const { gl, scene, camera, size } = useThree();
  const { quad, material } = useMemo(() => plateQuad(), []);
  const catcher = useMemo(() => catcherMaterial(), []);
  const state = useRef({
    manifest: null as PlateManifest | null,
    textures: new Map<string, Texture | "loading">(),
    phase: "off" as "off" | "fade" | "rest",
    since: 0,
    saved: [] as Saved[],
    shown: [] as Object3D[],
    live: [] as Object3D[],
    sun: null as DirectionalLight | null,
    warm: false,
  });

  useEffect(() => {
    let stop = false;
    fetch(`${PLATES_DIR}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: unknown) => {
        if (!stop) state.current.manifest = parseManifest(json);
      })
      .catch(() => {}); // no plates: the city as usual
    return () => {
      stop = true;
      rig.plates = [];
      rig.rest = null;
    };
  }, []);

  useEffect(
    () => () => {
      for (const t of state.current.textures.values()) if (t !== "loading") t.dispose();
      quad.geometry.dispose();
      material.dispose();
      catcher.dispose();
    },
    [quad, material, catcher],
  );

  useFrame(({ clock }) => {
    const s = state.current;
    const m = s.manifest;
    if (!m || !scene.userData.shadersReady) return;
    const now = clock.elapsedTime;
    const day = dayNow();

    // the catcher's shader variants (plain, instanced, batched), compiled once up front like the rest (Ready)
    if (!s.warm) {
      s.warm = true;
      const { catchers } = splitScene(scene);
      const saved = catchers.map((c) => c.material);
      for (const c of catchers) c.material = Array.isArray(c.material) ? c.material.map(() => catcher) : catcher;
      const target = new WebGLRenderTarget(1, 1);
      const previous = gl.getRenderTarget();
      gl.setRenderTarget(target);
      gl.compile(scene, camera);
      gl.setRenderTarget(previous);
      target.dispose();
      catchers.forEach((c, i) => (c.material = saved[i]));
    }

    // load this chapter's plate and its neighbours' ahead of time
    for (const i of [day.from, day.to, day.from - 1, day.from + 1]) {
      const p = plateFor(m, i);
      if (!p || s.textures.has(p.file)) continue;
      s.textures.set(p.file, "loading");
      new TextureLoader().load(`${PLATES_DIR}/${p.file}`, (t) => {
        t.colorSpace = SRGBColorSpace;
        t.generateMipmaps = false;
        gl.initTexture(t);
        s.textures.set(p.file, t);
      });
    }

    // Offer the rig the plates that could show here; it decides (camera-rig.tsx) whether the camera rests on one.
    // At a chapter the day can read as the start of its leg or the end of the one before: offer both ends.
    const ready = (p: PlateEntry | null): p is PlateEntry => {
      const t = p && s.textures.get(p.file);
      return !!t && t !== "loading" && cropScale(p.width / p.height, size.width / size.height) !== null;
    };
    rig.plates = day.mode === "explore" ? [] : [day.from, day.to].map((i) => plateFor(m, i)).filter(ready);
    const entry = rig.rest; // from the last frame: the rig runs after this
    const texture = entry ? s.textures.get(entry.file) : undefined;
    const scale = entry ? cropScale(entry.width / entry.height, size.width / size.height) : null;
    const resting = !!entry && texture !== undefined && texture !== "loading" && scale !== null;

    if (resting && s.phase === "off") {
      s.phase = "fade";
      s.since = now;
      material.uniforms.map.value = texture;
      material.uniforms.range.value = m.range;
      material.uniforms.scale.value = scale;
      // the plate goes over the city (drawn first) and under the live objects
      s.saved = splitScene(scene).catchers.map((mesh) => ({ mesh, material: mesh.material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, renderOrder: mesh.renderOrder }));
      for (const { mesh } of s.saved) mesh.renderOrder = -10;
      quad.renderOrder = -5;
      quad.visible = true;
    }
    if (s.phase === "fade" && resting) {
      const t = Math.min(1, (now - s.since) / FADE);
      material.uniforms.opacity.value = t;
      if (t === 1) {
        // at rest: the city becomes depth and shadows over the plate; only live objects cast
        s.phase = "rest";
        quad.renderOrder = -20;
        for (const { mesh } of s.saved) {
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(() => catcher) : catcher;
          mesh.castShadow = false;
          mesh.receiveShadow = true;
        }
        const split = splitScene(scene);
        s.live = split.live;
        s.sun = null;
        scene.traverse((o) => void ((o as DirectionalLight).isDirectionalLight && o.castShadow && (s.sun ??= o as DirectionalLight)));
        s.shown = split.hidden.filter((o) => o.visible);
        for (const o of s.shown) o.visible = false;
      }
    }
    if (!resting && s.phase !== "off") {
      s.phase = "off";
      quad.visible = false;
      for (const o of s.saved) Object.assign(o.mesh, { material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder });
      for (const o of s.shown) o.visible = true;
      s.saved = [];
      s.shown = [];
    }
    if (s.phase === "rest") {
      // where the live objects are now: their shadows stay within REACH of them
      const spheres = liveSpheres(s.live, CASTERS, camera.position);
      const { uCasters, uCount, uSun } = catcher.userData.casters as { uCasters: { value: Vector4[] }; uCount: { value: number }; uSun: { value: Vector3 } };
      spheres.forEach((v, i) => uCasters.value[i].copy(v));
      uCount.value = spheres.length;
      if (s.sun) uSun.value.subVectors(s.sun.getWorldPosition(sunAt), s.sun.target.getWorldPosition(sunTo)).normalize();
    }
    // for tests and scripts: off, fade or rest
    if (gl.domElement.dataset.plate !== s.phase) gl.domElement.dataset.plate = s.phase;
  });

  return <primitive object={quad} />;
}
