# F02 · City scene

Last updated: 2026-10-12 · Status: v0 (blockout) · Launch blocker: art pass

## What it does
- A miniature San Francisco in three.js (React Three Fiber).
- Time of day drives the sun, sky, fog and night lights.
- Landmarks: Russian Hill rooftop, Hayes Valley shop, Mission wall, Union Square billboard, Transamerica Pyramid, Coit Tower, Ferry Building, California St cable car, Embarcadero pier, Bay Bridge (with lights), Golden Gate.

## How it works
- `scene.tsx`: canvas, environment light, post effects (AO, bloom, tilt shift, vignette, ACES).
- `city.tsx`: land, water (reflections on desktop), hills, about 600 instanced buildings with lit windows at night, hip roofs, trees. Buildings stay out of every camera's line of sight automatically (`blocksView`).
- `landmarks.tsx`: named places. Signs use the visitor's brand.
- `atmosphere.tsx`: reads `lightingAt(hour)` from `src/lib/time.ts` every frame.
- `camera-rig.tsx`: follows chapter shots, lifts over the city between them, parallax with the pointer. Phones get a wider lens.
- Phones and weak machines get a "lite" mode: no AO, no reflections, no tilt shift.

## Acceptance
- The canvas renders and the page reports `data-scene="ready"` (e2e).
- Screens for every chapter in `screenshots/` after `pnpm e2e`.

## Before launch
- Art pass: replace grey boxes with a real diorama kit (modelled in Blender, baked light). Target look = concept renders in `public/concepts/`.
- Performance budget: first 3D frame < 3 s on a mid laptop; 60 fps desktop, 30 fps phone.
- The cold load in dev is slow (shader compile). Measure on the production build and a real phone.

## Gotchas
- Sun azimuth: 0 = south, 90 = east, 180 = north.
- The `react-hooks/immutability` lint rule is off in `src/scene/**`: R3F mutates three.js objects inside `useFrame` by design.
- three r186 removed soft PCF shadows; we use `shadows="percentage"`.
