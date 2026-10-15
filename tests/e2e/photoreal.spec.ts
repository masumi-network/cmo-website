import { expect, test } from "@playwright/test";

// Photo-real mode (F12): on by itself on WebGPU desktops, a settings switch, ?photoreal to force it. At rest on a chapter with a
// plate (public/plates), the plate fades in and the city turns into a shadow catcher
// (data-plate: off, fade, rest); scrolling on brings the city back at once. Every
// chapter has a plate; between chapters there is none.
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
    // the baked light probes (public/probes) loaded and in use
    await expect(canvas).toHaveAttribute("data-probes", "on");

    // half-way between chapters 3 and 4: no plate, the city lit by the probes
    await page.evaluate(() => window.scrollTo(0, document.querySelector<HTMLElement>("main > section")!.offsetHeight * 3.5));
    await expect(canvas).toHaveAttribute("data-plate", "off");
    await expect(canvas).toHaveAttribute("data-probes", "on");
    await page.waitForTimeout(3000);
    await expect(canvas).toHaveAttribute("data-plate", "off");
    expect(errors).toEqual([]);
  });

  test("is off with ?photoreal=0", async ({ page }) => {
    await page.goto("/?photoreal=0");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("canvas").first()).not.toHaveAttribute("data-plate");
  });

  // On by itself where the GPU has a WebGPU adapter (headless Chrome may not); the switch decides either way.
  test("the settings switch turns it on and off, and remembers", async ({ page }) => {
    test.slow(); // two page loads in software WebGL
    await page.goto("/");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    const canvas = page.locator("canvas").first();
    const toggle = page.getByRole("switch", { name: "Photo-real light" });
    await page.getByRole("button", { name: "Settings" }).click();
    if ((await toggle.getAttribute("aria-checked")) === "false") await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(canvas).toHaveAttribute("data-plate", "rest", { timeout: 60_000 });

    await toggle.click();
    await expect(canvas).not.toHaveAttribute("data-plate");
    await expect(canvas).toHaveAttribute("data-probes", "off");
    await page.reload();
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("switch", { name: "Photo-real light" })).toHaveAttribute("aria-checked", "false");
    await page.waitForTimeout(2000);
    await expect(canvas).not.toHaveAttribute("data-plate");
  });
});

test.describe("photo-real in Explore", () => {
  test.skip(({ isMobile }) => isMobile, "desktop only");

  // The live trace needs a WebGPU adapter, which headless Chrome lacks: the map must stay as it is, without errors.
  // Tracing itself is measured on the real GPU: scripts/explore-bench.mjs.
  test("without WebGPU the map stays as it is", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?photoreal");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    await page.getByRole("button", { name: "Explore" }).click();
    // software WebGL is slow: the map takes a while to come to rest, then the tracer finds no adapter
    await expect.poll(() => page.evaluate(() => (window as Window & { __explore?: { phase: string } }).__explore?.phase), { timeout: 60_000 }).toBe("failed");
    await expect(page.locator("canvas").first()).not.toHaveAttribute("data-plate", "rest");
    expect(errors).toEqual([]);
  });
});

test.describe("photo-real on phones", () => {
  test.skip(({ isMobile }) => !isMobile, "phones only");

  test("never runs and has no settings", async ({ page }) => {
    await page.goto("/?photoreal");
    await expect(page.locator('[data-scene="ready"]')).toBeAttached({ timeout: 120_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator("canvas").first()).not.toHaveAttribute("data-plate");
    await expect(page.locator("canvas").first()).not.toHaveAttribute("data-probes");
    await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
  });
});
