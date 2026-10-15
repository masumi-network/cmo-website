// Bake photo-real light probes (F12): the static city's bounced light and sky at each chapter hour, on the real GPU.
// Usage: node scripts/probes.mjs
// Optional env: BASE (default http://localhost:3000), SPP (samples per direction cell, default 64).
// Writes public/probes/probes.bin.gz (12 bytes per probe per hour, lib/probes.ts) and public/probes/manifest.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3000";
const spp = Number(process.env.SPP ?? 64);
// the chapters' hours (content/day.ts); chapter 7, 06:00 tomorrow, reuses 06:00
const HOURS = [6, 7, 9, 12, 15, 18, 22];
const dir = "public/probes";
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ["--use-angle=metal", "--enable-unsafe-webgpu", "--window-position=-2400,0"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text().slice(0, 300)));
await page.goto(`${base}/?raytrace=probes&photoreal=0`);
await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
await page.waitForFunction(() => window.__probes || window.__rt?.error, null, { timeout: 120_000 });
const failed = await page.evaluate(() => window.__rt?.error);
if (failed) throw new Error(`lab: ${failed}`);
console.log("lab ready");
const grid = await page.evaluate(() => window.__probes.grid);

const blocks = [];
for (const [chapter, hour] of HOURS.entries()) {
  await page.evaluate((i) => window.scrollTo(0, document.querySelector("main > section").offsetHeight * i), chapter);
  await page.waitForFunction((h) => Math.abs(window.__probes.hour() - h) < 0.01, hour, { timeout: 60_000, polling: 250 });
  const r = await page.evaluate((n) => window.__probes.bake(n), spp);
  const bytes = Buffer.from(r.bytes, "base64");
  blocks.push({ hour, scale: r.scale, bytes });
  console.log(`${String(hour).padStart(2, "0")}:00  ${r.samples} spp  ${(r.ms / 1000).toFixed(1)} s  scale ${r.scale.toFixed(3)}  inside ${r.inside}${r.flipped ? "  (read upside down)" : ""}`);
}
await browser.close();

const raw = Buffer.concat(blocks.map((b) => b.bytes));
const gz = gzipSync(raw, { level: 9 });
writeFileSync(`${dir}/probes.bin.gz`, gz);
const hours = blocks.map((b, block) => ({ hour: b.hour, block, scale: b.scale }));
hours.push({ hour: 30, block: 0, scale: blocks[0].scale });
writeFileSync(`${dir}/manifest.json`, `${JSON.stringify({ file: "probes.bin.gz", ...grid, hours }, null, 2)}\n`);
console.log(`probes: ${grid.res.join(" x ")}, ${HOURS.length} hours, ${(raw.length / 1e6).toFixed(2)} MB raw, ${(gz.length / 1e6).toFixed(2)} MB gzipped`);
