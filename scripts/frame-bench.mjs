// GPU time per frame of the WebGL city at each chapter's rest view, on the real GPU, 1440x900.
// Usage: node scripts/frame-bench.mjs [label]
// Optional env: BASE (default http://localhost:3000), FRAMES (default 120 per view), SWITCH=1 (also time each view
// with photo-real switched off, same page, same frame: the photo-real light probes' own cost).
// Plates are blocked, so at rest the city draws live as it does while moving. Each frame is timed with
// EXT_disjoint_timer_query_webgl2 around the whole requestAnimationFrame (every pass: shadows, mirror, post).
import { chromium } from "@playwright/test";

const [label = "frame time"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:3000";
const frames = Number(process.env.FRAMES ?? 120);
const both = process.env.SWITCH === "1";

const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--window-position=-2400,0"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("**/plates/manifest.json", (r) => r.abort());
await page.addInitScript(() => {
  // the city's context: the first WebGL 2 one on the page with a timer query
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (type === "webgl2" && ctx && !window.__gl && this.isConnected) {
      const ext = ctx.getExtension("EXT_disjoint_timer_query_webgl2");
      if (ext) window.__gl = { ctx, ext };
    }
    return ctx;
  };
  window.__times = [];
  const raf = window.requestAnimationFrame.bind(window);
  const pending = [];
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const g = window.__gl;
      if (!g) return cb(t);
      const { ctx, ext } = g;
      while (pending.length && ctx.getQueryParameter(pending[0], ctx.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        if (!ctx.getParameter(ext.GPU_DISJOINT_EXT)) window.__times.push(ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6);
        ctx.deleteQuery(q);
      }
      const q = ctx.createQuery();
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try {
        cb(t);
      } finally {
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
      }
    });
});
await page.goto(base);
// photo-real on through the settings switch's storage, so the switch can turn it off below
await page.evaluate(() => localStorage.setItem("cmo.photoreal", "on"));
await page.reload();
await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
if (!(await page.evaluate(() => !!window.__gl))) throw new Error("no EXT_disjoint_timer_query_webgl2 here");

const flip = async () => {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("switch", { name: "Photo-real light" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500); // the probes fade out (or in) in about half a second
};
const measure = async () => {
  await page.evaluate(() => (window.__times = []));
  await page.waitForFunction((n) => window.__times.length >= n, frames, { timeout: 120_000 });
  const t = (await page.evaluate(() => window.__times)).sort((a, b) => a - b);
  return +t[t.length >> 1].toFixed(2);
};

const rows = [];
for (let chapter = 0; chapter < 7; chapter++) {
  await page.evaluate((x) => window.scrollTo(0, document.querySelector("main > section").offsetHeight * x), chapter);
  await page.waitForTimeout(8000);
  const row = { chapter, on: await measure() };
  if (both) {
    await flip();
    row.off = await measure();
    row.added = +(row.on - row.off).toFixed(2);
    await flip();
  }
  rows.push(row);
}
await browser.close();
console.log(`${label} (median GPU ms per frame)`);
console.table(rows);
const mean = (k) => (rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
console.log(both ? `mean: on ${mean("on")}, off ${mean("off")}, added ${mean("added")} ms` : `mean ${mean("on")} ms`);
