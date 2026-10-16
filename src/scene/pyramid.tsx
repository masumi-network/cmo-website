"use client";

// 15:00 Transamerica Pyramid. Cuso plants a flag on the spire.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute, type Group } from "three";
import { PLAZA, heightAt } from "@/lib/terrain";
import { merged, useLandmarkTextures } from "./landmark-kit";
import { downtownMaterial } from "./materials";
import { useGlow } from "./parts";
import { PART } from "./towers";
import { PYRAMID, WINGS, pyramidHalf } from "./layout";

export { PYRAMID, WINGS, pyramidHalf };

/**
 * The spire rises from the north face just behind the platform's edge: from
 * the 15:00 camera (yaw 285) it stands to Cuso's left, never behind his body,
 * and he can turn on the platform without touching it.
 */
export const SPIRE = { x: 0, z: -0.93, half: 0.12, base: 23, top: 36.5 };
/** Cuso's flag on the spire: a 1.2 x 0.8 cloth at height y (over his head, even when he hops), swinging +-swing radians. */
export const FLAG = { y: 31, w: 1.2, h: 0.8, swing: 0.25 };
/** The red aircraft light on the tip of the spire. */
export const BEACON: [number, number, number] = [SPIRE.x, SPIRE.top + 0.03, SPIRE.z];

/**
 * The precast facade, all inside the `pyramidHalf` envelope: a street-level
 * arcade of A-frame columns up to `arcade`, then `floors` storeys of window
 * bays up to the precast crown. Each storey is a floor band (`band` tall)
 * under a row of windows between mullion ribs (`rib` wide, every `col`), with
 * the glass `depth` back from the face. Window rows get shorter up the taper:
 * a solid corner panel fills in where a whole bay no longer fits.
 */
export const FACADE = { arcade: 2.4, crown: SPIRE.base, floors: 38, band: 0.2, col: 0.22, rib: 0.1, depth: 0.06 };

const ARCADE = {
  /** The beam over the arcade starts this far under the first floor band. */
  beam: 0.35,
  /** The A-frames: apex spacing, leg width and depth, corner column width. */
  span: 1.85,
  leg: 0.26,
  deep: 0.24,
  corner: 0.4,
  /** How far the lobby glass sits behind the face (under the beam). */
  lobby: 0.8,
  /** Lobby bay width (the middle one is the entrance). */
  bay: 0.8,
};

/**
 * The crown: `bands` courses of precast panels up to Cuso's platform, each `panel` wide, drawn by
 * `downtownMaterial` part 5 (exposed aggregate, joints, chipped arrises). Its aUv counts panels across
 * (a joint at each whole number) and bands up (plus where up its band); the spire shares the part as
 * plain aluminium (aUv v < 0).
 */
export const CROWN = { part: 5, panel: 0.5, bands: 9 };

const COLOR = { precast: "#ece9e2", plaza: "#c8c3b9", glass: "#3b4651", lobby: "#d4cfc5", crown: "#e7e3da", spire: "#e0e3e5" };

type V3 = [number, number, number];
type Surface = { part: number; color: string; flood?: number; uv?: (p: V3) => [number, number] };
type Face = { n: V3; t: V3 };

/** The four faces: outward normal (horizontal) and the direction along the face. */
const FACES: Face[] = [0, 1, 2, 3].map((k) => {
  const a = (k * Math.PI) / 2;
  return { n: [Math.sin(a), 0, Math.cos(a)], t: [Math.cos(a), 0, -Math.sin(a)] };
});
/** A point on face f: `u` along it, height `y`, `dep` in from the envelope. */
const at = (f: Face, u: number, y: number, dep: number): V3 => {
  const r = pyramidHalf(y) - dep;
  return [f.n[0] * r + f.t[0] * u, y, f.n[2] * r + f.t[2] * u];
};
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mid = (p: V3[]): V3 => [0, 1, 2].map((k) => p.reduce((s, v) => s + v[k], 0) / p.length) as V3;

/** Box corners by (u, y, depth) index, and the faces of a block by name. */
const FACE_OF = {
  front: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
  back: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  bottom: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  top: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
  left: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]],
  right: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
} as const;
type Side = keyof typeof FACE_OF;

/**
 * The whole pyramid as one geometry for `downtownMaterial` (the towers' shader:
 * `aUv` counts window columns and storeys, `aInfo` is part, seed, floodlight
 * height). Local to its centre at ground level `ground` (only the floodlight
 * height is in world units).
 */
/** Flat-shaded triangles with the attributes `downtownMaterial` reads. */
function builder() {
  const out = { pos: [] as number[], nor: [] as number[], col: [] as number[], uv: [] as number[], info: [] as number[] };
  const c = new Color();

  /** A flat quad (or triangle), facing away from `from`. */
  const poly = (p: V3[], from: V3, s: Surface) => {
    let n = p.length === 4 ? cross(sub(p[2], p[0]), sub(p[3], p[1])) : cross(sub(p[1], p[0]), sub(p[2], p[0]));
    const len = Math.hypot(...n);
    if (len < 1e-9) return;
    n = n.map((v) => v / len) as V3;
    if (dot(n, sub(mid(p), from)) < 0) n = n.map((v) => -v) as V3;
    const tris = p.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]];
    c.set(s.color);
    for (const tri of tris) {
      const [a, b, d] = tri.map((k) => p[k]);
      const order = dot(cross(sub(b, a), sub(d, a)), n) >= 0 ? tri : [tri[0], tri[2], tri[1]];
      for (const k of order) {
        out.pos.push(...p[k]);
        out.nor.push(...n);
        out.col.push(c.r, c.g, c.b);
        out.uv.push(...(s.uv?.(p[k]) ?? [0, 0]));
        out.info.push(s.part, 0.3, s.flood ?? 0);
      }
    }
  };
  const geometry = () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(out.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(out.nor, 3));
    g.setAttribute("color", new Float32BufferAttribute(out.col, 3));
    g.setAttribute("aUv", new Float32BufferAttribute(out.uv, 2));
    g.setAttribute("aInfo", new Float32BufferAttribute(out.info, 3));
    g.computeBoundingSphere();
    return g;
  };
  return { poly, geometry };
}

export function pyramidGeometry(ground = 0) {
  const { poly, geometry } = builder();

  /** A block on face f, its corners given in (u, y, depth); only the named sides are built, facing out of the block (or away from `from`). */
  const block = (f: Face, corner: (iu: number, iy: number, id: number) => [number, number, number], sides: Side[], s: Surface, from?: V3) => {
    const pt = (iu: number, iy: number, id: number) => {
      const [u, y, dep] = corner(iu, iy, id);
      return at(f, u, y, dep);
    };
    const centre = from ?? mid([0, 1].flatMap((iu) => [0, 1].flatMap((iy) => [0, 1].map((id) => pt(iu, iy, id)))));
    for (const side of sides) poly(FACE_OF[side].map(([iu, iy, id]) => pt(iu, iy, id)), centre, s);
  };
  const axis = (y: number): V3 => [0, y, 0];

  const precast: Surface = { part: PART.plain, color: COLOR.precast };
  const { arcade, crown, floors, band, col, rib, depth } = FACADE;
  const storey = (crown - arcade) / floors;
  const floorY = (k: number) => arcade + k * storey;
  const soffit = arcade - ARCADE.beam;
  const flood = ground + crown - 0.4;

  for (const f of FACES) {
    const along = (p: V3) => dot(p, f.t);

    // Glass: one recessed plane per face behind the ribs and bands; aUv counts bays (ribs at whole numbers) and storeys.
    const glass: Surface = { part: PART.glass, color: COLOR.glass, uv: (p) => [along(p) / col, (p[1] - arcade) / storey] };
    block(f, (iu, iy) => {
      const y = iy ? crown : arcade;
      return [(iu ? 1 : -1) * (pyramidHalf(y) - depth), y, depth];
    }, ["front"], glass, axis(arcade));

    // Floor bands (the first one is the deep beam over the arcade).
    for (let k = 0; k < floors; k++) {
      const y0 = k === 0 ? soffit : floorY(k);
      const y1 = floorY(k) + band;
      block(f, (iu, iy, id) => {
        const y = iy ? y1 : y0;
        const dep = id ? depth : 0;
        return [(iu ? 1 : -1) * (pyramidHalf(y) - dep), y, dep];
      }, k === 0 ? ["front", "top"] : ["front", "top", "bottom"], precast);
    }

    // Mullion ribs, each up to the last storey where its whole bay still fits; corner panels beside the last one.
    const last = (k: number) => Math.floor((pyramidHalf(floorY(k + 1)) - 0.06 - rib / 2) / col);
    const lastRib = last(0);
    for (let j = -lastRib; j <= lastRib; j++) {
      let top = 0;
      while (top < floors && last(top) >= Math.abs(j)) top++;
      if (top === 0) continue;
      const y1 = floorY(top);
      block(f, (iu, iy, id) => [j * col + (iu ? 1 : -1) * (rib / 2), iy ? y1 : arcade, id ? depth : 0], ["front", "left", "right"], precast);
    }
    for (let k = 0; k < floors; k++) {
      const [y0, y1] = [floorY(k) + band, floorY(k + 1)];
      const u = last(k) * col;
      for (const s of [-1, 1]) poly([at(f, s * u, y0, 0), at(f, s * pyramidHalf(y0), y0, 0), at(f, s * pyramidHalf(y1), y1, 0), at(f, s * u, y1, 0)], axis(y0), precast);
    }

    // Arcade: sloped A-frame columns in the face (a Warren truss), heavy corner columns, the soffit and the lobby glass.
    const { span, leg, deep, corner } = ARCADE;
    for (let i = -1; i <= 1; i++) {
      for (const s of [-1, 1]) {
        const foot = (i + s * 0.5) * span;
        block(f, (iu, iy, id) => [(iy ? i * span : foot) + (iu ? 1 : -1) * (leg / 2), iy ? soffit : 0, id ? deep : 0], ["front", "back", "left", "right"], precast);
      }
    }
    for (const s of [-1, 1]) {
      block(f, (iu, iy, id) => {
        const y = iy ? soffit : 0;
        const dep = id ? deep : 0;
        return [s * (iu ? pyramidHalf(y) - dep : pyramidHalf(y) - corner), y, dep];
      }, ["front", "back", "left"], precast);
    }
    const lobby = pyramidHalf(soffit) - ARCADE.lobby;
    poly([at(f, -pyramidHalf(soffit), soffit, 0), at(f, pyramidHalf(soffit), soffit, 0), at(f, lobby, soffit, pyramidHalf(soffit) - lobby), at(f, -lobby, soffit, pyramidHalf(soffit) - lobby)], axis(soffit + 1), precast);
    const plaza = 0.03;
    const glazed: Surface = { part: PART.storefront, color: COLOR.lobby, uv: (p) => [along(p) / ARCADE.bay + 0.5, (p[1] / soffit) * 0.86] };
    const wall = (y: number, u: number): V3 => at(f, u, y, pyramidHalf(y) - lobby);
    poly([wall(plaza, -lobby), wall(plaza, lobby), wall(soffit, lobby), wall(soffit, -lobby)], axis(1), glazed);
    // The plaza under the arcade, and its edge down into the ground.
    const plazaSurf: Surface = { part: PART.plain, color: COLOR.plaza };
    const base = pyramidHalf(0);
    poly([[f.n[0] * base - f.t[0] * base, plaza, f.n[2] * base - f.t[2] * base], [f.n[0] * base + f.t[0] * base, plaza, f.n[2] * base + f.t[2] * base], [0, plaza, 0]], [0, -1, 0], plazaSurf);
    poly([at(f, -base, -0.3, pyramidHalf(-0.3) - base), at(f, base, -0.3, pyramidHalf(-0.3) - base), at(f, base, plaza, pyramidHalf(plaza) - base), at(f, -base, plaza, pyramidHalf(plaza) - base)], axis(0), plazaSurf);

    // The precast crown: windowless bands of panels with fine joints, 0.012 proud of the faces, up to Cuso's platform.
    const { bands, panel } = CROWN;
    const joint = 0.025;
    const ph = (PYRAMID.height - crown) / bands;
    for (let p = 0; p < bands; p++) {
      const y0 = crown + p * ph;
      const y1 = p === bands - 1 ? PYRAMID.height : y0 + ph - joint;
      const course: Surface = { part: CROWN.part, color: COLOR.crown, flood, uv: (q) => [along(q) / panel, p + (q[1] - y0) / (y1 - y0)] };
      block(f, (iu, iy, id) => {
        const y = iy ? y1 : y0;
        const dep = id ? (p === 0 && !iy ? depth : 0.01) : -0.012;
        return [(iu ? 1 : -1) * (pyramidHalf(y) - dep), y, dep];
      }, p === bands - 1 ? ["front", "bottom"] : ["front", "top", "bottom"], course);
      // the joint behind: the middle of a panel, in shade
      const back: Surface = { ...course, uv: (q) => [along(q) / panel, p + 0.5] };
      if (p < bands - 1) block(f, (iu, iy) => [(iu ? 1 : -1) * (pyramidHalf(iy ? y0 + ph : y1) - 0.01), iy ? y0 + ph : y1, 0.01], ["front"], back, axis(y1));
    }
  }

  // The platform on top, where Cuso stands: the same precast, its slabs a panel square.
  const top = pyramidHalf(PYRAMID.height) + 0.012;
  const slab: Surface = { part: CROWN.part, color: COLOR.crown, flood, uv: (q) => [q[0] / CROWN.panel, q[2] / CROWN.panel] };
  poly([[-top, PYRAMID.height, -top], [top, PYRAMID.height, -top], [top, PYRAMID.height, top], [-top, PYRAMID.height, top]], axis(0), slab);

  // The spire: a slim four-sided needle of aluminium rising out of the north face (aUv v < 0: plain metal).
  const { x, z, half, base, top: tip } = SPIRE;
  const apex: V3 = [x, tip, z];
  const sq: V3[] = [[x - half, base, z - half], [x + half, base, z - half], [x + half, base, z + half], [x - half, base, z + half]];
  const needle: Surface = { part: CROWN.part, color: COLOR.spire, flood, uv: () => [0, -1] };
  for (let k = 0; k < 4; k++) poly([sq[k], sq[(k + 1) % 4], apex], [x, base + (tip - base) / 3, z], needle);

  // Wings: plain precast shafts with plumb outer walls (lift shaft east, stairs west).
  for (const [side, y0, y1, w] of WINGS) {
    const [xi, xo] = [side * 0.4, side * pyramidHalf(y0)];
    const corner = (ix: number, iy: number, iz: number): V3 => [ix ? xo : xi, iy ? y1 : y0, (iz ? 1 : -1) * (w / 2)];
    const centre: V3 = [(xi + xo) / 2, (y0 + y1) / 2, 0];
    const quads: [number, number, number][][] = [
      [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], // outer wall
      [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], // north
      [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // south
      [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]], // top
      [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // underside
    ];
    for (const q of quads) poly(q.map(([a, b, d]) => corner(a, b, d)), centre, precast);
  }

  return geometry();
}

/**
 * Retaining walls round the plaza cut (PLAZA in terrain.ts), local to the
 * Pyramid's centre at plaza level: on its north, west and east edges, from the
 * plaza up to the ground just outside, at the ground mesh's own grid points
 * (every 0.5), so each wall closes the step in the terrain exactly.
 */
export function plazaWallGeometry() {
  const { poly, geometry } = builder();
  const [cx, cz, y] = [PYRAMID.x, PYRAMID.z, PLAZA.y];
  const stone: Surface = { part: PART.plain, color: COLOR.plaza };
  const grid = (a: number, b: number) => [a, ...Array.from({ length: Math.floor(b * 2) - Math.ceil(a * 2) + 1 }, (_, i) => (Math.ceil(a * 2) + i) / 2).filter((v) => v > a && v < b), b];
  /** One wall along a run of points (x, z), each up to the ground outside; facing `inward`. */
  const wall = (pts: [number, number][], out: [number, number]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      const [ta, tb] = [a, b].map(([x, z]) => Math.max(y, heightAt(x + out[0] * 1e-4, z + out[1] * 1e-4)));
      if (Math.max(ta, tb) - y < 1e-3) continue;
      const v = (x: number, h: number, z: number): V3 => [x - cx, h - y, z - cz];
      poly([v(a[0], y, a[1]), v(b[0], y, b[1]), v(b[0], tb, b[1]), v(a[0], ta, a[1])], v((a[0] + b[0]) / 2 + out[0], y, (a[1] + b[1]) / 2 + out[1]), stone);
    }
  };
  const { x0, x1, z0 } = PLAZA;
  const south = -8; // the ground south of here is flat (the plaza is a hair above it)
  wall(grid(x0, x1).map((x) => [x, z0]), [0, -1]);
  wall(grid(z0, south).map((z) => [x0, z]), [-1, 0]);
  wall(grid(z0, south).map((z) => [x1, z]), [1, 0]);
  return geometry();
}

/** 15:00 Transamerica Pyramid. Cuso plants a flag on the spire. */
export function Pyramid() {
  const flag = useRef<Group>(null);
  const ground = heightAt(PYRAMID.x, PYRAMID.z);
  const { stone } = useLandmarkTextures();
  // The towers' material: same shader program, so the windows light up with downtown at night.
  // Its glass stays plain: the curtain wall detail is for the glass towers.
  const material = useMemo(() => downtownMaterial(stone, false), [stone]);
  const geometry = useMemo(() => merged([pyramidGeometry(ground), plazaWallGeometry()]), [ground]);
  const beacon = useGlow("#ff2414", 3, 0.3);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.4) * FLAG.swing;
  });
  return (
    <group position={[PYRAMID.x, ground, PYRAMID.z]}>
      <mesh geometry={geometry} material={material} castShadow receiveShadow />
      <mesh position={BEACON} material={beacon}>
        <sphereGeometry args={[0.05, 8, 6]} />
      </mesh>
      <group ref={flag} position={[SPIRE.x, FLAG.y, SPIRE.z]}>
        <mesh position={[FLAG.w / 2, 0, 0]}>
          <planeGeometry args={[FLAG.w, FLAG.h]} />
          <meshStandardMaterial color="#ffffff" side={DoubleSide} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}
