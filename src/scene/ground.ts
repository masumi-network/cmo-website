// The city ground as meshes (drawn by Land in city.tsx): the terrain, and the
// kerbs between the streets and their sidewalks.
//
// The terrain is a grid every half unit that follows surfaceAt. Every kerb
// line (a street's edge, STREET / 2 from its centre) is a grid line, twice:
// one copy takes the sidewalk's height, the other the street's. So the step
// is a crisp vertical kerb, not a half-unit ramp. The kerb mesh closes it: a
// concrete face between the two levels, a light top edge on the sidewalk and
// a darker gutter on the street, both a hair above the ground.
//
// Both are cut into TILE squares (`tiles`), so the parts out of view, or out
// of the sun's shadow box, are culled.

import { BufferGeometry, Float32BufferAttribute } from "three";
import { PLAZA, surfaceAt } from "@/lib/terrain";
import { LAND_BOUNDS, STREET, X_STREETS, Z_STREETS, groundAt, insideLand } from "./grid";

/** Ground outside the land (under the water, behind the sea wall). */
const SEA_FLOOR = -1.2;
const STEP = 0.5;
/** Kerb top edge and gutter: width, and how far above the ground they float. */
const TOP = 0.07;
const GUTTER = 0.12;
const LIFT = 0.006;
/** Vertex colours on the concrete: top edge lighter, face as is, gutter darker. */
const SHADE = { top: 1.12, face: 0.95, gutter: 0.62 };
/** Tile size: a multiple of STEP, from the land's corner, so a tile edge is always a grid line. */
export const TILE = 20;
const tileEdge = (v: number, min: number) => Math.abs((v - min) / TILE - Math.round((v - min) / TILE)) < 1e-9;

/** A grid line: where it is, and which side of a kerb it takes (-1, +1; 0 off the kerbs). */
type Line = { v: number; side: number };

/** Grid lines every STEP, doubled on the kerbs and on `steps` (other crisp edges, like the Pyramid's plaza cut). */
function lines(lo: number, hi: number, streets: number[], steps: number[] = []): Line[] {
  const kerbs = streets.flatMap((s) => [s - STREET / 2, s + STREET / 2]);
  const out: Line[] = [];
  for (let i = 0; i <= Math.round((hi - lo) / STEP); i++) {
    const v = lo + i * STEP;
    for (const step of steps) if (step > v - STEP && step < v) out.push({ v: step, side: -1 }, { v: step, side: 1 });
    if (kerbs.some((k) => Math.abs(k - v) < 1e-9)) out.push({ v, side: -1 }, { v, side: 1 });
    else out.push({ v, side: 0 });
  }
  return out;
}

const ground = (x: number, z: number) => (insideLand(x, z) ? surfaceAt(x, z) : SEA_FLOOR);

let cache: { xs: Line[]; zs: Line[]; h: Float32Array } | null = null;
/** The grid lines and the height at every grid vertex (row by row: index j * xs.length + i). */
function heights() {
  if (cache) return cache;
  const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
  const xs = lines(minX, maxX, X_STREETS, [PLAZA.x0, PLAZA.x1]);
  const zs = lines(minZ, maxZ, Z_STREETS, [PLAZA.z0]);
  const h = new Float32Array(xs.length * zs.length);
  zs.forEach((z, j) => xs.forEach((x, i) => (h[j * xs.length + i] = ground(x.v + x.side * 1e-4, z.v + z.side * 1e-4))));
  return (cache = { xs, zs, h });
}

/** The terrain: one quad per half-unit cell (none wholly under the bay), uv = (x, -z) as groundMask expects. */
export function terrainGeometry() {
  const { xs, zs, h } = heights();
  const n = xs.length;
  const pos = new Float32Array(h.length * 3);
  const uv = new Float32Array(h.length * 2);
  zs.forEach((z, j) =>
    xs.forEach((x, i) => {
      const k = j * n + i;
      pos.set([x.v, h[k], z.v], k * 3);
      uv.set([x.v, -z.v], k * 2);
    }),
  );
  const index: number[] = [];
  for (let j = 0; j < zs.length - 1; j++) {
    if (zs[j + 1].v === zs[j].v) continue; // the two sides of a kerb: the kerb mesh closes the gap
    for (let i = 0; i < n - 1; i++) {
      if (xs[i + 1].v === xs[i].v) continue;
      const [a, b, c, d] = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
      if ([a, b, c, d].every((v) => h[v] === Math.fround(SEA_FLOOR))) continue; // under the (opaque) bay
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/**
 * The kerbs: wherever a doubled grid line has a street on one side and a
 * sidewalk on the other. Built from the terrain's own vertex heights, so the
 * face meets the ground exactly on both sides.
 */
export function kerbGeometry() {
  const { xs, zs, h } = heights();
  const n = xs.length;
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  /** A quad a b c d (a-b one edge, c-d the other), facing `want`, in one shade. */
  const quad = (p: number[][], want: number[], shade: number, wall: boolean) => {
    const [a, b, c] = p;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const flip = (u[1] * v[2] - u[2] * v[1]) * want[0] + (u[2] * v[0] - u[0] * v[2]) * want[1] + (u[0] * v[1] - u[1] * v[0]) * want[2] < 0;
    const [q0, q1, q2, q3] = flip ? [p[0], p[2], p[1], p[3]] : p;
    for (const q of [q0, q1, q2, q2, q1, q3]) {
      pos.push(...q);
      col.push(shade, shade, shade);
      // concrete in world units: walls by (along, height), strips from above
      uv.push(wall ? (want[0] ? q[2] : q[0]) / 3 : q[0] / 3, wall ? q[1] / 3 : -q[2] / 3);
    }
  };

  // Kerbs along z (doubled columns), then along x (doubled rows): the same code with the axes swapped.
  for (const alongZ of [true, false]) {
    const [cross, along] = alongZ ? [xs, zs] : [zs, xs];
    /** Vertex (c on the doubled lines, a along them) as x, y, z. */
    const vtx = (c: number, a: number, du = 0): number[] => {
      const [i, j] = alongZ ? [c, a] : [a, c];
      const y = h[j * n + i];
      return alongZ ? [xs[i].v + du, y, zs[j].v] : [xs[i].v, y, zs[j].v + du];
    };
    /** Height a distance `d` from the line at vertex c, a: along the grid edge towards the next line (what the terrain shows). */
    const toward = (c: number, a: number, next: number, d: number) => {
      const [p, q] = [vtx(c, a), vtx(next, a)];
      const span = Math.abs(cross[next].v - cross[c].v);
      return p[1] + ((q[1] - p[1]) * d) / span;
    };
    for (let c = 0; c < cross.length - 1; c++) {
      if (cross[c].side !== -1) continue;
      const k = cross[c].v;
      // A run of kerb along this line: the end vertices of its parts (sidewalk top, street, top edge's and gutter's
      // far sides) at each grid line it passes. Straight runs become one quad per part.
      let run: { s: number; face: boolean; at: number[][][] } | null = null;
      const flush = () => {
        if (!run) return;
        const [first, last] = [run.at[0], run.at[run.at.length - 1]];
        const lift = (p: number[]) => [p[0], p[1] + LIFT, p[2]];
        if (run.face) quad([first[0], last[0], first[1], last[1]], alongZ ? [-run.s, 0, 0] : [0, 0, -run.s], SHADE.face, true);
        quad([first[0], last[0], first[2], last[2]].map(lift), [0, 1, 0], SHADE.top, false);
        quad([first[1], last[1], first[3], last[3]].map(lift), [0, 1, 0], SHADE.gutter, false);
        run = null;
      };
      /** Every point of the run, and the new one, on the line from its first to the new one. */
      const straight = (r: { at: number[][][] }, next: number[][]) =>
        next.every((p, t) => {
          const [p0, v0] = [r.at[0][t], alongZ ? r.at[0][t][2] : r.at[0][t][0]];
          const v2 = alongZ ? p[2] : p[0];
          return r.at.every((q) => Math.abs(p0[1] + ((p[1] - p0[1]) * ((alongZ ? q[t][2] : q[t][0]) - v0)) / (v2 - v0) - q[t][1]) < 1e-5);
        });
      const min = alongZ ? LAND_BOUNDS.minZ : LAND_BOUNDS.minX;
      for (let a = 0; a < along.length - 1; a++) {
        if (tileEdge(along[a].v, min)) flush(); // a run never crosses a tile edge
        if (along[a + 1].v === along[a].v) {
          flush(); // a cross kerb: the two sides of it differ
          continue;
        }
        const mid = (along[a].v + along[a + 1].v) / 2;
        const kind = (u: number) => (alongZ ? groundAt(k + u, mid) : groundAt(mid, k + u));
        const inside = alongZ ? insideLand(k, mid) : insideLand(mid, k);
        const [lo, hi] = [kind(-0.01), kind(0.01)];
        if (!inside || (lo === "street") === (hi === "street")) {
          flush();
          continue;
        }
        // s: +1 when the sidewalk is on the far (+) side; walk and street are the vertex copies.
        const s = hi === "street" ? -1 : 1;
        const [walk, street] = s > 0 ? [c + 1, c] : [c, c + 1];
        const [walkNext, streetNext] = s > 0 ? [c + 2, c - 1] : [c - 1, c + 2];
        const ends = [a, a + 1].map((e) => {
          const far = (copy: number, next: number, dir: number, w: number) => {
            const p = vtx(copy, e, dir * w);
            p[1] = toward(copy, e, next, w);
            return p;
          };
          return [vtx(walk, e), vtx(street, e), far(walk, walkNext, s, TOP), far(street, streetNext, -s, GUTTER)];
        });
        const face = ends.some(([top, bottom]) => top[1] - bottom[1] > 1e-4);
        const r = run as { s: number; face: boolean; at: number[][][] } | null;
        if (r && r.s === s && r.face === face && straight(r, ends[1])) r.at.push(ends[1]);
        else {
          flush();
          run = { s, face, at: ends };
        }
      }
      flush();
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Cuts a ground mesh into TILE squares, each triangle into the tile under its
 * centre. Every tile copies the vertices it uses (position, normal, uv,
 * colour), so the edges two tiles share are the same numbers: no seams.
 */
export function tiles(g: BufferGeometry): BufferGeometry[] {
  const pos = g.attributes.position;
  const index = g.index ? g.index.array : Array.from({ length: pos.count }, (_, i) => i);
  const { minX, minZ } = LAND_BOUNDS;
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
    const i = Math.floor(((pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3 - minX) / TILE);
    const j = Math.floor(((pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - minZ) / TILE);
    const key = j * 1000 + i;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a, b, c);
  }
  return [...buckets.values()].map((tris) => {
    const local = new Map<number, number>();
    const own = tris.map((v) => local.get(v) ?? (local.set(v, local.size), local.size - 1));
    const out = new BufferGeometry();
    for (const [name, attr] of Object.entries(g.attributes)) {
      const n = attr.itemSize;
      const array = new Float32Array(local.size * n);
      for (const [v, k] of local) for (let c = 0; c < n; c++) array[k * n + c] = attr.array[v * n + c];
      out.setAttribute(name, new Float32BufferAttribute(array, n));
    }
    if (g.index) out.setIndex(own); // unindexed meshes keep their order
    out.computeBoundingSphere();
    return out;
  });
}

/** How far a tile's land rises and falls (the sea floor under the shore does not count). */
export function relief(g: BufferGeometry) {
  const pos = g.attributes.position;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y <= SEA_FLOOR + 1e-6) continue;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return hi > lo ? hi - lo : 0;
}
