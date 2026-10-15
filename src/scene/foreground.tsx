// A foreground prop: out-of-focus leaves close to the lens, in a bottom
// corner of a chapter's desktop shot, so the shot reads like a photo taken
// from behind a tree. The leaves are painted blurred (right without depth of
// field, and on lite). The quad rides with the camera, so it frames the shot
// wherever the boom or the pointer moves it; it shows only at rest on its shot.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { CanvasTexture, MeshBasicMaterial, Quaternion, SRGBColorSpace, Vector3, type Camera, type Mesh, type PerspectiveCamera } from "three";
import { chapters, type ChapterId, type Vec3 } from "@/content/day";
import { mixHex } from "@/lib/time";
import { DETAIL, damp, dayNow, rig } from "./shared";

export type Prop = {
  /** Picks the leaf layout. */
  seed: number;
  /** Distance from the lens (world units). */
  depth: number;
  /** Height of the quad as a share of the frame's height (its width follows the sprite). */
  height: number;
  /** Share of the quad past the frame's right and bottom edges (the blur fades out off screen). */
  overhang: number;
  opacity: number;
};

/** One prop so far: leaves in the bottom-right corner of the 12:00 shot (Union Square), clear of Cuso, the ad and the card. */
export const FOREGROUNDS: Partial<Record<ChapterId, Prop[]>> = {
  ads: [{ seed: 7, depth: 1, height: 0.28, overhang: 0.06, opacity: 0.96 }],
};

/** The leaf sprite in px, [width, height]: wider than tall, a branch reaching in along the bottom. */
export const SPRITE = [512, 256] as const;

// The leaves' tint by hour, like lightingAt (hours 6..30): they sit in their own shade, lit by the sky.
const KEYS: [number, string][] = [
  [6, "#f0d2b0"],
  [7, "#f0dcc4"],
  [9, "#f2eadc"],
  [12, "#f2efe4"],
  [15, "#f2e8d8"],
  [18, "#e8b892"],
  [22, "#3a4366"],
  [30, "#f0d2b0"],
];

/** The leaves' tint at `hour`. */
export function foregroundAt(hour: number) {
  const h = hour < 6 ? hour + 24 : Math.min(hour, 30);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= h) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  return { tint: mixHex(a, b, Math.min(1, Math.max(0, (h - h0) / (h1 - h0)))) };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const shotPos = new Vector3();
const shotDir = new Vector3();
const camDir = new Vector3();

/**
 * 1 while the camera rests on `shot` (within 0.8, looking its way), 0 from
 * 2.0 away, when it looks elsewhere (a flight passing by) and in Explore.
 * Phone and tablet shots stand farther off, so they never see it.
 */
export function propFade(camera: Camera, shot: { position: Vec3; target: Vec3 }, explore: boolean) {
  if (explore) return 0;
  shotPos.set(...shot.position);
  shotDir.set(...shot.target).sub(shotPos).normalize();
  camera.getWorldDirection(camDir);
  const near = 1 - smoothstep(0.8, 2, camera.position.distanceTo(shotPos));
  return near * smoothstep(0.94, 0.985, camDir.dot(shotDir));
}

const pose = { position: new Vector3(), quaternion: new Quaternion(), width: 1, height: 1 };
const local = new Vector3();

/**
 * Where the quad goes for `camera` (fov and aspect): facing the lens at
 * `prop.depth`, its bottom-right part past the frame's corner. `drift` moves
 * it in the frame (-1..1 of the half frame, scaled small): parallax and wind.
 */
export function propPose(camera: Pick<PerspectiveCamera, "fov" | "aspect" | "position" | "quaternion">, prop: Prop, drift: readonly [number, number] = [0, 0]) {
  const halfH = prop.depth * Math.tan((camera.fov * Math.PI) / 360);
  const halfW = halfH * camera.aspect;
  pose.height = prop.height * 2 * halfH;
  pose.width = (pose.height * SPRITE[0]) / SPRITE[1];
  local.set(
    halfW - pose.width * (0.5 - prop.overhang) + drift[0] * 0.02 * halfW,
    -halfH + pose.height * (0.5 - prop.overhang) + drift[1] * 0.02 * halfH,
    -prop.depth,
  );
  pose.quaternion.copy(camera.quaternion);
  pose.position.copy(local.applyQuaternion(camera.quaternion)).add(camera.position);
  return pose;
}

export type Leaf = { x: number; y: number; r: number; w: number; angle: number; color: string; warm: boolean };

function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Back to front: shade, mid greens, leaves in the light, a few warm sunlit ones.
const SHADE = ["#18241a", "#1f3019", "#28391f"];
const MID = ["#34492a", "#3f562c", "#4a6034"];
const LIT = ["#617a3a", "#738c44"];
const WARM = ["#a39a58", "#b5a866"];

/**
 * The leaves in sprite px (corner at the bottom right): a bough reaching in
 * from the corner in a few sprays. Big, dark and dense at the corner (closest
 * to the lens), single leaves against the light at the tips, the top side
 * catching the sun. Same layout for the same seed.
 */
export function leafLayout(seed: number): Leaf[] {
  const rand = random(seed);
  const [W, H] = SPRITE;
  const pick = (list: string[]) => list[Math.floor(rand() * list.length)];
  const phase = rand() * 6;
  const leaves: Leaf[] = [];
  for (let i = 0; i < 34; i++) {
    // angle from the corner: 0 = along the bottom, 1 = straight up
    const a = rand();
    const theta = (a * Math.PI) / 2;
    const reach = 0.68 + 0.3 * Math.max(0, Math.sin(a * 7 + phase)) + 0.06 * rand();
    const rho = Math.pow(rand(), 0.5) * reach;
    const x = W - Math.cos(theta) * rho * (W - 110);
    const y = H - Math.sin(theta) * rho * (H - 70);
    const r = (42 + rand() * 36) * (1.2 - 0.55 * rho);
    // leaves point out from the bough, give or take
    const angle = Math.atan2(-Math.sin(theta), -Math.cos(theta)) + (rand() - 0.5) * 1.6;
    // deep inside: shade; out at the tips and on top: the light
    const light = rho * 0.75 + a * 0.25 + (rand() - 0.5) * 0.45;
    const color = light < 0.25 ? pick(SHADE) : light < 0.55 ? pick(MID) : rand() < 0.25 ? pick(WARM) : pick(LIT);
    leaves.push({ x, y, r, w: 0.55 + rand() * 0.2, angle, color, warm: WARM.includes(color) });
  }
  const margin = (v: number, r: number, size: number) => Math.min(Math.max(v, size * 0.04 + r), size);
  for (const l of leaves) {
    l.x = margin(l.x, l.r, W);
    l.y = margin(l.y, l.r, H);
  }
  // the light leaves out at the tips first, the dark ones nearest the lens on top
  const order = (l: Leaf) => (SHADE.includes(l.color) ? 2 : MID.includes(l.color) ? 1 : 0);
  return leaves.sort((a, b) => order(a) - order(b));
}

/** Blur in sprite px: the leaves nearest the lens (dark, in the corner) softer than the lit ones farther out. */
const BLUR = { near: 12, far: 7 };

/** One layer of leaves, blurred (by a canvas filter, or a shrink and stretch where that is missing). */
function layer(leaves: Leaf[], blur: number) {
  const [W, H] = SPRITE;
  const sharp = document.createElement("canvas");
  sharp.width = W;
  sharp.height = H;
  const s = sharp.getContext("2d")!;
  for (const l of leaves) {
    s.save();
    s.translate(l.x, l.y);
    s.rotate(l.angle);
    const wide = l.r * l.w;
    s.beginPath();
    s.moveTo(-l.r, 0);
    s.quadraticCurveTo(0, -wide * 1.3, l.r, 0);
    s.quadraticCurveTo(0, wide * 1.3, -l.r, 0);
    s.fillStyle = l.color;
    s.fill();
    if (l.warm) {
      // sun through the canopy: a thin bright rim on the leaf's top edge
      s.clip();
      s.fillStyle = "rgba(240, 232, 190, 0.55)";
      s.beginPath();
      s.ellipse(0, -wide * 0.75, l.r * 0.8, wide * 0.35, 0, 0, Math.PI * 2);
      s.fill();
    }
    s.restore();
  }
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const o = out.getContext("2d")!;
  if ("filter" in CanvasRenderingContext2D.prototype) {
    o.filter = `blur(${blur}px)`;
    o.drawImage(sharp, 0, 0);
  } else {
    const small = document.createElement("canvas");
    small.width = Math.round(W / blur);
    small.height = Math.round(H / blur);
    const m = small.getContext("2d")!;
    m.imageSmoothingQuality = "high";
    m.drawImage(sharp, 0, 0, small.width, small.height);
    o.imageSmoothingQuality = "high";
    o.drawImage(small, 0, 0, W, H);
  }
  return out;
}

/** The leaf sprite: the lit leaves farther out, then the shade and mid greens nearer the lens over them, each pre-blurred. */
export function paintLeaves(seed: number) {
  const leaves = leafLayout(seed);
  const lit = (l: Leaf) => LIT.includes(l.color) || l.warm;
  const out = layer(leaves.filter(lit), BLUR.far);
  out.getContext("2d")!.drawImage(layer(leaves.filter((l) => !lit(l)), BLUR.near), 0, 0);
  return out;
}

function leafTexture(seed: number) {
  const texture = new CanvasTexture(paintLeaves(seed));
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

const OFF = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("look") === "off";
const drift: [number, number] = [0, 0];

/** One prop: always mounted (Ready compiles it), drawn only while it shows. */
function Leaves({ shot, prop }: { shot: { position: Vec3; target: Vec3 }; prop: Prop }) {
  const ref = useRef<Mesh>(null);
  const shown = useRef(0);
  const material = useMemo(() => new MeshBasicMaterial({ map: leafTexture(prop.seed), transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0 }), [prop.seed]);
  useFrame(({ camera, clock }, dt) => {
    const m = ref.current;
    if (!m) return;
    m.layers.set(DETAIL);
    const day = dayNow();
    const goal = OFF ? 0 : propFade(camera, shot, day.mode === "explore");
    shown.current += (goal - shown.current) * damp(4, dt);
    if (goal === 0 && shown.current < 0.005) shown.current = 0;
    m.visible = shown.current > 0;
    if (!m.visible) return;
    material.opacity = shown.current * prop.opacity;
    material.color.set(foregroundAt(day.hour).tint);
    // a little parallax against the pointer, and the leaves stir in the breeze
    const t = clock.elapsedTime;
    drift[0] = -rig.pointer.x + Math.sin(t * 0.7) * 0.3;
    drift[1] = -rig.pointer.y + Math.sin(t * 0.9 + 1) * 0.2;
    const p = propPose(camera as PerspectiveCamera, prop, drift);
    m.position.copy(p.position);
    m.quaternion.copy(p.quaternion);
    m.scale.set(p.width, p.height, 1);
  });
  return (
    <mesh ref={ref} material={material} renderOrder={10} frustumCulled={false} visible={false}>
      <planeGeometry />
    </mesh>
  );
}

/** Every chapter's foreground props, on its desktop shot. */
export function Foreground() {
  return (Object.entries(FOREGROUNDS) as [ChapterId, Prop[]][]).flatMap(([id, props]) =>
    props.map((prop, i) => <Leaves key={`${id}-${i}`} shot={chapters.find((c) => c.id === id)!.camera} prop={prop} />),
  );
}
