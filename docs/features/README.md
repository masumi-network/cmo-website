# Feature map

Last updated: 2026-10-14

Every feature of the site, where it lives, and what proves it works.
`tests/unit/feature-map.test.ts` checks this table: every doc, code path and
test path must exist, and every doc in this folder must be listed. Change a
feature? Update its doc and its row in the same change.

**Status:** `done` · `dummy` (works, fake data or fake backend) · `v0` (works, rough look) · `planned` (not built).
**Launch:** `blocker` means it must change before the site replaces cmo.xyz.

| ID | Feature | Status | Launch | Doc | Code | Tests |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Day story: scroll is one day, one job per hour (phones included) | done | ok | [day-story](day-story.md) | `src/content/day.ts`, `src/components/chapters.tsx`, `src/components/hud.tsx`, `src/lib/time.ts`, `src/lib/navigate.ts`, `src/app/globals.css` | `tests/unit/time.test.ts`, `tests/unit/content.test.ts`, `tests/unit/framing.test.ts`, `tests/unit/navigation.test.ts`, `tests/e2e/day.spec.ts` |
| F02 | City scene: miniature San Francisco in 3D | v0 | blocker | [city-scene](city-scene.md) | `src/scene/scene.tsx`, `src/lib/terrain.ts`, `src/scene/grid.ts`, `src/scene/layout.ts`, `src/scene/city.tsx`, `src/scene/ground.ts`, `src/scene/houses.tsx`, `src/scene/house-models.ts`, `src/scene/towers.tsx`, `src/scene/lawn.ts`, `src/scene/grass.tsx`, `src/scene/street.tsx`, `src/scene/materials.ts`, `src/scene/facade.ts`, `src/scene/landmarks.tsx`, `src/scene/landmark-kit.tsx`, `src/scene/rooftop.tsx`, `src/scene/shop.tsx`, `src/scene/pyramid.tsx`, `src/scene/ferry.tsx`, `src/scene/union-square.tsx`, `src/scene/mission.tsx`, `src/scene/islands.tsx`, `src/scene/reflections.ts`, `src/scene/perf-overlay.tsx`, `src/scene/fog.tsx`, `src/scene/cable-line.ts`, `src/scene/coit-tower.tsx`, `src/scene/trees.tsx`, `src/scene/tree-models.ts`, `src/scene/tree-textures.ts`, `src/scene/parts.tsx`, `src/scene/cable-car.tsx`, `src/scene/pier.tsx`, `src/scene/traffic.tsx`, `scripts/convert-cars.mjs`, `public/models/cars`, `src/scene/bay.tsx`, `src/scene/roads.ts`, `src/scene/atmosphere.tsx`, `src/scene/camera-rig.tsx` | `tests/unit/layout.test.ts`, `tests/unit/terrain.test.ts`, `tests/unit/ground.test.ts`, `tests/unit/houses.test.ts`, `tests/unit/kerbs.test.ts`, `tests/unit/towers.test.ts`, `tests/unit/grass.test.ts`, `tests/unit/street.test.ts`, `tests/unit/roads.test.ts`, `tests/unit/landmarks.test.ts`, `tests/unit/coit-tower.test.ts`, `tests/unit/trees.test.ts`, `tests/unit/rooftop.test.ts`, `tests/unit/shop.test.ts`, `tests/unit/pyramid.test.ts`, `tests/unit/ferry.test.ts`, `tests/unit/union-square.test.ts`, `tests/unit/mission.test.ts`, `tests/unit/islands.test.ts`, `tests/unit/reflections.test.ts`, `tests/unit/bridges.test.ts`, `tests/unit/fog.test.ts`, `tests/unit/cable-line.test.ts`, `tests/unit/cable-car.test.ts`, `tests/unit/pier.test.ts`, `tests/unit/traffic.test.ts`, `tests/unit/bay.test.ts`, `tests/e2e/day.spec.ts`, `tests/e2e/perf.spec.ts` |
| F03 | Cuso: the real 3D mascot, rigged, walking the streets, talking | done | ok | [cuso-character](cuso-character.md) | `src/scene/cuso.tsx`, `src/scene/rig.ts`, `src/scene/gait.ts`, `src/scene/routes.ts`, `public/models/cuso.glb`, `scripts/convert-cuso.mjs` | `tests/unit/routes.test.ts`, `tests/unit/collision.test.ts`, `tests/unit/rig.test.ts`, `tests/unit/boom.test.ts`, `tests/unit/cuso-model.test.ts`, `tests/e2e/day.spec.ts` |
| F04 | Brand moves in: your website on the city's signs | dummy | ok | [brand-personalization](brand-personalization.md) | `src/components/brand-form.tsx`, `src/lib/brand.ts`, `src/scene/textures.ts` | `tests/unit/brand.test.ts`, `tests/unit/components.test.tsx`, `tests/e2e/day.spec.ts` |
| F05 | Approvals: OK a draft, Cuso reacts | dummy | ok | [approvals](approvals.md) | `src/components/cards.tsx`, `src/lib/store.ts` | `tests/unit/components.test.tsx`, `tests/e2e/day.spec.ts` |
| F06 | Weekly report: Cuso tells you what he learned | dummy | ok | [weekly-report](weekly-report.md) | `src/components/cards.tsx`, `src/content/sample.ts` | `tests/unit/components.test.tsx`, `tests/e2e/day.spec.ts` |
| F07 | Explore mode: the city map with pins, drag to move, Recenter | done | ok | [explore-mode](explore-mode.md) | `src/scene/pins.tsx`, `src/lib/pan.ts`, `src/components/hud.tsx`, `src/components/experience.tsx` | `tests/unit/pan.test.ts`, `tests/e2e/day.spec.ts` |
| F08 | Ask Cuso: type a question, he answers and walks there | done | ok | [ask-cuso](ask-cuso.md) | `src/lib/ask.ts`, `src/components/ask-bar.tsx` | `tests/unit/ask.test.ts`, `tests/unit/components.test.tsx`, `tests/e2e/day.spec.ts` |
| F09 | Waitlist: email (and website) signup | done | ok | [waitlist](waitlist.md) | `src/lib/waitlist.ts`, `src/components/waitlist-form.tsx`, `src/app/api/waitlist/route.ts` | `tests/unit/waitlist.test.ts`, `tests/unit/waitlist-route.test.ts`, `tests/unit/components.test.tsx`, `tests/e2e/day.spec.ts` |
| F10 | Without 3D: posters, reduced motion, accessibility | done | ok | [fallback-and-access](fallback-and-access.md) | `src/components/experience.tsx`, `public/concepts` | `tests/e2e/day.spec.ts` |
| F11 | Site check: Cuso reviews your site and reports back | planned | ok | [site-check](site-check.md) | | |

## How we verify

See [../VERIFY.md](../VERIFY.md). One command: `pnpm verify`.
