# F12 · Photo-real mode (v0)

Last updated: 2026-10-14 · Status: v0, behind a flag · Launch: ok (off by default)

## What it is
- On desktop, `?photoreal` (or `NEXT_PUBLIC_PHOTOREAL=1`) shows each chapter's rest view as a pre-traced plate: the static city path-traced once, at build time, with Cuso, cars, boats and the visitor's brand drawn live on top. Phones and lite mode never get it.
- While scrolling, the city renders as today. Screen-space effects were measured and left out: too slow for what they add (below).
- Team research page: https://claude.ai/code/artifact/02617856-3933-4608-98f4-9c6aa0bfe0ca

## How it works (`src/scene/plates.tsx`, `src/lib/plates.ts`)
- `public/plates/manifest.json` lists one plate per chapter: file, size, hour, and the camera pose it was traced from (zod-checked; a broken file means no plates).
- A plate is 2:1 at 3456 x 1728. The vertical field of view is fixed, so any narrower screen shows its middle; a screen wider than 2:1 gets no plate.
- Colour is linear, divided by `PLATE_RANGE` (2) and sRGB-encoded in an 8-bit WebP. The post chain (bloom, tilt-shift, tone mapping) treats it like the rest of the scene, so plate and live objects match.
- The plate defines the rest view. `plates.tsx` offers the rig the ready plates for the chapter (`rig.plates`, both ends of the leg, since at a chapter the day can read as either). Once the rig's own camera has settled within 60 cm and 5 degrees of one (it never lands twice the same: it follows where Cuso stopped), it glides onto the plate's pose in 0.5 s (`settle` in lib/plates.ts) and lets go when it moves on. At the end of the glide `rig.rest` is set: the plate shows and the water mirror pauses. The pointer parallax is off in this mode.
- Then the plate fades in over the city (0.4 s). At rest the static city is drawn only as a shadow catcher (`splitScene`): its depth hides live objects behind walls, and live objects' shadows multiply onto the plate (static casters off, the plate has their shadows). The sky dome, lines and transparent bits hide; custom shader effects (the fog bank) stay live.
- Moving again restores the city at once. The canvas carries `data-plate` = `off`, `fade` or `rest` for tests.
- Live objects are marked `userData={LIVE}` (shared.ts): Cuso, cars, boats and ferry, cable cars, the Union Square billboard, the shop sign and interior.

## Baking plates
- Needs the dev server and a real GPU: `BASE=http://localhost:3001 node scripts/plates.mjs <check-dir> [chapters]` (default all 8). About 70 s a chapter at 128 samples, then a check: `<i>-photoreal.png` next to `<i>-today.png`.
- It runs the dev lab's plate mode (`?raytrace=plate&dpr=2`): traced twins of the patched materials, live objects hidden, OIDN denoiser, the scene's fog mixed in linear, then `encodePlate`.
- `CHECK=1` skips the bake and only checks. A chapter whose camera does not settle in 60 s fails with a message instead of hanging.
- The traced sky turns to the fog colour near the horizon (haze), so fogged far water and hills meet it without an edge (a hard line and a cut-off hill showed before).
- Re-bake after changing the static city, its materials, a chapter's camera, or the lighting at its hour. The OIDN weights for the denoiser are gitignored in `public/lab/oidn/` (see Denoiser below).

## Which chapters have plates (2026-10-14)
Chapters 0, 2 and 3 ship. Reviewed against today's frame:

| Chapter | Status | Missing |
| --- | --- | --- |
| 0 (06:00 rooftop, Golden Gate) | ships | suspender cables trace dark brown, not red |
| 1 (07:00 shop) | held back | shopfront flat tan: needs a `shop-painted` twin |
| 2 (09:00 Mission mural) | ships | |
| 3 (12:00 Union Square) | ships | |
| 4 to 7 | not baked | `downtown`, towers, `ferry-market`, `coit`, `taqueria`; night chapters need window glow and lamps as emitters |

What made 0, 2 and 3 right (all in the bake, `traced.ts`, `bake-ground.ts`, `raytrace-lab.tsx`):
- Ground: its own shader drawn in uv space and read back as one colour texture (32 texels per unit), on the same geometry (the mask itself had traced as red, green and blue).
- Multi-material meshes split into their visible groups: the cliffs' invisible cap had traced as a mirror over the streets.
- Additive washes and glows are skipped: the mural's black wash had traced as a black box.
- The scene is read again at rest: tree and lamp level-of-detail models switch with the camera.
- Fog: the depth pass sees the twins, and the sky gets haze near the horizon, so no line or cut where far water meets sky.
- The bake waits for the camera to set off before waiting for it to stop (chapter 1 once baked chapter 0's view).

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

## Pre-traced chapter plates: spike (2026-10-14)
- First tried on the WebGPU canvas: plate colour plus a 5 MB float depth file, live objects drawn by WebGPU. It worked (0.7 to 2.8 ms GPU at rest) but lost Cuso's shader patches and the post effects.
- The shipped version (above) composites in WebGL instead: no depth file (the city's own geometry gives depth and catches shadows), and the post chain applies to everything.
- Gotchas found: the camera eases in and never lands twice the same (bake only once it is still, match with a tolerance, snap); the pointer parallax moves the camera off the plate; a bake must hide the HUD, speech bubbles and the dev badge.
