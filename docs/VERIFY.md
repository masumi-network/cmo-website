# Verification

Last updated: 2026-10-12

A change is done when `pnpm verify` passes and the screens look right.

## 1. Automated: `pnpm verify`

Runs, in order, and stops at the first failure:

| Step | Command | Checks |
| --- | --- | --- |
| Lint | `pnpm lint` | ESLint (Next + React rules) |
| Types | `pnpm typecheck` | Next route types + `tsc --noEmit` |
| Unit | `pnpm test` | Vitest: logic, components, API route, **feature map** |
| Build | `pnpm build` | Production build |
| E2E | `pnpm e2e` | Playwright on the production build, desktop (1440×900) + mobile (Pixel 7) |

First time on a machine: `pnpm exec playwright install chromium`.

E2E saves a screenshot of every chapter to `screenshots/` (gitignored).

Scripted screenshots of the 3D: headless Chrome pauses `requestAnimationFrame` without user input, so after a programmatic scroll the scene may not update. Move the mouse while waiting (the e2e assertions on the DOM are not affected).

Close-ups of one object: in dev, add `?cam=px,py,pz,tx,ty,tz` (camera position, then the point it looks at). Ignored in production builds.

## 2. Visual check (every UI change)

Open `screenshots/` and check, desktop and mobile:

- [ ] Cuso is visible and not covered by a card
- [ ] Text is readable over the scene (headline, cards, bubble)
- [ ] Calm: one accent color (Cuso blue), no competing elements
- [ ] Cards line up (48 px edge, same widths)
- [ ] Night (22:00) uses the dark cards and HUD

Mobile (every chapter, at 375x667, 390x844, 412x915, one landscape phone 844x390, tablet 768x1024):

- [ ] Cuso and his bubble sit in the free space between the top bar and the cards (e2e checks the box on Pixel 7)
- [ ] The chapter's subject is in frame: Golden Gate (06:00), shop sign (07:00), mural (09:00), billboard (12:00), pyramid (15:00), cable car (18:00), pier and laptop (22:00), Coit Tower and the city (tomorrow)
- [ ] Bubble text wraps inside the screen; nothing scrolls sideways
- [ ] Cards fit the screen, nothing cut off at the bottom; landscape: no card under the top bar
- [ ] Tap targets 44 px or more (wordmark, Explore, pins, buttons)
- [ ] Explore on a phone: pins readable and not cut off, drag moves the map, Recenter comes back
- [ ] One swipe moves one chapter; the page never rests between two places
- [ ] Forms: error and success states keep Cuso in view (the camera re-fits); the brand form at 07:00 and Approve at 09:00 work
- [ ] `?static` and `?lite` on a phone

E2E saves `screenshots/mobile-phone-<n>-<chapter>.png` for every chapter on Pixel 7. Real phones still need a check (keyboard, browser bars, notch), see section 4.

## 3. Feature map

- Changed a feature? Update its doc in `docs/features/` and its row in `docs/features/README.md`.
- The feature map test fails if a doc, code path or test path is missing, or a doc is not on the map.

## 4. Before release (not done by `verify`)

- Real phone check (iOS Safari, Android Chrome): load time, 30 fps, touch, swipe snapping, the keyboard on the 07:00 and waitlist forms, browser bars hiding, landscape with a notch.
- Launch blockers in the feature map are cleared.
