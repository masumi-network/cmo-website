import { describe, expect, it } from "vitest";
import { BoxGeometry, Color, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, Scene, ShaderMaterial, Texture } from "three";
import { SLOTS } from "@/scene/house-models";
import { traceInfo } from "@/scene/trace-info";
import { glslOnly, portFor } from "@/scene/webgpu-lab";

const house = () => {
  const m = new MeshStandardMaterial();
  traceInfo.set(m, { kind: "house", siding: new Texture(), shingles: new Texture(), palette: new Float32Array(SLOTS.length * 3 * 2), night: { value: 0 } });
  return m;
};

describe("WebGPU spike: material ports", () => {
  it("rebuilds the row houses as a node material: colour, roughness and night glow from TSL", () => {
    const port = portFor(house(), { hasOrigin: true });
    expect(port?.type).toBe("MeshStandardNodeMaterial");
    expect(port?.colorNode).toBeTruthy();
    expect(port?.roughnessNode).toBeTruthy();
    expect(port?.emissiveNode).toBeTruthy();
  });

  it("builds one port per material, so every district shares it", () => {
    const m = house();
    expect(portFor(m, { hasOrigin: true })).toBe(portFor(m, { hasOrigin: true }));
  });

  it("rebuilds the water with its ripples and a mirror", () => {
    const m = new MeshStandardMaterial();
    traceInfo.set(m, { kind: "water", ripples: new Texture(), deep: new Color("#204060") });
    const port = portFor(m, { hasOrigin: false, mirrorScale: 0.5 });
    expect(port?.type).toBe("MeshStandardNodeMaterial");
    expect(port?.normalNode).toBeTruthy();
    expect(port?.emissiveNode).toBeTruthy();
  });

  it("leaves materials not ported yet as they are (WebGPU draws them plain)", () => {
    expect(portFor(new MeshStandardMaterial(), { hasOrigin: false })).toBeNull();
  });
});

describe("WebGPU spike: what WebGPU cannot draw", () => {
  it("lists GLSL-only meshes (the sky dome, the fog bank), not lines or standard materials", () => {
    const scene = new Scene();
    const dome = new Mesh(new BoxGeometry(), new ShaderMaterial());
    const block = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
    const cables = new LineSegments(new BoxGeometry(), new LineBasicMaterial());
    scene.add(dome, block, cables);
    expect(glslOnly(scene)).toEqual([dome]);
  });
});
