# F12 · Photo-real mode (planned)

Last updated: 2026-10-14 · Status: planned · Spike done; plates look like the direction

## Idea
- A photo-real city for desktops with WebGPU, behind a flag. The WebGL site stays the default; phones keep lite mode.
- Same speed while scrolling: screen-space effects (SSGI, SSR, GTAO, TRAA) while the camera moves, a WebGPU path tracer ([three-gpu-pathtracer](https://github.com/gkjohnson/three-gpu-pathtracer)) only while it rests on a chapter.
- Team research page: https://claude.ai/code/artifact/02617856-3933-4608-98f4-9c6aa0bfe0ca

## Spike (2026-10-14)
- Dev only: `?raytrace` (`src/scene/raytrace-lab.tsx`) path-traces the live city over the WebGL canvas. R hides the traced image, F freezes the WebGL city, P restarts. Options: `&scale=0.5` (half resolution), `&spp=8` (denoise sooner), `&denoise=0`, `&pose=0` (keep load-time poses).
- `BASE=http://localhost:3001 node scripts/raytrace-bench.mjs <dir> 0 3 6` saves today's render, traced shots at 1 to 16 s, and `bench.json`.
- Packages are dev only: `three-gpu-pathtracer` 0.0.27, `three-mesh-bvh` 0.9.16 (+ `xatlas-web` peer), `oidn-web` 0.5.0.

## Numbers (1440x900, this Mac, production-like scene)
| Step | Result |
| --- | --- |
| BVH build (blocks the page) | 1.3 s |
| Kernel compile before the first sample | 3.5 s cold, about 1 s warm |
| Full resolution | about 9 samples per pixel per second |
| Half resolution (`scale=0.5`) | about 24 spp/s; 4 spp in 1.1 to 1.4 s, 16 spp in 2.6 to 2.9 s |
| Daylight look | grainy but readable at 8 spp; a denoiser should make it clean |

## What we learned
- Instanced and batched meshes (trees, grass, cars) trace fine. Cuso, terrain, UV textures, billboards and plain colours look clearly more real.
- **Most of the city's colour is invisible to the tracer.** It lives in `onBeforeCompile` hooks (house palettes, world-mapped steel and stone, facade windows, water, night glow), so those meshes trace white, and night scenes trace dark.
- So "bake shader-made looks into textures" is the main job, not a side task. Every patched material needs a traceable form (UVs + baked textures, or vertex colours) on top of its TSL port.
- Two upstream workarounds live in the lab: three-mesh-bvh leaves a stale range start after a batched mesh (Cuso read past his end), and the tracer reads `color` from every material, so shader materials get a stand-in.

## Chapter 0 made traceable (2026-10-14)
- `traced.ts` builds plain twins of shader-patched meshes, in world space, on layer 31 (only the tracer sees it). Built in about 60 ms.
  - Houses and the 06:00 apartment: palette colours as vertex colours, siding and shingles with the shaders' projected UVs, glossy glass (real reflections).
  - Bridge steel and deck (`worldMaterial`), concrete: the same textures with projected UVs.
  - Water: the ripple texture as a normal map on glossy water.
  - Lines (Golden Gate suspenders): thin square tubes.
- Each patched factory records its inputs in `trace-info.ts` (`traceInfo`, a WeakMap). Four factories do so now: house, world, concrete, water.
- Distance fog: a WebGPU depth pass (redrawn at rest) blends the scene's linear fog over the traced image. Lines and GLSL meshes stay out of it.
- At rest (camera still for 300 ms) the lab reads the scene again so Cuso's pose and the cars match: 530 ms on the main thread.
- The renderer asks for the adapter's storage limits: the city needs a 140 MB storage binding, over WebGPU's default 128 MB.

Result: the chapter 0 frame reads as photo-real: steel, stone, houses, water reflections, haze. Gaps: Karl the fog bank (a GLSL shader), the post effects (tilt-shift, bloom, vignette), and a hard line where the fogged ocean meets the clear sky.

Gotchas:
- `updateTransforms()` moves whole objects but never re-uploads a skinned mesh's vertices, so Cuso ghosts. Re-read the scene or keep him in a live raster layer.
- Fog's depth pass must skip lines and points, or the unfogged hills behind them show through as dark stripes.

## Denoiser (2026-10-14)
- OIDN through `oidn-web` 0.5.0 (dev dependency). The tracer stops at `?spp=` samples (default 16), then the denoiser runs. `?denoise=0` turns it off.
- Weights are gitignored in `public/lab/oidn/`: `rt_hdr_alb_nrm.tza` and `rt_hdr.tza` (1.8 MB each) from [RenderKit/oidn-weights](https://github.com/RenderKit/oidn-weights). Download them with curl from `media.githubusercontent.com/media/RenderKit/oidn-weights/master/<file>` and check the SHA-256 against the LFS pointer.
- Its guide pass rasterizes albedo and normals with the WebGPU renderer, so the lab shows that pass the twins (layer 31) and hides the originals, GLSL meshes and lines (`guided` in the lab).

Time from the camera stopping to the clean image (chapter 0, 1440x900, same on a second rest):

| Setting | Clean image |
| --- | --- |
| 16 spp, full resolution | 3.7 s |
| 8 spp, full resolution | 2.8 s |
| 8 spp, half resolution (`scale=0.5`) | 2.05 s |
| 8 spp, half resolution, no scene re-read (`pose=0`) | 1.5 s, but moved objects smear |

- 16 spp at full resolution is clean, no grain. Half resolution is softer: an upscaler (`FSRUpscaler`, needs `@pmndrs/upscaler`) is the next step there.
- About 1.3 s of each time is before the first sample: the 0.5 s scene re-read plus the tracer's recompile after it.
- Skipping the re-read is only clean if moving things (Cuso, cars) are not traced at all: the guide pass sees where they are now. So: trace the static city, draw Cuso and traffic live on top.

## Screen-space effects (2026-10-14)
- Dev only: `?raytrace=fx&fx=base|gtao|ssr|ssgi|ssgi+traa` (`fx-lab.ts`), timed with GPU timestamps. `node scripts/fx-bench.mjs <dir> 0 3`.
- Wiring follows three's r186 examples. SSGI + SSR + TRAA together needs 40 bytes per pixel of buffers, over WebGPU's 32, so it is not offered.

GPU ms per frame, 1440x900 at one pixel per point, shadows on, WebGL city frozen:

| Chain | Chapter 0 | Chapter 3 | Added |
| --- | --- | --- | --- |
| base (WebGPU raster) | 2.3 | 3.8 | |
| GTAO | 5.4 | 9.6 | +3 to +6 |
| SSGI (with its AO) | 7.6 | 11.1 | +5 to +7 |
| SSR | 10.9 | 19.2 | +9 to +15 |
| SSGI + TRAA | 15.2 | 22.5 | +13 to +19 |

- Retina doubles both sides: about four times these numbers.
- SSGI + TRAA gives softer edges and contact shading, not a photo-real step.
- Verdict: while moving, plain raster. The photo-real step comes from tracing at rest.

## Pre-traced chapter plates (2026-10-14)
- `?raytrace=plate` traces the static city (live objects hidden) to 256 spp, denoises, and reads its depth. `node scripts/plates.mjs <dir> 0` saves `public/lab/plates/ch<i>-<w>x<h>.{png,f32,json}` (gitignored), then checks the composite.
- `?raytrace=plates` shows the plate when the camera rests on its view, and draws only the live objects over it, depth-tested (`plate-lab.ts`).
- Live objects are marked `userData.live`: Cuso (cuso.tsx), the cars (traffic.tsx), boats and ferry (bay.tsx).

| Measure | Chapter 0 |
| --- | --- |
| Bake (256 spp + denoise, this Mac) | about 35 s |
| Composite per frame (plate + live objects) | 0.7 to 2.8 ms GPU |
| Colour (PNG) | 880 KB, WebP or AVIF would be far smaller |
| Depth (raw float32) | 5 MB, needs 16-bit or half resolution |

Result: the traced city with Cuso blinking and the boats sailing over it, at a fraction of today's frame cost.

Gotchas:
- The camera eases in and never lands on the same matrix twice. A plate needs a fixed rest camera: bake once the camera is still, match within about 2 cm, and draw the live objects from the plate's camera.
- The pointer parallax (camera-rig.tsx, up to 0.35 units) moves the camera off the plate. Turn it off at rest, or shift the plate by its depth.
- The plate's colour loads bottom row first, its depth readback top row first.
- Every plate is one chapter, one hour, one screen size and one pixel ratio.

Still missing:
- Cuso's shadow on the plate: a shadow-catcher pass over the static depth.
- Karl the fog bank (GLSL), and the post effects (tilt-shift, bloom, vignette).
- Brand signs (F04) change per visitor: keep them live or out of plates.
- Fading between the live city and the plate.
