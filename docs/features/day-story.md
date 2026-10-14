# F01 · Day story

Last updated: 2026-10-14 · Status: done

## What it does
- The page is one day in San Francisco: 06:00 to 22:00, then "tomorrow".
- Each scroll section is one chapter: one place, one job Cuso does.
- The camera rests while you read a chapter, then flies to the next one.
- The top rail shows the time. Click a time to jump there (desktop): the page snaps to the chapter, the camera flies there in 1.6 to 3.6 s, longer the farther it really goes, so it never rushes (under 60 units a second; it peaked over 200 when every jump took 1.3 s). It flies one eased arc: across, up and the aim move together. It arcs only over roofs its path crosses, rising first only when a tall building stands right beside the start (`flight.ts`). A second click flies on without a jerk, the light cross-fades the short way round the clock, and Cuso pops in 3.5 units short of his spot (never mid-jump, never where the Union Square cable car runs) and walks or hops the last steps (`goToChapter` in `navigate.ts`, `arrival()` in `routes.ts`, `navigation.test.ts`). Explore pins and Ask Cuso use the same jump. Reduced motion cuts straight to the shot. Scrolling still walks the full route.
- On touch screens one swipe moves one chapter: the page snaps to chapter starts and can only rest where the camera rests, never halfway between two places.

| Time | Place | Job |
| --- | --- | --- |
| 06:00 | Russian Hill rooftop | Hello + waitlist |
| 07:00 | Hayes Valley shop | Learns your brand |
| 09:00 | Mission wall | Social posts |
| 12:00 | Union Square billboard | Ads |
| 15:00 | Transamerica Pyramid tip | SEO |
| 18:00 | California St cable car | Newsletter |
| 22:00 | Embarcadero pier | Weekly report |
| 06:00 | Russian Hill, wide | Join the waitlist |

## How it works
- All chapter content and camera shots: `src/content/day.ts` (one source of truth).
- `frame()` places the camera like a photographer: `yaw` = where the camera stands, `side` = Cuso on the right (+) or left (−) third.
- Scroll position → `progress` (in sections) → `travel()` → from/to chapter + eased `t` (`src/lib/time.ts`).
- Each section is `SECTION_VH` (1.6) screens tall (`svh`). The first 45% is rest, the rest is travel. `sectionHeight()` measures the first section, so phone browser bars sliding in and out do not shift the story.
- Touch snapping: `scroll-snap-type: y mandatory` under `(pointer: coarse)` in `globals.css`. A section is taller than the screen, so any spot in its first 0.6 screens is a valid rest (all inside the rest part).

## Phones
- Layout: cards sit at the bottom, one column, compact type (`md:` keeps desktop as it was). Detail cards show only where they are the thing to do (09:00 draft, 22:00 weekly note). The weekly note folds its list away; tap the headline to open it.
- Camera: every chapter has a `phone` shot in `day.ts` (portrait under 768 px). The rig then finds the biggest free stretch of screen between the top bar and anything marked `data-card` (`largestGap` in `camera-rig.tsx`), pulls back if Cuso and his bubble do not fit, and slides the picture (`setViewOffset`) so he stands in it. Works on any phone height, and moves with the cards (an error line under a form, a folded note).
- Landscape phones and short screens (`short:` variant, height up to 500 px): side column like desktop, but tighter: only the cards that matter, the chapter body gives way to the draft or note, the finale puts words and form side by side, no Ask bar.
- Safe areas: `viewport-fit=cover`, and the UI keeps to `--edge-l/-r/-b` (`globals.css`), which include `env(safe-area-inset-*)`. The scene is `h-lvh`, so browser bars never resize the canvas. The keyboard never resizes the page (`interactive-widget=resizes-visual`).

## Acceptance
- Every chapter heading comes into view as you scroll (e2e).
- The rail highlights the current chapter (e2e, desktop).
- Phones: in every chapter Cuso is on screen and no card covers him, cards fit the screen, no sideways scroll (e2e, mobile). Gap finder and phone shots (unit, `framing.test.ts`).
- Touch: a scroll always comes to rest inside a chapter's rest part (e2e, mobile).
- Time moves forward; every chapter has a poster (unit).

## Gotchas
- Copy rules from the brand guide: plain words, no em dashes. A unit test checks the dashes.
