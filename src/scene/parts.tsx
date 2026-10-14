"use client";

// Small building blocks shared by the landmarks, the cable car and the pier.

import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedBufferAttribute, MeshStandardMaterial, Object3D, type BufferGeometry, type InstancedMesh, type Material } from "three";
import { brandFromUrl } from "@/lib/brand";
import { useCity } from "@/lib/store";
import { DETAIL, useNightGlow } from "./shared";

export type V3 = [number, number, number];

export const useBrand = () => (brandFromUrl(useCity((s) => s.website)) ?? "your brand").toUpperCase();

export function useGlow(color: string, max: number, base = 0) {
  const material = useMemo(() => new MeshStandardMaterial({ color: "#222", emissive: new Color(color), emissiveIntensity: base }), [color, base]);
  useNightGlow(material, max, base);
  return material;
}

export type BoxProps = { p: V3; s: V3; color: string; rough?: number; rotation?: V3 };

export function Box({ p, s, color, rough = 0.85, ...rest }: BoxProps) {
  return (
    <mesh position={p} castShadow receiveShadow {...rest}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={rough} />
    </mesh>
  );
}

const o = new Object3D();
const c = new Color();

/** One instanced mesh, filled once from a list. `place` sets o and returns a color. */
export function Instances<T>({
  items,
  geometry,
  material,
  place,
  attributes,
  shadows = true,
  detail = false,
}: {
  items: T[];
  geometry: BufferGeometry;
  material: Material;
  place: (item: T, o: Object3D, i: number) => string | void;
  /** Per-instance shader attributes, one float per item. */
  attributes?: Record<string, (item: T, i: number) => number>;
  shadows?: boolean;
  /** Too small for reflections (shared.ts DETAIL). */
  detail?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const geo = useMemo(() => {
    if (!attributes) return geometry;
    const g = geometry.clone();
    for (const [name, value] of Object.entries(attributes)) g.setAttribute(name, new InstancedBufferAttribute(Float32Array.from(items, value), 1));
    return g;
  }, [geometry, attributes, items]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    items.forEach((item, i) => {
      o.position.set(0, 0, 0);
      o.rotation.set(0, 0, 0);
      o.scale.set(1, 1, 1);
      const color = place(item, o, i);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      if (color) mesh.setColorAt(i, c.set(color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (detail) mesh.layers.set(DETAIL);
  }, [items, place, detail]);
  return <instancedMesh ref={ref} args={[geo, material, items.length]} castShadow={shadows} receiveShadow />;
}
