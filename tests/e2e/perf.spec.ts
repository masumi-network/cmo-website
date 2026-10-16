import { expect, test, type Page } from "@playwright/test";
import { chapterIndex } from "@/content/day";

// Render cost guard: draw calls and triangles per frame (every pass: shadow,
// water mirror, glass probe, post effects) in the costliest views, under a ceiling.
// Desktop runs full mode, the phone (Pixel 7, touch) runs lite. Counts do not
// depend on the GPU, so software WebGL measures them as well as a real one.
// The median frame is checked, after the glass probe is done: it adds six heavier
// frames when the scroll stops or the mode changes, and those are not the steady cost.
// Measured 2026-10-14 (M4 Pro, production build), after the lite pass; ceilings
// leave ~15% room over the heaviest frame. Lite redraws the sun's shadow map only
// when something in it moves (atmosphere.tsx), so most of its frames are lighter still.
// If a change needs more, raise the ceiling on purpose and say why.
const CEILING = {
  full: { chapter: { calls: 350, triangles: 1_700_000 }, explore: { calls: 560, triangles: 2_150_000 } },
  lite: { chapter: { calls: 220, triangles: 730_000 }, explore: { calls: 330, triangles: 1_150_000 } },
};

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];

/** Sees the renderer through three's devtools hook: no app code. Each frame's totals, all render calls summed. */
async function watchRenderer(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __THREE_DEVTOOLS__: EventTarget; __frames: { calls: number; triangles: number }[] };
    w.__frames = [];
    w.__THREE_DEVTOOLS__ = new EventTarget();
    w.__THREE_DEVTOOLS__.addEventListener("observe", (e) => {
      const r = (e as CustomEvent).detail;
      if (!r?.isWebGLRenderer) return;
      r.info.autoReset = false;
      const tick = () => {
        w.__frames.push({ calls: r.info.render.calls, triangles: r.info.render.triangles });
        if (w.__frames.length > 120) w.__frames.shift();
        r.info.reset();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
}

/**
 * The next `count` frames (software WebGL draws about one a second). Headless
 * Chrome pauses requestAnimationFrame without input: keep the pointer moving.
 */
async function frames(page: Page, count: number) {
  const read = () => page.evaluate(() => (window as unknown as { __frames: { calls: number; triangles: number }[] }).__frames);
  await page.evaluate(() => ((window as unknown as { __frames: unknown[] }).__frames.length = 0));
  for (let end = Date.now() + 60_000, i = 0; Date.now() < end && (await read()).length < count; i++) {
    await page.mouse.move(300 + (i % 2), 300);
    await page.waitForTimeout(100);
  }
  return read();
}

test("the costliest views stay within their draw call and triangle budget", { tag: "@heavy" }, async ({ page, isMobile }) => {
  test.setTimeout(600_000); // one page load per chapter in software WebGL
  const mode = isMobile ? CEILING.lite : CEILING.full;
  await watchRenderer(page);
  // The costliest views (most triangles, most draw calls, the mirror's widest), to keep the run short.
  const views = [chapterIndex("arrive"), chapterIndex("social"), chapterIndex("newsletter"), chapterIndex("pricing"), "explore" as const];
  for (const view of views) {
    // Load already scrolled to the chapter, so Cuso starts there (the walk takes minutes in software WebGL).
    await page.goto("/?v=3d"); // phones: never the posters-only half of the A/B test
    if (view !== "explore") await page.evaluate((i) => window.scrollTo({ top: i * innerHeight * 1.6, behavior: "instant" }), view);
    await expect(page.locator("[data-scene]")).toHaveAttribute("data-scene", "ready", { timeout: 90_000 });
    if (view === "explore") await page.getByRole("button", { name: "Explore", exact: true }).click();
    // The camera eases in, and the glass probe renders its six faces, one a frame (Explore starts a new probe).
    // With only 3 here, probe frames could fill the median (lite Explore: 337 calls, 302 steady).
    await frames(page, 8);
    const seen = await frames(page, 5);
    expect(seen.length, `${view}: frames rendered`).toBeGreaterThanOrEqual(5);
    const ceiling = view === "explore" ? mode.explore : mode.chapter;
    const calls = median(seen.map((f) => f.calls));
    const triangles = median(seen.map((f) => f.triangles));
    test.info().annotations.push({ type: "cost", description: `${view}: ${calls} calls, ${triangles} triangles` });
    expect(calls, `${view}: draw calls per frame`).toBeLessThan(ceiling.calls);
    expect(triangles, `${view}: triangles per frame`).toBeLessThan(ceiling.triangles);
  }
});
