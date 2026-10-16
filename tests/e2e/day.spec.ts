import { expect, test, type Page } from "@playwright/test";
import { chapterIndex, chapters } from "@/content/day";

// One day in Cuso's City, end to end. Screens land in screenshots/
// so every run leaves a visual record (desktop + mobile).
// Only tests about the 3D load it. The rest use `?static`: in CI the city
// renders on the CPU, and a test that loads it for nothing is minutes slower.
// @heavy tests walk the 3D for minutes: `pnpm verify` runs them, CI skips them.
const heavy = { tag: "@heavy" };

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `screenshots/${test.info().project.name}-${name}.png` });

async function open(page: Page, query = "") {
  await page.goto(`/${query}`);
  await expect(page.getByRole("heading", { name: "Marketing, on autopilot." })).toBeVisible();
}

async function waitForCity(page: Page, timeout = 60_000) {
  await expect(page.locator("[data-scene]")).toHaveAttribute("data-scene", /ready|static/, { timeout });
}

async function goToChapter(page: Page, index: number) {
  await page.evaluate((i) => window.scrollTo({ top: i * window.innerHeight * 1.6, behavior: "instant" }), index);
}

/** Headless Chrome pauses requestAnimationFrame without input: keep the pointer moving while the scene catches up. */
async function settle(page: Page, ms: number) {
  const { width, height } = page.viewportSize()!;
  for (let end = Date.now() + ms, i = 0; Date.now() < end; i++) {
    await page.mouse.move(width / 2 + (i % 2), height - 4);
    await page.waitForTimeout(100);
  }
}

/** Wait for `check` to pass, keeping input flowing so the scene keeps rendering. */
async function until(page: Page, check: () => Promise<boolean>, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    if (await check()) return true;
    await settle(page, 400);
  }
  return check();
}

type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test("the day loads with the 3D city and Cuso", async ({ page }) => {
  await open(page);
  await waitForCity(page);
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.waitForTimeout(1500);
  await shot(page, "01-arrive");
});

test("every chapter has its card, and the HUD follows the scroll", heavy, async ({ page, isMobile }) => {
  test.slow(); // walks the whole day with the 3D city on (software WebGL in CI)
  await open(page);
  await waitForCity(page);
  const titles = ["Learns your brand", "Runs your social", "Runs your ads", "Gets you found on Google", "Sends your newsletter", "Learns while you sleep"];
  for (const [i, title] of titles.entries()) {
    await goToChapter(page, i + 1);
    await expect(page.getByRole("heading", { name: title })).toBeInViewport();
    if (!isMobile) await expect(page.getByRole("navigation", { name: "Time of day" }).locator('[aria-current="step"]')).toBeVisible();
    await page.waitForTimeout(1200);
    await shot(page, `0${i + 2}-${title.split(" ").at(-1)!.toLowerCase()}`);
  }
  await goToChapter(page, chapterIndex("join"));
  await expect(page.getByRole("heading", { name: "Your city. Your CMO." })).toBeInViewport();
  await page.waitForTimeout(1200);
  await shot(page, "09-join");
});

test("approving a draft schedules it", async ({ page }) => {
  await open(page, "?static");
  await goToChapter(page, 2);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Scheduled for Tue 09:00")).toBeVisible();
});

test("your website shows up in the city", async ({ page, isMobile }) => {
  await open(page, "?static");
  await goToChapter(page, 1);
  const site = page.getByLabel("Your website");
  await site.fill("acme.io");
  await page.getByRole("button", { name: "Learn my brand" }).click();
  test.skip(isMobile, "the ranking card is desktop only");
  await goToChapter(page, 4);
  await expect(page.getByLabel("Google ranking")).toContainText("acme.io");
});

test("the rail jumps to a chapter", async ({ page, isMobile }) => {
  test.skip(isMobile, "the rail is desktop only");
  await open(page, "?static");
  await page.getByRole("navigation", { name: "Time of day" }).getByRole("button", { name: /12:00/ }).click();
  await expect(page.getByRole("heading", { name: "Runs your ads" })).toBeInViewport();
});

test("the Ask bar never covers a card", async ({ page, isMobile }) => {
  test.skip(isMobile, "the ask bar is desktop only");
  for (const width of [1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await open(page, "?static");
    for (const id of ["learn", "social", "ads", "seo", "newsletter", "night"] as const) {
      await goToChapter(page, chapterIndex(id));
      await expect(page.getByLabel("Ask Cuso")).toBeVisible();
      // Polled: right after the scroll the bar can still sit where the last chapter wanted it.
      await expect
        .poll(async () => {
          const rects = await page.evaluate(() => {
            const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
            const bar = document.getElementById("ask-cuso")!.closest("form")!.getBoundingClientRect();
            const cards = [...document.querySelectorAll("[data-card]")].map((el) => el.getBoundingClientRect());
            return { bar: box(bar), cards: cards.filter((r) => r.width > 0 && r.bottom > 0 && r.top < window.innerHeight).map(box) };
          });
          return rects.cards.reduce((sum, card) => sum + overlap(rects.bar, card), 0);
        }, { message: `${width}px, ${id}` })
        .toBe(0);
    }
  }
});

test("Ask Cuso sends him to the right place", async ({ page, isMobile }) => {
  test.skip(isMobile, "the ask bar is desktop only");
  await open(page, "?static");
  await goToChapter(page, 1);
  await page.getByLabel("Ask Cuso").fill("can you write our newsletter?");
  await page.getByLabel("Ask Cuso").press("Enter");
  await expect(page.getByRole("heading", { name: "Sends your newsletter" })).toBeInViewport();
});

test("explore mode shows the map and a pin takes you there", heavy, async ({ page }) => {
  await open(page);
  await waitForCity(page);
  await page.getByRole("button", { name: "Explore" }).click();
  const pin = page.getByRole("button", { name: /Ads.*Union Square/ });
  await expect(pin).toBeVisible();
  await page.waitForTimeout(2500);
  await shot(page, "08-explore");
  await pin.click();
  await expect(page.getByRole("heading", { name: "Runs your ads" })).toBeInViewport();
});

test("joining the waitlist works", async ({ page }) => {
  // E2E runs a production build with no Sokosumi key, where the real route answers 503.
  // Stand in for a successful save; the route itself is covered in tests/unit/waitlist-route.test.ts.
  await page.route("**/api/waitlist", (route) => route.fulfill({ json: { ok: true } }));
  await open(page, "?static");
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  const finale = page.locator("#chapter-join");
  await finale.getByLabel("Email").fill("founder@example.com");
  await finale.getByLabel("Website (optional)").fill("example.com");
  await finale.getByRole("button", { name: "Join the waitlist" }).click();
  await expect(finale.getByRole("status")).toContainText("You're on the list");
});

test("without 3D the page still works (posters)", async ({ page }) => {
  await open(page, "?static");
  await waitForCity(page);
  await expect(page.locator("canvas")).toHaveCount(0);
  await goToChapter(page, 2);
  await expect(page.getByRole("heading", { name: "Runs your social" })).toBeInViewport();
  await shot(page, "10-static");
});

test("posters load only near the current chapter, and leave once the 3D is in", async ({ page }) => {
  const posters = page.locator("[data-scene] img");
  await open(page, "?static");
  await expect(posters).toHaveCount(2); // this chapter and the next
  await open(page);
  await waitForCity(page);
  await expect(posters).toHaveCount(0);
});

test("on a phone, Cuso stands clear of the cards in every chapter, and the cards fit", heavy, async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  // One page load per chapter in software WebGL. Each load compiles every shader on the CPU
  // (about 0.6 s per program), and the dev server is slower still: about 55 s a chapter there
  // (2026-10-16, after the backdrop, street detail and realism passes). 12 min leaves room for 8.
  test.setTimeout(720_000);
  for (const [i, chapter] of chapters.entries()) {
    // Load the page already scrolled to the chapter, so Cuso starts there:
    // at software WebGL frame rates the walk between places takes minutes.
    await open(page);
    await goToChapter(page, i);
    await waitForCity(page, 120_000); // a busy machine can take over a minute to compile
    const bubble = page.getByText(chapter.bubble); // he has arrived when he speaks
    expect(await until(page, () => bubble.isVisible(), 60_000), `${chapter.id}: Cuso arrives`).toBe(true);
    await settle(page, 2000); // the camera eases in
    const { cuso, cards, width, height, scrollWidth } = await page.evaluate(() => {
      const [left, top, right, bottom] = (document.querySelector("canvas")?.dataset.cuso ?? "").split(",").map(Number);
      const cards = [...document.querySelectorAll("[data-card]")]
        .map((c) => c.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight)
        .map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
      return { cuso: { left, top, right, bottom }, cards, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    await shot(page, `phone-${i}-${chapter.id}`);
    expect(scrollWidth, `${chapter.id}: no sideways scroll`).toBeLessThanOrEqual(width);
    expect(cuso.bottom > 0 && cuso.top < height && cuso.right > 0 && cuso.left < width, `${chapter.id}: Cuso on screen`).toBe(true);
    const area = (cuso.right - cuso.left) * (cuso.bottom - cuso.top);
    for (const card of cards) {
      expect(overlap(cuso, card) / area, `${chapter.id}: a card covers Cuso`).toBeLessThan(0.15);
      expect(card.top >= 0 && card.bottom <= height && card.left >= 0 && card.right <= width, `${chapter.id}: card fits the screen`).toBe(true);
    }
  }
});

test("on a phone, the weekly note folds open", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout");
  await open(page, "?static");
  await goToChapter(page, chapterIndex("night"));
  const toggle = page.getByRole("button", { name: "Here's what I learned this week." });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Morning posts got the most saves", { exact: false })).toBeHidden();
  await toggle.click();
  await expect(page.getByText("Morning posts got the most saves", { exact: false })).toBeVisible();
});

const sectionTop = (page: Page) => page.evaluate(() => scrollY / document.querySelector<HTMLElement>("main > section")!.offsetHeight);

async function walkMode(page: Page, on: boolean) {
  await page.getByRole("button", { name: "Settings" }).click();
  const walk = page.getByRole("switch", { name: "Walk mode" });
  if ((await walk.getAttribute("aria-checked")) !== String(on)) await walk.click();
  await expect(walk).toHaveAttribute("aria-checked", String(on));
  await page.keyboard.press("Escape");
}

test("fly mode: a scroll or a key flies one chapter and lands on it", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones swipe (next test)");
  await open(page, "?static");
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 100);
  await expect(page.getByRole("heading", { name: "Learns your brand" })).toBeInViewport();
  await expect.poll(() => sectionTop(page)).toBeCloseTo(1, 2); // on the chapter, not part way
  await page.waitForTimeout(400); // a pause: the next notch is a new gesture
  await page.mouse.wheel(0, 100);
  await expect.poll(() => sectionTop(page)).toBeCloseTo(2, 2);
  await expect(page.getByRole("navigation", { name: "Time of day" }).getByRole("button", { name: /09:00/ })).toHaveAttribute("aria-current", "step");
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => sectionTop(page)).toBeCloseTo(1, 2);
  await page.keyboard.press("End");
  await expect(page.getByRole("heading", { name: "Your city. Your CMO." })).toBeInViewport();
  await page.keyboard.press("Home");
  await expect(page.getByRole("heading", { name: "Marketing, on autopilot." })).toBeInViewport();
});

test("fly mode on a phone: one swipe, one chapter, however far the finger goes", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch");
  await open(page, "?static");
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: from }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 200, y: from + ((to - from) * i) / 8 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(700, 150);
  await expect(page.getByRole("heading", { name: "Learns your brand" })).toBeInViewport();
  await expect.poll(() => sectionTop(page)).toBeCloseTo(1, 2);
  await swipe(650, 300);
  await expect.poll(() => sectionTop(page)).toBeCloseTo(2, 2);
  await swipe(300, 650);
  await expect.poll(() => sectionTop(page)).toBeCloseTo(1, 2);
});

test("walk mode, in settings, brings back the scroll walk and is remembered", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones snap in walk mode (next test)");
  await open(page, "?static");
  await walkMode(page, true);
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(300); // the page scrolls freely, part way into the day
  await page.reload();
  await expect(page.getByRole("heading", { name: "Marketing, on autopilot." })).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("switch", { name: "Walk mode" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await walkMode(page, false);
  await page.mouse.wheel(0, 100);
  await expect.poll(() => sectionTop(page)).toBeCloseTo(1, 2); // fly again
});

test("walk mode on touch: a scroll always comes to rest on a chapter, never between two", async ({ page, isMobile }) => {
  test.skip(!isMobile, "snapping is for touch screens");
  await open(page, "?static");
  await walkMode(page, true);
  await goToChapter(page, 1);
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 500); // stops part way: snaps back into the chapter or on to the next
  await page.waitForTimeout(1500);
  const into = await page.evaluate(() => (scrollY / (innerHeight * 1.6)) % 1);
  expect(into).toBeLessThan(0.45); // the first 45% of a chapter is where the camera rests
});

test("explore: drag the map, then Recenter brings it back; pins still work", heavy, async ({ page }) => {
  test.slow(); // every pointer event waits for a frame in software WebGL
  await open(page);
  await waitForCity(page);
  await page.getByRole("button", { name: "Explore", exact: true }).click();
  await page.waitForTimeout(2500);
  const recenter = page.getByRole("button", { name: "Recenter" });
  await expect(recenter).toHaveCount(0);
  const { width, height } = page.viewportSize()!;
  const drag = async (x0: number, y0: number, dx: number, dy: number) => {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dx / 2, y0 + dy / 2);
    await page.mouse.move(x0 + dx, y0 + dy);
    await page.mouse.up();
  };
  await drag(width / 2, height * 0.6, -width / 4, -height / 8);
  await expect(recenter).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0); // the page did not scroll
  await page.waitForTimeout(1500);
  await shot(page, "11-explore-dragged");
  await recenter.click();
  await expect(recenter).toHaveCount(0);
  // A drag that starts on a pin moves the map and does not open the pin.
  const pin = page.getByRole("button", { name: /Ads.*Union Square/ });
  const box = (await pin.boundingBox())!;
  await drag(box.x + box.width / 2, box.y + box.height / 2, 40, 30);
  await expect(recenter).toBeVisible();
  await page.waitForTimeout(1500);
  await pin.click();
  await expect(page.getByRole("heading", { name: "Runs your ads" })).toBeInViewport();
});
