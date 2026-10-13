"use client";

// Downtown and SoMa towers. Placement, footprint, height and tiers come from
// layout.ts; this file decides what each one looks like and builds the whole
// skyline as one merged mesh (one draw call) for `downtownMaterial`.
//
// Three kinds, base / shaft / crown:
// - deco: 1920s limestone or terracotta, a tall lobby, inset shaft, cornices,
//   a pyramid, stepped or flat crown (flat ones carry a penthouse and a water tank).
// - glass: curtain wall with mullions and spandrels, a recessed glazed lobby,
//   metal bands at setbacks, a sloped top or a crisp parapet with a plant room.
// - loft: SoMa brick or concrete mid-rise with big windows, shops below, a
//   parapet with a coping and often a wooden water tank.

import { useMemo } from "react";
import { BufferGeometry, Color, Float32BufferAttribute } from "three";
import type { Textures } from "./city";
import type { Tower } from "./layout";
import { FOOTING, downtownMaterial } from "./materials";

export const STYLES = ["deco", "glass", "loft"] as const;
export type Style = (typeof STYLES)[number];
/** Rooftop parts (parapets, tanks, plant rooms, masts) rise at most this far over a tower's height. */
export const ROOF_MARGIN = 1;

/** Surface kinds, read by the shader from `aInfo.x`. */
export const PART = { glass: 0, windows: 1, storefront: 2, plain: 3, metal: 4 } as const;

type V3 = [number, number, number];
/** Wall grid: column width and storey height (both fitted to the wall), counted from y0. */
type Grid = { col: number; storey: number; y0: number };
export type Piece = {
  shape: "box" | "pyramid" | "wedge" | "cylinder" | "cone";
  min: V3;
  max: V3;
  part: number;
  color: string;
  grid?: Grid;
  /** Wedge: which side is high (+1 = +x). */
  high?: 1 | -1;
  /** Rooftop item id; the pieces of one item (a tank's legs, barrel and lid) share it. */
  group?: number;
  /** Floodlit tower: height of the lights that wash its crown at night. */
  flood?: number;
};

const hash = (x: number, z: number, k: number) => {
  const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

const BRICK = ["#9e6450", "#8c5a4a", "#d6cbb8", "#b9b2a6"];
const DECO = ["#e3d9c8", "#d9c9b0", "#e6d3b8", "#d6cbb7"];

/** What a tower looks like, from its own data (seeded by position). */
export function towerStyle(t: Tower) {
  const r = (k: number) => hash(t.x, t.z, k);
  const style: Style = t.h < 13 ? "loft" : t.glass ? "glass" : "deco";
  const crown =
    style === "deco" ? (["pyramid", "stepped", "flat"] as const)[Math.floor(r(19) * 3)] : style === "glass" && r(1) < 0.5 ? "slope" : "flat";
  const color = style === "glass" ? t.color : style === "loft" ? BRICK[Math.floor(r(3) * BRICK.length)] : DECO[Math.floor(r(3) * DECO.length)];
  return {
    style,
    crown,
    color,
    /** Cornices, copings, belt courses. */
    trim: style === "glass" ? "#9a9fa4" : style === "loft" ? "#d9d2c4" : "#eee6d8",
    /** Footing and ground floor frame. */
    base: style === "glass" ? "#7d8287" : style === "loft" ? "#56524e" : "#b2a895",
    /** Ground storey height (deco lobbies are tall). */
    ground: style === "loft" ? 1.7 : 2.1,
    /** Facade grid: column width and storey height. */
    col: style === "glass" ? 0.55 : style === "loft" ? 1.15 : 0.9,
    storey: style === "glass" ? 1.05 : style === "loft" ? 1.4 : 1.25,
    /** Shop or lobby bay width. */
    bay: style === "glass" ? 1.4 : style === "loft" ? 1.0 : 1.15,
    /** How far the shaft sits inside the cornice line. */
    inset: style === "glass" ? 0.04 : 0.08,
    tank: style !== "glass" && crown === "flat" && r(2) < 0.7,
    corner: Math.floor(r(4) * 4),
    high: (r(5) < 0.5 ? 1 : -1) as 1 | -1,
  };
}

/** Stone crowns that get a warm floodlight at night: the two tallest with a pyramid or stepped top. */
export function floodlit(towers: Tower[]) {
  const deco = towers.filter((t) => towerStyle(t).style === "deco");
  const carved = (t: Tower) => (towerStyle(t).crown === "flat" ? 0 : 1);
  return new Set([...deco].sort((a, b) => carved(b) - carved(a) || b.h - a.h).slice(0, 2));
}

type Rect = { x0: number; x1: number; z0: number; z1: number };
const rect = (x: number, z: number, w: number, d: number): Rect => ({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
const shrink = (r: Rect, by: number): Rect => ({ x0: r.x0 + by, x1: r.x1 - by, z0: r.z0 + by, z1: r.z1 - by });
const scaled = (r: Rect, s: number): Rect => rect((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, (r.x1 - r.x0) * s, (r.z1 - r.z0) * s);

/** Every piece of one tower, in world units. */
export function towerPieces(t: Tower, flood: boolean): Piece[] {
  const s = towerStyle(t);
  const out: Piece[] = [];
  let group = 0;
  const box = (r: Rect, y0: number, y1: number, part: number, color: string, extra: Partial<Piece> = {}) =>
    out.push({ shape: "box", min: [r.x0, y0, r.z0], max: [r.x1, y1, r.z1], part, color, ...extra });
  /** A cornice or parapet: four walls of thickness `th` around the edge of r. */
  const ring = (r: Rect, y0: number, y1: number, th: number, part: number, color: string) => {
    box({ ...r, z1: r.z0 + th }, y0, y1, part, color);
    box({ ...r, z0: r.z1 - th }, y0, y1, part, color);
    box({ ...r, x1: r.x0 + th, z0: r.z0 + th, z1: r.z1 - th }, y0, y1, part, color);
    box({ ...r, x0: r.x1 - th, z0: r.z0 + th, z1: r.z1 - th }, y0, y1, part, color);
  };
  /** Parapet with a lighter coping, sitting on the edge of a roof at y. */
  const parapet = (r: Rect, y: number, below: number, above: number, th: number) => {
    const glass = s.style === "glass";
    ring(r, y - below, y + above - (glass ? 0 : 0.05), th, glass ? PART.metal : PART.plain, glass ? s.trim : s.style === "loft" ? s.color : s.trim);
    if (!glass) ring(r, y + above - 0.05, y + above, th, PART.plain, s.trim);
  };
  /** A wooden water tank on legs with a conical lid (about 0.86 tall). */
  const tank = (x: number, z: number, y: number) => {
    const g = ++group;
    const r = 0.3;
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(rect(x + dx * 0.19, z + dz * 0.19, 0.05, 0.05), y, y + 0.24, PART.metal, "#46433f", { group: g });
    out.push({ shape: "cylinder", min: [x - r, y + 0.22, z - r], max: [x + r, y + 0.7, z + r], part: PART.plain, color: "#806b57", group: g });
    out.push({ shape: "cone", min: [x - r - 0.03, y + 0.7, z - r - 0.03], max: [x + r + 0.03, y + 0.86, z + r + 0.03], part: PART.plain, color: "#55504a", group: g });
  };
  /** Things on a flat roof `inner` at height y: a tank, a plant room, a penthouse or a mast. */
  const rooftop = (inner: Rect, y: number) => {
    const cx = s.corner & 1 ? inner.x1 : inner.x0;
    const cz = s.corner & 2 ? inner.z1 : inner.z0;
    const sx = s.corner & 1 ? -1 : 1;
    const sz = s.corner & 2 ? -1 : 1;
    const w = inner.x1 - inner.x0;
    const d = inner.z1 - inner.z0;
    if (s.style === "glass") {
      box(rect((inner.x0 + inner.x1) / 2, (inner.z0 + inner.z1) / 2, w * 0.5, d * 0.42), y, y + 0.65, PART.metal, "#8d9398", { group: ++group });
      if (t.h > 28) box(rect(cx + sx * 0.3, cz + sz * 0.3, 0.06, 0.06), y, y + 0.95, PART.metal, "#4a4c4f", { group: ++group });
      return;
    }
    if (s.tank) tank(cx + sx * 0.36, cz + sz * 0.36, y);
    // Plant room or stair hatch at the opposite corner.
    const mw = s.style === "deco" ? w * 0.36 : 0.62;
    const md = s.style === "deco" ? d * 0.32 : 0.5;
    const mx = (s.corner & 1 ? inner.x0 : inner.x1) - sx * (mw / 2 + 0.05);
    const mz = (s.corner & 2 ? inner.z0 : inner.z1) - sz * (md / 2 + 0.05);
    box(rect(mx, mz, mw, md), y, y + (s.style === "deco" ? 0.7 : 0.45), PART.plain, s.style === "deco" ? s.trim : "#a29d95", { group: ++group });
  };

  const foot = rect(t.x, t.z, t.w, t.d);
  const G = s.ground;
  const belt = 0.14;
  box(foot, t.y - FOOTING, t.y, PART.plain, s.base);
  if (s.style === "glass") {
    // Recessed lobby, glazed floor to ceiling; the tower stands on corner piers.
    box(shrink(foot, 0.22), t.y, t.y + G, PART.glass, s.color, { grid: { col: s.bay, storey: G, y0: t.y } });
    for (const [x, z] of [[foot.x0, foot.z0], [foot.x1 - 0.22, foot.z0], [foot.x0, foot.z1 - 0.22], [foot.x1 - 0.22, foot.z1 - 0.22]])
      box({ x0: x, x1: x + 0.22, z0: z, z1: z + 0.22 }, t.y, t.y + G, PART.metal, s.base);
  } else {
    box(foot, t.y, t.y + G, PART.storefront, s.base, { grid: { col: s.bay, storey: G, y0: t.y } });
  }
  box(foot, t.y + G, t.y + G + belt, s.style === "glass" ? PART.metal : PART.plain, s.trim);

  const facade = s.style === "glass" ? PART.glass : PART.windows;
  t.tiers.forEach((tier, i) => {
    const last = i === t.tiers.length - 1;
    const r = rect(t.x, t.z, tier.w, tier.d);
    const wall = shrink(r, s.inset);
    const y0 = i === 0 ? t.y + G + belt : t.y + tier.y;
    const top = t.y + tier.y + tier.h;
    const crown = last ? s.crown : "flat";
    const crownH =
      crown === "pyramid" ? Math.min(2, Math.max(1, Math.min(tier.w, tier.d) * 0.42)) : crown === "stepped" ? 2 : crown === "slope" ? Math.min(2.2, Math.max(1.2, tier.w * 0.35)) : 0;
    const roof = top - crownH;
    const grid = { col: s.col, storey: s.storey, y0 };
    box(wall, y0, roof, facade, s.color, { grid });
    const inner = shrink(r, s.inset + 0.14);

    if (crown === "pyramid") {
      box(r, roof - 0.24, roof, PART.plain, s.trim);
      out.push({ shape: "pyramid", min: [r.x0 + 0.04, roof, r.z0 + 0.04], max: [r.x1 - 0.04, top, r.z1 - 0.04], part: PART.plain, color: "#5f6461" });
      box(rect(t.x, t.z, 0.06, 0.06), top - 0.2, top + 0.5, PART.metal, "#4a4c4f");
    } else if (crown === "stepped") {
      parapet(r, roof, 0.22, 0.12, s.inset + 0.1);
      const step = scaled(r, 0.72);
      box(shrink(step, 0.05), roof, roof + 1.25, facade, s.color, { grid: { col: s.col, storey: 1.25, y0: roof } });
      parapet(step, roof + 1.25, 0.16, 0.1, 0.12);
      const cap = scaled(r, 0.46);
      box(cap, roof + 1.25, top, PART.plain, s.trim);
      box(rect(t.x, t.z, 0.05, 0.05), top, top + 0.8, PART.metal, "#4a4c4f", { group: ++group });
    } else if (crown === "slope") {
      box(r, roof - 0.08, roof, PART.metal, s.trim);
      out.push({ shape: "wedge", min: [wall.x0, roof, wall.z0], max: [wall.x1, top, wall.z1], part: PART.glass, color: s.color, grid, high: s.high });
    } else if (s.style === "glass") {
      // Crisp metal parapet: the curtain wall runs up past the roof.
      ring(r, roof - 0.06, roof + (last ? 0.3 : 0.12), s.inset + 0.05, PART.metal, s.trim);
      if (last) rooftop(shrink(r, 0.25), roof);
    } else {
      parapet(r, roof, last ? 0.3 : 0.22, last ? 0.26 : 0.14, s.inset + 0.12);
      if (last) rooftop(inner, roof);
    }
  });

  // Floodlights sit a few floors under the crown and wash it from below.
  if (flood) {
    const top = t.tiers[t.tiers.length - 1];
    const y = t.y + Math.max(top.y, top.y + top.h - 4.5);
    for (const p of out) p.flood = y;
  }
  return out;
}

/** Builds triangles with flat (or given) normals, wound to face away from a shape's centre. */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  info: number[] = [];
  private c = new Color();
  constructor(private seed: number) {}

  tri(p: V3[], uv: [number, number][], piece: Piece, centre: V3, normals?: V3[]) {
    const [a, b, c] = p;
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const len = Math.hypot(...n);
    if (len < 1e-9) return;
    n = [n[0] / len, n[1] / len, n[2] / len];
    const m = [(a[0] + b[0] + c[0]) / 3 - centre[0], (a[1] + b[1] + c[1]) / 3 - centre[1], (a[2] + b[2] + c[2]) / 3 - centre[2]];
    const order = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0 ? [0, 2, 1] : [0, 1, 2];
    const flip = order[1] === 2 ? -1 : 1;
    this.c.set(piece.color);
    for (const k of order) {
      this.pos.push(...p[k]);
      const nk = normals ? normals[k] : n;
      this.nor.push(nk[0] * (normals ? 1 : flip), nk[1] * (normals ? 1 : flip), nk[2] * (normals ? 1 : flip));
      this.uv.push(...uv[k]);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.info.push(piece.part, this.seed, piece.flood ?? 0);
    }
  }

  quad(p: V3[], uv: [number, number][], piece: Piece, centre: V3) {
    this.tri([p[0], p[1], p[2]], [uv[0], uv[1], uv[2]], piece, centre);
    this.tri([p[0], p[2], p[3]], [uv[0], uv[2], uv[3]], piece, centre);
  }

  /** u along the wall from a to b in whole columns, v in whole storeys from grid.y0. On a ground floor the middle bay is column 0 (the entrance). */
  wallUv(a: V3, b: V3, ys: number[], grid: Grid | undefined, top: number, entrance = false): [number, number][] {
    if (!grid) return ys.map(() => [0, 0]);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const cols = Math.max(1, Math.round(len / grid.col));
    const u0 = entrance ? -Math.floor(cols / 2) : 0;
    const storey = (top - grid.y0) / Math.max(1, Math.round((top - grid.y0) / grid.storey));
    return [
      [u0, (ys[0] - grid.y0) / storey],
      [u0 + cols, (ys[1] - grid.y0) / storey],
      [u0 + cols, (ys[2] - grid.y0) / storey],
      [u0, (ys[3] - grid.y0) / storey],
    ];
  }

  add(piece: Piece) {
    const [x0, y0, z0] = piece.min;
    const [x1, y1, z1] = piece.max;
    const centre: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const flat: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const sides: [V3, V3][] = [
      [[x0, 0, z1], [x1, 0, z1]],
      [[x1, 0, z1], [x1, 0, z0]],
      [[x1, 0, z0], [x0, 0, z0]],
      [[x0, 0, z0], [x0, 0, z1]],
    ];
    const at = (p: V3, y: number): V3 => [p[0], y, p[2]];
    // Storeys are fitted to the wall's own height (the wedge continues the wall's grid).
    const gridTop = piece.grid ? (piece.shape === "wedge" ? y0 : y1) : y1;

    if (piece.shape === "box") {
      for (const [a, b] of sides) this.quad([at(a, y0), at(b, y0), at(b, y1), at(a, y1)], this.wallUv(a, b, [y0, y0, y1, y1], piece.grid, gridTop, piece.part === PART.storefront), piece, centre);
      this.quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], flat, piece, centre);
      this.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], flat, piece, centre);
    } else if (piece.shape === "pyramid") {
      const apex: V3 = [centre[0], y1, centre[2]];
      for (const [a, b] of sides) this.tri([at(a, y0), at(b, y0), apex], [[0, 0], [0, 0], [0, 0]], piece, [centre[0], y0, centre[2]]);
    } else if (piece.shape === "wedge") {
      // Rises from y0 on the low side to y1 on the high side (along x).
      const hy = (x: number) => ((piece.high ?? 1) > 0 ? (x === x1 ? y1 : y0) : x === x0 ? y1 : y0);
      const c: V3 = [centre[0], y0 + (y1 - y0) * 0.3, centre[2]];
      for (const [a, b] of sides) {
        const ya = hy(a[0]);
        const yb = hy(b[0]);
        if (ya === y0 && yb === y0) continue;
        const uv = this.wallUv(a, b, [y0, y0, yb, ya], piece.grid, gridTop);
        if (ya > y0 && yb > y0) this.quad([at(a, y0), at(b, y0), at(b, yb), at(a, ya)], uv, piece, c);
        else this.tri(ya > y0 ? [at(a, y0), at(b, y0), at(a, ya)] : [at(a, y0), at(b, y0), at(b, yb)], ya > y0 ? [uv[0], uv[1], uv[3]] : [uv[0], uv[1], uv[2]], piece, c);
      }
      // The slope: u across it (z), v up the storeys.
      const lo = (piece.high ?? 1) > 0 ? x0 : x1;
      const hi = (piece.high ?? 1) > 0 ? x1 : x0;
      const uv = this.wallUv([0, 0, z0], [0, 0, z1], [y0, y0, y1, y1], piece.grid, gridTop);
      this.quad([[lo, y0, z0], [lo, y0, z1], [hi, y1, z1], [hi, y1, z0]], [uv[0], uv[1], uv[2], uv[3]], piece, c);
    } else {
      // Cylinder (smooth sides) or cone (lid).
      const n = 10;
      const r = (x1 - x0) / 2;
      const ring = (k: number): V3 => [centre[0] + Math.cos((k / n) * Math.PI * 2) * r, y0, centre[2] + Math.sin((k / n) * Math.PI * 2) * r];
      const zero: [number, number][] = [[0, 0], [0, 0], [0, 0]];
      for (let k = 0; k < n; k++) {
        const a = ring(k);
        const b = ring(k + 1);
        if (piece.shape === "cylinder") {
          const na: V3 = [(a[0] - centre[0]) / r, 0, (a[2] - centre[2]) / r];
          const nb: V3 = [(b[0] - centre[0]) / r, 0, (b[2] - centre[2]) / r];
          this.tri([a, b, at(b, y1)], zero, piece, centre, [na, nb, nb]);
          this.tri([a, at(b, y1), at(a, y1)], zero, piece, centre, [na, nb, na]);
        } else {
          this.tri([a, b, [centre[0], y1, centre[2]]], zero, piece, [centre[0], y0, centre[2]]);
          this.tri([a, [centre[0], y0, centre[2]], b], zero, piece, [centre[0], y1, centre[2]]);
        }
      }
    }
  }
}

/** All towers as one geometry: position, normal, colour, `aUv` (wall grid) and `aInfo` (part, seed, flood height). */
export function towerGeometry(towers: Tower[]) {
  const lit = floodlit(towers);
  const parts = { pos: [] as number[], nor: [] as number[], col: [] as number[], uv: [] as number[], info: [] as number[] };
  for (const t of towers) {
    const b = new Builder(hash(t.x, t.z, 9));
    for (const p of towerPieces(t, lit.has(t))) b.add(p);
    for (const k of Object.keys(parts) as (keyof typeof parts)[]) parts[k].push(...b[k]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(parts.pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(parts.nor, 3));
  g.setAttribute("color", new Float32BufferAttribute(parts.col, 3));
  g.setAttribute("aUv", new Float32BufferAttribute(parts.uv, 2));
  g.setAttribute("aInfo", new Float32BufferAttribute(parts.info, 3));
  g.computeBoundingSphere();
  return g;
}

/** Downtown: the whole skyline in one draw call. */
export function Towers({ towers, tex }: { towers: Tower[]; tex: Textures }) {
  const material = useMemo(() => downtownMaterial(tex.stone), [tex]);
  const geometry = useMemo(() => towerGeometry(towers), [towers]);
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />;
}
