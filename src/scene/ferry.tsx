"use client";

// 18:00 Ferry Building, the California St cable car, and the newsletter envelopes.

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { dayNow, rig, useNightGlow } from "./shared";
import { CableCar, Rails } from "./cable-car";
import { Box, type V3 } from "./parts";
import { CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, MeshStandardMaterial, type InstancedMesh } from "three";
import { placer, placed, box, cyl, faceted, merged, useMat, drawn } from "./landmark-kit";

/** Ferry Building facades drawn once: an arcade below, windows above, a cornice line. Mask = what glows at night. */
function ferryFacade(width: number, bays: number, mask: boolean) {
  const h = 256;
  return drawn(width, h, (ctx) => {
    ctx.fillStyle = mask ? "#000" : "#e4dac7";
    ctx.fillRect(0, 0, width, h);
    if (!mask) {
      // soft stone courses
      ctx.fillStyle = "rgba(120, 100, 80, 0.08)";
      for (let y = 18; y < h; y += 22) ctx.fillRect(0, y, width, 2);
      ctx.fillStyle = "#f1e9da";
      ctx.fillRect(0, 0, width, 16); // cornice
      ctx.fillRect(0, 118, width, 10); // belt course
      ctx.fillStyle = "rgba(60, 45, 30, 0.35)";
      ctx.fillRect(0, 16, width, 4);
      ctx.fillRect(0, 128, width, 3);
    }
    const bay = width / bays;
    for (let i = 0; i < bays; i++) {
      const cx = (i + 0.5) * bay;
      const aw = bay * 0.62;
      // arched opening of the arcade
      ctx.fillStyle = mask ? (i % 3 === 1 ? "#6b5a40" : "#ffffff") : "#4a4036";
      ctx.beginPath();
      ctx.moveTo(cx - aw / 2, h);
      ctx.lineTo(cx - aw / 2, 170);
      ctx.arc(cx, 170, aw / 2, Math.PI, 0);
      ctx.lineTo(cx + aw / 2, h);
      ctx.fill();
      // upper floor window
      ctx.fillStyle = mask ? (i % 2 ? "#ffffff" : "#000") : "#46505a";
      ctx.fillRect(cx - bay * 0.18, 44, bay * 0.36, 56);
      if (!mask) {
        ctx.fillStyle = "#f1e9da";
        ctx.fillRect(cx - bay * 0.24, 100, bay * 0.48, 5); // sill
      }
    }
  }, !mask);
}

/** A clock face (white dial, dark ticks and hands at ten past six). */
function clockFace() {
  return drawn(256, 256, (ctx) => {
    ctx.fillStyle = "#f6f1e4";
    ctx.beginPath();
    ctx.arc(128, 128, 124, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a2622";
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(128, 128, 118, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 === 0 ? 10 : 5;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * 96, 128 - Math.cos(a) * 96);
      ctx.lineTo(128 + Math.sin(a) * 108, 128 - Math.cos(a) * 108);
      ctx.stroke();
    }
    const hand = (a: number, r: number, w: number) => {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.sin(a) * r, 128 - Math.cos(a) * r);
      ctx.stroke();
    };
    hand(Math.PI * (6 / 6 + 1 / 36), 58, 10);
    hand(Math.PI * (2 / 6), 86, 7);
  });
}

/** 18:00 Ferry Building and the California St cable car. */
/**
 * The Ferry Building's bounding boxes as [width, top, depth] around (x, z):
 * stone plinth, hall (with its cornice and glass nave) and clock tower.
 * The 18:00 cable car stands on its rails out front. The collision test reads both.
 */
export const FERRY = { x: 33.4, z: -3, plinth: [5, 0.3, 14], hall: [3.16, 4.05, 12.16], tower: [1.62, 11.65] } as const;
export const FERRY_CAR = { p: [18.4, 0, 4] as V3 };

export function FerryBuilding() {
  const stone = useMat("#e4dac7", 0.85);
  const dark = useMat("#4a4036", 0.7);
  const roofMat = useMat("#9d978d", 0.9);
  const glass = useMat("#aab5bb", 0.3, 0.2);
  const materials = useMemo(() => {
    const facade = (width: number, bays: number) => {
      const m = new MeshStandardMaterial({ map: ferryFacade(width, bays, false), emissiveMap: ferryFacade(width, bays, true), emissive: "#ffcf8a", emissiveIntensity: 0, roughness: 0.85 });
      return m;
    };
    const long = facade(1024, 22);
    const end = facade(256, 3);
    return { long, end, box: [long, long, roofMat, roofMat, end, end] };
  }, [roofMat]);
  useNightGlow(materials.long, 1.1, 0);
  useNightGlow(materials.end, 1.1, 0);
  const clock = useMemo(() => {
    const map = clockFace();
    return new MeshStandardMaterial({ map, emissive: "#fff3d6", emissiveMap: map, emissiveIntensity: 0.05, roughness: 0.5 });
  }, []);
  useNightGlow(clock, 1.8, 0.05);
  const parts = useMemo(() => {
    // Tower on the centre of the roof (y 3.1), modelled on the Giralda:
    // shaft, clock stage, open belfry, lantern and a small pyramid cap.
    const { x, z } = FERRY;
    const sq = (y: number, w: number, h: number) => box([x, y, z], [w, h, w]);
    const slots = (y: number, d: number, w: number, h: number, n: number) =>
      [0, 1, 2, 3].flatMap((k) => {
        const a = (k * Math.PI) / 2;
        return Array.from({ length: n }, (_, i) => {
          const off = (i - (n - 1) / 2) * w * 1.8;
          return box([x + Math.sin(a) * d + Math.cos(a) * off, y, z + Math.cos(a) * d - Math.sin(a) * off], [w, h, 0.04], [0, a, 0]);
        });
      });
    const cap = new ConeGeometry(0.62, 0.6, 4);
    cap.rotateY(Math.PI / 4);
    const nave = new CylinderGeometry(0.8, 0.8, 10.4, 3);
    nave.rotateX(-Math.PI / 2);
    nave.scale(1, 0.45, 1);
    return {
      stone: merged([
        // main cornice and the raised nave walls
        box([x, 3.08, z], [3.16, 0.1, 12.16]),
        box([x, 3.32, z], [1.4, 0.44, 10.2]),
        sq(5.2, 1.3, 4.2),
        // corner piers on the shaft
        ...[-1, 1].flatMap((i) => [-1, 1].map((k) => box([x + i * 0.62, 5.2, z + k * 0.62], [0.14, 4.2, 0.14]))),
        sq(7.32, 1.5, 0.1),
        sq(7.95, 1.42, 1.3),
        sq(8.66, 1.62, 0.12),
        sq(9.27, 1.2, 1.1),
        ...[-1, 1].flatMap((i) => [-1, 1].map((k) => box([x + i * 0.56, 9.27, z + k * 0.56], [0.16, 1.1, 0.16]))),
        sq(9.87, 1.36, 0.1),
        sq(10.22, 0.8, 0.6),
        sq(10.55, 0.9, 0.06),
        placed(cap, [x, 10.88, z]),
        cyl([x, 11.4, z], 0.015, 0.025, 0.5, 6),
      ]),
      // window slits on the shaft, belfry arches, lantern openings, clerestory
      dark: merged([
        ...slots(4.6, 0.651, 0.16, 0.5, 2),
        ...slots(6.0, 0.651, 0.16, 0.5, 2),
        ...slots(9.2, 0.601, 0.26, 0.78, 2),
        ...slots(10.2, 0.401, 0.2, 0.36, 1),
        box([x, 3.36, z], [1.42, 0.16, 9.9]),
      ]),
      glass: placed(faceted(nave), [x, 3.67, z]),
      // one clock face on each side of the clock stage
      clocks: merged(
        [0, 1, 2, 3].map((k) => {
          const a = (k * Math.PI) / 2;
          return placed(new CircleGeometry(0.47, 32), [x + Math.sin(a) * 0.715, 7.95, z + Math.cos(a) * 0.715], [0, a, 0]);
        }),
      ),
    };
  }, []);
  return (
    <group>
      <Box p={[FERRY.x, -0.15, FERRY.z]} s={[5, 0.9, 14]} color="#b9a98e" />
      <mesh position={[FERRY.x, 1.7, FERRY.z]} material={materials.box} castShadow receiveShadow>
        <boxGeometry args={[3, 2.8, 12]} />
      </mesh>
      <mesh geometry={parts.stone} material={stone} castShadow receiveShadow />
      <mesh geometry={parts.dark} material={dark} />
      <mesh geometry={parts.glass} material={glass} castShadow receiveShadow />
      <mesh geometry={parts.clocks} material={clock} />
      <Rails x0={6} x1={28} z={4} />
      <CableCar p={FERRY_CAR.p} />
      <Envelopes />
    </group>
  );
}

/** Envelopes fly off Cuso while he delivers the newsletter. */
function Envelopes() {
  const mesh = useRef<InstancedMesh>(null);
  const COUNT = 7;
  const material = useMemo(() => {
    const map = drawn(128, 86, (ctx) => {
      ctx.fillStyle = "#fbfaf6";
      ctx.fillRect(0, 0, 128, 86);
      ctx.strokeStyle = "#c9c3b6";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(2, 2);
      ctx.lineTo(64, 48);
      ctx.lineTo(126, 2);
      ctx.stroke();
      ctx.fillStyle = "#3d5afe";
      ctx.fillRect(100, 58, 18, 20); // stamp
    });
    return new MeshStandardMaterial({ map, side: DoubleSide, roughness: 0.7 });
  }, []);
  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const day = dayNow();
    const here = day.a.id === "newsletter" && day.t === 0 && day.mode === "story";
    m.visible = here;
    if (!here) return;
    for (let i = 0; i < COUNT; i++) {
      const phase = (clock.elapsedTime * 0.22 + i / COUNT) % 1;
      placer.position.set(rig.cuso.x - 0.6 - phase * 5, rig.cuso.y + 1.1 + phase * 3.2 + Math.sin(phase * 9 + i) * 0.3, rig.cuso.z + phase * 2.4);
      placer.rotation.set(phase * 4 + i, phase * 6, Math.sin(phase * 7) * 0.6);
      placer.scale.setScalar(Math.max(0.001, Math.sin(phase * Math.PI)));
      placer.updateMatrix();
      m.setMatrixAt(i, placer.matrix);
    }
    placer.scale.setScalar(1);
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, material, COUNT]} castShadow frustumCulled={false}>
      <planeGeometry args={[0.36, 0.24]} />
    </instancedMesh>
  );
}
