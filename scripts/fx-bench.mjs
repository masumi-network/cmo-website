// Photo-real spike: GPU time per frame of each screen-space effect chain (src/scene/fx-lab.ts).
// Usage: node scripts/fx-bench.mjs <out-dir> [chapter 0-7 ...]
// Optional env: BASE (default http://localhost:3000), CHAINS (comma list), W, H.
// Writes <out-dir>/<chapter>-<chain>.png and fx.json.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [out, ...list] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/fx-bench.mjs <out-dir> [chapter ...]");
const base = process.env.BASE ?? "http://localhost:3000";
const chapters = list.length ? list.map(Number) : [0];
const chains = (process.env.CHAINS ?? "base,gtao,ssr,ssgi,ssgi+traa").split(",");
const browser = await chromium.launch({
  headless: false,
  // developer features: full-precision GPU timestamps
  args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--enable-webgpu-developer-features", "--window-position=-2400,0"],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 300)));
const rt = () => page.evaluate(() => window.__rt && { ...window.__rt });
const results = [];

for (const chapter of chapters) {
  for (const chain of chains) {
    await page.goto(`${base}/?raytrace=fx&fx=${encodeURIComponent(chain)}`);
    await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
    await page.evaluate((i) => window.scrollTo(0, (document.body.scrollHeight / 8) * i), chapter);
    await page.addStyleTag({ content: "header, main, nav, aside, section, [role=dialog], button, form, p, h1, h2 { visibility: hidden !important; }" });
    await page.waitForTimeout(4000);
    await page.keyboard.press("f"); // freeze the WebGL city: only the WebGPU chain draws
    const start = (await rt())?.fxFrames ?? 0;
    for (let t = 0; t < 600; t++) {
      const r = await rt();
      if (r?.error) throw new Error(r.error);
      if ((r?.fxFrames ?? 0) - start >= 150) break;
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: `${out}/${chapter}-${chain}.png` });
    const r = await rt();
    results.push({ chapter, chain, gpuMs: r?.fxMs ?? null });
    console.log(JSON.stringify(results.at(-1)));
  }
}
writeFileSync(`${out}/fx.json`, JSON.stringify(results, null, 2));
await browser.close();
