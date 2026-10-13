"use client";

// 12:00 Union Square: the rooftop billboard with the visitor's ad, and the cable car below.

import { useMemo } from "react";
import { heightAt } from "@/lib/terrain";
import { useNightGlow } from "./shared";
import { CableCar, Rails } from "./cable-car";
import { useBrand, useGlow, type V3 } from "./parts";
import { useSign } from "./textures";
import { MeshStandardMaterial } from "three";
import { useStone, box, merged, useMat, useRoof } from "./landmark-kit";

/**
 * The 12:00 building, y from the ground at its centre. The south edge has no
 * parapet (Cuso jumps up there). `billboard` is the box around the board, its
 * frame and lamps. The collision test reads it.
 */
export const UNION = {
  x0: 3.5, x1: 10.5, z0: 6.4, z1: 11.6, roof: 5,
  wall: 0.16, parapet: 0.27,
  cornice: { out: 0.16, bottom: 4.73, top: 4.97 },
  belt: { y: 1.25, out: 0.05 },
  board: { x: 8.2, y: 8, z: 6.72 },
  billboard: { x0: 8.2 - 2.95, x1: 8.2 + 2.95, z0: 6.72 - 0.07, z1: 7.72, top: 8 + 1.7 },
};
/** The cable car parked below Union Square, between the two places Cuso crosses its rails (x -1.4 and 5.6). */
export const UNION_CAR = { p: [2.1, 0, 14] as V3 };

/** The billboard's ad face in world units [width, height]; its canvas follows the same shape. */
export const AD_PANEL = [5.58, 2.78] as const;

/** 12:00 Union Square: rooftop billboard with the visitor's ad, cable car below. */
export function UnionSquare() {
  const ad = useSign(useBrand(), { bg: "#3d5afe", fg: "#ffffff", sub: "Weekend sale · 20% off", tracking: 0.08, panel: AD_PANEL });
  const stone = useStone();
  const { x0, x1, z0, z1, roof: top, wall: t, parapet, cornice: c, belt } = UNION;
  const roof = useRoof(x1 - x0, z1 - z0);
  const trim = useMat("#e2d9c8", 0.75);
  const steel = useMat("#2c2c31", 0.55, 0.45);
  const lamp = useGlow("#fff1d2", 3, 0);
  const adMat = useMemo(() => new MeshStandardMaterial({ map: ad, roughness: 0.6, emissive: "#ffffff", emissiveMap: ad, emissiveIntensity: 0.15 }), [ad]);
  useNightGlow(adMat, 0.75, 0.15);
  const walls = useMemo(() => [stone, stone, roof, roof, stone, stone], [stone, roof]);
  const parts = useMemo(() => {
    // The camera looks up from the street to the south, so the south edge has
    // no parapet (Cuso's feet) and the cornice stays under the roof line.
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    const ring = (y: number, h: number, out: number) => [
      box([cx, y, z0 - out / 2 + 0.01], [w + out * 2, h, out + 0.02]),
      box([cx, y, z1 + out / 2 - 0.01], [w + out * 2, h, out + 0.02]),
      box([x0 - out / 2 + 0.01, y, cz], [out + 0.02, h, d]),
      box([x1 + out / 2 - 0.01, y, cz], [out + 0.02, h, d]),
    ];
    // Billboard: face x 5.3..11.1, y 6.45..9.55, at the north edge facing the street.
    const { x: bx, y: by } = UNION.board;
    const lamps = [6.3, 8.2, 10.1];
    return {
      trim: merged([
        // stepped crown moulding
        ...ring(c.top - 0.04, 0.08, c.out),
        ...ring(4.85, 0.08, 0.1),
        ...ring(4.77, 0.08, 0.05),
        ...ring(belt.y, 0.12, belt.out),
        box([cx, top + 0.11, z0 + t / 2], [w, 0.22, t]),
        box([x0 + t / 2, top + 0.11, cz + t / 2], [t, 0.22, d - t]),
        box([x1 - t / 2, top + 0.11, cz + t / 2], [t, 0.22, d - t]),
        box([cx, top + parapet - 0.025, z0 + t / 2 - 0.02], [w + 0.04, 0.05, t + 0.06]),
        box([x0 + t / 2 - 0.02, top + parapet - 0.025, cz + t / 2], [t + 0.06, 0.05, d - t]),
        box([x1 - t / 2 + 0.02, top + parapet - 0.025, cz + t / 2], [t + 0.06, 0.05, d - t]),
      ]),
      steel: merged([
        // two columns and the frame behind the board
        box([6.6, 7.2, 6.72], [0.18, 4.4, 0.14]),
        box([9.8, 7.2, 6.72], [0.18, 4.4, 0.14]),
        box([bx, 5.9, 6.72], [3.4, 0.1, 0.1]),
        box([bx, 7.1, 6.72], [5.6, 0.08, 0.08]),
        box([bx, 8.9, 6.72], [5.6, 0.08, 0.08]),
        box([bx, by, 6.85], [5.9, 3.1, 0.12]),
        // frame around the face
        box([bx, by + 1.47, 6.98], [5.9, 0.16, 0.14]),
        box([bx, by - 1.47, 6.98], [5.9, 0.16, 0.14]),
        box([bx - 2.87, by, 6.98], [0.16, 2.78, 0.14]),
        box([bx + 2.87, by, 6.98], [0.16, 2.78, 0.14]),
        // lamp arms reaching over the top edge
        ...lamps.map((x) => box([x, by + 1.62, 7.3], [0.04, 0.04, 0.6])),
        ...lamps.map((x) => box([x, by + 1.58, 6.98], [0.06, 0.12, 0.06])),
      ]),
      lamps: merged(lamps.map((x) => box([x, by + 1.58, 7.62], [0.34, 0.08, 0.16], [0.55, 0, 0]))),
    };
  }, [x0, x1, z0, z1, top, t, parapet, c, belt]);
  return (
    <group position-y={heightAt(7, 9)}>
      <mesh position={[(x0 + x1) / 2, top / 2, (z0 + z1) / 2]} material={walls} castShadow receiveShadow>
        <boxGeometry args={[x1 - x0, top, z1 - z0]} />
      </mesh>
      <mesh geometry={parts.trim} material={trim} castShadow receiveShadow />
      <mesh geometry={parts.steel} material={steel} castShadow receiveShadow />
      <mesh geometry={parts.lamps} material={lamp} castShadow />
      <mesh position={[8.2, 8, 6.95]} material={adMat}>
        <planeGeometry args={AD_PANEL} />
      </mesh>
      {/* shuttles west of the Bay Bridge ramp */}
      <Rails x0={-2.5} x1={8} z={14} />
      <CableCar p={UNION_CAR.p} />
    </group>
  );
}
