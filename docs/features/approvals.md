# F05 · Approvals

Last updated: 2026-10-12 · Status: dummy

## What it does
- At 09:00 Cuso brings a draft Instagram post. The visitor taps **Approve** or **Change it**.
- Approve → "Scheduled for Tue 09:00", Cuso spins, and the new post appears on the Mission wall. **Undo** reverts.
- This is the product, played: nothing goes out without your OK.

## How it works
- `ApprovalCard` in `src/components/cards.tsx`; state `approved` in `src/lib/store.ts`.
- The wall tile animates in `MuralWall` (`src/scene/landmarks.tsx`).

## Acceptance
- Approve → scheduled, Undo → back (unit + e2e).

## Not real yet
- "Change it" does nothing yet. Idea: it opens the Ask bar with "Change the post to…".
