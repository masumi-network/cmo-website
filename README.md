# CMO.XYZ: Cuso's City

The new cmo.xyz: one day with Cuso, our AI CMO, in a miniature San Francisco.
Scroll and the day moves from 06:00 to 22:00. Each hour Cuso does one marketing job in front of you.

Branch `redesign/cuso-city`. The live site stays on `main` until this is approved.

```bash
pnpm install
pnpm exec playwright install chromium   # once, for e2e
pnpm dev                                # http://localhost:3000
pnpm verify                             # lint, types, unit, build, e2e
```

- Features and status: [docs/features/README.md](docs/features/README.md)
- How we verify: [docs/VERIFY.md](docs/VERIFY.md)
- Product brief: [docs/PROJECT.md](docs/PROJECT.md)
- Design direction and image prompts: [design/README.md](design/README.md)

URL flags: `?static` shows posters instead of 3D. `?lite` uses the light 3D mode.
