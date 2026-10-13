"use client";

// Cuso: the real mascot.glb, rigged at load (rig.ts). He walks the day at
// his own pace (routes.ts): scroll sets where he should be, he walks there,
// dashes the long street stretches and jumps onto roofs; if you jump far
// ahead he blinks there like a cursor. All motion is in the bones (gait.ts),
// so standing still never moves him as a block.

import { Html, useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { chapters } from "@/content/day";
import { useCity } from "@/lib/store";
import { travel } from "@/lib/time";
import { Vector3, type Camera, type Group, type Mesh, type Object3D } from "three";
import { SPEED, STRIDE, pose } from "./gait";
import { SCALE, rigCuso } from "./rig";
import { DAY_LENGTH, PATHS, dayDistance, sampleDay } from "./routes";
import { damp, rig } from "./shared";

export const CUSO_URL = "/models/cuso.glb";
const FEET = 0.1524 * SCALE;
/** Further than this behind the scroll, he blinks there instead of walking. */
const TELEPORT = 70;

function angleDamp(from: number, to: number, k: number) {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + d * k;
}
const easeOutBack = (x: number) => 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2;

export function Cuso() {
  const outer = useRef<Group>(null);
  const body = useRef<Group>(null);
  const { scene } = useGLTF(CUSO_URL, "/draco/");
  const skeleton = useMemo(() => rigCuso(scene), [scene]);
  const eyes = useMemo(() => ["EyeL", "EyeR"].map((n) => scene.getObjectByName(n)).filter(Boolean) as Object3D[], [scene]);
  const me = useRef({
    d: -1, phase: 0, walk: 0, dash: 0, air: 0,
    wave: 1, waveUntil: 2.2, cheerAt: -10, cheer: useCity.getState().cheer,
    popAt: -10, wasMoving: false, nextBlink: 2,
  });

  useEffect(() => {
    scene.traverse((o) => {
      if ((o as Mesh).isMesh) o.castShadow = o.receiveShadow = true;
    });
  }, [scene]);

  useFrame(({ camera, clock }, delta) => {
    const g = outer.current;
    const b = body.current;
    if (!g || !b) return;
    const dt = Math.min(delta, 0.1);
    const time = clock.elapsedTime;
    const m = me.current;
    const state = useCity.getState();

    // Where the scroll says he should be, and where he is.
    const tr = travel(state.progress, chapters.length);
    const target = dayDistance(tr.from, tr.from === tr.to ? 0 : tr.t);
    if (m.d < 0) m.d = target;
    let gap = target - m.d;
    if (Math.abs(gap) > TELEPORT) {
      m.d = target;
      m.popAt = time;
      gap = 0;
    }
    const here = sampleDay(m.d);
    const speed = Math.min(SPEED[here.mode], Math.abs(gap) * 3 + 0.6);
    const step = Math.sign(gap) * Math.min(Math.abs(gap), speed * dt);
    m.d = Math.min(DAY_LENGTH, Math.max(0, m.d + step));
    const now = sampleDay(m.d);
    const moving = Math.abs(gap) > 0.02;

    // Feet follow the distance walked, so they never slide.
    if (now.mode === "walk") m.phase += (Math.abs(step) / STRIDE) * Math.PI * 2;
    const k = damp(9, dt);
    m.walk += ((moving && now.mode === "walk" ? 1 : 0) - m.walk) * k;
    m.dash += ((moving && now.mode === "dash" ? 1 : 0) - m.dash) * k;
    m.air += ((moving && now.mode === "jump" ? 1 : 0) - m.air) * damp(14, dt);

    // Arriving: a little wave. Approving and such: a cheer with a hop.
    if (m.wasMoving && !moving) m.waveUntil = time + 1.8;
    m.wasMoving = moving;
    m.wave += ((time < m.waveUntil && !moving ? 1 : 0) - m.wave) * damp(6, dt);
    if (state.cheer !== m.cheer) {
      m.cheer = state.cheer;
      m.cheerAt = time;
    }
    const cheerU = (time - m.cheerAt) / 0.9;
    const cheer = cheerU >= 0 && cheerU < 1 ? Math.sin(Math.PI * cheerU) : 0;

    pose(skeleton, {
      walk: m.walk, dash: m.dash, air: Math.max(m.air, cheer * 0.4), wave: m.wave, cheer,
      phase: m.phase, time, lookX: rig.pointer.x, lookY: rig.pointer.y,
    });

    // Blink every few seconds.
    if (time > m.nextBlink + 0.13) m.nextBlink = time + 2.5 + Math.random() * 3;
    const blink = time > m.nextBlink ? 0.12 : 1;
    for (const e of eyes) e.scale.y = blink;

    // Place him: a small hover while dashing, a hop when cheering, a pop after a blink-teleport.
    const hop = cheer * 0.55 + m.dash * 0.25;
    g.position.set(now.pos[0], now.pos[1] + hop, now.pos[2]);
    const popU = Math.min(1, (time - m.popAt) / 0.35);
    g.scale.setScalar(popU < 1 ? Math.max(0.01, easeOutBack(popU)) : 1);
    rig.cuso.set(now.pos[0], now.pos[1], now.pos[2]);

    // Face where he is going (looking a bit ahead so corners are smooth), or the camera at rest.
    // Some moves and spots have a fixed heading (the cable car step is too narrow to turn on):
    // he spins to it quickly, before he lands.
    let yaw: number;
    if (now.face !== null) {
      yaw = now.face;
    } else if (moving) {
      const ahead = sampleDay(m.d + Math.sign(gap) * 1.6).pos;
      const dx = ahead[0] - now.pos[0];
      const dz = ahead[2] - now.pos[2];
      yaw = Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : b.rotation.y;
    } else {
      yaw = Math.atan2(camera.position.x - now.pos[0], camera.position.z - now.pos[2]);
    }
    b.rotation.y = angleDamp(b.rotation.y, yaw, damp(now.face !== null ? 25 : moving ? 7 : 3, dt));
    rig.heading = b.rotation.y;

    const tv = rig.travel;
    tv.leg = now.leg;
    tv.t = now.t;
    tv.s = now.s;
    tv.length = PATHS[now.leg].length;
    tv.moving = moving;
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

const anchor = new Vector3();

/** What Cuso says, floating beside his arrow tip (up and left when he faces us). */
function Bubble() {
  const box = useRef<HTMLDivElement>(null);
  // Turns with him, so the bubble stays on his tip side.
  const turn = useRef<Group>(null);
  // Like drei's default, but never under the top bar or a card: when one is
  // in the way, the bubble drops down below it, beside his head.
  const place = (el: Object3D, camera: Camera, size: { width: number; height: number }) => {
    anchor.setFromMatrixPosition(el.matrixWorld).project(camera);
    const x = ((anchor.x + 1) * size.width) / 2;
    // Narrow phones: a long line wraps instead of running off the screen.
    if (box.current) Object.assign(box.current.style, { whiteSpace: "normal", width: "max-content", maxWidth: `${size.width - 32}px` });
    const w = box.current?.offsetWidth ?? 0;
    const h = box.current?.offsetHeight ?? 0;
    const shift = window.matchMedia("(min-width: 768px)").matches ? w : w / 2; // matches the bubble's translate
    let left = Math.min(Math.max(x - shift, 16), size.width - w - 16); // keep it on screen
    const bar = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    let y = Math.max(((1 - anchor.y) * size.height) / 2, bar + 12 + h);
    for (const card of document.querySelectorAll("[data-card]")) {
      const r = card.getBoundingClientRect();
      if (!(r.width > 0 && r.left < left + w && r.right > left && r.top < y && r.bottom > y - h)) continue;
      // Below the card, or (short screens, no room below) beside it.
      if (r.bottom + 12 + h <= size.height - 16 || r.right + 12 + w > size.width - 16) y = r.bottom + 12 + h;
      else left = r.right + 12;
    }
    return [left + shift, y];
  };
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
    if (turn.current) turn.current.rotation.y = rig.heading;
    const { mode, reply } = useCity.getState();
    const tv = rig.travel;
    const at = tv.t < 0.001 ? tv.leg : tv.t > 0.999 ? tv.leg + 1 : -1;
    const next = mode === "story" && !tv.moving && at >= 0 ? reply || chapters[at].bubble : "";
    if (next !== shown.current) {
      shown.current = next;
      setText(next);
    }
  });

  return (
    <group ref={turn}>
      {text && (
        <Html position={[-0.6, 2.15, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }} calculatePosition={place}>
          <div ref={box} className="-translate-x-1/2 -translate-y-full rounded-[20px] md:-translate-x-full md:rounded-[20px_20px_6px_20px] bg-[#f7f6f2] px-4 py-3 text-lg font-medium whitespace-nowrap text-[#111114] shadow-[0_10px_30px_rgb(17_17_20/0.12)]">
            {text}
          </div>
        </Html>
      )}
    </group>
  );
}

useGLTF.preload(CUSO_URL, "/draco/");
