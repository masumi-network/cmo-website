# F12 · Photo-real mode (removed)

Last updated: 2026-10-15 · Status: removed · Launch: ok

## Decision
- Francis, 2026-10-15: photo-real adds little for its download and upkeep. Removed, not hidden behind a flag.
- The WebGPU migration is paused. The site keeps the plain WebGL renderer.

## What was removed
- Pre-traced chapter plates at rest (`public/plates`, 2.3 MB).
- The Explore map traced live, with the OIDN denoiser weights (`public/oidn`, 3.5 MB).
- Baked light probes while moving (`public/probes`, 1.4 MB) and the shader patch that read them.
- The tracer core and the material info it read from every factory (houses, towers, ground, water, trees, the shop).
- The `?raytrace` dev labs (path tracer, probe bake, screen-space effects, WebGPU renderer) and their bench and bake scripts.
- The settings button in the top bar. Its only switch was "Photo-real light", so the whole popover went.
- The flag: `?photoreal`, `localStorage` `cmo.photoreal`, `NEXT_PUBLIC_PHOTOREAL`.
- Packages: `three-gpu-pathtracer`, `three-mesh-bvh`, `oidn-web`, `xatlas-web`.
- Hooks in shared code that only served plates: the camera's glide onto a plate and its live hold, the water mirror and glass probe pausing at rest, the `LIVE` tag, the sky dome's stars-only switch.

## Why it was safe
- It was opt-in by GPU: phones, lite and no-3D visitors never had it. Everyone else drew the WebGL city while moving anyway.
- Nothing outside photo-real used the removed code (checked by search, lint, typecheck and the unit tests).
- One visible change: the pointer parallax is back on desktop. Photo-real had turned it off to hold the camera on a plate.
- `tests/unit/photoreal-removed.test.ts` fails if the packages, files or flag come back.

## What replaces it
- Nothing. The next step is a look pass on the WebGL renderer.
- `scripts/frame-bench.mjs` stays (now under F02) to measure it: `CHAPTERS=ads node scripts/frame-bench.mjs "look test"`.

## Numbers worth keeping
- WebGPU renderer spike: the frame was slower on WebGPU, +27% GPU and 2.3x CPU (three's per-draw cost: 3.4 ms against 1.5 ms for about 300 draws).
- Light probes cost no measurable GPU time (5.48 ms off, 5.39 ms on, within the noise) but added 1.41 MB.
- Lightmaps were set aside first: xatlas took 552 s to unwrap the static city and would have shipped about 20 MB.
- The full notes are in git history: `docs/features/photoreal.md` at commit `9f07e66`.
