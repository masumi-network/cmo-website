# F02 · City scene

Last updated: 2026-10-12 · Status: v0 (art passes 1 to 3 done) · Launch blocker: real-phone performance, final polish

## What it does
- A miniature San Francisco in three.js (React Three Fiber).
- Time of day drives the sun, sky, fog, window lights, street lamps and bridge lights.
- Hills: Russian Hill (under the 06:00 rooftop), Nob Hill, Telegraph Hill, Twin Peaks, Pacific Heights. Streets climb them.
- Street grid with sidewalks and parks. Pastel Victorian row houses (bay windows, cornices, gable roofs). Downtown and SoMa towers in glass or stone.
- Life: cars on the streets Cuso and the cameras do not use, sailboats on the bay, Alcatraz.
- Landmarks: Russian Hill rooftop, Hayes Valley shop, Mission wall, Union Square billboard, Transamerica Pyramid, Coit Tower, Ferry Building, California St and Union Square cable cars, Embarcadero pier, Bay Bridge, Golden Gate, and a fog bank off the ocean.

## How it works
- `src/lib/terrain.ts`: `heightAt(x, z)`, a sum of smooth hills. Everything on the ground uses it, including chapter spots (`at()` in `day.ts`).
- `layout.ts`: pure and seeded. Street grid, blocks, houses, towers, trees, lamps. It keeps streets, landmarks (`CLEAR`) and every camera's line of sight (`blocksView`) free. Nothing near the pyramid grows taller than it.
- `materials.ts`: textured materials (shader patches on `MeshStandardMaterial`). Houses show one of six real Painted Lady fronts from an atlas on the street side and tinted lap siding elsewhere; towers repeat glass or limestone facades in world units; roofs get shingles; the ground blends asphalt, sidewalk and grass by the street mask. Night windows light up where the texture has dark glass.
- `facade.ts`: the older procedural window shader (now only Alcatraz) and `facadeNight`.
- Textures: `public/textures/*.jpg` (about 4.4 MB), generated with Codex from `design/prompts/textures/`.
- `city.tsx`: renders the layout with instanced meshes (a few draw calls for the whole city). The ground is a displaced plane with one canvas texture (`groundTexture` in `textures.ts`); the shore cliffs are an extrusion. Buildings have a footing below ground so slopes never show gaps. Cars are instanced and moved every frame. Fog is unlit and tinted by time of day.
- `landmarks.tsx`: named places sit on the grid. Signs show the visitor's brand. Landmark buildings use the same facade shader.
- `atmosphere.tsx`: `lightingAt(hour)` every frame; also drives `facadeNight`.
- Post effects (full mode): AO, bloom, tilt shift, a little saturation and contrast, vignette, ACES. Phones and weak machines get "lite": no AO, reflections or tilt shift.

## Acceptance
- Layout tests: seeded, on land, streets free, landmarks and views clear (with real heights), pyramid is the tallest nearby, never on Cuso's spot.
- Terrain tests: rooftop on Russian Hill, rails and street-level places flat, every spot on the ground.
- The canvas renders and the page reports `data-scene="ready"` (e2e). Screens for every chapter in `screenshots/`.

## Art pass log
- **Pass 1 (2026-10-12):** street grid, row houses, tiered towers, facade shader, trees and lamps, fog bank, color grade. Landmarks moved onto the grid. Newsletter shot now looks west down California St into the sunset.
- **Pass 2 (2026-10-12):** hills with streets climbing them; buildings on slopes; cars, sailboats, Alcatraz; hero turned north-east over the bay (Alcatraz, Coit Tower) with sky behind the headline; 18:00 shot shows the branded cable car; fog no longer turns to dark smoke; softer night windows.
- **Pass 3 (2026-10-12):** real textures everywhere: Painted Lady facades, siding, shingles, glass and limestone towers, asphalt, sidewalks, grass; textured landmarks (Edwardian apartment under the hero, Hayes Valley shopfront with the brand on its sign band, a wall of real coffee posts, precast pyramid, limestone Union Square and Ferry Building); detailed Golden Gate (stepped towers, cables, suspenders, truss); 06:00 shot now has the Golden Gate behind Cuso.
- **Pass 3b (2026-10-12):** Marin Headlands as rolling ridged terrain with a golden grass and scrub texture (darker on steep slopes), a cove where the Golden Gate lands; the bridge in riveted International Orange steel with a road deck.
- **Next:** real phone performance check (iOS Safari, Android Chrome); people on sidewalks (scale vs Cuso to decide); car headlights at night; a modelled diorama kit if we want to go past procedural.

## Gotchas
- Sun azimuth: 0 = south, 90 = east, 180 = north.
- Facade hash: only hash exact per-cell values. Interpolated normals or wall-plane coordinates make windows flicker per pixel (the hash amplifies tiny errors).
- `react-hooks/immutability` lint rule is off in `src/scene/**`: R3F mutates three.js objects in `useFrame` by design.
- three r186 removed soft PCF shadows; we use `shadows="percentage"`.
