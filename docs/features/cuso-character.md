# F03 · Cuso

Last updated: 2026-10-12 · Status: v0 · Launch blocker: walk cycle

## What it does
- The real mascot (`public/models/cuso.glb`, Draco compressed) stands in every chapter.
- He says one line per chapter in a speech bubble, and replies when you ask him something.
- He hops between places, turns to face the camera, and follows your pointer a little.
- He spins when you approve something, change your website or agree to his plan.

## How it works
- `src/scene/cuso.tsx`. Clips in the file: `Idle`, `Hop`, `Hello`, `Spin`, `Blink`.
- Scale 6.2, so Cuso is about door height (1.9 units).
- The Draco decoder is self-hosted in `public/draco/` (copied from `three/examples/jsm/libs/draco/gltf`).

## Known limits
- The model has **no skeleton**. All clips move the whole body, so he cannot walk yet. Travel is a hop arc.
- `Blink` animates the same node as the other clips, so it is not used.

## Before launch
- Rig Cuso (legs, arms) in Blender and add a walk cycle plus the poses from the mascot sheet: thinking, researching, creating, done, sleeping.
- Re-export with the same clip names, plus `Walk`.
