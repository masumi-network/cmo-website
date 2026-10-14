import { describe, expect, it } from "vitest";
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Texture, Vector3 } from "three";
import { allButLive, liveRoots, matches, plateCamera } from "@/scene/plate-lab";
import { traceInfo } from "@/scene/trace-info";
import { TRACE_LAYER, buildTwins } from "@/scene/traced";

/** A scene like the city's: static blocks, a light, and live objects nested inside groups. */
function city() {
  const scene = new Scene();
  const sun = new DirectionalLight();
  const block = new Mesh(new BoxGeometry());
  const district = new Group();
  const house = new Mesh(new BoxGeometry());
  const cars = new Group();
  cars.userData.live = true;
  cars.add(new Mesh(new BoxGeometry()));
  district.add(house, cars);
  const cuso = new Group();
  cuso.userData.live = true;
  scene.add(sun, block, district, cuso);
  return { scene, sun, block, district, house, cars, cuso };
}

describe("live objects over plates", () => {
  it("finds the live roots, however deep", () => {
    const { scene, cars, cuso } = city();
    expect(liveRoots(scene)).toEqual([cars, cuso]);
  });

  it("hides whole static subtrees, never the live objects, their parents or the lights", () => {
    const { scene, sun, block, district, house, cars, cuso } = city();
    const hide = allButLive(scene);
    expect(hide).toEqual([block, house]);
    for (const kept of [sun, district, cars, cuso]) expect(hide).not.toContain(kept);
  });
});

describe("plate camera", () => {
  const camera = () => {
    const c = new PerspectiveCamera(35, 1.6, 0.2, 1200);
    c.position.set(4, 3, 9);
    c.lookAt(0, 1, 0);
    c.updateMatrixWorld();
    return c;
  };

  it("matches the camera it was traced from", () => {
    const c = camera();
    expect(matches(c, plateCamera(c, 1440, 900))).toBe(true);
  });

  it("still matches when the camera has eased to within a centimetre", () => {
    const c = camera();
    const plate = plateCamera(c, 1440, 900);
    c.position.x += 0.01;
    c.updateMatrixWorld();
    expect(matches(c, plate)).toBe(true);
  });

  it("does not match another view, lens or screen shape", () => {
    const c = camera();
    const plate = plateCamera(c, 1440, 900);
    c.position.x += 0.25; // the unsettled camera the first bake caught
    c.updateMatrixWorld();
    expect(matches(c, plate)).toBe(false);
    const wide = camera();
    wide.fov = 50;
    expect(matches(wide, plate)).toBe(false);
    const tall = camera();
    tall.aspect = 0.5;
    expect(matches(tall, plate)).toBe(false);
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
