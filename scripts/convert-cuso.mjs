// Makes the light public/models/cuso.glb from the original mascot file.
//
//   node scripts/convert-cuso.mjs [--error 0.0002] [--out file.glb]
//
// Reads 3d-assets-raw/cuso.glb (gitignored). If it is missing, it is taken
// from git history first: the original came in with commit cbf92dd
// (`git show cbf92dd:public/models/cuso.glb`), 536 KB, 67.7k triangles,
// three 2048 WebP maps.
//
// What it does, and nothing else (names, nodes, the eyes, the five baked clips
// and the materials stay as they are, so rig.ts and rig.test.ts read it as before):
// - Simplifies the body (Mesh0) and the eyes with meshoptimizer to within
//   ERROR model units, normals and uvs counted, uv seams and open borders kept.
//   In the closest shot (06:00 and 07:00 on a 2x desktop screen) one model unit
//   is about 2,400 pixels, so 0.0002 is half a pixel.
// - Resizes the maps: colour and normal to 1024, metal-roughness (two flat
//   values) to 512. WebP inside the GLB as before (no KTX2: the site has no
//   KTX2 loader, and a 1024 RGBA map is 5.6 MB on the GPU, a 2048 one 22 MB).
// - Draco-compresses the meshes, as the original was (the site and the rig
//   test decode Draco).
//
// Tools are pinned and installed outside the project (not in package.json),
// into $CAR_TOOLS or <tmpdir>/cmo-car-tools, like scripts/convert-cars.mjs:
// @gltf-transform/cli (with its core, extensions, functions, sharp and draco3dgltf) and meshoptimizer.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "3d-assets-raw/cuso.glb");
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]) : join(ROOT, "public/models/cuso.glb");
const ORIGIN = "cbf92dd:public/models/cuso.glb";
const TOOLS = process.env.CAR_TOOLS ?? join(tmpdir(), "cmo-car-tools");
const PINNED = ["@gltf-transform/cli@4.5.0", "meshoptimizer@1.2.0"];

/** Model units a simplified surface may stray (half a pixel in the closest shot, see above). */
const ERROR = args.includes("--error") ? Number(args[args.indexOf("--error") + 1]) : 0.0002;
/** How much a turned normal and a shifted uv count against that error. */
const NORMAL_WEIGHT = 0.002;
const UV_WEIGHT = 0.01;
/** Longest side of each map, by material slot. */
const SIZE = { baseColorTexture: 1024, normalTexture: 1024, metallicRoughnessTexture: 512 };

function tools() {
  if (!PINNED.every((p) => existsSync(join(TOOLS, "node_modules", p.slice(0, p.lastIndexOf("@")))))) {
    mkdirSync(TOOLS, { recursive: true });
    if (!existsSync(join(TOOLS, "package.json"))) writeFileSync(join(TOOLS, "package.json"), "{}");
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefix", TOOLS, ...PINNED], { stdio: "inherit" });
  }
  const cli = createRequire(join(TOOLS, "node_modules/@gltf-transform/cli/package.json"));
  const load = (name) => import(pathToFileURL(cli.resolve(name)));
  return { load, meshopt: import(pathToFileURL(createRequire(join(TOOLS, "package.json")).resolve("meshoptimizer"))) };
}

if (!existsSync(SRC)) {
  mkdirSync(join(ROOT, "3d-assets-raw"), { recursive: true });
  writeFileSync(SRC, execFileSync("git", ["show", ORIGIN], { cwd: ROOT, maxBuffer: 1 << 26 }));
  console.log(`original taken from git (${ORIGIN}) into ${SRC}`);
}

const { load, meshopt } = tools();
const [{ NodeIO }, { ALL_EXTENSIONS }, { textureCompress }, draco3d, sharp, { MeshoptSimplifier: simplifier }] = await Promise.all([
  load("@gltf-transform/core"),
  load("@gltf-transform/extensions"),
  load("@gltf-transform/functions"),
  load("draco3dgltf"),
  load("sharp"),
  meshopt,
]);
await simplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.default.createDecoderModule(),
  "draco3d.encoder": await draco3d.default.createEncoderModule(),
});
const doc = await io.read(SRC);

/** Simplifies one primitive in place; returns [before, after] triangles. */
function simplify(prim) {
  const index = prim.getIndices().getArray();
  const pos = prim.getAttribute("POSITION");
  const normal = prim.getAttribute("NORMAL");
  const uv = prim.getAttribute("TEXCOORD_0");
  const n = pos.getCount();
  const attrs = new Float32Array(n * (3 + (uv ? 2 : 0)));
  const weights = [NORMAL_WEIGHT, NORMAL_WEIGHT, NORMAL_WEIGHT, ...(uv ? [UV_WEIGHT, UV_WEIGHT] : [])];
  const stride = weights.length;
  for (let i = 0; i < n; i++) {
    attrs.set(normal.getElement(i, []), i * stride);
    if (uv) attrs.set(uv.getElement(i, []), i * stride + 3);
  }
  const [kept] = simplifier.simplifyWithAttributes(
    Uint32Array.from(index), Float32Array.from(pos.getArray()), 3, attrs, stride, weights, null, 0, ERROR, ["ErrorAbsolute", "LockBorder"],
  );
  // Keep only the vertices still used, in first-use order.
  const remap = new Map();
  const out = Uint32Array.from(kept, (v) => (remap.has(v) ? remap.get(v) : (remap.set(v, remap.size), remap.size - 1)));
  const order = [...remap.keys()];
  for (const semantic of prim.listSemantics()) {
    const a = prim.getAttribute(semantic);
    const size = a.getElementSize();
    const src = a.getArray();
    const dst = new src.constructor(order.length * size);
    order.forEach((v, i) => dst.set(src.subarray(v * size, v * size + size), i * size));
    a.setArray(dst);
  }
  const indices = prim.getIndices();
  indices.setArray(order.length > 65535 ? out : Uint16Array.from(out));
  return [index.length / 3, out.length / 3];
}

for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const [before, after] = simplify(prim);
    console.log(`  ${mesh.getName()}: ${before} -> ${after} triangles`);
  }
}

for (const [slot, size] of Object.entries(SIZE)) {
  await textureCompress({ encoder: sharp.default, targetFormat: "webp", resize: [size, size], slots: new RegExp(`^${slot}$`), quality: 90 })(doc);
}
for (const t of doc.getRoot().listTextures()) console.log(`  ${t.getName() || t.getURI()}: ${t.getSize().join("x")}, ${Math.round(t.getImage().byteLength / 1024)} KB`);

doc.createExtension(ALL_EXTENSIONS.find((e) => e.EXTENSION_NAME === "KHR_draco_mesh_compression")).setRequired(true).setEncoderOptions({
  method: 1, // edgebreaker
  quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12 },
});
await io.write(OUT, doc);
console.log(`cuso.glb: ${Math.round(statSync(SRC).size / 1024)} KB -> ${Math.round(statSync(OUT).size / 1024)} KB, ${OUT}`);
