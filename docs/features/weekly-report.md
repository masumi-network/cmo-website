# F06 · Weekly report

Last updated: 2026-10-12 · Status: dummy

## What it does
- At 22:00 Cuso is on the pier with his laptop. His weekly note lists three things he learned and what he will change.
- **Sounds good** → "Plan updated for next week" and Cuso celebrates.
- Phones and short screens: the three items fold away so the pier stays in view; tap the headline to open them.

## How it works
- `WeeklyNote` in `src/components/cards.tsx`; items in `src/content/sample.ts`.
- This chapter is dark: cards and HUD switch to the dark tokens.

## Acceptance
- The card is in view at 22:00 (e2e). The note folds open on a phone (unit + e2e).

## Not real yet
- Items are sample text. "Let's talk" does nothing yet.
