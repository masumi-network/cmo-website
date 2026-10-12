@AGENTS.md

# CMO.XYZ website: Cuso's City

The marketing site as a playable day in a miniature San Francisco. Next.js 16 (App Router) + React Three Fiber.

## Commands

- `pnpm dev`: run locally (http://localhost:3000)
- `pnpm verify`: **definition of done**: lint, typecheck, unit, build, e2e. See `docs/VERIFY.md`.
- `pnpm test` / `pnpm e2e`: unit / end to end on their own

## Where things are

- Feature map: `docs/features/README.md`. Every change keeps its feature doc and row up to date (a test enforces it).
- Product brief: `docs/PROJECT.md`. Design canvas link and image prompts: `design/README.md`.
- Chapters, camera shots, copy: `src/content/day.ts`. Dummy data: `src/content/sample.ts`.
- 3D: `src/scene/*`. HTML layer: `src/components/*`. Shared state: `src/lib/store.ts`.

## Rules

- Copy: plain words, short sentences, no em dashes. Cuso is "he".
- Four colors only: ink, paper, Cuso blue, muted (`src/app/globals.css`).
- In `src/scene/**`, mutating three.js objects inside `useFrame` is fine (that lint rule is off there).
- Dummy parts (Ask Cuso, waitlist storage) are marked as launch blockers in the feature map.
