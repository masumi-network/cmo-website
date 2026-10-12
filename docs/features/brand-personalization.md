# F04 · Your brand moves in

Last updated: 2026-10-12 · Status: dummy

## What it does
- At 07:00 the visitor types their website.
- Their name goes up on the shop sign, the Union Square billboard and both cable cars. The SEO card ranks their site #1.
- Default: `northwindcoffee.com` (sample brand).

## How it works
- `brandFromUrl()` (`src/lib/brand.ts`) turns a URL into a short sign name (handles `www.`, `co.uk`, hyphens; max 18 characters).
- Signs are drawn with the 2D canvas (`useSign` in `src/scene/textures.ts`) using the page's font.
- The website lives in the store (`src/lib/store.ts`).

## Acceptance
- Valid site → store updated; invalid → "That doesn't look like a website." (unit).
- The ranking card shows the new site (e2e).

## Not real yet
- Nothing reads the site. The Brand Brain card is sample data (`src/content/sample.ts`).
- The site check (F11) would make this real.
