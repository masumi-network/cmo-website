# F09 · Waitlist

Last updated: 2026-10-14 · Status: done (needs the Vercel env vars) · Launch: set `SOKOSUMI_API_KEY` and `NEXT_PUBLIC_GA_ID`, then check a real signup

## What it does
- Email signup in the hero (06:00) and email + optional website at the end (tomorrow 06:00).
- The top-bar button jumps to the final signup.

## How it works
- Shared rules: `waitlistSchema` in `src/lib/waitlist.ts` (zod). Ported from the live site's `api/waitlist.js` on `main`.
- The form checks input before calling the API, then shows the server's error or "You're on the list".
- `POST /api/waitlist` (`src/app/api/waitlist/route.ts`) writes each signup as a row in the "CMO.xyz Waiting List" table on Sokosumi, as `main` did: org `utxo`, columns Email and URL (website optional, `https://` added when missing). Column ids are looked up by name once and cached (cleared after a failure).
- Errors: an 8 s timeout per Sokosumi call; 502 on a Sokosumi error, 504 on a timeout, always with the same friendly message. Sokosumi's status and body go to the server log only; logs never hold the email.
- No key: development and tests return `{ ok: true, stored: false }` with a warning; production returns 503 ("Signups are paused for a moment.").
- Abuse: 10 tries per IP per 10 minutes (in memory, per server instance: a guard against one noisy client, not a botnet) and an invisible `nickname` honeypot (filled means a silent `{ ok: true }`, nothing stored).
- Analytics: the root layout loads gtag only when `NEXT_PUBLIC_GA_ID` is set; success fires `sign_up` (`method: "waitlist"`), as `main` did.

## Vercel env vars (Production)
- `SOKOSUMI_API_KEY`: the live site's key, server only.
- `NEXT_PUBLIC_GA_ID=G-82QM6MPVWK`: read at build time, so redeploy after setting it.

## After deploying
- Sign up with a real email and a website: a row appears in the Sokosumi table with the URL as `https://…`.
- GA Realtime shows a `sign_up` event.
- Vercel logs show no `waitlist:` errors.
- Repeat signups make duplicate rows (as on `main`).
