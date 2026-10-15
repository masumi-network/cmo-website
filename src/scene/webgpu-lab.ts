// Dev only (`?raytrace=webgpu`): the spike for moving the whole site to the
// WebGPU renderer (team doc, Oct 15). The live city drawn by WebGPU at the
// WebGL canvas's pixel ratio, with one district's materials ported to TSL (the
// row houses), the water and its mirror, and today's post chain (bloom, tilt
// shift, saturation, vignette, ACES), timed on the GPU per frame. Everything
// else draws as plain standard materials (their GLSL patches do not run on
// WebGPU); GLSL-only meshes (the sky dome, the fog bank) are left out.
// window.__gpu has the switches and numbers for scripts/webgpu-bench.mjs.

import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import {
  Fn,
  If,
  Loop,
  abs,
  attribute,
  cameraPosition,
  cameraViewMatrix,
  convertToTexture,
  distance,
  dot,
  float,
  floor,
  fract,
  fwidth,
  int,
  length,
  max,
  mix,
  mod,
  normalWorld,
  normalize,
  pass,
  positionWorld,
  pow,
  reflect,
  reflector,
  renderOutput,
  saturation,
  screenCoordinate,
  screenSize,
  select,
  sin,
  smoothstep,
  step,
  texture,
  time,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { ACESFilmicToneMapping, Color, DoubleSide, Mesh as WMesh, MeshBasicMaterial, MeshStandardNodeMaterial, PMREMGenerator, PlaneGeometry, RenderPipeline, Scene as WScene, Vector2, Vector3, type Material, type Mesh, type Node, type Object3D, type PerspectiveCamera, type Scene, type ShaderMaterial, type Texture, type WebGPURenderer } from "three/webgpu";
import { SLOT, SLOTS } from "./house-models";
import { traceInfo } from "./trace-info";

type Opts = { hasOrigin: boolean; mirrorScale?: number };

const ports = new WeakMap<Material, MeshStandardNodeMaterial>();

/** The scene's fog colour and hemisphere sky, for the glass and the water (set each frame by the runner). */
const fogColor = uniform(new Color("#e8e0d4"));
const skyTop = uniform(new Color("#9fb8cc"));
const night = uniform(0);

const hash = (p: Node<"vec2">) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));
const vnoise = Fn(([p]: [Node<"vec2">]) => {
  const i = floor(p);
  const f = fract(p);
  const s = f.mul(f).mul(f.mul(-2).add(3));
  const a = mix(hash(i), hash(i.add(vec2(1, 0))), s.x);
  const b = mix(hash(i.add(vec2(0, 1))), hash(i.add(1)), s.x);
  return mix(a, b, s.y);
});

/** materials.ts houseMaterial in TSL, but the glass reflects the painted sky only (the reflection probe is a WebGL cube camera). */
function housePort(info: Extract<NonNullable<ReturnType<typeof traceInfo.get>>, { kind: "house" }>, { hasOrigin }: Opts) {
  const n = SLOTS.length;
  const colours = Array.from({ length: info.palette.length / 3 }, (_, i) => new Vector3().fromArray(info.palette, i * 3));
  const palette = uniformArray(colours, "vec3");
  const slot = attribute("aSlot", "float").add(0.5).floor();
  const win = attribute("aWin", "float");
  const pane = attribute("aPane", "vec2");
  const which = attribute("aPalette", "float").add(0.5).floor();
  const seed = hasOrigin ? hash(attribute("aOrigin", "vec2")) : float(0);
  const wn = normalWorld;
  const wp = positionWorld;
  const along = dot(wp.xz, normalize(vec2(wn.z.negate(), wn.x).add(vec2(1e-5, 0))));
  const upright = abs(wn.y).lessThan(0.5);
  const glassy = select(slot.equal(SLOT.glass), float(1), float(0));
  const room = hash(vec2(win.mul(1.7).add(3), seed.mul(17)));
  const cloth = Fn(() => {
    const aa = fwidth(pane).mul(1.5).add(1e-4);
    const drop = float(1).sub(fract(room.mul(7.31)).mul(0.3).add(0.16));
    const blind = step(0.62, room).mul(smoothstep(drop.sub(aa.y), drop.add(aa.y), pane.y));
    const side = pane.x.min(float(1).sub(pane.x));
    const curtain = step(room, 0.34).mul(float(1).sub(smoothstep(aa.x.negate().add(0.15), aa.x.add(0.15), side)));
    return vec2(blind, curtain);
  })();

  const color = Fn(() => {
    const c = vec3(palette.element(int(which.mul(n).add(slot))) as unknown as Node<"vec3">).toVar();
    If(slot.equal(SLOT.body).and(upright), () => {
      c.mulAssign(texture(info.siding, vec2(along, wp.y).div(1.6)).rgb.mul(1.12));
    })
      .ElseIf(slot.equal(SLOT.scales), () => {
        const p = vec2(along, wp.y).mul(6);
        const row = floor(p.y);
        const q = vec2(fract(p.x.add(mod(row, 2).mul(0.5))).sub(0.5), fract(p.y));
        const r = length(vec2(q.x, q.y.sub(0.5)));
        const aa = fwidth(r).add(0.02);
        const rim = select(q.y.lessThan(0.5), smoothstep(aa.mul(-2).add(0.5), 0.5, r), float(0));
        c.mulAssign(float(1).sub(rim.mul(0.22)).sub(q.y.mul(0.06)));
      })
      .ElseIf(slot.equal(SLOT.stucco), () => {
        const s = select(upright, vec2(along, wp.y), wp.xz);
        c.mulAssign(vnoise(s.mul(3)).mul(0.07).add(vnoise(s.mul(11)).mul(0.04)).add(0.95));
      })
      .ElseIf(slot.equal(SLOT.gravel), () => {
        const s = wp.xz;
        const fine = float(1).sub(smoothstep(0.012, 0.04, length(fwidth(s))));
        const stones = vnoise(s.mul(40)).mul(0.6).add(vnoise(s.mul(97)).mul(0.4));
        c.mulAssign(vnoise(s.mul(1.3)).mul(0.26).add(0.86).mul(mix(float(1), stones.mul(0.76).add(0.62), fine)));
      })
      .ElseIf(slot.equal(SLOT.roof), () => {
        const t = vec2(along, wp.y.div(max(0.3, length(wn.xz)))).div(1.3);
        c.assign(texture(info.shingles, t).rgb.mul(mix(vec3(1), c, 0.6)).mul(1.1));
      })
      .ElseIf(slot.equal(SLOT.glass), () => {
        c.mulAssign(pane.y.mul(0.9).add(0.8));
        c.assign(mix(c, vec3(0.62, 0.58, 0.5), cloth.x));
        c.assign(mix(c, mix(vec3(0.55, 0.47, 0.4), vec3(0.6, 0.6, 0.56), step(0.17, room)), cloth.y));
      });
    return c;
  });

  const glow = Fn(() => {
    const e = vec3(0).toVar();
    If(glassy.greaterThan(0.5), () => {
      const v = normalize(wp.sub(cameraPosition));
      const nn = normalize(wn);
      const r = reflect(v, nn);
      const zenith = mix(vec3(0.32, 0.48, 0.78), vec3(0.02, 0.03, 0.06), night);
      const sky = mix(fogColor, zenith, smoothstep(0, 0.6, abs(r.y))).mul(select(r.y.greaterThan(0), float(1), float(0.75)));
      const fres = pow(float(1).sub(abs(dot(v, nn))), 1.2).mul(0.8).add(0.1);
      const shut = cloth.x.max(cloth.y);
      const lit = step(0.5, hash(vec2(win, seed.mul(31))));
      e.assign(sky.mul(fres).mul(float(1).sub(shut.mul(0.6).mul(night))).add(vec3(1, 0.7, 0.38).mul(lit).mul(night).mul(shut.mul(0.5).add(1.1))));
    });
    return e;
  });

  const m = new MeshStandardNodeMaterial({ roughness: 0.82 });
  m.colorNode = color();
  m.roughnessNode = mix(float(0.82), float(0.1), glassy);
  m.emissiveNode = glow();
  return m;
}

/** bay.tsx waterMaterial in TSL: two ripple layers, fresnel, the sky gradient and a planar mirror at today's size. Shallows and foam are left out. */
function waterPort(info: Extract<NonNullable<ReturnType<typeof traceInfo.get>>, { kind: "water" }>, { mirrorScale = 0.5 }: Opts) {
  const wp = positionWorld.xz;
  const r1 = texture(info.ripples, wp.mul(0.043).add(time.mul(vec2(0.011, 0.004)))).xy.mul(2).sub(1);
  const r2 = texture(info.ripples, wp.mul(0.117).add(vec2(0.37, 0.71)).add(time.mul(vec2(-0.006, 0.015)))).xy.mul(2).sub(1);
  const calm = float(1).sub(smoothstep(15, 180, distance(cameraPosition, positionWorld)).mul(0.8));
  const slope = r1.mul(0.55).add(r2.mul(0.45)).mul(0.26).mul(calm);
  const waterN = normalize(vec3(slope.x, 1, slope.y));
  const view = normalize(cameraPosition.sub(positionWorld));
  const fresnel = pow(float(1).sub(max(dot(waterN, view), 0)), 5).mul(0.96).add(0.04);
  const r = reflect(view.negate(), normalize(vec3(slope.x.mul(0.4), 1, slope.y.mul(0.4))));
  const gradient = mix(fogColor, skyTop, smoothstep(-0.02, 0.55, r.y));
  const mirror = reflector({ resolutionScale: mirrorScale, bounces: false });
  mirror.target.rotateX(-Math.PI / 2);
  mirror.uvNode = mirror.uvNode!.add(slope.mul(0.02));
  const reflection = mix(gradient, mirror.rgb, mirror.a);
  const k = fresnel.add(0.1).clamp(0, 1);
  const m = new MeshStandardNodeMaterial({ roughness: 0.14, metalness: 0 });
  m.envMapIntensity = 0;
  m.colorNode = vec3(info.deep.r, info.deep.g, info.deep.b).mul(float(1).sub(k));
  m.normalNode = cameraViewMatrix.mul(vec4(waterN, 0)).xyz;
  m.emissiveNode = reflection.mul(k);
  m.userData.mirror = mirror.target;
  return m;
}

/** The TSL port of a patched material, or null if it has none yet (WebGPU then draws it as a plain standard material). One per material. */
export function portFor(material: Material, opts: Opts): MeshStandardNodeMaterial | null {
  const known = ports.get(material);
  if (known) return known;
  const info = traceInfo.get(material);
  const port = info?.kind === "house" ? housePort(info, opts) : info?.kind === "water" ? waterPort(info, opts) : null;
  if (port) ports.set(material, port);
  return port;
}

/** Meshes WebGPU cannot draw at all: raw GLSL (ShaderMaterial), such as the sky dome and the fog bank. */
export function glslOnly(scene: Object3D) {
  const out: Mesh[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && [mesh.material].flat().some((m) => (m as ShaderMaterial).isShaderMaterial)) out.push(mesh);
  });
  return out;
}

/** Today's post chain (scene.tsx EffectComposer) on WebGPU: bloom, TiltShift2 (10 taps, as its shader), saturation +8%, vignette, then ACES. */
/** Which parts run, for timing them one by one (`window.__gpu.drop`). */
/** `fxaa`: no MSAA, FXAA after tone mapping instead. */
export type Drop = "" | "msaa" | "bloom" | "tilt" | "all" | "fxaa";

export function postChain(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, samples: number, drop: Drop = "") {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: drop === "msaa" || drop === "all" || drop === "fxaa" ? 0 : samples });
  const color = scenePass.getTextureNode();
  if (drop === "all") {
    pipeline.outputNode = color;
    return pipeline;
  }
  const blurred = Fn(() => {
    const tex = convertToTexture(color);
    const res = screenSize;
    const diagonal = length(res);
    const offset = fract(sin(dot(vec3(screenCoordinate, 0), vec3(12.9898, 78.233, 151.7182))).mul(43758.5453));
    // TiltShift2 blur 0.04, taper 0.5, a vertical focus line through the middle
    const radius = smoothstep(0, 1, abs(uv().x.mul(res.x).sub(res.x.mul(0.5))).div(diagonal.mul(0.5))).mul(diagonal.mul(0.04 / 16));
    const sum = vec4(0).toVar();
    const total = float(0).toVar();
    Loop(10, ({ i }) => {
      const percent = float(i).sub(5).add(offset).sub(0.5).div(5);
      const w = float(1).sub(abs(percent));
      sum.addAssign(tex.sample(uv().add(normalize(vec2(1, 1)).div(res).mul(percent).mul(radius))).mul(w));
      total.addAssign(w);
    });
    return sum.div(total);
  })();
  const base = drop === "tilt" ? color : blurred;
  // Bloom: the bright parts, one gaussian blur at an eighth of the buffer, added back. three's BloomNode (5 levels,
  // 6 to 22 taps) cost 5.2 ms a frame here at any resolution scale, against 1.5 ms for this (chapter 3, retina).
  // (blurred straight from the scene texture, the threshold after: a bright-pass texture first drew the whole scene twice)
  const glow = gaussianBlur(color, null, 6, { resolutionScale: 0.125 }).rgb.sub(0.9).max(0).mul(0.6 * 4);
  const graded = saturation(drop === "bloom" ? base.rgb : base.rgb.add(glow), 1.08);
  const d = uv().sub(0.5).mul(0.3 * 2);
  const vignette = mix(graded, vec3(1 - 0.45), dot(d, d));
  pipeline.outputNode = vec4(vignette, 1);
  if (drop === "fxaa") {
    pipeline.outputColorTransform = false;
    pipeline.outputNode = fxaa(renderOutput(vec4(vignette, 1)));
  }
  return pipeline;
}

/** For the runner: the scene's fog and sky colours and the night, as the WebGL city has them now. */
export function followScene(scene: Scene, nightNow: number) {
  const fog = scene.fog as { color?: Color } | null;
  if (fog?.color) fogColor.value.copy(fog.color);
  scene.traverse((o) => void ((o as { isHemisphereLight?: boolean }).isHemisphereLight && skyTop.value.copy((o as unknown as { color: Color }).color)));
  night.value = nightNow;
}


/**
 * scene.tsx's studio light (drei Environment: two light panels, environmentIntensity 0.5) made by WebGPU: drei's is a
 * WebGL texture WebGPU cannot read, and without it nights went black (Cuso, the piers).
 */
function studio(renderer: WebGPURenderer) {
  const room = new WScene();
  room.background = new Color(0, 0, 0);
  const panel = (intensity: number, position: [number, number, number], scale: [number, number], rotY = 0) => {
    const m = new WMesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(intensity), side: DoubleSide }));
    m.position.set(...position);
    m.scale.set(scale[0], scale[1], 1);
    m.rotation.y = rotY;
    m.lookAt(0, 0, 0);
    room.add(m);
  };
  panel(1.6, [0, 12, 12], [40, 12]);
  panel(0.8, [-20, 6, -10], [30, 8], Math.PI / 2);
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(room, 0, 0.1, 100).texture;
  pmrem.dispose();
  return env;
}

type Run = { renderer: WebGPURenderer; gl: { getPixelRatio(): number; getDrawingBufferSize(v: Vector2): Vector2 }; scene: Scene; camera: PerspectiveCamera; sky: (hour: number) => Texture; hour: () => number; night: () => number; panel: HTMLElement; stopped: () => boolean };

/** Switches and numbers for scripts/webgpu-bench.mjs: `on` draws, `port` swaps in the TSL ports, `post` runs the post chain; `ms` is the median GPU time of the last 120 frames. */
export type GpuLab = { on: boolean; port: boolean; post: boolean; drop: Drop; ms: number; cpu: number; frames: number; glsl: string[]; ported: number };

/** Draws the city with WebGPU every frame on the lab canvas, as the WebGL canvas would (pixel ratio, MSAA, shadows, post), and times it. */
export function runWebGPU({ renderer, gl, scene, camera, sky, hour, night: nightNow, panel, stopped }: Run) {
  renderer.setPixelRatio(gl.getPixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = ACESFilmicToneMapping;
  const buffer = gl.getDrawingBufferSize(new Vector2());
  // the water mirror at today's size (bay.tsx): half the drawing buffer, at most 1024 wide
  const mirrorScale = Math.min(1024, buffer.x / 2) / buffer.x;
  // scene.tsx: 2x MSAA where retina already draws 4 pixels a point, else 4x
  const samples = gl.getPixelRatio() >= 2 ? 2 : 4;
  let pipeline = postChain(renderer, scene, camera, samples);
  const hide = glslOnly(scene);
  const swaps: { mesh: Mesh; own: Material | Material[]; port: Material }[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || Array.isArray(mesh.material)) return;
    const port = portFor(mesh.material, { hasOrigin: !!mesh.geometry.attributes.aOrigin, mirrorScale });
    if (!port) return;
    swaps.push({ mesh, own: mesh.material, port });
    const mirror = port.userData.mirror as Object3D | undefined;
    if (mirror && !mirror.parent) {
      mirror.position.setFromMatrixPosition(mesh.matrixWorld);
      scene.add(mirror);
    }
  });
  const env = studio(renderer);
  const lab: GpuLab = { on: true, port: true, post: true, drop: "", ms: 0, cpu: 0, frames: 0, glsl: hide.map((m) => m.name || m.parent?.name || "unnamed"), ported: swaps.length };
  (window as Window & { __gpu?: GpuLab }).__gpu = lab;
  let skyHour = -1;
  let skyTex: Texture | null = null;
  let times: number[] = [];
  let cpu: number[] = [];
  let mode = "";
  const tick = () => {
    if (stopped()) {
      pipeline.dispose();
      skyTex?.dispose();
      env.dispose();
      for (const { port } of swaps) (port.userData.mirror as Object3D | undefined)?.removeFromParent();
      return;
    }
    requestAnimationFrame(tick);
    const now = `${lab.on} ${lab.port} ${lab.post} ${lab.drop}`;
    if (now !== mode) {
      if (mode && mode.split(" ")[3] !== lab.drop) {
        pipeline.dispose();
        pipeline = postChain(renderer, scene, camera, samples, lab.drop);
      }
      mode = now;
      times = [];
      cpu = [];
    }
    if (!lab.on) return;
    const h = hour();
    if (Math.abs(h - skyHour) > 0.02) {
      skyTex?.dispose();
      skyTex = sky(h);
      skyHour = h;
    }
    followScene(scene, nightNow());
    const { background, environment, environmentIntensity } = scene;
    scene.background = skyTex;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    for (const m of hide) m.visible = false;
    if (lab.port) for (const s of swaps) s.mesh.material = s.port;
    const c0 = performance.now();
    try {
      if (lab.post) pipeline.render();
      else renderer.render(scene, camera);
    } finally {
      for (const s of swaps) s.mesh.material = s.own;
      for (const m of hide) m.visible = true;
      Object.assign(scene, { background, environment, environmentIntensity });
    }
    cpu.push(performance.now() - c0);
    if (cpu.length > 120) cpu.shift();
    lab.cpu = +[...cpu].sort((a, b) => a - b)[cpu.length >> 1].toFixed(2);
    renderer.resolveTimestampsAsync("render").then((ms) => {
      if (typeof ms !== "number" || !(ms > 0)) return;
      times.push(ms);
      if (times.length > 120) times.shift();
      const sorted = [...times].sort((a, b) => a - b);
      lab.ms = +sorted[sorted.length >> 1].toFixed(2);
      lab.frames++;
      panel.textContent = `webgpu  ${lab.ms} ms GPU (median of ${times.length})  port ${lab.port}  post ${lab.post}\n${lab.ported} meshes ported, ${lab.glsl.length} GLSL-only left out\nR toggle  F freeze`;
    });
  };
  requestAnimationFrame(tick);
}
