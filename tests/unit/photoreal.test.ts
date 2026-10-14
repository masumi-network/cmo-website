import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Color, DirectionalLight, Float32BufferAttribute, InstancedBufferAttribute, InstancedMesh, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderMaterial, Texture, Vector3 } from "three";
import { SLOTS } from "@/scene/house-models";
import { splitScene } from "@/scene/plates";
import { CAFE_MAT } from "@/scene/shop";
import { traceInfo } from "@/scene/trace-info";
import { TRACE_LAYER, buildTwins } from "@/scene/traced";

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

  it("hides what the plate already shows: the sky dome, lines, transparent bits", () => {
    const { scene, sky, cables, glow } = city();
    expect(splitScene(scene).hidden).toEqual([sky, cables, glow]);
  });

  it("keeps custom shader effects (the fog bank) and the lights as they are", () => {
    const { scene, fogBank, sun } = city();
    const { live, catchers, hidden } = splitScene(scene);
    for (const kept of [fogBank, sun]) expect([...live, ...catchers, ...hidden]).not.toContain(kept);
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
    traceInfo.set(material, { kind: "house", siding: new Texture(), shingles: new Texture(), palette });
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

  it("leaves plain meshes alone: the tracer reads them as they are", () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "red" })));
    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([]);
    expect(group.children).toHaveLength(0);
  });
});
