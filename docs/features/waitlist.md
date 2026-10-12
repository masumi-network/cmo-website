# F09 · Waitlist

Last updated: 2026-10-12 · Status: dummy · Launch blocker: real storage

## What it does
- Email signup in the hero (06:00) and email + optional website at the end (tomorrow 06:00).
- The top-bar button jumps to the final signup.

## How it works
- Shared rules: `waitlistSchema` in `src/lib/waitlist.ts` (zod). Ported from the live site's `api/waitlist.js` on `main`.
- The form checks input before calling the API, then shows the server's error or "You're on the list".
- `POST /api/waitlist` validates and returns `{ ok: true, stored: false }`. **It stores nothing.**

## Before launch
- Port the Sokosumi write from `main:api/waitlist.js` into the route handler (env `SOKOSUMI_API_KEY`).
- Fire the GA `sign_up` event (the live site has GA `G-82QM6MPVWK`).
