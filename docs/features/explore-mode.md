# F07 · Explore mode

Last updated: 2026-10-12 · Status: done

## What it does
- **Story / Explore** switch in the top bar (desktop).
- Explore pulls the camera up to a bird's-eye view of the whole city with a pin on every place. The view fits itself to the screen (`fitOverview` in `camera-rig.tsx`): every pin stays in frame with room for labels and the top bar, on any size. Pins that line up from above lean apart (`LEAN` in `pins.tsx`). Fog banks are hidden from above.
- Click a pin → back to Story, scrolled to that chapter; Cuso hops there.
- Without 3D, Explore is a plain list of places.

## How it works
- Pins: drei `Html` in `src/scene/pins.tsx` (real buttons, keyboard reachable).
- While exploring, the page does not scroll and the story is `inert`.

## Acceptance
- The pin "Ads · Union Square" is visible and takes you to 12:00 (e2e).

## Gotchas
- Never put `aria-hidden` on the R3F `<Canvas>` wrapper: the pins live inside it. Only the `<canvas>` element is hidden.
