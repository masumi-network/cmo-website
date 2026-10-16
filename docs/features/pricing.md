# F14 · Pricing: the 23:00 stop at Coit Tower

Last updated: 2026-10-16 · Status: done

## What it does
- A stop between the weekly report (22:00) and tomorrow's signup: **23:00 · Pricing · "Hire Cuso"**, at Coit Tower on Telegraph Hill. Cuso stands on the plaza's south edge; the lit tower and the Golden Gate are behind him.
- Value first, then price, then the signup: the order a visitor meets them scrolling the day. The rail has it as "23:00 Pricing"; Explore has its pin; `/#chapter-pricing` lands on it.
- The price card (one card, dark UI at night): the three plans of the live cmo.xyz (read 2026-10-16), from `src/content/pricing.ts`.
  - Intern $300/mo, for founders who are just starting out. Manager $800/mo, Popular, for small teams and agencies. Chief, custom, "We build a plan just for you."
  - Body: "Pick the job that fits. No setup fees. Cancel anytime." Footnote: "Ad spend is not included. You pay platforms like Google and Meta directly."
  - Desktop: three columns, the popular one on a muted panel, each with its features. Phones and short screens: three rows, one open at a time (Manager first), its features on one line.
- Intern and Manager: "Join the waitlist" flies to the finale and puts the cursor in its email field; the plan rides along with the signup to analytics. Chief: "Schedule a call" opens https://cal.com/patricktobler (the live site's link) in a new tab.
- Ask Cuso: price questions ("how much", "is it free", "billing") walk him here, with real numbers ("Plans start at $300 a month. Come and see.").
- No Ask bar here: the price card takes the bottom of the screen.

## How it works
- Chapter: `src/content/day.ts` (`pricing`, hour 23). Spot on the plaza top (`COIT_PLAZA`, the same sum as `coitSeat()`), between two benches; the lamp due south was removed (`LAMPS` in `coit-tower.tsx`).
- Shot: desktop `yaw 45, distance 16, height 4, look -1.2` (Cuso high in the frame, over the card), phone `yaw 45, distance 14, height 3`. Height 3 on desktop removed a house on the hill (`blocksView`) and reshuffled the rest.
- Route (`routes.ts`): up the x -3 sidewalk, along the park's south sidewalk, up Pioneer Park's walk (`PIONEER_WALK` in `lawn.ts`), then a hop up the plaza's wall (a jump onto the spot, like the pyramid tip). Cuso may now walk park trails, never park grass (`ground.test.ts`).
- Flights: 09:00 to 23:00 starts beside a 30-unit tower, so the rise-first fallback arc lifts 46 (was 40) in `flight.ts`.
- Card: `src/components/pricing.tsx`, the existing `Card` and `Button`, four colours. The rail fits eight stops: centred between the wordmark and the buttons, times only under 1280 px (labels stay for screen readers).
- Events (`track`): `pricing_view` (once a visit, when the stop is on screen), `plan_open` (`plan`, phone rows), `plan_cta` (`plan`), and `sign_up` carries `plan` after a plan's Join.

## Acceptance
- Three plans with prices, Popular on Manager, the footnote; Join flies to the finale, focuses the email and sends `plan` with the signup; Chief links to the calendar; one phone row open at a time; `pricing_view` once (unit, `components.test.tsx`).
- Cuso stands on the plaza, clear of lamps and benches (unit, `coit-tower.test.ts`); never through the tower, lamps or benches on his way (unit, `collision.test.ts`); price questions go to 23:00 (unit, `ask.test.ts`).
- The rail's 23:00 and `/#chapter-pricing` land on the card; a plan's Join reaches the finale's email (e2e). On phones Cuso stands clear of the card and it fits the screen (e2e @heavy, every chapter).

## Open
- The shadow box at 23:00 desktop is a half-metre step over the 2 cm/texel target (exempted in `atmosphere.test.ts`, like the finale): moonlight shadows are faint.
