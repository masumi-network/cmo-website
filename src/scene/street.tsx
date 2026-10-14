"use client";

// Street furniture, placed by layout.ts: San Francisco post-top lamps (a
// cast-iron pole with a fluted base and an acorn globe), fire hydrants (white,
// with the blue bonnet of the Twin Peaks high-pressure system) and green
// street-name signs. Each kind is one instanced mesh per material: 4 draw
// calls in all. The lamps' light pools at night are painted on the ground
// (lampLight in textures.ts), so they cost no draw call.

import { useMemo } from "react";
import { BoxGeometry, BufferGeometry, Color, CylinderGeometry, Float32BufferAttribute, LatheGeometry, MeshStandardMaterial, Object3D, Vector2 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Fixture } from "./layout";
import { Instances } from "./parts";
import { useNightGlow } from "./shared";

/** Sizes the tests check placement with: base radius on the ground, height, and furthest reach from the post. */
export const LAMP = { base: 0.12, height: 3.15, reach: 0.15 };
export const HYDRANT = { base: 0.1, height: 0.42, reach: 0.15 };
export const SIGN = { base: 0.05, height: 2.3, reach: 0.31 };

const lathe = (profile: [number, number][], segments: number) => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);

/** Gives every vertex one colour (for the vertex-coloured parts). */
function paint(g: BufferGeometry, hex: string) {
  const c = new Color(hex);
  const n = g.attributes.position.count;
  g.setAttribute("color", new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return g;
}
const merge = (parts: BufferGeometry[]) => mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));

/** Fluted base, slim tapered shaft, collar, the globe's holder; then the cap and finial over the globe. */
const LAMP_IRON: [number, number][] = [
  [0, 0], [0.12, 0], [0.12, 0.04], [0.1, 0.07], [0.095, 0.26], [0.075, 0.3], [0.06, 0.38], [0.05, 0.42],
  [0.036, 2.4], [0.05, 2.44], [0.05, 2.48], [0.034, 2.5], [0.034, 2.56], [0.07, 2.6], [0.075, 2.64], [0, 2.64],
];
const LAMP_CAP: [number, number][] = [[0, 2.95], [0.1, 2.95], [0.115, 2.97], [0.1, 3.0], [0.06, 3.03], [0.025, 3.05], [0.02, 3.09], [0.03, 3.11], [0, 3.15]];
/** The acorn: narrow at the holder, full in the middle, under the cap at the top. */
const LAMP_GLASS: [number, number][] = [[0, 2.64], [0.075, 2.64], [0.12, 2.69], [0.142, 2.77], [0.138, 2.86], [0.115, 2.94], [0.085, 2.99], [0, 3.01]];

/** Squat white body with a flange, two hose nozzles and a big pumper nozzle facing +x (the street); a blue bonnet. */
function hydrantGeometry() {
  const white = "#ece8df";
  const body = lathe([[0, 0], [0.1, 0], [0.1, 0.03], [0.075, 0.05], [0.07, 0.26], [0.085, 0.28], [0.085, 0.3], [0, 0.3]], 10);
  const bonnet = lathe([[0, 0.3], [0.08, 0.3], [0.075, 0.34], [0.05, 0.38], [0.02, 0.395], [0.015, 0.42], [0, 0.42]], 10);
  const nozzle = (r: number, len: number, angle: number) =>
    new CylinderGeometry(r, r, len, 8).rotateZ(Math.PI / 2).translate(0.07 + len / 2, 0.19, 0).rotateY(angle);
  return merge([paint(body, white), paint(bonnet, "#3a5a96"), ...[Math.PI / 2, -Math.PI / 2].map((a) => paint(nozzle(0.026, 0.06, a), white)), paint(nozzle(0.038, 0.07, 0), white)]);
}

/** A galvanised post with two crossed blades on top: white-edged green, one along each street. */
function signGeometry() {
  const blade = (y: number, alongX: boolean) => {
    const parts = [new BoxGeometry(0.6, 0.12, 0.012), new BoxGeometry(0.58, 0.1, 0.022)].map((b, i) => paint(b, i ? "#2b7a52" : "#f1efe8").translate(0, y, 0));
    return parts.map((p) => (alongX ? p : p.rotateY(Math.PI / 2)));
  };
  return merge([
    paint(new BoxGeometry(0.045, 2.2, 0.045).translate(0, 1.1, 0), "#8d9196"),
    ...blade(2.08, false),
    ...blade(2.21, true),
    paint(new CylinderGeometry(0.03, 0.03, 0.03, 8).translate(0, 2.285, 0), "#8d9196"),
  ]);
}

export const STREET_PARTS = {
  lampIron: merge([lathe(LAMP_IRON, 8), lathe(LAMP_CAP, 8)]),
  lampGlass: lathe(LAMP_GLASS, 12),
  hydrant: hydrantGeometry(),
  sign: signGeometry(),
};

const set = (f: Fixture, o: Object3D) => {
  o.position.set(f.x, f.y, f.z);
  o.rotation.y = f.turn;
};

export function StreetFurniture({ lamps, hydrants, signs }: { lamps: Fixture[]; hydrants: Fixture[]; signs: Fixture[] }) {
  const painted = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), []);
  return (
    <>
      <Lamps lamps={lamps} />
      <Instances items={hydrants} geometry={STREET_PARTS.hydrant} material={painted} place={set} detail cull />
      <Instances items={signs} geometry={STREET_PARTS.sign} material={painted} place={set} detail cull />
    </>
  );
}

/** SF post-top acorn lamps (the street's, and the one by the Hayes Valley shop): 2 draw calls, only the lamps in view. */
export function Lamps({ lamps }: { lamps: Fixture[] }) {
  const m = useMemo(
    () => ({
      iron: new MeshStandardMaterial({ color: "#26302c", roughness: 0.55, metalness: 0.35 }),
      // milky glass by day, warm at night
      glass: new MeshStandardMaterial({ color: "#efe9dc", roughness: 0.35, emissive: new Color("#ffd28a"), emissiveIntensity: 0 }),
    }),
    [],
  );
  useNightGlow(m.glass, 3.5);
  return (
    <>
      <Instances items={lamps} geometry={STREET_PARTS.lampIron} material={m.iron} place={set} cull />
      <Instances items={lamps} geometry={STREET_PARTS.lampGlass} material={m.glass} place={set} shadows={false} cull />
    </>
  );
}
