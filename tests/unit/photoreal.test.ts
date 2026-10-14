import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, DirectionalLight, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene, ShaderMaterial, Texture, Vector3 } from "three";
import { splitScene } from "@/scene/plates";
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

  it("leaves plain meshes alone: the tracer reads them as they are", () => {
    const scene = new Scene();
    scene.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial({ color: "red" })));
    const { group, originals } = buildTwins(scene);
    expect(originals).toEqual([]);
    expect(group.children).toHaveLength(0);
  });
});
