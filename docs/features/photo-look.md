# F13 · Photo look

Last updated: 2026-10-15 · Status: planned · Launch: ok

Make the city read like a photo of a real city, with art direction in the WebGL renderer. Target: `public/concepts/*.jpg` (style prompt `design/prompts/_style.txt`).

Look test first: one chapter, Union Square at 12:00 (chapter `ads`). Every other hour keeps today's look until it is tuned.

## Post

(post stack: ambient occlusion, depth of field on Cuso, warm grade, film grain)

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

(one foreground prop at the 12:00 shot)

## Measurements

(before and after screenshots, GPU frame time)
