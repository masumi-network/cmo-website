// Tree models, pure and seeded (trees.tsx draws them). Four kinds that suit
// San Francisco: London plane and ficus on the streets; Monterey cypress and
// Canary Island date palms join them in the parks. Each kind has a few
// variants, each grown from a seed: a tapered trunk, main limbs and branches
// (bark tubes), and leaf clusters at the branch ends drawn as crossed,
// alpha-tested cards from a leaf atlas (tree-textures.ts), so light comes
// through the gaps. The palm grows arching fronds instead. Every model comes
// near (full detail) and far (cheaper, for distance and phones). All in tree
// units: base at y = 0, scaled by the tree's `s`.

import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3, type Object3D } from "three";
import { heightAt } from "@/lib/terrain";
import { PARKS, groundAt } from "./grid";

export type Tree = { x: number; y: number; z: number; s: number };
export type Kind = "plane" | "ficus" | "cypress" | "palm";
export const KINDS: Kind[] = ["plane", "ficus", "cypress", "palm"];

/** Seeded variants per kind. */
export const VARIANTS = 3;
/** Most triangles all the trees may cost, every one up close (full mode). */
export const TREE_BUDGET = 150_000;
/** Widest a trunk gets at the ground (tree units). */
export const TRUNK_RADIUS = 0.16;
/** Per-tree size jitter across (x against z): 1 ± SPREAD. */
export const SPREAD = 0.1;
/** Nothing grows above this (tree units). */
export const CROWN_TOP = 3.05;
/** How far leaves and branches reach from the trunk's axis (tree units). */
export const CROWN_RADIUS: Record<Kind, number> = { plane: 1.16, ficus: 0.98, cypress: 1.44, palm: 1.42 };
/** Beyond this distance a tree draws its far model. */
export const LOD_DISTANCE = 26;
/** Side of the square tree grate round a street tree's trunk (world units). */
export const PIT = 0.5;

/** Bark atlas: 128 px columns (plane, ficus, cypress, palm, grate), 512 tall, tiling down. */
export const BARK = { width: 640, height: 512, column: 128, grate: 4 };
export const BARK_COLUMN: Record<Kind, number> = { plane: 0, ficus: 1, cypress: 2, palm: 3 };
/** Leaf atlas: 1024 px, a 512 px quadrant per kind (x, y in canvas order). Plane, ficus and cypress hold 2 x 2 cluster sprites; palm two frond strips. */
export const LEAF = { size: 1024, quadrant: { plane: [0, 0], ficus: [1, 0], cypress: [0, 1], palm: [1, 1] } as Record<Kind, [number, number]> };

export const triangles = (g: BufferGeometry) => (g.index?.count ?? g.attributes.position.count) / 3;

/** Stable 0..1 hash of a position. */
const hash = (x: number, z: number, k = 0) => {
  const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

const inPark = (t: Tree) => PARKS.some(([x0, x1, z0, z1]) => t.x > x0 && t.x < x1 && t.z > z0 && t.z < z1);

/** Streets get planes and ficus; parks also get cypress and palms. */
export function kindOf(t: Tree): Kind {
  const r = hash(t.x, t.z);
  if (inPark(t)) return r < 0.3 ? "cypress" : r < 0.55 ? "palm" : r < 0.85 ? "plane" : "ficus";
  return r < 0.6 ? "plane" : "ficus";
}

export const variantOf = (t: Tree) => Math.floor(hash(t.x, t.z, 6) * VARIANTS);

/** Trunk and crown share one transform: turned, a little uneven. Cypresses all lean east, away from the ocean wind. */
export function treePose(t: Tree, kind: Kind, o: Object3D) {
  const a = hash(t.x, t.z, 1);
  const b = hash(t.x, t.z, 2);
  const c = hash(t.x, t.z, 5);
  o.position.set(t.x, t.y, t.z);
  o.rotation.set(0, kind === "cypress" ? (a - 0.5) * 0.8 : a * Math.PI * 2, 0);
  o.scale.set(t.s * (1 - SPREAD + 2 * SPREAD * b), t.s * (0.9 + 0.1 * c), t.s * (1 + SPREAD - 2 * SPREAD * b));
}

/** Street trees (on a sidewalk) stand in a cast-iron grate. */
export const hasPit = (t: Tree) => groundAt(t.x, t.z) === "sidewalk";

/** The grate lies square to the streets, tilted with the sidewalk, just above it. */
export function pitPose(t: Tree, o: Object3D) {
  const e = 0.2;
  const n = new Vector3(heightAt(t.x - e, t.z) - heightAt(t.x + e, t.z), 2 * e, heightAt(t.x, t.z - e) - heightAt(t.x, t.z + e)).normalize();
  o.position.set(t.x, heightAt(t.x, t.z) + 0.012, t.z);
  o.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), n));
  o.scale.set(1, 1, 1);
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type Rand = () => number;

// ---------- Mesh building ----------

const UP = new Vector3(0, 1, 0);
const V = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** Indexed geometry in the making: bark (position, normal, uv, color) or leaves (plus aLeaf: sway, light through the leaf, sky fill). */
class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  leaf: number[] = [];
  idx: number[] = [];
  get count() {
    return this.pos.length / 3;
  }
  vert(p: Vector3, n: Vector3, u: number, v: number, rgb: [number, number, number], sway = 0, scatter = 0, sky = 0) {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.col.push(...rgb.map((c) => Math.min(1, Math.max(0, c))));
    this.leaf.push(sway, scatter, sky);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) {
    this.idx.push(a, b, c);
  }
  geometry(leaves: boolean) {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(this.col, 3));
    if (leaves) g.setAttribute("aLeaf", new Float32BufferAttribute(this.leaf, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** A polyline grown from `from`: bends up (or down, if `up` < 0) and wanders by `gnarl`. */
function grow(rand: Rand, from: Vector3, dir: Vector3, len: number, n: number, up: number, gnarl: number) {
  const pts = [from.clone()];
  const d = dir.clone().normalize();
  const step = len / n;
  for (let i = 0; i < n; i++) {
    d.y += up * step;
    d.x += (rand() - 0.5) * gnarl;
    d.z += (rand() - 0.5) * gnarl;
    d.normalize();
    pts.push(pts[i].clone().addScaledVector(d, step));
  }
  return pts;
}

/** A trunk from below ground up to `height`: plumb where it meets the ground, then leaning and wandering. */
function trunkLine(rand: Rand, height: number, lean: [number, number], gnarl: number, n: number) {
  let wx = 0;
  let wz = 0;
  return Array.from({ length: n + 1 }, (_, i) => {
    const y = -0.3 + (i / n) * (height + 0.3);
    const up = Math.max(0, y - 0.25);
    if (up > 0) {
      wx += (rand() - 0.5) * gnarl;
      wz += (rand() - 0.5) * gnarl;
    }
    return V(lean[0] * Math.max(0, y) ** 1.5 + wx * up, y, lean[1] * Math.max(0, y) ** 1.5 + wz * up);
  });
}

/** The point a fraction f along a polyline (by vertex index). */
function along(pts: Vector3[], f: number) {
  const x = Math.min(0.9999, Math.max(0, f)) * (pts.length - 1);
  const i = Math.floor(x);
  return pts[i].clone().lerp(pts[i + 1], x - i);
}

/** A bark limb: polyline, radius along it (0..1), level (0 trunk, 1 limb, 2 branch). */
type Limb = { pts: Vector3[]; radius: (f: number) => number; level: number };
/** A leaf cluster (crossed cards), or a flat foliage pad (cypress). `rank` decides which survive in the far model. */
type Cluster = { p: Vector3; size: number; rank: number; pad?: number };
/** A broadleaf tree's plan: bark, clusters, and the crown's envelope (for normals and shading). */
type Plan = { kind: Kind; limbs: Limb[]; clusters: Cluster[]; center: Vector3; rx: number; ry: number; bottom: number; top: number };

const barkU = (column: number, f: number) => (column * BARK.column + 2 + f * (BARK.column - 4)) / BARK.width;

/** A tapered tube along a limb, frames carried along it (no twist), bark mapped round and along. */
function tube(m: Mesh, limb: Limb, sides: number, column: number, shade: (p: Vector3) => number, cap = false) {
  const { pts } = limb;
  const n = pts.length;
  const t = new Vector3();
  const nrm = new Vector3();
  const bin = new Vector3();
  const dir = new Vector3();
  const p = new Vector3();
  t.subVectors(pts[1], pts[0]).normalize();
  nrm.set(Math.abs(t.x) > 0.9 ? 0 : 1, 0, Math.abs(t.x) > 0.9 ? 1 : 0);
  const tile = 2 * Math.PI * limb.radius(0) * 4; // the bark tile is four times as tall as wide
  const base = m.count;
  let len = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += pts[i].distanceTo(pts[i - 1]);
    t.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    bin.crossVectors(t, nrm);
    const r = limb.radius(i / (n - 1));
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      dir.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(bin, Math.sin(a));
      p.copy(pts[i]).addScaledVector(dir, r);
      const s = shade(p);
      m.vert(p, dir, barkU(column, j / sides), len / tile, [s, s, s]);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j;
      const c = a + sides + 1;
      m.tri(a, a + 1, c);
      m.tri(a + 1, c + 1, c);
    }
  }
  if (cap) {
    const top = pts[n - 1];
    const s = shade(top);
    const mid = m.vert(top, t, barkU(column, 0.5), len / tile, [s, s, s]);
    const last = base + (n - 1) * (sides + 1);
    for (let j = 0; j < sides; j++) m.tri(last + j, last + j + 1, mid);
  }
}

/** Where a point sits in the crown: 0 at the centre, 1 on the envelope. */
const depthIn = (plan: Plan, p: Vector3) => Math.hypot((p.x - plan.center.x) / plan.rx, (p.y - plan.center.y) / plan.ry, (p.z - plan.center.z) / plan.rx);

/** Bark: darker inside the crown and under it. */
const barkShade = (plan: Plan) => (p: Vector3) => {
  const under = Math.min(1, Math.max(0, (plan.bottom + 0.2 - p.y) / 1.2));
  return p.y < plan.bottom ? 0.72 + 0.28 * under : 0.5 + 0.3 * Math.min(1, depthIn(plan, p));
};

/** Atlas rectangle [u0, v0, u1, v1] of leaf sprite i (0..3) of a kind, or palm frond strip i (0..1). */
function sprite(kind: Kind, i: number): [number, number, number, number] {
  const [qx, qy] = LEAF.quadrant[kind];
  const half = LEAF.size / 2;
  const [x, y, w, h] = kind === "palm" ? [qx * half + i * 256, qy * half, 256, 512] : [qx * half + (i % 2) * 256, qy * half + Math.floor(i / 2) * 256, 256, 256];
  const e = 2;
  return [(x + e) / LEAF.size, 1 - (y + h - e) / LEAF.size, (x + w - e) / LEAF.size, 1 - (y + e) / LEAF.size];
}

/**
 * One leaf card: a square facing roughly `facing`, turned by `roll`. Its
 * normals lean out from the crown's centre (the crown shades as one soft
 * mass); its colour is ambient occlusion (dark deep inside and underneath).
 * A cypress pad's cards are shaded per pad instead: tops face the sky and
 * stay lighter, undersides darker, and sun shines through them from behind,
 * most at the rim; so backlit pads keep their layers.
 * Shrunk if a corner would reach past the crown's bounds.
 */
function card(m: Mesh, plan: Plan, c: Vector3, facing: Vector3, roll: number, size: number, uv: [number, number, number, number], flip: boolean, sway: number, pad?: { y: number; rim: boolean }) {
  const n = facing.clone().normalize();
  const a = new Vector3().crossVectors(n, Math.abs(n.y) > 0.95 ? V(1, 0, 0) : UP).normalize();
  const b = new Vector3().crossVectors(n, a);
  a.multiplyScalar(Math.cos(roll)).addScaledVector(b, Math.sin(roll));
  b.crossVectors(n, a);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const;
  let h = size / 2;
  const at = (sx: number, sy: number) => c.clone().addScaledVector(a, sx * h).addScaledVector(b, sy * h);
  for (let k = 0; k < 4 && corners.some(([sx, sy]) => Math.hypot(at(sx, sy).x, at(sx, sy).z) > CROWN_RADIUS[plan.kind] - 0.005 || at(sx, sy).y > plan.top); k++) h *= 0.8;
  const [u0, v0, u1, v1] = uv;
  const base = m.count;
  for (const [sx, sy] of corners) {
    const p = at(sx, sy);
    const d = depthIn(plan, p);
    const radial = V((p.x - plan.center.x) / plan.rx, (p.y - plan.center.y) / plan.ry, (p.z - plan.center.z) / plan.rx).normalize();
    const own = n.dot(radial) < 0 ? n.clone().negate() : n;
    const normal = pad ? radial.multiplyScalar(0.45).addScaledVector(UP, 0.4).addScaledVector(own, 0.15).normalize() : radial.multiplyScalar(0.72).addScaledVector(own, 0.28).normalize();
    const height = Math.min(1, Math.max(0, (p.y - plan.bottom) / (plan.top - plan.bottom)));
    const outer = Math.min(1, d);
    const ao = pad
      ? 0.55 + 0.22 * outer + 0.13 * height + 0.12 * Math.min(1, Math.max(-1, (p.y - pad.y) / 0.12))
      : 0.3 + 0.5 * outer ** 1.6 + 0.3 * height;
    const warm = Math.max(0, height - 0.7) * 0.25;
    const u = (flip ? -sx : sx) < 0 ? u0 : u1;
    const scatter = pad ? (pad.rim ? 1.2 : 0.8) * (0.5 + 0.5 * outer) : outer;
    m.vert(p, normal, u, sy < 0 ? v0 : v1, [ao * (1 + warm), ao, ao * (0.95 - warm)], outer ** 2 * sway, scatter, pad ? 1 : 0);
  }
  m.tri(base, base + 1, base + 2);
  m.tri(base, base + 2, base + 3);
}

/** A random unit vector. */
const unit = (rand: Rand) => {
  const y = rand() * 2 - 1;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(1 - y * y);
  return V(Math.cos(a) * r, y, Math.sin(a) * r);
};

/**
 * Pulls a plan into its bounds: crown points squeezed towards the trunk's
 * axis and down towards the fork, so nothing (cards included) reaches past
 * CROWN_RADIUS or the kind's top.
 */
function fit(plan: Plan, fork: number, reach: number) {
  const crown = [...plan.limbs.filter((l) => l.level > 0).flatMap((l) => l.pts), ...plan.clusters.map((c) => c.p)];
  const margin = (c: Cluster) => (c.pad ? c.pad + c.size * 0.4 : c.size * 0.72);
  const wide = Math.max(...plan.clusters.map((c) => Math.hypot(c.p.x, c.p.z) + margin(c)), ...crown.map((p) => Math.hypot(p.x, p.z)));
  const tall = Math.max(...plan.clusters.map((c) => c.p.y + c.size * 0.72 - fork));
  const kx = Math.min(1, (reach - 0.01) / wide);
  const ky = Math.min(1, (plan.top - 0.01 - fork) / tall);
  for (const p of new Set(crown)) {
    p.x *= kx;
    p.z *= kx;
    if (p.y > fork) p.y = fork + (p.y - fork) * ky;
  }
  plan.center.x *= kx;
  plan.center.z *= kx;
  plan.rx *= kx;
}

// ---------- Broadleaf plans ----------

/** London plane: a tall clear trunk forking into three or four spreading limbs, leaves in lumps with gaps between. */
function planePlan(rand: Rand): Plan {
  const fork = 1.05 + rand() * 0.15;
  const trunkPts = trunkLine(rand, fork, [(rand() - 0.5) * 0.1, (rand() - 0.5) * 0.1], 0.08, 5);
  const trunk: Limb = { pts: trunkPts, level: 0, radius: (f) => 0.064 + 0.018 * (1 - f) + 0.018 * Math.exp(-Math.max(0, -0.3 + f * (fork + 0.3)) * 8) };
  const limbs: Limb[] = [trunk];
  const nodes: Vector3[] = [];
  const n = rand() < 0.5 ? 3 : 4;
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rand() * 0.8;
    const tilt = 0.6 + rand() * 0.3;
    const dir = V(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
    const pts = grow(rand, along(trunkPts, 0.82 + rand() * 0.16), dir, 0.8 + rand() * 0.25, 4, 0.35, 0.2);
    limbs.push({ pts, level: 1, radius: (f) => 0.05 - 0.028 * f });
    nodes.push(pts[pts.length - 1]);
    const side = V(-dir.z, 0, dir.x).normalize();
    for (let k = 0; k < 3; k++) {
      const s = k % 2 ? 1 : -1;
      const bdir = dir.clone().multiplyScalar(0.6).addScaledVector(side, s * (0.6 + rand() * 0.4)).add(V(0, 0.3 + rand() * 0.4, 0));
      const b = grow(rand, along(pts, 0.35 + k * 0.22 + rand() * 0.1), bdir, 0.35 + rand() * 0.25, 3, 0.4, 0.35);
      limbs.push({ pts: b, level: 2, radius: (f) => 0.02 - 0.011 * f });
      nodes.push(b[b.length - 1]);
    }
  }
  const plan: Plan = { kind: "plane", limbs, clusters: [], center: V(0, fork + 0.75, 0), rx: 1.05, ry: 0.8, bottom: fork - 0.1, top: 2.85 };
  for (const node of nodes) {
    const out = node.clone().sub(plan.center).setY(0).normalize();
    for (let k = 0; k < 7; k++) {
      const p = node.clone().addScaledVector(unit(rand), 0.12 + rand() * 0.2).addScaledVector(out, 0.06).add(V(0, 0.06, 0));
      p.y = Math.max(p.y, fork + 0.25); // the crown keeps its clear trunk
      plan.clusters.push({ p, size: 0.55 + rand() * 0.15, rank: rand() });
    }
  }
  fit(plan, fork, CROWN_RADIUS.plane);
  return plan;
}

/** Ficus: a short smooth trunk, steep limbs, a dense rounded crown (leaf clusters all over a dome). */
function ficusPlan(rand: Rand): Plan {
  const fork = 0.85 + rand() * 0.12;
  const trunkPts = trunkLine(rand, fork, [(rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08], 0.04, 4);
  const limbs: Limb[] = [{ pts: trunkPts, level: 0, radius: (f) => 0.066 + 0.014 * (1 - f) + 0.016 * Math.exp(-Math.max(0, -0.3 + f * (fork + 0.3)) * 8) }];
  const center = V(0, fork + 0.85 + rand() * 0.08, 0);
  const plan: Plan = { kind: "ficus", limbs, clusters: [], center, rx: 0.86, ry: 0.68 + rand() * 0.06, bottom: fork + 0.1, top: 2.68 };
  const n = 4 + Math.floor(rand() * 2);
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + rand() * 0.6;
    const tilt = 0.35 + rand() * 0.3;
    const dir = V(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
    const pts = grow(rand, along(trunkPts, 0.85 + rand() * 0.14), dir, 0.6 + rand() * 0.15, 4, 0.2, 0.15);
    limbs.push({ pts, level: 1, radius: (f) => 0.045 - 0.025 * f });
    for (const s of [-1, 1]) {
      const side = V(-dir.z, 0, dir.x).multiplyScalar(s);
      const b = grow(rand, along(pts, 0.5 + rand() * 0.3), dir.clone().add(side.multiplyScalar(0.8)), 0.35 + rand() * 0.15, 3, 0.3, 0.3);
      limbs.push({ pts: b, level: 2, radius: (f) => 0.018 - 0.009 * f });
    }
  }
  // Clusters on the dome (a golden spiral), a few deeper inside to fill it.
  const N = 86;
  for (let i = 0; i < N; i++) {
    const y = 1 - ((i + 0.5) / N) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996 + rand() * 0.3;
    const d = 0.78 + rand() * 0.2;
    plan.clusters.push({ p: V(Math.cos(a) * r * plan.rx * d, center.y + y * plan.ry * d, Math.sin(a) * r * plan.rx * d), size: 0.46 + rand() * 0.1, rank: rand() });
  }
  for (let i = 0; i < 10; i++) {
    const u = unit(rand);
    plan.clusters.push({ p: V(u.x * plan.rx * 0.45, center.y + Math.abs(u.y) * plan.ry * 0.3, u.z * plan.rx * 0.45), size: 0.4, rank: rand() * 0.4 });
  }
  fit(plan, fork, CROWN_RADIUS.ficus);
  return plan;
}

/**
 * Monterey cypress: a short gnarled trunk leaning east (away from the ocean
 * wind), two to four twisting leaders, near-level branches that end in flat
 * foliage pads, layered, with a flat top.
 */
function cypressPlan(rand: Rand): Plan {
  const trunkPts = trunkLine(rand, 0.55 + rand() * 0.2, [0.25, (rand() - 0.5) * 0.1], 0.35, 5);
  const fork = trunkPts[trunkPts.length - 1].y;
  const limbs: Limb[] = [{ pts: trunkPts, level: 0, radius: (f) => 0.1 + 0.024 * (1 - f) + 0.022 * Math.exp(-Math.max(0, -0.3 + f * (fork + 0.3)) * 8) }];
  const plan: Plan = { kind: "cypress", limbs, clusters: [], center: V(0.2, 1.9, 0), rx: 1.3, ry: 0.85, bottom: 0.9, top: 2.78 };
  const n = rand() < 0.5 ? 3 : 4;
  const pads: [Vector3, number][] = [];
  for (let i = 0; i < n; i++) {
    const yaw = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.8;
    // Leeward (east, +x) leaders reach farther; they rise, then level out.
    const len = (1.55 + rand() * 0.4) * (1 + 0.2 * Math.cos(yaw));
    const tilt = 0.4 + rand() * 0.25;
    const dir = V(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
    const pts = grow(rand, along(trunkPts, 0.7 + rand() * 0.3), dir, len, 6, -0.25, 0.4);
    limbs.push({ pts, level: 1, radius: (f) => 0.075 - 0.05 * f });
    pads.push([pts[pts.length - 1], 0.4 + rand() * 0.1]);
    for (let k = 0; k < 4; k++) {
      const out = yaw + (k % 2 ? 1 : -1) * (0.6 + rand() * 0.7);
      const b = grow(rand, along(pts, 0.3 + k * 0.17 + rand() * 0.06), V(Math.cos(out), 0.1 + rand() * 0.2, Math.sin(out)), 0.3 + rand() * 0.3, 3, -0.15, 0.35);
      limbs.push({ pts: b, level: 2, radius: (f) => 0.024 - 0.013 * f });
      pads.push([b[b.length - 1], 0.36 + rand() * 0.14]);
      pads.push([along(b, 0.4).add(V(0, 0.06, 0)), 0.26 + rand() * 0.1]);
    }
  }
  for (const [p, r] of pads) plan.clusters.push({ p: p.clone(), size: r * 1.15, rank: rand(), pad: r });
  fit(plan, fork, CROWN_RADIUS.cypress);
  // Flat top: the wind shears off whatever grows above the line.
  for (const c of plan.clusters) c.p.y = Math.min(c.p.y, plan.top - 0.14 - rand() * 0.06);
  return plan;
}

/** Leaves and bark of a broadleaf plan. Far: trunk and limbs only, a third of the clusters, fewer and bigger cards. */
function build(plan: Plan, rand: Rand, far: boolean) {
  const bark = new Mesh();
  const leaves = new Mesh();
  const shade = barkShade(plan);
  const col = BARK_COLUMN[plan.kind];
  for (const l of plan.limbs) {
    if (far && l.level > 1) continue;
    const sides = far ? [6, 4][l.level] : [8, 6, 4][l.level];
    const pts = far && l.level === 1 ? l.pts.filter((_, i) => i % 2 === 0 || i === l.pts.length - 1) : l.pts;
    tube(bark, { ...l, pts }, sides, col, shade, l.level === 0);
  }
  // Far: a few big cards instead of many (pads are fewer and bigger: keep more of them).
  const keep = far ? plan.clusters.filter((c) => c.rank < (c.pad ? 0.6 : 0.42)) : plan.clusters;
  for (const c of keep) {
    const pick = () => sprite(plan.kind, Math.floor(rand() * 4));
    if (c.pad) {
      // A flat pad: near-level cards in a loose layer, more tipped out round the rim (seen from the side).
      const n = far ? 4 : 8;
      const flat = far ? 2 : 4;
      for (let k = 0; k < n; k++) {
        const a = rand() * Math.PI * 2;
        const r = c.pad * (k === 0 ? 0 : 0.3 + rand() * 0.4);
        const p = c.p.clone().add(V(Math.cos(a) * r, (rand() - 0.5) * 0.08, Math.sin(a) * r));
        const out = V(Math.cos(a), 0, Math.sin(a));
        const facing = k >= flat ? UP.clone().addScaledVector(out, 0.9 + rand() * 1.2) : UP.clone().add(unit(rand).multiplyScalar(0.3));
        card(leaves, plan, p, facing, rand() * Math.PI * 2, c.size * (far ? 1.5 : 1) * (0.85 + rand() * 0.3), pick(), rand() < 0.5, 0.6, { y: c.p.y, rim: k >= flat });
      }
      continue;
    }
    const out = c.p.clone().sub(plan.center).normalize();
    const n = far ? 2 : 3;
    for (let k = 0; k < n; k++) {
      const facing = out.clone().add(unit(rand).multiplyScalar(0.9));
      const p = c.p.clone().addScaledVector(out, (k - 1) * 0.05).add(unit(rand).multiplyScalar(0.04));
      card(leaves, plan, p, facing, rand() * Math.PI * 2, c.size * (far ? 1.45 : 1) * (0.88 + rand() * 0.24), pick(), rand() < 0.5, 0.8);
    }
  }
  return { bark: bark.geometry(false), leaves: leaves.geometry(true) };
}

// ---------- Canary Island date palm ----------

/** The palm's crown sits here (tree units), the fronds spring from just below it. */
const PALM_TOP = 2.2;

/**
 * Canary Island date palm: a thick straight trunk wearing the diamond
 * leaf-base pattern, a pineapple knob, and a full crown of arching pinnate
 * fronds in three tiers (rising, spreading, drooping and yellowing).
 */
function palm(rand: Rand, far: boolean) {
  const bark = new Mesh();
  const leaves = new Mesh();
  const lean = V((rand() - 0.5) * 0.12, 1, (rand() - 0.5) * 0.12).normalize();
  const rings = far ? 7 : 12;
  const pts = Array.from({ length: rings + 1 }, (_, i) => {
    const y = -0.3 + (i / rings) * (PALM_TOP + 0.38);
    const k = Math.max(0, y) / PALM_TOP;
    return V(lean.x * y + 0.04 * k * k * Math.sign(lean.x), y, lean.z * y);
  });
  const top = pts[rings];
  const radius = (f: number) => {
    const y = -0.3 + f * (PALM_TOP + 0.38);
    const knob = Math.exp(-(((y - PALM_TOP + 0.08) / 0.16) ** 2)) * 0.05;
    const close = y > PALM_TOP + 0.1 ? (y - PALM_TOP - 0.1) * 0.9 : 0;
    return Math.max(0.03, 0.128 + 0.022 * Math.exp(-Math.max(0, y) * 5) - 0.008 * (y / PALM_TOP) + knob - close);
  };
  const shade = (p: Vector3) => (p.y > PALM_TOP - 0.25 ? 0.55 : 0.82 + 0.18 * Math.min(1, Math.max(0, (PALM_TOP - 0.4 - p.y) / 1.5)));
  tube(bark, { pts, radius, level: 0 }, far ? 7 : 10, BARK_COLUMN.palm, shade, true);

  const crown = top.clone().add(V(0, -0.06, 0));
  const count = far ? 14 : 26;
  const seg = far ? 5 : 8;
  const fronds = Array.from({ length: count }, (_, i) => {
    const tier = i % 3; // 0 rising, 1 spreading, 2 drooping
    return {
      yaw: i * 2.39996 + rand() * 0.25,
      elev: [0.8 + rand() * 0.3, 0.3 + rand() * 0.25, -0.05 + rand() * 0.2][tier],
      len: [0.85 + rand() * 0.15, 1.05 + rand() * 0.15, 0.95 + rand() * 0.15][tier],
      droop: [0.55, 0.85, 1.1][tier],
      tier,
    };
  });
  if (!far) for (let k = 0; k < 3; k++) fronds.push({ yaw: rand() * 6.28, elev: 1.3, len: 0.45, droop: 0.2, tier: 0 });
  // Squeeze every frond so the drooping tips stay inside the crown's radius.
  const reach = CROWN_RADIUS.palm - 0.02;
  for (const fr of fronds) {
    const dir = V(Math.cos(fr.elev) * Math.cos(fr.yaw), Math.sin(fr.elev), Math.cos(fr.elev) * Math.sin(fr.yaw));
    const p = crown.clone();
    const side = new Vector3();
    const keel = new Vector3();
    const base = leaves.count;
    const width = 0.2 + rand() * 0.03;
    const strip = sprite("palm", rand() < 0.5 ? 0 : 1);
    const old = fr.tier === 2 ? 0.25 + rand() * 0.25 : rand() * 0.08;
    p.addScaledVector(dir, 0.08);
    const path: Vector3[] = [];
    const dirs: Vector3[] = [];
    for (let i = 0; i <= seg; i++) {
      path.push(p.clone());
      dirs.push(dir.clone());
      p.addScaledVector(dir, fr.len / seg);
      dir.y -= fr.droop * (fr.len / seg) * (1.2 - fr.elev * 0.5);
      dir.normalize();
    }
    const far1 = Math.max(...path.map((q) => Math.hypot(q.x, q.z) + width * 0.6));
    const k = Math.min(1, reach / far1);
    const high = Math.max(...path.map((q) => q.y + width * 0.6));
    const ky = Math.min(1, (2.97 - crown.y) / (high - crown.y));
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const q = path[i];
      q.x = top.x + (q.x - top.x) * k;
      q.z = top.z + (q.z - top.z) * k;
      q.y = crown.y + (q.y - crown.y) * ky;
      side.crossVectors(dirs[i], UP).normalize();
      keel.crossVectors(side, dirs[i]).normalize();
      const w = width * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) ** 0.6);
      const ao = (0.45 + 0.55 * Math.min(1, t * 1.6)) * (fr.tier === 2 ? 0.82 : 1);
      const rgb: [number, number, number] = [ao * (1 + old * 0.35), ao * (1 - old * 0.05), ao * (1 - old * 0.55)];
      const sway = Math.min(1.5, t * t * 1.3);
      for (const s of [-1, 0, 1]) {
        // The leaflets rise in a V either side of the midrib.
        const v = q.clone().addScaledVector(side, s * w).addScaledVector(keel, Math.abs(s) * w * 0.55);
        const lift = keel.clone().addScaledVector(side, -s * 0.45).normalize();
        const radial = v.clone().sub(crown).normalize();
        const normal = lift.multiplyScalar(0.6).addScaledVector(radial, 0.4).normalize();
        leaves.vert(v, normal, strip[0] + ((s + 1) / 2) * (strip[2] - strip[0]), strip[1] + t * (strip[3] - strip[1]), rgb, sway, t);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i * 3;
      const b = a + 3;
      leaves.tri(a, a + 1, b + 1);
      leaves.tri(a, b + 1, b);
      leaves.tri(a + 1, a + 2, b + 2);
      leaves.tri(a + 1, b + 2, b + 1);
    }
  }
  return { bark: bark.geometry(false), leaves: leaves.geometry(true) };
}

// ---------- All models ----------

export type Model = { bark: BufferGeometry; leaves: BufferGeometry };
export type Variant = { near: Model; far: Model };

const PLANS: Record<Exclude<Kind, "palm">, (rand: Rand) => Plan> = { plane: planePlan, ficus: ficusPlan, cypress: cypressPlan };

/** Every kind's variants, near and far, seeded (the same every time). */
export function treeModels(): Record<Kind, Variant[]> {
  return Object.fromEntries(
    KINDS.map((kind, k) => [
      kind,
      Array.from({ length: VARIANTS }, (_, v): Variant => {
        const seed = 101 + k * 17 + v * 7;
        if (kind === "palm") return { near: palm(seeded(seed), false), far: palm(seeded(seed), true) };
        const plan = PLANS[kind](seeded(seed));
        return { near: build(plan, seeded(seed + 1), false), far: build(plan, seeded(seed + 1), true) };
      }),
    ]),
  ) as Record<Kind, Variant[]>;
}

/** The tree grate: one square, mapped to the grate in the bark atlas. */
export function pitGeometry() {
  const m = new Mesh();
  const h = PIT / 2;
  const u0 = (BARK.grate * BARK.column + 2) / BARK.width;
  const u1 = ((BARK.grate + 1) * BARK.column - 2) / BARK.width;
  const v0 = 1 - (BARK.column - 2) / BARK.height;
  const v1 = 1 - 2 / BARK.height;
  for (const [x, z, u, v] of [[-h, h, u0, v0], [h, h, u1, v0], [h, -h, u1, v1], [-h, -h, u0, v1]]) m.vert(V(x, 0, z), UP, u, v, [1, 1, 1]);
  m.tri(0, 1, 2);
  m.tri(0, 2, 3);
  return m.geometry(false);
}
