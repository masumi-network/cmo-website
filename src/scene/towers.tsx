"use client";

// Downtown and SoMa towers. Layout (sizes, tiers, glass or stone) comes from layout.ts.

import { useMemo } from "react";
import { BoxGeometry, MeshStandardMaterial, Object3D } from "three";
import type { Textures } from "./city";
import { type Tower } from "./layout";
import { FOOTING, towerMaterial } from "./materials";
import { Instances } from "./parts";

const box = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

type TierItem = { tower: Tower; i: number };

const towerTier = ({ tower, i }: TierItem, o: Object3D) => {
  const t = tower.tiers[i];
  const footing = i === 0 ? FOOTING : 0;
  o.position.set(tower.x, tower.y + t.y - footing, tower.z);
  o.scale.set(t.w, t.h + footing, t.d);
  return tower.color;
};
const towerCap = (tower: Tower, o: Object3D) => {
  const top = tower.tiers[tower.tiers.length - 1];
  o.position.set(tower.x, tower.y + top.y + top.h, tower.z);
  o.scale.set(top.w * 0.45, 1.1, top.d * 0.45);
};
const tiersOf = (towers: Tower[], glass: boolean): TierItem[] =>
  towers.filter((t) => t.glass === glass).flatMap((tower) => tower.tiers.map((_, i) => ({ tower, i })));

/** Downtown: tiered towers in glass or limestone, with a roof box on top. */
export function Towers({ towers, tex }: { towers: Tower[]; tex: Textures }) {
  const glass = useMemo(() => towerMaterial(tex.glass, { w: 4, h: 5.8 }, true), [tex]);
  const stone = useMemo(() => towerMaterial(tex.stone, { w: 4.8, h: 7.2 }, false), [tex]);
  const plain = useMemo(() => new MeshStandardMaterial({ color: "#a6a4a0", roughness: 0.8 }), []);
  const glassTiers = useMemo(() => tiersOf(towers, true), [towers]);
  const stoneTiers = useMemo(() => tiersOf(towers, false), [towers]);
  return (
    <>
      <Instances items={glassTiers} geometry={box} material={glass} place={towerTier} />
      <Instances items={stoneTiers} geometry={box} material={stone} place={towerTier} />
      <Instances items={towers} geometry={box} material={plain} place={towerCap} />
    </>
  );
}

