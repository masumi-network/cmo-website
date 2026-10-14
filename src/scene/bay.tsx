"use client";

// The bay: a water shader (moving ripples, fresnel, sun glint, shallows and
// foam along every shore, a planar reflection in full mode), Yerba Buena, five
// sailboats and a ferry; Alcatraz and Treasure Island are in islands.tsx. Boat
// routes and the shore distance field are pure functions, tested in
// tests/unit/bay.test.ts.

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  BackSide,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  ShaderChunk,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Group,
  type HemisphereLight,
  type InstancedMesh,
  type Mesh,
  type Scene,
  type ShaderMaterial,
  type Texture,
  type WebGLRenderer,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { headlandHeight } from "@/lib/terrain";
import { Alcatraz, TREASURE_ISLAND, TreasureIsland, alcatrazDistance, islandGeometries, roundedBoxDistance } from "./islands";
import { BAY_TOWERS, GG } from "./landmarks";
import { LAND, insideLand } from "./layout";
import { BAY_ANCHORS, ISLAND, ROADS, piers } from "./roads";
import { useGlow } from "./parts";
import { LIVE, rig } from "./shared";
import { traceInfo } from "./trace-info";

/** The water surface. Pier, cliffs and bridges are built around it. */
export const WATER_Y = -0.45;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (x: number, z: number) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------------------
// Shore distance: signed distance (world units) from the water to the nearest
// solid thing standing in it. Positive on water, negative on land.

/** Sea wall bevel: the cliff extrusion in city.tsx sticks out this far past LAND. */
const SEA_WALL = 0.6;
/** Yerba Buena Island, as roads.ts plans the tunnel into it: [x, z, radius, height, color] (tested to match ISLAND). */
export const HILLS: [number, number, number, number, string][] = [[ISLAND.x, ISLAND.z, ISLAND.r, ISLAND.h, "#8f8a68"]];

function valueNoise(x: number, z: number) {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const u = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const v = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const a = hash(xi, zi);
  const b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1);
  const d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Yerba Buena's ground. Along the Bay Bridge road (west side, z near 14) it is
 * exactly the dome roads.ts plans the tunnel portal on; elsewhere it peaks in
 * the middle and gets lumpy. The water line is the circle of ISLAND.r.
 */
export function yerbaBuenaHeight(x: number, z: number) {
  const rho = Math.hypot(x - ISLAND.x, z - ISLAND.z) / ISLAND.r;
  if (rho >= 1) return -Infinity;
  const dome = Math.sqrt(1 - rho * rho);
  // a spur along the road, where the tunnel goes in
  const free = Math.max(smoothstep(2.5, 7, Math.abs(z - ISLAND.z)), smoothstep(ISLAND.x - 2, ISLAND.x + 2, x));
  const lumps = 0.22 * (valueNoise(x / 3.2, z / 3.2) - 0.5) + 0.08 * (valueNoise(x / 1.2, z / 1.2) - 0.5);
  // a low rock cliff at the shore, then a hill rising to a rounded top
  const hill = 0.07 * Math.min(1, (1 - rho) * 12) + 0.93 * Math.cos((rho * Math.PI) / 2) ** 1.6 * (1 + lumps);
  return ISLAND.y + ISLAND.h * (dome + (hill - dome) * free);
}

function yerbaBuenaGeometry() {
  const A = 96;
  const RINGS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.78, 0.85, 0.9, 0.94, 0.97, 0.99, 1, 1.1];
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  for (let r = 0; r < RINGS.length; r++) {
    for (let k = 0; k < (r === 0 ? 1 : A); k++) {
      const theta = (k / A) * Math.PI * 2;
      const x = ISLAND.x + ISLAND.r * RINGS[r] * Math.cos(theta);
      const z = ISLAND.z + ISLAND.r * RINGS[r] * Math.sin(theta);
      const y = RINGS[r] >= 1 ? (r === RINGS.length - 1 ? -1.2 : ISLAND.y) : yerbaBuenaHeight(x, z);
      pos.push(x - ISLAND.x, y, z - ISLAND.z);
      uv.push(x / 26, -z / 26); // world-space, like the headlands
      col.push(0.82 + 0.18 * hash(k, r), 0, 0); // brightness; tinted below once normals exist
    }
  }
  const index: number[] = [];
  for (let k = 0; k < A; k++) index.push(0, 1 + ((k + 1) % A), 1 + k);
  for (let r = 1; r < RINGS.length - 1; r++) {
    const s0 = 1 + (r - 1) * A;
    const s1 = 1 + r * A;
    for (let k = 0; k < A; k++) {
      const k1 = (k + 1) % A;
      index.push(s0 + k, s0 + k1, s1 + k, s0 + k1, s1 + k1, s1 + k);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // steep ground is grey rock (the texture would streak there), the rest scrub, a little darker on slopes
  const n = g.attributes.normal;
  const rock = new Color("#8a8379");
  const c = new Color();
  for (let i = 0; i < n.count; i++) {
    const steep = smoothstep(0.75, 0.45, n.getY(i));
    const k = col[i * 3] * (1 - Math.min(0.35, (1 - n.getY(i)) * 0.7));
    c.setRGB(1, 0.98, 0.92).lerp(rock, steep).multiplyScalar(k);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** Eucalyptus woods on Yerba Buena, clear of the bridge road. [x, y, z, size]. */
function yerbaBuenaTrees() {
  const rand = rng(11);
  const out: [number, number, number, number][] = [];
  while (out.length < 120) {
    const a = rand() * Math.PI * 2;
    const rho = Math.sqrt(rand()) * 0.88;
    const x = ISLAND.x + Math.cos(a) * rho * ISLAND.r;
    const z = ISLAND.z + Math.sin(a) * rho * ISLAND.r;
    if (x < ISLAND.x - 3 && Math.abs(z - ISLAND.z) < 3) continue; // the portal and the road
    out.push([x, yerbaBuenaHeight(x, z) - 0.15, z, 0.28 + rand() * 0.28]);
  }
  return out;
}

/** Yerba Buena (wooded, rocky shore, the Bay Bridge tunnel) and flat Treasure Island to its north. */
export function Hills({ map }: { map: Texture }) {
  const ground = useMemo(() => yerbaBuenaGeometry(), []);
  const trees = useMemo(() => yerbaBuenaTrees(), []);
  const materials = useMemo(
    () => ({
      ground: new MeshStandardMaterial({ map, vertexColors: true, roughness: 1 }),
      leaves: new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    }),
    [map],
  );
  const woods = useRef<InstancedMesh>(null);
  useEffect(() => {
    const mesh = woods.current;
    if (!mesh) return;
    const o = new Object3D();
    const c = new Color();
    trees.forEach(([x, y, z, s], i) => {
      o.position.set(x, y + s * 0.9, z);
      o.scale.set(s, s * 1.6, s);
      o.rotation.set(0, i, 0);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(["#5d7448", "#677d4f", "#55693f"][i % 3]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [trees]);
  return (
    <>
      <mesh geometry={ground} material={materials.ground} position={[ISLAND.x, 0, ISLAND.z]} castShadow receiveShadow />
      <TreasureIsland />
      <instancedMesh ref={woods} args={[undefined, materials.leaves, trees.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[1, 1]} />
      </instancedMesh>
    </>
  );
}

/** Footings in the water: [x, z, half x, half z]. Bridge towers and anchorages, road piers, Ferry Building base. */
const FOOTINGS: [number, number, number, number][] = [
  ...[...GG.towers, GG.south, GG.north].map((z): [number, number, number, number] => [GG.x, z, GG.towers.includes(z) ? 3.2 : 2.3, 2]),
  ...BAY_TOWERS.map((x): [number, number, number, number] => [x, 14, 1.2, 2.7]),
  ...BAY_ANCHORS.map((x): [number, number, number, number] => [x, 14, 1.15, 2.25]),
  ...ROADS.flatMap((r) => piers(r))
    .filter(([, , ground]) => ground < WATER_Y)
    .map(([x, z]): [number, number, number, number] => [x, z, 0.5, 0.5]),
  [33.4, -3, 2.5, 7],
];

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

/** Everything solid except the Marin Headlands (those are a height field, baked below). */
function solidDistance(x: number, z: number) {
  let edge = Infinity;
  for (let i = 0, j = LAND.length - 1; i < LAND.length; j = i++) edge = Math.min(edge, segmentDistance(x, z, LAND[j][0], LAND[j][1], LAND[i][0], LAND[i][1]));
  let d = (insideLand(x, z) ? -edge : edge) - SEA_WALL;
  for (const [cx, cz, hx, hz] of FOOTINGS) {
    const qx = Math.abs(x - cx) - hx;
    const qz = Math.abs(z - cz) - hz;
    d = Math.min(d, Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0));
  }
  d = Math.min(d, Math.hypot(x - ISLAND.x, z - ISLAND.z) - ISLAND.r);
  for (const part of TREASURE_ISLAND) d = Math.min(d, roundedBoxDistance(x, z, part) - 0.1);
  return Math.min(d, alcatrazDistance(x, z));
}

/** The baked grid: texel centres at x0 + (i + 0.5) * cell. */
export const SHORE = { x0: -232, z0: -350, cell: 0.875, w: 512, h: 538 };
export type Shore = typeof SHORE & { data: Float32Array };

/**
 * Bake the shore distance once. The Marin shore is found where the headland
 * height field crosses the water line (sub-texel), then spread out with a
 * vector distance transform; everything else is exact.
 */
export function bakeShore(): Shore {
  const { x0, z0, cell, w, h } = SHORE;
  const n = w * h;
  const cx = (k: number) => x0 + ((k % w) + 0.5) * cell;
  const cz = (k: number) => z0 + (Math.floor(k / w) + 0.5) * cell;

  const above = new Float32Array(n).fill(-1);
  for (let k = 0; k < n; k++) if (cz(k) < -112) above[k] = headlandHeight(cx(k), cz(k)) - WATER_Y;

  const best = new Float32Array(n).fill(Infinity);
  const sx = new Float32Array(n);
  const sz = new Float32Array(n);
  const offer = (k: number, px: number, pz: number) => {
    const d = Math.hypot(cx(k) - px, cz(k) - pz);
    if (d < best[k]) {
      best[k] = d;
      sx[k] = px;
      sz[k] = pz;
    }
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      for (const nk of [i < w - 1 ? k + 1 : -1, j < h - 1 ? k + w : -1]) {
        if (nk < 0 || above[k] > 0 === above[nk] > 0) continue;
        const t = above[k] / (above[k] - above[nk]);
        const px = cx(k) + (cx(nk) - cx(k)) * t;
        const pz = cz(k) + (cz(nk) - cz(k)) * t;
        offer(k, px, pz);
        offer(nk, px, pz);
      }
    }
  }
  const pull = (k: number, i: number, j: number) => {
    if (i < 0 || j < 0 || i >= w || j >= h) return;
    const nk = j * w + i;
    if (best[nk] < Infinity) offer(k, sx[nk], sz[nk]);
  };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      pull(k, i - 1, j);
      pull(k, i - 1, j - 1);
      pull(k, i, j - 1);
      pull(k, i + 1, j - 1);
    }
    for (let i = w - 1; i >= 0; i--) pull(j * w + i, i + 1, j);
  }
  for (let j = h - 1; j >= 0; j--) {
    for (let i = w - 1; i >= 0; i--) {
      const k = j * w + i;
      pull(k, i + 1, j);
      pull(k, i + 1, j + 1);
      pull(k, i, j + 1);
      pull(k, i - 1, j + 1);
    }
    for (let i = 0; i < w; i++) pull(j * w + i, i - 1, j);
  }

  const data = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const marin = above[k] > 0 ? -best[k] : best[k];
    data[k] = Math.min(solidDistance(cx(k), cz(k)), marin);
  }
  return { ...SHORE, data };
}

/** Bilinear lookup in the baked grid (what the shader sees). */
export function shoreDistance(shore: Shore, x: number, z: number) {
  const fx = Math.min(shore.w - 1, Math.max(0, (x - shore.x0) / shore.cell - 0.5));
  const fz = Math.min(shore.h - 1, Math.max(0, (z - shore.z0) / shore.cell - 0.5));
  const i = Math.min(shore.w - 2, Math.floor(fx));
  const j = Math.min(shore.h - 2, Math.floor(fz));
  const tx = fx - i;
  const tz = fz - j;
  const at = (a: number, b: number) => shore.data[b * shore.w + a];
  const top = at(i, j) + (at(i + 1, j) - at(i, j)) * tx;
  const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * tx;
  return top + (bottom - top) * tz;
}

// ---------------------------------------------------------------------------
// Boat routes: closed loops on open water, sailed with a westerly wind.

/** Where the wind blows to: from the ocean, in through the Golden Gate. */
const WIND = { x: 1, z: 0 };

export type Route = { name: string; kind: "sail" | "ferry"; speed: number; points: [number, number][] };

export const ROUTES: Route[] = [
  { name: "around Alcatraz", kind: "sail", speed: 0.75, points: [[-6, -52], [10, -57], [15, -68], [6, -79], [-10, -81], [-24, -74], [-27, -62], [-20, -54]] },
  { name: "under the Golden Gate", kind: "sail", speed: 0.8, points: [[-42, -96], [-60, -111], [-82, -114], [-104, -110], [-118, -98], [-106, -86], [-82, -84], [-60, -86]] },
  { name: "mid bay", kind: "sail", speed: 0.7, points: [[62, -84], [78, -88], [84, -98], [76, -108], [60, -110], [46, -104], [42, -94], [48, -86]] },
  { name: "under the Bay Bridge", kind: "sail", speed: 0.7, points: [[79, -12], [79, 6], [79, 22], [84, 36], [96, 40], [102, 28], [97, 14], [96, -2], [90, -14]] },
  { name: "east bay", kind: "sail", speed: 0.75, points: [[62, -27], [76, -20], [95, -30], [110, -50], [100, -62], [80, -56], [65, -42]] },
  {
    name: "ferry",
    kind: "ferry",
    speed: 1.1,
    points: [[44, 0], [47, -6], [48, -26], [50, -50], [42, -78], [28, -93], [16, -93], [20, -79], [29, -60], [36, -36], [39, -18], [41, -6]],
  },
];

export type Track = { x: Float32Array; z: Float32Array; hx: Float32Array; hz: Float32Array; t: Float32Array; period: number };
export type Pose = { x: number; z: number; heading: number };

/** Angle off the wind (0 = head to wind, PI = dead downwind) for a heading (atan2(dx, dz)). */
const offWind = (heading: number) => Math.acos(Math.max(-1, Math.min(1, -(WIND.x * Math.sin(heading) + WIND.z * Math.cos(heading)))));
/** Sailboats slow down close to the wind (and through a tack). */
const sailSpeed = (heading: number) => {
  const a = offWind(heading);
  return (0.45 + 0.55 * smoothstep(0.35, 1.4, a)) * (1 - 0.12 * smoothstep(2.6, Math.PI, a));
};

/** A closed Catmull-Rom loop through the route, sampled every ~0.2 units, timed by speed. */
export function track(route: Route): Track {
  const P = route.points;
  const n = P.length;
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [P[(i - 1 + n) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]];
    const steps = Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
      xs.push(f(p0[0], p1[0], p2[0], p3[0]));
      zs.push(f(p0[1], p1[1], p2[1], p3[1]));
    }
  }
  const m = xs.length;
  const hx = new Float32Array(m);
  const hz = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const dx = xs[(i + 1) % m] - xs[(i - 1 + m) % m];
    const dz = zs[(i + 1) % m] - zs[(i - 1 + m) % m];
    const l = Math.hypot(dx, dz);
    hx[i] = dx / l;
    hz[i] = dz / l;
  }
  const t = new Float32Array(m + 1);
  for (let i = 1; i <= m; i++) {
    const a = i - 1;
    const b = i % m;
    const factor = route.kind === "sail" ? sailSpeed(Math.atan2(hx[a], hz[a])) : 1;
    t[i] = t[i - 1] + Math.hypot(xs[b] - xs[a], zs[b] - zs[a]) / (route.speed * factor);
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), hx, hz, t, period: t[m] };
}

/** Where a boat on this track is at time `time` (seconds). Writes into `out`. */
export function boatAt(tr: Track, time: number, out: Pose): Pose {
  let s = time % tr.period;
  if (s < 0) s += tr.period;
  let lo = 0;
  let hi = tr.t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.t[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - tr.t[lo]) / (tr.t[lo + 1] - tr.t[lo]);
  const j = (lo + 1) % tr.x.length;
  out.x = tr.x[lo] + (tr.x[j] - tr.x[lo]) * f;
  out.z = tr.z[lo] + (tr.z[j] - tr.z[lo]) * f;
  out.heading = Math.atan2(tr.hx[lo] + (tr.hx[j] - tr.hx[lo]) * f, tr.hz[lo] + (tr.hz[j] - tr.hz[lo]) * f);
  return out;
}

export type Trim = { boom: number; camber: number; heel: number };

/**
 * How a sailboat sets its sails for a heading. boom: rotation of the boom
 * around the mast (negative swings it to starboard, +x). camber: which side
 * the sails fill to (-1..1, near 0 when luffing). heel: roll around the bow
 * axis, always away from the wind.
 */
export function sailTrim(heading: number, out: Trim = { boom: 0, camber: 0, heel: 0 }): Trim {
  const a = offWind(heading);
  // The wind's component across the boat (towards local +x).
  const across = WIND.x * Math.cos(heading) - WIND.z * Math.sin(heading);
  const side = Math.tanh(across * 5);
  const fill = smoothstep(0.45, 0.85, a);
  out.boom = -side * (0.08 + 1.25 * smoothstep(0.6, 2.9, a));
  out.camber = side * fill;
  out.heel = -0.13 * across * fill * (1 - 0.6 * smoothstep(2.2, 3.1, a));
  return out;
}

// ---------------------------------------------------------------------------
// Boat geometry: lofted hulls with vertex colours, sails as curved grids.

type Hull = { length: number; beam: number; stern: number; freeboard: number; draft: number; bow: number; bilge: number; rake: number };
const SAILBOAT: Hull = { length: 3, beam: 0.5, stern: 0.66, freeboard: 0.3, draft: 0.3, bow: 0.85, bilge: 2.6, rake: 0.3 };
const FERRY: Hull = { length: 6.4, beam: 1, stern: 0.85, freeboard: 0.44, draft: 0.4, bow: 0.45, bilge: 6, rake: 0.2 };

/** Half beam along the hull, s = 0 at the transom, 1 at the bow. */
const halfBeam = (h: Hull, s: number) =>
  h.beam * (s < 0.42 ? h.stern + (1 - h.stern) * Math.sin((s / 0.42) * (Math.PI / 2)) : Math.max(0, Math.cos(((s - 0.42) / 0.58) * (Math.PI / 2))) ** h.bow);
/** Sheer line: rises to the bow, a little at the stern. */
const deckAt = (h: Hull, s: number) => h.freeboard * (0.9 + 0.08 * (1 - s) ** 2 + 0.33 * s * s);
const keelAt = (h: Hull, s: number) => -h.draft * Math.sin(Math.PI * (0.15 + 0.85 * s)) ** 0.6;
/** A point on the hull side at height y, for section s and side (+1 starboard). */
function hullPoint(h: Hull, s: number, y: number, side: number): [number, number, number] {
  const deck = deckAt(h, s);
  const keel = keelAt(h, s);
  const yy = Math.min(deck, Math.max(keel, y));
  const r = (deck - yy) / Math.max(deck - keel, 1e-4);
  // Round bilge, a little flare in the topsides.
  const x = side * halfBeam(h, s) * Math.sqrt(Math.max(0, 1 - r ** h.bilge)) * (0.94 + 0.06 * (1 - r));
  // Raked stem at the bow, raked transom at the stern.
  const up = Math.max(0, yy / deck);
  return [x, yy, (s - 0.5) * h.length + h.rake * up * s ** 6 - 0.15 * up * (1 - s) ** 8];
}

const _c = new Color();
function paint(g: BufferGeometry, color: string) {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute("uv");
  if (!geo.attributes.normal) geo.computeVertexNormals();
  _c.set(color);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([_c.r, _c.g, _c.b], i * 3);
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return geo;
}

/** A grid surface from a point function over (i, j), smooth normals. */
function grid(nu: number, nv: number, point: (u: number, v: number) => [number, number, number]) {
  const pos: number[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) pos.push(...point(i / nu, j / nv));
  const index: number[] = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      index.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Topsides, a boot stripe at the water line, bottom paint, deck and transom. */
function hullParts(h: Hull, top: string, stripe: string, deck: string) {
  const S = 28;
  // Height bands (top, bottom) per section: teak toe rail, topsides, boot stripe, bottom paint.
  const bands: [(s: number) => number, (s: number) => number, string][] = [
    [(s) => deckAt(h, s), (s) => deckAt(h, s) - 0.025, "#b39a74"],
    [(s) => deckAt(h, s) - 0.025, () => 0.09, top],
    [() => 0.09, () => 0.025, stripe],
    [() => 0.025, () => -1, "#6d3a33"],
  ];
  const parts: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    for (const [y0, y1, color] of bands) {
      const g = grid(color === top ? 6 : 2, S, (u, v) => hullPoint(h, v, y0(v) + (y1(v) - y0(v)) * u, side));
      parts.push(paint(g, color));
    }
  }
  parts.push(
    paint(
      grid(2, S, (u, v) => {
        const [x, y, z] = hullPoint(h, v, deckAt(h, v), 1);
        return [x * (u * 2 - 1), y + 0.03 * (1 - Math.abs(u * 2 - 1)), z];
      }),
      deck,
    ),
  );
  parts.push(
    paint(
      grid(1, 10, (u, v) => {
        const y = deckAt(h, 0) + (keelAt(h, 0) - deckAt(h, 0)) * v;
        const [x, , z] = hullPoint(h, 0, y, 1);
        return [x * (u * 2 - 1), y, z];
      }),
      top,
    ),
  );
  return parts;
}

/** A box part: size, centre, colour. */
const box = (w: number, hh: number, d: number, x: number, y: number, z: number, color: string) => paint(new BoxGeometry(w, hh, d).translate(x, y, z), color);
const rounded = (w: number, hh: number, d: number, x: number, y: number, z: number, color: string) =>
  paint(new RoundedBoxGeometry(w, hh, d, 2, 0.06).translate(x, y, z), color);
/** A thin rod between two points. */
function rod(a: Vector3, b: Vector3, r: number, color: string) {
  const g = new CylinderGeometry(r, r, a.distanceTo(b), 5, 1, true);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return paint(g, color);
}

const MAST_S = 0.62;
const MAST_Z = (MAST_S - 0.5) * SAILBOAT.length;
const MAST_FOOT = deckAt(SAILBOAT, MAST_S);
const MAST_H = 3.6;
/** Top of the mast above the water (boats sail under both bridges). */
export const MAST_TOP = MAST_FOOT + MAST_H + 0.1;
const BOOM_Y = 0.32;
const BOOM = 0.95 * (MAST_Z + SAILBOAT.length / 2);
const JIB_TACK = new Vector3(0, deckAt(SAILBOAT, 1) + 0.04, SAILBOAT.length / 2 + SAILBOAT.rake - 0.08);
const JIB_HEAD = new Vector3(0, MAST_FOOT + 0.84 * MAST_H, MAST_Z + 0.03);
const JIB_CLEW = new Vector3(0, MAST_FOOT + 0.36, MAST_Z - 0.3);
const JIB_AXIS = JIB_HEAD.clone().sub(JIB_TACK).normalize();

function sailboatGeometry() {
  const hull = hullParts(SAILBOAT, "#f6f4ef", "#3d5afe", "#d9cdb3");
  const masthead = new Vector3(0, MAST_FOOT + MAST_H, MAST_Z);
  const parts = [
    ...hull,
    rounded(0.5, 0.16, 0.9, 0, deckAt(SAILBOAT, 0.5) + 0.07, 0, "#f2efe8"), // cabin
    box(0.51, 0.04, 0.4, 0, deckAt(SAILBOAT, 0.5) + 0.09, -0.02, "#2d3440"), // cabin windows
    box(0.5, 0.025, 0.75, 0, deckAt(SAILBOAT, 0.22) + 0.005, -0.9, "#b4a68c"), // cockpit sole
    paint(new CylinderGeometry(0.028, 0.035, MAST_H, 6).translate(0, MAST_FOOT + MAST_H / 2, MAST_Z), "#cfd3d8"),
    box(0.62, 0.02, 0.03, 0, MAST_FOOT + 0.58 * MAST_H, MAST_Z, "#cfd3d8"), // spreaders
    rod(masthead, new Vector3(0, deckAt(SAILBOAT, 0) + 0.02, -SAILBOAT.length / 2 + 0.06), 0.007, "#5d636b"), // backstay
    rod(new Vector3(0, MAST_FOOT + 0.88 * MAST_H, MAST_Z), JIB_TACK, 0.007, "#5d636b"), // forestay
  ];
  return mergeGeometries(parts);
}

/** Mainsail and boom, pivoting at the mast foot. Camber bulges towards +x. */
function mainsailGeometry() {
  const top = MAST_H * 0.97;
  const sail = grid(6, 10, (u, v) => {
    const chord = BOOM * (1 - v) * (1 + 0.22 * Math.sin(Math.PI * v));
    const depth = 0.11 * chord * (27 / 4) * u * (1 - u) ** 2 * (0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, 0.2 + v)));
    return [depth + 0.12 * v * u * chord, BOOM_Y + v * (top - BOOM_Y), -0.04 - u * chord];
  });
  const boom = paint(new CylinderGeometry(0.022, 0.022, BOOM, 5).rotateX(Math.PI / 2).translate(0, BOOM_Y - 0.03, -BOOM / 2), "#cfd3d8");
  return mergeGeometries([paint(sail, "#f7f5ef"), boom]);
}

/** Jib, pivoting at the tack around the forestay. */
function jibGeometry() {
  const head = JIB_HEAD.clone().sub(JIB_TACK);
  const clew = JIB_CLEW.clone().sub(JIB_TACK);
  const foot = clew.length();
  const g = grid(5, 8, (u, v) => {
    const p = head.clone().multiplyScalar(v).addScaledVector(clew, u * (1 - v));
    p.x = 0.1 * foot * (1 - v) * (27 / 4) * u * (1 - u) ** 2 + 0.06 * v * u * foot;
    return [p.x, p.y, p.z];
  });
  return paint(g, "#f7f5ef");
}

function ferryGeometry() {
  const d = deckAt(FERRY, 0.5);
  const parts = [
    ...hullParts(FERRY, "#f3f1eb", "#3d5afe", "#c9c4b8"),
    rounded(1.72, 0.62, 4.4, 0, d + 0.31, -0.3, "#efece4"),
    rounded(1.42, 0.5, 2.8, 0, d + 0.62 + 0.25, -0.6, "#efece4"),
    rounded(1.0, 0.38, 0.8, 0, d + 1.12 + 0.19, 0.4, "#efece4"),
    box(1.5, 0.04, 3.0, 0, d + 1.14, -0.6, "#9aa0a6"), // upper deck roof
    paint(new CylinderGeometry(0.03, 0.03, 0.9, 5).translate(0, d + 1.5 + 0.45, 0.3), "#cfd3d8"),
  ];
  return mergeGeometries(parts);
}

/** Window bands that light up at night. */
function ferryWindowsGeometry() {
  const d = deckAt(FERRY, 0.5);
  return mergeGeometries([
    new BoxGeometry(1.74, 0.22, 4.0).translate(0, d + 0.38, -0.3),
    new BoxGeometry(1.44, 0.18, 2.5).translate(0, d + 0.9, -0.6),
    new BoxGeometry(1.02, 0.13, 0.82).translate(0, d + 1.36, 0.4),
  ]);
}
const FERRY_MAST = new Vector3(0, deckAt(FERRY, 0.5) + 2.0, 0.3);

/** Sailcloth lets light through: the shaded side still glows when the sun is behind it. */
function sailcloth() {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: DoubleSide });
  material.customProgramCacheKey = () => "bay-sailcloth";
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      ShaderChunk.lights_physical_pars_fragment.replace(
        "vec3 irradiance = dotNL * directLight.color;",
        // Light from behind reaches the diffuse side only (adding it to specular blows up).
        "vec3 irradiance = dotNL * directLight.color;\n" +
          "reflectedLight.directDiffuse += 0.5 * saturate(-dot(geometryNormal, directLight.direction)) * directLight.color * BRDF_Lambert(material.diffuseColor);",
      ),
    );
  };
  return material;
}

// Wake: Kelvin arms, foam along the hull, stern wash. Sailboat units; the
// ferry's is the same texture scaled up.
const WAKE = { width: 3.6, length: 11, front: 2 };
function wakeTexture() {
  const W = 64;
  const H = 192;
  const data = new Uint8Array(W * H * 4);
  const bowZ = SAILBOAT.length / 2;
  for (let j = 0; j < H; j++) {
    const z = WAKE.front - ((j + 0.5) / H) * WAKE.length;
    const behind = bowZ - z;
    for (let i = 0; i < W; i++) {
      const x = ((i + 0.5) / W - 0.5) * WAKE.width;
      const ax = Math.abs(x);
      const arm = Math.exp(-(((ax - (0.12 + 0.36 * behind)) / (0.08 + 0.035 * behind)) ** 2)) * Math.exp(-behind / 2.6) * smoothstep(-0.1, 0.4, behind);
      const s = 1 - behind / SAILBOAT.length;
      const hull = s > 0 && s < 1 ? Math.exp(-(((ax - halfBeam(SAILBOAT, s) - 0.04) / 0.07) ** 2)) * (0.4 + 0.5 * s) : 0;
      const t = behind - SAILBOAT.length;
      const wash = t > -0.2 ? Math.exp(-((ax / (0.3 + 0.05 * Math.max(t, 0))) ** 2)) * Math.exp(-Math.max(t, 0) / 2.4) * smoothstep(-0.2, 0.2, t) : 0;
      const bow = Math.exp(-((behind / 0.18) ** 2)) * Math.exp(-((ax / 0.25) ** 2));
      const grain = 0.55 + 0.45 * hash(Math.floor(x * 9), Math.floor(z * 5));
      const a = Math.min(1, (arm * 0.5 + hull + wash * 0.6 + bow * 0.7) * grain);
      data.set([255, 255, 255, Math.round(a * 255)], (j * W + i) * 4);
    }
  }
  const tex = new DataTexture(data, W, H);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
const wakePlane = () => new PlaneGeometry(WAKE.width, WAKE.length).rotateX(-Math.PI / 2).translate(0, 0, WAKE.front - WAKE.length / 2);

// ---------------------------------------------------------------------------
// Water.

/** Tileable ripple normals: a sum of waves with whole-number wave vectors, mostly downwind. */
function rippleTexture() {
  const N = 256;
  const rand = rng(7);
  const waves: [number, number, number, number][] = [];
  while (waves.length < 24) {
    const angle = (rand() - 0.5) * 2.4;
    const mag = 2 + rand() ** 1.6 * 15;
    const kx = Math.round(Math.cos(angle) * mag);
    const ky = Math.round(Math.sin(angle) * mag);
    if (kx === 0 && ky === 0) continue;
    waves.push([kx, ky, Math.hypot(kx, ky) ** -1.3, rand() * Math.PI * 2]);
  }
  const gx = new Float32Array(N * N);
  const gy = new Float32Array(N * N);
  let max = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let ax = 0;
      let ay = 0;
      for (const [kx, ky, amp, ph] of waves) {
        const c = Math.cos(((kx * x + ky * y) / N) * Math.PI * 2 + ph) * amp;
        ax += c * kx;
        ay += c * ky;
      }
      gx[y * N + x] = ax;
      gy[y * N + x] = ay;
      max = Math.max(max, Math.abs(ax), Math.abs(ay));
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) data.set([128 - (127 * gx[i]) / max, 128 - (127 * gy[i]) / max, 255, 255], i * 4);
  const tex = new DataTexture(data, N, N);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** The shore field as a texture: -2..14 world units in one byte. */
function shoreTexture() {
  const shore = bakeShore();
  const data = new Uint8Array(shore.w * shore.h);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, (shore.data[i] + 2) / 16)) * 255);
  const tex = new DataTexture(data, shore.w, shore.h, RedFormat);
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

let textures: { ripples: DataTexture; shore: DataTexture } | null = null;
const waterTextures = () => (textures ??= { ripples: rippleTexture(), shore: shoreTexture() });

const DAY = { deep: new Color("#2f5a6e"), shallow: new Color("#678e86") };
const NIGHT = { deep: new Color("#0c1a2a"), shallow: new Color("#163038") };

function waterMaterial(mirror: boolean) {
  const { ripples, shore } = waterTextures();
  const uniforms = {
    uTime: { value: 0 },
    uRipples: { value: ripples },
    uShore: { value: shore },
    uShoreBox: { value: new Vector4(SHORE.x0, SHORE.z0, 1 / (SHORE.w * SHORE.cell), 1 / (SHORE.h * SHORE.cell)) },
    uDeep: { value: DAY.deep.clone() },
    uShallow: { value: DAY.shallow.clone() },
    uFoam: { value: new Color("#f1efe8") },
    uSkyTop: { value: new Color("#9fb8cc") },
    uSkyHorizon: { value: new Color("#e8e0d4") },
    uNight: { value: 0 },
    uMirror: { value: null as WebGLRenderTarget["texture"] | null },
    uMirrorMatrix: { value: new Matrix4() },
  };
  const material = new MeshStandardMaterial({ roughness: 0.14, metalness: 0, envMapIntensity: 0 });
  traceInfo.set(material, { kind: "water", ripples, deep: uniforms.uDeep.value });
  if (mirror) material.defines = { MIRROR: "" };
  material.customProgramCacheKey = () => (mirror ? "bay-water-mirror" : "bay-water");
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vWorld;
        #ifdef MIRROR
          uniform mat4 uMirrorMatrix;
          varying vec4 vMirror;
        #endif`,
      )
      .replace(
        "#include <project_vertex>",
        /* glsl */ `#include <project_vertex>
        vWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef MIRROR
          vMirror = uMirrorMatrix * vec4(vWorld, 1.0);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        uniform float uTime;
        uniform sampler2D uRipples;
        uniform sampler2D uShore;
        uniform vec4 uShoreBox;
        uniform vec3 uDeep;
        uniform vec3 uShallow;
        uniform vec3 uFoam;
        uniform vec3 uSkyTop;
        uniform vec3 uSkyHorizon;
        uniform float uNight;
        varying vec3 vWorld;
        #ifdef MIRROR
          uniform sampler2D uMirror;
          varying vec4 vMirror;
        #endif`,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `#include <color_fragment>
        vec2 wp = vWorld.xz;
        float camDist = distance(cameraPosition, vWorld);
        // Two ripple layers drifting at different scales and directions.
        vec2 r1 = texture2D(uRipples, wp * 0.043 + uTime * vec2(0.011, 0.004)).xy * 2.0 - 1.0;
        vec2 r2 = texture2D(uRipples, wp * 0.117 + vec2(0.37, 0.71) + uTime * vec2(-0.006, 0.015)).xy * 2.0 - 1.0;
        float calm = 1.0 - 0.8 * smoothstep(15.0, 180.0, camDist);
        vec2 slope = (r1 * 0.55 + r2 * 0.45) * 0.26 * calm;
        vec3 waterN = normalize(vec3(slope.x, 1.0, slope.y));
        // Shallows and foam from the baked distance to the shore.
        float shoreD = texture2D(uShore, (wp - uShoreBox.xy) * uShoreBox.zw).r * 16.0 - 2.0;
        float shallow = 1.0 - smoothstep(0.0, 5.5, shoreD);
        vec3 body = mix(uDeep, uShallow, shallow * shallow);
        float edge = 1.0 - smoothstep(0.05, 0.6, shoreD + r2.x * 0.15);
        float swash = smoothstep(0.8, 1.0, sin(shoreD * 2.4 + uTime * 0.7 + r1.y * 2.0))
          * smoothstep(0.4, 1.0, shoreD) * (1.0 - smoothstep(0.8, 3.4, shoreD));
        float foam = clamp(edge + swash * 0.2, 0.0, 1.0) * (0.8 + 0.2 * r1.x) * (1.0 - 0.45 * uNight);
        diffuseColor.rgb = mix(body, uFoam, foam);`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.85, foam);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `#include <normal_fragment_maps>
        normal = normalize((viewMatrix * vec4(waterN, 0.0)).xyz);`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        vec3 V = normalize(cameraPosition - vWorld);
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(waterN, V), 0.0), 5.0);
        // The sky gradient sees softer ripples than the mirror (less streaking at grazing angles).
        vec3 R = reflect(-V, normalize(vec3(slope.x * 0.4, 1.0, slope.y * 0.4)));
        vec3 reflection = mix(uSkyHorizon, uSkyTop, smoothstep(-0.02, 0.55, R.y));
        #ifdef MIRROR
          // Ripples bend the reflection less with distance. The sky is left out
          // of the mirror (alpha 0) and drawn as the smooth gradient instead.
          vec4 mirrored = texture2D(uMirror, vMirror.xy / vMirror.w + slope * 0.6 / (vMirror.w + 8.0));
          reflection = mix(reflection, mirrored.rgb, mirrored.a);
        #endif
        float k = clamp(0.1 + fresnel, 0.0, 1.0) * (1.0 - foam);
        outgoingLight = mix(totalDiffuse, reflection, k) + reflectedLight.directSpecular * (1.0 - foam) * 2.0 + totalEmissiveRadiance;
        #include <opaque_fragment>`,
      );
  };
  return { material, uniforms };
}

// Planar reflection (full mode): the scene rendered from below the water,
// clipped at the surface with an oblique near plane (as three's Reflector).
const mirrorCam = new PerspectiveCamera();
const UP = new Vector3(0, 1, 0);
const SURFACE = new Vector3(0, WATER_Y, 0);
const _eye = new Vector3();
const _look = new Vector3();
const _rot = new Matrix4();
const _plane = new Plane();
const _clip = new Vector4();
const _q = new Vector4();
const _size = new Vector2();
const _clear = new Color();
/** Bay objects that should not show in the reflection (they sit on the surface). */
const notReflected = new Set<Object3D>();

function renderMirror(gl: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget, matrix: Matrix4, hidden: Object3D[]) {
  camera.updateMatrixWorld();
  _eye.setFromMatrixPosition(camera.matrixWorld);
  if (_eye.y <= WATER_Y) return;
  _rot.extractRotation(camera.matrixWorld);
  _look.set(0, 0, -1).applyMatrix4(_rot).add(_eye);
  mirrorCam.position.set(_eye.x, 2 * WATER_Y - _eye.y, _eye.z);
  mirrorCam.up.set(0, 1, 0).applyMatrix4(_rot);
  mirrorCam.up.y *= -1;
  mirrorCam.lookAt(_look.x, 2 * WATER_Y - _look.y, _look.z);
  mirrorCam.far = (camera as PerspectiveCamera).far;
  mirrorCam.updateMatrixWorld();
  mirrorCam.projectionMatrix.copy(camera.projectionMatrix);
  matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);

  _plane.setFromNormalAndCoplanarPoint(UP, SURFACE).applyMatrix4(mirrorCam.matrixWorldInverse);
  _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
  const e = mirrorCam.projectionMatrix.elements;
  _q.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
  _clip.multiplyScalar(2 / _clip.dot(_q));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = _clip.z + 1;
  e[14] = _clip.w;

  for (const o of hidden) o.visible = false;
  for (const o of notReflected) o.visible = false;
  const previous = gl.getRenderTarget();
  const shadows = gl.shadowMap.autoUpdate;
  const alpha = gl.getClearAlpha();
  gl.getClearColor(_clear);
  gl.shadowMap.autoUpdate = false;
  gl.setRenderTarget(target);
  gl.setClearColor(_clear, 0);
  gl.state.buffers.depth.setMask(true);
  gl.clear();
  gl.render(scene, mirrorCam);
  gl.setClearColor(_clear, alpha);
  gl.shadowMap.autoUpdate = shadows;
  gl.setRenderTarget(previous);
  for (const o of notReflected) o.visible = true;
  for (const o of hidden) o.visible = true;
}

export function Water({ lite }: { lite: boolean }) {
  const mesh = useRef<Mesh>(null);
  const hemi = useRef<HemisphereLight | null>(null);
  const dome = useRef<Object3D | null>(null);
  const { material, uniforms } = useMemo(() => waterMaterial(!lite), [lite]);
  const mirror = useMemo(() => (lite ? null : new WebGLRenderTarget(1, 1, { type: HalfFloatType })), [lite]);
  useEffect(() => {
    uniforms.uMirror.value = mirror?.texture ?? null;
    return () => {
      material.dispose();
      mirror?.dispose();
    };
  }, [material, mirror, uniforms]);

  useFrame(({ gl, scene, camera, clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    const night = rig.night;
    uniforms.uNight.value = night;
    uniforms.uDeep.value.lerpColors(DAY.deep, NIGHT.deep, night);
    uniforms.uShallow.value.lerpColors(DAY.shallow, NIGHT.shallow, night);
    // The sky the water reflects: the dome's own colours (Atmosphere), else fog and hemisphere light.
    // The sky dome (Atmosphere) is left out of the mirror: stars on rippled water read as noise.
    if (!hemi.current) {
      scene.traverse((o) => {
        if ((o as HemisphereLight).isHemisphereLight) hemi.current = o as HemisphereLight;
        if ((o as Mesh).isMesh && o.renderOrder < 0 && ((o as Mesh).material as MeshBasicMaterial).side === BackSide) dome.current = o;
      });
    }
    const sky = (dome.current as Mesh | null)?.material as ShaderMaterial | undefined;
    if (sky?.uniforms?.top && sky.uniforms.horizon) {
      uniforms.uSkyTop.value.copy(sky.uniforms.top.value);
      uniforms.uSkyHorizon.value.copy(sky.uniforms.horizon.value);
    } else {
      if (scene.fog && "color" in scene.fog) uniforms.uSkyHorizon.value.copy(scene.fog.color);
      if (hemi.current) uniforms.uSkyTop.value.copy(hemi.current.color);
    }
    // Not before `Ready` (scene.tsx) has compiled every shader: a mirror render would compile them one by one.
    // At rest on a photo-real plate (plates.tsx) the water is in the plate: no mirror.
    if (!mirror || !mesh.current || !scene.userData.shadersReady || rig.rest) return;
    gl.getDrawingBufferSize(_size);
    const w = Math.min(1024, Math.round(_size.x / 2));
    const h = Math.round((w * _size.y) / _size.x);
    if (mirror.width !== w || mirror.height !== h) mirror.setSize(w, h);
    renderMirror(gl, scene, camera, mirror, uniforms.uMirrorMatrix.value, dome.current ? [mesh.current, dome.current] : [mesh.current]);
  });

  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} position={[0, WATER_Y, 0]} material={material} receiveShadow>
      <planeGeometry args={[1400, 1400, 8, 8]} />
    </mesh>
  );
}

// ---------------------------------------------------------------------------
// The boats.

const TRACKS = ROUTES.map(track);
const SAILS = ROUTES.map((r, i) => i).filter((i) => ROUTES[i].kind === "sail");
const FERRY_ROUTE = ROUTES.findIndex((r) => r.kind === "ferry");

const o = new Object3D();
const w = new Object3D();
const m = new Matrix4();
const t1 = new Matrix4();
const r1 = new Matrix4();
const s1 = new Matrix4();
const pose: Pose = { x: 0, z: 0, heading: 0 };
const trim: Trim = { boom: 0, camber: 0, heel: 0 };

/** Alcatraz and the boats on the bay. */
export function Bay() {
  const hullGeo = useMemo(() => sailboatGeometry(), []);
  const mainGeo = useMemo(() => mainsailGeometry(), []);
  const jibGeo = useMemo(() => jibGeometry(), []);
  const ferryGeo = useMemo(() => ferryGeometry(), []);
  const windowsGeo = useMemo(() => ferryWindowsGeometry(), []);
  const wakeGeo = useMemo(() => wakePlane(), []);
  const paintMaterial = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: DoubleSide }), []);
  const sailMaterial = useMemo(() => sailcloth(), []);
  const wakeMaterial = useMemo(
    () => new MeshStandardMaterial({ map: wakeTexture(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }),
    [],
  );
  const windows = useGlow("#ffd9a0", 1.6, 0);
  const lamp = useGlow("#fff4dc", 4, 0);

  const hulls = useRef<InstancedMesh>(null);
  const mains = useRef<InstancedMesh>(null);
  const jibs = useRef<InstancedMesh>(null);
  const lights = useRef<InstancedMesh>(null);
  const wakes = useRef<InstancedMesh>(null);
  const ferry = useRef<Group>(null);

  useEffect(() => {
    const wake = wakes.current;
    if (!wake) return;
    notReflected.add(wake);
    return () => void notReflected.delete(wake);
  }, []);

  useFrame(({ clock }) => {
    const [hull, main, jib, light, wake, boat] = [hulls.current, mains.current, jibs.current, lights.current, wakes.current, ferry.current];
    if (!hull || !main || !jib || !light || !wake || !boat) return;
    const time = clock.elapsedTime;
    SAILS.forEach((r, i) => {
      boatAt(TRACKS[r], time + i * 37, pose);
      sailTrim(pose.heading, trim);
      o.position.set(pose.x, WATER_Y + Math.sin(time * 1.6 + i * 1.7) * 0.025, pose.z);
      o.rotation.set(Math.sin(time * 1.25 + i) * 0.025, pose.heading, trim.heel + Math.sin(time * 1.05 + i * 2.1) * 0.03, "YXZ");
      o.updateMatrix();
      hull.setMatrixAt(i, o.matrix);
      const camber = (trim.camber < 0 ? -1 : 1) * Math.max(0.2, Math.abs(trim.camber));
      s1.makeScale(camber, 1, 1);
      m.copy(o.matrix).multiply(t1.makeTranslation(0, MAST_FOOT, MAST_Z)).multiply(r1.makeRotationY(trim.boom)).multiply(s1);
      main.setMatrixAt(i, m);
      m.copy(o.matrix).multiply(t1.makeTranslation(JIB_TACK.x, JIB_TACK.y, JIB_TACK.z)).multiply(r1.makeRotationAxis(JIB_AXIS, trim.boom * 0.75)).multiply(s1);
      jib.setMatrixAt(i, m);
      m.copy(o.matrix).multiply(t1.makeTranslation(0, MAST_FOOT + MAST_H + 0.04, MAST_Z));
      light.setMatrixAt(i, m);
      w.position.set(pose.x, WATER_Y + 0.012, pose.z);
      w.rotation.set(0, pose.heading, 0);
      w.scale.setScalar(1);
      w.updateMatrix();
      wake.setMatrixAt(i, w.matrix);
    });

    boatAt(TRACKS[FERRY_ROUTE], time, pose);
    boat.position.set(pose.x, WATER_Y + Math.sin(time * 1.1) * 0.02, pose.z);
    boat.rotation.set(Math.sin(time * 0.9) * 0.012, pose.heading, Math.sin(time * 0.7 + 1) * 0.015, "YXZ");
    boat.updateMatrix();
    m.copy(boat.matrix).multiply(t1.makeTranslation(FERRY_MAST.x, FERRY_MAST.y, FERRY_MAST.z));
    light.setMatrixAt(SAILS.length, m);
    w.position.set(pose.x, WATER_Y + 0.012, pose.z);
    w.rotation.set(0, pose.heading, 0);
    w.scale.setScalar(FERRY.length / SAILBOAT.length);
    w.updateMatrix();
    wake.setMatrixAt(SAILS.length, w.matrix);

    for (const mesh of [hull, main, jib, light, wake]) mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <Alcatraz waterY={WATER_Y} unreflected={notReflected} />
      <group userData={LIVE}>
        <instancedMesh ref={hulls} args={[hullGeo, paintMaterial, SAILS.length]} castShadow receiveShadow frustumCulled={false} />
        <instancedMesh ref={mains} args={[mainGeo, sailMaterial, SAILS.length]} castShadow receiveShadow frustumCulled={false} />
        <instancedMesh ref={jibs} args={[jibGeo, sailMaterial, SAILS.length]} castShadow receiveShadow frustumCulled={false} />
        <instancedMesh ref={lights} args={[undefined, lamp, SAILS.length + 1]} frustumCulled={false}>
          <sphereGeometry args={[0.045, 6, 4]} />
        </instancedMesh>
        <instancedMesh ref={wakes} args={[wakeGeo, wakeMaterial, SAILS.length + 1]} receiveShadow frustumCulled={false} />
        <group ref={ferry} matrixAutoUpdate={false}>
          <mesh geometry={ferryGeo} material={paintMaterial} castShadow receiveShadow />
          <mesh geometry={windowsGeo} material={windows} />
        </group>
      </group>
    </>
  );
}
/** Every generated mesh, so tests can check them (one NaN vertex blanks the screen through bloom). */
export const bayGeometries = () => ({
  sailboat: sailboatGeometry(),
  mainsail: mainsailGeometry(),
  jib: jibGeometry(),
  ferry: ferryGeometry(),
  ferryWindows: ferryWindowsGeometry(),
  yerbaBuena: yerbaBuenaGeometry(),
  ...islandGeometries(),
});
