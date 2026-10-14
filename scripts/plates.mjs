// Bake photo-real plates (F12): each chapter's rest view, path-traced without the live objects, on the real GPU.
// Usage: node scripts/plates.mjs <check-dir> [chapter 0-7 ...]
// Optional env: BASE (default http://localhost:3000), SPP (default 128), CHECK=1 (only the check, no bake).
// Writes public/plates/ch<i>.webp and public/plates/manifest.json (lib/plates.ts), then
// <check-dir>/<i>-photoreal.png (?photoreal, at rest on the plate) and <i>-today.png, at 1440x900.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [out, ...list] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/plates.mjs <check-dir> [chapter ...]");
const base = process.env.BASE ?? "http://localhost:3000";
const chapters = list.length ? list.map(Number) : [0, 1, 2, 3, 4, 5, 6, 7];
const dir = "public/plates";
const manifestPath = `${dir}/manifest.json`;
mkdirSync(dir, { recursive: true });
mkdirSync(out, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { range: 2, plates: [] };

const browser = await chromium.launch({
  headless: false,
  args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--window-position=-2400,0"],
});
// Only the canvases: no HUD, speech bubbles, stats panel or dev badge.
const HIDE = "body * { visibility: hidden !important; } canvas { visibility: visible !important; }";

/** Opens a chapter and waits for the camera to set off (up to 5 s) and then not move for a second (it eases in). */
async function open(page, query, chapter) {
  page.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 300)));
  // outside the lab, read the camera from three's devtools hook: the one drawing the city
  await page.addInitScript(() => {
    if (window.__THREE_DEVTOOLS__) return;
    window.__THREE_DEVTOOLS__ = new EventTarget();
    window.__THREE_DEVTOOLS__.addEventListener("observe", (e) => {
      const r = e.detail;
      if (!r?.isWebGLRenderer || r.__hooked) return;
      r.__hooked = true;
      const render = r.render.bind(r);
      r.render = (scene, camera) => {
        if (camera?.isPerspectiveCamera && scene.children.length > 5) window.__cityCamera = camera;
        return render(scene, camera);
      };
    });
    window.__rtCamera ??= () => window.__cityCamera?.matrixWorld.elements.map((v) => Math.round(v * 1e4));
  });
  await page.goto(`${base}/?${query}`);
  await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
  await page.evaluate((i) => window.scrollTo(0, (document.body.scrollHeight / 8) * i), chapter);
  await page.addStyleTag({ content: HIDE });
  await page.evaluate(
    () =>
      new Promise((done, fail) => {
        const first = JSON.stringify(window.__rtCamera?.());
        let moving = false;
        let last = "";
        let still = 0;
        let ticks = 0;
        const t = setInterval(() => {
          const now = JSON.stringify(window.__rtCamera?.());
          // the camera may wait a moment for Cuso to set off: give it up to 5 s to start, then wait for it to stop
          moving ||= now !== first || ticks > 50;
          still = moving && now === last ? still + 1 : 0;
          last = now;
          // a camera that never settles (Cuso still walking, a drifting shot) gets no plate: fail in 60 s, not hang
          if (++ticks > 600) fail(clearInterval(t) ?? new Error("the camera did not come to rest in 60 s"));
          if (still >= 10) done(clearInterval(t));
        }, 100);
      }),
  );
}

const results = [];
for (const chapter of chapters) {
  try {
    await chapterRun(chapter);
  } catch (e) {
    results.push({ chapter, error: String(e).split("\n")[0] });
    console.log(JSON.stringify(results.at(-1)));
  }
}
writeFileSync(`${out}/plates.json`, JSON.stringify(results, null, 2));
await browser.close();

async function chapterRun(chapter) {
  // bake: 2:1 at twice the pixels (3456 x 1728), so any desktop screen shows a sharp middle
  const t0 = Date.now();
  const file = `ch${chapter}.webp`;
  if (!process.env.CHECK) {
    const bake = await browser.newPage({ viewport: { width: 1728, height: 864 } });
    await open(bake, `raytrace=plate&dpr=2&spp=${process.env.SPP ?? 128}`, chapter);
    await bake.keyboard.press("f");
    await bake.waitForFunction(() => window.__plate || window.__rt?.error, null, { timeout: 300_000, polling: 500 });
    const plate = await bake.evaluate(() => {
      if (window.__rt?.error) throw new Error(window.__rt.error);
      return window.__plate;
    });
    await bake.close();
    writeFileSync(`${dir}/${file}`, Buffer.from(plate.webp, "base64"));
    manifest.plates = [...manifest.plates.filter((p) => p.chapter !== chapter), { ...plate.entry, chapter, file }].sort((a, b) => a.chapter - b.chapter);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  const bakeMs = Date.now() - t0;

  // check: photo-real at rest on the plate, next to today's frame
  const view = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await open(view, "photoreal", chapter);
  const phase = await view.waitForFunction(() => document.querySelector("canvas")?.dataset.plate === "rest", null, { timeout: 15_000 }).then(
    () => "rest",
    () => view.evaluate(() => document.querySelector("canvas")?.dataset.plate ?? "none"),
  );
  await view.screenshot({ path: `${out}/${chapter}-photoreal.png` });
  await view.close();
  const today = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await open(today, "", chapter);
  await today.screenshot({ path: `${out}/${chapter}-today.png` });
  await today.close();

  results.push({ chapter, file, kb: Math.round(statSync(`${dir}/${file}`).size / 1024), bakeS: Math.round(bakeMs / 1000), phase });
  console.log(JSON.stringify(results.at(-1)));
}
