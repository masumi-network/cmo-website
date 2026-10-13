"use client";

// Street furniture: lamps along the streets. Placement comes from layout.ts.

import { useMemo } from "react";
import { BoxGeometry, Color, MeshStandardMaterial, Object3D, SphereGeometry } from "three";
import { type Lamp } from "./layout";
import { Instances } from "./parts";
import { useNightGlow } from "./shared";

const lampPole = (l: Lamp, o: Object3D) => void o.position.set(l.x, l.y, l.z);
const lampBulb = (l: Lamp, o: Object3D) => void o.position.set(l.x, l.y + 3.05, l.z);

export function Lamps({ lamps }: { lamps: Lamp[] }) {
  const poleGeo = useMemo(() => new BoxGeometry(0.08, 3, 0.08).translate(0, 1.5, 0), []);
  const bulbGeo = useMemo(() => new SphereGeometry(0.15, 10, 8), []);
  const metal = useMemo(() => new MeshStandardMaterial({ color: "#2e2e33", roughness: 0.6 }), []);
  const bulb = useMemo(() => new MeshStandardMaterial({ color: "#3a3630", emissive: new Color("#ffd58f"), emissiveIntensity: 0 }), []);
  useNightGlow(bulb, 3.5);
  return (
    <>
      <Instances items={lamps} geometry={poleGeo} material={metal} place={lampPole} />
      <Instances items={lamps} geometry={bulbGeo} material={bulb} place={lampBulb} shadows={false} />
    </>
  );
}

