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

## 2. Visual check (every UI change)

Open `screenshots/` and check, desktop and mobile:

- [ ] Cuso is visible and not covered by a card
- [ ] Text is readable over the scene (headline, cards, bubble)
- [ ] Calm: one accent color (Cuso blue), no competing elements
- [ ] Cards line up (48 px edge, same widths)
- [ ] Night (22:00) uses the dark cards and HUD

## 3. Feature map

- Changed a feature? Update its doc in `docs/features/` and its row in `docs/features/README.md`.
- The feature map test fails if a doc, code path or test path is missing, or a doc is not on the map.

## 4. Before release (not done by `verify`)

- Real phone check (iOS Safari, Android Chrome): load time, 30 fps, touch.
- Launch blockers in the feature map are cleared.
