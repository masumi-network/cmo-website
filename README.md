# CMO.XYZ website

Landing page for **CMO.XYZ**, the AI CMO. The agent is named Cuso. See
`PROJECT.md` for what he does and how to talk about him.

Deployed by the Vercel project `cmo-xyz` to https://www.cmo.xyz.

## Run it

No build step. Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html`: the page. Sections: nav, hero, marquee, "A month with Cuso"
  (five steps with example strategy, posts, ad, schedule and weekly check),
  pricing, FAQ, final CTA, footer with imprint.
- `styles.css`: all styles. Colors, fonts and sizes are tokens in `:root`.
- `script.js`: sends the GA `cta_click` event, animates Cuso in the hero
  and reveals sections on scroll.
  All motion is off under `prefers-reduced-motion`.
- `assets/`: Cuso poses (WebP), the logo mark, icons and fonts.

## Look

Neo-brutalist and light only: white and black with one accent (`#FF51FF`),
thick black borders, hard offset shadows and pill tags. Headings are PP Mori
600, body text is Inter. Both fonts are served from `assets/fonts/`.

## Sign up

Main CTAs go to https://app.cmo.xyz/signup.

## Keeping the copy true

The example business, Moss & Kettle, is made up and labelled as such. Prices
are the app's Polar plans (Starter, Growth, Scale). If the plans change in
Polar, change them in the pricing section and the FAQ.
