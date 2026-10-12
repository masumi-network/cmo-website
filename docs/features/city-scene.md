# F02 · City scene

Last updated: 2026-10-12 · Status: v0 (art pass 1 done) · Launch blocker: art pass 2

## What it does
- A miniature San Francisco in three.js (React Three Fiber).
- Time of day drives the sun, sky, fog, window lights, street lamps and bridge lights.
- Street grid with sidewalks and parks. Pastel Victorian row houses (bay windows, cornices, gable roofs). Downtown and SoMa towers in glass or stone.
- Landmarks: Russian Hill rooftop, Hayes Valley shop, Mission wall, Union Square billboard, Transamerica Pyramid, Coit Tower, Ferry Building, California St and Union Square cable cars, Embarcadero pier, Bay Bridge, Golden Gate, and a fog bank off the ocean.

## How it works
- `layout.ts`: pure and seeded. Street grid, blocks, houses, towers, trees, lamps. It keeps streets, landmarks (`CLEAR`) and every camera's line of sight (`blocksView`) free. Nothing near the pyramid grows taller than it.
- `facade.ts`: a shader patch on `MeshStandardMaterial` that draws windows from world position (sizes never stretch). Glass towers use curtain walls. At night a random share of windows lights up.
- `city.tsx`: renders the layout with instanced meshes (a few draw calls for the whole city). The ground is one canvas texture (`groundTexture` in `textures.ts`).
- `landmarks.tsx`: named places sit on the grid. Signs show the visitor's brand. Landmark buildings use the same facade shader.
- `atmosphere.tsx`: `lightingAt(hour)` every frame; also drives `facadeNight`.
- Post effects (full mode): AO, bloom, tilt shift, a little saturation and contrast, vignette, ACES. Phones and weak machines get "lite": no AO, reflections or tilt shift.

## Acceptance
- Layout tests: seeded, on land, streets free, landmarks and views clear, pyramid is the tallest nearby, never on Cuso's spot.
- The canvas renders and the page reports `data-scene="ready"` (e2e). Screens for every chapter in `screenshots/`.

## Art pass log
- **Pass 1 (2026-10-12):** street grid, row houses, tiered towers, facade shader, trees and lamps, fog bank, color grade. Landmarks moved onto the grid. Newsletter shot now looks west down California St into the sunset.
- **Pass 2 (next):** hero shot (06:00) needs a richer foreground and city below the rooftop; hills under neighbourhoods; cars and people for life; cable car visible in the 18:00 shot; real phone performance check.

## Gotchas
- Sun azimuth: 0 = south, 90 = east, 180 = north.
- Facade hash: only hash exact per-cell values. Interpolated normals or wall-plane coordinates make windows flicker per pixel (the hash amplifies tiny errors).
- `react-hooks/immutability` lint rule is off in `src/scene/**`: R3F mutates three.js objects in `useFrame` by design.
- three r186 removed soft PCF shadows; we use `shadows="percentage"`.
