"use client";

// Small building blocks shared by the landmarks, the cable car and the pier.

import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, Frustum, InstancedBufferAttribute, Matrix4, MeshStandardMaterial, Object3D, Sphere, type BufferGeometry, type Group, type InstancedMesh, type Material, type Mesh } from "three";
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

/**
 * Lite: what is inside casts no shadows. Phones keep the shadows that shape
 * a shot (buildings, stops, trees, hills, Cuso); street furniture, bridges and
 * boats would cost a draw call each in the shadow pass for a few pixels.
 */
export function Shadowless({ when, children }: { when: boolean; children: ReactNode }) {
  const ref = useRef<Group>(null);
  useLayoutEffect(() => {
    if (when) ref.current?.traverse((o) => (o.castShadow = false));
  }, [when]);
  return <group ref={ref}>{children}</group>;
}

/**
 * Makes a mesh a shadow caster only: three skips a draw whose range is empty
 * (no draw call), so the range opens just for the shadow pass. For a cheap
 * stand-in that casts the shadow of a detailed mesh (which then casts none).
 */
export function shadowOnly(mesh: Mesh | null) {
  if (!mesh) return;
  const range = mesh.geometry.drawRange;
  range.start = Infinity;
  mesh.castShadow = true;
  mesh.onBeforeShadow = () => void (range.start = 0);
  mesh.onAfterShadow = () => void (range.start = Infinity);
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
const view = new Frustum();
const viewMatrix = new Matrix4();
/** How far past the view something small still draws, where its shadow may fall into the view (a low sun). */
export const SHADOW_REACH = 8;

/** One instanced mesh, filled once from a list. `place` sets o and returns a color. */
export function Instances<T>({
  items,
  geometry,
  material,
  place,
  attributes,
  shadows = true,
  detail = false,
  cull = false,
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
  /** Draw only the instances in view (a static list spread over the city: lamps, hydrants, signs). */
  cull?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const placed = useRef<{ matrix: Matrix4; sphere: Sphere; color: Color | null }[]>([]);
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
      const sphere = (geo.boundingSphere ?? (geo.computeBoundingSphere(), geo.boundingSphere!)).clone().applyMatrix4(o.matrix);
      if (shadows) sphere.radius += SHADOW_REACH; // its shadow may fall into view
      placed.current[i] = { matrix: o.matrix.clone(), sphere, color: color ? new Color(color) : null };
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (detail) mesh.layers.set(DETAIL);
  }, [items, place, detail, geo, shadows]);
  useFrame(({ camera }) => {
    const mesh = ref.current;
    if (!cull || !mesh) return;
    view.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    let n = 0;
    for (const { matrix, sphere, color } of placed.current) {
      if (!view.intersectsSphere(sphere)) continue;
      mesh.setMatrixAt(n, matrix);
      if (color) mesh.setColorAt(n, color);
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  return <instancedMesh ref={ref} args={[geo, material, items.length]} castShadow={shadows} receiveShadow />;
}
