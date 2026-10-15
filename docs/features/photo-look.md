# F13 · Photo look

Last updated: 2026-10-15 · Status: planned · Launch: ok

Make the city read like a photo of a real city, with art direction in the WebGL renderer. Target: `public/concepts/*.jpg` (style prompt `design/prompts/_style.txt`).

Look test first: one chapter, Union Square at 12:00 (chapter `ads`). Every other hour keeps today's look until it is tuned.

## Post

Code: `src/lib/look.ts` (per-hour table, focus, grade maths), `src/scene/post.tsx` (the effect chain), `src/scene/grade.ts` (grade and grain shader), `src/scene/scene.tsx` (mounts it), `src/lib/time.ts` (12:00 light). Tests: `tests/unit/look.test.ts`.

- **Per-hour table** `lookFor(hour)`, keys like `lightingAt`. Only 12:00 (`NOON`) is tuned; 06:00, 09:00, 15:00 and later are `TODAY`, so 09:00 to 12:00 blends the look in and 12:00 to 15:00 blends it out. At untuned hours the picture is today's, pixel for pixel (checked at 09:00 against `?look=off`: only moving things differ).
- **Chain (desktop):** N8AO, then depth of field (its own pass), then one merged pass: tilt-shift, bloom, saturation, vignette, ACES, grade. The tilt-shift stays in the merged pass (it sorts first there, as before) and goes to 0 at 12:00; the depth of field takes over.
- **12:00 values:** AO 6 (radius 3, distance falloff 0.6, half res, 16 samples, 8 denoise samples), depth of field 1.5 (focus range 14, half res), tilt 0, saturation 0.05, gain 1.03 / 1 / 0.94, lift 0.02 / 0.015 / 0.01, contrast 0.18, grain 0.035, studio fill 0.38 (today 0.5).
- **12:00 light** (`time.ts`): sun #fff1dc at 3.9, elevation 54, azimuth 50 (from the right, not from behind the camera), ambient 0.45. Shapes and shadows read; the light was flat before.
- **AO only near the camera:** n8ao fades AO by the scene fog, so during its render the scene gets its own fog (25 to 70). No dark halos on far thin edges and the distance fog stays clean (the old AO pass failed on both). Transparency detection is off (it walks the scene and renders it twice more each frame).
- **Depth of field:** focus eases (`stepFocus`) to Cuso's middle while he is in front of the camera and within 40; else to what the camera looks at (flights). It fades out as the camera rises over the city (`overhead`) and is off in Explore. At 12:00 Cuso is sharp, the billboard ad nearly sharp, the towers behind soft.
- **Grade** (after ACES, values 0..1): into a display-like curve (square root), gain and lift, a gentle S curve, grain in the mid-tones only (one CSS pixel, new pattern each frame), back. Never clips the blacks; identity in today's look.
- **Phones (lite):** grade and grain only (no AO, no depth of field); the 12:00 light and studio fill apply too.
- **Passes:** always mounted; per frame only uniforms and `enabled` change. AO and depth of field draw until `Ready` has compiled every shader, then only while they do something (`passOn`), so they cost nothing at other hours. `PerformanceMonitor` decline turns AO off.
- **Dev:** `?look=off` shows today's look at every hour.
- **Cost (indicative, M4 Pro, 1440x900 at 1x, other work on the GPU):** AO about 3 ms, depth of field about 2 to 3 ms at the 12:00 rest shot. Neither depends much on sample count or resolution scale (fixed cost of their passes). 0 at other hours.
- **Tried and dropped:** AO intensity 2.5 with radius 1.6 (invisible); 10 with radius 1.5 (smudges on the facades, reads as dirt); depth of field 2 (towers too soft); lift 0.03 with contrast 0.12 (hazy, washed out); a separate tilt-shift pass (moves bloom after the blur: today's look would change).
- **Open:** in the 12:00 desktop shot the camera is below the roof, so there are few contact points; AO adds only a little shading under cornices and in window recesses for its cost. Worth a second look before tuning other hours.

## Sky

Code: `src/scene/sky.ts` (dome shader, per-hour table), `src/scene/atmosphere.tsx` (wires it in, fog). Tests: `tests/unit/sky.test.ts`, `tests/unit/atmosphere.test.ts`.

- **Per-hour table** `skyAt(hour)`, keys like `lightingAt`. Only 12:00 is tuned. 06:00, 09:00, 15:00 and later are `TODAY` (no clouds, no haze, fog as before), so 09:00 to 12:00 blends the clouds in and 12:00 to 15:00 blends them out. Tune another hour by changing its key.
- **12:00 values:** cover 0.38, softness 0.14, scale 1.6, wind 0.02, shade 0.55, haze 0.6, hazeHeight 0.1, fogScale 0.8.
- **Clouds:** the view ray meets a flat deck overhead (`dir.xz / dir.y * scale`), so clouds shrink and crowd toward the horizon. Shape: tileable value noise (`cloudNoise`, 256 px, 32 cells), fbm with an integer turn per octave (the tile still wraps, so no seam), plus a slow patch noise for clusters and clear blue gaps. Shading: a second tap a little lower on screen; more cloud there means the top of a puff (lit), less means the underside (grey). Thick middles a little darker. Clouds fade out below about 0.2 of elevation, into the haze, before the noise gets fine enough to shimmer. Stars only where there is no cloud.
- **Cloud colours** (`cloudColors`): the sun's colour with a touch of sky; dim blue-grey at night; never brighter than the sun.
- **Haze:** the horizon goes toward the distance fog's colour (`horizonColor`), the pale band reaches a little higher (`hazeHeight`), and the story fog comes in to 0.8 of its distance (`fogRange(d, explore, fogScale)`). Explore's fog and the ease down from Explore after a pin are unchanged.
- **Phones:** `OCTAVES` 3 instead of 4 (a define, set once).
- **Dev:** `?look=off` keeps today's sky at every hour.
- **Cost:** about 0.1 to 0.5 ms GPU at the 12:00 rest shot (1440x900, within run noise), 0 draw calls. At other hours the cloud code is skipped by a uniform branch.

Contract with the water (`bay.tsx`): it finds the dome by `renderOrder < 0` and `BackSide`, and reads the uniforms `top` and `horizon`. Keep all four. The dome draws first, writes no depth, and has no fog.

Tried and dropped: soft wide edges (softness 0.3, scale 2.4) read as wispy streaks, not cumulus; shading toward the sun put the grey on the tops at noon (the sun is behind the camera); a whitened cloud colour broke "never brighter than the sun" at sunrise.

## Foreground

Code: `src/scene/foreground.tsx` (mounted in `src/scene/union-square.tsx`). Tests: `tests/unit/foreground.test.ts`.

- **What:** out-of-focus leaves close to the lens, in the bottom-right corner of the 12:00 desktop shot, so it reads like a photo taken from behind a tree (like the concept `04-ads.jpg`).
- **Where:** `FOREGROUNDS` lists props per chapter. One so far, on `ads`: seed 7, depth 1, height 0.28 of the frame, overhang 0.06, opacity 0.96. At 1440x900 its quad covers about x 965 to 1440, y 665 to 900 (under 9% of the frame; the leaves fill part of that).
- **Never covers** Cuso, his bubble, the billboard ad or the chapter card (x < 458), at 4:3 to 2:1 and at every pointer corner. The test checks it.
- **Rides with the camera:** the quad faces the lens and sits in the frame's corner for any fov and aspect (`propPose`), so the boom and the pointer never push it onto Cuso. It drifts a little against the pointer and stirs in the breeze (a few px).
- **Shows only at rest** (`propFade`): full within 0.8 of the shot, gone from 2.0 away, gone when the camera looks more than about 20 degrees away (flights) and in Explore. Phone and tablet shots stand farther off, so they never see it. The opacity eases (no pops after a rail cut).
- **Per-hour table** `foregroundAt(hour)`, keys like `lightingAt`: only 12:00 has leaves; 09:00 and 15:00 are today's look, so the leaves blend in and out with the hour.
- **Texture:** a 512x256 canvas, painted at load. About 34 leaves on a bough from the corner (`leafLayout`, seeded): dark and big nearest the lens, lit and smaller at the tips, a few warm sunlit rims. Pre-blurred (canvas `filter: blur`; near leaves 12 px, far leaves 7 px; a shrink-and-stretch where the filter is missing), so it looks right without depth of field and on lite.
- **Material:** `MeshBasicMaterial`, transparent, no depth write, no depth test, no fog, `renderOrder` 10, DETAIL layer (not in the mirror or the glass probe), no shadows. Always mounted so Ready compiles it; hidden when not shown.
- **With the post stack:** it writes no depth, so depth of field and AO read the scene behind it: DOF does not blur it twice, and AO from the building behind may darken it a touch.
- **Dev:** `?look=off` hides it.
- **Cost:** 1 draw call (one quad) at the 12:00 desktop shot, nothing elsewhere.
- **Tried and dropped:** thin leaves on visible twigs read as a sprig, and the blur washed them out; a dense mound of small leaves read as a hedge.

## Measurements

(before and after screenshots, GPU frame time)
