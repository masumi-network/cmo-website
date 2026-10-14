// Photo-real spike: plain-material twins of shader-patched meshes, for the
// path tracer (raytrace-lab.tsx). The tracer reads colours, UV textures and
// vertex colours only, so the per-pixel work in materials.ts and bay.tsx is
// moved to the vertices: palette colours become vertex colours and world-mapped
// textures get UVs projected the same way the shaders do it. Twins are in world
// space (instances expanded), on a layer only the tracer sees.

import { Box3, BufferGeometry, Color, Float32BufferAttribute, Group, Matrix3, Matrix4, Mesh, MeshStandardMaterial, type LineBasicMaterial, type LineSegments, type Material, type Texture, Vector2, Vector3, type InstancedBufferAttribute, type InstancedMesh, type Object3D, type PointLight, type SpotLight } from "three";
import { SLOT, SLOTS } from "./house-models";
import { FACADE_CELLS, type FacadeKind, facadeMaps } from "./facade-maps";
import { CAFE_MAT } from "./shop";
import { ALUMINIUM } from "./pyramid";
import { PART } from "./towers";
import { traceInfo, type TraceInfo } from "./trace-info";

/** A layer no WebGL camera renders: the tracer ignores layers, so twins show only there. */
export const TRACE_LAYER = 31;

type Tri = { p: Vector3[]; n: Vector3[]; i: number[]; face: Vector3; k: number };
type Out = { uv?: [number, number][]; color: Color | Color[] };
type Bucket = { material: MeshStandardMaterial; pos: number[]; nrm: number[]; uv: number[]; col: number[] };

const tri: Tri = { p: [new Vector3(), new Vector3(), new Vector3()], n: [new Vector3(), new Vector3(), new Vector3()], i: [0, 0, 0], face: new Vector3(), k: 0 };
const m4 = new Matrix4();
const n3 = new Matrix3();
const im = new Matrix4();

/** Calls `fn` for every triangle of the mesh in world space, once per instance (`k`). */
function eachTriangle(mesh: Mesh, fn: (t: Tri) => void) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const index = g.index;
  const count = index ? index.count : pos.count;
  const instances = (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : 1;
  for (let k = 0; k < instances; k++) {
    m4.copy(mesh.matrixWorld);
    if ((mesh as InstancedMesh).isInstancedMesh) m4.multiply(((mesh as InstancedMesh).getMatrixAt(k, im), im));
    n3.getNormalMatrix(m4);
    tri.k = k;
    for (let f = 0; f + 2 < count; f += 3) {
      for (let v = 0; v < 3; v++) {
        const i = index ? index.getX(f + v) : f + v;
        tri.i[v] = i;
        tri.p[v].fromBufferAttribute(pos, i).applyMatrix4(m4);
        if (nrm) tri.n[v].fromBufferAttribute(nrm, i).applyMatrix3(n3).normalize();
      }
      tri.face.subVectors(tri.p[1], tri.p[0]).cross(new Vector3().subVectors(tri.p[2], tri.p[0])).normalize();
      if (!nrm) for (const n of tri.n) n.copy(tri.face);
      fn(tri);
    }
  }
}

const fract = (x: number) => x - Math.floor(x);
/** The shaders' fHash (materials.ts). The GPU runs it in 32-bit floats, so a twin picks a similar share, not the same windows. */
const glslHash = (x: number, y: number) => fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453);
/** Downtown parts with windows (towers.tsx PART) and their tile in facade-maps.ts. */
const FACADE: Partial<Record<number, FacadeKind>> = { [PART.glass]: "curtain", [PART.storefront]: "storefront", [PART.sash]: "sash", [PART.steel]: "steel" };

/** The painted shader's surfaces (shop.tsx CAFE_MAT) as roughness and metalness. */
const SURFACES: Partial<Record<number, Partial<MeshStandardMaterial>>> = {
  [CAFE_MAT.wood]: { roughness: 0.38 },
  [CAFE_MAT.floor]: { roughness: 0.35 },
  [CAFE_MAT.tile]: { roughness: 0.15 },
  [CAFE_MAT.tin]: { roughness: 0.4, metalness: 0.25 },
  [CAFE_MAT.marble]: { roughness: 0.18 },
  [CAFE_MAT.glaze]: { roughness: 0.16 },
  [CAFE_MAT.chrome]: { roughness: 0.12, metalness: 1 },
  [CAFE_MAT.leather]: { roughness: 0.42 },
  [CAFE_MAT.plaster]: { roughness: 0.92 },
  [CAFE_MAT.metal]: { roughness: 0.35, metalness: 0.6 },
  [CAFE_MAT.boards]: { roughness: 0.5 },
  [CAFE_MAT.leaf]: { roughness: 0.45 },
  [CAFE_MAT.art]: { roughness: 0.85 },
};

const t2 = new Vector2();
/** Distance along a wall, horizontally, whichever way the wall faces (as the shaders' `fAlong`). */
const along = (p: Vector3, face: Vector3) => {
  t2.set(-face.z, face.x + 1e-5).normalize();
  return p.x * t2.x + p.z * t2.y;
};

/** Twins for one patched mesh: a mesh per bucket (texture or surface kind). `baked`: colour textures baked from shaders (bake-ground.ts). */
function twin(mesh: Mesh, info: TraceInfo, baked: Map<Material, Texture>, follow: (() => void)[]): Mesh[] {
  if (info.kind === "ground") {
    // same geometry and uv as the original, its shader's colour baked into one texture
    const map = baked.get(mesh.material as Material);
    if (!map) return [];
    const m = new Mesh(mesh.geometry, new MeshStandardMaterial({ map, roughness: 0.9 }));
    m.matrixAutoUpdate = false;
    m.matrix.copy(mesh.matrixWorld);
    m.matrixWorld.copy(mesh.matrixWorld);
    m.layers.set(TRACE_LAYER);
    return [m];
  }
  const buckets = new Map<string, Bucket>();
  const put = (key: string, make: () => MeshStandardMaterial, t: Tri, out: Out) => {
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { material: make(), pos: [], nrm: [], uv: [], col: [] }));
    for (let v = 0; v < 3; v++) {
      b.pos.push(t.p[v].x, t.p[v].y, t.p[v].z);
      b.nrm.push(t.n[v].x, t.n[v].y, t.n[v].z);
      const uv = out.uv?.[v] ?? [0, 0];
      b.uv.push(uv[0], uv[1]);
      const c = Array.isArray(out.color) ? out.color[v] : out.color;
      b.col.push(c.r, c.g, c.b);
    }
  };
  const base = mesh.material as MeshStandardMaterial;
  const plain = (extra: Partial<MeshStandardMaterial> = {}) => () =>
    Object.assign(new MeshStandardMaterial({ vertexColors: true, roughness: base.roughness, metalness: base.metalness, side: base.side }), extra);
  // a glow that follows the hour: set now, and again on every refresh (buildTwins)
  const glowing = (make: () => MeshStandardMaterial, level: () => number) => () => {
    const m = make();
    const set = () => void (m.emissiveIntensity = level());
    set();
    follow.push(set);
    return m;
  };

  if (info.kind === "house") {
    const n = SLOTS.length;
    const slot = mesh.geometry.attributes.aSlot;
    const pal = mesh.geometry.attributes.aPalette;
    const win = mesh.geometry.attributes.aWin;
    const at = mesh.geometry.attributes.aOrigin;
    const placed = new Vector3();
    // the house's seed point: its instance's position, or the front-wall origin houses.tsx merged in (else none)
    const origin = (t: Tri) => {
      if ((mesh as InstancedMesh).isInstancedMesh) {
        (mesh as InstancedMesh).getMatrixAt(t.k, im);
        placed.setFromMatrixPosition(im);
        return glslHash(placed.x, placed.z);
      }
      return at ? glslHash(at.getX(t.i[0]), at.getY(t.i[0])) : glslHash(0, 0);
    };
    const c = new Color();
    eachTriangle(mesh, (t) => {
      const s = Math.round(slot?.getX(t.i[0]) ?? 0);
      // per vertex where houses.tsx merged a district, per instance on <Instances> (the shop's shell)
      const o = (Math.round(pal?.getX((pal as InstancedBufferAttribute).isInstancedBufferAttribute ? t.k : t.i[0]) ?? 0) * n + s) * 3;
      c.setRGB(info.palette[o], info.palette[o + 1], info.palette[o + 2]);
      const upright = Math.abs(t.face.y) < 0.5;
      if (s === SLOT.body && upright) {
        put("siding", plain({ map: info.siding }), t, { color: c.clone().multiplyScalar(1.12), uv: t.p.map((p) => [along(p, t.face) / 1.6, p.y / 1.6]) });
      } else if (s === SLOT.roof) {
        const k = Math.max(0.3, Math.hypot(t.face.x, t.face.z));
        put("roof", plain({ map: info.shingles }), t, { color: new Color(1, 1, 1).lerp(c, 0.6).multiplyScalar(1.1), uv: t.p.map((p) => [along(p, t.face) / 1.3, p.y / k / 1.3]) });
      } else if (s === SLOT.glass) {
        // a dark room behind a glossy pane: the tracer reflects the real street. At night about
        // half the windows light up, each as a whole (its id and the house), warm, as the shader does
        const seed = origin(t);
        const lit = glslHash(win?.getX(t.i[0]) ?? 0, seed * 31) >= 0.5;
        if (lit) put("glass-lit", glowing(plain({ roughness: 0.06, metalness: 0, emissive: new Color(1, 0.7, 0.38) }), () => 1.1 * info.night.value), t, { color: c.clone().multiplyScalar(0.9) });
        else put("glass", plain({ roughness: 0.06, metalness: 0 }), t, { color: c.clone().multiplyScalar(0.9) });
      } else {
        put("paint", plain(), t, { color: c });
      }
    });
  } else if (info.kind === "world") {
    const top = info.top ? new Color(info.top) : null;
    const white = new Color(1, 1, 1);
    eachTriangle(mesh, (t) => {
      const wall = Math.abs(t.face.y) < 0.5;
      const uv = t.p.map((p): [number, number] => (wall ? [(Math.abs(t.face.x) > 0.5 ? p.z : p.x) / info.scale, p.y / info.scale] : [p.x / info.scale, p.z / info.scale]));
      if (!wall && top) put("top", plain(), t, { color: top });
      else put("map", plain({ map: info.map }), t, { color: white, uv });
    });
  } else if (info.kind === "concrete") {
    // the texture averages about 0.26: scale it back to the concrete's colour
    const c = info.color.clone().multiplyScalar(1 / 0.26);
    eachTriangle(mesh, (t) => {
      const up = Math.abs(t.face.y) < 0.5;
      put("map", plain({ map: info.map }), t, { color: c, uv: t.p.map((p) => (up ? [along(p, t.face) / 2.4, p.y / 2.4] : [p.x / 2.4, p.z / 2.4])) });
    });
  } else if (info.kind === "painted") {
    // the shader's grain, tiles and baked room light stay out; the paint, the gloss and the lamps come in
    const g = mesh.geometry.attributes;
    const atlas = info.atlas.value;
    eachTriangle(mesh, (t) => {
      const mat = Math.round(g.aMat?.getX(t.i[0]) ?? 0);
      const glow = g.aGlow?.getX(t.i[0]) ?? 0;
      const color = t.i.map((i) => new Color().fromBufferAttribute(g.color, i));
      const uv = t.i.map((i): [number, number] => (g.uv ? [g.uv.getX(i), g.uv.getY(i)] : [0, 0]));
      if (glow > 1.5) {
        // lamp shades and bulbs: the shader's emissive times glow times paint
        const e = base.emissive.clone().multiply(color[0]);
        put(`glow:${glow}:${e.getHexString()}`, glowing(plain({ emissive: e }), () => base.emissiveIntensity * glow), t, { color });
        return;
      }
      const surface = SURFACES[mat] ?? {};
      const map = (mat === CAFE_MAT.art || mat === CAFE_MAT.leaf) && atlas ? { map: atlas, alphaTest: mat === CAFE_MAT.leaf ? 0.5 : 0 } : {};
      put(`mat:${mat}`, plain({ ...surface, ...map, emissiveIntensity: 0 }), t, { color, uv });
    });
  } else if (info.kind === "downtown") {
    // as downtownMaterial: walls by part, their windows from facade-maps.ts on the wall grid (aUv)
    const g = mesh.geometry.attributes;
    const tar = new Color(0.2, 0.195, 0.185);
    eachTriangle(mesh, (t) => {
      const part = Math.round(g.aInfo.getX(t.i[0]));
      const seed = g.aInfo.getY(t.i[0]);
      const tint = t.i.map((i) => new Color().fromBufferAttribute(g.color, i));
      const kind = FACADE[part];
      if (Math.abs(t.face.y) > 0.97 && part <= PART.storefront) {
        put("tar", plain({ roughness: 0.85, metalness: 0 }), t, { color: tint.map((c) => c.lerp(tar, 0.7)) });
      } else if (kind) {
        // a whole-cell offset per tower and face, so neighbours do not light the same windows
        const face = Math.floor(t.face.x + 0.5) * 3 + Math.floor(t.face.z + 0.5) * 7;
        const [ox, oy] = [Math.floor(fract(seed * 113 + face * 0.17) * FACADE_CELLS), Math.floor(fract(seed * 31 + face * 0.29) * FACADE_CELLS)];
        const maps = facadeMaps(kind);
        const make = () => new MeshStandardMaterial({ vertexColors: true, map: maps.map, roughnessMap: maps.orm, metalnessMap: maps.orm, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveMap: maps.lit });
        put(`facade:${kind}`, glowing(make, () => 1.4 * info.night.value), t, { color: tint, uv: t.i.map((i): [number, number] => [(g.aUv.getX(i) + ox) / FACADE_CELLS, (g.aUv.getY(i) + oy) / FACADE_CELLS]) });
      } else {
        const [roughness, metalness, k] = part === PART.metal ? [0.4, 0.6, 1] : part === ALUMINIUM ? [0.5, 0.15, 1] : part === PART.roof ? [0.85, 0, 0.4] : [0.85, 0, 1];
        put(`part:${part}`, plain({ roughness, metalness }), t, { color: tint.map((c) => c.multiplyScalar(k)) });
      }
    });
  } else if (info.kind === "tower") {
    // as towerMaterial: the facade tile on walls by (x or z, height) over the tile size, tops darker
    eachTriangle(mesh, (t) => {
      if (Math.abs(t.face.y) >= 0.5) return put("top", plain(), t, { color: new Color(0.62, 0.62, 0.62) });
      put("facade", plain({ map: info.facade }), t, {
        color: new Color(1, 1, 1).multiplyScalar(info.glassy ? 0.78 : 1),
        uv: t.p.map((p): [number, number] => [(Math.abs(t.face.x) > 0.5 ? p.z : p.x) / info.tile.w, p.y / info.tile.h]),
      });
    });
  } else if (info.kind === "water") {
    eachTriangle(mesh, (t) => {
      put("water", plain({ roughness: 0.05, metalness: 0, normalMap: info.ripples, normalScale: new Vector2(0.1, 0.1) }), t, {
        color: info.deep,
        uv: t.p.map((p) => [p.x * 0.043, p.z * 0.043]),
      });
    });
  }

  return [...buckets.values()].map((b) => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new Float32BufferAttribute(b.nrm, 3));
    g.setAttribute("uv", new Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new Float32BufferAttribute(b.col, 3));
    const m = new Mesh(g, b.material);
    m.layers.set(TRACE_LAYER);
    m.matrixAutoUpdate = false;
    return m;
  });
}

/**
 * A multi-material mesh as one mesh per visible group (the tracer takes one
 * material per mesh, and draws an invisible one: the cliffs' hidden cap became
 * a mirror over the streets). Placed where the original is.
 */
function visibleGroups(mesh: Mesh): Mesh[] {
  const g = mesh.geometry;
  const materials = mesh.material as Material[];
  return g.groups
    .filter((grp) => materials[grp.materialIndex ?? 0]?.visible)
    .map((grp) => {
      const part = new BufferGeometry();
      for (const [name, attr] of Object.entries(g.attributes)) part.setAttribute(name, attr);
      const ids = g.index ? Array.from(g.index.array.slice(grp.start, grp.start + grp.count)) : Array.from({ length: grp.count }, (_, i) => grp.start + i);
      part.setIndex(ids);
      const m = new Mesh(part, materials[grp.materialIndex ?? 0]);
      m.matrixAutoUpdate = false;
      m.matrix.copy(mesh.matrixWorld);
      m.matrixWorld.copy(mesh.matrixWorld);
      m.layers.set(TRACE_LAYER);
      return m;
    });
}

/**
 * Lines (the Golden Gate suspenders, rigging): the tracer sees triangles only,
 * so each segment becomes a thin square tube in the line's colour.
 */
function lineTwin(line: LineSegments, width: number): Mesh {
  const pos = line.geometry.attributes.position;
  const out: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const d = new Vector3();
  const u = new Vector3();
  const v = new Vector3();
  const corner = (p: Vector3, i: number) => p.clone().addScaledVector(u, i === 0 || i === 3 ? -width : width).addScaledVector(v, i < 2 ? -width : width);
  for (let i = 0; i + 1 < pos.count; i += 2) {
    a.fromBufferAttribute(pos, i).applyMatrix4(line.matrixWorld);
    b.fromBufferAttribute(pos, i + 1).applyMatrix4(line.matrixWorld);
    d.subVectors(b, a).normalize();
    u.set(0, 1, 0).cross(d);
    if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
    u.normalize();
    v.crossVectors(d, u).normalize();
    for (let k = 0; k < 4; k++) {
      const [a0, a1, b0, b1] = [corner(a, k), corner(a, (k + 1) % 4), corner(b, k), corner(b, (k + 1) % 4)];
      // wound so each side faces out
      out.push(...a0.toArray(), ...a1.toArray(), ...b0.toArray(), ...a1.toArray(), ...b1.toArray(), ...b0.toArray());
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  const color = (line.material as LineBasicMaterial).color;
  const m = new Mesh(g, new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }));
  m.layers.set(TRACE_LAYER);
  m.matrixAutoUpdate = false;
  return m;
}

/**
 * Builds twins for every visible patched mesh the tracer cannot read. Returns
 * the group to add to the scene and the originals to hide while tracing.
 */
export function buildTwins(scene: Object3D, baked = new Map<Material, Texture>()) {
  const group = new Group();
  group.layers.set(TRACE_LAYER);
  const follow: (() => void)[] = [];
  const originals: Mesh[] = [];
  scene.updateMatrixWorld(true);
  scene.traverseVisible((o) => {
    if ((o as LineSegments).isLineSegments && !Array.isArray((o as LineSegments).material)) {
      group.add(lineTwin(o as LineSegments, 0.03));
      return;
    }
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    if (Array.isArray(mesh.material)) {
      if (!mesh.geometry.groups.length) return;
      originals.push(mesh);
      for (const part of visibleGroups(mesh)) {
        const info = traceInfo.get(part.material as Material);
        const twins = info ? twin(part, info, baked, follow) : [];
        for (const t of twins.length ? twins : [part]) group.add(t);
      }
      return;
    }
    const info = traceInfo.get(mesh.material);
    if (!info) return;
    const twins = twin(mesh, info, baked, follow);
    if (!twins.length) return; // nothing to stand in: the tracer reads the original
    originals.push(mesh);
    for (const t of twins) group.add(t);
  });
  /** Re-reads the glows that follow the hour (lit windows, the café's lamps): the bake builds twins at load, then scrolls to its chapter. */
  const refresh = () => follow.forEach((set) => set());
  return { group, originals, refresh };
}

const housing = new Box3();
const lamp = new Vector3();
/**
 * The small meshes a light sits inside (the pier lamp's glass globe). The
 * raster's lights cast no shadows, so they shine through; in the tracer every
 * light ray hit the globe and the lamp lit nothing. The lab sets the tracer's
 * `visibleToShadowRays` false on these. Big meshes (a deck, a merged
 * district) that merely enclose a light are not housings.
 */
export function lightHousings(scene: Object3D): Mesh[] {
  const lights: Vector3[] = [];
  scene.traverseVisible((o) => {
    if ((o as PointLight).isPointLight || (o as SpotLight).isSpotLight) lights.push(o.getWorldPosition(lamp).clone());
  });
  const out: Mesh[] = [];
  if (!lights.length) return out;
  scene.traverseVisible((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || (mesh as InstancedMesh).isInstancedMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    housing.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    const size = housing.getSize(lamp);
    if (Math.max(size.x, size.y, size.z) <= 1.5 && lights.some((l) => housing.containsPoint(l))) out.push(mesh);
  });
  return out;
}
