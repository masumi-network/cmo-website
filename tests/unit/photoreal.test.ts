import { describe, expect, it } from "vitest";
import { BatchedMesh, BoxGeometry, BufferGeometry, Color, DoubleSide, DirectionalLight, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Group, LineBasicMaterial, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, Scene, SphereGeometry, ShaderMaterial, Texture, Vector3 } from "three";
import { SLOTS } from "@/scene/house-models";
import { depthProxy, splitScene } from "@/scene/plates";
import { CAFE_MAT } from "@/scene/shop";
import { traceInfo } from "@/scene/trace-info";
import { FACADE_CELLS, facadeMaps } from "@/scene/facade-maps";
import { TRACE_LAYER, buildTwins, farCasters, lightHousings, studioFill } from "@/scene/traced";
import { PART } from "@/scene/towers";

/** A scene like the city's: static blocks, a light, the sky dome, the fog bank, lines, glass, and live objects nested inside groups. */
function city() {
  const scene = new Scene();
  const sun = new DirectionalLight();
  const block = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const district = new Group();
  const house = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const cars = new Group();
  cars.userData = { live: true };
  const car = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  cars.add(car);
  district.add(house, cars);
  const sky = new Mesh(new BoxGeometry(), new ShaderMaterial());
  sky.name = "sky";
  const fogBank = new Mesh(new BoxGeometry(), new ShaderMaterial({ transparent: true }));
  const cables = new LineSegments(new BufferGeometry(), new LineBasicMaterial());
  const glow = new Mesh(new BoxGeometry(), new MeshBasicMaterial({ transparent: true }));
  scene.add(sun, block, district, sky, fogBank, cables, glow);
  return { scene, sun, block, house, cars, car, sky, fogBank, cables, glow };
}

describe("the scene at rest on a plate", () => {
  it("draws live objects as usual and does not look inside them", () => {
    const { scene, cars, car } = city();
    const { live, catchers, hidden } = splitScene(scene);
    expect(live).toEqual([cars]);
    expect([...catchers, ...hidden]).not.toContain(car);
  });

  it("turns the static city into shadow catchers, however deep", () => {
    const { scene, block, house } = city();
    expect(splitScene(scene).catchers).toEqual([block, house]);
  });

  it("hides what the plate already shows: lines, transparent bits", () => {
    const { scene, cables, glow } = city();
    expect(splitScene(scene).hidden).toEqual([cables, glow]);
  });

  it("keeps the sky dome apart: at rest it draws only its stars over the plate's sky", () => {
    const { scene, sky } = city();
    const split = splitScene(scene);
    expect(split.sky).toBe(sky);
    expect(split.hidden).not.toContain(sky);
  });

  it("keeps custom shader effects (the fog bank) and the lights as they are", () => {
    const { scene, fogBank, sun } = city();
    const { live, catchers, hidden } = splitScene(scene);
    for (const kept of [fogBank, sun]) expect([...live, ...catchers, ...hidden]).not.toContain(kept);
  });
});

describe("the catchers' depth first", () => {
  it("draws each catcher's depth before any shadow, so a street behind a wall cannot darken the wall (a car's shadow showed through)", () => {
    const wall = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const proxy = depthProxy(wall)!;
    expect(proxy.geometry).toBe(wall.geometry);
    expect((proxy.material as MeshBasicMaterial).colorWrite).toBe(false);
    expect(proxy.renderOrder).toBeLessThan(-10);
    const many = new InstancedMesh(new BoxGeometry(), new MeshStandardMaterial(), 5);
    const copy = depthProxy(many) as InstancedMesh;
    expect(copy.isInstancedMesh).toBe(true);
    expect(copy.instanceMatrix).toBe(many.instanceMatrix);
    expect(copy.count).toBe(5);
  });
});

describe("shadows in the trace", () => {
  it("casts only from what today's sun shadow covers (the Bay Bridge streaked the city at dawn and the water at 15:00)", () => {
    const sun = new DirectionalLight();
    sun.castShadow = true;
    sun.position.set(10, 30, 10);
    sun.target.position.set(0, 0, 0);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 100 });
    sun.shadow.camera.updateProjectionMatrix();
    const scene = new Scene();
    const near = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
    const bridge = new Mesh(new BoxGeometry(2, 20, 2), new MeshStandardMaterial());
    bridge.position.set(90, 10, 0);
    const district = new Mesh(new BoxGeometry(400, 1, 400), new MeshStandardMaterial()); // reaches in: keeps casting
    scene.add(sun, sun.target, near, bridge, district);
    scene.updateMatrixWorld(true);
    expect(farCasters(scene, sun)).toEqual([bridge]);
  });
});

describe("lamps in the trace", () => {
  it("finds the glass a light sits inside (the pier lamp's globe), not the big meshes round it", () => {
    const scene = new Scene();
    const globe = new Mesh(new SphereGeometry(0.17), new MeshStandardMaterial({ emissive: "#ffd28a" }));
    globe.position.set(40, 2.4, 25);
    const light = new PointLight("#ffcf8a", 26, 8, 2);
    light.position.set(40, 2.35, 25);
    const deck = new Mesh(new BoxGeometry(20, 1, 20), new MeshStandardMaterial()); // holds the light too, but it is the deck
    deck.position.set(40, 2, 25);
    const post = new Mesh(new BoxGeometry(0.1, 2, 0.1), new MeshStandardMaterial());
    post.position.set(40, 1, 25);
    scene.add(globe, light, deck, post);
    scene.updateMatrixWorld(true);
    expect(lightHousings(scene)).toEqual([globe]);
  });
});

describe("traced twins", () => {
  it("projects a world-mapped texture as the shader does: walls by (along, height), tops by (x, z), in world units", () => {
    const map = new Texture();
    const material = new MeshStandardMaterial();
    traceInfo.set(material, { kind: "world", map, scale: 2 });
    const scene = new Scene();
    const box = new Mesh(new BoxGeometry(2, 2, 2), material);
    box.position.set(10, 1, 4);
    scene.add(box);

    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([box]);
    expect(group.children).toHaveLength(1);
    const twin = group.children[0] as Mesh;
    // only the tracer sees it: no WebGL camera renders this layer
    expect(twin.layers.isEnabled(TRACE_LAYER)).toBe(true);
    expect(twin.layers.isEnabled(0)).toBe(false);
    expect((twin.material as MeshStandardMaterial).map).toBe(map);

    // every vertex: uv = its world position over the scale, picked by the face it is on
    const pos = twin.geometry.attributes.position;
    const nrm = twin.geometry.attributes.normal;
    const uv = twin.geometry.attributes.uv;
    const p = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nrm, i);
      const want = Math.abs(n.y) > 0.5 ? [p.x / 2, p.z / 2] : [(Math.abs(n.x) > 0.5 ? p.z : p.x) / 2, p.y / 2];
      expect([uv.getX(i), uv.getY(i)]).toEqual(want.map((v) => expect.closeTo(v, 5)));
    }
    // and it sits where the box is, in world space
    expect(Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getX(i)))).toBeCloseTo(9);
  });

  it("stands the ground in with its baked colour, on the same geometry and uv", () => {
    const mask = new Texture();
    mask.repeat.set(0.01, 0.02);
    const ground = new MeshStandardMaterial({ map: mask });
    traceInfo.set(ground, { kind: "ground", mask });
    const scene = new Scene();
    const tile = new Mesh(new BoxGeometry(), ground);
    tile.position.set(3, 0, -2);
    scene.add(tile);
    const baked = new Texture();

    const { group, originals } = buildTwins(scene, new Map([[ground, baked]]));
    expect(originals).toEqual([tile]);
    const twin = group.children[0] as Mesh;
    expect(twin.geometry).toBe(tile.geometry);
    expect((twin.material as MeshStandardMaterial).map).toBe(baked);
    expect(twin.matrixWorld.equals(tile.matrixWorld)).toBe(true);
  });

  it("keeps the original ground when there is no bake, rather than leave a hole", () => {
    const mask = new Texture();
    const ground = new MeshStandardMaterial({ map: mask });
    traceInfo.set(ground, { kind: "ground", mask });
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), ground));
    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([]);
    expect(group.children).toHaveLength(0);
  });

  it("splits a multi-material mesh into its visible groups (the cliffs' hidden cap must not trace)", () => {
    const geometry = new BoxGeometry(); // 6 groups, one per side
    const hidden = new MeshBasicMaterial({ visible: false });
    const rock = new MeshStandardMaterial({ color: "grey" });
    const cliffs = new Mesh(geometry, [hidden, rock, hidden, rock, hidden, rock]);
    const scene = new Scene();
    scene.add(cliffs);

    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([cliffs]);
    expect(group.children).toHaveLength(3);
    for (const part of group.children as Mesh[]) {
      expect(part.material).toBe(rock);
      expect(part.geometry.index!.count).toBe(6); // one side: two triangles
    }
  });

  it("paints an instanced house in its own instance's palette (the shop's shell traced blue, not cream)", () => {
    const n = SLOTS.length;
    const palette = new Float32Array(2 * n * 3);
    palette.fill(0.2, 0, n * 3); // palette 0: dark
    palette.fill(0.8, n * 3); // palette 1: light
    const material = new MeshStandardMaterial();
    traceInfo.set(material, { kind: "house", siding: new Texture(), shingles: new Texture(), palette, night: { value: 0 } });
    const geometry = new BoxGeometry();
    geometry.setAttribute("aSlot", new Float32BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(SLOTS.indexOf("trim")), 1));
    geometry.setAttribute("aPalette", new InstancedBufferAttribute(new Float32Array([1]), 1));
    const shell = new InstancedMesh(geometry, material, 1);
    const scene = new Scene();
    scene.add(shell);

    const { group } = buildTwins(scene);
    const col = (group.children[0] as Mesh).geometry.attributes.color;
    for (let i = 0; i < col.count; i++) expect(col.getX(i)).toBeCloseTo(0.8);
  });

  it("stands the shop's painted parts in with their vertex colours, glowing only where the shader lets them", () => {
    const material = new MeshStandardMaterial({ vertexColors: true, emissive: "#ffc98c", emissiveIntensity: 0.45 });
    traceInfo.set(material, { kind: "painted", atlas: { value: null } });
    const part = (glow: number, mat: number, hex: string) => {
      const g = new BoxGeometry();
      const count = g.attributes.position.count;
      const c = new Color(hex);
      g.setAttribute("color", new Float32BufferAttribute(Array.from({ length: count }, () => [c.r, c.g, c.b]).flat(), 3));
      g.setAttribute("aGlow", new Float32BufferAttribute(new Float32Array(count).fill(glow), 1));
      g.setAttribute("aMat", new Float32BufferAttribute(new Float32Array(count).fill(mat), 1));
      return g;
    };
    const frame = new Mesh(part(0, CAFE_MAT.plain, "#2f5141"), material);
    const handle = new Mesh(part(0, CAFE_MAT.chrome, "#d9dcde"), material);
    const bulb = new Mesh(part(3, CAFE_MAT.plain, "#fff1d8"), material);
    const scene = new Scene();
    scene.add(frame, handle, bulb);

    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([frame, handle, bulb]);
    const twins = group.children as Mesh[];
    const of = (m: (t: MeshStandardMaterial) => boolean) => twins.find((t) => m(t.material as MeshStandardMaterial))!;
    // the green frame keeps its colour and does not glow (it traced flat tan before)
    const green = of((t) => t.metalness === 0 && t.emissiveIntensity === 0);
    expect(green.geometry.attributes.color.getX(0)).toBeCloseTo(new Color("#2f5141").r);
    expect(of((t) => t.metalness === 1).geometry.attributes.position.count).toBe(36);
    // the bulb glows: the material's emissive, times its glow, times its paint
    const lit = of((t) => t.emissiveIntensity > 0).material as MeshStandardMaterial;
    expect(lit.emissiveIntensity).toBeCloseTo(0.45 * 3);
    expect(lit.emissive.r).toBeCloseTo(new Color("#ffc98c").r * new Color("#fff1d8").r);
  });

  it("turns a line into a tube whose sides face out (inward ones traced the red suspenders dark brown)", () => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute([2, 0, 0, 2, 5, 1], 3));
    const scene = new Scene();
    scene.add(new LineSegments(g, new LineBasicMaterial({ color: "#c0362c" })));

    const tube = buildTwins(scene).group.children[0] as Mesh;
    const pos = tube.geometry.attributes.position;
    const nrm = tube.geometry.attributes.normal;
    const axis = new Vector3(0, 5, 1).normalize();
    const p = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      // from the axis to the vertex, and the normal: the same way
      p.fromBufferAttribute(pos, i).sub(new Vector3(2, 0, 0));
      p.addScaledVector(axis, -p.dot(axis));
      expect(p.dot(new Vector3().fromBufferAttribute(nrm, i))).toBeGreaterThan(0);
    }
  });

  it("lights about half a house's windows at night, warm, as the house shader does", () => {
    const n = SLOTS.length;
    const night = { value: 0.15 };
    const material = new MeshStandardMaterial();
    traceInfo.set(material, { kind: "house", siding: new Texture(), shingles: new Texture(), palette: new Float32Array(n * 3).fill(0.3), night });
    const scene = new Scene();
    // forty windows, each a box of glass with its own id, on one house (one origin)
    for (let w = 1; w <= 40; w++) {
      const g = new BoxGeometry(0.5, 0.8, 0.05);
      const count = g.attributes.position.count;
      g.setAttribute("aSlot", new Float32BufferAttribute(new Float32Array(count).fill(SLOTS.indexOf("glass")), 1));
      g.setAttribute("aWin", new Float32BufferAttribute(new Float32Array(count).fill(w), 1));
      g.setAttribute("aOrigin", new Float32BufferAttribute(Array.from({ length: count }, () => [3, 7]).flat(), 2));
      const pane = new Mesh(g, material);
      pane.position.x = w;
      scene.add(pane);
    }
    const twins = buildTwins(scene).group.children as Mesh[];
    const lit = twins.find((t) => (t.material as MeshStandardMaterial).emissive.r > 0)!;
    const dark = twins.find((t) => t !== lit)!;
    expect((dark.material as MeshStandardMaterial).emissive.getHex()).toBe(0);
    const share = lit.geometry.attributes.position.count / (lit.geometry.attributes.position.count + dark.geometry.attributes.position.count);
    expect(share).toBeGreaterThan(0.3);
    expect(share).toBeLessThan(0.7);
    const m = lit.material as MeshStandardMaterial;
    expect(m.emissiveIntensity).toBeCloseTo(1.1 * 0.15);
    expect([m.emissive.r, m.emissive.g, m.emissive.b]).toEqual([1, expect.closeTo(0.7), expect.closeTo(0.38)]);
  });

  it("dresses the downtown towers: windows by their wall grid, tar roofs, lit windows only at night", () => {
    const night = { value: 0 };
    const material = new MeshStandardMaterial({ vertexColors: true });
    traceInfo.set(material, { kind: "downtown", stone: new Texture(), night });
    const g = new BoxGeometry(4, 6, 4);
    const n = g.attributes.position.count;
    const p = g.attributes.position;
    const tint = new Color(0.5, 0.6, 0.7);
    g.setAttribute("color", new Float32BufferAttribute(Array.from({ length: n }, () => [tint.r, tint.g, tint.b]).flat(), 3));
    // a curtain wall (part 0): the grid counts columns along x and storeys up y
    g.setAttribute("aUv", new Float32BufferAttribute(Array.from({ length: n }, (_, i) => [p.getX(i) * 2, p.getY(i) * 3]).flat(), 2));
    g.setAttribute("aInfo", new Float32BufferAttribute(Array.from({ length: n }, () => [PART.glass, 0.3, 0]).flat(), 3));
    const tower = new Mesh(g, material);
    const scene = new Scene();
    scene.add(tower);

    const twins = () => buildTwins(scene).group.children as Mesh[];
    const day = twins();
    const wall = day.find((t) => (t.material as MeshStandardMaterial).map)!;
    const m = wall.material as MeshStandardMaterial;
    expect(m.roughnessMap).toBeTruthy();
    expect(m.emissiveMap).toBeTruthy();
    expect(m.emissiveIntensity).toBe(0);
    // whole cells: uv = (grid + a whole offset) / FACADE_CELLS, so every window lands on one
    const uv = wall.geometry.attributes.uv;
    const pos = wall.geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) {
      const offset = uv.getX(i) * FACADE_CELLS - pos.getX(i) * 2;
      if (Math.abs(wall.geometry.attributes.normal.getZ(i)) > 0.5) expect(Math.abs(offset - Math.round(offset))).toBeLessThan(1e-4);
    }
    // the flat top is tar, not glass
    const roof = day.find((t) => t !== wall && !(t.material as MeshStandardMaterial).map)!;
    expect(roof.geometry.attributes.color.getX(0)).toBeCloseTo(tint.r * 0.3 + 0.2 * 0.7, 3);

    night.value = 1;
    const lit = twins().find((t) => (t.material as MeshStandardMaterial).map)!.material as MeshStandardMaterial;
    expect(lit.emissiveIntensity).toBeCloseTo(1.4);
  });

  it("follows the hour: twins built at dawn light up when refreshed at dusk (the bake builds them at load, then scrolls)", () => {
    const n = SLOTS.length;
    const night = { value: 0 };
    const material = new MeshStandardMaterial();
    traceInfo.set(material, { kind: "house", siding: new Texture(), shingles: new Texture(), palette: new Float32Array(n * 3).fill(0.3), night });
    const scene = new Scene();
    for (let w = 1; w <= 20; w++) {
      const g = new BoxGeometry(0.5, 0.8, 0.05);
      const count = g.attributes.position.count;
      g.setAttribute("aSlot", new Float32BufferAttribute(new Float32Array(count).fill(SLOTS.indexOf("glass")), 1));
      g.setAttribute("aWin", new Float32BufferAttribute(new Float32Array(count).fill(w), 1));
      scene.add(new Mesh(g, material));
    }
    const built = buildTwins(scene);
    const lit = (built.group.children as Mesh[]).map((t) => t.material as MeshStandardMaterial).find((m) => m.emissive.r > 0)!;
    expect(lit.emissiveIntensity).toBe(0);
    night.value = 0.5;
    built.refresh();
    expect(lit.emissiveIntensity).toBeCloseTo(0.55);
  });

  it("maps a landmark's stone facade in world units, as the tower shader does", () => {
    const facade = new Texture();
    const material = new MeshStandardMaterial();
    traceInfo.set(material, { kind: "tower", facade, tile: { w: 4.8, h: 7.2 }, glassy: false });
    const scene = new Scene();
    const box = new Mesh(new BoxGeometry(2, 2, 2), material);
    box.position.set(10, 1, 4);
    scene.add(box);
    const twins = buildTwins(scene).group.children as Mesh[];
    const wall = twins.find((t) => (t.material as MeshStandardMaterial).map === facade)!;
    const uv = wall.geometry.attributes.uv;
    const pos = wall.geometry.attributes.position;
    const nrm = wall.geometry.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      const u = Math.abs(nrm.getX(i)) > 0.5 ? pos.getZ(i) : pos.getX(i);
      expect([uv.getX(i), uv.getY(i)]).toEqual([expect.closeTo(u / 4.8, 5), expect.closeTo(pos.getY(i) / 7.2, 5)]);
    }
    expect(twins.length).toBe(2); // walls, and the tops at 0.62
  });

  it("lights as many windows at 18:00 as today's towers show (60 to 80 percent, measured on the GPU)", () => {
    for (const kind of ["sash", "steel"] as const) {
      const lit = facadeMaps(kind).lit.image.data as Uint8Array;
      const size = Math.sqrt(lit.length / 4);
      const cell = size / FACADE_CELLS;
      let on = 0;
      for (let cy = 0; cy < FACADE_CELLS; cy++) for (let cx = 0; cx < FACADE_CELLS; cx++) on += lit[((cy * cell + cell / 2) * size + cx * cell + cell / 2) * 4] > 0 ? 1 : 0;
      const share = on / FACADE_CELLS ** 2;
      expect(share, kind).toBeGreaterThan(0.6);
      expect(share, kind).toBeLessThan(0.8);
    }
  });

  it("traces the towers' metal (vents, roof decks) dark and matte, as the raster shows it without an environment", () => {
    const material = new MeshStandardMaterial({ vertexColors: true });
    traceInfo.set(material, { kind: "downtown", stone: new Texture(), night: { value: 0 } });
    const g = new BoxGeometry(2, 2, 2);
    const n = g.attributes.position.count;
    g.setAttribute("color", new Float32BufferAttribute(new Array(n * 3).fill(0.28), 3));
    g.setAttribute("aUv", new Float32BufferAttribute(new Array(n * 2).fill(0), 2));
    g.setAttribute("aInfo", new Float32BufferAttribute(Array.from({ length: n }, () => [PART.metal, 0.5, 0]).flat(), 3));
    const scene = new Scene();
    scene.add(new Mesh(g, material));
    const twin = buildTwins(scene).group.children[0] as Mesh;
    // it mirrored the bright sky in the trace and read light grey; the raster has no environment for it to mirror
    expect((twin.material as MeshStandardMaterial).metalness).toBe(0);
    expect(twin.geometry.attributes.color.getX(0)).toBeCloseTo(0.28 * 0.4);
  });

  it("fills the night like the raster's studio light, and leaves the day to the sky", () => {
    expect(studioFill(0).every((f) => f.intensity === 0)).toBe(true);
    const night = studioFill(1);
    expect(night).toHaveLength(2);
    expect(night[0].intensity).toBeGreaterThan(night[1].intensity);
    for (const f of night) expect(f.direction.length()).toBeCloseTo(1);
  });

  it("ripples the water as gently as the shader's mirror does (strong ripples swept the bridge lights into zigzags)", () => {
    const material = new MeshStandardMaterial();
    const ripples = new Texture();
    traceInfo.set(material, { kind: "water", ripples, deep: new Color(0.02, 0.05, 0.08) });
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(10, 0.1, 10), material));
    const water = (buildTwins(scene).group.children[0] as Mesh).material as MeshStandardMaterial;
    expect(water.normalMap).toBe(ripples);
    // the shader moves its mirror image by slope x 0.6 / (depth + 8): a few pixels, not a tilt of degrees
    expect(water.normalScale.x).toBeLessThanOrEqual(0.03);
    expect(water.roughness).toBeLessThan(0.1);
  });

  it("expands batched trees into plain meshes: each instance's model, place and tint (the tracer lost the trunks)", () => {
    const material = new MeshStandardMaterial({ map: new Texture(), vertexColors: true, alphaTest: 0.5, side: DoubleSide, roughness: 0.8 });
    traceInfo.set(material, { kind: "batched" });
    const small = new BoxGeometry(1, 1, 1);
    const tall = new BoxGeometry(1, 4, 1);
    for (const g of [small, tall]) g.setAttribute("color", new Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0.5), 3));
    const trees = new BatchedMesh(3, 100, 200, material);
    const [a, b] = [trees.addGeometry(small), trees.addGeometry(tall)];
    const place = (geometry: number, x: number, tint: number) => {
      const i = trees.addInstance(geometry);
      trees.setMatrixAt(i, new Matrix4().makeTranslation(x, 0, 0));
      trees.setColorAt(i, new Color(tint, tint, tint));
      return i;
    };
    place(a, 0, 1);
    place(b, 10, 0.5);
    trees.setVisibleAt(place(b, 20, 1), false); // hidden instances stay out
    const scene = new Scene();
    scene.add(trees);

    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([trees]);
    const twin = group.children[0] as Mesh;
    const m = twin.material as MeshStandardMaterial;
    expect([m.map, m.alphaTest, m.side, m.vertexColors]).toEqual([material.map, 0.5, DoubleSide, true]);
    const pos = twin.geometry.attributes.position;
    expect(pos.count).toBe(small.index!.count + tall.index!.count);
    const xs = Array.from({ length: pos.count }, (_, i) => pos.getX(i));
    expect(Math.max(...xs)).toBeCloseTo(10.5);
    // vertex colour times the instance's tint
    const col = twin.geometry.attributes.color;
    expect(col.getX(0)).toBeCloseTo(0.5);
    expect(col.getX(pos.count - 1)).toBeCloseTo(0.25);
    expect(twin.geometry.attributes.uv).toBeTruthy();
  });

  it("leaves plain meshes alone: the tracer reads them as they are", () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "red" })));
    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([]);
    expect(group.children).toHaveLength(0);
  });
});
