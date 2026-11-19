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
  and reveals sections on scroll. Cuso walks in from the back of the page,
  turns to wave, waves now and then and wobbles when pressed; his legs are
  drawn live so his feet stay planted.
  All motion is off under `prefers-reduced-motion`, where the hero shows
  `assets/cuso/friendly.svg` instead.
- `assets/cuso/`: Cuso from the brand guide's `Cuso 2D Mascot` folder. The
  step poses and `friendly.svg` are its `-ground-shadow` SVGs, copied
  unchanged. `poses.svg` is the hero's animated Cuso, made from its
  `-default` SVGs by `python3 scripts/cuso-poses.py "<brand guide>/Cuso 2D Mascot"`;
  re-run it when the poses change, then check the hero in a browser.
- `assets/`: also the logos (`assets/logo/`), icons and fonts.
  The logos and `icon.svg` are copied unchanged from the
  [Masumi Family Brand Guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide)
  (`logos/cmo-xyz/`); use each only on its approved background.

## Look

Neo-brutalist: white and black with one accent (`#FF51FF`),
3px black lines, hard 4px shadows on things you can click, and pill tags.
The line, shadow and radius scale is shared with the app (see `PROJECT.md`,
decision 10) and lives as tokens in `:root`. Headings are PP Mori
600, body text is Inter. Both fonts are served from `assets/fonts/`.

The footer toggle cycles System, Light and Dark; Light and Dark are saved in
`localStorage`, System follows the visitor's setting live. It swaps `--ink` and `--paper`; the black
bands use `--night` and stay dark; the Iris sections and the final card keep
the light palette, since Iris takes black ink and that logo is black only.

## Sign up

Main CTAs go to https://app.cmo.xyz/signup.

## Keeping the copy true

The example business, Moss & Kettle, is made up and labelled as such. Prices
are the app's Polar plans (Starter, Growth, Scale). If the plans change in
Polar, change them in the pricing section and the FAQ.
