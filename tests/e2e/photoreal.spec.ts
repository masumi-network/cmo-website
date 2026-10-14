import { expect, test } from "@playwright/test";

// Photo-real mode (F12): behind ?photoreal, on desktop. At rest on a chapter with a
// plate (public/plates), the plate fades in and the city turns into a shadow catcher
// (data-plate: off, fade, rest); scrolling on brings the city back at once. Chapter 1
// has no plate yet.
test.describe("photo-real plates", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  test("rests on chapter 0's plate and leaves it when scrolling on", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

    await page.goto("/?photoreal");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    const canvas = page.locator("canvas").first();
    await expect(canvas).toHaveAttribute("data-plate", "rest", { timeout: 60_000 });

    // chapter 1's plate is held back (docs/features/photoreal.md): the city as usual
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 8));
    await expect(canvas).toHaveAttribute("data-plate", "off");
    await page.waitForTimeout(3000);
    await expect(canvas).toHaveAttribute("data-plate", "off");
    expect(errors).toEqual([]);
  });

  test("is off without the flag", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("canvas").first()).not.toHaveAttribute("data-plate");
  });
});
