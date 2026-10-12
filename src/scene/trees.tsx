"use client";

// Street and park trees, placed by layout.ts. Four kinds that suit San
// Francisco: London plane and ficus on the streets; Monterey cypress and
// Canary Island date palms join them in the parks. Each kind is two instanced
// meshes (trunk, foliage). Canopies are merged lumps with displaced vertices
// and soft normals, shaded darker inside and below, with a leaf texture
// mapped in tree space (triplanar). All geometry is in tree units: base at
// y = 0, scaled by the tree's `s`.

import { useEffect, useMemo } from "react";
import {
  BufferGeometry,
  CanvasTexture,
  ClampToEdgeWrapping,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { PARKS } from "./layout";
import { Instances } from "./parts";

export type Tree = { x: number; y: number; z: number; s: number };
export type Kind = "plane" | "ficus" | "cypress" | "palm";
export const KINDS: Kind[] = ["plane", "ficus", "cypress", "palm"];

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

// ---------- Foliage ----------

/** A lump of leaves: centre, radius, vertical squash. */
type Lump = [x: number, y: number, z: number, r: number, sy: number];

function ring(rand: () => number, n: number, dist: number, y: number, r: number, sy = 1, dx = 0): Lump[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rand() * 0.7;
    const d = dist * (0.85 + rand() * 0.3);
    return [dx + Math.cos(a) * d, y + (rand() - 0.5) * 0.3, Math.sin(a) * d, r * (0.85 + rand() * 0.3), sy];
  });
}

/** Smooth bumps over a unit sphere, different per lump. */
const bumpAt = (x: number, y: number, z: number, k: number) =>
  Math.sin(x * 3.7 + k * 1.3) * Math.sin(y * 4.1 + k * 2.1) * Math.sin(z * 3.3 + k * 0.7) + 0.5 * Math.sin((x + z) * 6.3 + y * 5.1 + k);

/**
 * Merged, displaced lumps. Normals blend each lump's own normal with the
 * direction from the canopy centre, so the canopy shades as one soft mass
 * with clumps. Vertex colours are ambient occlusion: dark inside and below,
 * a touch warmer on top.
 */
function canopy(lumps: Lump[], bump: number): BufferGeometry {
  const parts = lumps.map(() => new IcosahedronGeometry(1, 2));
  const center = new Vector3();
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const [x, y, z, r, sy] of lumps) {
    center.x += x / lumps.length;
    center.z += z / lumps.length;
    minY = Math.min(minY, y - r * sy);
    maxY = Math.max(maxY, y + r * sy);
  }
  center.y = minY + (maxY - minY) * 0.42;
  const w = new Vector3();
  const n = new Vector3();
  const out = new Vector3();
  parts.forEach((g, k) => {
    const [x, y, z, r, sy] = lumps[k];
    const p = g.attributes.position;
    const normals = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i);
      const uy = p.getY(i);
      const uz = p.getZ(i);
      const d = r * (1 + bump * 0.6 * bumpAt(ux, uy, uz, k + 1));
      w.set(x + ux * d, y + uy * d * sy, z + uz * d);
      p.setXYZ(i, w.x, w.y, w.z);
      maxR = Math.max(maxR, w.distanceTo(center));
      n.set(ux, uy / sy, uz).normalize();
      out.subVectors(w, center).normalize().multiplyScalar(1.6).add(n).normalize();
      normals.set([out.x, out.y, out.z], i * 3);
    }
    g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  });
  const merged = mergeGeometries(parts);
  const per = parts[0].attributes.position.count;
  parts.forEach((g) => g.dispose());
  const geo = dropHidden(merged, lumps, per, 1 - bump * 0.9);
  merged.dispose();
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    w.fromBufferAttribute(p, i);
    const h = (w.y - minY) / (maxY - minY);
    const depth = w.distanceTo(center) / maxR;
    const ao = 0.5 + 0.5 * Math.min(1, Math.max(0, h * 0.7 + depth * 0.45));
    const warm = Math.max(0, h - 0.6) * 0.25;
    colors.set([ao * (0.9 + warm), ao, ao * (0.88 - warm * 0.5)], i * 3);
  }
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geo;
}

/**
 * Drops triangles buried inside another lump (about a third of them): fewer
 * to draw, and no hidden surfaces to catch shadows. Lump k owns vertices
 * [k * per, (k + 1) * per).
 */
function dropHidden(geo: BufferGeometry, lumps: Lump[], per: number, margin: number) {
  const p = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  const inside = (i: number) =>
    lumps.some(([x, y, z, r, sy], j) => j !== Math.floor(i / per) && (p[i * 3] - x) ** 2 + ((p[i * 3 + 1] - y) / sy) ** 2 + (p[i * 3 + 2] - z) ** 2 < (r * margin) ** 2);
  const pos: number[] = [];
  const nor: number[] = [];
  for (let t = 0; t < p.length / 9; t++) {
    const v = [t * 3, t * 3 + 1, t * 3 + 2];
    if (v.every(inside)) continue;
    for (const i of v) {
      pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      nor.push(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]);
    }
  }
  const out = new BufferGeometry();
  out.setAttribute("position", new Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  return out;
}

// ---------- Trunks ----------

/** A tapered limb from `at`, tilted out by `tilt` towards `yaw`. */
function limb(r0: number, r1: number, len: number, tilt: number, yaw: number, at: [number, number, number]) {
  return new CylinderGeometry(r1, r0, len, 7, 1, true).translate(0, len / 2, 0).rotateZ(-tilt).rotateY(-yaw).translate(...at).toNonIndexed();
}

/** A trunk with limbs reaching up into the canopy. */
function branched(r: number, height: number, limbs: [tilt: number, yaw: number, len: number, at: number][], lean = 0) {
  const trunk = new CylinderGeometry(r * 0.75, r, height + 0.3, 8, 1, true).translate(0, height / 2 - 0.15, 0).rotateZ(-lean).toNonIndexed();
  const top = Math.sin(lean);
  return mergeGeometries([trunk, ...limbs.map(([tilt, yaw, len, at]) => limb(r * 0.55, r * 0.3, len, tilt, yaw, [top * at, at, 0]))]);
}

const PALM_TOP = new Vector3(0.2, 2.3, 0);
const palmBend = (y: number) => 0.035 * Math.max(0, y) ** 2;

/** Canary Island date palm: stout, ringed, a little bent, with a crown knob. */
function palmTrunk() {
  const profile: Vector2[] = [];
  for (let i = 0; i <= 48; i++) {
    const y = -0.3 + (i / 48) * (PALM_TOP.y + 0.3);
    const rings = 0.012 * Math.abs(Math.sin(y * Math.PI * 7));
    profile.push(new Vector2(0.12 + 0.06 * Math.exp(-(y + 0.3) * 3) + rings, y));
  }
  const trunk = new LatheGeometry(profile, 10).toNonIndexed();
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + palmBend(p.getY(i)));
  const knob = new IcosahedronGeometry(0.19, 2).scale(1, 0.75, 1).translate(PALM_TOP.x, PALM_TOP.y, 0);
  return mergeGeometries([trunk, knob]);
}

/**
 * Palm fronds: arching strips folded into a shallow V, uv across (u) and
 * along (v) for the leaflet texture. Vertex colours darken the base.
 */
function fronds(): BufferGeometry {
  const rand = seeded(7);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const side = new Vector3();
  const keel = new Vector3();
  const p = new Vector3();
  const SEG = 8;
  const N = 18;
  for (let f = 0; f < N; f++) {
    const yaw = (f / N) * Math.PI * 2 + rand() * 0.3;
    const high = f % 2 === 0;
    const elev = (high ? 0.6 : 0.12) + rand() * 0.25;
    const len = (high ? 0.95 : 1.15) + rand() * 0.2;
    p.copy(PALM_TOP).y += 0.05;
    dir.set(Math.cos(elev) * Math.cos(yaw), Math.sin(elev), Math.cos(elev) * Math.sin(yaw));
    const base = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const t = i / SEG;
      const width = 0.2 * Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.95)) ** 0.7 + 0.008;
      side.crossVectors(dir, up).normalize();
      keel.crossVectors(side, dir).normalize();
      for (const s of [1, 0, -1]) {
        pos.push(p.x + side.x * width * s + keel.x * width * 0.45 * Math.abs(s), p.y + side.y * width * s + keel.y * width * 0.45 * Math.abs(s), p.z + side.z * width * s + keel.z * width * 0.45 * Math.abs(s));
        uv.push((1 - s) / 2, t);
        const shade = 0.6 + 0.4 * Math.min(1, t * 1.6);
        col.push(shade, shade, shade);
      }
      p.addScaledVector(dir, len / SEG);
      dir.y -= 0.34 * (len / SEG) * (1.6 - elev);
      dir.normalize();
    }
    for (let i = 0; i < SEG; i++) {
      const a = base + i * 3;
      const b = a + 3;
      idx.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Trunk and foliage geometry for every kind, in tree units. */
export function treeGeometries(): Record<Kind, { trunk: BufferGeometry; crown: BufferGeometry }> {
  const rand = seeded(3);
  return {
    // Broad and open, lumpy, on a tall clear trunk.
    plane: {
      trunk: branched(0.1, 1.45, [[0.5, 0, 0.75, 1.1], [0.55, 2.2, 0.7, 1.2], [0.45, 4.2, 0.7, 1.15]]),
      crown: canopy([[0, 1.95, 0, 0.8, 1], ...ring(rand, 4, 0.55, 1.8, 0.58), ...ring(rand, 2, 0.3, 2.3, 0.55)], 0.18),
    },
    // Dense, round and low, clipped like SF street ficus.
    ficus: {
      trunk: branched(0.1, 1.2, [[0.45, 0.6, 0.55, 0.95], [0.5, 3.6, 0.5, 1.0]]),
      crown: canopy([[0, 1.75, 0, 0.8, 1], ...ring(rand, 4, 0.4, 1.62, 0.55), [0, 2.1, 0, 0.6, 1]], 0.1),
    },
    // Wind-shaped: wide, flat-topped tiers leaning east.
    cypress: {
      trunk: branched(0.13, 1.55, [[0.75, 0, 0.8, 1.0], [0.7, 2.6, 0.7, 1.1], [0.35, 4.6, 0.75, 1.25]], 0.12),
      crown: canopy([[0.15, 1.75, 0, 0.62, 0.55], ...ring(rand, 5, 0.7, 1.7, 0.55, 0.55, 0.1), ...ring(rand, 3, 0.45, 2.25, 0.5, 0.6, 0.3), [0.4, 2.55, 0, 0.42, 0.6]], 0.2),
    },
    palm: { trunk: palmTrunk(), crown: fronds() },
  };
}

// ---------- Textures (canvas, drawn once) ----------

function canvasTexture(size: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = NoColorSpace; // shade data: multiplied onto the tint
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

/** Overlapping leaves with soft shadows, tileable, grey (tinted per tree). */
function leafTexture() {
  const S = 256;
  return canvasTexture(S, S, (ctx) => {
    const rand = seeded(11);
    ctx.fillStyle = "rgb(110,110,110)";
    ctx.fillRect(0, 0, S, S);
    for (let i = 0; i < 650; i++) {
      const x = rand() * S;
      const y = rand() * S;
      const a = rand() * Math.PI;
      const l = 10 + rand() * 9;
      const v = Math.round(165 + rand() * 70);
      for (const ox of [-S, 0, S]) {
        for (const oy of [-S, 0, S]) {
          ctx.save();
          ctx.translate(x + ox, y + oy);
          ctx.rotate(a);
          ctx.fillStyle = "rgba(40,40,40,0.28)";
          ctx.beginPath();
          ctx.ellipse(1.5, 2.5, l, l * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.beginPath();
          ctx.ellipse(0, 0, l, l * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  });
}

/** Bark: vertical fissures and a few pale patches (tinted per kind). */
function barkTexture() {
  const W = 128;
  const H = 256;
  const texture = canvasTexture(W, H, (ctx) => {
    const rand = seeded(5);
    ctx.fillStyle = "rgb(205,205,205)";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const v = Math.round(215 + rand() * 40);
      ctx.fillStyle = `rgba(${v},${v},${v},0.7)`;
      const x = rand() * W;
      const y = rand() * H;
      for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) ctx.fillRect(x + ox, y + oy, 10 + rand() * 18, 16 + rand() * 30);
    }
    ctx.strokeStyle = "rgba(70,70,70,0.6)";
    for (let i = 0; i < 40; i++) {
      let x = rand() * W;
      ctx.lineWidth = 1 + rand() * 2.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= H; y += 16) {
        x += (rand() - 0.5) * 6;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  texture.repeat.set(2, 2);
  return texture;
}

/** One palm frond seen flat: a midrib with leaflets angled to the tip. */
function frondTexture() {
  const W = 128;
  const H = 256;
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgb(235,235,235)";
    ctx.lineCap = "round";
    ctx.lineWidth = 5;
    for (let y = H + 20; y > 0; y -= 8) {
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(W / 2, y);
        ctx.lineTo(W / 2 + s * (W / 2 - 3), y - 26);
        ctx.stroke();
      }
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgb(200,200,170)";
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
  });
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

/** Foliage: the leaf texture sampled in tree space on three planes. */
function leafMaterial(leaf: CanvasTexture) {
  const material = new MeshStandardMaterial({ roughness: 0.88, vertexColors: true });
  material.customProgramCacheKey = () => "tree-leaves";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLeaf = { value: leaf };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLeafP;\nvarying vec3 vLeafN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLeafP = position;\nvLeafN = normal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D uLeaf;\nvarying vec3 vLeafP;\nvarying vec3 vLeafN;")
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec3 lw = pow(abs(normalize(vLeafN)), vec3(4.0));
        lw /= lw.x + lw.y + lw.z;
        vec3 lp = vLeafP * 0.9;
        float leaf = texture2D(uLeaf, lp.zy).r * lw.x + texture2D(uLeaf, lp.xz).r * lw.y + texture2D(uLeaf, lp.xy).r * lw.z;
        diffuseColor.rgb *= leaf;`,
      );
  };
  return material;
}

// ---------- Placement and colour ----------

const LEAF: Record<Kind, string> = { plane: "#7d9e63", ficus: "#5f8a4e", cypress: "#4f6f55", palm: "#8fa45e" };
const BARK: Record<Kind, string> = { plane: "#b3ab92", ficus: "#8f8878", cypress: "#6e5848", palm: "#97805f" };
const tint = new Color();

/** One transform for trunk and foliage: turned, a little uneven in size. */
function pose(t: Tree, o: Object3D) {
  const a = hash(t.x, t.z, 1);
  const b = hash(t.x, t.z, 2);
  o.position.set(t.x, t.y, t.z);
  o.rotation.y = a * Math.PI * 2;
  o.scale.set(t.s * (0.9 + b * 0.2), t.s * (0.92 + a * 0.16), t.s * (1.1 - b * 0.2));
}

const placers = (palette: Record<Kind, string>, k: Kind, hue: number, light: number) => (t: Tree, o: Object3D) => {
  pose(t, o);
  const h = hash(t.x, t.z, 3) - 0.5;
  const l = hash(t.x, t.z, 4) - 0.5;
  return `#${tint.set(palette[k]).offsetHSL(h * hue, h * 0.06, l * light).getHexString()}`;
};
const PLACE = Object.fromEntries(KINDS.map((k) => [k, { trunk: placers(BARK, k, 0.02, 0.06), crown: placers(LEAF, k, 0.05, 0.08) }])) as Record<
  Kind,
  { trunk: (t: Tree, o: Object3D) => string; crown: (t: Tree, o: Object3D) => string }
>;

export function Trees({ trees }: { trees: Tree[] }) {
  const byKind = useMemo(() => Object.fromEntries(KINDS.map((k) => [k, trees.filter((t) => kindOf(t) === k)])) as Record<Kind, Tree[]>, [trees]);
  const geos = useMemo(() => treeGeometries(), []);
  const mats = useMemo(() => {
    const leaf = leafTexture();
    return {
      textures: [leaf],
      bark: new MeshStandardMaterial({ map: barkTexture(), roughness: 1 }),
      leaves: leafMaterial(leaf),
      fronds: new MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.45, side: DoubleSide, vertexColors: true, roughness: 0.85 }),
    };
  }, []);
  useEffect(
    () => () => {
      for (const g of Object.values(geos)) [g.trunk, g.crown].forEach((x) => x.dispose());
      mats.textures.forEach((t) => t.dispose());
      mats.bark.map?.dispose();
      mats.fronds.map?.dispose();
      [mats.bark, mats.leaves, mats.fronds].forEach((m) => m.dispose());
    },
    [geos, mats],
  );
  return (
    <>
      {KINDS.filter((k) => byKind[k].length > 0).map((k) => (
        <group key={k}>
          <Instances items={byKind[k]} geometry={geos[k].trunk} material={mats.bark} place={PLACE[k].trunk} />
          <Instances items={byKind[k]} geometry={geos[k].crown} material={k === "palm" ? mats.fronds : mats.leaves} place={PLACE[k].crown} />
        </group>
      ))}
    </>
  );
}
