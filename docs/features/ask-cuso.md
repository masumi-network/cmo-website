# F08 · Ask Cuso

Last updated: 2026-10-12 · Status: dummy · Launch blocker: decide real vs scripted

## What it does
- An "Ask Cuso anything…" bar (desktop, chapters 07:00 to 22:00).
- Cuso answers in his speech bubble and walks to the place that fits: "run my ads" → Union Square.
- The reply is also announced to screen readers (`aria-live`).

## How it works (dummy)
- `askCuso()` in `src/lib/ask.ts`: keyword routing with canned replies. "Google" alone means ads; "Google search" means SEO.

## Before launch (open decision)
- Option A: keep it scripted (cheap, safe, predictable).
- Option B: a real model behind a route handler. Needs rate limits, a system prompt in Cuso's voice, and replies that only route to known chapters.
