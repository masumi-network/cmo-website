# F09 · Waitlist

Last updated: 2026-10-16 · Status: done (needs the Vercel env vars) · Launch: set `SOKOSUMI_API_KEY` and `NEXT_PUBLIC_GA_ID`, then check a real signup

## What it does
- The same email-only form in the hero (06:00) and at the end (tomorrow 06:00), with one line under the button: "No spam. We only write when Cuso is ready."
- Once on the list, an optional extra step asks for the website ("Want Cuso to start with your site?", "Add my site"). Asked after the signup, so it never stands between a visitor and the list.
- The top-bar button: on the hero it focuses the hero's email field (no flight); anywhere else it flies to the finale and focuses that field.
- The hero says who it's for and the trust line: "Cuso is an AI CMO for founders. He runs your social, ads, SEO and email. Nothing goes out without your OK." No offer is promised (no early access, price or date) until Francis decides one.

## How it works
- Shared rules: `waitlistSchema` in `src/lib/waitlist.ts` (zod). Ported from the live site's `api/waitlist.js` on `main`.
- The form checks input before calling the API, then shows the server's error or "You're on the list". Ids are `waitlist-hero-email` and `waitlist-finale-email` (the top bar focuses them).
- The website step posts `{ email, website }` again, so a visitor who adds a site has two rows on Sokosumi: email alone, then email and URL. Dedupe by email (the table already gets duplicates from repeat signups).
- `POST /api/waitlist` (`src/app/api/waitlist/route.ts`) writes each signup as a row in the "CMO.xyz Waiting List" table on Sokosumi, as `main` did: org `utxo`, columns Email and URL (website optional, `https://` added when missing). Column ids are looked up by name once and cached (cleared after a failure).
- Errors: an 8 s timeout per Sokosumi call; 502 on a Sokosumi error, 504 on a timeout, always with the same friendly message. Sokosumi's status and body go to the server log only; logs never hold the email.
- No key: development and tests return `{ ok: true, stored: false }` with a warning; production returns 503 ("Signups are paused for a moment.").
- Abuse: 10 tries per IP per 10 minutes (in memory, per server instance: a guard against one noisy client, not a botnet) and an invisible `nickname` honeypot (filled means a silent `{ ok: true }`, nothing stored).
- Analytics: the root layout loads gtag only when `NEXT_PUBLIC_GA_ID` is set. `track()` in `src/lib/track.ts` sends GA events, each with `phone_test` (`3d` or `posters`) on phones (F10). The funnel:

| Event | Params | When |
| --- | --- | --- |
| `chapter_view` | `chapter`, `index`, `walk` | the chapter on screen changes (first one on load) |
| `scene_ready` / `scene_static` | `ms`, `lite` / `reason` | the 3D faded in / the visit has no 3D (nowebgl, reduced, param, posters) |
| `cta_click` | `source: topbar`, `chapter` | the top-bar Join |
| `form_start` | `source: hero, finale` | first focus on that email field |
| `form_error` | `source`, `kind: invalid, server, network, website` | a failed try |
| `sign_up` | `method: waitlist`, `source` | on the list (as `main`, plus `source`) |
| `website_added` | `source` | the extra step saved |
| `explore_open`, `ask_cuso` (`intent`), `walk_mode` (`on`) | | the side paths |

- Funnel in GA: `chapter_view` index 0 → `form_start` → `sign_up` by `source`; split by `phone_test` for the phone A/B test.

## Vercel env vars (Production)
- `SOKOSUMI_API_KEY`: the live site's key, server only.
- `NEXT_PUBLIC_GA_ID=G-82QM6MPVWK`: read at build time, so redeploy after setting it.

## After deploying
- Sign up with a real email and a website: a row appears in the Sokosumi table with the URL as `https://…`.
- GA Realtime shows a `sign_up` event.
- Vercel logs show no `waitlist:` errors.
- Repeat signups make duplicate rows (as on `main`).
