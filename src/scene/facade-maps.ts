// Photo-real plates (traced.ts): the downtown shader's windows as textures the
// path tracer can read. One tile per surface kind, FACADE_CELLS window cells a
// side; each cell has its own variation (blinds, glass tone) and the night's
// lit windows come in runs along a floor, busy and quiet floors, as in
// materials.ts downtownMaterial. Colour is a factor on the tower's tint.

import { DataTexture, LinearMipmapLinearFilter, RepeatWrapping, type Texture } from "three";

/** Window cells along each side of a tile. */
export const FACADE_CELLS = 16;
/** Pixels per cell. */
const PX = 16;

export type FacadeKind = "curtain" | "sash" | "steel" | "storefront";
type Pixel = { color: number; rough: number; metal: number; lit: [number, number, number] };

const fract = (x: number) => x - Math.floor(x);
const hash = (x: number, y: number) => fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
/** 1 within `w` (in cells of the pattern) of a whole number. */
const line = (x: number, w: number) => (Math.abs(fract(x + 0.5) - 0.5) < w ? 1 : 0);

/** One pixel of a window cell: (u, v) in 0..1 (v up), `r` the cell's own random, `on` whether its light is on at night. */
function pixel(kind: FacadeKind, u: number, v: number, r: number, on: boolean): Pixel {
  if (kind === "curtain") {
    const mullion = line(u, 0.045);
    const spandrel = line(v, 0.075);
    const pane = (1 - mullion) * (1 - spandrel);
    const lit = pane && on ? 0.18 + 0.1 * r : 0;
    return { color: pane ? 0.62 + 0.12 * r : spandrel ? 0.3 : 0.8, rough: pane ? 0.14 : 0.5, metal: pane ? 0.2 : 0.4, lit: [lit, lit * 0.88, lit * 0.7] };
  }
  if (kind === "storefront") {
    const glazed = v > 0.09 && v < 0.73 && !line(u, 0.07);
    const frame = glazed && (line(u, 0.1) || (v < 0.2 && line((v - 0.09) * 6, 0.08)) || (v > 0.5 && line((v - 0.56) * 6, 0.06)));
    const glass = glazed && !frame;
    const lit = glass && r > 0.45 ? 0.2 + 0.2 * Math.min(1, Math.max(0, (v - 0.1) / 0.5)) : 0;
    return { color: frame ? 0.1 : glass ? 0.12 + 0.1 * v : 1, rough: glass ? 0.06 : 0.75, metal: glass ? 0.45 : 0, lit: [lit, lit * 0.8, lit * 0.52] };
  }
  // punched windows: a sash (frame, meeting rail, some blinds part way down) or a steel grid
  const steel = kind === "steel";
  const bar = steel ? line(u * 3, 0.05) || line(v * 4, 0.05) : line(u, 0.07) || line(v * 2, 0.045);
  const blind = !steel && !bar && r > 0.75 && v > 1 - (0.15 + 0.35 * fract(r * 7.31));
  const glass = !bar && !blind;
  const lit = !bar && on ? 0.7 + 0.3 * r : 0;
  return {
    color: bar ? (steel ? 0.06 : 0.12) : blind ? 0.65 : (0.5 + 0.3 * r) * (0.75 + 0.5 * v),
    rough: glass ? 0.12 : 0.6,
    metal: steel && bar ? 0.3 : 0,
    lit: [lit, lit * 0.8, lit * 0.52],
  };
}

const tiles = new Map<FacadeKind, { map: Texture; orm: Texture; lit: Texture }>();

/** The tile for a surface kind: colour factor, roughness (G) and metalness (B), lit-window colour. Made once. */
export function facadeMaps(kind: FacadeKind) {
  let t = tiles.get(kind);
  if (t) return t;
  const size = FACADE_CELLS * PX;
  const [map, orm, lit] = [0, 1, 2].map(() => new Uint8Array(size * size * 4));
  // runs of lit windows along a floor: four panes on curtain walls, three in punched walls. Each floor is busier or
  // quieter; on average 70% of punched windows light (55% of office panes): what the towers show on the GPU at
  // 18:00 (measured), not the 40% the shader's hash would give with exact sines
  const run = kind === "curtain" ? 4 : 3;
  const base = kind === "curtain" ? 0.3 : 0.45;
  for (let cy = 0; cy < FACADE_CELLS; cy++) {
    const busy = hash(cy, 57.1);
    for (let cx = 0; cx < FACADE_CELLS; cx++) {
      const r = hash(cx + 0.31, cy + 0.77);
      const on = kind === "storefront" || hash(Math.floor(cx / run), cy + 13.3) < base + 0.5 * busy;
      for (let py = 0; py < PX; py++) {
        for (let px = 0; px < PX; px++) {
          const p = pixel(kind, (px + 0.5) / PX, (py + 0.5) / PX, r, on);
          const i = ((cy * PX + py) * size + cx * PX + px) * 4;
          map.set([p.color, p.color, p.color].map((c) => Math.round(Math.min(1, c) * 255)), i);
          map[i + 3] = 255;
          orm.set([255, Math.round(p.rough * 255), Math.round(p.metal * 255), 255], i);
          lit.set([...p.lit.map((c) => Math.round(Math.min(1, c) * 255)), 255], i);
        }
      }
    }
  }
  const texture = (data: Uint8Array) => {
    const tex = new DataTexture(data, size, size);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  };
  t = { map: texture(map), orm: texture(orm), lit: texture(lit) };
  tiles.set(kind, t);
  return t;
}
