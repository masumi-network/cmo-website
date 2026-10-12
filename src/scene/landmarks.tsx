"use client";

// Named places in the city. Each chapter happens at one of these.
// Signs, the billboard and cable cars show the visitor's brand.

import { Line, useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { AdditiveBlending, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Float32BufferAttribute, TubeGeometry, Vector3, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Group, type InstancedMesh, type Mesh, type PointLight, type Texture } from "three";
import { brandFromUrl } from "@/lib/brand";
import { heightAt } from "@/lib/terrain";
import { useCity } from "@/lib/store";
import { dayNow, rig, useNightGlow } from "./shared";
import { towerMaterial, worldMaterial } from "./materials";
import { chartTexture, useSign } from "./textures";

const useBrand = () => (brandFromUrl(useCity((s) => s.website)) ?? "your brand").toUpperCase();

function useGlow(color: string, max: number, base = 0) {
  const material = useMemo(() => new MeshStandardMaterial({ color: "#222", emissive: new Color(color), emissiveIntensity: base }), [color, base]);
  useNightGlow(material, max, base);
  return material;
}

type V3 = [number, number, number];

const LANDMARK_TEXTURES = {
  apartment: "/textures/apartment.jpg",
  shopfront: "/textures/shopfront.jpg",
  posts: "/textures/posts.jpg",
  precast: "/textures/precast.jpg",
  stone: "/textures/stone.jpg",
  ggsteel: "/textures/ggsteel.jpg",
};
type LandmarkTextures = Record<keyof typeof LANDMARK_TEXTURES, Texture>;

function useLandmarkTextures() {
  return useTexture(LANDMARK_TEXTURES, (loaded) => {
    for (const t of Object.values(loaded as LandmarkTextures)) {
      t.colorSpace = SRGBColorSpace;
      t.anisotropy = 8;
      t.wrapS = t.wrapT = RepeatWrapping;
    }
  }) as LandmarkTextures;
}

/** Limestone walls (same as the downtown towers), for landmark boxes. */
function useStone() {
  const { stone } = useLandmarkTextures();
  return useMemo(() => towerMaterial(stone, { w: 4.8, h: 7.2 }, false), [stone]);
}

/** Glows at night through a window (adds light, invisible by day). */
function useWindowGlow(color: string, max: number) {
  const material = useMemo(
    () => new MeshStandardMaterial({ color: "#000", emissive: new Color(color), emissiveIntensity: 0, transparent: true, blending: AdditiveBlending, depthWrite: false }),
    [color],
  );
  useNightGlow(material, max, 0.08);
  return material;
}

type BoxProps = { p: V3; s: V3; color: string; rough?: number; rotation?: V3 };

function Box({ p, s, color, rough = 0.85, ...rest }: BoxProps) {
  return (
    <mesh position={p} castShadow receiveShadow {...rest}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={rough} />
    </mesh>
  );
}

/** 06:00 Russian Hill rooftop. Cuso stands on its north edge, over the bay. */
export function Rooftop() {
  const { apartment } = useLandmarkTextures();
  const materials = useMemo(() => {
    const wall = new MeshStandardMaterial({ map: apartment, roughness: 0.8 });
    const top = new MeshStandardMaterial({ color: "#cdbfae", roughness: 0.95 });
    return [wall, wall, top, top, wall, wall];
  }, [apartment]);
  return (
    <group position-y={heightAt(-14, -10.4)}>
      <mesh position={[-14, 3.7, -10.4]} material={materials} castShadow receiveShadow>
        <boxGeometry args={[7, 8.6, 6]} />
      </mesh>
      <Box p={[-14, 8.18, -7.55]} s={[7, 0.36, 0.3]} color="#d8cab5" />
      <Box p={[-17.35, 8.18, -10.4]} s={[0.3, 0.36, 6]} color="#d8cab5" />
      <Box p={[-10.65, 8.18, -10.4]} s={[0.3, 0.36, 6]} color="#d8cab5" />
      <Box p={[-16.4, 8.35, -9]} s={[1, 0.7, 0.8]} color="#b9b2a8" />
    </group>
  );
}

/** 07:00 Hayes Valley shop. The sign shows the visitor's brand. */
export function Shopfront() {
  const sign = useSign(useBrand(), { bg: "#efe6d0", fg: "#1f3b2f" });
  const glow = useWindowGlow("#ffcf8a", 0.9);
  const { shopfront } = useLandmarkTextures();
  const materials = useMemo(() => {
    const front = new MeshStandardMaterial({ map: shopfront, roughness: 0.7 });
    const side = new MeshStandardMaterial({ color: "#e6dcc6", roughness: 0.9 });
    return [side, side, side, side, front, side];
  }, [shopfront]);
  return (
    <group position-y={heightAt(-11, 9.3)}>
      <mesh position={[-11, 2.7, 9.3]} material={materials} castShadow receiveShadow>
        <boxGeometry args={[8, 5.4, 4.6]} />
      </mesh>
      <Box p={[-11, 5.5, 9.4]} s={[8.3, 0.22, 4.9]} color="#f3ede0" />
      {/* the shop window glows at night */}
      <mesh position={[-11.73, 1.78, 11.62]} material={glow}>
        <planeGeometry args={[5.1, 1.9]} />
      </mesh>
      {/* the visitor's brand on the sign band */}
      <mesh position={[-11, 3.17, 11.64]}>
        <planeGeometry args={[6.8, 0.85]} />
        <meshStandardMaterial map={sign} roughness={0.7} />
      </mesh>
      <StreetLamp p={[-6.6, 0, 12.1]} />
    </group>
  );
}

/** 09:00 Mission wall of posts. A new post appears when you approve. */
export function MuralWall() {
  const approved = useCity((s) => s.approved);
  const { posts } = useLandmarkTextures();
  const fresh = useRef<Mesh>(null);
  // One photo per tile, cut from the 4 x 3 grid of posts.
  const tiles = useMemo(() => {
    const out: { y: number; z: number; map: Texture; fresh: boolean }[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        const map = posts.clone();
        map.repeat.set(0.25 * 0.96, (1 / 3) * 0.96);
        map.offset.set(col * 0.25 + 0.005, (row / 3) + 0.006);
        out.push({ y: 1.2 + row * 1.35, z: 27.1 + col * 1.25, map, fresh: row === 1 && col === 2 });
      }
    }
    return out;
  }, [posts]);
  const freshTile = tiles.find((t) => t.fresh)!;

  useFrame((_, dt) => {
    const m = fresh.current;
    if (!m) return;
    const s = m.scale.x + ((approved ? 1 : 0.001) - m.scale.x) * Math.min(1, dt * 6);
    m.scale.setScalar(s);
  });

  return (
    <group position-y={heightAt(-5.7, 29)}>
      <Box p={[-5.7, 2.7, 29]} s={[0.6, 5.4, 5.2]} color="#efe6da" />
      {tiles
        .filter((t) => !t.fresh)
        .map((t) => (
          <mesh key={`${t.y}${t.z}`} position={[-5.38, t.y, t.z]} rotation-y={Math.PI / 2}>
            <planeGeometry args={[1.1, 1.1]} />
            <meshStandardMaterial map={t.map} roughness={0.75} />
          </mesh>
        ))}
      <mesh ref={fresh} position={[-5.37, freshTile.y, freshTile.z]} rotation-y={Math.PI / 2} scale={0.001}>
        <planeGeometry args={[1.1, 1.1]} />
        <meshStandardMaterial map={freshTile.map} roughness={0.7} />
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
  const stone = useStone();
  return (
    <group position-y={heightAt(7, 9)}>
      <mesh position={[7, 2.5, 9]} material={stone} castShadow receiveShadow>
        <boxGeometry args={[7, 5, 5.2]} />
      </mesh>
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
  const { precast } = useLandmarkTextures();
  const skin = useMemo(() => {
    const t = precast.clone();
    t.repeat.set(16, 15);
    return t;
  }, [precast]);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.4) * 0.25;
  });
  return (
    <group position={[6.5, heightAt(6.5, -11), -11]}>
      <mesh position={[0, 14, 0]} rotation-y={Math.PI / 4} castShadow receiveShadow>
        <coneGeometry args={[5.2, 28, 4, 1]} />
        <meshStandardMaterial map={skin} roughness={0.6} />
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
    <group position={[2, heightAt(2, -26) - 0.3, -26]}>
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
  const stone = useStone();
  return (
    <group>
      <Box p={[33.4, -0.15, -3]} s={[5, 0.9, 14]} color="#b9a98e" />
      <mesh position={[33.4, 1.7, -3]} material={stone} castShadow receiveShadow>
        <boxGeometry args={[3, 2.8, 12]} />
      </mesh>
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

/** Golden Gate Bridge across the strait to the north-west: the 06:00 backdrop. */
const GG = { x: -80, deck: 7, towers: [-70, -134], south: -52, north: -152, top: 30, red: "#c0442c" };
const GG_SPANS: [number, number, number, number, number][] = [
  [GG.south, GG.deck + 1.2, GG.towers[0], GG.top - 0.6, 3],
  [GG.towers[0], GG.top - 0.6, GG.towers[1], GG.top - 0.6, 20],
  [GG.towers[1], GG.top - 0.6, GG.north, GG.deck + 1.2, 3],
];

export function GoldenGate() {
  const { ggsteel } = useLandmarkTextures();
  // Riveted International Orange steel on towers and deck; the deck top is road.
  const paint = useMemo(() => worldMaterial(ggsteel, 2.2), [ggsteel]);
  const deck = useMemo(() => worldMaterial(ggsteel, 2.2, "#3b3a3a"), [ggsteel]);
  const cable = useMemo(() => new MeshStandardMaterial({ color: GG.red, roughness: 0.5, metalness: 0.3 }), []);
  const truss = useMemo(() => new MeshStandardMaterial({ color: "#7e2c1e", roughness: 0.7, metalness: 0.2 }), []);
  // Main cables as tubes; suspenders as thin vertical strokes down to the deck.
  const cables = useMemo(
    () =>
      [-1.25, 1.25].flatMap((dx) =>
        GG_SPANS.map(([z0, y0, z1, y1, sag]) => new TubeGeometry(new CatmullRomCurve3(catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", 40).map((p) => new Vector3(...p))), 80, 0.2, 6)),
      ),
    [],
  );
  const suspenders = useMemo(() => {
    const pts: number[] = [];
    for (const dx of [-1.25, 1.25]) {
      for (const [z0, y0, z1, y1, sag] of GG_SPANS) {
        for (const [x, y, z] of catenary(z0, y0, z1, y1, sag, GG.x + dx, "z", Math.round(Math.abs(z1 - z0) / 1.6))) {
          if (y > GG.deck + 0.8) pts.push(x, y, z, x, GG.deck + 0.3, z);
        }
      }
    }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(pts, 3));
  }, []);

  return (
    <group>
      {/* deck and truss */}
      <mesh position={[GG.x, GG.deck, (GG.south + GG.north) / 2]} material={deck} castShadow receiveShadow>
        <boxGeometry args={[3, 0.5, GG.south - GG.north]} />
      </mesh>
      <mesh position={[GG.x, GG.deck - 0.75, (GG.south + GG.north) / 2]} material={truss} castShadow>
        <boxGeometry args={[2.6, 1, GG.south - GG.north]} />
      </mesh>
      {/* anchorages */}
      {[GG.south, GG.north].map((z) => (
        <mesh key={z} position={[GG.x, GG.deck / 2, z]} castShadow receiveShadow>
          <boxGeometry args={[4.6, GG.deck + 1.6, 4]} />
          <meshStandardMaterial color="#b9ad98" roughness={0.9} />
        </mesh>
      ))}
      {/* Art Deco towers: legs step in as they rise, portal struts between them */}
      {GG.towers.map((z) => (
        <group key={z} position={[GG.x, 0, z]}>
          {[-1.25, 1.25].map((dx) =>
            [
              [0, 11, 1.1],
              [11, 21, 0.95],
              [21, GG.top, 0.8],
            ].map(([y0, y1, w]) => (
              <mesh key={`${dx}${y0}`} position={[dx, (y0 + y1) / 2, 0]} material={paint} castShadow receiveShadow>
                <boxGeometry args={[w, y1 - y0, w * 1.5]} />
              </mesh>
            )),
          )}
          {[9.6, 15.5, 20.5, 25.5, GG.top - 0.3].map((y) => (
            <mesh key={y} position={[0, y, 0]} material={paint} castShadow>
              <boxGeometry args={[3.2, 0.7, 0.7]} />
            </mesh>
          ))}
          <mesh position={[0, -1.5, 0]} castShadow receiveShadow>
            <boxGeometry args={[4.6, 3, 4]} />
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
