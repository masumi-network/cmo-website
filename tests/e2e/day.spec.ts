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

async function waitForCity(page: Page) {
  await expect(page.locator("[data-scene]")).toHaveAttribute("data-scene", /ready|static/, { timeout: 60_000 });
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

test("joining the waitlist works (dummy API)", async ({ page }) => {
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
  test.setTimeout(400_000); // one page load per chapter in software WebGL
  for (const [i, chapter] of chapters.entries()) {
    // Load the page already scrolled to the chapter, so Cuso starts there:
    // at software WebGL frame rates the walk between places takes minutes.
    await open(page);
    await goToChapter(page, i);
    await waitForCity(page);
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

test("on touch, a scroll always comes to rest on a chapter, never between two", async ({ page, isMobile }) => {
  test.skip(!isMobile, "snapping is for touch screens");
  await open(page, "?static");
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
