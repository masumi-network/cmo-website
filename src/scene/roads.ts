// Roads that tie the bridges to the land: the Golden Gate approach down into
// the city grid, the road from its north end up into the Marin Headlands, and
// the Bay Bridge ramp into SoMa. Pure geometry data (rendered in landmarks.tsx).

import { BufferGeometry, Float32BufferAttribute } from "three";
import type { Vec3 } from "@/content/day";
import { MARIN_ROAD, headlandHeight, heightAt } from "@/lib/terrain";

export type Road = {
  name: string;
  /** Dense centre line, one point per unit, y resolved. */
  points: Vec3[];
  /** Where the road meets its bridge deck (x, z). */
  deckEnd: [number, number];
  ground: (x: number, z: number) => number;
};

const DECK = 7;
export const ROAD_WIDTH = 3.2;

/** Smooth (Catmull-Rom) resample of a control polyline, about one point per unit. */
function resample(ctrl: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  const p = (i: number) => ctrl[Math.min(ctrl.length - 1, Math.max(0, i))];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1])));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(ctrl[ctrl.length - 1]);
  return out;
}

/** From the deck (y 7) down to the ground at the far end, never below ground. */
function descend(name: string, ctrl: [number, number][], ground: Road["ground"]): Road {
  const xz = resample(ctrl);
  const last = xz[xz.length - 1];
  const endY = ground(last[0], last[1]);
  const points = xz.map(([x, z], i): Vec3 => {
    const t = i / (xz.length - 1);
    const s = 0.8 * t + 0.2 * t * t * (3 - 2 * t); // nearly linear: an even grade
    return [x, Math.max(ground(x, z), DECK + (endY - DECK) * s), z];
  });
  return { name, points, deckEnd: ctrl[0], ground };
}


const marinOrSea = (x: number, z: number) => Math.max(-0.45, headlandHeight(x, z));
const cityOrSea = (x: number, z: number) => Math.max(-0.45, heightAt(x, z));

export const ROADS: Road[] = [
  descend("golden-gate-south", [[-80, -52], [-79.5, -47], [-77, -42], [-72.5, -38], [-67, -36]], cityOrSea),
  // Graded and carved into the hills in terrain.ts (cut and fill).
  { name: "golden-gate-north", points: MARIN_ROAD.map(([x, y, z]): Vec3 => [x, Math.max(y, marinOrSea(x, z)), z]), deckEnd: [-80, -152], ground: marinOrSea },
  descend("bay-bridge-ramp", [[31, 14], [26, 14], [20, 14], [14, 14], [9, 14]], cityOrSea),
];

/** Asphalt ribbon (group 0) with low guard walls (group 1). UVs: u across, v along (units). */
export function roadGeometry(road: Road) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const pts = road.points;
  const half = ROAD_WIDTH / 2;
  const sides: [number, number][][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len;
    const nz = dx / len;
    sides.push([[pts[i][0] + nx * half, pts[i][2] + nz * half], [pts[i][0] - nx * half, pts[i][2] - nz * half]]);
  }
  let v = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) v += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    const y = pts[i][1] + 0.12;
    const [l, r] = sides[i];
    // deck surface, then the two guard walls (inner top, outer top)
    pos.push(l[0], y, l[1], r[0], y, r[1]);
    uv.push(0, v, 1, v);
    pos.push(l[0], y + 0.5, l[1], r[0], y + 0.5, r[1]);
    uv.push(0, v, 1, v);
  }
  const walls: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = i * 4;
    const b = a + 4;
    idx.push(a, a + 1, b, a + 1, b + 1, b); // road
    walls.push(a, b, a + 2, b, b + 2, a + 2); // left wall
    walls.push(a + 1, a + 3, b + 1, a + 3, b + 3, b + 1); // right wall
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex([...idx, ...walls]);
  // Group 0: road surface, group 1: guard walls.
  g.addGroup(0, idx.length, 0);
  g.addGroup(idx.length, walls.length, 1);
  g.computeVertexNormals();
  return g;
}

/** Pier positions under elevated stretches: [x, z, groundY, topY]. */
export function piers(road: Road, every = 5): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 2; i < road.points.length - 1; i += every) {
    const [x, y, z] = road.points[i];
    const g = road.ground(x, z);
    if (y - g > 1.4) out.push([x, z, g, y - 0.2]);
  }
  return out;
}
