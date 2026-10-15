// GPU time per frame of the WebGL city at chapters' rest views, on the real GPU, 1440x900.
// Usage: CHAPTERS=ads node scripts/frame-bench.mjs [label]
// Optional env: CHAPTERS (chapter ids from src/content/day.ts, comma separated; default every chapter but
// "join"), BASE (default http://localhost:3000), FRAMES (default 120 per view).
// Each frame is timed with EXT_disjoint_timer_query_webgl2 around the whole requestAnimationFrame
// (every pass: shadows, mirror, post). Prints the median per chapter.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [label = "frame time"] = process.argv.slice(2);
const base = process.env.BASE ?? "http://localhost:3000";
const frames = Number(process.env.FRAMES ?? 120);
// the chapter ids in page order, as day.ts lists them
const ids = [...readFileSync(new URL("../src/content/day.ts", import.meta.url), "utf8").matchAll(/^ {4}id: "([a-z]+)",$/gm)].map((m) => m[1]);
const wanted = process.env.CHAPTERS?.split(",").map((s) => s.trim()) ?? ids.filter((id) => id !== "join");
for (const id of wanted) if (!ids.includes(id)) throw new Error(`no chapter "${id}" (have ${ids.join(", ")})`);

const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--window-position=-2400,0"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
if (!(await page.evaluate(() => !!window.__gl))) throw new Error("no EXT_disjoint_timer_query_webgl2 here");

const measure = async () => {
  await page.evaluate(() => (window.__times = []));
  await page.waitForFunction((n) => window.__times.length >= n, frames, { timeout: 120_000 });
  const t = (await page.evaluate(() => window.__times)).sort((a, b) => a - b);
  return +t[t.length >> 1].toFixed(2);
};

const rows = [];
for (const chapter of wanted) {
  await page.evaluate((x) => window.scrollTo(0, document.querySelector("main > section").offsetHeight * x), ids.indexOf(chapter));
  await page.waitForTimeout(8000); // Cuso walks there and the camera settles
  rows.push({ chapter, ms: await measure() });
}
await browser.close();
console.log(`${label} (median GPU ms per frame)`);
console.table(rows);
console.log(`mean ${(rows.reduce((s, r) => s + r.ms, 0) / rows.length).toFixed(2)} ms`);
