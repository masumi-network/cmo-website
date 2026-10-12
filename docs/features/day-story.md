# F01 · Day story

Last updated: 2026-10-12 · Status: done

## What it does
- The page is one day in San Francisco: 06:00 to 22:00, then "tomorrow".
- Each scroll section is one chapter: one place, one job Cuso does.
- The camera rests while you read a chapter, then flies to the next one.
- The top rail shows the time. Click a time to jump there.

| Time | Place | Job |
| --- | --- | --- |
| 06:00 | Russian Hill rooftop | Hello + waitlist |
| 07:00 | Hayes Valley shop | Learns your brand |
| 09:00 | Mission wall | Social posts |
| 12:00 | Union Square billboard | Ads |
| 15:00 | Transamerica Pyramid tip | SEO |
| 18:00 | California St cable car | Newsletter |
| 22:00 | Embarcadero pier | Weekly report |
| 06:00 | Russian Hill, wide | Join the waitlist |

## How it works
- All chapter content and camera shots: `src/content/day.ts` (one source of truth).
- `frame()` places the camera like a photographer: `yaw` = where the camera stands, `side` = Cuso on the right (+) or left (−) third.
- Scroll position → `progress` (in sections) → `travel()` → from/to chapter + eased `t` (`src/lib/time.ts`).
- Each section is `SECTION_VH` (1.6) screens tall. The first 45% is rest, the rest is travel.

## Acceptance
- Every chapter heading comes into view as you scroll (e2e).
- The rail highlights the current chapter (e2e, desktop).
- Time moves forward; every chapter has a poster (unit).

## Gotchas
- Copy rules from the brand guide: plain words, no em dashes. A unit test checks the dashes.
