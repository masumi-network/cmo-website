# F10 · Without 3D, and accessibility

Last updated: 2026-10-16 · Status: done

## What it does
- No WebGL, or "reduce motion" turned on → no 3D. The concept renders (`public/concepts/`) cross-fade per chapter, and everything else works.
- The posters also cover the 3D while it loads, and are removed once it has faded in. Only the current chapter's poster and its neighbours load (about 2.4 MB saved on a 3D visit).
- `?static` forces the poster mode; `?lite` forces the light 3D mode.

## Accessibility
- All story content is real HTML: headings, labelled inputs, real buttons.
- The 3D canvas is hidden from screen readers. Pins are not.
- Fly mode keeps the keyboard: arrows, Page Up/Down, Space, Home and End move one chapter; Tab into a card flies there. Keys are ignored while typing, and Space still presses a focused button.
- Explore makes the story `inert`. Touch targets are 44 px or more (the wordmark too).
- UI stays clear of the notch and home bar (`--edge-*` in `globals.css`).

## Acceptance
- `?static` renders no canvas and the story still scrolls (e2e).
- Two posters at most in the page with `?static`, none once the 3D is in (e2e).
