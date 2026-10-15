# F12 · Photo-real mode (v0)

Last updated: 2026-10-15 · Status: v0, on by itself on capable desktops · Launch: ok

## What it is
- On desktop, each chapter's rest view shows as a pre-traced plate: the static city path-traced once, at build time, with Cuso, cars, boats and the visitor's brand drawn live on top. Phones and lite mode never get it.
- When it is on (`photorealOn` in lib/plates.ts), first that applies: `?photoreal` (or `?photoreal=0`) for development, `NEXT_PUBLIC_PHOTOREAL=1`, the visitor's setting, and else on by itself where the GPU has a WebGPU adapter (`webgpuCapable`: a software fallback adapter does not count). Plates draw in WebGL; the adapter is only the sign of a capable desktop.
- The settings button in the top bar (desktop, 3D, not lite) holds one switch, "Photo-real light". It is remembered in `localStorage` (`cmo.photoreal`, `on` or `off`); blocked storage means it works for the visit only. Turning it off at rest restores the city at once (`leave` in plates.tsx); turning it on at rest shows the plate in about a second.
- The adapter check is async, so on a capable desktop the mode turns on a moment after load, before the camera first rests.
- In Explore, the map is path-traced live once it comes to rest, and shown the same way (below).
- While scrolling, the city renders as today, but lit by baked light probes: the traced bounce and sky light for the hour, in place of today's flat studio and hemisphere light (below). Screen-space effects were measured and left out: too slow for what they add.
- Team research page: https://claude.ai/code/artifact/02617856-3933-4608-98f4-9c6aa0bfe0ca

## How it works (`src/scene/plates.tsx`, `src/lib/plates.ts`)
- `public/plates/manifest.json` lists one plate per chapter: file, size, hour, and the camera pose it was traced from (zod-checked; a broken file means no plates).
- A plate is 2:1 at 3456 x 1728. The vertical field of view is fixed, so any narrower screen shows its middle; a screen wider than 2:1 gets no plate.
- Colour is linear, divided by `PLATE_RANGE` (2) and sRGB-encoded in an 8-bit WebP. The post chain (bloom, tilt-shift, tone mapping) treats it like the rest of the scene, so plate and live objects match.
- The plate defines the rest view. `plates.tsx` offers the rig the ready plates for the chapter (`rig.plates`, both ends of the leg, since at a chapter the day can read as either). Once the rig's own camera has settled within 60 cm and 5 degrees of one (it never lands twice the same: it follows where Cuso stopped), it glides onto the plate's pose in 0.5 s (`settle` in lib/plates.ts) and lets go when it moves on. At the end of the glide `rig.rest` is set: the plate shows and the water mirror pauses. The pointer parallax is off in this mode.
- Then the plate fades in over the city (0.4 s). At rest the static city is drawn only as a shadow catcher (`splitScene`): its depth hides live objects behind walls, and live objects' shadows multiply onto the plate (static casters off, the plate has their shadows). The sky dome, lines and transparent bits hide; custom shader effects (the fog bank) stay live.
- Moving again restores the city at once. The canvas carries `data-plate` = `off`, `fade` or `rest` for tests.
- Live objects are marked `userData={LIVE}` (shared.ts): Cuso, cars, boats and ferry, cable cars, the Union Square billboard, the shop sign and interior.

## Explore: the map traced live (`src/scene/explore-trace.tsx`, `src/lib/live-trace.ts`)
- Desktop with photo-real on. Once the map has been still 0.3 s (its easing under 5 mm a second, `stepLive`), the static city is traced from the camera's own pose, at three quarters of the screen's resolution with 8 samples, and handed to the plates as a live plate (`rig.live`): Cuso, cars and boats stay live on top and cast their shadows on it, as at a chapter.
- Any drag or zoom drops it: the camera rig holds the camera on the traced pose (`holdsLive`, 5 cm and 1 degree) and lets go the moment the map moves; a trace still running is thrown away. The canvas's `data-plate` goes back to `off` within 50 ms of grabbing the map.
- Traced views are kept (`keepTrace`, the newest 6, about 7 MB each at 1888 x 898): back on a view traced before (Recenter, Explore opened again, panned back) the kept trace shows as soon as the camera is within 5 cm of it, with no trace and no wait for the easing to settle (`findTrace`, `known` in `stepLive`). A trace finishing after the map moved on is kept too. Measured at 1888 x 898: Recenter 2.5 s and Explore reopened 3.3 s from the click, the camera's own flight; a new view 3.9 s from rest.
- A new view still needs a new trace: a trace is a picture from one exact viewpoint, and a pan or zoom changes what is in front of what.
- The tracer's code loads the first time Explore opens (its own Suspense, so the city never blanks), and is set up the first time the map comes to rest: twins, ground bake and BVH, about 2.6 s, the page blocked for part of it. Later traces reuse it.
- 16 samples a pixel, then the OIDN denoiser. Its weights ship in `public/oidn` (3.6 MB, Apache 2.0, checksums in its README) and load with the tracer, the first time Explore opens.
- Not traced: live objects (drawn on top), the fog bank (GLSL). Shadows of far casters are traced as they are (no shadow box), so dawn shadows run long across the water.
- `node scripts/explore-bench.mjs <dir>` (real GPU): opens Explore with photo-real on, times the first and a second trace, checks a drag drops it. `TRACE=<scale>,<samples>` (dev) for the variants below.

From the map coming to rest to the image on screen (1440 x 900, this Mac, 06:00):

| Trace | First (with setup) | Later |
| --- | --- | --- |
| Full resolution, 16 samples + denoiser | 8.4 s | 5.3 s |
| Full resolution, 8 samples + denoiser | 6.6 s | 3.6 s |
| Half resolution, 16 samples + denoiser (soft in the middle) | 5.5 s | 2.6 s |
| Half resolution, 8 samples + denoiser | 5.0 s | 2.0 s |
| Half resolution, 64 samples, no denoiser (before the weights shipped) | 8.3 s | 5.5 s |
| The site with the shipped weights, two runs on 2026-10-15 (a slower GPU state than the rows above) | 7.1 s | 3.4 s |
| The site: three quarters, 8 samples + denoiser, at 1888 x 898 | 7.0 s | 3.9 s |

- Flashes while dragging (fixed 2026-10-15), found by recording every frame (CDP screencast) around a drag:
  - The tracer adds missing normals and tangents to every geometry it reads, the city's own (`generateMissingAttributes`). A tangent changes a normal-mapped material's WebGL shader: after the first trace, meshes coming into view mid-drag compiled shaders mid-frame and the canvas showed blank for single frames. The Explore tracer turns it off (the city has what it needs).
  - The frame a plate lets go, the water's mirror ran before the plates and reflected the white shadow catchers (halos, a ghost bridge). `rig.plateDrawn`: the mirror and the glass probe skip frames the scene is drawn as a plate. The rig also keeps the camera on the live plate one more frame as the rest ends (`liveRest`), so the plate and the mirror switch on a frame that matches.
  - No trace starts while the pointer is down (a pause mid-drag), and one running is dropped when it goes down.
- Gotcha: WebGPU reads textures back with rows 256 bytes apart (16 RGBA float pixels), and three returns the padding as is. A window width that is not a multiple of 16 (1633) showed the trace as diagonal streaks; `unpadRows` strips it (plates, probes and Explore all read back through it). The tracer also resizes to the window before each trace.
- Gotchas: the Explore camera eases in for about a second after a drag; a trace started while it still crept was carried off its pose by the time it showed and dropped at once. Once shown, the rig snaps the camera back onto the pose (a centimetre in one frame): `stepLive` judges a shown trace by distance from its pose, not by speed. The first trace's setup freezes the page for seconds, and the easing jumps in that long frame: a trace that drifted off its pose while running starts over.

## Light probes while moving (`src/scene/probes.tsx`, `src/lib/probes.ts`)
- A grid of probes over the city: 64 x 14 x 54 at 3 m (x -96..96, y -3..39, z -96..66; the chapter cameras sit within 35 m of the middle). Each holds the light arriving from every direction as L1 spherical harmonics (12 numbers), per chapter hour (06, 07, 09, 12, 15, 18, 22; 06:00 tomorrow reuses 06:00).
- Traced without the sun's direct light or the lamps' (rays leaving a probe never meet a punctual light): bounced light and sky only. The raster keeps drawing the sun, lamps and shadows itself. At night the trace's two fill lights (`studioFill`) are added to each probe directly, as the raster's studio light shows them.
- Every lit material gets a small patch at load, desktop only (`patchProbes` in `Ready`, before shaders compile; phones and lite never get it). Where `cityProbesMix` is above 0 the probes' irradiance replaces the environment's diffuse part and the hemisphere light; reflections stay as they are. The hour blends between the two baked hours around it (`hourBlend`), 8 texture reads a pixel. Towards the grid's sides (the last 15%) it fades back to today's light; a narrow 4% fade drew a line. The water is left out: its colour is its reflection, and the probes' sky light showed the grid as a pale square on the bay.
- `<Probes on={photoreal}>` downloads `public/probes/` the first time photo-real is on, then fades the probes in or out in about half a second: the settings switch costs no recompile. Off, the materials draw exactly as today. The canvas carries `data-probes` = `on` or `off` for tests.
- Storage: 8 bits a number, scaled per hour by the 99.9th percentile probe (a few inside glowing things clip), gzipped. Unzipped in the page (`probeBytes`), or taken as is if a host already unzipped it.

Measured (2026-10-15, this Mac, 1440 x 900):

| | Before | After |
| --- | --- | --- |
| Download (desktop, photo-real on) | plates only | + 1.41 MB (`probes.bin.gz`, 4.06 MB unzipped) and a 1 KB manifest |
| Phones and lite | today | today: no patch, no download |
| GPU per frame, chapter views with the city drawn live (median of 480 frames, 7 chapters) | 5.48 ms (switch off) | 5.39 ms (probes on): no measurable cost, views vary by about 1 ms run to run |
| GPU per frame mid-leg, today's code vs probes on (120 frames a leg) | 6.47 ms | 5.33 ms: within the noise of a moving camera |

- Look: shaded sides turn cool and darker like the traced plates (Union Square's towers and parapet), open ground gets blue sky from above and warm bounce from below, night is close to today. Roofs read a little lighter than the trace (probes just above a roof see more sky than the roof does).
- Measure again: `SWITCH=1 FRAMES=480 node scripts/frame-bench.mjs` (plates blocked, photo-real switched on and off on the same frame, EXT_disjoint_timer_query_webgl2).

## Baking probes
- `node scripts/probes.mjs` with the dev server running (`SPP`, default 64). About 7 minutes on this Mac; one GPU browser at a time. Writes `public/probes/probes.bin.gz` and `manifest.json`.
- The lab's `?raytrace=probes` mode (`src/scene/probe-lab.ts`) swaps the tracer's camera for one that starts every ray at a probe: each 8 x 8 tile of a 2000 x 1552 image is one probe, each pixel one equal-area direction cell (`getCameraRayFn`, WGSL). The twins, sky and hour are as for plates.
- Fireflies: a ray off glass or water can catch the sun's glint in one cell. Cells are clamped at radiance 4 before projecting (sky and sunlit walls stay under 2); unclamped, one outlier set 18:00's scale to 1,246 and rounded most probes to zero.
- Probes inside buildings or under the ground: the tracer passes through the back of one-sided surfaces, so they saw open sky and brightened walls blue. Of 16 rays from each probe (three-mesh-bvh raycasts on the tracer's BVHs, every material two-sided for the test), more than 4 meeting a back face means inside: 4,022 probes (8%). Each takes the mean of its outside neighbours, 3 passes (`dilateProbes`).
- The readback comes out upside down; the last tile row is part empty, so its side shows which way up it is (by colour: the copy writes alpha 1 everywhere).
- Re-bake after changing the static city, its materials, or the lighting at an hour.

## Baking plates
- Needs the dev server and a real GPU: `node scripts/plates.mjs <check-dir> [chapters]` (default all 8). About 70 s a chapter at 128 samples, then a check: `<i>-photoreal.png` next to `<i>-today.png`.
- It runs the dev lab's plate mode (`?raytrace=plate&dpr=2`): traced twins of the patched materials, live objects hidden, OIDN denoiser, the scene's fog mixed in linear, then `encodePlate`.
- `CHECK=1` skips the bake and only checks. A chapter whose camera does not settle in 60 s fails with a message instead of hanging.
- The traced sky turns to the fog colour near the horizon (haze), so fogged far water and hills meet it without an edge (a hard line and a cut-off hill showed before).
- Re-bake after changing the static city, its materials, a chapter's camera, or the lighting at its hour. The OIDN weights for the denoiser are in `public/oidn/` (see Denoiser below).

## Which chapters have plates (2026-10-14)
All eight chapters ship. Reviewed against today's frame:

| Chapter | Status | Missing |
| --- | --- | --- |
| 0 (06:00 rooftop, Golden Gate) | ships | |
| 1 (07:00 shop) | ships | |
| 2 (09:00 Mission mural) | ships | |
| 3 (12:00 Union Square) | ships | |
| 4 (15:00 Pyramid) | ships | |
| 5 (18:00 Ferry Building) | ships | |
| 6 (22:00 pier) | ships | |
| 7 (06:00 tomorrow) | ships | a faint band of real dawn shadow from a downtown tower crosses one street; today's shadow box stops short of it |

What made 0, 2 and 3 right (all in the bake, `traced.ts`, `bake-ground.ts`, `raytrace-lab.tsx`):
- Ground: its own shader drawn in uv space and read back as one colour texture (32 texels per unit), on the same geometry (the mask itself had traced as red, green and blue).
- Multi-material meshes split into their visible groups: the cliffs' invisible cap had traced as a mirror over the streets.
- Additive washes and glows are skipped: the mural's black wash had traced as a black box.
- The scene is read again at rest: tree and lamp level-of-detail models switch with the camera.
- Fog: the depth pass sees the twins, and the sky gets haze near the horizon, so no line or cut where far water meets sky.
- The bake waits for the camera to set off before waiting for it to stop (chapter 1 once baked chapter 0's view).
- The bake scrolls by the real section height (`main > section`): the page is taller than 8 sections, so `scrollHeight / 8` landed mid-leg from chapter 4 on and the camera never came to rest.
- The shop (`shop-painted`): its warm emissive is masked to the cafe by `aGlow` in the shader, so the tracer made the whole front glow tan. The twin keeps the vertex colours, gives each `aMat` surface its gloss, and lets only lamp parts (`aGlow` over 1.5) emit.
- Houses on `<Instances>` (the shop's shell) carry `aPalette` per instance, not per vertex: the twin reads it by instance (the shell traced blue, not cream).
- Line tubes (suspenders) are wound to face out: inward sides traced the red cables dark brown.
- Glows that follow the hour (house and downtown lit windows, the café's lamps) are set again by `refresh()` from `buildTwins`: the lab builds twins at load (06:00, no night) and then scrolls to its chapter, so 18:00 windows had traced black. The lab refreshes on every hour change and at rest, then `updateMaterials()`.
- Water: the ripple texture holds wave slopes. The shader only nudges its mirror image by them (slope x 0.6 / (depth + 8)) and calms them with distance, so the twin's normal map is gentle (0.025): at 0.1 it tilted reflections by degrees and swept the bridge lights into zigzag bands (chapter 6), and the tracer reads normal maps without mipmaps. Chapter 0 was re-baked with it: a cleaner bridge reflection, closer to today.
- Shadows as today: at rest the lab leaves casters wholly outside the raster's sun shadow box out of the trace's shadows (`farCasters`, `visibleToShadowRays`). The Bay Bridge had laid a lattice on the water at 15:00 and streaked the city at dawn.
- Trees: the batched trees are traced as plain world-space twins (`batched`): through the tracer's batched path the trunks were lost. The bake draws every tree's near model and gives the leaves a filled sprite (`fillGaps` in tree-textures.ts): the raster keeps far crowns full by boosting mipmapped alpha, the tracer reads the full-size sprite and saw lace.
- Live shadows on the plate (`plates.tsx` catcher): the catchers multiply into the plate one mesh at a time, so a street drawn before the wall in front of it darkened the wall with a car's or Cuso's shadow (the dawn streak on the apartment). At rest each catcher gets a depth-only twin drawn first (`depthProxy`), so only the nearest surface catches. Rules on reach and facing were tried first and did nothing: the cause was draw order.
- Downtown metal (vents, roof decks) traces dark and matte: the raster has no environment for it to mirror, and as metal it mirrored the bright sky (chapter 4's roofs read light).
- Night fill (`studioFill`): the raster also lights everything with a studio environment, day and night. By day the traced sky stands in; at night the trace adds two fill lights by how much night it is (chapter 6's stone and decks had gone dark).
- Stars: at rest the sky dome stays on and draws only its stars, added over the plate's sky (`starsOnly`); the city's depth hides them behind buildings.
- A bake catches the camera wherever the rig eased to: check the plate's pose against today's rest view after baking (chapter 4 landed 0.4 m off once; a re-bake landed exactly).
- Any change to the camera rig can move a rest view off its plate (chapter 3 did): re-run `CHECK=1` for all chapters after one.
- Lamps: a point light sits inside its glass globe, which blocked every light ray in the trace (the raster's lights cast no shadows), so the pier lamp lit nothing. `lightHousings` finds the small meshes a light sits in and the lab sets the tracer's `visibleToShadowRays` false on them (an object flag; the material `castShadow` the docs mention is not read by the WebGPU tracer).
- Tower windows at night: the window tiles light 70% of punched windows and 55% of office panes on average, by floor. That is what the towers show on the GPU at 18:00 (measured: 58 to 80% of panes), not the 40% the shader's hash gives with exact sines. At 40% chapter 5's plate had half today's lit panes and read dark.
- House windows: about half light up at night, warm, by window and house as the shader picks them (the GPU's 32-bit hash picks a similar share, not the same windows).
- Downtown towers (`downtown`): the vertex tint times a generated window tile per surface kind (curtain wall, sash, steel, shopfront; `facade-maps.ts`), laid on the wall grid (`aUv`) with a whole-cell offset per tower and face. Each tile carries colour, roughness and metalness, and the night's lit windows (runs along busy floors) as an emissive map scaled by the hour's night. Flat tops are tar. Landmark stone (`tower`): the facade tile in world units, like bridge steel.

## WebGPU renderer spike (2026-10-15)
Decision asked (team doc): move the whole site to WebGPU, WebGL 2 kept for phones. Verdict so far: the scene itself draws a little faster on WebGPU, but the frame as a whole is slower on the GPU (+27%) and the CPU (2.3x) until the post chain and three's per-draw overhead are dealt with. Nothing ships; this is a lab.

- Dev only: `?raytrace=webgpu` (`src/scene/webgpu-lab.ts`) draws the live city with WebGPU on the lab canvas at the WebGL canvas's pixel ratio and MSAA, shadows on. `node scripts/webgpu-bench.mjs [chapters]` times each chapter (plates blocked, photo-real off): WebGL with timer queries, then WebGPU with timestamp queries on the same frozen frame, then WebGL again.
- Ported to TSL (`portFor`): the row houses (palette, siding, fish scales, stucco, gravel, roof shingles, glass rooms with blinds and curtains, lit windows at night) and the water (two ripple layers, fresnel, sky gradient, a `reflector()` mirror at today's size). Left out: the glass reflection probe (a WebGL cube camera) and the water's shallows and foam.
- Everything else draws as plain standard materials: their GLSL patches do not run on WebGPU (bridge steel and downtown towers show flat). Four GLSL-only meshes are left out entirely (the sky dome and three more `ShaderMaterial`s, the fog bank among them).
- drei's `Environment` (the studio light) is a WebGL texture WebGPU cannot read: without it nights went black. The lab rebuilds it with WebGPU's PMREM.
- Post chain (`postChain`): MSAA, TiltShift2 as its shader (10 taps), saturation +8%, vignette, ACES. Bloom: three's `BloomNode` cost 5.2 ms a frame at any resolution scale; one gaussian blur at an eighth of the buffer, thresholded after, costs about 1.5 ms. A bright-pass texture before the blur drew the whole scene twice.

GPU and CPU ms per frame, means over the 8 chapter views (1440 x 900 at pixel ratio 2, median of 240 frames each):

| | GPU | CPU (render calls) |
| --- | --- | --- |
| WebGL today (scene, shadows, mirror, post) | 6.70 | 1.51 |
| WebGPU, houses + water ported, post chain | 8.53 | 3.44 |
| WebGPU without the post chain | 5.99 | |
| WebGPU without the ports (plain materials) | 8.82 | |

- The GPU clock moves with load: the same view read 3.8 ms in one run and 7.6 ms in another. Only numbers from the same run compare; each chapter is timed WebGL, WebGPU, WebGL again.
- Per part (chapter 3, one run): MSAA about 0.8 ms, tilt shift under 0.1 ms, bloom 1.5 ms (5.2 ms with `BloomNode`).
- CPU: three's WebGPU renderer spends 3.4 ms a frame submitting about 300 draws, against 1.5 ms for WebGL. That is the larger risk on slower laptops.
- Lab only: both renderers share one scene, and WebGL then logs `glMultiDrawElementsANGLE: Insufficient buffer size` for the batched trees.

Next, if we go on: port the rest of the patched materials (about 13 kinds) and the 4 GLSL meshes to TSL, find where WebGPU's post chain spends its extra 2.5 ms, and measure the CPU cost on a slower machine before deciding.

## Lightmaps: measured and set aside (2026-10-15)
- The team doc asked for light baked per chapter hour. Lightmaps on a second UV set were measured first (a dev probe, since removed): xatlas-web took 552 s to unwrap the 332 static meshes (1.9 M vertices; one mesh alone 500 s) and split them into 1.75 M vertices, about 20 MB of UVs, vertex maps and index buffers to ship, all invalid after any geometry change. `xatlas-web` 0.1.0 also takes no options and the tracer's wrapper writes 16-bit indices.
- Decision (Francis, 2026-10-15): light probes instead (above). No second UV set, nothing tied to the geometry, and Cuso and the traffic get the bounced light too. They are softer: no sharp contact shading.
- three r186 ships its own `LightProbeGrid` (L2), but it only adds light and clamps below zero, so it cannot darken shaded corners or stand in for today's ambient: hence the small patch of our own.

## Spike (2026-10-14)
- Dev only: `?raytrace` (`src/scene/raytrace-lab.tsx`) path-traces the live city over the WebGL canvas. R hides the traced image, F freezes the WebGL city, P restarts. Options: `&scale=0.5` (half resolution), `&spp=8` (denoise sooner), `&denoise=0`, `&pose=0` (keep load-time poses).
- `node scripts/raytrace-bench.mjs <dir> 0 3 6` saves today's render, traced shots at 1 to 16 s, and `bench.json`.
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
- Each patched factory records its inputs in `trace-info.ts` (`traceInfo`, a WeakMap): house, world, concrete, water, ground, the shop's paint, downtown, landmark stone.
- Distance fog: a WebGPU depth pass (redrawn at rest) blends the scene's linear fog over the traced image. Lines and GLSL meshes stay out of it.
- At rest (camera still for 300 ms) the lab reads the scene again so Cuso's pose and the cars match: 530 ms on the main thread.
- The renderer asks for the adapter's storage limits: the city needs a 140 MB storage binding, over WebGPU's default 128 MB.

Result: the chapter 0 frame reads as photo-real: steel, stone, houses, water reflections, haze. Gaps: Karl the fog bank (a GLSL shader), the post effects (tilt-shift, bloom, vignette), and a hard line where the fogged ocean meets the clear sky.

Gotchas:
- `updateTransforms()` moves whole objects but never re-uploads a skinned mesh's vertices, so Cuso ghosts. Re-read the scene or keep him in a live raster layer.
- Fog's depth pass must skip lines and points, or the unfogged hills behind them show through as dark stripes.

## Denoiser (2026-10-14)
- OIDN through `oidn-web` 0.5.0. The tracer stops at `?spp=` samples (default 16), then the denoiser runs. `?denoise=0` turns it off.
- Weights ship in `public/oidn/` (since 2026-10-15, for Explore's live trace): `rt_hdr_alb_nrm.tza` and `rt_hdr.tza` (1.8 MB each) from [RenderKit/oidn-weights](https://github.com/RenderKit/oidn-weights), Apache 2.0 (LICENSE.txt beside them, no NOTICE upstream), SHA-256 checked against the Git LFS pointers (README there).
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
