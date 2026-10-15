// Photo-real in Explore (F12, explore-trace.tsx): time from the map coming to rest to the traced image on screen,
// on the real GPU. Opens Explore, waits for the trace, drags the map (the trace must go at once), waits again.
// Usage: node scripts/explore-bench.mjs <shots-dir>
// Optional env: BASE (default http://localhost:3000), W and H (window, default 1440 x 900), TRACE=<scale>,<samples> (dev builds: render scale, samples before denoising). Writes <dir>/explore-traced.png and explore-today.png.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const [out] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/explore-bench.mjs <shots-dir>");
mkdirSync(out, { recursive: true });
const base = process.env.BASE ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--window-position=-2400,0"] });
// W, H: the window (a width that is not a multiple of 16 checks the readback's row padding)
const page = await browser.newPage({ viewport: { width: Number(process.env.W ?? 1440), height: Number(process.env.H ?? 900) } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 300)));
await page.goto(`${base}/?photoreal${process.env.TRACE ? `&trace=${process.env.TRACE}` : ""}`);
await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
const canvas = page.locator("canvas").first();
const stats = () => page.evaluate(() => ({ ...window.__explore }));

await page.getByRole("button", { name: "Explore" }).click();
const opened = Date.now();
await canvas.waitFor();
await page.waitForFunction(() => window.__explore?.phase === "shown" || window.__explore?.phase === "failed", null, { timeout: 120_000 });
const first = { ...(await stats()), wallMs: Date.now() - opened };
await page.waitForTimeout(800);
const hide = await page.addStyleTag({ content: "header, nextjs-portal, pre { visibility: hidden !important; }" });
await page.screenshot({ path: `${out}/explore-traced.png` });
await hide.evaluate((n) => n.remove());

// drag the map: the trace goes at once
await page.mouse.move(720, 450);
await page.mouse.down();
const grabbed = Date.now();
await page.mouse.move(640, 420, { steps: 4 });
await page.waitForFunction(() => document.querySelector("canvas")?.dataset.plate !== "rest", null, { timeout: 5000 });
const dropMs = Date.now() - grabbed;
await page.mouse.move(560, 400, { steps: 8 });
await page.mouse.up();
const dropped = await page.evaluate(() => window.__explore.phase);
const before = (await stats()).traces;
const released = Date.now();
await page.waitForFunction((n) => window.__explore.traces > n, before, { timeout: 120_000 });
const second = { ...(await stats()), wallMs: Date.now() - released };
await page.waitForTimeout(800);
await page.evaluate(() => localStorage.setItem("cmo.photoreal", "off"));
await browser.close();

console.log(JSON.stringify({ first, dropMs, phaseAfterDrag: dropped, second, errors: [...new Set(errors)].slice(0, 8) }, null, 1));
