// The WebGPU renderer spike: GPU time per frame of each chapter's view, today (WebGL) and on WebGPU (webgpu-lab.ts).
// Usage: node scripts/webgpu-bench.mjs [chapter 0-7 ...]
// Optional env: BASE (default http://localhost:3000), FRAMES (default 120).
// WebGL: EXT_disjoint_timer_query_webgl2 around each frame, the WebGPU lab off. WebGPU: timestamp queries, with
// the WebGL city frozen (the lab's F key), three ways: everything (ports + post), no post chain, no TSL ports.
// Plates are blocked and photo-real is off, so both draw the city live as it is while moving.
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3000";
const frames = Number(process.env.FRAMES ?? 120);
const chapters = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [0, 1, 2, 3, 4, 5, 6, 7];

const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--enable-webgpu-developer-features", "--window-position=-2400,0"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("**/plates/manifest.json", (r) => r.abort());
await page.addInitScript(() => {
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
  window.__cpu = [];
  // CPU: only the WebGL renderer's own calls, summed per frame (scene, shadows, mirror, post), not the app's frame logic
  window.__renderMs = 0;
  window.__THREE_DEVTOOLS__ = new EventTarget();
  window.__THREE_DEVTOOLS__.addEventListener("observe", (e) => {
    const r = e.detail;
    if (!r?.isWebGLRenderer || r.__timed) return;
    r.__timed = true;
    const render = r.render.bind(r);
    r.render = (...a) => {
      const t0 = performance.now();
      try {
        return render(...a);
      } finally {
        window.__renderMs += performance.now() - t0;
      }
    };
  });
  const raf = window.requestAnimationFrame.bind(window);
  const pending = [];
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const g = window.__gl;
      if (!g || window.__gpu?.on) return cb(t);
      const { ctx, ext } = g;
      while (pending.length && ctx.getQueryParameter(pending[0], ctx.QUERY_RESULT_AVAILABLE)) {
        const q = pending.shift();
        // every requestAnimationFrame callback is timed; the lab's own (no WebGL work) reads about 0: only the city's frames count
        const ms = ctx.getQueryParameter(q, ctx.QUERY_RESULT) / 1e6;
        if (!ctx.getParameter(ext.GPU_DISJOINT_EXT) && ms > 0.2) window.__times.push(ms);
        ctx.deleteQuery(q);
      }
      const q = ctx.createQuery();
      ctx.beginQuery(ext.TIME_ELAPSED_EXT, q);
      window.__renderMs = 0;
      try {
        cb(t);
      } finally {
        if (window.__renderMs > 0) window.__cpu.push(window.__renderMs);
        ctx.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(q);
      }
    });
});
await page.goto(`${base}/?raytrace=webgpu&photoreal=0`);
await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
await page.waitForFunction(() => window.__gpu || window.__rt?.error, null, { timeout: 120_000 });
const failed = await page.evaluate(() => window.__rt?.error);
if (failed) throw new Error(`lab: ${failed}`);
const info = await page.evaluate(() => ({ ported: window.__gpu.ported, glsl: window.__gpu.glsl }));

const median = (t) => +[...t].sort((a, b) => a - b)[t.length >> 1].toFixed(2);
const webgl = async () => {
  await page.evaluate(() => ((window.__times = []), (window.__cpu = [])));
  await page.waitForFunction((n) => window.__times.length >= n, frames, { timeout: 120_000 });
  return { gpu: median(await page.evaluate(() => window.__times)), cpu: median(await page.evaluate(() => window.__cpu)) };
};
const webgpu = async (port, post, drop = "") => {
  await page.evaluate(([port, post, drop]) => Object.assign(window.__gpu, { port, post, drop, frames: 0 }), [port, post, drop]);
  await page.waitForFunction((n) => window.__gpu.frames >= n, frames, { timeout: 120_000 });
  return page.evaluate(() => ({ gpu: window.__gpu.ms, cpu: window.__gpu.cpu }));
};

const rows = [];
for (const chapter of chapters) {
  await page.evaluate(() => (window.__gpu.on = false));
  await page.evaluate((x) => window.scrollTo(0, document.querySelector("main > section").offsetHeight * x), chapter);
  await page.waitForTimeout(8000);
  const before = await webgl();
  await page.keyboard.press("f"); // freeze the WebGL city: WebGPU draws the same frame
  await page.evaluate(() => (window.__gpu.on = true));
  const full = await webgpu(true, true);
  const row = { chapter, webgl: before.gpu, webgpu: full.gpu, "webgpu no post": (await webgpu(true, false)).gpu, "webgpu no ports": (await webgpu(false, true)).gpu };
  if (process.env.PARTS === "1") for (const drop of ["msaa", "bloom", "tilt", "all", "fxaa"]) row[`no ${drop}`] = (await webgpu(true, true, drop)).gpu;
  await page.evaluate(() => (window.__gpu.on = false));
  await page.keyboard.press("f");
  // WebGL again: the GPU's clock moves with load, so a second reading shows how far the numbers drift
  const after = await webgl();
  Object.assign(row, { "webgl again": after.gpu, "cpu webgl": before.cpu, "cpu webgpu": full.cpu });
  rows.push(row);
}
await browser.close();
console.log(`ms per frame, median of ${frames} (1440x900, ${info.ported} meshes ported; left out of WebGPU, GLSL only: ${info.glsl.join(", ")})`);
console.table(rows);
const mean = (k) => (rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(2);
console.log(`mean GPU: webgl ${mean("webgl")} (again ${mean("webgl again")}), webgpu ${mean("webgpu")}, without post ${mean("webgpu no post")}, without ports ${mean("webgpu no ports")}; CPU: webgl ${mean("cpu webgl")}, webgpu ${mean("cpu webgpu")}`);
