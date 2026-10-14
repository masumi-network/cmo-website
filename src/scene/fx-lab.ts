// Dev only (`?raytrace=fx&fx=<chain>`): the photo-real spike's screen-space
// effects on the WebGPU renderer, for timing (raytrace-lab.tsx). Wiring follows
// three's r186 examples (webgpu_postprocessing_ssgi, _ssr). GPU time is read
// from timestamp queries, so the WebGL city running alongside does not count.

import { HalfFloatType, RenderPipeline, UnsignedByteType, type Camera, type Scene, type WebGPURenderer } from "three/webgpu";
import { add, diffuseColor, metalness, mrt, normalView, output, packNormalToRGB, pass, roughness, sample, unpackRGBToNormal, vec2, vec4, velocity } from "three/tsl";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { ssgi } from "three/addons/tsl/display/SSGINode.js";
import { ssr } from "three/addons/tsl/display/SSRNode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";

// SSGI + SSR + TRAA together needs 40 bytes per pixel of buffers, over WebGPU's 32: not offered.
export const CHAINS = ["base", "gtao", "ssr", "ssgi", "ssgi+traa"] as const;
export type Chain = (typeof CHAINS)[number];

/** A render pipeline for one effect chain: the plain scene, or with GTAO, SSR, SSGI, or SSGI and TRAA. */
export function screenSpace(renderer: WebGPURenderer, scene: Scene, camera: Camera, chain: Chain) {
  const pipeline = new RenderPipeline(renderer);
  const scenePass = pass(scene, camera);
  // Only the buffers this chain reads: WebGPU allows 32 bytes per pixel across all of them.
  const needs = { diffuse: chain.includes("ssgi"), metal: chain === "ssr", motion: chain.includes("traa") };
  scenePass.setMRT(
    mrt({
      output,
      normal: packNormalToRGB(normalView),
      ...(needs.diffuse && { diffuseColor }),
      ...(needs.metal && { metalrough: vec2(metalness, roughness) }),
      ...(needs.motion && { velocity }),
    }),
  );
  for (const [name, on] of [["normal", true], ["diffuseColor", needs.diffuse], ["metalrough", needs.metal]] as const) if (on) scenePass.getTexture(name).type = UnsignedByteType;
  if (needs.motion) scenePass.getTexture("velocity").type = HalfFloatType;
  const color = scenePass.getTextureNode("output");
  const depth = scenePass.getTextureNode("depth");
  const normal = sample((uv) => unpackRGBToNormal(scenePass.getTextureNode("normal").sample(uv)));

  const reflections = () => {
    const metalRough = scenePass.getTextureNode("metalrough");
    return ssr(color, depth, normal, { metalnessNode: metalRough.r, roughnessNode: metalRough.g }).rgb;
  };
  const gi = () => {
    const node = ssgi(color, depth, normal, camera as never);
    node.sliceCount.value = 2;
    node.stepCount.value = 8;
    return add(color.rgb.mul(node.getAONode()), scenePass.getTextureNode("diffuseColor").rgb.mul(node.getGINode().rgb));
  };
  const temporal = (rgb: ReturnType<typeof gi>) => traa(vec4(rgb, color.a), depth, scenePass.getTextureNode("velocity"), camera as never);

  if (chain === "base") pipeline.outputNode = color;
  else if (chain === "gtao") pipeline.outputNode = vec4(color.rgb.mul(ao(depth, normal, camera).getTextureNode().r), color.a);
  else if (chain === "ssr") pipeline.outputNode = vec4(color.rgb.add(reflections()), color.a);
  else if (chain === "ssgi") pipeline.outputNode = vec4(gi(), color.a);
  else pipeline.outputNode = temporal(gi());
  return pipeline;
}
