"use client";

// Named places in the city. Each chapter happens at one of these.
// Signs, the billboard and cable cars show the visitor's brand.

import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { heightAt } from "@/lib/terrain";
import { useCity } from "@/lib/store";
import { dayNow, rig, useNightGlow } from "./shared";
import { worldMaterial } from "./materials";
import { CableCar, Rails } from "./cable-car";
import { Box, useBrand, useGlow, type V3 } from "./parts";
import { useSign } from "./textures";
import { BufferGeometry, Color, CatmullRomCurve3, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, PlaneGeometry, TorusGeometry, TubeGeometry, Vector3, MeshStandardMaterial, Object3D, type Group, type InstancedMesh } from "three";
import { placer, useLandmarkTextures, useStone, placed, box, cyl, faceted, merged, useMat, useRoof, drawn } from "./landmark-kit";
import { BAY_ANCHORS, CABLE, DECKS, DECK_Y, ROADS, SLAB, bayDeckY, deckGeometry, railingGeometry, roadGeometry, spanGeometry, type Road } from "./roads";

/** Where each post hangs on the Mission wall (4 x 3), and which one is new. */
const POSTS = Array.from({ length: 12 }, (_, i) => {
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { row, col, y: 1.2 + row * 1.35, z: 27.1 + col * 1.25, fresh: row === 1 && col === 2 };
});

/** One post's square of the 4 x 3 photo grid in posts.jpg (a small inset hides the seams). */
function postUv(g: BufferGeometry, row: number, col: number) {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, col * 0.25 + 0.005 + uv.getX(i) * 0.24, row / 3 + 0.006 + uv.getY(i) * 0.32);
  return g;
}

/** 09:00 Mission wall of posts. A new post appears when you approve. */
export function MuralWall() {
  const approved = useCity((s) => s.approved);
  const { posts } = useLandmarkTextures();
  const fresh = useRef<Group>(null);
  const photo = useMemo(() => new MeshStandardMaterial({ map: posts, roughness: 0.6 }), [posts]);
  const stucco = useMat("#efe6da", 0.95);
  const trim = useMat("#ddd1bf", 0.9);
  const paper = useMat("#fbf8f2", 0.8);
  const wood = useMat("#a07a52", 0.8);
  const blue = useMat("#3d5afe", 0.45);
  const tin = useMat("#9a9ca0", 0.4, 0.6);
  const parts = useMemo(() => {
    // Wall x -6..-5.4, z 26.4..31.6, y 0..5.4; posts face east (+x) towards the street.
    const card = (y: number, z: number) => box([-5.39, y, z], [0.022, 1.18, 1.18]);
    const pic = ({ row, col }: { row: number; col: number }) => postUv(new PlaneGeometry(1.1, 1.1), row, col);
    const at = (g: BufferGeometry, y: number, z: number, x = -5.374) => placed(g, [x, y, z], [0, Math.PI / 2, 0]);
    const freshPost = POSTS.find((p) => p.fresh)!;
    return {
      trim: merged([box([-5.7, 5.46, 29], [0.74, 0.12, 5.34]), box([-5.7, 0.16, 29], [0.66, 0.32, 5.26])]),
      cards: merged(POSTS.filter((p) => !p.fresh).map((p) => card(p.y, p.z))),
      photos: merged(POSTS.filter((p) => !p.fresh).map((p) => at(pic(p), p.y, p.z))),
      freshCard: box([-0.015, 0, 0], [0.022, 1.18, 1.18]),
      freshPhoto: placed(pic(freshPost), [0.001, 0, 0], [0, Math.PI / 2, 0]),
      freshAt: [-5.375, freshPost.y, freshPost.z] as V3,
      // ladder leaning on the wall
      wood: merged([
        box([0, 1.6, -0.35], [0.08, 3.2, 0.08]),
        box([0, 1.6, 0.35], [0.08, 3.2, 0.08]),
        ...[0.4, 0.95, 1.5, 2.05, 2.6].map((y) => box([0, y, 0], [0.06, 0.06, 0.7])),
      ]),
      // paint bucket with a rim and a wire handle
      bucket: merged([cyl([0, 0.22, 0], 0.24, 0.2, 0.44, 20), placed(new TorusGeometry(0.235, 0.018, 6, 24), [0, 0.44, 0], [Math.PI / 2, 0, 0])]),
      handle: placed(new TorusGeometry(0.23, 0.008, 4, 16, Math.PI), [0, 0.44, 0], [0, 0.5, 0]),
    };
  }, []);

  useFrame((_, dt) => {
    const m = fresh.current;
    if (!m) return;
    const s = m.scale.x + ((approved ? 1 : 0.001) - m.scale.x) * Math.min(1, dt * 6);
    m.scale.setScalar(s);
  });

  return (
    <group position-y={heightAt(-5.7, 29)}>
      <mesh position={[-5.7, 2.7, 29]} material={stucco} castShadow receiveShadow>
        <boxGeometry args={[0.6, 5.4, 5.2]} />
      </mesh>
      <mesh geometry={parts.trim} material={trim} castShadow receiveShadow />
      <mesh geometry={parts.cards} material={paper} castShadow receiveShadow />
      <mesh geometry={parts.photos} material={photo} receiveShadow />
      <group ref={fresh} position={parts.freshAt} scale={0.001}>
        <mesh geometry={parts.freshCard} material={paper} castShadow receiveShadow />
        <mesh geometry={parts.freshPhoto} material={photo} />
      </group>
      <mesh geometry={parts.wood} material={wood} position={[-4.75, 0, 28.5]} rotation-z={0.18} castShadow receiveShadow />
      {/* on the sidewalk (x -5.4 to -4.5), clear of the ladder */}
      <group position={[-4.9, 0, 27.6]}>
        <mesh geometry={parts.bucket} material={blue} castShadow receiveShadow />
        <mesh geometry={parts.handle} material={tin} castShadow />
      </group>
    </group>
  );
}

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

function catenary(x0: number, y0: number, x1: number, y1: number, sag: number, z: number, along: "x" | "z", n = 24): V3[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = i / n;
    const a = x0 + (x1 - x0) * s;
    const y = y0 + (y1 - y0) * s - sag * 4 * s * (1 - s);
    return along === "x" ? [a, y, z] : [z, y, a];
  });
}

export const BAY_TOWERS = [52, 70, 88, 106];
const [BAY_WEST, BAY_EAST] = BAY_ANCHORS;
/** Cables run from the anchorages (ends hidden inside them) over the towers. */
const BAY_CABLES: [number, number, number, number, number][] = [
  [BAY_WEST, bayDeckY(BAY_WEST) - 0.4, BAY_TOWERS[0], 26, 6],
  ...BAY_TOWERS.slice(1).map((x, i): [number, number, number, number, number] => [BAY_TOWERS[i], 26, x, 26, 12]),
  [BAY_TOWERS[BAY_TOWERS.length - 1], 26, BAY_EAST, bayDeckY(BAY_EAST) - 0.4, 6],
];
const bayRoad = (name: string) => ROADS.find((r) => r.name === name) as Road;
/**
 * Bay Bridge towers: two legs (`leg`: x by z) with the road passing between
 * them (inner faces at `inner`), X-bracing (`braces`: centre heights, `rise`:
 * height each diagonal climbs) and struts (`struts`, `strutH` tall), all clear
 * of the traffic on the deck.
 */
export const BAY_TOWER = { inner: 1.8, leg: [0.9, 0.7], braces: [11.5, 18.5], rise: 2.17, struts: [DECK_Y - 1.5, 15, 22, 25.7], strutH: 0.5 };
const BAY_LEG = BAY_TOWER.inner + BAY_TOWER.leg[1] / 2;
const BAY_BRACE = { len: Math.hypot(2 * BAY_LEG, BAY_TOWER.rise), angle: Math.atan2(BAY_TOWER.rise, 2 * BAY_LEG) };

/** Bay Bridge (west span): steel towers with X-bracing, cables, suspenders, the light sculpture, side spans down to the anchorages, the Yerba Buena tunnel portal. */
export function BayBridge() {
  const lights = useRef<InstancedMesh>(null);
  const glow = useGlow("#eef3ff", 5, 0);
  const { baysteel, concrete } = useLandmarkTextures();
  const steel = useMemo(() => worldMaterial(baysteel, 2.2), [baysteel]);
  const deck = useMemo(() => worldMaterial(baysteel, 2.2, "#b4b0aa"), [baysteel]);
  const stone = useMemo(() => worldMaterial(concrete, 3), [concrete]);
  const grey = useMat("#9a9488", 0.9);
  const cableMat = useMemo(() => new MeshStandardMaterial({ color: "#8d959e", roughness: 0.45, metalness: 0.4 }), []);
  const lightPoints = useMemo(() => {
    const pts: V3[] = [];
    for (const z of [14 - CABLE, 14 + CABLE]) {
      for (const [x0, y0, x1, y1, sag] of BAY_CABLES) {
        for (const p of catenary(x0, y0, x1, y1, sag, z, "x", 20)) {
          for (let y = bayDeckY(p[0]) + 0.6; y < p[1]; y += 1.4) pts.push([p[0], y, z]);
        }
      }
    }
    return pts;
  }, []);
  const cables = useMemo(
    () =>
      [14 - CABLE, 14 + CABLE].flatMap((z) =>
        BAY_CABLES.map(([x0, y0, x1, y1, sag]) => new TubeGeometry(new CatmullRomCurve3(catenary(x0, y0, x1, y1, sag, z, "x", 40).map((p) => new Vector3(...p))), 80, 0.18, 6)),
      ),
    [],
  );
  const suspenders = useMemo(() => {
    const pts: number[] = [];
    for (const z of [14 - CABLE, 14 + CABLE]) {
      for (const [x0, y0, x1, y1, sag] of BAY_CABLES) {
        for (const [x, y] of catenary(x0, y0, x1, y1, sag, z, "x", Math.round(Math.abs(x1 - x0) / 1.6))) {
          const d = bayDeckY(x);
          if (y > d + 0.8) pts.push(x, y, z, x, d - 0.1, z); // ends hidden inside the deck
        }
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pts, 3));
  }, []);
  // Side spans down to the anchorages, the anchorages, and the tunnel portal into Yerba Buena Island.
  const parts = useMemo(() => {
    const east = bayRoad("bay-bridge-east");
    const [px, py] = east.points[east.points.length - 1];
    return {
      // side spans and the open railing along the whole deck
      spans: merged([spanGeometry(bayRoad("bay-bridge-west")), spanGeometry(east), railingGeometry(DECKS[1].points)]),
      // grey concrete like the tower piers: the piers, and the anchorages with a coping and vertical ribs
      grey: merged([
        ...BAY_TOWERS.map((x) => box([x, DECK_Y - 4, 14], [2.4, 7, 2 * BAY_LEG + 1.1])),
        ...BAY_ANCHORS.flatMap((x) => {
          const top = bayDeckY(x) - SLAB;
          const h = top - 0.25 + 1.2;
          return [
            box([x, -1.2 + h / 2, 14], [2, h, 4.2]),
            box([x, top - 0.125, 14], [2.3, 0.25, 4.5]),
            ...[-1.4, -0.47, 0.47, 1.4].flatMap((dz) => [-1, 1].map((s) => box([x + s * 1.04, -1.2 + (h - 0.2) / 2, 14 + dz], [0.08, h - 0.2, 0.32]))),
            ...[-0.5, 0.5].flatMap((dx) => [-1, 1].map((s) => box([x + dx, -1.2 + (h - 0.2) / 2, 14 + s * 2.14], [0.32, h - 0.2, 0.08]))),
          ];
        }),
      ]),
      stone: merged([
        // portal: jambs either side of the road, a lintel over it, a coping on top
        ...[-1, 1].map((s) => box([px + 0.4, (py + 1.9 - 1.2) / 2, 14 + s * 2], [0.8, py + 1.9 + 1.2, 1])), // down into the water
        box([px + 0.4, py + 1.6, 14], [0.8, 0.6, 3]),
        box([px + 0.36, py + 1.95, 14], [0.95, 0.12, 5.2]),
      ]),
      tunnel: box([px + 0.55, py + 0.65, 14], [0.5, 1.3, 3]),
    };
  }, []);

  useLayoutEffect(() => {
    const mesh = lights.current;
    if (!mesh) return;
    const o = new Object3D();
    lightPoints.forEach((p, i) => {
      o.position.set(...p);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [lightPoints]);

  // The level main deck between the end towers; its top sits just under the road (Roads draws the asphalt).
  const x0 = BAY_TOWERS[0];
  const length = BAY_TOWERS[BAY_TOWERS.length - 1] - x0;
  return (
    <group>
      <mesh position={[x0 + length / 2, DECK_Y - 0.28, 14]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[length, 0.5, 3]} />
      </mesh>
      <mesh position={[x0 + length / 2, DECK_Y - 1.08, 14]} material={steel} castShadow>
        <boxGeometry args={[length, 1.1, 2.6]} />
      </mesh>
      <mesh geometry={parts.spans} material={steel} castShadow receiveShadow />
      <mesh geometry={parts.stone} material={stone} castShadow receiveShadow />
      <mesh geometry={parts.grey} material={grey} castShadow receiveShadow />
      <mesh geometry={parts.tunnel}>
        <meshBasicMaterial color="#0b0c0e" />
      </mesh>
      {BAY_TOWERS.map((x) => (
        <group key={x} position={[x, 0, 14]}>
          {[-BAY_LEG, BAY_LEG].map((dz) => (
            <mesh key={dz} position={[0, 13, dz]} material={steel} castShadow>
              <boxGeometry args={[BAY_TOWER.leg[0], 26, BAY_TOWER.leg[1]]} />
            </mesh>
          ))}
          {/* X-bracing between the legs, above the traffic */}
          {BAY_TOWER.braces.map((y) =>
            [-1, 1].map((k) => (
              <mesh key={`${y}${k}`} position={[0, y, 0]} rotation-x={k * BAY_BRACE.angle} material={steel} castShadow>
                <boxGeometry args={[0.35, 0.35, BAY_BRACE.len]} />
              </mesh>
            )),
          )}
          {BAY_TOWER.struts.map((y) => (
            <mesh key={y} position={[0, y, 0]} material={steel} castShadow>
              <boxGeometry args={[0.6, BAY_TOWER.strutH, 2 * BAY_LEG]} />
            </mesh>
          ))}
        </group>
      ))}
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cableMat} castShadow />
      ))}
      <lineSegments geometry={suspenders}>
        <lineBasicMaterial color="#7d8690" transparent opacity={0.7} />
      </lineSegments>
      <instancedMesh ref={lights} args={[undefined, glow, lightPoints.length]}>
        <sphereGeometry args={[0.07, 6, 4]} />
      </instancedMesh>
    </group>
  );
}

/**
 * The road surface on both main decks and the roads at the four bridge ends
 * (roads.ts): one mesh each for asphalt, lane marks and concrete. The asphalt
 * is mapped like the street texture, so a road and the street it lands on match.
 */
export function Roads() {
  const { asphalt, concrete } = useLandmarkTextures();
  const materials = useMemo(() => {
    const road = worldMaterial(asphalt, 6);
    road.roughness = 0.85;
    road.metalness = 0;
    const marks = new MeshStandardMaterial({ color: new Color(0.86, 0.84, 0.78), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    return { road, marks, concrete: worldMaterial(concrete, 3) };
  }, [asphalt, concrete]);
  const geometry = useMemo(() => {
    const roads = ROADS.map(roadGeometry);
    const decks = DECKS.map((d) => deckGeometry(d.points));
    return {
      road: merged([...roads, ...decks].map((g) => g.asphalt)),
      marks: merged([...roads, ...decks].map((g) => g.marks)),
      concrete: merged(roads.map((g) => g.concrete)),
    };
  }, []);
  return (
    <group>
      <mesh geometry={geometry.road} material={materials.road} receiveShadow />
      <mesh geometry={geometry.marks} material={materials.marks} receiveShadow />
      <mesh geometry={geometry.concrete} material={materials.concrete} castShadow receiveShadow />
    </group>
  );
}

/** Golden Gate Bridge across the strait to the north-west: the 06:00 backdrop. */
/** `anchorTop`: the anchorages stop under the road slab, so the road runs on over them. */
export const GG = { x: -80, deck: DECK_Y, towers: [-70, -134], south: -52, north: -152, top: 30, anchorTop: DECK_Y - SLAB, red: "#c0442c" };
/**
 * Golden Gate towers: legs in three tiers [y0, y1, width across] that step in
 * on the outside as they rise, inner faces at `inner` so the road passes
 * between them; portal struts (`struts`, `strutH` tall) over the traffic.
 */
export const GG_TOWER = {
  inner: 1.8,
  tiers: [[0, 11, 1.1], [11, 21, 0.95], [21, GG.top, 0.8]] as [number, number, number][],
  struts: [9.6, 15.5, 20.5, 25.5, GG.top - 0.3],
  strutH: 0.7,
};
const GG_SPANS: [number, number, number, number, number][] = [
  // cable ends go down into the anchorages, under the road
  [GG.south, GG.deck - 0.4, GG.towers[0], GG.top - 0.6, 3],
  [GG.towers[0], GG.top - 0.6, GG.towers[1], GG.top - 0.6, 20],
  [GG.towers[1], GG.top - 0.6, GG.north, GG.deck - 0.4, 3],
];

/**
 * Golden Gate anchorages at both deck ends: a concrete block that steps in
 * under the road, with pilasters, and an Art Deco pylon either side of the
 * road in the bridge's steel. Nothing reaches over the road (|x| < 1.5 above anchorTop).
 */
function ggAnchorages() {
  const concrete: BufferGeometry[] = [];
  const steel: BufferGeometry[] = [];
  const top = GG.anchorTop;
  for (const z of [GG.south, GG.north]) {
    concrete.push(box([GG.x, (top - 1.4 - 0.8) / 2, z], [4.6, top - 1.4 + 0.8, 4])); // base, into the water
    concrete.push(box([GG.x, top - 0.75, z], [4.2, 1.3, 3.6])); // stepped top under the road
    concrete.push(box([GG.x, top - 1.47, z], [4.8, 0.14, 4.2])); // string course between them
    for (const dx of [-1.6, -0.55, 0.55, 1.6]) for (const s of [-1, 1]) concrete.push(box([GG.x + dx, (top - 1.6 - 0.45) / 2, z + s * 2.03], [0.34, top - 1.6 + 0.45, 0.08])); // pilasters
    for (const s of [-1, 1]) {
      const x = GG.x + s * 2.05;
      // stepped pylon beside the road, on the anchorage
      steel.push(box([x, top + 1.2, z], [0.6, 2.4, 1.5]));
      steel.push(box([x, top + 2.85, z], [0.48, 0.9, 1.2]));
      steel.push(box([x, top + 3.6, z], [0.36, 0.6, 0.9]));
      steel.push(box([x, top + 4.05, z], [0.22, 0.3, 0.55]));
      steel.push(box([x, top + 2.42, z], [0.7, 0.08, 1.6])); // ledges at the steps
      steel.push(box([x, top + 3.32, z], [0.56, 0.06, 1.3]));
      for (const dz of [-0.4, 0, 0.4]) steel.push(box([x - s * 0.31, top + 1.3, z + dz], [0.04, 1.8, 0.12])); // fluting on the road side
    }
  }
  return { concrete: merged(concrete), steel: merged(steel) };
}

export function GoldenGate() {
  const { ggsteel, concrete } = useLandmarkTextures();
  // Riveted International Orange steel on towers and deck; the deck top is road.
  const paint = useMemo(() => worldMaterial(ggsteel, 2.2), [ggsteel]);
  const deck = useMemo(() => worldMaterial(ggsteel, 2.2, "#b4b0aa"), [ggsteel]);
  const cable = useMemo(() => new MeshStandardMaterial({ color: GG.red, roughness: 0.5, metalness: 0.3 }), []);
  const truss = useMemo(() => new MeshStandardMaterial({ color: "#7e2c1e", roughness: 0.7, metalness: 0.2 }), []);
  const stone = useMemo(() => worldMaterial(concrete, 3), [concrete]);
  const anchorages = useMemo(() => ggAnchorages(), []);
  const railing = useMemo(() => railingGeometry(DECKS[0].points), []);
  // Main cables as tubes; suspenders as thin vertical strokes down to the deck.
  const cables = useMemo(
    () =>
      [-CABLE, CABLE].flatMap((dx) =>
        GG_SPANS.map(([z0, y0, z1, y1, sag]) => new TubeGeometry(new CatmullRomCurve3(catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", 40).map((p) => new Vector3(...p))), 80, 0.2, 6)),
      ),
    [],
  );
  const suspenders = useMemo(() => {
    const pts: number[] = [];
    for (const dx of [-CABLE, CABLE]) {
      for (const [z0, y0, z1, y1, sag] of GG_SPANS) {
        for (const [x, y, z] of catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", Math.round(Math.abs(z1 - z0) / 1.6))) {
          if (y > GG.deck + 0.8) pts.push(x, y, z, x, GG.deck - 0.1, z); // ends hidden inside the deck
        }
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pts, 3));
  }, []);

  return (
    <group>
      {/* deck and truss, the deck's top just under the road (Roads draws the asphalt) */}
      <mesh position={[GG.x, GG.deck - 0.28, (GG.south + GG.north) / 2]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[3, 0.5, GG.south - GG.north]} />
      </mesh>
      <mesh position={[GG.x, GG.deck - 1.03, (GG.south + GG.north) / 2]} material={truss} castShadow>
        <boxGeometry args={[2.6, 1, GG.south - GG.north]} />
      </mesh>
      {/* open railings along both edges, just outside the road */}
      <mesh geometry={railing} material={paint} castShadow />
      {/* anchorages and their pylons */}
      <mesh geometry={anchorages.concrete} material={stone} castShadow receiveShadow />
      <mesh geometry={anchorages.steel} material={paint} castShadow receiveShadow />
      {/* Art Deco towers: legs step in as they rise, portal struts between them */}
      {GG.towers.map((z) => (
        <group key={z} position={[GG.x, 0, z]}>
          {[-1, 1].map((s) =>
            GG_TOWER.tiers.map(([y0, y1, w]) => (
              <mesh key={`${s}${y0}`} position={[s * (GG_TOWER.inner + w / 2), (y0 + y1) / 2, 0]} material={paint} castShadow receiveShadow>
                <boxGeometry args={[w, y1 - y0, w * 1.5]} />
              </mesh>
            )),
          )}
          {GG_TOWER.struts.map((y) => (
            <mesh key={y} position={[0, y, 0]} material={paint} castShadow>
              <boxGeometry args={[2 * GG_TOWER.inner + 0.8, GG_TOWER.strutH, 0.7]} />
            </mesh>
          ))}
          <mesh position={[0, -1.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[2 * (GG_TOWER.inner + 1.1) + 0.6, 3, 4]} />
            <meshStandardMaterial color="#b9ad98" roughness={0.9} />
          </mesh>
        </group>
      ))}
      {cables.map((g, i) => (
        <mesh key={i} geometry={g} material={cable} castShadow />
      ))}
      <lineSegments geometry={suspenders}>
        <lineBasicMaterial color={GG.red} transparent opacity={0.75} />
      </lineSegments>
    </group>
  );
}
