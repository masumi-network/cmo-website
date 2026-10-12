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
  /** 0..1: a small hand gesture as his speech bubble shows. */
  talk: number;
  /** 0..1: how far his raised hand has closed into a loose fist (1 on the move). */
  fist: number;
};

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** How far each joint of the raised finger bends (radians) to tuck it over the fist. */
export const CURL = 1.6;

/**
 * Standing, every few seconds his raised finger wiggles or taps: one event in
 * each 4 s slot, at a time and of a kind picked by a hash of the slot (so it is
 * the same on every frame and every replay). 0 outside an event.
 */
export function fidget(time: number) {
  const slot = Math.floor(time / 4);
  const hash = (n: number) => {
    const h = Math.sin(slot * 127.1 + n * 311.7) * 43758.5453;
    return h - Math.floor(h);
  };
  const u = (time - slot * 4 - 0.5 - hash(1) * 2.5) / 0.7;
  if (u < 0 || u > 1) return { wiggle: 0, tap: 0 };
  const env = Math.sin(Math.PI * u);
  return hash(2) < 0.5 ? { wiggle: env * Math.sin(u * Math.PI * 4), tap: 0 } : { wiggle: 0, tap: env * Math.abs(Math.sin(u * Math.PI * 2)) };
}

export function pose({ bones: b }: CusoRig, p: PoseInput) {
  const { walk, dash, air, wave, cheer, phase, time, talk } = p;
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
  // hello, up in the air when cheering. The hip hand rests on his hip; it swings
  // a little off it when walking (against the right leg), trails when dashing,
  // and goes up with the other one when cheering.
  const waveSwing = Math.sin(time * 9) * 0.45;
  b.armL.rotation.z = walk * 2.45 + dash * 2.2 + air * -0.35 + wave * waveSwing + cheer * -0.5 + still * 0.06 * Math.sin(time * 1.3);
  b.armL.rotation.x = walk * 0.35 * sin + dash * 1.1;
  b.armR.rotation.z = walk * 0.2 + dash * 0.35 + air * 0.5 + cheer * 1.9;
  b.armR.rotation.x = walk * -0.3 * sin + dash * 0.9;

  // Hands, rubber-hose style. Walking, each hand swings a beat behind its arm
  // (`lag`), so the wrist flexes at the ends of the swing. Lowered (walk, dash)
  // the raised arm's x axis points the other way, hence the minus signs.
  // Dashing, the hands trail and bend back; taking off and landing they flick
  // out (`flick`). On the move both hands are loose fists: the raised finger
  // curls over its fist (`curl`, eased from `fist`, which cuso.tsx ramps over
  // 0.25 s as he starts and stops). The point is a
  // pose he strikes: standing, the finger is up; it breathes and fidgets, waves
  // at the wrist, pumps when cheering and points across at his speech bubble
  // when he talks. The hip hand only moves when its arm does, so standing it
  // stays exactly on his hip.
  const lag = Math.sin(phase - 0.9) - sin;
  const flick = 4 * air * (1 - air);
  const { wiggle, tap } = fidget(time);
  const waveWrist = Math.sin(time * 9 - 1);
  const curl = p.fist * p.fist * (3 - 2 * p.fist) * (1 - Math.max(cheer, talk, wave));
  const point = 1 - curl;
  b.wristL.rotation.x = -walk * 0.35 * lag - dash * 0.6 + still * tap * 0.12;
  b.wristL.rotation.y = talk * 0.7;
  b.wristL.rotation.z = flick * 0.5 + wave * 0.35 * waveWrist + still * 0.05 * Math.sin(time * 1.1) - talk * 0.5;
  b.fingerL.rotation.x = curl * CURL + point * (still * tap * 0.5 + cheer * 0.45 * Math.max(0, Math.sin(time * 16)));
  b.fingerL.rotation.z = point * (flick * 0.3 + wave * 0.15 * Math.sin(time * 9 - 1.6) + still * wiggle * 0.3 - talk * 0.25);
  b.fingerTipL.rotation.x = curl * CURL;
  b.wristR.rotation.x = -walk * 0.3 * lag + dash * 0.5;
  b.wristR.rotation.z = flick * 0.45 + cheer * 0.35;

  // Body: bob, sway, small twist and lean while walking; a strong lean when
  // dashing; breathing and a curious look while standing.
  const bob = walk * 0.006 * Math.abs(cos) + air * 0.004 + still * 0.0015 * Math.sin(time * 2.2);
  b.hips.position.y = 0.092 + bob;
  b.body.rotation.z = walk * 0.05 * sin + still * 0.02 * Math.sin(time * 0.7);
  // He is shown mirrored (rig.ts): turning to his +x reads as turning to the viewer's left.
  b.body.rotation.y = walk * 0.06 * sin - still * p.lookX * 0.35;
  b.body.rotation.x = mix(0, 0.1, walk) + dash * 0.42 + air * 0.12 - still * p.lookY * 0.08 + cheer * -0.08;
}
