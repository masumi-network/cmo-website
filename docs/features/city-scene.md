# F02 · City scene

Last updated: 2026-10-12 · Status: v0 (art passes 1 to 4 done) · Launch blocker: real-phone performance, final polish

## What it does
- A miniature San Francisco in three.js (React Three Fiber).
- Time of day drives the sun, sky, fog, window lights, street lamps and bridge lights.
- Hills: Russian Hill (under the 06:00 rooftop), Nob Hill, Telegraph Hill, Twin Peaks (two peaks), Pacific Heights. Streets climb them straight up, never steeper than 0.36.
- Parks: Golden Gate Park, Twin Peaks, Pioneer Park on Telegraph Hill (Coit Tower), Dolores Park. Grass only grows in parks.
- Street grid with sidewalks and parks. Pastel Victorian row houses (bay windows, cornices, gable roofs). Downtown and SoMa towers in glass or stone.
- Life: 7 Teslas (5 sedans, a Cybertruck, a Roadster) on two block loops, sailboats with wakes and a ferry on the bay, Alcatraz with its lighthouse.
- Landmarks: Russian Hill rooftop, Hayes Valley shop, Mission wall, Union Square billboard, Transamerica Pyramid, Coit Tower, Ferry Building, California St and Union Square cable cars, Embarcadero pier, Bay Bridge, Golden Gate, and a fog bank off the ocean.

## How it works
- `src/lib/terrain.ts`: `heightAt(x, z)`, a sum of smooth elliptical domes that are exactly flat outside their radius. Everything on the ground uses it, including chapter spots (`at()` in `day.ts`). Hill sizes keep every street under `MAX_STREET_GRADE` (tested); the steep tops sit in parks.
- `grid.ts`: streets, `PARKS` (whole blocks) and `groundAt(x, z)` (street, sidewalk, grass or block). A park closes the streets inside it, so a street that reaches a park ends at a T junction with a kerb. The ground texture paints exactly `groundAt`.
- `layout.ts`: pure and seeded. Blocks, houses, towers, trees, lamps. Buildings sit level with their highest corner (nothing sunk); the footing covers the drop on the downhill side. It keeps streets, landmarks (`CLEAR`) and every camera's line of sight (`blocksView`) free. Nothing near the pyramid grows taller than it.
- `materials.ts`: textured materials (shader patches on `MeshStandardMaterial`). Houses show one of six real Painted Lady fronts from an atlas on the street side and tinted lap siding elsewhere; towers repeat glass or limestone facades in world units; roofs get shingles; the ground blends asphalt, sidewalk and grass by the street mask; lawns are a muted green with dry golden patches (the headlands texture), worn to dirt on steep slopes. Night windows light up where the texture has dark glass.
- `facade.ts`: the older procedural window shader (now only Alcatraz) and `facadeNight`.
- Textures: `public/textures/*.jpg` (about 4.4 MB), generated with Codex from `design/prompts/textures/`.
- `city.tsx`: renders the layout with instanced meshes (a few draw calls for the whole city). The ground is a displaced plane with one canvas texture (`groundTexture` in `textures.ts`); the shore cliffs are an extrusion whose top follows the hills (Telegraph Hill meets the bay as a cliff). Buildings have a footing below ground so slopes never show gaps. Fog is unlit and tinted by time of day.
- `landmarks.tsx`: named places sit on the grid. Signs show the visitor's brand. Landmark buildings use the same facade shader. Detail parts are merged into one geometry per material.
- `parts.tsx`: small shared pieces (`Box`, `useGlow`, `useBrand`).
- `cable-car.tsx`: the double-ended California St car (merged geometry, follows `heightAt`) and its rails with the cable slot. `CAR.step` is the running board Cuso rides at 18:00.
- `pier.tsx`: the 22:00 Embarcadero pier: instanced planks, pilings and bracing, lamp, laptop, mug.
- `traffic.tsx`: 7 cars on two clockwise loops (`LOOPS`), seeded. Cars on a loop share one speed, keep a gap (per car length), and stop for Cuso. One instanced mesh per car model and material (22 draws); wheels are their own instances and roll by the distance each car really drove; a soft contact shadow under each car.
- Car models: `public/models/cars/*.glb`, made by `node scripts/convert-cars.mjs` from the raw files in `3d-assets-raw/` (gitignored). It installs pinned `@gltf-transform/cli` and `occt-import-js` outside the project, sorts parts into named materials, drops logos, normalises size and axes, simplifies and meshopt-compresses (about 100 KB a car). Licences of the source models are not confirmed yet (launch blocker).
- `trees.tsx`: four kinds (London plane and ficus on streets, Monterey cypress and palms in parks), clumpy canopies with a leaf texture and baked shading, bark trunks. Two instanced meshes per kind.
- `coit-tower.tsx`: fluted column, observation arches, crown, lobby, on a level stone plaza set into the hill (`coitSeat`). Windows glow at night.
- `bay.tsx`: the water (standard material with a shader patch: ripples, fresnel, sun glint, shallows and shore foam from a distance field baked at load, day to night colour), a planar mirror in full mode, the sailboats (lofted hulls, sail trim from a west wind, heel, wakes), the ferry, Alcatraz and Treasure Island. Boat routes are functions of time and tested to stay on water.
- `atmosphere.tsx`: `lightingAt(hour)` every frame; also drives `facadeNight`.
- Post effects (full mode): bloom, tilt shift, a little saturation, vignette, ACES. Phones and weak machines get "lite": no mirror on the water, no tilt shift.

## Acceptance
- Layout tests: seeded, on land, streets free, landmarks and views clear (with real heights), pyramid is the tallest nearby, never on Cuso's spot.
- Terrain tests: rooftop on Russian Hill, rails and street-level places flat, every spot on the ground, every street at most 0.36 steep, each named hill has a summit.
- Ground tests: parks are whole blocks, open hilltops are parks, no grass on an open street or sidewalk, streets connected with no dead ends into grass, cars and Cuso never on park grass, trees never on the road, buildings never sunk and their footing covers the slope.
- The canvas renders and the page reports `data-scene="ready"` (e2e). Screens for every chapter in `screenshots/`.

## Art pass log
- **Pass 1 (2026-10-12):** street grid, row houses, tiered towers, facade shader, trees and lamps, fog bank, color grade. Landmarks moved onto the grid. Newsletter shot now looks west down California St into the sunset.
- **Pass 2 (2026-10-12):** hills with streets climbing them; buildings on slopes; cars, sailboats, Alcatraz; hero turned north-east over the bay (Alcatraz, Coit Tower) with sky behind the headline; 18:00 shot shows the branded cable car; fog no longer turns to dark smoke; softer night windows.
- **Pass 3 (2026-10-12):** real textures everywhere: Painted Lady facades, siding, shingles, glass and limestone towers, asphalt, sidewalks, grass; textured landmarks (Edwardian apartment under the hero, Hayes Valley shopfront with the brand on its sign band, a wall of real coffee posts, precast pyramid, limestone Union Square and Ferry Building); detailed Golden Gate (stepped towers, cables, suspenders, truss); 06:00 shot now has the Golden Gate behind Cuso.
- **Pass 3b (2026-10-12):** Marin Headlands as rolling ridged terrain with a golden grass and scrub texture (darker on steep slopes), a cove where the Golden Gate lands; the bridge in riveted International Orange steel with a road deck.
- **Pass 3c (2026-10-12):** both bridges tied to the land: the Golden Gate approach down into the city grid, a graded road from its north end into the headlands (cut and fill: the hills are carved around it), and an elevated Bay Bridge ramp into SoMa (`roads.ts`). The Bay Bridge rebuilt like the Golden Gate in grey riveted steel (X-braced towers, cables, suspenders, truss) with its light sculpture. Railings on both decks; suspender ends hidden inside the deck. Shore cliffs as a concrete sea wall; Treasure Island grassed. AO post effect removed (dark halos on thin distant edges, and it hid the fog).
- **Pass 4 (2026-10-12):** rendering refinement of every stop, one agent per part:
  - Cuso's stops: rooftop parapet and cornice; Hayes Valley shop with a lit interior, framed sign and gooseneck lamps; mural posts as printed cards (one mesh); Union Square billboard frame and lamps; Transamerica Pyramid with a constant taper, slit windows and the spire behind Cuso; Ferry Building arcade and clock tower with glowing clock faces.
  - Cable car: real double-ended car (maroon and cream, gold trim, open benches, brass poles, bell, headlamp, trucks), rails with the cable slot. At 18:00 Cuso now rides its running board.
  - Pier: plank deck, pilings with a wet band, bracing, railing, cast-iron lamp with a light pool, a real laptop with Cuso's chart, a mug with steam.
  - Traffic: down from dozens of boxes to 7 cars, pitched on hills (procedural Tesla-like bodies, replaced in pass 5 by the real models).
  - Bay: water shader with planar mirror, shore foam and shallows; lofted sailboats with trim, heel and wakes; a ferry; rocky Alcatraz with a lighthouse beam.
  - Pyramid base narrowed to 3.4 so it stays off the street where the cars drive (tested).
  - Collision pass: Cuso no longer passes through anything (`collision.test.ts`). Landmark dimensions are exported for it (`ROOFTOP`, `UNION`, `FERRY`, `SPIRE`, `FLAG`, `WINGS`, `CAR.body/roof/board`, `RAIL`). The rooftop's north wall moved out to z -13.6 so Cuso can turn on his spot. The pyramid spire now rises from the north face just past the platform (to Cuso's left at 15:00), the flag hangs higher. The Union Square scissor lift is gone (his feet were in it) and its cable car is parked between the two places he crosses the rails.
- **Topography (2026-10-12):** grass no longer covers streets. The hilltop grass was painted as circles over the street map, and Twin Peaks and Coit Tower sat on streets. Now the open hilltops are park blocks (Twin Peaks, Pioneer Park), streets inside a park are closed (T junctions, no lane marks into the park), hills are smooth domes sized so no street is steeper than 0.36, the sea wall rises with the ground, houses sit on their highest corner, and lawns are calmer (muted green, dry patches, dirt on steep parts). Tests: `ground.test.ts`, grade and summit tests in `terrain.test.ts`.
- **Pass 5 (2026-10-12):**
  - Collision: Cuso jumps up beside walls and hops over cornices and parapets instead of through them; `collision.test.ts` walks every route against every solid. The Union Square cable car is parked so he never walks through it; the Pyramid spire moved to the north face.
  - Real car models replace the procedural ones; wheels roll.
  - Textured trees in four kinds; Coit Tower rebuilt and seated on its hill; the speech bubble never goes under the top bar.
- **Next:** real phone performance check (iOS Safari, Android Chrome); people on sidewalks (scale vs Cuso to decide); a modelled diorama kit if we want to go past procedural.

## Gotchas
- Sun azimuth: 0 = south, 90 = east, 180 = north.
- Screenshots in headless Chrome: it pauses requestAnimationFrame without input, so scripted scrolls do not update the scene. Move the mouse while waiting (see `docs/VERIFY.md`).
- Facade hash: only hash exact per-cell values. Interpolated normals or wall-plane coordinates make windows flicker per pixel (the hash amplifies tiny errors).
- `react-hooks/immutability` lint rule is off in `src/scene/**`: R3F mutates three.js objects in `useFrame` by design.
- three r186 removed soft PCF shadows; we use `shadows="percentage"`.
- Do not add `BrightnessContrast` to the post chain: on a real GPU it turned the near half of the Golden Gate black (found by toggling effects one by one; likely negative colour values before tone mapping). Headless Chrome does not show it.
- A negative number raised to a fractional power in geometry code gives NaN, and one NaN vertex blanks the whole screen through bloom. `bay.test.ts` checks every bay mesh for finite values.
- The water finds the sky dome by how `atmosphere.tsx` builds it (drawn first, inside-facing, uniforms `top` and `horizon`). If that changes, the water falls back to fog colours and the sky shows up in the mirror again.
- Close-ups for art work: in dev, `?cam=px,py,pz,tx,ty,tz` pins the camera (see `camera-rig.tsx`). It is ignored in production.
