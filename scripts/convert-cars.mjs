// Turns the supplied Tesla models into the small car GLBs traffic.tsx drives.
//
//   node scripts/convert-cars.mjs [--only model3|modely|cybertruck|roadster] [--lite] [--debug]
//
// Reads the Sketchfab glTF zips in 3d-assets-raw/tesla/ (gitignored, the user's downloads):
//   2024_tesla_model_3__interior.zip  Model 3 Highland, with a full interior
//   2025_tesla_model_y.zip            Model Y Juniper (some parts only have generic names)
//   tesla_cybertruck_2025.zip         production Cybertruck, nose to -x
//   tesla_roadster_2020.zip           Roadster 2020, with a full interior
// All four are in metres, +Y up. Writes public/models/cars/{model3,modely,cybertruck,roadster}.glb,
// or with --lite public/models/cars/lite/*.glb (the phones' cars, simplified to ERROR_LITE).
//
// Each car comes out +Y up, nose to +Z, real length in metres, origin on the
// ground halfway between the axles. The interior, logos, plates, brakes and
// lamp parts behind their lenses are dropped and the rest is merged into a few
// named materials (paint, glass, trim, light_front, light_rear, and tyre and rim
// for the wheel), so a car is a handful of draw calls. Then
// each part gets creased normals at full detail, is simplified with
// meshoptimizer to within ERROR metres (normals included, creases and the
// seams between materials kept), and gltf-transform meshopt-compresses the
// car (drei's useGLTF decodes meshopt).
// The wheels come out as one wheel (tyre + rim) round its own axle, so the
// game can roll it; the node's extras hold { length, width, wheelbase,
// wheels: [x, y, z, radius] x4 (front left, front right, rear left, rear right) }.
//
// Tools are pinned and installed outside the project (not in package.json),
// into $CAR_TOOLS or <tmpdir>/cmo-car-tools: @gltf-transform/cli and core, meshoptimizer.
// --debug keeps every source group as its own material (named after it) and
// skips simplifying, to see which group is which.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "3d-assets-raw/tesla");
const LITE = process.argv.includes("--lite");
const OUT = join(ROOT, "public/models/cars", LITE ? "lite" : "");
const TOOLS = process.env.CAR_TOOLS ?? join(tmpdir(), "cmo-car-tools");
const WORK = join(TOOLS, "work");
const PINNED = ["@gltf-transform/cli@4.5.0", "@gltf-transform/core@4.5.1", "meshoptimizer@1.2.0"];
const args = process.argv.slice(2);
const DEBUG = args.includes("--debug");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

/**
 * How far (metres) a simplified part may stray from the source. In the city a
 * car is under 4 units long, and in the closest shot one pixel is about 4 cm
 * of car, so 4 mm is a tenth of a pixel. The glossy paint and glass show
 * every dent; the dark matte trim, tyres and rims hide them, so they may stray
 * up to half a pixel.
 */
const ERROR_FULL = { paint: 0.004, glass: 0.004, light_front: 0.004, light_rear: 0.004, trim: 0.015, tyre: 0.02, rim: 0.015 };
/**
 * Lite (phones): half a pixel in the closest shot (2 cm), and the matte parts
 * a pixel. A phone draws all 13 cars every frame, so this is most of their cost.
 */
const ERROR_LITE = { paint: 0.02, glass: 0.02, light_front: 0.02, light_rear: 0.02, trim: 0.04, tyre: 0.04, rim: 0.04 };
const ERROR = LITE ? ERROR_LITE : ERROR_FULL;
/** How much a turned normal counts against that error: keeps curved panels from going flat. */
const NORMAL_WEIGHT = 0.05;

/** Base look of each material; traffic.tsx overrides them. */
const LOOK = {
  paint: { color: [0.9, 0.9, 0.88], metal: 0.3, rough: 0.3 },
  glass: { color: [0.03, 0.04, 0.05], metal: 0.6, rough: 0.05 },
  trim: { color: [0.02, 0.02, 0.02], metal: 0, rough: 0.7 },
  tyre: { color: [0.015, 0.015, 0.015], metal: 0, rough: 0.9 },
  rim: { color: [0.4, 0.41, 0.43], metal: 0.6, rough: 0.4 },
  light_front: { color: [0.05, 0.05, 0.06], metal: 0, rough: 0.2, glow: [1, 1, 1] },
  light_rear: { color: [0.3, 0.02, 0.02], metal: 0, rough: 0.3, glow: [1, 0.1, 0.08] },
};

// ---------------------------------------------------------------------------
// The cars. `part(group, x, y, z)` names the material of one source triangle
// (group: its node and material names; centroid in source metres, nose to +z),
// or null to drop it. "tyre" and "rim" hold all four wheels; build() splits them.

const CARS = {
  model3: {
    zip: "2024_tesla_model_3__interior.zip",
    length: 4.72,
    part({ mtl }, x, y, z) {
      if (mtl === "ext_carpaint") return "paint";
      // Black_Glass is the dark frit round the windows.
      if (["EXT_Window", "Black_Glass", "Mirror"].includes(mtl)) return "glass";
      if (mtl === "Tyre") return "tyre";
      // "material" is the spokes, RIM_2 the barrel, Rim_Blur_Spoke_Black the centre cap; the disc fills the gaps.
      if (["material", "RIM_2", "Rim_Blur_Spoke_Black", "Brake_Disc"].includes(mtl)) return "rim";
      // The lenses are opaque here, so they are the lamps (what is behind them is dropped).
      if (mtl === "EXT_Headlight_Glass") return "light_front";
      if (mtl === "EXT_Taillight_Glass") return "light_rear";
      if (mtl === "Lights") return z > 0 ? "light_front" : "light_rear";
      // Window surrounds, bumpers and mirror bases, wheel arch liners.
      if (["ext_carpaint_black", "ext_plastic", "Body_Black"].includes(mtl)) return "trim";
      // int_*, INT_*, DAMAGE_GLASS, the motion-blur Rim_Blur_Spoke, badges, plate, callipers, lamp insides.
      return null;
    },
  },
  modely: {
    zip: "2025_tesla_model_y.zip",
    length: 4.79,
    part({ name, mtl }, x, y, z) {
      const front = z > 1.17; // the source's middle
      if (mtl === "Material_2125765635") return "paint";
      if (["glass_base", "glass_roof_panorama", "mirror"].includes(mtl)) return "glass";
      if (mtl === "black_reflection") return name === "Object_3" ? "glass" : "trim"; // the gloss black B pillar; the arch liners
      if (mtl.startsWith("Rubber_Rough")) return "tyre";
      if (mtl === "Material_2125767099") return name === "Object_13" ? "rim" : null; // Object_14 is the lettering on the tailgate
      if (mtl === "front_white_light") return "light_front";
      if (["back_red_Light", "red_plastic", "material"].includes(mtl)) return "light_rear";
      if (mtl === "glass_headlight222") return front ? "light_front" : "light_rear";
      if (mtl === "black_base") return name === "Object_25" ? null : "trim"; // Object_25 is the cabin tub
      if (["chrome", "black"].includes(mtl)) return "trim"; // window surrounds; the plate recesses
      // Lug nuts, hubs, brake discs (black*, Material_111, Iron_Clean_Distorted), the plate (04_-_Default).
      return null;
    },
  },
  cybertruck: {
    zip: "tesla_cybertruck_2025.zip",
    length: 5.683,
    yaw: Math.PI / 2, // its nose points to -x
    crease: 0.3, // flat steel panels
    part({ name, mtl }) {
      if (!name.includes("_001_")) return null; // _002 to _004: the floating colour swatches
      const m = mtl.replace(/^Tesla_cybe?r?_/, "");
      if (m === "body_stainless_steel") return "paint";
      if (["windshield", "sunroof", "rear_glass", "side_triangle_glass", "side_pillar", "black_glossy_plastic", "mirror"].includes(m)) return "glass";
      if (m === "tire_tread" || m === "tire_sidewall") return "tyre";
      if (m === "rims") return "rim";
      if (m === "headlight_1") return "light_front";
      if (m === "talllight_1" || m === "talllight_2") return "light_rear";
      // Cladding and arches, window seals, the closed vault cover over the bed.
      if (["black_matte_plastic", "dark_black", "rubber", "cargo_compartment_cover"].includes(m)) return "trim";
      return null; // brakes, the bed under its cover, plates, logo, radiator
    },
  },
  roadster: {
    zip: "tesla_roadster_2020.zip",
    length: 4.627,
    part({ name, mtl }, x, y, z) {
      const front = z > 0;
      if (mtl === "car_main_paint") return "paint";
      if (mtl === "Glass_mid_tint" || (mtl === "Glass_Tint_max" && y > 0.9)) return "glass";
      if (mtl === "Thread" || mtl === "Sidewall") return "tyre";
      if (mtl === "Rims" || (name.startsWith("TR.DEF-Wheel.") && mtl === "Metal_-_Black_rough")) return "rim"; // with the centre nut
      // The clear lenses are opaque here, so they are the lamps; the reflectors behind them are dropped.
      if (["headlights_main", "Glass_Amber", "indicator_left", "indicator_right"].includes(mtl) || mtl === "Glass_Clear") return front ? "light_front" : "light_rear";
      if (["Glass_rear_lights_main", "Glass_rear_lights_DHO", "ior_1"].includes(mtl)) return "light_rear";
      if (mtl === "chrome") return name.startsWith("roadster.027") ? "trim" : null; // the side strips; the rest is lettering
      if (["carbon_fibre", "Metal_-_Black_rough", "non_lustrous_metal", "grill"].includes(mtl)) return "trim";
      // interior, seats, brakes, callipers, headlights_AHO behind the lens, the logos (mirror), the plate light.
      return null;
    },
  },
};

// ---------------------------------------------------------------------------
// Sources -> { name, mtl, pos } groups, pos a triangle soup in metres.

function unzip(file) {
  const dir = join(WORK, file.replace(/\W+/g, "-"));
  if (!existsSync(dir)) execFileSync("unzip", ["-q", "-o", join(SRC, file), "-d", dir]);
  return dir;
}

function findFile(dir, ext) {
  for (const f of readdirSync(dir, { recursive: true })) {
    const p = join(dir, f);
    if (p.endsWith(ext) && !p.includes("__MACOSX") && statSync(p).isFile()) return p;
  }
  throw new Error(`no ${ext} in ${dir}`);
}

/** Every triangle primitive of a glTF, one group per node and material, in world space turned `yaw` round +y. */
async function readGltf(file, yaw = 0) {
  const { NodeIO, Logger } = createRequire(join(TOOLS, "package.json"))("@gltf-transform/core");
  const doc = await new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).read(file);
  const [c, s] = [Math.cos(yaw), Math.sin(yaw)];
  const groups = [];
  const v = [0, 0, 0];
  for (const node of doc.getRoot().listNodes()) {
    const m = node.getWorldMatrix();
    for (const prim of node.getMesh()?.listPrimitives() ?? []) {
      if (prim.getMode() !== 4) continue; // triangles only
      const at = prim.getAttribute("POSITION");
      const index = prim.getIndices();
      const pos = [];
      for (let i = 0, n = index ? index.getCount() : at.getCount(); i < n; i++) {
        at.getElement(index ? index.getScalar(i) : i, v);
        const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12];
        const z = m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14];
        pos.push(x * c + z * s, m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], z * c - x * s);
      }
      groups.push({ name: node.getName(), mtl: prim.getMaterial()?.getName() ?? "", pos });
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Groups -> materials, normalised to metres on the ground between the axles.

function build(car, groups) {
  const parts = new Map();
  for (const g of groups) {
    for (let t = 0; t < g.pos.length; t += 9) {
      const c = [0, 1, 2].map((k) => (g.pos[t + k] + g.pos[t + 3 + k] + g.pos[t + 6 + k]) / 3);
      const part = DEBUG ? `${g.name}|${g.mtl}` : car.part(g, ...c);
      if (!part) continue;
      if (!parts.has(part)) parts.set(part, []);
      const out = parts.get(part);
      for (let k = 0; k < 9; k++) out.push(g.pos[t + k]);
    }
  }
  const all = box([...parts.values()]);
  const s = car.length / (all.max[2] - all.min[2]);
  // Axles: the centres of the front and rear tyres.
  const tyres = DEBUG ? [...parts.values()] : [parts.get("tyre")];
  const midZ = (all.min[2] + all.max[2]) / 2;
  const front = box(tyres, (z) => z > midZ);
  const rear = box(tyres, (z) => z < midZ);
  const axle = (b) => (b.min[2] + b.max[2]) / 2;
  const origin = [(all.min[0] + all.max[0]) / 2, Math.min(front.min[1], rear.min[1]), (axle(front) + axle(rear)) / 2];
  for (const pos of parts.values()) for (let i = 0; i < pos.length; i++) pos[i] = (pos[i] - origin[i % 3]) * s;
  const body = box([...parts.values()]);
  const round = (n) => Math.round(n * 1000) / 1000;
  const size = { length: round(body.max[2] - body.min[2]), width: round(body.max[0] - body.min[0]), wheelbase: round((axle(front) - axle(rear)) * s) };
  if (!DEBUG) size.wheels = wheels(parts).map((w) => w.map(round));
  return { parts, size };
}

/**
 * Takes the four wheels out of the body: keeps one (front left, +x) built
 * round its own axle (centre at the origin, axle along x), and returns the
 * four centres and radii [x, y, z, r]: front left, front right, rear left, rear right.
 */
function wheels(parts) {
  const quarter = (z, x) => (z > 0 ? 0 : 2) + (x > 0 ? 0 : 1);
  const centroid = (pos, t, k) => (pos[t + k] + pos[t + 3 + k] + pos[t + 6 + k]) / 3;
  const tyres = [[], [], [], []];
  const soup = parts.get("tyre");
  for (let t = 0; t < soup.length; t += 9) tyres[quarter(centroid(soup, t, 2), centroid(soup, t, 0))].push(...soup.slice(t, t + 9));
  const centres = tyres.map((pos) => {
    const { min, max } = box([pos]);
    return [0, 1, 2].map((k) => (min[k] + max[k]) / 2).concat((max[1] - min[1]) / 2);
  });
  for (const part of ["tyre", "rim"]) {
    const pos = parts.get(part);
    const kept = [];
    for (let t = 0; t < pos.length; t += 9) {
      if (quarter(centroid(pos, t, 2), centroid(pos, t, 0)) !== 0) continue;
      for (let k = 0; k < 9; k++) kept.push(pos[t + k] - centres[0][k % 3]);
    }
    parts.set(part, kept);
  }
  // Each stands on the ground (y = radius): a source tyre may sit a few millimetres high or sunk.
  return centres.map(([x, , z, r]) => [x, r, z, r]);
}

/** Bounds of some triangle soups, only counting points whose z passes `filter`. */
function box(soups, filter = () => true) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const pos of soups) {
    for (let i = 0; i < pos.length; i += 3) {
      if (!filter(pos[i + 2])) continue;
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos[i + k]);
        max[k] = Math.max(max[k], pos[i + k]);
      }
    }
  }
  return { min, max };
}

/**
 * Smooth normals at every corner of a triangle soup, split where faces meet
 * at more than `angle` (radians): smooth panels, sharp creases.
 */
function cornerNormals(soup, angle = 0.6) {
  const count = soup.length / 9;
  const face = new Float32Array(count * 3); // area weighted
  const at = new Map();
  for (let t = 0; t < count; t++) {
    face.set(faceNormal(soup, t), t * 3);
    for (let c = 0; c < 3; c++) {
      const key = posKey(soup, t * 3 + c);
      if (!at.has(key)) at.set(key, []);
      at.get(key).push(t);
    }
  }
  const unit = (t) => {
    const l = Math.hypot(face[t * 3], face[t * 3 + 1], face[t * 3 + 2]) || 1;
    return [face[t * 3] / l, face[t * 3 + 1] / l, face[t * 3 + 2] / l];
  };
  const cos = Math.cos(angle);
  const normals = new Float32Array(soup.length);
  for (let t = 0; t < count; t++) {
    const u = unit(t);
    for (let c = 0; c < 3; c++) {
      const n = [0, 0, 0];
      for (const f of at.get(posKey(soup, t * 3 + c))) {
        const v = unit(f);
        if (u[0] * v[0] + u[1] * v[1] + u[2] * v[2] < cos) continue;
        for (let k = 0; k < 3; k++) n[k] += face[f * 3 + k];
      }
      const l = Math.hypot(...n) || 1;
      normals.set(n.map((x) => x / l), (t * 3 + c) * 3);
    }
  }
  return normals;
}

/**
 * Simplifies one part to within `error` metres (meshoptimizer), keeping its
 * creases and smooth shading: vertices are split where the normal is, so a
 * crease is a seam the simplifier keeps, and the normals count towards the
 * error. Corners on `locked` positions (where the part meets another) stay,
 * so seams between materials never open. Returns the soup and its normals.
 */
function simplify(soup, error, crease, locked) {
  const normals = cornerNormals(soup, crease);
  const ids = new Map();
  const pos = [];
  const nrm = [];
  const index = new Uint32Array(soup.length / 3);
  for (let i = 0; i < index.length; i++) {
    const key = `${posKey(soup, i)},${posKey(normals, i)}`;
    if (!ids.has(key)) {
      ids.set(key, pos.length / 3);
      pos.push(soup[i * 3], soup[i * 3 + 1], soup[i * 3 + 2]);
      nrm.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
    }
    index[i] = ids.get(key);
  }
  const p = Float32Array.from(pos);
  const n = Float32Array.from(nrm);
  const lock = Uint8Array.from({ length: p.length / 3 }, (_, v) => (locked.has(posKey(p, v)) ? 1 : 0));
  // Permissive: a crease may still collapse where that stays within the error (tyre tread, tiny bevels).
  // Prune: a loose piece smaller than the error goes (bolts, clips, slivers).
  const w = Array(3).fill(NORMAL_WEIGHT);
  const [kept] = simplifier.simplifyWithAttributes(index, p, 3, n, 3, w, lock, 0, error, ["ErrorAbsolute", "Permissive", "Prune"]);
  const low = new Float32Array(kept.length * 3);
  const lowNormals = new Float32Array(kept.length * 3);
  kept.forEach((v, i) => {
    low.set(p.subarray(v * 3, v * 3 + 3), i * 3);
    lowNormals.set(n.subarray(v * 3, v * 3 + 3), i * 3);
  });
  return [low, lowNormals];
}

/** Positions (keys) that more than one part uses: the seams between materials. */
function seams(parts) {
  const seen = new Map();
  for (const [part, soup] of parts) for (let i = 0; i < soup.length / 3; i++) {
    const key = posKey(soup, i);
    const was = seen.get(key);
    seen.set(key, was === undefined || was === part ? part : null);
  }
  return new Set([...seen].filter(([, part]) => part === null).map(([key]) => key));
}

function faceNormal(soup, t) {
  const p = (c, k) => soup[t * 9 + c * 3 + k];
  const [ux, uy, uz] = [0, 1, 2].map((k) => p(1, k) - p(0, k));
  const [vx, vy, vz] = [0, 1, 2].map((k) => p(2, k) - p(0, k));
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

const posKey = (a, i) => `${a[i * 3].toFixed(5)},${a[i * 3 + 1].toFixed(5)},${a[i * 3 + 2].toFixed(5)}`;

/** A minimal GLB: one node, one mesh, one indexed primitive per material, vertices welded. */
function writeGlb(file, name, parts, size, normalsOf = new Map()) {
  const chunks = [];
  const accessors = [];
  const bufferViews = [];
  const materials = [];
  const primitives = [];
  let offset = 0;
  const push = (array, target) => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: array.byteLength, target });
    chunks.push(Buffer.from(array.buffer, array.byteOffset, array.byteLength));
    offset += array.byteLength;
    return bufferViews.length - 1;
  };
  for (const [part, soup] of parts) {
    const normals = normalsOf.get(part);
    const ids = new Map();
    const verts = [];
    const norms = [];
    const index = new Uint32Array(soup.length / 3);
    for (let i = 0; i < index.length; i++) {
      const key = normals ? `${posKey(soup, i)},${posKey(normals, i)}` : posKey(soup, i);
      if (!ids.has(key)) {
        ids.set(key, verts.length / 3);
        verts.push(soup[i * 3], soup[i * 3 + 1], soup[i * 3 + 2]);
        if (normals) norms.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      }
      index[i] = ids.get(key);
    }
    const pos = Float32Array.from(verts);
    const { min, max } = box([pos]);
    accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: "VEC3", min, max });
    const attributes = { POSITION: accessors.length - 1 };
    if (normals) {
      accessors.push({ bufferView: push(Float32Array.from(norms), 34962), componentType: 5126, count: pos.length / 3, type: "VEC3" });
      attributes.NORMAL = accessors.length - 1;
    }
    accessors.push({ bufferView: push(index, 34963), componentType: 5125, count: index.length, type: "SCALAR" });
    const look = LOOK[part] ?? { color: [Math.random(), Math.random(), Math.random()], metal: 0, rough: 0.6 };
    materials.push({
      name: part,
      pbrMetallicRoughness: { baseColorFactor: [...look.color, 1], metallicFactor: look.metal, roughnessFactor: look.rough },
      ...(look.glow ? { emissiveFactor: look.glow } : {}),
      doubleSided: true,
    });
    primitives.push({ attributes, indices: accessors.length - 1, material: materials.length - 1 });
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: "2.0", generator: "scripts/convert-cars.mjs" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0, extras: size }],
    meshes: [{ name, primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const chunk = (data, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.writeUInt32LE(type, 4);
    return [h, data];
  };
  writeFileSync(file, Buffer.concat([header, ...chunk(j, 0x4e4f534a), ...chunk(b, 0x004e4942)]));
}

// ---------------------------------------------------------------------------

function tools() {
  const installed = (p) => {
    const file = join(TOOLS, "node_modules", p.slice(0, p.lastIndexOf("@")), "package.json");
    return existsSync(file) && JSON.parse(readFileSync(file, "utf8")).version === p.slice(p.lastIndexOf("@") + 1);
  };
  if (!PINNED.every(installed)) {
    mkdirSync(TOOLS, { recursive: true });
    if (!existsSync(join(TOOLS, "package.json"))) writeFileSync(join(TOOLS, "package.json"), "{}");
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", TOOLS, ...PINNED], { stdio: "inherit" });
  }
  const cli = join(TOOLS, "node_modules/@gltf-transform/cli/bin/cli.js");
  return (...a) => execFileSync(process.execPath, [cli, ...a], { stdio: ["ignore", "ignore", "inherit"] });
}

const gltf = tools();
const { MeshoptSimplifier: simplifier } = await import(pathToFileURL(createRequire(join(TOOLS, "package.json")).resolve("meshoptimizer")));
await simplifier.ready;
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT, { recursive: true });
for (const [name, car] of Object.entries(CARS)) {
  if (ONLY && ONLY !== name) continue;
  const { parts, size } = build(car, await readGltf(findFile(unzip(car.zip), ".gltf"), car.yaw));
  const out = join(DEBUG ? WORK : OUT, `${name}${DEBUG ? "-debug" : ""}.glb`);
  if (DEBUG) {
    const raw = join(WORK, `${name}-raw.glb`);
    writeGlb(raw, name, parts, size);
    gltf("meshopt", raw, out);
  } else {
    const low = new Map();
    const normals = new Map();
    // Lite lets seams move too (within its 2 cm): locked, the many small trim and lamp pieces stay as dense as in full.
    const locked = LITE ? new Set() : seams(parts);
    for (const [part, soup] of parts) {
      // Tyres are smooth all round: tread blocks are under a pixel even in the closest shot, and their creases would stop the simplifier.
      const [simple, n] = simplify(soup, ERROR[part], part === "tyre" ? Math.PI : car.crease, locked);
      low.set(part, simple);
      normals.set(part, n);
      console.log(`  ${part}: ${soup.length / 9} -> ${simple.length / 9} triangles`);
    }
    const shaded = join(WORK, `${name}-shaded.glb`);
    writeGlb(shaded, name, low, size, normals);
    gltf("meshopt", shaded, out, "--quantization-volume", "scene");
  }
  console.log(name, size, `${Math.round(statSync(out).size / 1024)} KB`, out);
}
