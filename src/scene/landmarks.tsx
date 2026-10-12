"use client";

// Named places in the city. Each chapter happens at one of these.
// Signs, the billboard and cable cars show the visitor's brand.

import { Line, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, DoubleSide, MeshStandardMaterial, Object3D, type Group, type InstancedMesh, type Mesh, type PointLight } from "three";
import { brandFromUrl } from "@/lib/brand";
import { useCity } from "@/lib/store";
import { dayNow, rig, useNightGlow } from "./shared";
import { facadeMaterial } from "./facade";
import { chartTexture, useSign } from "./textures";

const useBrand = () => (brandFromUrl(useCity((s) => s.website)) ?? "your brand").toUpperCase();

function useGlow(color: string, max: number, base = 0) {
  const material = useMemo(() => new MeshStandardMaterial({ color: "#222", emissive: new Color(color), emissiveIntensity: base }), [color, base]);
  useNightGlow(material, max, base);
  return material;
}

type V3 = [number, number, number];

type BoxProps = { p: V3; s: V3; color: string; rough?: number; rotation?: V3; walls?: { floor: number; window: number } };

/** A box. With `walls` it gets windows from the facade shader. */
function Box({ p, s, color, rough = 0.85, walls, ...rest }: BoxProps) {
  const floor = walls?.floor;
  const window = walls?.window;
  const facade = useMemo(() => {
    if (!floor || !window) return null;
    const m = facadeMaterial({ floor, window, roughness: rough });
    m.color.set(color);
    return m;
  }, [floor, window, color, rough]);
  return (
    <mesh position={p} castShadow receiveShadow {...rest} material={facade ?? undefined}>
      <boxGeometry args={s} />
      {!facade && <meshStandardMaterial color={color} roughness={rough} />}
    </mesh>
  );
}

const HOUSE_WALLS = { floor: 2.2, window: 1.15 };
const STONE_WALLS = { floor: 1.8, window: 1.2 };

/** 06:00 Russian Hill rooftop. Cuso stands on its north edge, over the bay. */
export function Rooftop() {
  return (
    <group>
      <Box p={[-14, 4, -10.4]} s={[7, 8, 6]} color="#e8dccb" walls={HOUSE_WALLS} />
      <Box p={[-14, 8.18, -7.55]} s={[7, 0.36, 0.3]} color="#d8cab5" />
      <Box p={[-17.35, 8.18, -10.4]} s={[0.3, 0.36, 6]} color="#d8cab5" />
      <Box p={[-10.65, 8.18, -10.4]} s={[0.3, 0.36, 6]} color="#d8cab5" />
      <Box p={[-16.4, 8.35, -9]} s={[1, 0.7, 0.8]} color="#b9b2a8" />
    </group>
  );
}

/** 07:00 Hayes Valley shop. The sign shows the visitor's brand. */
export function Shopfront() {
  const sign = useSign(useBrand(), { bg: "#f1e7d3", fg: "#2b2620" });
  const glass = useGlow("#ffd9a0", 0.6, 0.35);
  return (
    <group>
      <Box p={[-11, 2.2, 9.3]} s={[8, 4.4, 4.6]} color="#2f3a36" rough={0.6} />
      <Box p={[-11, 5.4, 9.3]} s={[8, 2, 4.6]} color="#e9dcc8" walls={HOUSE_WALLS} />
      <Box p={[-11, 6.55, 9.45]} s={[8.3, 0.3, 4.9]} color="#f7f2e8" />
      <mesh position={[-12.2, 1.3, 11.62]} material={glass}>
        <planeGeometry args={[4.4, 2]} />
      </mesh>
      <Box p={[-8.6, 1.1, 11.62]} s={[1.1, 2.2, 0.06]} color="#1d2422" rough={0.5} />
      <mesh position={[-11, 3.3, 11.7]}>
        <planeGeometry args={[6.4, 1.1]} />
        <meshStandardMaterial map={sign} roughness={0.7} />
      </mesh>
      <StreetLamp p={[-6.6, 0, 12.1]} />
    </group>
  );
}

/** 09:00 Mission wall of posts. A new post appears when you approve. */
export function MuralWall() {
  const approved = useCity((s) => s.approved);
  const photo = useTexture("/concepts/03-social.jpg");
  const fresh = useRef<Mesh>(null);
  const tiles = useMemo(() => {
    const colors = ["#e8c9a8", "#9db7c9", "#d9a48f", "#c7d3b5", "#f0dcc4", "#a9b8d8", "#3d5afe", "#e3c4b9"];
    const out: { y: number; z: number; color: string }[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        if (row === 1 && col === 2) continue; // the slot the new post fills
        out.push({ y: 1.2 + row * 1.35, z: 27.1 + col * 1.25, color: colors[(row * 5 + col * 3) % colors.length] });
      }
    }
    return out;
  }, []);

  useFrame((_, dt) => {
    const m = fresh.current;
    if (!m) return;
    const s = m.scale.x + ((approved ? 1 : 0.001) - m.scale.x) * Math.min(1, dt * 6);
    m.scale.setScalar(s);
  });

  return (
    <group>
      <Box p={[-5.7, 2.7, 29]} s={[0.6, 5.4, 5.2]} color="#efe6da" />
      {tiles.map((t) => (
        <mesh key={`${t.y}${t.z}`} position={[-5.38, t.y, t.z]} rotation-y={Math.PI / 2}>
          <planeGeometry args={[1.1, 1.1]} />
          <meshStandardMaterial color={t.color} roughness={0.8} />
        </mesh>
      ))}
      <mesh ref={fresh} position={[-5.37, 2.55, 29.6]} rotation-y={Math.PI / 2} scale={0.001}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshStandardMaterial map={photo} roughness={0.7} />
      </mesh>
      {/* ladder */}
      <group position={[-4.75, 0, 28.5]} rotation-z={0.18}>
        <Box p={[0, 1.6, -0.35]} s={[0.08, 3.2, 0.08]} color="#a07a52" />
        <Box p={[0, 1.6, 0.35]} s={[0.08, 3.2, 0.08]} color="#a07a52" />
        {[0.4, 0.95, 1.5, 2.05, 2.6].map((y) => (
          <Box key={y} p={[0, y, 0]} s={[0.06, 0.06, 0.7]} color="#a07a52" />
        ))}
      </group>
      <mesh position={[-3.9, 0.22, 27.9]} castShadow>
        <cylinderGeometry args={[0.24, 0.2, 0.44, 16]} />
        <meshStandardMaterial color="#3d5afe" roughness={0.5} />
      </mesh>
    </group>
  );
}

/** 12:00 Union Square: rooftop billboard with the visitor's ad, cable car below. */
export function UnionSquare() {
  const ad = useSign(useBrand(), { bg: "#3d5afe", fg: "#ffffff", sub: "Weekend sale · 20% off", tracking: 0.08 });
  return (
    <group>
      <Box p={[7, 2.5, 9]} s={[7, 5, 5.2]} color="#d6d2ca" walls={STONE_WALLS} />
      <Box p={[6.4, 6.6, 6.9]} s={[0.15, 3.2, 0.15]} color="#59595f" />
      <Box p={[10, 6.6, 6.9]} s={[0.15, 3.2, 0.15]} color="#59595f" />
      <Box p={[8.2, 8, 6.95]} s={[5.8, 3.1, 0.2]} color="#2b2b30" />
      <mesh position={[8.2, 8, 7.06]}>
        <planeGeometry args={[5.5, 2.8]} />
        <meshStandardMaterial map={ad} roughness={0.6} emissive="#ffffff" emissiveMap={ad} emissiveIntensity={0.15} />
      </mesh>
      {/* the scissor lift Cuso works from */}
      <Box p={[5.6, 5.08, 10.4]} s={[2, 0.16, 1.6]} color="#f2b632" />
      <Rails x0={-2} x1={24} z={14} />
      <CableCar p={[11, 0, 14]} drive={{ from: 0, to: 20, speed: 0.05 }} />
    </group>
  );
}

/** 15:00 Transamerica Pyramid. Cuso plants a flag on the tip. */
export function Pyramid() {
  const flag = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.4) * 0.25;
  });
  return (
    <group position={[6.5, 0, -11]}>
      <mesh position={[0, 14, 0]} rotation-y={Math.PI / 4} castShadow receiveShadow>
        <coneGeometry args={[5.2, 28, 4, 1]} />
        <meshStandardMaterial color="#f1ece4" roughness={0.55} />
      </mesh>
      <Box p={[0, 27.95, 0]} s={[1.9, 0.1, 1.9]} color="#e6e0d6" />
      <Box p={[1.1, 29.4, -0.2]} s={[0.07, 2.9, 0.07]} color="#4a4a50" />
      <group ref={flag} position={[1.1, 30.4, -0.2]}>
        <mesh position={[0.6, 0, 0]}>
          <planeGeometry args={[1.2, 0.8]} />
          <meshStandardMaterial color="#ffffff" side={DoubleSide} roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}

export function CoitTower() {
  return (
    <group position={[2, 3.6, -26]}>
      <mesh position={[0, 2.6, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.85, 5.2, 18]} />
        <meshStandardMaterial color="#efe8da" roughness={0.8} />
      </mesh>
      <mesh position={[0, 5.4, 0]} castShadow>
        <cylinderGeometry args={[0.95, 0.95, 0.4, 18]} />
        <meshStandardMaterial color="#e2d9c8" roughness={0.8} />
      </mesh>
    </group>
  );
}

/** 18:00 Ferry Building and the California St cable car. */
export function FerryBuilding() {
  const clock = useGlow("#fff3d6", 2.2, 0.1);
  return (
    <group>
      <Box p={[33.4, -0.15, -3]} s={[5, 0.9, 14]} color="#b9a98e" />
      <Box p={[33.4, 1.7, -3]} s={[3, 2.8, 12]} color="#e9e0cf" walls={STONE_WALLS} />
      <Box p={[33.4, 4.9, -3]} s={[1.6, 9.2, 1.6]} color="#ede4d3" />
      <mesh position={[33.4, 10.1, -3]} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[1.2, 1.6, 4]} />
        <meshStandardMaterial color="#cfc3ad" roughness={0.8} />
      </mesh>
      <mesh position={[32.58, 7.9, -3]} rotation-y={-Math.PI / 2} material={clock}>
        <circleGeometry args={[0.5, 24]} />
      </mesh>
      <Rails x0={6} x1={28} z={4} />
      <CableCar p={[18.4, 0, 4]} />
      <Envelopes />
    </group>
  );
}

/** Envelopes fly off Cuso while he delivers the newsletter. */
function Envelopes() {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const day = dayNow();
    const here = day.a.id === "newsletter" && day.t === 0 && day.mode === "story";
    g.visible = here;
    if (!here) return;
    g.children.forEach((child, i) => {
      const phase = (clock.elapsedTime * 0.22 + i / g.children.length) % 1;
      child.position.set(rig.cuso.x - 0.6 - phase * 5, rig.cuso.y + 1.1 + phase * 3.2 + Math.sin(phase * 9 + i) * 0.3, rig.cuso.z + phase * 2.4);
      child.rotation.set(phase * 4 + i, phase * 6, Math.sin(phase * 7) * 0.6);
      child.scale.setScalar(Math.sin(phase * Math.PI));
    });
  });
  return (
    <group ref={group}>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} castShadow>
          <planeGeometry args={[0.36, 0.24]} />
          <meshStandardMaterial color="#ffffff" side={DoubleSide} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** 22:00 Embarcadero pier with Cuso's laptop, a mug and a lamp. */
export function Pier() {
  const pilings = useRef<InstancedMesh>(null);
  const lamp = useRef<PointLight>(null);
  const bulb = useGlow("#ffd58f", 4, 0);
  const screen = useMemo(() => chartTexture(), []);
  const posts = useMemo(() => {
    const out: [number, number][] = [];
    for (let x = 31.6; x < 41; x += 1.6) for (const z of [22, 26]) out.push([x, z]);
    return out;
  }, []);

  useLayoutEffect(() => {
    const mesh = pilings.current;
    if (!mesh) return;
    const o = new Object3D();
    posts.forEach(([x, z], i) => {
      o.position.set(x, -0.2, z);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [posts]);

  useFrame(() => {
    if (lamp.current) lamp.current.intensity = rig.night * 18;
  });

  return (
    <group>
      <Box p={[36, 0.25, 24]} s={[10, 0.6, 4.4]} color="#8a7560" />
      <instancedMesh ref={pilings} args={[undefined, undefined, posts.length]}>
        <cylinderGeometry args={[0.16, 0.16, 1.2, 8]} />
        <meshStandardMaterial color="#5b4a3a" roughness={1} />
      </instancedMesh>
      <Box p={[36, 1.05, 21.95]} s={[10, 0.08, 0.08]} color="#3b3b40" />
      <Box p={[36, 0.75, 21.95]} s={[10, 0.06, 0.06]} color="#3b3b40" />
      {/* lamp */}
      <Box p={[35.2, 2.1, 22.2]} s={[0.1, 3.1, 0.1]} color="#2e2e33" />
      <mesh position={[35.2, 3.7, 22.2]} material={bulb}>
        <sphereGeometry args={[0.22, 16, 12]} />
      </mesh>
      <pointLight ref={lamp} position={[35.2, 3.4, 22.4]} color="#ffcf8a" distance={10} decay={1.6} intensity={0} />
      {/* laptop and mug */}
      <Box p={[35.1, 0.58, 24.1]} s={[1.1, 0.05, 0.75]} color="#c9c9cf" rough={0.4} />
      <mesh position={[35.1, 0.95, 23.74]} rotation-x={-0.25}>
        <planeGeometry args={[1.1, 0.7]} />
        <meshStandardMaterial map={screen} emissive="#ffffff" emissiveMap={screen} emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[32.3, 0.79, 24.6]} castShadow>
        <cylinderGeometry args={[0.19, 0.17, 0.46, 16]} />
        <meshStandardMaterial color="#f5f3ee" roughness={0.4} />
      </mesh>
    </group>
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

const BAY_TOWERS = [52, 70, 88, 106];
const BAY_DECK = 7;
const BAY_CABLES: [number, number, number, number, number][] = [
  [31, BAY_DECK + 1, BAY_TOWERS[0], 26, 6],
  ...BAY_TOWERS.slice(1).map((x, i): [number, number, number, number, number] => [BAY_TOWERS[i], 26, x, 26, 12]),
  [BAY_TOWERS[BAY_TOWERS.length - 1], 26, 124, BAY_DECK + 1, 6],
];

/** Bay Bridge with its light sculpture, lit at night. */
export function BayBridge() {
  const lights = useRef<InstancedMesh>(null);
  const glow = useGlow("#eef3ff", 5, 0);
  const towers = BAY_TOWERS;
  const deckY = BAY_DECK;
  const cables = BAY_CABLES;
  const lightPoints = useMemo(() => {
    const pts: V3[] = [];
    for (const z of [13, 15]) {
      for (const [x0, y0, x1, y1, sag] of BAY_CABLES) {
        for (const p of catenary(x0, y0, x1, y1, sag, z, "x", 20)) {
          for (let y = BAY_DECK + 0.6; y < p[1]; y += 1.4) pts.push([p[0], y, z]);
        }
      }
    }
    return pts;
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

  return (
    <group>
      <Box p={[85, deckY, 14]} s={[108, 0.5, 2.6]} color="#8e979f" />
      {towers.map((x) => (
        <group key={x}>
          <Box p={[x, 13, 12.9]} s={[0.6, 26, 0.6]} color="#8e979f" />
          <Box p={[x, 13, 15.1]} s={[0.6, 26, 0.6]} color="#8e979f" />
          <Box p={[x, 24, 14]} s={[0.5, 0.5, 2.8]} color="#8e979f" />
          <Box p={[x, deckY - 3.7, 14]} s={[2, 7, 3]} color="#80888f" />
        </group>
      ))}
      {[13, 15].flatMap((z) =>
        cables.map(([x0, y0, x1, y1, sag]) => (
          <Line key={`${z}${x0}`} points={catenary(x0, y0, x1, y1, sag, z, "x")} color="#7d8690" lineWidth={1.4} />
        )),
      )}
      <instancedMesh ref={lights} args={[undefined, glow, lightPoints.length]}>
        <sphereGeometry args={[0.07, 6, 4]} />
      </instancedMesh>
    </group>
  );
}

/** Golden Gate Bridge across the strait to the north-west. */
export function GoldenGate() {
  const towers = [-70, -134];
  const red = "#bf4a32";
  return (
    <group>
      <Box p={[-80, 7, -102]} s={[2.6, 0.6, 100]} color={red} />
      {towers.map((z) => (
        <group key={z}>
          <Box p={[-81.2, 15, z]} s={[0.8, 30, 0.8]} color={red} />
          <Box p={[-78.8, 15, z]} s={[0.8, 30, 0.8]} color={red} />
          {[14, 21, 28].map((y) => (
            <Box key={y} p={[-80, y, z]} s={[3, 0.6, 0.6]} color={red} />
          ))}
        </group>
      ))}
      {[-81.2, -78.8].flatMap((x) =>
        [
          [-52, 8, -70, 29, 3],
          [-70, 29, -134, 29, 22],
          [-134, 29, -152, 8, 3],
        ].map(([z0, y0, z1, y1, sag]) => <Line key={`${x}${z0}`} points={catenary(z0, y0, z1, y1, sag, x, "z")} color={red} lineWidth={1.6} />),
      )}
    </group>
  );
}

function Rails({ x0, x1, z }: { x0: number; x1: number; z: number }) {
  return (
    <>
      {[-0.42, 0.42].map((dz) => (
        <Box key={dz} p={[(x0 + x1) / 2, 0.02, z + dz]} s={[x1 - x0, 0.04, 0.08]} color="#5a5650" rough={0.5} />
      ))}
    </>
  );
}

function CableCar({ p, drive }: { p: V3; drive?: { from: number; to: number; speed: number } }) {
  const group = useRef<Group>(null);
  const panel = useSign(useBrand(), { bg: "#f3e8cf", fg: "#6b2a1f", width: 1024, height: 200 });
  const windows = useGlow("#ffdca8", 1.4, 0.05);
  useFrame(({ clock }) => {
    if (!drive || !group.current) return;
    const s = (Math.sin(clock.elapsedTime * drive.speed * Math.PI * 2) + 1) / 2;
    group.current.position.x = drive.from + (drive.to - drive.from) * s;
  });
  return (
    <group ref={group} position={p}>
      <Box p={[0, 0.55, 0]} s={[3.8, 0.7, 1.7]} color="#7a2f22" rough={0.6} />
      <Box p={[0, 1.3, 0]} s={[3.8, 0.8, 1.5]} color="#efe3c6" rough={0.7} />
      <mesh position={[0, 1.32, 0.76]} material={windows}>
        <planeGeometry args={[3.4, 0.5]} />
      </mesh>
      <Box p={[0, 1.82, 0]} s={[4.1, 0.16, 1.9]} color="#5b2219" rough={0.6} />
      <mesh position={[0, 0.58, 0.86]}>
        <planeGeometry args={[2.8, 0.5]} />
        <meshStandardMaterial map={panel} roughness={0.7} />
      </mesh>
    </group>
  );
}

function StreetLamp({ p }: { p: V3 }) {
  const bulb = useGlow("#ffd58f", 3.5, 0);
  return (
    <group position={p}>
      <Box p={[0, 1.5, 0]} s={[0.08, 3, 0.08]} color="#2e2e33" />
      <mesh position={[0, 3.05, 0]} material={bulb}>
        <sphereGeometry args={[0.16, 12, 10]} />
      </mesh>
    </group>
  );
}
