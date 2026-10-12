"use client";

// Cuso: the real mascot.glb. It has no skeleton (clips move the whole body),
// so travel between places is a hop arc. A rigged walk is a follow-up
// (docs/features/cuso-character.md).

import { Html, useAnimations, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { LoopOnce, LoopRepeat, Vector3, type AnimationAction, type Group, type Mesh } from "three";
import { useCity } from "@/lib/store";
import { damp, dayNow, rig, setLerp } from "./shared";

export const CUSO_URL = "/models/cuso.glb";
const SCALE = 6.2; // model is 0.3 m tall; Cuso is ~1.9 units, about door height
const FEET = 0.1524 * SCALE;

const pos = new Vector3();
const dir = new Vector3();

function angleDamp(from: number, to: number, k: number) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}

export function Cuso() {
  const outer = useRef<Group>(null);
  const body = useRef<Group>(null);
  const { scene, animations } = useGLTF(CUSO_URL, "/draco/");
  const { actions, mixer } = useAnimations(animations, body);
  const current = useRef<AnimationAction | null>(null);
  const oneShot = useRef(false);
  const cheer = useRef(useCity.getState().cheer);

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
  }, [scene]);

  const play = (name: string, once = false) => {
    const next = actions[name];
    if (!next || (current.current === next && !once)) return;
    next.reset();
    next.setLoop(once ? LoopOnce : LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = false;
    next.fadeIn(0.25).play();
    current.current?.fadeOut(0.25);
    current.current = next;
    oneShot.current = once;
  };

  useEffect(() => {
    const done = () => {
      oneShot.current = false;
    };
    mixer.addEventListener("finished", done);
    play("Hello", true);
    return () => mixer.removeEventListener("finished", done);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once on mount
  }, [mixer]);

  useFrame(({ camera }, dt) => {
    const g = outer.current;
    const b = body.current;
    if (!g || !b) return;
    const day = dayNow();
    const { a, t } = day;
    const to = day.b;

    setLerp(pos, a.spot, to.spot, t);
    const dist = Math.hypot(to.spot[0] - a.spot[0], to.spot[2] - a.spot[2]) + Math.abs(to.spot[1] - a.spot[1]);
    pos.y += Math.sin(Math.PI * t) * Math.min(3 + dist * 0.22, 16);
    g.position.copy(pos);
    rig.cuso.copy(pos);

    const moving = t > 0.01 && t < 0.99;
    let yaw: number;
    if (moving) {
      dir.set(to.spot[0] - a.spot[0], 0, to.spot[2] - a.spot[2]);
      yaw = Math.atan2(dir.x, dir.z);
    } else {
      yaw = Math.atan2(camera.position.x - pos.x, camera.position.z - pos.z) + rig.pointer.x * 0.45;
    }
    b.rotation.y = angleDamp(b.rotation.y, yaw, damp(6, dt));

    const state = useCity.getState();
    if (state.cheer !== cheer.current) {
      cheer.current = state.cheer;
      play("Spin", true);
    } else if (!oneShot.current) {
      play(moving ? "Hop" : "Idle");
    }
  });

  return (
    <group ref={outer}>
      <group ref={body}>
        <primitive object={scene} scale={SCALE} position-y={FEET} />
      </group>
      <Bubble />
    </group>
  );
}

/** What Cuso says, floating up and left of his head. */
function Bubble() {
  const [text, setText] = useState("");
  const shown = useRef("");
  const reply = useCity((s) => s.reply);
  const say = useCity((s) => s.say);

  useEffect(() => {
    if (!reply) return;
    const timer = setTimeout(() => say(""), 7000);
    return () => clearTimeout(timer);
  }, [reply, say]);

  useFrame(() => {
    const day = dayNow();
    const atRest = day.t === 0 && day.mode === "story";
    const next = atRest ? useCity.getState().reply || day.a.bubble : "";
    if (next !== shown.current) {
      shown.current = next;
      setText(next);
    }
  });

  if (!text) return null;
  return (
    <Html position={[-0.45, 2.15, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
      <div className="-translate-x-1/2 -translate-y-full rounded-[20px] md:-translate-x-full md:rounded-[20px_20px_6px_20px] bg-[#f7f6f2] px-4 py-3 text-lg font-medium whitespace-nowrap text-[#111114] shadow-[0_10px_30px_rgb(17_17_20/0.12)]">
        {text}
      </div>
    </Html>
  );
}

useGLTF.preload(CUSO_URL, "/draco/");
