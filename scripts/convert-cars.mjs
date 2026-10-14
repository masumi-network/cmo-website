// Turns the supplied Tesla models into the small car GLBs traffic.tsx drives.
//
//   node scripts/convert-cars.mjs [--only model|cybertruck|roadster] [--debug]
//
// Reads 3d-assets-raw/ (gitignored, the user's downloads):
//   Tesla+Model+obj.zip       Blender OBJ, metres
//   Tesla_Cybertruck.obj      Maya OBJ, centimetres, no .mtl (parts picked by group below)
//   Tesla+Roadster+Files.zip  SolidWorks STEP, tessellated with occt-import-js
// Writes public/models/cars/{model,cybertruck,roadster}.glb.
//
// Each car comes out +Y up, nose to +Z, real length in metres, origin on the
// ground halfway between the axles. Logos and hidden parts are dropped and the
// rest is merged into a few named materials (paint, glass, trim, light_front,
// light_rear, and tyre and rim for the wheel), so a car is a handful of draw calls. Then
// each part gets creased normals at full detail, is simplified with
// meshoptimizer to within ERROR metres (normals included, creases and the
// seams between materials kept), and gltf-transform meshopt-compresses the
// car (drei's useGLTF decodes meshopt).
// The wheels come out as one wheel (tyre + rim) round its own axle, so the
// game can roll it; the node's extras hold { length, width, wheelbase,
// wheels: [x, y, z, radius] x4 (front left, front right, rear left, rear right) }.
//
// Tools are pinned and installed outside the project (not in package.json),
// into $CAR_TOOLS or <tmpdir>/cmo-car-tools: @gltf-transform/cli, meshoptimizer, occt-import-js.
// --debug keeps every source group as its own material (named after it) and
// skips simplifying, to see which group is which.

import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "3d-assets-raw");
const OUT = join(ROOT, "public/models/cars");
const TOOLS = process.env.CAR_TOOLS ?? join(tmpdir(), "cmo-car-tools");
const WORK = join(TOOLS, "work");
const PINNED = ["@gltf-transform/cli@4.5.0", "meshoptimizer@1.2.0", "occt-import-js@0.0.23"];
const args = process.argv.slice(2);
const DEBUG = args.includes("--debug");
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

/**
 * How far (metres) a simplified part may stray from the source. In the city a
 * car is under 4 units long, and in the closest shot one pixel is about 4 cm
 * of car, so 4 mm is a tenth of a pixel. The glossy paint and glass show
 * every dent; the dark matte trim, tyres and rims hide them, so they may stray
 * up to half a pixel (sedan tyre 3,191 to 492 triangles, 36 of them on the road).
 */
const ERROR = { paint: 0.004, glass: 0.004, light_front: 0.004, light_rear: 0.004, trim: 0.015, tyre: 0.02, rim: 0.015 };
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
// (centroid in source units), or null to drop it. "tyre" and "rim" make the wheels.

const CARS = {
  model: {
    length: 4.69,
    read: () => readObj(findFile(unzip("Tesla+Model+obj.zip"), ".obj")),
    part({ name, mtl }) {
      if (mtl === "Logo" || name.startsWith("Headligt_Glass")) return null; // the glass would hide the lamp
      if (mtl === "Car_Paint") return "paint";
      if (mtl === "Window") return "glass";
      if (mtl === "Rubber") return name.startsWith("Wheel") ? "tyre" : "trim";
      if (mtl === "Emission" || mtl === "Emission_1") return "light_front";
      if (name.startsWith("TailLight")) return "light_rear";
      if (name.startsWith("Rim")) return "rim"; // the rim and its back cover
      return "trim"; // Metal_1..3, Looking_Glass: handles, grille, lower fascia, lamp housings, mirror glass
    },
  },
  cybertruck: {
    length: 5.68,
    crease: 0.3, // flat steel panels
    read: () => readObj(join(SRC, "Tesla_Cybertruck.obj")),
    part({ mtl }, x, y, z) {
      // Wheels (one group): hub inside 60% of the radius, tyre outside. Axles at z 210 and -180 cm, y 46.
      if (mtl === "blinn3SG") return Math.hypot(y - 46, z - (z > 0 ? 210 : -180)) < 28 ? "rim" : "tyre";
      if (mtl === "phong4SG") return z > 0 ? "light_front" : "light_rear"; // the light bars and markers
      // Steel panels, black cladding, the tonneau cover, glass. blinn6SG and blinn9SG are the hidden cabin.
      return { blinn8SG: "paint", blinn7SG: "trim", blinn4SG: "trim", phong3SG: "glass" }[mtl] ?? null;
    },
  },
  roadster: {
    length: 4.3,
    tyreCrease: Math.PI, // smooth all round: hides the maker's lettering on the sidewall
    read: () => readStep(findFile(unzip("Tesla+Roadster+Files.zip"), ".STEP")),
    part({ name }) {
      const [node, k] = [name.split("#")[0], Number(name.split("#")[1])];
      if (node.includes("Rim")) return "rim";
      if (node.includes("Tire")) return "tyre";
      if (node.includes("Wheel")) return null; // brake discs, callipers, bolts: hidden behind the rims
      if (node.includes("Roof") || node.includes("Windows")) return "glass";
      if (node.includes("Front Grid")) return "trim";
      if (node.includes("Rear Bumper")) return k === 1 ? "trim" : "light_rear";
      if (node.includes("Headlights")) return k < 2 || k === 3 || k === 4 ? "light_front" : "trim";
      // Body pieces have no names: picked by eye with --debug.
      if ([1, 4].includes(k)) return "light_rear";
      if ([24, 25, 27, 28, 33, 34, 35].includes(k)) return "paint";
      // 7..16: logo and letters; 17: the plate with the CAD maker's name cut in; 18, 21, 26: slivers, a copy of the headlight bezel.
      if ((k >= 7 && k <= 17) || k === 18 || k === 21 || k === 26) return null;
      return "trim";
    },
  },
};

// ---------------------------------------------------------------------------
// Sources -> { name, mtl, pos } groups, pos a triangle soup in source units.

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

async function readObj(file) {
  const v = [];
  const groups = new Map();
  let name = "";
  let mtl = "";
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (line.startsWith("v ")) {
      const p = line.split(/\s+/);
      v.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith("o ") || line.startsWith("g ")) name = line.slice(2).trim();
    else if (line.startsWith("usemtl ")) mtl = line.slice(7).trim();
    else if (line.startsWith("f ")) {
      const key = `${name}|${mtl}`;
      if (!groups.has(key)) groups.set(key, { name, mtl, pos: [] });
      const pos = groups.get(key).pos;
      const idx = line.slice(2).trim().split(/\s+/).map((t) => {
        const i = parseInt(t, 10);
        return i < 0 ? v.length / 3 + i : i - 1;
      });
      for (let i = 1; i < idx.length - 1; i++) for (const j of [idx[0], idx[i], idx[i + 1]]) pos.push(v[j * 3], v[j * 3 + 1], v[j * 3 + 2]);
    }
  }
  return [...groups.values()];
}

async function readStep(file) {
  const require = createRequire(join(TOOLS, "package.json"));
  const occt = await require("occt-import-js")();
  const res = occt.ReadStepFile(new Uint8Array(readFileSync(file)), {
    linearUnit: "meter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.001,
    angularDeflection: 0.2, // radians: fine enough that curved panels do not band
  });
  if (!res.success) throw new Error("STEP read failed");
  const groups = [];
  const walk = (node) => {
    node.meshes.forEach((m, k) => {
      const mesh = res.meshes[m];
      const p = mesh.attributes.position.array;
      const pos = [];
      for (const i of mesh.index.array) pos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      groups.push({ name: `${mesh.name || node.name}#${k}`, mtl: "", pos });
    });
    node.children.forEach(walk);
  };
  walk(res.root);
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
  return centres;
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
  const w = Array(3).fill(NORMAL_WEIGHT);
  const [kept] = simplifier.simplifyWithAttributes(index, p, 3, n, 3, w, lock, 0, error, ["ErrorAbsolute", "Permissive"]);
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
  if (!PINNED.every((p) => existsSync(join(TOOLS, "node_modules", p.slice(0, p.lastIndexOf("@")))))) {
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
  const { parts, size } = build(car, await car.read());
  const out = join(DEBUG ? WORK : OUT, `${name}${DEBUG ? "-debug" : ""}.glb`);
  if (DEBUG) {
    const raw = join(WORK, `${name}-raw.glb`);
    writeGlb(raw, name, parts, size);
    gltf("meshopt", raw, out);
  } else {
    const low = new Map();
    const normals = new Map();
    const locked = seams(parts);
    for (const [part, soup] of parts) {
      const [simple, n] = simplify(soup, ERROR[part], (part === "tyre" && car.tyreCrease) || car.crease, locked);
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
