"use client";

// 22:00 on an Embarcadero pier: a plank deck on pilings, a timber railing
// with steel rods, an old lamp post, and Cuso's laptop and mug. The deck and
// railing are one merged mesh of weathered wood (wood.ts: grain and knots per
// plank; wet glossy edges and patches, a worn path; cut plank edges, nail
// heads, AO baked into the joints). Beams and pilings are instanced.

import { useFrame } from "@react-three/fiber";
import { useContext, useLayoutEffect, useMemo, useRef } from "react";
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Vector2,
  type InstancedMesh,
  type PointLight,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { vertexAO, type Box } from "./ao";
import type { V3 } from "./parts";
import { Lite, rig, useNightGlow } from "./shared";
import { WOOD_LOOKS, chamferBox, tagBoard, woodBoard, woodMaterial, type WoodSurface } from "./wood";

/** The deck in world units. Cuso stands on `top` at [33.6, 24.2]. */
export const DECK = { x0: 31, x1: 41, z0: 21.8, z1: 26.2, top: 0.55 };
const WATER = -0.45;
const PLANK = { pitch: 0.2, gap: 0.022, thick: 0.06 };
/** Beams under the planks, along the pier. The outer two are the rim boards. */
export const STRINGERS = [21.84, 22.9, 24, 25.1, 26.16];
/** Rows of pilings across the pier, each with a cap beam and X bracing. */
const BENTS = [31.6, 33.2, 34.8, 36.4, 38, 39.6];
const PILE_Z = [22, 24, 26];
const LAMP: V3 = [38, DECK.top, 22.15];
const LAPTOP: V3 = [35.1, DECK.top, 24.1];
const MUG: V3 = [35.95, DECK.top, 24.62];

export type Plank = { x: number; z: number; length: number; width: number; lift: number; shade: number; grey: number };

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deck planks run across the pier, side by side along it. Each row is two
 * boards that meet over an inner stringer, never the same one as the row before.
 */
export function plankLayout(): Plank[] {
  const rand = seeded(42);
  const inner = STRINGERS.slice(1, -1);
  const rows = Math.round((DECK.x1 - DECK.x0) / PLANK.pitch);
  const out: Plank[] = [];
  let last = -1;
  for (let i = 0; i < rows; i++) {
    let j = Math.floor(rand() * inner.length);
    if (j === last) j = (j + 1) % inner.length;
    last = j;
    const x = DECK.x0 + PLANK.pitch * (i + 0.5);
    for (const [a, b] of [[DECK.z0, inner[j]], [inner[j], DECK.z1]]) {
      out.push({
        x,
        z: (a + b) / 2,
        length: b - a - PLANK.gap,
        width: PLANK.pitch - PLANK.gap,
        lift: (rand() - 0.5) * 0.008,
        shade: 0.86 + rand() * 0.22,
        grey: rand(),
      });
    }
  }
  return out;
}

// ---------- textures (2D canvas) ----------

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}

/** Light grey wood grain along v. Tinted per board by instance or vertex colour (beams, pilings; the deck on phones). */
function grainTexture() {
  const rand = seeded(7);
  return canvasTexture(128, 1024, (ctx) => {
    ctx.fillStyle = "#e4e4e4";
    ctx.fillRect(0, 0, 128, 1024);
    for (let i = 0; i < 46; i++) {
      const x0 = rand() * 128;
      const v = 150 + rand() * 105;
      ctx.strokeStyle = `rgba(${v},${v},${v},${0.25 + rand() * 0.45})`;
      ctx.lineWidth = 0.6 + rand() * 2.2;
      ctx.beginPath();
      for (let y = 0; y <= 1024; y += 32) ctx.lineTo(x0 + Math.sin(y / (90 + i * 3) + i) * 3, y);
      ctx.stroke();
    }
  });
}

/** Keyboard deck seen from above; white is bare aluminium. Top edge = hinge. */
function keyboardTexture() {
  return canvasTexture(1024, 688, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1024, 688);
    // Keyboard well
    ctx.fillStyle = "#b9bac0";
    roundRect(ctx, 96, 46, 832, 340, 14);
    const cols = 14;
    const keyW = 804 / cols;
    ctx.fillStyle = "#26272b";
    for (let c = 0; c < cols; c++) roundRect(ctx, 110 + c * keyW, 58, keyW - 8, 30, 6); // function row
    for (let r = 0; r < 4; r++) for (let c = 0; c < cols; c++) roundRect(ctx, 110 + c * keyW, 98 + r * 56, keyW - 8, 48, 7);
    const rowY = 98 + 4 * 56;
    roundRect(ctx, 110, rowY, keyW * 3 - 8, 48, 7);
    roundRect(ctx, 110 + keyW * 3, rowY, keyW * 7 - 8, 48, 7); // space bar
    for (let c = 10; c < cols; c++) roundRect(ctx, 110 + c * keyW, rowY, keyW - 8, 48, 7);
    // Trackpad
    ctx.fillStyle = "#c4c5ca";
    roundRect(ctx, 322, 418, 380, 238, 20);
    ctx.fillStyle = "#f4f4f6";
    roundRect(ctx, 325, 421, 374, 232, 18);
  });
}

/** The screen: thin black bezel, a dark display and a rising bar chart. */
function screenTexture() {
  return canvasTexture(1024, 672, (ctx) => {
    ctx.fillStyle = "#050507";
    ctx.fillRect(0, 0, 1024, 672);
    const [x, y, w, h] = [22, 30, 980, 620];
    const bg = ctx.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, "#141a44");
    bg.addColorStop(1, "#0b0f2a");
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    // Two muted lines of "text" for a heading
    ctx.fillStyle = "#5d679c";
    roundRect(ctx, 90, 84, 260, 22, 11);
    ctx.fillStyle = "#353e72";
    roundRect(ctx, 90, 122, 170, 16, 8);
    // Grid
    ctx.fillStyle = "#1f2756";
    for (let i = 0; i < 4; i++) ctx.fillRect(90, 250 + i * 90, 844, 3);
    // Bars, the newest one brightest
    const bars = [0.28, 0.36, 0.33, 0.48, 0.55, 0.7, 0.9];
    const base = 560;
    const span = 360;
    bars.forEach((v, i) => {
      ctx.fillStyle = i === bars.length - 1 ? "#6f86ff" : "#3d5afe";
      roundRect(ctx, 110 + i * 118, base - v * span, 74, v * span, 8);
    });
    ctx.fillStyle = "#5d679c";
    ctx.fillRect(90, base, 844, 4);
  });
}

/** A soft wisp of steam (white on clear). */
function steamTexture() {
  const texture = canvasTexture(64, 256, (ctx) => {
    ctx.filter = "blur(5px)";
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineCap = "round";
    for (const [phase, width] of [[0, 9], [2.4, 6]]) {
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let y = 0; y <= 256; y += 8) ctx.lineTo(32 + Math.sin((y / 256) * Math.PI * 4 + phase) * 11, y);
      ctx.stroke();
    }
  });
  texture.wrapT = RepeatWrapping;
  return texture;
}

/** Fades the steam in above the cup and out at the top. */
function fadeTexture() {
  return canvasTexture(4, 128, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "#000");
    g.addColorStop(0.5, "#bbb");
    g.addColorStop(0.92, "#666");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 128);
  });
}

// ---------- instancing ----------

type Item = { p: V3; s?: V3; rx?: number; rz?: number; color?: Color };

function useInstances(items: Item[]) {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.rotation.set(it.rx ?? 0, 0, it.rz ?? 0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (it.color) mesh.setColorAt(i, it.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  return ref;
}

// ---------- the pier ----------

const WOOD = new Color("#6e5e4e");
const WEATHERED = new Color("#737069");
const UNDER = new Color("#6e5d4b");

function deckItems() {
  const beamTop = DECK.top - PLANK.thick;
  const beams: Item[] = [
    ...STRINGERS.map((z): Item => ({ p: [(DECK.x0 + DECK.x1) / 2, beamTop - 0.07, z], s: [DECK.x1 - DECK.x0, 0.14, 0.07], color: UNDER })),
    ...BENTS.map((x): Item => ({ p: [x, beamTop - 0.22, 24], s: [0.16, 0.16, 4.7], color: UNDER })),
  ];
  // X bracing between the pilings of each bent, one diagonal on each face.
  const [top, bottom] = [beamTop - 0.32, WATER + 0.1];
  const tilt = Math.atan2(top - bottom, 2);
  const length = Math.hypot(2, top - bottom);
  for (const x of BENTS) {
    for (const z of [23, 25]) {
      beams.push({ p: [x - 0.13, (top + bottom) / 2, z], s: [0.035, 0.08, length], rx: tilt, color: UNDER });
      beams.push({ p: [x + 0.13, (top + bottom) / 2, z], s: [0.035, 0.08, length], rx: -tilt, color: UNDER });
    }
  }
  const rand = seeded(3);
  const pileTop = beamTop - 0.3;
  const piles: Item[] = BENTS.flatMap((x) =>
    PILE_Z.map((z): Item => ({ p: [x, pileTop, z], rx: (rand() - 0.5) * 0.03, rz: (rand() - 0.5) * 0.03, color: new Color().setScalar(0.9 + rand() * 0.2) })),
  );
  return { beams, piles, pileTop };
}

/** The railing along the north side (z) and the far end (x), from x0 / to z1; `top` above the deck, `half` the cap rail's half-width. */
export const RAIL = { z: DECK.z0 + 0.08, x: DECK.x1 - 0.08, x0: DECK.x0 + 0.25, z1: DECK.z1 - 0.1, top: 0.64, half: 0.05 };
/** Timber railing: posts every 0.8, a cap rail, two steel rods between. */
const POST = 0.07;
const CAP = { w: RAIL.half * 2, h: 0.045 };
const RODS = [0.2, 0.4];
const railPosts = () => {
  const posts: [number, number][] = [];
  for (let x = RAIL.x0; x < RAIL.x; x += 0.8) posts.push([x, RAIL.z]);
  for (let z = RAIL.z; z < RAIL.z1; z += 0.8) posts.push([RAIL.x, z]);
  return posts;
};

/** Where Cuso's lamp, bollards and laptop stand: they shade the deck around them. */
const DECK_PROPS: Box[] = [
  { min: [LAMP[0] - 0.14, DECK.top, LAMP[2] - 0.14], max: [LAMP[0] + 0.14, DECK.top + 0.3, LAMP[2] + 0.14] },
  ...[38.6, 40.3].map((x): Box => ({ min: [x - 0.1, DECK.top, DECK.z1 - 0.32], max: [x + 0.1, DECK.top + 0.25, DECK.z1 - 0.12] })),
];

/** Sets every vertex colour to `c` (keeps the board's aWood). */
function paint(g: BufferGeometry, c: Color) {
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b);
  return g;
}

/**
 * The deck and railing timber as one geometry: planks with cut edges and
 * ends, two nail heads wherever a plank crosses a stringer, a dark floor
 * under the gaps, the railing's posts and cap. Vertex colours: each plank's
 * weathering times baked AO (dark joints, shade round the lamp and posts).
 */
export function deckGeometry() {
  const parts: BufferGeometry[] = [];
  const blockers: Box[] = [...DECK_PROPS];
  const tint = new Color();
  plankLayout().forEach((b, i) => {
    const y = DECK.top - PLANK.thick / 2 + b.lift;
    const g = chamferBox(b.width, PLANK.thick, b.length, 0.007).translate(b.x, y, b.z);
    parts.push(paint(tagBoard(g, [b.x, y, b.z], 2, woodBoard(i, 11)), tint.copy(WOOD).lerp(WEATHERED, 0.3 + b.grey * 0.6).multiplyScalar(b.shade)));
    blockers.push({ min: [b.x - b.width / 2, y - PLANK.thick / 2, b.z - b.length / 2], max: [b.x + b.width / 2, y + PLANK.thick / 2, b.z + b.length / 2] });
    // Nails: a pair over every stringer under the plank, set in from its ends.
    const [z0, z1] = [b.z - b.length / 2 + 0.035, b.z + b.length / 2 - 0.035];
    for (const s of STRINGERS) {
      const z = Math.min(z1, Math.max(z0, s));
      if (Math.abs(z - s) > 0.06) continue;
      for (const dx of [-0.05, 0.05]) {
        const nail = new CircleGeometry(0.0075, 6).toNonIndexed().rotateX(-Math.PI / 2).translate(b.x + dx, DECK.top + b.lift + 0.0008, z);
        parts.push(paint(tagBoard(nail, [b.x, y, b.z], 2, woodBoard(i, 11)), tint.setRGB(0.09, 0.075, 0.065)));
      }
    }
  });
  // Under the gaps: dark, as the deck's own shadow is.
  const under = new PlaneGeometry(DECK.x1 - DECK.x0, DECK.z1 - DECK.z0).toNonIndexed().rotateX(-Math.PI / 2).translate((DECK.x0 + DECK.x1) / 2, DECK.top - PLANK.thick - 0.004, (DECK.z0 + DECK.z1) / 2);
  parts.push(paint(tagBoard(under, [0, 0, 0], 0, { seed: 0.5, tone: 1 }), tint.setRGB(0.04, 0.035, 0.03)));
  // Railing: posts and the cap rail along the north side and the far end.
  const capY = DECK.top + RAIL.top - CAP.h / 2;
  railPosts().forEach(([x, z], i) => {
    const h = RAIL.top - CAP.h;
    const y = DECK.top + h / 2;
    parts.push(paint(tagBoard(chamferBox(POST, h, POST, 0.008).translate(x, y, z), [x, y, z], 1, woodBoard(i, 12)), tint.copy(WEATHERED).multiplyScalar(0.8 + woodBoard(i, 12).tone * 0.15)));
    blockers.push({ min: [x - POST / 2, DECK.top, z - POST / 2], max: [x + POST / 2, DECK.top + h, z + POST / 2] });
  });
  const caps: [number, number, number, number, 0 | 2][] = [
    [RAIL.x0 - 0.05, RAIL.x + CAP.w / 2, RAIL.z, RAIL.z, 0],
    [RAIL.x, RAIL.x, RAIL.z + CAP.w / 2, RAIL.z1 + 0.05, 2],
  ];
  caps.forEach(([x0, x1, z0, z1, axis], i) => {
    const [sx, sz] = axis === 0 ? [x1 - x0, CAP.w] : [CAP.w, z1 - z0];
    const c: [number, number, number] = [(x0 + x1) / 2, capY, (z0 + z1) / 2];
    parts.push(paint(tagBoard(chamferBox(sx, CAP.h, sz, 0.01).translate(...c), c, axis, woodBoard(i, 13)), tint.copy(WOOD).lerp(WEATHERED, 0.5).multiplyScalar(0.85)));
    blockers.push({ min: [c[0] - sx / 2, capY - CAP.h / 2, c[2] - sz / 2], max: [c[0] + sx / 2, capY + CAP.h / 2, c[2] + sz / 2] });
  });
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const ao = vertexAO(g.attributes.position.array, g.attributes.normal.array, blockers, 12, 0.14);
  const col = g.attributes.color;
  for (let i = 0; i < col.count; i++) {
    const k = 0.18 + 0.82 * ao[i];
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return g;
}

/** The railing's steel: two rods through the posts on each run, and a bolted plate at each post's head. */
function railSteel() {
  const parts: BufferGeometry[] = [];
  for (const h of RODS) {
    const y = DECK.top + h;
    parts.push(new CylinderGeometry(0.009, 0.009, RAIL.x - RAIL.x0 + 0.1, 8).rotateZ(Math.PI / 2).translate((RAIL.x0 + RAIL.x) / 2, y, RAIL.z));
    parts.push(new CylinderGeometry(0.009, 0.009, RAIL.z1 - RAIL.z + 0.1, 8).rotateX(Math.PI / 2).translate(RAIL.x, y, (RAIL.z + RAIL.z1) / 2));
  }
  for (const [x, z] of railPosts()) {
    // on the deck side of the post: +z on the north run, -x at the far end
    const [nx, nz] = x === RAIL.x ? [-1, 0] : [0, 1];
    const y = DECK.top + RAIL.top - CAP.h - 0.06;
    const face = POST / 2 + 0.003;
    parts.push(new BoxGeometry(nz ? POST + 0.006 : 0.006, 0.11, nx ? POST + 0.006 : 0.006).translate(x + nx * face, y, z + nz * face));
    for (const dy of [-0.03, 0.03]) {
      const bolt = new CylinderGeometry(0.009, 0.009, 0.008, 6).rotateX(Math.PI / 2);
      if (nx) bolt.rotateY(Math.PI / 2);
      parts.push(bolt.translate(x + nx * (face + 0.004), y + dy, z + nz * (face + 0.004)));
    }
  }
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  return g;
}

/**
 * Wet and worn (wood.ts surface): the deck edges and soft patches are damp,
 * darker and glossy (the lamp glints in them); the path down the middle is
 * worn paler and smoother. World units.
 */
const PIER_SURFACE: WoodSurface = {
  key: "pier",
  glsl: /* glsl */ `
    float pwEdge = min(min(vWdW.z - ${DECK.z0.toFixed(2)}, ${DECK.z1.toFixed(2)} - vWdW.z), ${DECK.x1.toFixed(2)} - vWdW.x);
    float pwPatch = wdNoise(vWdW.xz * 1.4 + 7.0) * 0.65 + wdNoise(vWdW.xz * 4.7 + 3.1) * 0.35;
    float pwWet = clamp(smoothstep(1.3, 0.2, pwEdge) * (0.6 + 0.6 * pwPatch) + smoothstep(0.55, 0.72, pwPatch), 0.0, 1.0);
    float pwPath = smoothstep(0.75, 0.2, abs(vWdW.z - 24.1)) * (0.55 + 0.45 * wdNoise(vWdW.xz * 2.3));
    diffuseColor.rgb *= mix(1.0, 1.1, pwPath) * mix(vec3(1.0), vec3(0.6, 0.57, 0.55), pwWet);
    wdRough = mix(wdRough, 0.62, pwPath * 0.6);
    wdRough = mix(wdRough, 0.3, pwWet);
    wdH *= 1.0 - 0.6 * pwWet;
    wdSky = 1.0 - 0.6 * pwWet; // dark wet wood: the lamp glints, the night sky's soft glow mostly does not`,
};

/** Piling: a round log, dark and wet near the water line. */
function pileGeometry(top: number) {
  const bottom = WATER - 1;
  const g = new CylinderGeometry(0.11, 0.12, top - bottom, 10, 12, true);
  g.translate(0, -(top - bottom) / 2, 0);
  const dry = new Color("#8a7660");
  const wet = new Color("#3a3129");
  const c = new Color();
  const pos = g.attributes.position;
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = top + pos.getY(i);
    const t = Math.min(1, Math.max(0, (y - (WATER + 0.12)) / 0.35));
    c.copy(wet).lerp(dry, t * t * (3 - 2 * t));
    colors.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** Cast iron lamp post profile (radius, height), base to globe holder. */
const LAMP_PROFILE: [number, number][] = [
  [0, 0], [0.14, 0], [0.14, 0.07], [0.11, 0.1], [0.1, 0.22], [0.075, 0.27], [0.058, 0.36],
  [0.042, 2.12], [0.062, 2.16], [0.062, 2.2], [0.038, 2.24], [0.038, 2.36], [0.075, 2.44], [0.075, 2.48], [0, 2.48],
];
const GLOBE_Y = 2.64;
const BOLLARD_PROFILE: [number, number][] = [[0, 0], [0.1, 0], [0.085, 0.05], [0.07, 0.17], [0.1, 0.21], [0.1, 0.24], [0.06, 0.27], [0, 0.275]];
const MUG_PROFILE: [number, number][] = [
  [0, 0], [0.1, 0], [0.112, 0.012], [0.118, 0.06], [0.12, 0.27], [0.112, 0.275], [0.106, 0.262], [0.104, 0.03], [0, 0.03],
];
const lathe = (profile: [number, number][], segments: number) => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);

const DECK_ITEMS = deckItems();
const GEO = {
  pile: pileGeometry(DECK_ITEMS.pileTop),
  post: lathe(LAMP_PROFILE, 20),
  bollard: lathe(BOLLARD_PROFILE, 16),
  mug: lathe(MUG_PROFILE, 28),
  base: new RoundedBoxGeometry(1, 0.032, 0.68, 3, 0.012),
  lid: new RoundedBoxGeometry(1, 0.66, 0.014, 3, 0.006),
};

export function Pier() {
  const lamp = useRef<PointLight>(null);
  const glow = useRef<PointLight>(null);

  const lite = useContext(Lite);
  const beamRef = useInstances(DECK_ITEMS.beams);
  const pileRef = useInstances(DECK_ITEMS.piles);
  const geo = useMemo(() => ({ deck: deckGeometry(), steel: railSteel() }), []);
  const m = useMemo(() => {
    const grain = grainTexture();
    const screen = screenTexture();
    const steam = steamTexture();
    // Phones: a plain standard material with the grain map and vertex colours (a program the city already has).
    const deck = woodMaterial("#ffffff", WOOD_LOOKS.deck, lite, lite ? undefined : PIER_SURFACE);
    if (lite) deck.map = grain;
    return {
      steamMap: steam,
      deck,
      wood: new MeshStandardMaterial({ map: grain, roughness: 0.92 }),
      pileWood: new MeshStandardMaterial({ map: grain, vertexColors: true, roughness: 0.95 }),
      iron: new MeshStandardMaterial({ color: "#232a28", roughness: 0.55, metalness: 0.35 }),
      aluminium: new MeshStandardMaterial({ color: "#c3c5cb", roughness: 0.36, metalness: 0.6 }),
      keyboard: new MeshStandardMaterial({ color: "#c3c5cb", map: keyboardTexture(), roughness: 0.4, metalness: 0.55 }),
      screen: new MeshBasicMaterial({ map: screen }),
      globe: new MeshStandardMaterial({ color: "#f2ede2", emissive: "#ffd28a", emissiveIntensity: 0, roughness: 0.3 }),
      ceramic: new MeshStandardMaterial({ color: "#f3f0ea", roughness: 0.35 }),
      steam: new MeshStandardMaterial({ color: "#ffffff", map: steam, alphaMap: fadeTexture(), transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide, roughness: 1 }),
    };
  }, [lite]);
  useNightGlow(m.globe, 4.5, 0);

  useFrame(({ clock }) => {
    const n = rig.night;
    if (lamp.current) lamp.current.intensity = n * 26;
    if (glow.current) glow.current.intensity = n * 1.1;
    m.screen.color.setScalar(0.9 + n * 0.25);
    m.steamMap.offset.y = -clock.elapsedTime * 0.12;
  });

  return (
    <group>
      {/* deck and railing, beams, pilings */}
      <mesh geometry={geo.deck} material={m.deck} castShadow receiveShadow />
      <mesh geometry={geo.steel} material={m.iron} castShadow receiveShadow />
      <instancedMesh ref={beamRef} args={[undefined, m.wood, DECK_ITEMS.beams.length]} receiveShadow>
        <boxGeometry />
      </instancedMesh>
      <instancedMesh ref={pileRef} args={[GEO.pile, m.pileWood, DECK_ITEMS.piles.length]} receiveShadow />
      {[38.6, 40.3].map((x) => (
        <mesh key={x} geometry={GEO.bollard} material={m.iron} position={[x, DECK.top, DECK.z1 - 0.22]} castShadow receiveShadow />
      ))}

      {/* lamp */}
      <group position={LAMP}>
        <mesh geometry={GEO.post} material={m.iron} castShadow receiveShadow />
        <mesh position-y={GLOBE_Y} material={m.globe}>
          <sphereGeometry args={[0.17, 24, 16]} />
        </mesh>
        <mesh position-y={GLOBE_Y + 0.19} material={m.iron}>
          <coneGeometry args={[0.035, 0.08, 12]} />
        </mesh>
        <pointLight ref={lamp} position-y={GLOBE_Y - 0.05} color="#ffcf8a" distance={14} decay={2} intensity={0} />
      </group>

      {/* laptop, turned a little toward Cuso and the camera */}
      <group position={LAPTOP} rotation-y={-0.45}>
        <mesh geometry={GEO.base} material={m.aluminium} position-y={0.02} castShadow receiveShadow />
        <mesh material={m.keyboard} position-y={0.0365} rotation-x={-Math.PI / 2} receiveShadow>
          <planeGeometry args={[0.97, 0.655]} />
        </mesh>
        <mesh material={m.iron} position={[0, 0.036, -0.334]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.011, 0.011, 0.84, 10]} />
        </mesh>
        <group position={[0, 0.036, -0.334]} rotation-x={-0.3}>
          <mesh geometry={GEO.lid} material={m.aluminium} position={[0, 0.33, -0.007]} castShadow />
          <mesh material={m.screen} position={[0, 0.33, 0.0005]}>
            <planeGeometry args={[0.985, 0.645]} />
          </mesh>
          <pointLight ref={glow} position={[0, 0.26, 0.42]} color="#6f86ff" distance={2.4} decay={2} intensity={0} />
        </group>
      </group>

      {/* mug, handle toward the camera, a little steam */}
      <group position={MUG} rotation-y={-1.2}>
        <mesh geometry={GEO.mug} material={m.ceramic} castShadow receiveShadow />
        <mesh position-y={0.235} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.105, 24]} />
          <meshStandardMaterial color="#3a2518" roughness={0.15} />
        </mesh>
        <mesh material={m.ceramic} position={[0.118, 0.145, 0]} rotation-z={-Math.PI / 2} castShadow>
          <torusGeometry args={[0.065, 0.016, 8, 16, Math.PI]} />
        </mesh>
        {[0, Math.PI / 2].map((ry) => (
          <mesh key={ry} material={m.steam} position-y={0.48} rotation-y={ry}>
            <planeGeometry args={[0.16, 0.42]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
