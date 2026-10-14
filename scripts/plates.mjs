// Photo-real spike: bake pre-traced chapter plates, then check them composited with the live objects.
// Usage: node scripts/plates.mjs <check-dir> [chapter 0-7 ...]
// Optional env: BASE (default http://localhost:3000), SPP (default 256), W, H.
// Writes public/lab/plates/ch<i>-<w>x<h>.{png,f32,json} (gitignored), then
// <check-dir>/<i>-composite.png, <i>-webgl.png and plates.json.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [out, ...list] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/plates.mjs <check-dir> [chapter ...]");
const base = process.env.BASE ?? "http://localhost:3000";
const chapters = list.length ? list.map(Number) : [0];
const W = Number(process.env.W ?? 1440);
const H = Number(process.env.H ?? 900);
const dir = "public/lab/plates";
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({
  headless: false,
  args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--enable-webgpu-developer-features", "--window-position=-2400,0"],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 300)));
// Only the canvases: no HUD, speech bubbles, stats panel or dev badge in a plate.
const HIDE = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";

async function open(mode, chapter, extra = "") {
  await page.goto(`${base}/?raytrace=${mode}${extra}`);
  await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
  await page.evaluate((i) => window.scrollTo(0, (document.body.scrollHeight / 8) * i), chapter);
  await page.addStyleTag({ content: HIDE });
  // the camera eases in: wait until it has not moved for a second
  await page.evaluate(
    () =>
      new Promise((done) => {
        let last = "";
        let still = 0;
        const t = setInterval(() => {
          const now = JSON.stringify(window.__rtCamera?.() ?? "");
          still = now === last ? still + 1 : 0;
          last = now;
          if (still >= 10) {
            clearInterval(t);
            done();
          }
        }, 100);
      }),
  );
}

const results = [];
for (const chapter of chapters) {
  // bake: trace the static city, denoise, read its depth
  const t0 = Date.now();
  await open("plate", chapter, process.env.SPP ? `&spp=${process.env.SPP}` : "");
  await page.keyboard.press("f");
  await page.waitForFunction(() => window.__plate || window.__rt?.error, null, { timeout: 300_000, polling: 250 });
  const plate = await page.evaluate(() => {
    if (window.__rt?.error) throw new Error(window.__rt.error);
    return window.__plate;
  });
  const name = `ch${chapter}-${plate.camera.w}x${plate.camera.h}`;
  await page.screenshot({ path: `${dir}/${name}.png` });
  writeFileSync(`${dir}/${name}.f32`, Buffer.from(plate.depth, "base64"));
  writeFileSync(`${dir}/${name}.json`, JSON.stringify(plate.camera));
  const bakeMs = Date.now() - t0;

  // check: the plate with the live objects over it, next to today's WebGL frame
  await open("plates", chapter);
  await page.waitForTimeout(1500);
  const panel = await page.evaluate(() => document.querySelector("pre")?.textContent ?? "");
  await page.screenshot({ path: `${out}/${chapter}-composite.png` });
  await page.keyboard.press("r");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${chapter}-webgl.png` });
  const r = await page.evaluate(() => window.__rt);
  const kb = (ext) => Math.round(statSync(`${dir}/${name}.${ext}`).size / 1024);
  results.push({ chapter, name, bakeMs, showing: panel.includes("showing"), compositeGpuMs: r?.fxMs ?? null, pngKB: kb("png"), depthKB: kb("f32") });
  console.log(JSON.stringify(results.at(-1)));
}
writeFileSync(`${out}/plates.json`, JSON.stringify(results, null, 2));
await browser.close();
