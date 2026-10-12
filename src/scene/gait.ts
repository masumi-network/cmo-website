// Cuso's body language, driven every frame through the bones (rig.ts).
// Nothing here moves the whole object: walking, dashing, jumping, waving,
// cheering and idling are all poses. Rotation x > 0 swings a limb backwards
// (Cuso faces +z).

import type { CusoRig } from "./rig";

/** World units per full step cycle (two steps). Short legs: short stride. */
export const STRIDE = 1.0;
/** Natural speeds in world units per second. */
export const SPEED = { walk: 2.3, dash: 22, jump: 10 } as const;

export type PoseInput = {
  /** 0..1 weights; they blend. */
  walk: number;
  dash: number;
  air: number;
  wave: number;
  cheer: number;
  /** Step cycle angle (advances with distance walked). */
  phase: number;
  /** Seconds, for breathing and waving. */
  time: number;
  /** Pointer in -1..1, for a little look while standing. */
  lookX: number;
  lookY: number;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function pose({ bones: b }: CusoRig, p: PoseInput) {
  const { walk, dash, air, wave, cheer, phase, time } = p;
  const still = Math.max(0, 1 - walk - dash - air);
  const sin = Math.sin(phase);
  const cos = Math.cos(phase);

  // Legs: pendulum swing; the leg moving forward bends its knee; feet stay flat.
  // Dashing, the legs trail back; in the air they tuck.
  const swing = 0.75 * walk;
  const thighL = -swing * sin + dash * 0.55 - air * 0.9 + cheer * -0.5;
  const thighR = swing * sin + dash * 0.35 - air * 0.5 + cheer * -0.2;
  const shinL = walk * 1.05 * Math.max(0, cos) + dash * 1.1 + air * 1.5 + cheer * 0.9;
  const shinR = walk * 1.05 * Math.max(0, -cos) + dash * 0.8 + air * 1.1 + cheer * 0.5;
  b.thighL.rotation.x = thighL;
  b.thighR.rotation.x = thighR;
  b.shinL.rotation.x = shinL;
  b.shinR.rotation.x = shinR;
  b.footL.rotation.x = -(thighL + shinL) * 0.75;
  b.footR.rotation.x = -(thighR + shinR) * 0.75;
  // A soft weight shift while standing.
  const shift = still * 0.04 * Math.sin(time * 0.6);
  b.thighL.rotation.z = shift;
  b.thighR.rotation.z = shift;

  // Thumbs-up arm: lowered to swing when walking, back when dashing, waving
  // hello, up in the air when cheering. The hip arm stays casual.
  const waveSwing = Math.sin(time * 9) * 0.45;
  b.armL.rotation.z = walk * 2.85 + dash * 2.9 + air * -0.35 + wave * waveSwing + cheer * -0.5 + still * 0.06 * Math.sin(time * 1.3);
  b.armL.rotation.x = walk * 0.35 * sin + dash * 1.1;
  b.armR.rotation.z = air * 0.5 + cheer * 1.9;
  b.armR.rotation.x = walk * -0.3 * sin + dash * 0.9;

  // Body: bob, sway, small twist and lean while walking; a strong lean when
  // dashing; breathing and a curious look while standing.
  const bob = walk * 0.006 * Math.abs(cos) + air * 0.004 + still * 0.0015 * Math.sin(time * 2.2);
  b.hips.position.y = 0.092 + bob;
  b.body.rotation.z = walk * 0.05 * sin + still * 0.02 * Math.sin(time * 0.7);
  b.body.rotation.y = walk * 0.06 * sin + still * p.lookX * 0.35;
  b.body.rotation.x = mix(0, 0.1, walk) + dash * 0.42 + air * 0.12 - still * p.lookY * 0.08 + cheer * -0.08;
}
