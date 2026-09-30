# CMO.XYZ website

Marketing site for **CMO.XYZ**, an AI agent that automates a business's
marketing, end to end, in one system.

Built against the CMO.XYZ Style Guide `DESIGN.md` (version: alpha). Visual
direction is **premium dark**, with structure inspired by
[workos.com/atlas](https://workos.com/atlas).

## Run it

No build step. Serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Sections

Hero, channel strip, "See it work" (chat mockup), Capabilities (bento),
How it works, Your agent (avatar picker), Who it's for, CTA, footer.

## Motion

- **Lenis** smooth scroll + **GSAP / ScrollTrigger** entrance animations.
  Libraries are bundled locally in `vendor/` (no CDN dependency).
- **Cursor companion**: a small mascot trails the real pointer, leans into
  motion, and grows over interactive elements. On-brand because the mascot
  is a cursor.
- All motion is disabled under `prefers-reduced-motion`, and the site is
  fully visible if the animation libraries fail to load.

## Mascot assets

The "The Cursor" mascot poses in `assets/` are transparent cutouts made from
the source sheet (`~/Downloads/COMXYZ_Mascot.jpeg`). Used poses:
`mascot-hero`, `expr-happy`, `act-creating`, `expr-excited`, `var-1..6`.

## Following DESIGN.md

- **Voice/tone (locked):** copy is plain, direct, tied to the user's data;
  no em dashes or hyphens; chat lines are verbatim from the guide.
- **Typeface (locked):** PP Mori is set first in the stack; not bundled
  (license/source TBD), falls back to a neutral system stack.
- **Scope:** in-scope capabilities shown; Newsletter is dimmed and tagged
  "Roadmap", not built.
- **Agent naming:** nothing hardcodes an agent name.

## Temporary placeholders (per DESIGN.md, colors/shapes are OPEN)

The dark palette is kept **strictly neutral grayscale** (no invented brand
color), and the mascot is a placeholder avatar candidate. All of it is
flagged as temporary in `styles.css`. Do not treat as final brand.
