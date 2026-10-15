"use client";

// Rooftop clutter, placed by roof-clutter.ts: HVAC units, vent pipes, stair
// bulkheads, skylights and TV antennas. Static, so every item is baked into
// one merged, vertex-coloured mesh: one draw call (plus one in the shadow pass
// on desktop), kept out of reflections. Calm city colours: galvanised grey,
// tar, stucco. Dev: `?clutter=off` hides it.

import { useEffect, useMemo } from "react";
import { BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, Matrix4, MeshStandardMaterial } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { roofClutter, type Item, type Kind } from "./roof-clutter";
import { detail } from "./shared";

/** Dev only: `?clutter=off` hides the clutter, for before and after screenshots. */
const OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clutter") === "off";

const GALVANISED = "#9a9ea1";
const DARK_METAL = "#4a4c4f";
const TAR = "#45423e";

/** One colour on every vertex, no uv (the merged mesh needs the same attributes everywhere). */
function paint(g: BufferGeometry, hex: string) {
  const c = new Color(hex);
  const flat = g.index ? g.toNonIndexed() : g;
  flat.deleteAttribute("uv");
  const n = flat.attributes.position.count;
  flat.setAttribute("color", new Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
  return flat;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: string) => paint(new BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex);

/** Each kind at its SIZE, standing on y 0, centred, w along x. Lite: fewer sides on round parts. */
function models(lite: boolean): Record<Kind, BufferGeometry> {
  const round = lite ? 6 : 10;
  return {
    hvac: mergeGeometries([box(0.5, 0.26, 0.34, 0, 0, 0, GALVANISED), paint(new CylinderGeometry(0.11, 0.11, 0.03, round).translate(0.11, 0.26 + 0.015, 0), DARK_METAL)]),
    vent: mergeGeometries([
      paint(new CylinderGeometry(0.035, 0.035, 0.22, 6, 1, true).translate(0, 0.11, 0), GALVANISED),
      paint(new ConeGeometry(0.06, 0.05, 6).translate(0, 0.235, 0), "#7c8084"),
    ]),
    bulkhead: mergeGeometries([
      box(0.7, 0.74, 0.56, 0, 0, 0, "#aaa298"),
      box(0.76, 0.04, 0.62, 0, 0.74, 0, TAR),
      box(0.3, 0.52, 0.02, 0.12, 0, 0.29, "#5e554c"),
    ]),
    skylight: mergeGeometries([
      box(0.5, 0.07, 0.36, 0, 0, 0, "#8a8c8c"),
      // a low hipped glass roof: a four-sided pyramid, squashed to the curb
      paint(new ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4).scale(0.44, 0.09, 0.3).translate(0, 0.07 + 0.045, 0), "#47515a"),
    ]),
    antenna: mergeGeometries([
      box(0.025, 0.8, 0.025, 0, 0, 0, "#5a5d60"),
      box(0.38, 0.015, 0.015, 0, 0.6, 0, "#5a5d60"),
      box(0.26, 0.015, 0.015, 0, 0.72, 0, "#5a5d60"),
    ]),
  };
}

/** Every item in one geometry (position, normal, color). */
export function clutterGeometry(items: Item[], lite: boolean) {
  const kit = models(lite);
  const m = new Matrix4();
  const turn = new Matrix4().makeRotationY(Math.PI / 2);
  const placed = items.map((it) => {
    m.makeTranslation(it.x, it.y, it.z);
    if (it.turn) m.multiply(turn);
    return kit[it.kind].clone().applyMatrix4(m);
  });
  const g = placed.length ? mergeGeometries(placed) : new BufferGeometry();
  g.computeBoundingSphere();
  Object.values(kit).forEach((k) => k.dispose());
  return g;
}

export function RoofClutter({ lite }: { lite: boolean }) {
  const geometry = useMemo(() => clutterGeometry(roofClutter(lite), lite), [lite]);
  const material = useMemo(() => new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), []);
  useEffect(() => () => (geometry.dispose(), material.dispose()), [geometry, material]);
  if (OFF) return null;
  return <mesh name="roof-clutter" ref={detail} geometry={geometry} material={material} castShadow={!lite} receiveShadow />;
}
