# F08 · Ask Cuso

Last updated: 2026-10-14 · Status: done (scripted) · Launch: fill the open answers below

## What it does
- An "Ask Cuso anything…" bar (tablet and desktop, chapters 07:00 to 22:00). Beside the cards (24 px from the card column, mirrored at 22:00 where the cards are on the right), centred on screen once there is room (about 1444 px); it never covers a card (`askPlace` in `experience.tsx`, e2e "the Ask bar never covers a card"). Not on phones or short screens: there the bottom of the screen belongs to the cards.
- Cuso answers in his speech bubble and walks to the place that fits: "run my ads" → Union Square.
- The reply is also announced to screen readers (`aria-live`).

## How it works (scripted, decided 2026-10-14)
- `askCuso(question, asked)` in `src/lib/ask.ts`: a small pure function, no AI and no dependencies. 25 intents: the chapters (he walks there: brand, social, ads, SEO, newsletter, report, waitlist; "how does it work" goes to Learn, "contact" to the waitlist) and replies where he stays put (pricing, about, maker, agency, integrations, unknown tools, approvals, privacy, joke, rude, greeting, thanks, bye, other languages, nonsense, fallback).
- Matching: case, accents and punctuation normalised, simple stemming, synonyms per intent, small typos on topic words only (same first letter; five-letter words accept a swap only; a list of real words is excluded), phrases score double ("google search", "instagram ads"). Other alphabets and common Spanish, French, German and Portuguese words get the language reply unless an English topic word wins. Strongest intent wins; ties go to the earliest chapter.
- Replies: Cuso's voice, at most 56 characters (`MAX_REPLY`), no dashes. Each intent has 2 or 3 variants; a repeat gets the next one (the bar keeps the history).
- Fallback, nonsense, language and greeting replies offer 2 or 3 chips ("Try asking"), which route like a question. They hide when you type.
- The reply is announced to screen readers (`aria-live`).

## Open questions (answers the product copy does not give yet)
- Price, free trial or free tier. Privacy (where data lives, training, GDPR, policy link). A contact email. Which social networks and ad platforms (beyond Google and Meta). Integrations (Shopify, WordPress, HubSpot, Mailchimp) and how SEO changes reach a site. Languages Cuso writes in. Launch date. Who is behind it.
- Until then Cuso answers these generically ("Can't promise that one yet", "Privacy details come at launch", sends contact to the waitlist).
