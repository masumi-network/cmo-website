// Photo-real spike: path-trace a chapter shot on the real GPU and record the numbers.
// Usage: node scripts/raytrace-bench.mjs <out-dir> [chapter 0-7 ...]
// Optional env: BASE (default http://localhost:3000), SCALE (render scale), SPP (denoise after this many samples), DENOISE=0, POSE=0 (keep load-time poses), W, H.
// Writes <out-dir>/<chapter>-raster.png, <chapter>-<n>s.png, <chapter>-denoised.png and bench.json.
import { writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [out, ...list] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/raytrace-bench.mjs <out-dir> [chapter ...]");
const base = process.env.BASE ?? "http://localhost:3000";
const chapters = list.length ? list.map(Number) : [0];
const browser = await chromium.launch({
  headless: false,
  args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--window-position=-2400,0"],
});
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 300)));
const rt = () => page.evaluate(() => window.__rt && { ...window.__rt, reached: { ...window.__rt.reached } });
const results = [];

for (const chapter of chapters) {
  const q = new URLSearchParams({ raytrace: "" });
  for (const [k, v] of [["scale", process.env.SCALE], ["spp", process.env.SPP], ["denoise", process.env.DENOISE], ["pose", process.env.POSE]]) if (v) q.set(k, v);
  await page.goto(`${base}/?${q}`);
  await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
  await page.evaluate((i) => window.scrollTo(0, (document.body.scrollHeight / 8) * i), chapter);
  await page.addStyleTag({ content: "header, main, nav, aside, section, [role=dialog], button, form, p, h1, h2 { visibility: hidden !important; }" });
  // Let the camera settle on the shot, then freeze the WebGL city so only the tracer runs.
  await page.waitForTimeout(4000);
  await page.keyboard.press("f");
  await page.keyboard.press("r"); // hide the traced image: today's render for comparison
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${chapter}-raster.png` });
  await page.keyboard.press("r");
  const shots = {};
  for (const s of [1, 2, 4, 8, 16]) {
    for (;;) {
      const r = await rt();
      if (r?.error) throw new Error(r.error);
      if (r && r.sinceReset >= s * 1000) break;
      await page.waitForTimeout(50);
    }
    await page.screenshot({ path: `${out}/${chapter}-${s}s.png` });
    shots[s] = (await rt()).samples;
  }
  // the denoised frame, if the denoiser ran (it waits for maxSamples)
  for (let t = 0; t < 200; t++) {
    const d = await rt();
    if (d.denoisedMs) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/${chapter}-denoised.png` });
      break;
    }
    await page.waitForTimeout(100);
  }
  // a second rest: everything compiled and loaded, the steady-state cost
  const first = await rt();
  await page.keyboard.press("p");
  let again = 0;
  let restarted = false;
  for (let t = 0; t < 300 && !again; t++) {
    await page.waitForTimeout(50);
    const d = await rt();
    if (!d.denoisedMs) restarted = true;
    else if (restarted) again = d.denoisedMs;
  }
  const r = await rt();
  results.push({ chapter, denoisedMs: first.denoisedMs, reached: first.reached, denoisedAgainMs: again, reachedAgain: r.reached, poseMs: Math.round(r.poseMs), twinMs: Math.round(r.twinMs), buildMs: Math.round(r.buildMs), firstSampleMs: Math.round(r.firstSampleMs), sppAtSeconds: shots });
  console.log(JSON.stringify(results.at(-1)));
  await page.keyboard.press("f");
}
writeFileSync(`${out}/bench.json`, JSON.stringify(results, null, 2));
await browser.close();
