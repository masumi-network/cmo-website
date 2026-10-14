import { describe, expect, it } from "vitest";
import { normalizeWebsite, waitlistSchema } from "@/lib/waitlist";

describe("normalizeWebsite", () => {
  it("adds https when missing", () => {
    expect(normalizeWebsite("shop.com")).toBe("https://shop.com");
    expect(normalizeWebsite("http://shop.com/a")).toBe("http://shop.com/a");
  });

  it("allows blank", () => {
    expect(normalizeWebsite("")).toBe("");
  });

  it("rejects things that are not domains", () => {
    expect(normalizeWebsite("not a site")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
  });
});

describe("waitlistSchema", () => {
  it("accepts an email and an optional website", () => {
    expect(waitlistSchema.parse({ email: " a@b.co ", website: "b.co" })).toEqual({
      email: "a@b.co",
      website: "https://b.co",
    });
    expect(waitlistSchema.parse({ email: "a@b.co" })).toEqual({ email: "a@b.co", website: "" });
  });

  it("passes the honeypot through so the API can spot bots", () => {
    expect(waitlistSchema.parse({ email: "a@b.co", nickname: "bot" }).nickname).toBe("bot");
  });

  it("explains a bad email", () => {
    const result = waitlistSchema.safeParse({ email: "nope" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Please enter a valid email.");
  });

  it("explains a bad website", () => {
    const result = waitlistSchema.safeParse({ email: "a@b.co", website: "nope nope" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe("Please enter a valid website, or leave it blank.");
  });
});
