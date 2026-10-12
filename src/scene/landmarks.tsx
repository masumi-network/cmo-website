"use client";

// Named places in the city. Each chapter happens at one of these.
// Signs, the billboard and cable cars show the visitor's brand.

import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, CatmullRomCurve3, CircleGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, PlaneGeometry, TorusGeometry, TubeGeometry, Vector3, MeshStandardMaterial, Object3D, RepeatWrapping, SRGBColorSpace, type Group, type InstancedMesh, type Texture } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { heightAt } from "@/lib/terrain";
import { useCity } from "@/lib/store";
import { dayNow, rig, useNightGlow } from "./shared";
import { towerMaterial, worldMaterial } from "./materials";
import { BAY_ANCHORS, CABLE, DECKS, DECK_Y, ROADS, SLAB, bayDeckY, deckGeometry, railingGeometry, roadGeometry, spanGeometry, type Road } from "./roads";
import { CableCar, Rails } from "./cable-car";
import { Box, useBrand, useGlow, type V3 } from "./parts";
import { useSign } from "./textures";
import { FLAT, reliefBuilder } from "./houses";

const LANDMARK_TEXTURES = {
  apartment: "/textures/apartment.jpg",
  shopfront: "/textures/shopfront.jpg",
  posts: "/textures/posts.jpg",
  stone: "/textures/stone.jpg",
  siding: "/textures/siding.jpg",
  ggsteel: "/textures/ggsteel.jpg",
  baysteel: "/textures/baysteel.jpg",
  asphalt: "/textures/asphalt.jpg",
  concrete: "/textures/concrete.jpg",
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

// Landmark detail is built from simple parts merged into one geometry per
// material, so a whole building is a handful of draw calls.
const placer = new Object3D();
function placed(g: BufferGeometry, p: V3, r: V3 = [0, 0, 0]) {
  placer.position.set(...p);
  placer.rotation.set(...r);
  placer.updateMatrix();
  return g.applyMatrix4(placer.matrix);
}
/** A box at `p` (centre) of size `s`. */
export const box = (p: V3, s: V3, r?: V3) => placed(new BoxGeometry(...s), p, r);
/** An upright cylinder at `p` (centre). */
export const cyl = (p: V3, top: number, bottom: number, h: number, seg = 12, r?: V3) => placed(new CylinderGeometry(top, bottom, h, seg), p, r);
/** Flat-shaded copy (hard edges on low-poly solids like the pyramid). */
const faceted = (g: BufferGeometry) => {
  const out = g.toNonIndexed();
  out.computeVertexNormals();
  return out;
};
/** Parts merged into one geometry. */
export function merged(parts: BufferGeometry[]) {
  const out = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  for (const g of parts) g.dispose();
  return out;
}

function useMat(color: string, roughness = 0.85, metalness = 0) {
  return useMemo(() => new MeshStandardMaterial({ color, roughness, metalness }), [color, roughness, metalness]);
}

/** Flat roofs: tar and gravel (the concrete texture, darker and warm). */
function useRoof(w: number, d: number) {
  const { concrete } = useLandmarkTextures();
  return useMemo(() => {
    const map = concrete.clone();
    map.repeat.set(w / 2.6, d / 2.6);
    return new MeshStandardMaterial({ map, color: "#b9b0a4", roughness: 0.95 });
  }, [concrete, w, d]);
}

/** A texture drawn once with the 2D canvas (clock faces, facades, envelopes). */
function drawn(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void, color = true) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  if (color) texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * The 06:00 building, y from the ground at its centre: walls, roof height,
 * parapet (thickness, top above the roof incl. coping), cornice ring and the
 * stair bulkhead. Cuso stands on its north edge at x -14, z -12.9 and jumps up
 * from the south, so the middle stays clear. The collision test reads it.
 */
export const ROOFTOP = {
  x0: -17.5, x1: -10.5, z0: -13.6, z1: -7.4, roof: 8, base: -0.6,
  wall: 0.16, parapet: 0.355,
  cornice: { out: 0.24, bottom: 7.55, top: 7.97 },
  bulkhead: { x: -16.25, z: -8.6, w: 1.62, d: 1.42, top: 9.175 },
};

type Span = [number, number];
type Rect = [number, number, number, number];

/**
 * The apartment facade (apartment.jpg, on all four walls) measured from the
 * photo, as shares of it (u from the left, v from the base up to the roof):
 * two bays with their floor cornices, hoods and sills on the middle windows,
 * the entry. The photo is never stretched: it spans the full height and is
 * as wide as its aspect allows, centred on each wall, with plain stucco (the
 * `plain` spot of the photo) beside it. Nothing stands out further than the
 * cornice (ROOFTOP.cornice.out), so Cuso's jump beside the south wall and the
 * collision solids stay as they are.
 */
export const APARTMENT = {
  /** Height over width of apartment.jpg (768 x 1152). */
  aspect: 1152 / 768,
  /** A spot of plain stucco wall on the photo. */
  plain: [0.012, 0.55] as Span,
  bays: [[[0.035, 0.385], [0.14, 0.29]], [[0.615, 0.965], [0.71, 0.86]]] as [Span, Span][],
  bayV: [0, 0.925] as Span,
  bands: [[0.9, 0.94], [0.665, 0.695], [0.415, 0.445], [0.175, 0.205]] as Span[],
  ledges: [[0.425, 0.575, 0.878, 0.892], [0.43, 0.57, 0.72, 0.732], [0.425, 0.575, 0.652, 0.666], [0.43, 0.57, 0.478, 0.49], [0.425, 0.575, 0.404, 0.418], [0.43, 0.57, 0.238, 0.25]] as Rect[],
  posts: [[0.365, 0.4, 0, 0.205], [0.595, 0.63, 0, 0.205]] as Rect[],
  entry: [0.35, 0.645, 0.205, 0.238] as Rect,
  /** Window openings, for the night glow: three per bay and floor, the middle column, the transom. */
  windows: [
    ...[[0.74, 0.878], [0.495, 0.644], [0.249, 0.397], [0.04, 0.165]].flatMap(([v0, v1]) =>
      [[0.065, 0.11], [0.16, 0.254], [0.306, 0.349]].flatMap(([u0, u1]) => [[u0, u1, v0, v1], [1 - u1, 1 - u0, v0, v1]]),
    ),
    [0.456, 0.54, 0.735, 0.865], [0.456, 0.54, 0.492, 0.628], [0.456, 0.54, 0.253, 0.384], [0.452, 0.543, 0.154, 0.171],
  ] as Rect[],
  depth: { bay: 0.2, ledge: 0.07, post: 0.1, entry: 0.16 },
};

/** How wide the photo is on a wall: the wall's height over the photo's aspect. */
export const apartmentPhotoWidth = () => (ROOFTOP.roof - ROOFTOP.base) / APARTMENT.aspect;

/** The apartment's relief (one wall), in the relief frame of houses.tsx: scale it by (apartmentPhotoWidth, roof - base, 1). */
export function apartmentRelief() {
  const a = APARTMENT;
  const { box, bay, geometry } = reliefBuilder(apartmentPhotoWidth(), 0);
  const band = ROOFTOP.cornice.out - a.depth.bay;
  for (const [wall, front] of a.bays) {
    bay(wall, front, a.bayV[0], a.bayV[1], a.depth.bay);
    for (const [v0, v1] of a.bands) bay(wall, front, v0, v1, a.depth.bay, band);
  }
  for (const [u0, u1, v0, v1] of a.ledges) box(u0, u1, v0, v1, a.depth.ledge);
  for (const [u0, u1, v0, v1] of a.posts) box(u0, u1, v0, v1, a.depth.post);
  box(a.entry[0], a.entry[1], a.entry[2], a.entry[3], a.depth.entry);
  return geometry();
}

/** The apartment's walls and roof as one box; each wall shows the photo centred at its own aspect (u past 0..1 is plain stucco). */
export function apartmentWalls() {
  const { x0, x1, z0, z1, roof, base } = ROOFTOP;
  const g = new BoxGeometry(x1 - x0, roof - base, z1 - z0);
  const uv = g.attributes.uv;
  // faces in order +x, -x, +y, -y, +z, -z; four corners each
  const across = [z1 - z0, z1 - z0, 0, 0, x1 - x0, x1 - x0];
  for (let i = 0; i < uv.count; i++) {
    const w = across[Math.floor(i / 4)];
    if (w) uv.setX(i, 0.5 + ((uv.getX(i) - 0.5) * w) / apartmentPhotoWidth());
  }
  return g;
}

/** 06:00 Russian Hill rooftop. Cuso stands on its north edge, over the bay. */
export function Rooftop() {
  const { apartment } = useLandmarkTextures();
  const { x0, x1, z0, z1, roof: top, base, wall: t, parapet, cornice: c, bulkhead: b } = ROOFTOP;
  const roof = useRoof(x1 - x0, z1 - z0);
  const trim = useMat("#ece3d1", 0.7);
  const stucco = useMat("#d9cdb9", 0.92);
  const metal = useMat("#6c6a67", 0.45, 0.5);
  const materials = useMemo(() => {
    // At night some windows light up: the facade's own window pixels, brightened, are the glow map.
    const W = 384;
    const H = 576;
    const glow = drawn(W, H, (ctx) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, H);
      ctx.filter = "brightness(1.5)";
      const img = apartment.image as HTMLImageElement;
      const sx = img.width / W;
      const sy = img.height / H;
      APARTMENT.windows.forEach(([u0, u1, v0, v1], k) => {
        if (k % 3 === 1) return; // dark rooms
        const [x, y, w, h] = [u0 * W, (1 - v1) * H, (u1 - u0) * W, (v1 - v0) * H];
        ctx.drawImage(img, x * sx, y * sy, w * sx, h * sy, x, y, w, h);
      });
    });
    const wall = new MeshStandardMaterial({ map: apartment, roughness: 0.8, emissive: "#ffd6a0", emissiveMap: glow, emissiveIntensity: 0 });
    // Beside the photo, and on the relief's sides, tops and undersides: one flat colour (the photo there, blurred).
    wall.customProgramCacheKey = () => "apartment";
    wall.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <map_fragment>",
        `vec2 fUv = vMapUv;
        float fFlat = step(1.5, fUv.x);
        fUv.x -= ${FLAT.toFixed(1)} * fFlat;
        if (fUv.x < 0.0 || fUv.x > 1.0) { fUv = vec2(${APARTMENT.plain.join(", ")}); fFlat = 1.0; }
        diffuseColor *= texture2D(map, fUv, fFlat * 3.0);`,
      );
    };
    return [wall, wall, roof, roof, wall, wall];
  }, [apartment, roof]);
  useNightGlow(materials[0] as MeshStandardMaterial, 1.2, 0);
  const walls = useMemo(() => apartmentWalls(), []);
  // Bays, floor cornices, hoods, sills and the entry on all four walls, lined up with the photo.
  const relief = useMemo(() => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const o = new Object3D();
    const sides: [number, number, number][] = [[cx, z1, 0], [x1, cz, Math.PI / 2], [cx, z0, Math.PI], [x0, cz, -Math.PI / 2]];
    const g = mergeGeometries(
      sides.map(([x, z, ry]) => {
        o.position.set(x, base, z);
        o.rotation.set(0, ry, 0);
        o.scale.set(apartmentPhotoWidth(), top - base, 1);
        o.updateMatrix();
        return apartmentRelief().applyMatrix4(o.matrix);
      }),
    );
    g.setAttribute("uv", g.attributes.aUv);
    return g;
  }, [x0, x1, z0, z1, base, top]);
  const parts = useMemo(() => {
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const w = x1 - x0;
    const d = z1 - z0;
    const ring = (y: number, h: number, out: number, inn = 0.02) => [
      box([cx, y, z0 - out / 2 + inn / 2], [w + out * 2, h, out + inn]),
      box([cx, y, z1 + out / 2 - inn / 2], [w + out * 2, h, out + inn]),
      box([x0 - out / 2 + inn / 2, y, cz], [out + inn, h, d]),
      box([x1 + out / 2 - inn / 2, y, cz], [out + inn, h, d]),
    ];
    const modillions = [];
    for (let x = x0 + 0.2; x < x1 - 0.1; x += 0.35) modillions.push(box([x, 7.71, z0 - 0.09], [0.07, 0.1, 0.18]), box([x, 7.71, z1 + 0.09], [0.07, 0.1, 0.18]));
    for (let z = z0 + 0.2; z < z1 - 0.1; z += 0.35) modillions.push(box([x0 - 0.09, 7.71, z], [0.18, 0.1, 0.07]), box([x1 + 0.09, 7.71, z], [0.18, 0.1, 0.07]));
    return {
      // cornice: crown, bed moulding and modillions; coping on the parapet
      trim: merged([
        ...ring(c.top - 0.09, 0.18, c.out),
        ...ring(c.bottom + 0.05, 0.1, 0.07),
        ...modillions,
        box([cx, top + parapet - 0.025, z0 + t / 2 - 0.02], [w + 0.04, 0.05, t + 0.06]),
        box([cx, top + parapet - 0.025, z1 - t / 2 + 0.02], [w + 0.04, 0.05, t + 0.06]),
        box([x0 + t / 2 - 0.02, top + parapet - 0.025, cz], [t + 0.06, 0.05, d]),
        box([x1 - t / 2 + 0.02, top + parapet - 0.025, cz], [t + 0.06, 0.05, d]),
        box([b.x, b.top - 0.035, b.z], [b.w, 0.07, b.d]),
      ]),
      // parapet, stair bulkhead and skylight curb
      stucco: merged([
        box([cx, top + 0.15, z0 + t / 2], [w, 0.3, t]),
        box([cx, top + 0.15, z1 - t / 2], [w, 0.3, t]),
        box([x0 + t / 2, top + 0.15, cz], [t, 0.3, d - t * 2]),
        box([x1 - t / 2, top + 0.15, cz], [t, 0.3, d - t * 2]),
        box([b.x, top + 0.55, b.z], [b.w - 0.12, 1.1, b.d - 0.12]),
      ]),
      // bulkhead door and a vent stack (both out of the 06:00 shot)
      metal: merged([
        box([b.x + b.w / 2 - 0.05, top + 0.44, b.z], [0.03, 0.86, 0.5]),
        cyl([-15.2, top + 0.22, -7.85], 0.05, 0.05, 0.44, 10),
        cyl([-15.2, top + 0.46, -7.85], 0.08, 0.08, 0.06, 10),
      ]),
    };
  }, [x0, x1, z0, z1, top, t, parapet, c, b]);
  return (
    <group position-y={heightAt(-14, -10.4)}>
      <mesh position={[(x0 + x1) / 2, (base + top) / 2, (z0 + z1) / 2]} geometry={walls} material={materials} castShadow receiveShadow />
      <mesh geometry={relief} material={materials[0]} castShadow receiveShadow />
      <mesh geometry={parts.trim} material={trim} castShadow receiveShadow />
      <mesh geometry={parts.stucco} material={stucco} castShadow receiveShadow />
      <mesh geometry={parts.metal} material={metal} castShadow receiveShadow />
    </group>
  );
}

/** Sign faces in world units [width, height]; their canvases follow the same shape. */
export const SHOP_SIGN = [6.8, 0.8] as const;
export const AD_PANEL = [5.58, 2.78] as const;

/** 07:00 Hayes Valley shop. The sign shows the visitor's brand. */
export function Shopfront() {
  const sign = useSign(useBrand(), { bg: "#efe6d0", fg: "#1f3b2f", panel: SHOP_SIGN });
  // the gooseneck lamps light the sign at night
  const signMat = useMemo(() => new MeshStandardMaterial({ map: sign, roughness: 0.7, emissive: "#fff1d8", emissiveMap: sign, emissiveIntensity: 0 }), [sign]);
  useNightGlow(signMat, 0.55, 0);
  const lampGlow = useGlow("#ffd9a0", 2.4, 0);
  const trim = useMat("#efe7d6", 0.75);
  const green = useMat("#20392e", 0.6);
  const iron = useMat("#2e2e33", 0.55, 0.35);
  const { shopfront, siding } = useLandmarkTextures();
  const materials = useMemo(() => {
    // At night the cafe inside and the upstairs rooms light up: the facade's own
    // window pixels are the glow map (regions in a 768 x 512 copy of the texture).
    const glow = drawn(768, 512, (ctx) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 768, 512);
      ctx.filter = "brightness(1.6)";
      for (const [x, y, w, h] of [[68, 252, 492, 181], [618, 296, 70, 146], [170, 22, 100, 136], [502, 22, 100, 136]]) {
        ctx.drawImage(shopfront.image as CanvasImageSource, x * 2, y * 2, w * 2, h * 2, x, y, w, h);
      }
    });
    const front = new MeshStandardMaterial({ map: shopfront, roughness: 0.7, emissive: "#ffd6a0", emissiveMap: glow, emissiveIntensity: 0.05 });
    // lap siding like the upper floor of the front, in world-sized boards
    const lap = (w: number) => {
      const map = siding.clone();
      map.repeat.set(w / 2.4, 5.4 / 2.4);
      return new MeshStandardMaterial({ map, color: "#ece2cc", roughness: 0.9 });
    };
    const side = lap(4.6);
    const back = lap(8);
    return { front, box: [side, side, side, side, front, back] };
  }, [shopfront, siding]);
  useNightGlow(materials.front, 1.3, 0.05);
  const parts = useMemo(() => {
    // Building x -15..-7, z 7..11.6 (front), y 0..5.4. Positions on the front
    // follow the texture: sign band y 2.9..3.4, upper windows at x -12.7 and -9.25.
    const front = 11.6;
    const brackets = [-14.83, -13.54, -11.98, -10.02, -8.46, -7.17];
    const goose = [-13.6, -11, -8.4];
    return {
      trim: merged([
        // cornice: frieze, brackets and crown
        box([-11, 5.52, 9.3], [8.04, 0.24, 4.64]),
        ...brackets.map((x) => box([x, 5.5, front + 0.1], [0.13, 0.28, 0.2])),
        box([-11, 5.72, 9.42], [8.44, 0.16, 5.04]),
        box([-11, 5.62, front + 0.12], [8.2, 0.05, 0.12]),
      ]),
      // sign frame, its cap moulding, and the window sill
      green: merged([
        box([-11, 3.17, front + 0.04], [7.1, 0.98, 0.08]),
        box([-11, 3.69, front + 0.08], [7.24, 0.06, 0.16]),
        box([-11.73, 0.8, front + 0.04], [5.3, 0.05, 0.08]),
      ]),
      iron: merged([
        // gooseneck lamps over the sign
        ...goose.flatMap((x) => [
          box([x, 3.8, front + 0.1], [0.03, 0.18, 0.03]),
          box([x, 3.9, front + 0.24], [0.03, 0.03, 0.3], [-0.35, 0, 0]),
          cyl([x, 3.92, front + 0.4], 0.02, 0.08, 0.08, 10, [0.5, 0, 0]),
        ]),
        // a cafe table and two chairs by the window
        cyl([-14.15, 0.62, 12.08], 0.21, 0.21, 0.03, 16),
        cyl([-14.15, 0.31, 12.08], 0.02, 0.02, 0.6, 6),
        cyl([-14.15, 0.01, 12.08], 0.11, 0.11, 0.02, 12),
        ...[-0.42, 0.42].flatMap((dx) => {
          const x = -14.15 + dx;
          const back = x + Math.sign(dx) * 0.11;
          return [
            box([x, 0.38, 12.08], [0.22, 0.03, 0.22]),
            box([back, 0.56, 12.08], [0.02, 0.32, 0.2]),
            ...[-0.09, 0.09].flatMap((ox) => [-0.09, 0.09].map((oz) => box([x + ox, 0.19, 12.08 + oz], [0.02, 0.38, 0.02]))),
          ];
        }),
      ]),
      shades: merged(goose.map((x) => cyl([x, 3.885, front + 0.383], 0.066, 0.066, 0.012, 10, [0.5, 0, 0]))),
    };
  }, []);
  return (
    <group position-y={heightAt(-11, 9.3)}>
      <mesh position={[-11, 2.7, 9.3]} material={materials.box} castShadow receiveShadow>
        <boxGeometry args={[8, 5.4, 4.6]} />
      </mesh>
      <mesh geometry={parts.trim} material={trim} castShadow receiveShadow />
      <mesh geometry={parts.green} material={green} castShadow receiveShadow />
      <mesh geometry={parts.iron} material={iron} castShadow receiveShadow />
      <mesh geometry={parts.shades} material={lampGlow} />
      {/* the visitor's brand on the sign band */}
      <mesh position={[-11, 3.17, 11.685]} material={signMat}>
        <planeGeometry args={SHOP_SIGN} />
      </mesh>
      <StreetLamp p={[-6.6, 0, 12.1]} />
    </group>
  );
}

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
      <group position={[-3.9, 0, 27.9]}>
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

/**
 * Transamerica Pyramid: four white precast faces with a constant taper up to
 * Cuso's platform (y 28), the two plumb wings low on the east and west faces,
 * and the hollow aluminium spire beside him. `pyramidHalf(y)` is the
 * half-width of the body at height y. The base is as wide as the block allows:
 * its corners stop on the sidewalks of the streets at z -6 and -16.
 */
export const PYRAMID = { base: 3.4, top: 0.56, height: 28 };
export const pyramidHalf = (y: number) => PYRAMID.base + ((PYRAMID.top - PYRAMID.base) * y) / PYRAMID.height;
/**
 * The spire rises from the north face just behind the platform's edge: from
 * the 15:00 camera (yaw 285) it stands to Cuso's left, never behind his body,
 * and he can turn on the platform without touching it.
 */
export const SPIRE = { x: 0, z: -0.93, half: 0.12, base: 23, top: 36.5 };
/** Cuso's flag on the spire: a 1.2 x 0.8 cloth at height y (over his head, even when he hops), swinging +-swing radians. */
export const FLAG = { y: 31, w: 1.2, h: 0.8, swing: 0.25 };
/** Wings: [side (+1 east, -1 west), bottom, top, width]. Their outer walls are plumb. */
export const WINGS: [number, number, number, number][] = [
  [1, 13, 21.5, 1.1],
  [-1, 13, 21, 0.9],
];

/** White precast with narrow vertical window slits: one tile is 8 slits by 4 floors. */
function precastSlits() {
  const t = drawn(256, 256, (ctx) => {
    ctx.fillStyle = "#eeece6";
    ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(${i % 2 ? "255,255,255" : "120,115,105"}, 0.06)`;
      ctx.fillRect((i * 73) % 256, (i * 151) % 256, 2, 2);
    }
    for (let f = 0; f < 4; f++) {
      ctx.fillStyle = "rgba(90, 85, 75, 0.12)";
      ctx.fillRect(0, f * 64 + 60, 256, 3); // floor line
      for (let c = 0; c < 8; c++) {
        ctx.fillStyle = "#313b47";
        ctx.fillRect(c * 32 + 12, f * 64 + 12, 8, 42);
      }
    }
  });
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** 15:00 Transamerica Pyramid. Cuso plants a flag on the spire. */
export function Pyramid() {
  const flag = useRef<Group>(null);
  // Same world-scale facade shader as the towers, so the slits light up at night.
  const skin = useMemo(() => {
    const m = towerMaterial(precastSlits(), { w: 1.7, h: 2.2 }, false);
    m.color.setScalar(1.2);
    return m;
  }, []);
  const aluminium = useMat("#e4e5e2", 0.45, 0.25);
  const beacon = useGlow("#fff4dc", 3, 0);
  const parts = useMemo(() => {
    const { height } = PYRAMID;
    // a frustum of the pyramid between two heights (r grows it a little)
    const slice = (y0: number, y1: number, r = 0) => {
      const g = new CylinderGeometry((pyramidHalf(y1) + r) * Math.SQRT2, (pyramidHalf(y0) + r) * Math.SQRT2, y1 - y0, 4, 1);
      g.rotateY(Math.PI / 4);
      g.translate(0, (y0 + y1) / 2, 0);
      return faceted(g);
    };
    const band = height - 0.45;
    const wings = WINGS.map(([side, y0, y1, w]) => {
      const outer = pyramidHalf(y0);
      const inner = 0.4;
      return box([side * ((outer + inner) / 2), (y0 + y1) / 2, 0], [outer - inner, y1 - y0, w]);
    });
    const spire = new ConeGeometry(SPIRE.half * Math.SQRT2, SPIRE.top - SPIRE.base, 4, 1);
    spire.rotateY(Math.PI / 4);
    return {
      body: merged([slice(0, band), ...wings]),
      // aluminium crown: its flat top is the platform Cuso stands on (y 28); the spire rises just past its north edge
      aluminium: merged([slice(band, height, 0.012), placed(faceted(spire), [SPIRE.x, (SPIRE.base + SPIRE.top) / 2, SPIRE.z])]),
    };
  }, []);
  useFrame(({ clock }) => {
    if (flag.current) flag.current.rotation.y = Math.sin(clock.elapsedTime * 2.4) * FLAG.swing;
  });
  return (
    <group position={[6.5, heightAt(6.5, -11), -11]}>
      <mesh geometry={parts.body} material={skin} castShadow receiveShadow />
      <mesh geometry={parts.aluminium} material={aluminium} castShadow receiveShadow />
      <mesh position={[SPIRE.x, SPIRE.top + 0.05, SPIRE.z]} material={beacon}>
        <sphereGeometry args={[0.06, 8, 6]} />
      </mesh>
      <group ref={flag} position={[SPIRE.x, FLAG.y, SPIRE.z]}>
        <mesh position={[FLAG.w / 2, 0, 0]}>
          <planeGeometry args={[FLAG.w, FLAG.h]} />
          <meshStandardMaterial color="#ffffff" side={DoubleSide} roughness={0.8} />
        </mesh>
      </group>
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

function StreetLamp({ p }: { p: V3 }) {
  const bulb = useGlow("#ffd58f", 3.5, 0);
  const iron = useMat("#2e2e33", 0.55, 0.35);
  const parts = useMemo(
    () => ({
      // base, tapered post, collar, lantern cap and finial
      iron: merged([
        cyl([0, 0.16, 0], 0.1, 0.13, 0.32, 12),
        cyl([0, 0.36, 0], 0.07, 0.1, 0.08, 12),
        cyl([0, 1.62, 0], 0.035, 0.055, 2.5, 10),
        cyl([0, 2.9, 0], 0.075, 0.045, 0.08, 12),
        cyl([0, 3.27, 0], 0.03, 0.15, 0.12, 12),
        cyl([0, 3.37, 0], 0.012, 0.02, 0.1, 6),
      ]),
      globe: placed(new CylinderGeometry(0.13, 0.08, 0.3, 12), [0, 3.08, 0]),
    }),
    [],
  );
  return (
    <group position={p}>
      <mesh geometry={parts.iron} material={iron} castShadow />
      <mesh geometry={parts.globe} material={bulb} />
    </group>
  );
}
