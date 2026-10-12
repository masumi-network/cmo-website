import { expect, test, type Page } from "@playwright/test";

// One day in Cuso's City, end to end. Screens land in screenshots/
// so every run leaves a visual record (desktop + mobile).

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

test("the day loads with the 3D city and Cuso", async ({ page }) => {
  await open(page);
  await waitForCity(page);
  await expect(page.locator("canvas")).toHaveCount(1);
  await page.waitForTimeout(1500);
  await shot(page, "01-arrive");
});

test("every chapter has its card, and the HUD follows the scroll", async ({ page, isMobile }) => {
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
});

test("approving a draft schedules it", async ({ page }) => {
  await open(page);
  await goToChapter(page, 2);
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Scheduled for Tue 09:00")).toBeVisible();
});

test("your website shows up in the city", async ({ page, isMobile }) => {
  await open(page);
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
  await open(page);
  await page.getByRole("navigation", { name: "Time of day" }).getByRole("button", { name: /12:00/ }).click();
  await expect(page.getByRole("heading", { name: "Runs your ads" })).toBeInViewport();
});

test("Ask Cuso sends him to the right place", async ({ page, isMobile }) => {
  test.skip(isMobile, "the ask bar is desktop only");
  await open(page);
  await goToChapter(page, 1);
  await page.getByLabel("Ask Cuso").fill("can you write our newsletter?");
  await page.getByLabel("Ask Cuso").press("Enter");
  await expect(page.getByRole("heading", { name: "Sends your newsletter" })).toBeInViewport();
});

test("explore mode shows the map and a pin takes you there", async ({ page, isMobile }) => {
  test.skip(isMobile, "the Story/Explore switch is desktop only");
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
  await open(page);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  const finale = page.locator("#chapter-join");
  await finale.getByLabel("Email").fill("founder@example.com");
  await finale.getByLabel("Website (optional)").fill("example.com");
  await page.waitForTimeout(1200);
  await shot(page, "09-join");
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
