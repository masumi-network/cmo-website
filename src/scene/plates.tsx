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
  AdditiveBlending,
  BufferGeometry,
  CustomBlending,
  Float32BufferAttribute,
  Mesh,
  MultiplyBlending,
  NormalBlending,
  OneMinusSrcAlphaFactor,
  ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  SrcAlphaFactor,
  TextureLoader,
  WebGLRenderTarget,
  InstancedMesh,
  MeshBasicMaterial,
  type BatchedMesh,
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
 * The scene, as plates need it:
 * - `live`: drawn as usual (marked LIVE),
 * - `catchers`: the static city's meshes, drawn as shadow catchers at rest,
 * - `hidden`: what the plate already shows (lines, transparent bits),
 * - `sky`: the sky dome; at rest it draws only its stars, over the plate's sky,
 * - everything else (custom shader effects such as the fog bank) stays as it is.
 */
export function splitScene(scene: Scene) {
  const live: Object3D[] = [];
  const catchers: Mesh[] = [];
  const hidden: Object3D[] = [];
  let sky: Mesh | null = null;
  const walk = (o: Object3D) => {
    if (o.userData.live) return void live.push(o);
    const mesh = o as Mesh;
    if (o.name === "sky") return void (sky = mesh);
    if ((o as { isLine?: boolean }).isLine || (o as { isPoints?: boolean }).isPoints) return void hidden.push(o);
    if (mesh.isMesh) {
      const materials = [mesh.material].flat();
      if (materials.some((m) => (m as ShaderMaterial).isShaderMaterial)) return; // drawn live: the plate leaves them out
      if (materials.some((m) => m.transparent)) hidden.push(o);
      else catchers.push(mesh);
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  return { live, catchers, hidden, sky: sky as Mesh | null };
}

const depthOnly = new MeshBasicMaterial({ colorWrite: false });
/**
 * A depth-only twin of a catcher, drawn (as its child) before every shadow:
 * the catchers multiply into the plate one mesh at a time, so a street drawn
 * before the wall in front of it had already darkened the wall with a car's
 * shadow. Instanced meshes share their instances; batched ones (the trees) get none.
 */
export function depthProxy(mesh: Mesh): Mesh | null {
  if ((mesh as BatchedMesh).isBatchedMesh) return null;
  let proxy: Mesh;
  if ((mesh as InstancedMesh).isInstancedMesh) {
    const many = mesh as InstancedMesh;
    const copy = new InstancedMesh(mesh.geometry, depthOnly, many.count);
    copy.instanceMatrix = many.instanceMatrix;
    proxy = copy;
  } else proxy = new Mesh(mesh.geometry, depthOnly);
  proxy.renderOrder = -15;
  proxy.frustumCulled = mesh.frustumCulled;
  proxy.layers.mask = mesh.layers.mask;
  return proxy;
}

/** The sky dome (atmosphere.tsx) draws only its stars, added over what is there, or the whole sky again. */
function starsOnly(sky: Mesh, on: boolean) {
  const m = sky.material as ShaderMaterial;
  m.uniforms.starsOnly.value = on ? 1 : 0;
  m.blending = on ? AdditiveBlending : NormalBlending;
  sky.renderOrder = on ? 10 : -1;
}

/** Multiplies the plate by its shadow (live casters only) and writes the city's depth. */
function catcherMaterial() {
  const m = new ShadowMaterial({ opacity: SHADOW });
  Object.assign(m, { transparent: false, premultipliedAlpha: true, blending: MultiplyBlending, depthWrite: true, fog: false });
  m.customProgramCacheKey = () => "plate-catcher";
  m.onBeforeCompile = (s) => {
    s.fragmentShader = s.fragmentShader.replace(
      "gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );",
      "gl_FragColor = vec4( vec3( 1.0 - opacity * ( 1.0 - getShadowMask() ) ), 1.0 );",
    );
  };
  return m;
}

type Saved = { mesh: Mesh; material: Material | Material[]; castShadow: boolean; receiveShadow: boolean; renderOrder: number };

type Phase = { phase: "off" | "fade" | "rest"; saved: Saved[]; shown: Object3D[]; sky: Mesh | null; proxies: Mesh[] };

/** Back to the city as usual: the plate hidden, the city's own materials, shadows and hidden parts restored. */
function leave(s: Phase, quad: Mesh) {
  s.phase = "off";
  quad.visible = false;
  for (const o of s.saved) Object.assign(o.mesh, { material: o.material, castShadow: o.castShadow, receiveShadow: o.receiveShadow, renderOrder: o.renderOrder });
  for (const o of s.shown) o.visible = true;
  if (s.sky) starsOnly(s.sky, false);
  for (const p of s.proxies) p.removeFromParent();
  s.proxies = [];
  s.sky = null;
  s.saved = [];
  s.shown = [];
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
    sky: null as Mesh | null,
    proxies: [] as Mesh[],
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
      // turned off in settings, maybe at rest: the city as it was
      leave(state.current, quad);
      rig.plateDrawn = false;
      delete gl.domElement.dataset.plate;
      for (const t of state.current.textures.values()) if (t !== "loading") t.dispose();
      quad.geometry.dispose();
      material.dispose();
      catcher.dispose();
    },
    [quad, material, catcher, gl],
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
    const texture = entry ? (entry === rig.live?.entry ? rig.live.texture : s.textures.get(entry.file)) : undefined;
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
          const proxy = depthProxy(mesh);
          if (proxy) {
            mesh.add(proxy);
            s.proxies.push(proxy);
          }
        }
        const split = splitScene(scene);
        s.shown = split.hidden.filter((o) => o.visible);
        for (const o of s.shown) o.visible = false;
        // the stars, as the sky dome draws them, added over the plate wherever it shows sky (the city's depth hides the rest)
        s.sky = split.sky;
        if (s.sky) starsOnly(s.sky, true);
      }
    }
    if (!resting && s.phase !== "off") leave(s, quad);
    // for tests and scripts: off, fade or rest
    if (gl.domElement.dataset.plate !== s.phase) gl.domElement.dataset.plate = s.phase;
    rig.plateDrawn = s.phase !== "off";
  });

  return <primitive object={quad} />;
}
