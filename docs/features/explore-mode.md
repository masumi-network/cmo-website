# F07 · Explore mode

Last updated: 2026-10-16 · Status: done

## What it does
- **Story / Explore** switch in the top bar. Phones get one icon button (a map, a close mark while exploring) that flips between the two.
- Explore pulls the camera up to a bird's-eye view of the whole city with a pin on every place. The view fits itself to the screen (`fitOverview` in `camera-rig.tsx`): every pin stays in frame with room for labels and the top bar, on any size. Pins that line up from above lean apart (`LEAN` in `pins.tsx`). Fog banks are hidden from above.
- Drag (mouse or one finger) to move the map; the ground under the finger stays under it. Pinch or the wheel zooms a little (0.55x to 1.25x). The view never leaves the land.
- **Recenter** (bottom centre) shows once the map was moved or zoomed and eases back to the fitted view. Leaving and re-entering Explore also resets it.
- Click a pin → back to Story, scrolled to that chapter; Cuso hops there. A drag that starts on a pin moves the map and does not open the pin.
- Without 3D, Explore is a plain list of places.

## How it works
- Pins: drei `Html` in `src/scene/pins.tsx` (real buttons, keyboard reachable).
- While exploring, the page does not scroll and the story is `inert`. Fly mode's wheel, touch and key handling (`fly.ts`) stands aside, so the wheel zooms the map.
- Drag maths: `src/lib/pan.ts` (pure: `isDrag` 6 px threshold, `clampPan` to `LAND_BOUNDS`, `clampZoom`, `isMoved`, plus the `usePan` store). Pointer wiring in `pins.tsx` (`useMapDrag`): rays from the pointer to the ground plane, seen from the camera as it was when the drag started; `touch-action: none` and the grab cursor only while exploring. The camera adds pan and zoom to the fitted view (`camera-rig.tsx`), smoothed by the usual damping.

## Acceptance
- The pin "Ads · Union Square" is visible and takes you to 12:00 (e2e, desktop and mobile).
- Drag the map → Recenter shows, the page did not scroll; Recenter → it goes away; a pin still works after a drag (e2e). Pan maths (unit, `pan.test.ts`).

## Gotchas
- Never put `aria-hidden` on the R3F `<Canvas>` wrapper: the pins live inside it. Only the `<canvas>` element is hidden.
