# F10 · Without 3D, and accessibility

Last updated: 2026-10-16 · Status: done

## What it does
- No WebGL, or "reduce motion" turned on → no 3D. The posters cross-fade per chapter, and everything else works.
- Posters are rendered from each chapter's real 3D shot (`public/posters/<chapter>.jpg`, 1440×900 at 1.5x; `<chapter>-phone.jpg`, 390×844 at 3x, framed for the phone cards). Phones in portrait under 768 px get the phone one (`<picture>`, same rule as `isPhone`). Until 2026-10-16 they were the AI concept renders (`public/concepts/`, still the photo-look target), so the cover no longer jumps when the 3D fades in.
- Re-render after any change to the look, a camera shot or the cards' layout: `node scripts/posters.mjs` against the running dev server (real GPU, headed Chromium, about 4 min a set; `ONLY=phone` or `ONLY=desktop`). It hides all HTML with `visibility`, so the phone camera still frames Cuso in the gap the cards leave.
- **Phone A/B test:** half of phones (touch, short side under 768 px) get the posters only, no 3D; the other half the live city (`phoneVariant` in `src/lib/track.ts`, kept in `cmo.v`; `?v=posters` or `?v=3d` forces one). Every analytics event carries `phone_test`. To end it, keep the winner in `detect()` in `experience.tsx` and delete `phoneVariant`. E2E that need the 3D open `?v=3d`.
- The posters also cover the 3D while it loads, and are removed once it has faded in. Only the current chapter's poster and its neighbours load (about 2.4 MB saved on a 3D visit).
- `?static` forces the poster mode; `?lite` forces the light 3D mode. `scene_static` (reason: nowebgl, reduced, param, posters) or `scene_ready` (ms) tells analytics which one a visit got.

## Accessibility
- All story content is real HTML: headings, labelled inputs, real buttons.
- The 3D canvas is hidden from screen readers. Pins are not.
- Fly mode keeps the keyboard: arrows, Page Up/Down, Space, Home and End move one chapter; Tab into a card flies there. Keys are ignored while typing, and Space still presses a focused button.
- Explore makes the story `inert`. Touch targets are 44 px or more (the wordmark too).
- UI stays clear of the notch and home bar (`--edge-*` in `globals.css`).

## Acceptance
- `?static` renders no canvas and the story still scrolls (e2e).
- Two posters at most in the page with `?static`, none once the 3D is in (e2e).
- `?v=posters` on a phone: no canvas, the phone poster (e2e). Every chapter has both posters (unit, `content.test.ts`). The split and its memory (unit, `track.test.ts`).
