// Renders the posters (loading cover, no-3D fallback, the phone A/B test's
// posters half) from the live 3D city, one per chapter, desktop and phone.
// Real GPU, headed Chromium, from a running server:
//   node scripts/posters.mjs            (BASE defaults to http://localhost:3000)
// Writes public/posters/<chapter>.jpg (1440x900 at 1.5x) and <chapter>-phone.jpg (390x844 at 3x, as iPhones are).
// ONLY=phone or ONLY=desktop renders one set.
// Re-run after any change to the look, a camera shot or the cards' layout.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3000";
const out = "public/posters";
const ids = ["arrive", "learn", "social", "ads", "seo", "newsletter", "night", "join"];
const sizes = [
  { suffix: "", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 },
  // Not touch: the phone shot and layout come from the width; full quality, not lite.
  { suffix: "-phone", viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--window-position=-2400,0"] });
for (const { suffix, ...size } of sizes.filter((s) => !process.env.ONLY || (process.env.ONLY === "phone") === (s.suffix === "-phone"))) {
  for (const [i, id] of ids.entries()) {
    // A fresh page per chapter, scrolled there before the city loads, so Cuso starts on his spot.
    const page = await browser.newPage(size);
    await page.goto(`${base}/?v=3d`);
    await page.waitForSelector("main > section");
    await page.evaluate((i) => window.scrollTo({ top: i * document.querySelector("main > section").offsetHeight, behavior: "instant" }), i);
    await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
    await page.waitForTimeout(9000); // the posters fade, Cuso arrives, the camera eases in
    // Only the canvas: no cards, top bar or speech bubble (they sit over the poster anyway).
    // visibility keeps the cards' layout, so the phone camera still frames Cuso in the gap they leave.
    await page.addStyleTag({ content: "body * { visibility: hidden !important; } [data-scene] canvas { visibility: visible !important; }" });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${id}${suffix}.jpg`, type: "jpeg", quality: 78 });
    console.log(`${out}/${id}${suffix}.jpg`);
    await page.close();
  }
}
await browser.close();
