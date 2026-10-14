"use client";

// The Bay Bridge, the Golden Gate and the bridge-end roads.

import { useLayoutEffect, useMemo, useRef } from "react";
import { worldMaterial } from "./materials";
import { useGlow, type V3 } from "./parts";
import { BufferGeometry, Color, CatmullRomCurve3, DoubleSide, Float32BufferAttribute, TubeGeometry, Vector3, MeshStandardMaterial, Object3D, type InstancedMesh } from "three";
import { useConcrete, useLandmarkTextures, merged } from "./landmark-kit";
import { BAY_ANCHORS, CABLE, DECKS, DECK_Y, ROADS, SLAB, archWall, bayDeckY, beam, deckGeometry, mason, masonryGeometry, piers, prism, railingGeometry, roadGeometry, spanGeometry, type Mason, type Road } from "./roads";

function catenary(x0: number, y0: number, x1: number, y1: number, sag: number, z: number, along: "x" | "z", n = 24): V3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    const a = x0 + (x1 - x0) * s;
    const y = y0 + (y1 - y0) * s - sag * 4 * s * (1 - s);
    return along === "x" ? [a, y, z] : [z, y, a];
  });
}

export const BAY_TOWERS = [52, 70, 88, 106];
const [BAY_WEST, BAY_EAST] = BAY_ANCHORS;
/** Cables run from the anchorages (ends hidden inside them) over the towers. */
const BAY_CABLES: [number, number, number, number, number][] = [
  [BAY_WEST, bayDeckY(BAY_WEST) - 0.4, BAY_TOWERS[0], 26, 6],
  ...BAY_TOWERS.slice(1).map((x, i): [number, number, number, number, number] => [BAY_TOWERS[i], 26, x, 26, 12]),
  [BAY_TOWERS[BAY_TOWERS.length - 1], 26, BAY_EAST, bayDeckY(BAY_EAST) - 0.4, 6],
];
const roadNamed = (name: string) => ROADS.find((r) => r.name === name) as Road;
/**
 * Bay Bridge towers: two legs (`leg`: x by z) with the road passing between
 * them (inner faces at `inner`), X-bracing (`braces`: centre heights, `rise`:
 * height each diagonal climbs) and struts (`struts`, `strutH` tall), all clear
 * of the traffic on the deck.
 */
export const BAY_TOWER = { inner: 1.8, leg: [0.9, 0.7], braces: [11.5, 18.5], rise: 2.17, struts: [DECK_Y - 1.5, 15, 22, 25.7], strutH: 0.5 };
const BAY_LEG = BAY_TOWER.inner + BAY_TOWER.leg[1] / 2;
const BAY_BRACE = { len: Math.hypot(2 * BAY_LEG, BAY_TOWER.rise), angle: Math.atan2(BAY_TOWER.rise, 2 * BAY_LEG) };

/** Bay Bridge (west span): steel towers with X-bracing, cables, suspenders, the light sculpture, side spans down to the anchorages, the Yerba Buena tunnel portal. */
export function BayBridge() {
  const lights = useRef<InstancedMesh>(null);
  const glow = useGlow("#eef3ff", 5, 0);
  const { baysteel } = useLandmarkTextures();
  const steel = useMemo(() => worldMaterial(baysteel, 2.2), [baysteel]);
  const deck = useMemo(() => worldMaterial(baysteel, 2.2, "#b4b0aa"), [baysteel]);
  const concrete = useConcrete();
  const cableMat = useMemo(() => new MeshStandardMaterial({ color: "#8d959e", roughness: 0.45, metalness: 0.4 }), []);
  const lightPoints = useMemo(() => {
    const pts: V3[] = [];
    for (const z of [14 - CABLE, 14 + CABLE]) {
      for (const [x0, y0, x1, y1, sag] of BAY_CABLES) {
        for (const p of catenary(x0, y0, x1, y1, sag, z, "x", 20)) {
          for (let y = bayDeckY(p[0]) + 0.6; y < p[1]; y += 1.4) pts.push([p[0], y, z]);
        }
      }
    }
    return pts;
  }, []);
  const cables = useMemo(
    () =>
      [14 - CABLE, 14 + CABLE].flatMap((z) =>
        BAY_CABLES.map(([x0, y0, x1, y1, sag]) => new TubeGeometry(new CatmullRomCurve3(catenary(x0, y0, x1, y1, sag, z, "x", 40).map((p) => new Vector3(...p))), 80, 0.18, 6)),
      ),
    [],
  );
  const suspenders = useMemo(() => {
    const pts: number[] = [];
    for (const z of [14 - CABLE, 14 + CABLE]) {
      for (const [x0, y0, x1, y1, sag] of BAY_CABLES) {
        for (const [x, y] of catenary(x0, y0, x1, y1, sag, z, "x", Math.round(Math.abs(x1 - x0) / 1.6))) {
          const d = bayDeckY(x);
          if (y > d + 0.8) pts.push(x, y, z, x, d - 0.1, z); // ends hidden inside the deck
        }
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pts, 3));
  }, []);
  // Side spans and the open railing along the whole deck; the concrete (bayMasonry) and the tunnel's dark mouth.
  const parts = useMemo(() => ({ spans: merged([spanGeometry(roadNamed("bay-bridge-west")), spanGeometry(roadNamed("bay-bridge-east")), railingGeometry(DECKS[1].points)]), ...bayMasonry() }), []);

  useLayoutEffect(() => {
    const mesh = lights.current;
    if (!mesh) return;
    const o = new Object3D();
    lightPoints.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lightPoints]);

  // The level main deck between the end towers; its top sits just under the road (Roads draws the asphalt).
  const x0 = BAY_TOWERS[0];
  const length = BAY_TOWERS[BAY_TOWERS.length - 1] - x0;
  return (
    <group>
      <mesh position={[x0 + length / 2, DECK_Y - 0.28, 14]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[length, 0.5, 3]} />
      </mesh>
      <mesh position={[x0 + length / 2, DECK_Y - 1.08, 14]} material={steel} castShadow>
        <boxGeometry args={[length, 1.1, 2.6]} />
      </mesh>
      <mesh geometry={parts.spans} material={steel} castShadow receiveShadow />
      <mesh geometry={parts.concrete} material={concrete} castShadow receiveShadow />
      <mesh geometry={parts.tunnel}>
        <meshBasicMaterial vertexColors side={DoubleSide} />
      </mesh>
      {BAY_TOWERS.map((x) => (
        <group key={x} position={[x, 0, 14]}>
          {[-BAY_LEG, BAY_LEG].map((dz) => (
            <mesh key={dz} position={[0, 13, dz]} material={steel} castShadow>
              <boxGeometry args={[BAY_TOWER.leg[0], 26, BAY_TOWER.leg[1]]} />
            </mesh>
          ))}
          {/* X-bracing between the legs, above the traffic */}
          {BAY_TOWER.braces.map((y) =>
            [-1, 1].map((k) => (
              <mesh key={`${y}${k}`} position={[0, y, 0]} rotation-x={k * BAY_BRACE.angle} material={steel} castShadow>
                <boxGeometry args={[0.35, 0.35, BAY_BRACE.len]} />
              </mesh>
            )),
          )}
          {BAY_TOWER.struts.map((y) => (
            <mesh key={y} position={[0, y, 0]} material={steel} castShadow>
              <boxGeometry args={[0.6, BAY_TOWER.strutH, 2 * BAY_LEG]} />
            </mesh>
          ))}
        </group>
      ))}
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cableMat} castShadow />
      ))}
      <lineSegments geometry={suspenders}>
        <lineBasicMaterial color="#7d8690" transparent opacity={0.7} />
      </lineSegments>
      <instancedMesh ref={lights} args={[undefined, glow, lightPoints.length]}>
        {/* a glowing dot: 8 triangles each, 1,400 of them */}
        <octahedronGeometry args={[0.08, 0]} />
      </instancedMesh>
    </group>
  );
}

/**
 * The Yerba Buena tunnel portal: the road's end (x, y, z) at the island's
 * flank, its arched opening (heights from the road), the front of its stepped
 * surround, and the dark face just in front of the hill (`plug`), which cars
 * drive into.
 */
const [tunnelX, tunnelY, tunnelZ] = roadNamed("bay-bridge-east").points.at(-1) as [number, number, number];
export const PORTAL = { x: tunnelX, y: tunnelY, z: tunnelZ, half: 1.6, spring: 0.9, rise: 0.95, front: tunnelX - 0.76, plug: tunnelX - 0.02 };

/**
 * A Bay Bridge anchorage at x: a massive block, under the road, of tall
 * pilasters with recessed bays between them, a frieze and cornice, and a
 * stepped top. Inside its footing in the water (half 1.15 by 2.25).
 */
function bayAnchorage(m: Mason, x: number) {
  const T = bayDeckY(x) - SLAB;
  const at: [number, number] = [x, 14];
  prism(m, { at, y: [-1.2, 0.3], half: [1.15, 2.25] });
  prism(m, { at, y: [0.3, 0.42], half: [1.15, 2.25], halfTop: [1.08, 2.18] });
  prism(m, { at, y: [0.42, T - 0.85], half: [0.92, 2.02], top: T - 1.15 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) prism(m, { at: [x + sx * 0.77, 14 + sz * 1.85], y: [0.42, T - 1.15], half: [0.3, 0.3], top: T - 1.15 });
    for (const dz of [-0.85, 0, 0.85]) prism(m, { at: [x + sx * 0.98, 14 + dz], y: [0.42, T - 1.15], half: [0.09, 0.14], top: T - 1.15 });
    prism(m, { at: [x, 14 + sx * 2.07], y: [0.42, T - 1.15], half: [0.12, 0.08], top: T - 1.15 });
  }
  prism(m, { at, y: [T - 1.15, T - 0.85], half: [1.07, 2.17] });
  prism(m, { at, y: [T - 0.85, T - 0.75], half: [1.07, 2.17], halfTop: [1.15, 2.25] });
  prism(m, { at, y: [T - 0.75, T - 0.65], half: [1.15, 2.25] });
  prism(m, { at, y: [T - 0.65, T - 0.3], half: [1.02, 2.08] });
  prism(m, { at, y: [T - 0.3, T - 0.06], half: [0.94, 1.94] });
  prism(m, { at, y: [T - 0.06, T], half: [0.94, 1.94], halfTop: [0.9, 1.9] });
}

/** A Bay Bridge tower pier: a battered caisson with chamfered corners, a pier cap, plinths under the steel legs. */
function bayPier(m: Mason, x: number) {
  const at: [number, number] = [x, 14];
  prism(m, { at, y: [-1.2, 1.9], half: [1.2, 2.7], halfTop: [1.08, 2.55], chamfer: [0.35, 0.3], top: 1.9 });
  prism(m, { at, y: [1.9, 2.05], half: [1.08, 2.55], halfTop: [1.18, 2.66], chamfer: [0.3, 0.32] });
  prism(m, { at, y: [2.05, 2.4], half: [1.18, 2.66], chamfer: 0.32 });
  prism(m, { at, y: [2.4, 2.48], half: [1.18, 2.66], halfTop: [1.12, 2.6], chamfer: [0.32, 0.3] });
  for (const s of [-1, 1]) {
    prism(m, { at: [x, 14 + s * BAY_LEG], y: [2.48, 2.7], half: [0.6, 0.5] });
    prism(m, { at: [x, 14 + s * BAY_LEG], y: [2.7, 2.76], half: [0.6, 0.5], halfTop: [0.54, 0.44] });
  }
}

/**
 * The Yerba Buena tunnel portal: a headwall against the island with an
 * arched opening over the road's last stretch, a stepped surround (two
 * rings), stepped buttresses either side and a coping.
 */
function portal(m: Mason) {
  const { x, y, z, half, spring, rise } = PORTAL;
  const arch = { at: [x, z] as [number, number], y, dir: [1, 0] as [number, number], half, spring, rise };
  archWall(m, { ...arch, depth: [-0.6, 0.3], base: -1.2, outer: { half: 2.2, top: y + 2.6 } });
  archWall(m, { ...arch, depth: [-0.68, -0.6], base: -1.2, outer: { band: 0.34 }, top: y + 2.6 });
  archWall(m, { ...arch, depth: [PORTAL.front - x, -0.68], base: -1.2, outer: { band: 0.16 }, top: y + 2.6 });
  prism(m, { at: [x - 0.15, z], y: [y + 2.6, y + 2.72], half: [0.5, 2.2], bottom: true });
  for (const s of [-1, 1]) {
    const at: [number, number] = [x - 0.3, z + s * 2.35];
    prism(m, { at, y: [-1.2, y + 2.3], half: [0.45, 0.25], top: y + 2.3 });
    prism(m, { at, y: [y + 2.3, y + 2.75], half: [0.37, 0.2] });
    prism(m, { at, y: [y + 2.75, y + 3.0], half: [0.29, 0.15], halfTop: [0.22, 0.1] });
  }
}

/** The tunnel's dark mouth: the dark face with a soft glow from the far end, lamps on the vault and, smaller, deeper in. */
function tunnelMouth() {
  const { y, z, half, spring, rise, plug: x } = PORTAL;
  const pos: number[] = [];
  const col: number[] = [];
  type V = [number, number, number];
  const face = (pts: V[], c: V[]) => {
    for (let i = 1; i < pts.length - 1; i++) {
      for (const k of [0, i, i + 1]) {
        pos.push(...pts[k]);
        col.push(...c[k]);
      }
    }
  };
  const dark: V = [0.012, 0.012, 0.014];
  const glow: V = [0.08, 0.055, 0.03];
  const lamp: V = [1.0, 0.72, 0.42];
  const rim: V[] = [[x, y, z + half]];
  for (let k = 0; k <= 16; k++) {
    const t = (Math.PI * k) / 16;
    rim.push([x, y + spring + rise * Math.sin(t), z + half * Math.cos(t)]);
  }
  rim.push([x, y, z - half]);
  face([[x, y + 0.55, z], ...rim, rim[0]], [glow, ...rim.map(() => dark), dark]);
  const square = (c: V, du: V, dv: V) => face([0, 1, 3, 2].map((k) => [c[0] + (k & 1 ? 1 : -1) * du[0] + (k & 2 ? 1 : -1) * dv[0], c[1] + (k & 1 ? 1 : -1) * du[1] + (k & 2 ? 1 : -1) * dv[1], c[2] + (k & 1 ? 1 : -1) * du[2] + (k & 2 ? 1 : -1) * dv[2]] as V), [lamp, lamp, lamp, lamp]);
  for (const s of [-1, 1]) {
    // on the jambs inside the vault, and smaller on the dark face as if further in
    for (const d of [-0.5, -0.22]) square([PORTAL.x + d, y + 0.78, z + s * (half - 0.004)], [0.07, 0, 0], [0, 0.025, 0]);
    for (const [u, v, r] of [[0.95, 1.45, 0.06], [0.62, 1.12, 0.04], [0.4, 0.92, 0.028]]) square([x - 0.004, y + v, z + s * u], [0, 0, r], [0, r * 0.45, 0]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}

/** All the Bay Bridge's concrete in one mesh (tower piers, both anchorages, the portal), and the tunnel's dark mouth. */
export function bayMasonry() {
  const m = mason();
  for (const x of BAY_TOWERS) bayPier(m, x);
  for (const x of BAY_ANCHORS) bayAnchorage(m, x);
  portal(m);
  return { concrete: masonryGeometry(m), tunnel: tunnelMouth() };
}

/**
 * The road surface on both main decks and the roads at the four bridge ends
 * (roads.ts): one mesh each for asphalt, lane marks and concrete. The asphalt
 * is mapped like the street texture, so a road and the street it lands on match.
 */
export function Roads() {
  const { asphalt } = useLandmarkTextures();
  const concrete = useConcrete();
  const materials = useMemo(() => {
    const road = worldMaterial(asphalt, 6);
    road.roughness = 0.85;
    road.metalness = 0;
    const marks = new MeshStandardMaterial({ color: new Color(0.86, 0.84, 0.78), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    return { road, marks, concrete };
  }, [asphalt, concrete]);
  const geometry = useMemo(() => {
    const roads = ROADS.map(roadGeometry);
    const decks = DECKS.map((d) => deckGeometry(d.points));
    return {
      road: merged([...roads, ...decks].map((g) => g.asphalt)),
      marks: merged([...roads, ...decks].map((g) => g.marks)),
      concrete: merged(roads.map((g) => g.concrete)),
    };
  }, []);
  return (
    <group>
      <mesh geometry={geometry.road} material={materials.road} receiveShadow />
      <mesh geometry={geometry.marks} material={materials.marks} receiveShadow />
      <mesh geometry={geometry.concrete} material={materials.concrete} castShadow receiveShadow />
    </group>
  );
}

/** Golden Gate Bridge across the strait to the north-west: the 06:00 backdrop. */
/** `anchorTop`: the anchorages stop under the road slab, so the road runs on over them. */
export const GG = { x: -80, deck: DECK_Y, towers: [-70, -134], south: -52, north: -152, top: 30, anchorTop: DECK_Y - SLAB, red: "#c0442c" };
/**
 * Golden Gate towers: legs in three tiers [y0, y1, width across] that step in
 * on the outside as they rise, inner faces at `inner` so the road passes
 * between them; portal struts (`struts`, `strutH` tall) over the traffic.
 */
export const GG_TOWER = {
  inner: 1.8,
  tiers: [[0, 11, 1.1], [11, 21, 0.95], [21, GG.top, 0.8]] as [number, number, number][],
  struts: [9.6, 15.5, 20.5, 25.5, GG.top - 0.3],
  strutH: 0.7,
};
const GG_SPANS: [number, number, number, number, number][] = [
  // cable ends go down into the anchorages, under the road
  [GG.south, GG.deck - 0.4, GG.towers[0], GG.top - 0.6, 3],
  [GG.towers[0], GG.top - 0.6, GG.towers[1], GG.top - 0.6, 20],
  [GG.towers[1], GG.top - 0.6, GG.north, GG.deck - 0.4, 3],
];

/** Golden Gate pylons: concrete Art Deco towers either side of the road on each anchorage (centre `x` off the road's centre line, inner face at `inner`). */
export const GG_PYLON = { x: 2.05, inner: 1.77, top: GG.anchorTop + 4.6 };

/**
 * A Golden Gate anchorage at z: a footing in the water, a block of corner
 * piers and pilasters with recessed panels between them under a spandrel band
 * and cornice, and a stepped top under the road (nothing over the road above
 * anchorTop). On it, either side of the road, an Art Deco pylon: shaft, two
 * setbacks with ledges, a chamfered cap, vertical fluting that steps with them.
 */
function ggAnchorage(m: Mason, z: number) {
  const T = GG.anchorTop;
  const at: [number, number] = [GG.x, z];
  prism(m, { at, y: [-1.2, 0.5], half: [2.3, 2] });
  prism(m, { at, y: [0.5, 0.65], half: [2.3, 2], halfTop: [2.2, 1.9] });
  prism(m, { at, y: [0.65, 4.75], half: [2.05, 1.75], top: 4.4 });
  for (const s of [-1, 1]) {
    for (const t of [-1, 1]) prism(m, { at: [GG.x + s * 1.85, z + t * 1.55], y: [0.65, 4.4], half: [0.37, 0.37] });
    for (const d of [-0.55, 0.55]) prism(m, { at: [GG.x + s * 2.135, z + d], y: [0.65, 4.4], half: [0.085, 0.17] });
    for (const d of [-0.7, 0.7]) prism(m, { at: [GG.x + d, z + s * 1.835], y: [0.65, 4.4], half: [0.17, 0.085] });
  }
  prism(m, { at, y: [4.4, 4.75], half: [2.22, 1.92], top: 4.88 });
  prism(m, { at, y: [4.75, 4.88], half: [2.22, 1.92], halfTop: [2.3, 2] });
  prism(m, { at, y: [4.88, 5.0], half: [2.3, 2] });
  prism(m, { at, y: [5.0, 5.7], half: [2.25, 1.7] });
  prism(m, { at, y: [5.7, T - 0.08], half: [2.3, 1.45] });
  prism(m, { at, y: [T - 0.08, T], half: [2.3, 1.45], halfTop: [2.26, 1.41] });
  for (const s of [-1, 1]) {
    const x = GG.x + s * GG_PYLON.x;
    const p: [number, number] = [x, z];
    // fluting: ribs on every face, the middle ones running highest
    const ribs = (y0: number, faces: [number, number][], ribsAlong: number[], ribsAcross: number[], heights: (i: number) => number) => {
      const [a, b] = faces[0];
      ribsAcross.forEach((d, i) => { for (const t of [-1, 1]) prism(m, { at: [x + t * (a + 0.02), z + d], y: [y0, heights(i)], half: [0.03, 0.035] }); });
      ribsAlong.forEach((d, i) => { for (const t of [-1, 1]) prism(m, { at: [x + d, z + t * (b + 0.02)], y: [y0, heights(i)], half: [0.035, 0.03] }); });
    };
    prism(m, { at: p, y: [T, T + 0.3], half: [0.3, 0.9], halfTop: [0.29, 0.88] });
    prism(m, { at: p, y: [T + 0.3, T + 3.0], half: [0.26, 0.78], chamfer: 0.05 });
    ribs(T + 0.3, [[0.26, 0.78]], [-0.12, 0.12], [-0.48, -0.16, 0.16, 0.48], (i) => T + 2.75 + (i === 1 || i === 2 ? 0.25 : 0));
    prism(m, { at: p, y: [T + 3.0, T + 3.12], half: [0.3, 0.84], bottom: true });
    prism(m, { at: p, y: [T + 3.12, T + 3.9], half: [0.21, 0.62], chamfer: 0.04 });
    ribs(T + 3.12, [[0.21, 0.62]], [0], [-0.2, 0.2], () => T + 3.9);
    prism(m, { at: p, y: [T + 3.9, T + 3.98], half: [0.25, 0.66], bottom: true });
    prism(m, { at: p, y: [T + 3.98, T + 4.45], half: [0.16, 0.44], chamfer: 0.03 });
    prism(m, { at: p, y: [T + 4.45, GG_PYLON.top], half: [0.16, 0.44], halfTop: [0.08, 0.3] });
  }
}

/** A Golden Gate tower pier: an octagonal fender to just above the water, a chamfered cap, plinths under the legs. */
function ggPier(m: Mason, z: number) {
  const at: [number, number] = [GG.x, z];
  prism(m, { at, y: [-1.2, 0.7], half: [3.2, 2], chamfer: 0.7 });
  prism(m, { at, y: [0.7, 0.85], half: [3.2, 2], halfTop: [3.08, 1.88], chamfer: [0.7, 0.62] });
  for (const s of [-1, 1]) {
    const leg: [number, number] = [GG.x + s * (GG_TOWER.inner + GG_TOWER.tiers[0][2] / 2), z];
    prism(m, { at: leg, y: [0.85, 1.05], half: [0.75, 1.05] });
    prism(m, { at: leg, y: [1.05, 1.12], half: [0.75, 1.05], halfTop: [0.7, 1.0] });
  }
}

/** The Fort Point arch's south foot: on a skewback beside the land pier, this high. */
const ARCH_FOOT = 0.45;

/** All the Golden Gate's concrete in one mesh: both anchorages with their pylons, the tower piers, the arch's skewbacks. */
export function ggMasonry() {
  const m = mason();
  for (const z of [GG.south, GG.north]) ggAnchorage(m, z);
  for (const z of GG.towers) ggPier(m, z);
  const land = piers(roadNamed("golden-gate-south")).find(([, , g]) => g >= 0) as [number, number, number, number];
  for (const s of [-1, 1]) prism(m, { at: [GG.x + s * 0.9, land[1] - 0.5], y: [land[2] - 0.2, ARCH_FOOT], half: [0.24, 0.3], halfTop: [0.2, 0.26] });
  return masonryGeometry(m);
}

/**
 * The Fort Point arch: two steel ribs (in the bridge's orange) from the south
 * anchorage's face over the street at the city's tip to the land pier, posts
 * up to the road slab and struts between the ribs. Its foot on the anchorage
 * stays above the water.
 */
export function ggArch() {
  const south = roadNamed("golden-gate-south");
  const slab = (z: number) => {
    const p = south.points;
    for (let i = 1; i < p.length; i++) if ((z - p[i - 1][2]) * (z - p[i][2]) <= 0) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (z - p[i - 1][2])) / (p[i][2] - p[i - 1][2]) - SLAB;
    return DECK_Y - SLAB;
  };
  const land = piers(south).find(([, , g]) => g >= 0) as [number, number, number, number];
  const [z0, y0, z1, y1] = [GG.south + 1.9, 0.9, land[1] - 0.55, ARCH_FOOT];
  const N = 16;
  const along = (k: number) => k / N;
  // as high as the slab allows, 0.35 under it
  const H = Math.min(...Array.from({ length: N - 1 }, (_, k) => along(k + 1)).map((t) => (slab(z0 + (z1 - z0) * t) - 0.35 - (y0 + (y1 - y0) * t)) / (4 * t * (1 - t))));
  const rib = (t: number) => [z0 + (z1 - z0) * t, y0 + (y1 - y0) * t + 4 * H * t * (1 - t)];
  const out: number[] = [];
  const X: [number, number, number] = [1, 0, 0];
  for (const s of [-1, 1]) {
    const x = GG.x + s * 0.9;
    for (let k = 0; k < N; k++) {
      const [za, ya] = rib(along(k));
      const [zb, yb] = rib(along(k + 1));
      beam(out, [x, ya, za], [x, yb, zb], 0.11, 0.16, X);
    }
    for (let k = 1; k < N; k++) {
      const [z, y] = rib(along(k));
      const top = Math.min(slab(z - 0.08), slab(z + 0.08));
      if (top - y > 0.4) beam(out, [x, y, z], [x, top, z], 0.06, 0.06, X);
    }
  }
  for (const k of [3, 6, 8, 10, 13]) {
    const [z, y] = rib(along(k));
    beam(out, [GG.x - 0.9, y, z], [GG.x + 0.9, y, z], 0.06, 0.06, [0, 0, 1]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  return g;
}

export function GoldenGate() {
  const { ggsteel } = useLandmarkTextures();
  // Riveted International Orange steel on towers and deck; the deck top is road.
  const paint = useMemo(() => worldMaterial(ggsteel, 2.2), [ggsteel]);
  const deck = useMemo(() => worldMaterial(ggsteel, 2.2, "#b4b0aa"), [ggsteel]);
  const cable = useMemo(() => new MeshStandardMaterial({ color: GG.red, roughness: 0.5, metalness: 0.3 }), []);
  const truss = useMemo(() => new MeshStandardMaterial({ color: "#7e2c1e", roughness: 0.7, metalness: 0.2 }), []);
  const concrete = useConcrete();
  const masonry = useMemo(() => ggMasonry(), []);
  // the railings and the Fort Point arch, in the same steel
  const railing = useMemo(() => merged([railingGeometry(DECKS[0].points), ggArch()]), []);
  // Main cables as tubes; suspenders as thin vertical strokes down to the deck.
  const cables = useMemo(
    () =>
      [-CABLE, CABLE].flatMap((dx) =>
        GG_SPANS.map(([z0, y0, z1, y1, sag]) => new TubeGeometry(new CatmullRomCurve3(catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", 40).map((p) => new Vector3(...p))), 80, 0.2, 6)),
      ),
    [],
  );
  const suspenders = useMemo(() => {
    const pts: number[] = [];
    for (const dx of [-CABLE, CABLE]) {
      for (const [z0, y0, z1, y1, sag] of GG_SPANS) {
        for (const [x, y, z] of catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", Math.round(Math.abs(z1 - z0) / 1.6))) {
          if (y > GG.deck + 0.8) pts.push(x, y, z, x, GG.deck - 0.1, z); // ends hidden inside the deck
        }
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pts, 3));
  }, []);

  return (
    <group>
      {/* deck and truss, the deck's top just under the road (Roads draws the asphalt) */}
      <mesh position={[GG.x, GG.deck - 0.28, (GG.south + GG.north) / 2]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[3, 0.5, GG.south - GG.north]} />
      </mesh>
      <mesh position={[GG.x, GG.deck - 1.03, (GG.south + GG.north) / 2]} material={truss} castShadow>
        <boxGeometry args={[2.6, 1, GG.south - GG.north]} />
      </mesh>
      {/* open railings along both edges, just outside the road, and the Fort Point arch */}
      <mesh geometry={railing} material={paint} castShadow />
      {/* anchorages, pylons and tower piers */}
      <mesh geometry={masonry} material={concrete} castShadow receiveShadow />
      {/* Art Deco towers: legs step in as they rise, portal struts between them */}
      {GG.towers.map((z) => (
        <group key={z} position={[GG.x, 0, z]}>
          {[-1, 1].map((s) =>
            GG_TOWER.tiers.map(([y0, y1, w]) => (
              <mesh key={`${s}${y0}`} position={[s * (GG_TOWER.inner + w / 2), (y0 + y1) / 2, 0]} material={paint} castShadow receiveShadow>
                <boxGeometry args={[w, y1 - y0, w * 1.5]} />
              </mesh>
            )),
          )}
          {GG_TOWER.struts.map((y) => (
            <mesh key={y} position={[0, y, 0]} material={paint} castShadow>
              <boxGeometry args={[2 * GG_TOWER.inner + 0.8, GG_TOWER.strutH, 0.7]} />
            </mesh>
          ))}
        </group>
      ))}
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cable} castShadow />
      ))}
      <lineSegments geometry={suspenders}>
        <lineBasicMaterial color={GG.red} transparent opacity={0.75} />
      </lineSegments>
    </group>
  );
}
