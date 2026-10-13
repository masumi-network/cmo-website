// Close-up screenshots of the 3D city from the dev server, on the real GPU.
// Usage: node scripts/shot.mjs <out-dir> name=px,py,pz,tx,ty,tz [name=...]
// Optional env: BASE (default http://localhost:3000), HOUR (chapter index 0-7 to scroll to), W, H.
import { chromium } from "@playwright/test";

const [out, ...views] = process.argv.slice(2);
if (!out || !views.length) throw new Error("usage: node scripts/shot.mjs <out-dir> name=px,py,pz,tx,ty,tz ...");
const base = process.env.BASE ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--window-position=-2400,0"] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
for (const view of views) {
  const [name, cam] = view.split("=");
  await page.goto(`${base}/?cam=${cam}`);
  await page.waitForSelector('[data-scene="ready"]', { timeout: 120_000 });
  if (process.env.HOUR) {
    await page.evaluate((i) => window.scrollTo(0, (document.body.scrollHeight / 8) * Number(i)), process.env.HOUR);
  }
  // Hide the HTML layer over the canvas; keep the mouse moving so frames keep coming.
  await page.addStyleTag({ content: "header, main, nav, aside, section, [role=dialog], button, form, p, h1, h2 { visibility: hidden !important; }" });
  for (let i = 0; i < 30; i++) {
    await page.mouse.move(100 + (i % 2) * 5, 100);
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${out}/${name}.png`);
}
await browser.close();
