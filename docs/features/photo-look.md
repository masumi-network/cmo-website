# F13 · Photo look

Last updated: 2026-10-15 · Status: v0 · Launch: ok

Make the city read like a photo of a real city, with art direction in the WebGL renderer. Target: `public/concepts/*.jpg` (style prompt `design/prompts/_style.txt`).

Look test first at Union Square 12:00 (chapter `ads`), then rolled out to every chapter, tuned per hour on screen (2026-10-15). `?look=off` shows today's look (post, sky, leaves; not the light).

## Per hour

One key per chapter hour in four tables: `lightingAt` (time.ts), `lookFor` (look.ts), `skyAt` (sky.ts), the leaf tint (foreground.tsx). Between chapters every value blends, so a scroll never pops (tested every 0.05 h).

| Hour | Chapter | Light (elevation, azimuth, sun, ambient) | Look | Sky (cover, haze, fogScale) | What changed on screen |
| --- | --- | --- | --- | --- | --- |
| 06:00 | arrive | 14, 250, #ffa456 at 2.88, 0.4 | `SUNRISE`: warm gain, cool lift, contrast 0.2, fill 0.32, bloom 0.8, Cuso fill 1.2 | 0.3, 0.5, 0.7; hazeHeight -0.15 | The sun sits low in the upper left corner, behind the title (was beside the Golden Gate: it glared in the middle; behind the camera: flat). Rim light on Cuso, long shadows on the roof, blue at the top of the frame. Sun and bloom a fifth lower and a soft light on Cuso's face (see Post). |
| 07:00 | learn | 14, 60, #ffcc98 at 3.5, 0.47 | `MORNING`: gain 1.07 / 1.03 / 0.97, fill 0.45 | 0.3, 0.5, 0.75 | Light rakes across the shopfront. Back and side light left the south-facing shop and street in shade. |
| 09:00 | social | 55, 90, #ffe6c4 at 3.5, 0.45 | `LATE_MORNING`: like noon, a little warmer | 0.28, 0.6, 0.8 | New shot (see Camera): the mural wall lit warm, Cuso white, the near sidewalk in a building's shade. A lower sun (30) or one from the left (95) put the street, wall and Cuso in a building's shadow; from 130 the wall went dark; from 50 Cuso went grey. |
| 12:00 | ads | 54, 50, #fff1dc at 3.9, 0.45 | `NOON` (see Post) | 0.38, 0.6, 0.8 | The look test. |
| 15:00 | seo | 28, 0, #ffe4be at 3.5, 0.45 | `AFTERNOON`: depth of field 1.3, warm | 0.45, 0.5, 0.85 | Towers get a lit and a shaded face; Cuso lit warm white. |
| 18:00 | newsletter | 12, -30, #ff9548 at 3.2, 0.42 | `SUNSET`: gain 1.07 / 0.99 / 0.86, warm lift, fill 0.38 | 0.35, 0.7, 0.75 | Gold light on the cable car, Cuso and the facades (all were in shade). |
| 22:00 | night | moon 60, 0.6, 0.22 | `NIGHT`: gain 1.03 / 1 / 0.98, a blue lift, grain 0.045 | 0.4, 0.35, 0.85 | A calmer blue-violet sky; windows and bridge lights still read; cloud hides about half the stars. |
| 30 (06:00) | join | 8, 240, the 06:00 colours, sun 3.6, ambient 0.42 (tested) | `FINALE`: sunrise, depth of field 1 over 24, contrast 0.24, full bloom, no Cuso fill | 0.3, 0.4, 0.85 | Side light and long shadows over Russian Hill (was flat sepia). |

- **Sun path:** azimuth keys 250, 60, 90, 50, 0, -30, -40 (20:00), 60 (22:00 moon), 230 (26), 240. `lightingAt` blends azimuth as a plain number, so each step stays under 180 numerically (18:00 is -30, not 330). 06:00 to 07:00 turns 190 degrees during the flight; checked mid-scroll, it reads.
- **Sunset and sunrise without a pop:** the scene puts the moon at 38 degrees as soon as elevation drops below 0. The 20 and 26 keys now sit at elevation 0 with almost no light (0.08, 0.05), so the switch happens in the dark. Before, it crossed 0 at about 19.1 h and 29 h with the sun near full strength and the shadows jumped.
- **Shadows:** every day chapter keeps ambient at most 0.14 of the sun (tested).
- **Phones:** grade and grain only; every phone shot checked.

## Post

Code: `src/lib/look.ts` (per-hour table, focus, grade maths), `src/scene/post.tsx` (the effect chain), `src/scene/grade.ts` (grade and grain shader), `src/scene/scene.tsx` (mounts it), `src/lib/time.ts` (12:00 light). Tests: `tests/unit/look.test.ts`.

- **Per-hour table** `lookFor(hour)`, one key per chapter (see Per hour). `TODAY` is only for `?look=off`.
- **Chain (desktop):** depth of field (its own pass), then one merged pass: tilt-shift, bloom, saturation, vignette, ACES, grade. The tilt-shift stays in the merged pass (it sorts first there, as before) and goes to 0 at 12:00; the depth of field takes over.
- **12:00 values:** depth of field 1.5 (focus range 14, half res), tilt 0, saturation 0.05, gain 1.03 / 1 / 0.94, lift 0.02 / 0.015 / 0.01, contrast 0.18, grain 0.035, studio fill 0.38 (today 0.5).
- **12:00 light** (`time.ts`): sun #fff1dc at 3.9, elevation 54, azimuth 50 (from the right, not from behind the camera), ambient 0.45. Shapes and shadows read; the light was flat before.
- **No ambient occlusion (dropped 2026-10-15, Francis):** N8AO cost about 3 ms at 12:00 and only added a little shading under cornices and in window recesses (the camera sits below the roof line). The code is in commit 07df0d2 if a shot needs it later: it faded AO out past 25 to 70 units with a fog of its own during the AO render, and needed transparency detection off. Contact darkening now comes from the materials at no post cost (2026-10-15): undersides and grime at the foot of every building (`weathering.ts`), a soft shade on the ground round each house, tower and landmark (`contactRects` in textures.ts).
- **Depth of field:** focus eases (`stepFocus`) to Cuso's middle while he is in front of the camera and within 40; else to what the camera looks at (flights). It fades out as the camera rises over the city (`overhead`) and is off in Explore. At 12:00 Cuso is sharp, the billboard ad nearly sharp, the towers behind soft.
- **Grade** (after ACES, values 0..1): into a display-like curve (square root), gain and lift, a gentle S curve, grain in the mid-tones only (one CSS pixel, new pattern each frame), back. Never clips the blacks; identity in today's look.
- **Phones (lite):** grade and grain only (no depth of field); the 12:00 light and studio fill apply too.
- **06:00 sun and Cuso (2026-10-15, Francis: "dial down the sun about 20%, add a soft direct light to Cuso"):** the bright sun in the opening shot is its glint on the bay (the water's specular from the sun light), not the sky's disc, which sits above the frame. So the 06:00 sun light is 2.88 (was 3.6) and the bloom 0.8 of full (`bloom` in the look; 0.6 desktop, 0.5 phone at 1). The glint's brightest area shrank about a third; the roof in front of him is about a fifth darker; the warm mood stays. Ambient went 0.42 to 0.4 to keep deep shadows (at most 0.14 of the sun). The finale keeps 3.6 and full bloom: its camera looks away from the sun.
- **06:00 sun in the corner (2026-10-15, Francis: "it's right on my eyes on desktop", then "to the left corner"):** the glare was the sun's glint on the bay at about (340, 610) of 1440x900, left of the south tower. The sun moved from 240 at 8 degrees to 250 at 14: the disc now sits in the upper left corner behind the title (about 150, 180; 130, 160 at 1280x800; 275, 215 at 1920x1080), and the glint drops to the left edge, mostly behind the near building. The middle of the frame is clear, the title and card read, the warm backlight stays. The phone frame no longer shows the sun or the glint. Tried: the sun in the east behind the camera (light on the bridge's face, but the frame lost its warm colour) and the upper right (the glint spread over the bay next to Cuso). Tested in `time.test.ts` on the screen at 1280, 1440 and 1920 wide. The dome draws the disc about 3 degrees under the light's direction (a coarse sphere), so on screen it sits a little lower than the test's projection. The finale keeps 240 at 8: its camera looks away from the sun.
- **Cuso fill** (`cusoFill` in the look, 1.2 at 06:00, 0 at every other chapter, blends by hour): a soft warm light from the camera, a little above and to the right, in Cuso's own shader (`shadeCuso` in rig.ts). No three.js light, so the roof and bridge stay as they were and no shader recompiles. His face went from grey to lit white (desktop face mean 105 to 151 of 255, phone 84 to 160). The finale has none: he is small and lit from the front there.
- **Passes:** always mounted; per frame only uniforms and `enabled` change. Depth of field draws until `Ready` has compiled every shader, then only while it does something (`passOn`): now at every story shot, off in Explore and high over the city.
- **Dev:** `?look=off` shows today's look at every hour.
- **Cost (indicative, M4 Pro, 1440x900 at 1x, other work on the GPU):** depth of field about 2 to 3 ms at a rest shot. It hardly depends on resolution scale (fixed cost of its passes). Per chapter: see Measurements.
- **Tried and dropped:** AO intensity 2.5 with radius 1.6 (invisible); 10 with radius 1.5 (smudges on the facades, reads as dirt); depth of field 2 (towers too soft); lift 0.03 with contrast 0.12 (hazy, washed out); a separate tilt-shift pass (moves bloom after the blur: today's look would change).

## Sky

Code: `src/scene/sky.ts` (dome shader, per-hour table), `src/scene/atmosphere.tsx` (wires it in, fog). Tests: `tests/unit/sky.test.ts`, `tests/unit/atmosphere.test.ts`.

- **Per-hour table** `skyAt(hour)`, one key per chapter (see Per hour). Cloud shape is noon's at every hour, so a scroll changes only cover, shade and haze. `TODAY` (no clouds, no haze) is only for `?look=off`. A negative `hazeHeight` (06:00, finale) brings the blue lower, so a level frame still has blue at the top.
- **12:00 values:** cover 0.38, softness 0.14, scale 1.6, wind 0.02, shade 0.55, haze 0.6, hazeHeight 0.1, fogScale 0.8.
- **Clouds:** the view ray meets a flat deck overhead (`dir.xz / dir.y * scale`), so clouds shrink and crowd toward the horizon. Shape: tileable value noise (`cloudNoise`, 256 px, 32 cells), fbm with an integer turn per octave (the tile still wraps, so no seam), plus a slow patch noise for clusters and clear blue gaps. Shading: a second tap a little lower on screen; more cloud there means the top of a puff (lit), less means the underside (grey). Thick middles a little darker. Clouds fade out below about 0.2 of elevation, into the haze, before the noise gets fine enough to shimmer. Stars only where there is no cloud.
- **Cloud colours** (`cloudColors`): the sun's colour with a touch of sky; dim blue-grey at night; never brighter than the sun.
- **Haze:** the horizon goes toward the distance fog's colour (`horizonColor`), the pale band reaches a little higher (`hazeHeight`), and the story fog comes in to 0.8 of its distance (`fogRange(d, explore, fogScale)`). Explore's fog and the ease down from Explore after a pin are unchanged.
- **Phones:** `OCTAVES` 3 instead of 4 (a define, set once).
- **Dev:** `?look=off` keeps today's sky at every hour.
- **Cost:** about 0.1 to 0.5 ms GPU at the 12:00 rest shot (1440x900, within run noise), 0 draw calls. At other hours the cloud code is skipped by a uniform branch.

Contract with the water (`bay.tsx`): it finds the dome by `renderOrder < 0` and `BackSide`, and reads the uniforms `top` and `horizon`. Keep all four. The dome draws first, writes no depth, and has no fog.

Tried and dropped: soft wide edges (softness 0.3, scale 2.4) read as wispy streaks, not cumulus; shading toward the sun put the grey on the tops at noon (the sun is behind the camera); a whitened cloud colour broke "never brighter than the sun" at sunrise.

## Haze

Code: `src/lib/haze.ts` (constants, the sum in TypeScript), `src/scene/haze.ts` (patches three's fog chunks; imported at the top of `atmosphere.tsx`). Tests: `tests/unit/haze.test.ts`.

- **What:** the air is thickest over the water. Far high ground (the Marin headlands) keeps its silhouette, paler with each ridge, instead of fading to the fog colour by the fog's far distance. The water, the shore and the near city fog exactly as before, so the horizon and the far water seam do not move.
- **Sum** (linear fog only; exp2 fog stays three's):
  - `low = smoothstep(fogNear, fogFar, depth)`: three's fog.
  - `high = min(low, 1 - exp(-max(depth - fogNear, 0) / (reach * fogFar)))`: starts as fast as `low`, then eases off.
  - `fog = mix(low, high, smoothstep(y0, y1, worldY))`.
- **Constants** `HAZE`: `y0` 1 (water and shore below it), `y1` 30 (the headland crests and the Golden Gate tops), `reach` 1.1.
- **World height** in the vertex chunk: `vFogY = dot(viewMatrix[1].xyz, mvPosition.xyz - viewMatrix[3].xyz)` (the view matrix is a rotation plus a move). Any custom shader that includes `fog_vertex` must define `mvPosition` first; only Karl (`fog.tsx`) does, and the test checks it.
- **Patched once at import,** before Ready compiles a shader. Always built from three's own chunks (kept on `globalThis`), so a hot reload does not stack patches. Programs already compiled keep the old sum until a full reload. The patch keeps three's names (`vFogDepth`, `fogNear`, `fogFar`, `fogColor`).
- **On screen:** 06:00 and the finale show the headland ridges in layers behind the Golden Gate (were nearly fogged out). The far Golden Gate tower stays paler than the near one. The 07:00 to 22:00 shots look the same (near city, or no far high ground in frame). Explore hardly changes.
- **Dev:** `?haze=off` keeps three's fog (compiled out in production), for before and after screenshots.
- **Cost:** 0 draw calls, one varying and a few math ops per fragment. Back to back with `?haze=off` (1440x900, 6 runs each, median): 06:00 +0.07 ms, 22:00 +0.25 ms, both inside run noise (runs spread about 1.5 ms).
- **Tried and dropped:** stretching the far distance for high ground (`smoothstep(fogNear, fogFar * (1 + gain * lift), depth)`, the first plan) also cleared mid-distance high things: the far Golden Gate tower went from 55% to 15% fog and looked as dark as the near one.

## Foreground

Code: `src/scene/foreground.tsx` (mounted in `src/scene/union-square.tsx`). Tests: `tests/unit/foreground.test.ts`.

- **What:** out-of-focus leaves close to the lens, in the bottom-right corner of the 12:00 desktop shot, so it reads like a photo taken from behind a tree (like the concept `04-ads.jpg`).
- **Where:** `FOREGROUNDS` lists props per chapter, at most one each, only where the concept has one. One so far, on `ads`: seed 7, depth 1, height 0.28 of the frame, overhang 0.06, opacity 0.96. At 1440x900 its quad covers about x 965 to 1440, y 665 to 900 (under 9% of the frame; the leaves fill part of that).
- **Never covers** Cuso, his bubble, the billboard ad or the chapter card (x < 458), at 4:3 to 2:1 and at every pointer corner. The test checks it.
- **Rides with the camera:** the quad faces the lens and sits in the frame's corner for any fov and aspect (`propPose`), so the boom and the pointer never push it onto Cuso. It drifts a little against the pointer and stirs in the breeze (a few px).
- **Shows only at rest** (`propFade`): full within 0.8 of the shot, gone from 2.0 away, gone when the camera looks more than about 20 degrees away (flights) and in Explore. Phone and tablet shots stand farther off, so they never see it. The opacity eases (no pops after a rail cut).
- **Per-hour tint** `foregroundAt(hour)`, one key per chapter (dark blue at night). A prop shows by its shot alone (`propFade`); the tests check every prop against its own shot, Cuso, his bubble and the card column (on the right at 22:00).
- **06:00 leaves skipped:** concept 01 has some bottom right, but Cuso stands low on the right there: any bough taller than 0.12 of the frame covers him at 4:3, too small to read as leaves. A 0.14 bough fits with camera proposal A2.
- **Texture:** a 512x256 canvas, painted at load. About 34 leaves on a bough from the corner (`leafLayout`, seeded): dark and big nearest the lens, lit and smaller at the tips, a few warm sunlit rims. Pre-blurred (canvas `filter: blur`; near leaves 12 px, far leaves 7 px; a shrink-and-stretch where the filter is missing), so it looks right without depth of field and on lite.
- **Material:** `MeshBasicMaterial`, transparent, no depth write, no depth test, no fog, `renderOrder` 10, DETAIL layer (not in the mirror or the glass probe), no shadows. Always mounted so Ready compiles it; hidden when not shown.
- **With the post stack:** it writes no depth, so depth of field reads the scene behind it and does not blur it twice.
- **Dev:** `?look=off` hides it.
- **Cost:** 1 draw call (one quad) at the 12:00 desktop shot, nothing elsewhere.
- **Tried and dropped:** thin leaves on visible twigs read as a sprig, and the blur washed them out; a dense mound of small leaves read as a hedge.

## Backdrop

Code: `src/scene/skyline.ts` (ridges, towers, mast, lights, per-hour table; pure), `src/scene/backdrop.tsx` (the shader and the lights; mounted in `scene.tsx` after `City`). Tests: `tests/unit/backdrop.test.ts`.

- **What:** the land past the modelled city, so the bay ends in hills, not flat haze (concepts 01, 03, 05, 07). Procedural, 0 KB of assets.
- **Layers** (x east, z south), four meshes for frustum culling:
  - Marin: Mount Tam's ridge (toe z about -390, crest about -450, peak 74 at x -272 with a long western shoulder), behind the Golden Gate's north tower from Russian Hill; the Bolinas ridge farther and paler behind its west end.
  - North Bay: a low, very hazy ridge at z -590 to -660 (behind Alcatraz from the Embarcadero).
  - East Bay: the Oakland and Berkeley shore flats (1 to 3 high) from z 225 to -500 at x 330, the hills behind (crest about x 455, Grizzly Peak 52), 17 tower boxes for Oakland and Emeryville on the flats.
  - Peninsula: Daly City bluffs to San Bruno Mountain, z 150 to 340, low toward the south bay. A Sutro-like mast (three banded red and white legs, two crossbars, three antennas, 29 high) on its hill at (-168, 352): at 09:00 it stands in the sky between the card and the palms.
  - The open Pacific to the west stays open (the 06:00 sun sets there).
- **Shape:** each ridge is a strip along a smooth toe line in the water, a column every 4 units, rows from the toe (under the water) up to the crest and down a back slope. Crest from 1D noise plus named peaks (smooth max), roughened 14%, tapering into the water at both ends; the depth and the inner rows wander, so the slopes have spurs and gullies. 8.9k triangles.
- **Rules (tested):** every toe stands past the story fog's far distance from every chapter camera (desktop and the phone rig), so its foot meets fully fogged water; never over the city, the headlands, an island or a bridge; within the water plane and the far plane; Tam shows over the headland crest from the 06:00, 07:00 and 12:00 cameras; at least 3 degrees under the sun wherever the sun can be in frame; the mast in the 09:00 desktop frame left of the trees; the East Bay and North Bay fill the 22:00 horizon.
- **Shader** (one for every ridge; fog off, opaque, `FrontSide`, `renderOrder` 0 so the water never takes it for the dome): golden grass with scrub patches, pale town blocks on the lower slopes, flat stone or glass on the towers; a noise bump on the normals (gullies catch the light); half-wrapped sun and sky light from the dome's own uniforms. Then aerial perspective: haze grows with distance from the city (280 to 700), toward the sky's horizon colour, bluer for far ridges (a share of the sky's top colour), plus a glow toward the sun (`pow(dot(view, sun), 8)`). The foot fades to the fog colour (no seam with the water).
- **Never clearer than the headlands in front:** the haze keys keep the Marin ridges paler than the modelled headland crest (with the height-aware haze, see Haze). Checked on screen at 06:00 and 12:00.
- **Night lights:** one `Points` draw, 2418 points (lite the same, cap 2500; desktop cap 3000): a jittered street grid on the East Bay flats, sparse lights up the lower slopes, windows on the towers, two blinking red lights on the mast (the only ones that blink). 2.4 px times the pixel ratio, additive, depth tested, dimmer with distance. Depth of field turns them into soft bokeh on desktop.
- **Shown in the story, gone in Explore:** `backdropFade` is 1 minus `overhead` (the camera's distance to what it looks at), 0 in Explore; it eases, so a mode switch never pops. Explore screenshots are the same with and without it.
- **Per hour** `backdropAt(hour)`, keyed like `skyAt`, blends every 0.05 h without a pop; the finale is 06:00:

| Hour | hazeNear | hazeFar | blue | glow | lights | On screen |
| --- | --- | --- | --- | --- | --- | --- |
| 06:00 | 0.53 | 0.8 | 0.3 | 0.9 | 0 | Tam behind the north tower and mauve ridges in layers to the right, paler than the headlands in front. |
| 07:00 | 0.5 | 0.78 | 0.3 | 0.5 | 0 | Hidden by the houses in the chapter shot. |
| 09:00 | 0.32 | 0.7 | 0.3 | 0.3 | 0 | The mast on its hill at the end of the view, like concept 03. |
| 12:00 | 0.36 | 0.7 | 0.3 | 0.25 | 0 | Mostly behind the buildings; Tam pale behind the headlands in a wider view. |
| 15:00 | 0.36 | 0.7 | 0.3 | 0.35 | 0 | Phone: the East Bay hills with gullies and Oakland's towers across the bay (desktop looks down). |
| 18:00 | 0.46 | 0.76 | 0.3 | 0.9 | 0 | Backlit Peninsula and mast to the south-west (behind the chapter camera). |
| 22:00 | 0.5 | 0.7 | 0.2 | 0.2 | 1 | Violet East Bay and North Bay hills, a little darker than the sky, with town lights. |
| 30 | as 06:00 | | | | | The finale's shots look down: the horizon is above both frames. |

- **Dev:** `?backdrop=off` hides it (compiled out in production), for before and after screenshots.
- **Cost:** 4.6k to 6.2k triangles and 2 to 4 draw calls where it is in frame (+1 at night), nothing in the shadow map, the water mirror or the glass probe (DETAIL layer). Back to back with `?backdrop=off` (1440x900, 3 runs each, GPU median): 06:00 24.55 off, 24.5 to 24.9 on; 22:00 21.7 off, 21.4 to 21.8 on: inside run noise.
- **Tried and dropped:** a thin mast (legs 0.36) vanished in the depth of field; the mast behind the 09:00 trees did not read; Gaussian peaks read as smooth domes (now roughened, Tam with a shoulder); haze 0.46 at 06:00 left the far ridges clearer than the headland crest in front.

## Camera

- **12:00 desktop shot (2026-10-15):** `frame([5.6, UNION_SQUARE_ROOF, 10.4], { yaw: 36, distance: 17.5, height: 1.5, look: 1.1, side: 0.3 })` in `src/content/day.ts`. South-east of Cuso, just over the roof. Past him and the billboard you see the Golden Gate in the haze, the Marin hills, a strip of bay and a street of painted houses. Before, it looked up at two near towers from the next roof.
- **Test:** `tests/unit/framing.test.ts` checks the Golden Gate's south tower is in frame, right of the card column, with a clear line of sight.
- **Phone shot unchanged:** turning it to match breaks the "ad words stay readable, clear of the bubble" tests.
- **Why not closer to the concept:** the ground around Union Square is flat (no downhill street), the board faces south (so the background is to the north), and the Bay Bridge and Transamerica can never sit behind a readable board. Matching the concept would mean re-siting the billboard over a downhill street.
- **Gotcha:** `blocksView` (layout.ts) removes towers on each shot's camera-to-target line, and towers draw random numbers only when kept, so a new shot can reshuffle the skyline. This shot leaves the city unchanged (15 towers).
- **Proposals for the other chapters (2026-10-15, not applied, waiting for Francis):**
  - 06:00 arrive, A2: `{ yaw: 30, distance: 11, height: 3.6, look: 2.4, side: 0.32 }`. Down over the houses to the whole bridge with the sun beside it, like concept 01. Towers unchanged. Cuso smaller; a roof stair hut sits under the cards.
  - 07:00 learn, L2: `{ yaw: 40, distance: 7, height: 1.0, look: 1.6, side: 0.3 }`. Along the sidewalk, shop on the right, the street running away on the left, like concept 02. Reshuffles the city (still 15 towers, different houses and trees).
  - 09:00 social: **applied 2026-10-15 (Francis)**, `{ yaw: 135, distance: 7.5, height: 0.9, look: 1.5, side: 0.28 }`. Low, along the sidewalk: the mural wall runs away on the right, the street and palms on the left, like concept 03. Towers unchanged (15). The street ends at the land's edge in haze; the concept's Sutro Tower hill is not there. Phone shot unchanged. Avoid yaw 100 (14 towers).
  - 15:00 seo: keep, or A `{ yaw: 265, distance: 14, height: 4, look: 0.5, side: 0.25 }` for the Bay Bridge and a horizon like concept 05 (fewer roofs, a flat pale sky band; wants a sky pass first). Towers unchanged.
  - 18:00 newsletter, option 1: `{ yaw: 285, distance: 8, height: 1.4, look: 1.7, side: 0.3 }`. Down the street past the car to the Ferry Building and the gold water. Needs `FACE.newsletter` (routes.ts) turned toward the lens (about -1.0 to -1.3), and reshuffles downtown (16 or 17 towers).
  - 22:00 night, option 1: `{ yaw: 340, distance: 11, height: 1.1, look: 2.2, side: -0.38 }`. Out over the water: the bridge reads as a lit line, not a wall of dots; the Ferry Building tower, the lamp and the water in frame. Towers unchanged. Cuso smaller (30% of the frame height, was 46%).
  - Finale join, J1: `{ yaw: 33, distance: 5.5, height: 1.0, look: 1.5, side: 0.3 }`. Close on Cuso with the bridge and the low sun behind him, like concept 09. Towers unchanged; loses the wide goodbye shot and repeats 06:00.
- **Not used:** a longer lens (needs a per-shot fov in camera-rig.tsx; fov 26 to 30 hits towers), a long-lens shot down Nob Hill (removes the glass tower, breaks 4 tests, the bubble covers the ad).

## Measurements

Look test, 2026-10-15. Union Square at rest, 1440x900, DPR 1, headed Chromium on an M-series Mac (Metal), GPU timer queries over 10 s, 3 runs each, back to back in one session. "Before" is `?look=off` (same code, today's look).

| | GPU mean | Draw calls | FPS |
| --- | --- | --- | --- |
| Before, run 1 | 6.2 ms | 218 | 120 |
| After | 11.6 ms | 238 | 120 |
| Before, run 2 | 4.8 ms | 218 | 120 |

- The look costs about +6 ms GPU at 12:00 on desktop. Ambient occlusion is about 3 ms of that, depth of field 2 to 3 ms, sky and leaves under 0.5 ms.
- CPU time did not change (1.6 ms).
- Other hours and phones: no measurable change (passes off, grade only).
- The GPU clock swings about 1.5 ms between runs: compare runs from one session.
- Ambient occlusion was then dropped (see Post): it showed only under cornices and in window recesses here.
- Without it, same method, same day: before 6.1 to 7.3 ms (216 to 219 draw calls), after 9.0 ms (232 draw calls). About +2.4 ms GPU at 12:00 on desktop, CPU unchanged, 120 fps held.
- New 12:00 shot, same method: look off 9.2 ms (286 draw calls), look on 9.6 to 11.3 ms (299). The wider view itself costs about 2.6 ms over the old shot (more city in frame); the look adds about 1 ms there. 120 fps held.
- The biggest gap left to the concept is the shot itself: the concept looks down a hill at the skyline and the bay. Ours looks up at the billboard from the next roof.

### Per chapter (2026-10-15, every hour tuned)

Same method: each chapter at rest, 1440x900 DPR 1, headed Chromium (Metal), 2 runs x 8 s per label, back to back: `?look=off`, look on, `?look=off` again. `?look=off` turns off the post look, sky and leaves, not the light (time.ts), so it times the same shot and shadows.

| Chapter | Look off (GPU mean) | Look on | Look off again | Draw calls off / on |
| --- | --- | --- | --- | --- |
| 06:00 arrive | 6.5 to 6.6 ms | 8.6 to 8.8 ms | 6.5 to 6.9 ms | 260 / 272 |
| 07:00 learn | 9.0 ms | 11.5 to 12.8 ms | 8.9 to 9.0 ms | 273 / 285 |
| 09:00 social | 7.9 to 8.0 ms | 10.6 ms | 8.0 to 8.1 ms | 175 / 187 |
| 09:00 social, new shot | 7.9 to 9.4 ms | 8.9 to 9.6 ms | | 153 to 161 / 173 |
| 12:00 ads | 8.3 to 9.2 ms | 9.8 to 10.3 ms | 8.3 to 8.4 ms | 286 / 299 |
| 15:00 seo | 4.1 to 4.2 ms | 7.0 to 7.4 ms | 4.0 to 4.1 ms | 166 / 178 |
| 18:00 newsletter | 8.0 to 8.3 ms | 10.4 to 11.5 ms | 8.1 to 8.3 ms | 293 / 305 |
| 22:00 night | 4.4 to 4.9 ms | 7.5 to 8.5 ms | 4.3 to 5.4 ms | 284 / 296 |
| join (06:00) | 7.2 to 7.4 ms | 9.4 to 9.5 ms | 7.2 to 7.4 ms | 225 / 237 |

- The look costs about +2 to +3 ms GPU at every chapter on desktop, mostly depth of field (a fixed cost of its passes). 12 more draw calls (the passes and the sky).
- CPU unchanged (1.5 to 2.0 ms). 120 fps held everywhere.
- Phones: grade and grain only, no measurable change.

