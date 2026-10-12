# F03 · Cuso

Last updated: 2026-10-12 · Status: done

## What it does
- The real mascot (`public/models/cuso.glb`) is rigged in the browser and travels the city's streets between chapters: down from the rooftop, along the walking streets, up onto Union Square's roof, a big jump to the pyramid tip, onto the cable car and the pier.
- He moves at his own natural pace behind the scroll: he walks near places (feet locked to the distance walked, so they never slide), dashes the long street stretches like a cursor, and jumps onto roofs. If you jump far ahead (the rail, Ask Cuso) he blinks there like a cursor (a quick pop).
- A lead camera walks ahead of him at a 3/4 angle (we see his face as he comes towards us), following where he really is, then settles into the next chapter's shot once he arrives. It pulls in and rises so a building never blocks the view.
- Standing, nothing moves him as a block: he breathes, shifts his weight, blinks, turns his torso toward your pointer, waves when he arrives, and cheers with a little hop when you approve something. The baked clips in the GLB are no longer used.
- Cars wait when he is in their lane.

## How it works
- `rig.ts`: turns Mesh0 into a `SkinnedMesh` at load time. Bones: root, hips, body, two arms, and thigh, shin, foot per leg. Weights come from where each vertex sits on the flat character (`weightsAt`), with smooth falloffs, so limbs bend like rubber hoses. Idempotent (the GLTF scene is cached).
- `gait.ts`: all poses through the bones, blended by weight: walk cycle (pendulum legs, knee bend on the swing leg, flat feet, lowered arm swing, bob, sway, lean), dash, tucked jump, wave, cheer and a breathing idle with a pointer look. `STRIDE` and `SPEED` are tuned to his short legs.
- `routes.ts`: one path per move (chapter i to i + 1), each segment tagged walk, dash or jump. Each chapter has an approach from a walking street to its spot; between them, Dijkstra on the walking streets (`WALK_X`, `WALK_Z` in `grid.ts`). Street stretches walk 4 units at each end and dash in between. Jumps go over things: onto a tall building he leaps straight up beside the wall to a point above the cornice and parapet (eased: fast off the ground, slowing at the top), then hops over onto the roof; the pyramid jump ends just above the platform edge, then hops to the middle. `FACE` fixes his heading where there is no room to turn: on the cable car step he hops on and rides facing out. The waterfront walking line (x 29) keeps 0.8 off the water, clear of the pier deck and the Ferry Building plinth. `sampleDay(distance)` puts all moves on one line through the day.
- `cuso.tsx`: scroll sets a target distance; Cuso closes the gap at the speed of the segment he is on (or blinks if it is over 70 units), drives the gait, blinks his eyes, and publishes where he is (`rig.travel`) for the camera and his speech bubble.
- `camera-rig.tsx`: blends chapter shots by Cuso's real progress, with the chase cam in between; `keepClear` uses `OBSTACLES` from `layout.ts`.

## Acceptance
- Collision test (`collision.test.ts`): his body (`HULL` in `rig.ts`, five boxes measured from the mesh, turned to where he faces) never overlaps a house, tower or landmark solid (rooftop walls, cornice, parapet, bulkhead; Union Square walls, cornices, parapet, billboard; pyramid body, wings, spire, flag; both cable cars; Ferry Building; pier deck and rail) and never goes under the ground, sampled along the whole day line in both directions (scroll, rail and Ask Cuso all move him along it; far jumps blink onto spots), plus turning to the camera and cheering on every spot. The pyramid spire never stands behind him in the 15:00 shot.
- Route tests: start and end on the spots, walk on land or the pier, on the ground, never through a building, no jumps in the path itself, walking (not dashing) near places, one continuous day line.
- Layout tests: chapter cameras never start inside a building.

## Known limits
- He is flat: from behind, the arrow outline is mirrored. The back of the body is painted dark (`paintBack` in `rig.ts`) so it reads as his back, not a flipped cursor, and the lead camera mostly shows his front.
- Walking streets have no traffic and clear sidewalks; other streets have cars.
