import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";

describe("day content", () => {
  it("has unique chapter ids", () => {
    const ids = chapters.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("moves forward in time", () => {
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].hour).toBeGreaterThan(chapters[i - 1].hour);
    }
  });

  it("has a poster image for every chapter (fallback when 3D is off)", () => {
    for (const c of chapters) {
      expect(existsSync(join(process.cwd(), "public", c.poster)), c.poster).toBe(true);
      const phone = c.poster.replace(/\.jpg$/, "-phone.jpg");
      expect(existsSync(join(process.cwd(), "public", phone)), phone).toBe(true);
    }
  });

  it("follows the voice rules: no em dashes in copy", () => {
    for (const c of chapters) {
      expect(`${c.title} ${c.body} ${c.bubble}`).not.toMatch(/—/);
    }
  });
});
