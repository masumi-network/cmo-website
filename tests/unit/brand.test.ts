import { describe, expect, it } from "vitest";
import { brandFromUrl } from "@/lib/brand";

describe("brandFromUrl", () => {
  it.each([
    ["northwindcoffee.com", "northwindcoffee"],
    ["https://www.northwind-coffee.co.uk/about", "northwind coffee"],
    ["  Shop.Acme.io ", "acme"],
    ["http://my_store.com", "my store"],
  ])("%j -> %j", (input, expected) => {
    expect(brandFromUrl(input)).toBe(expected);
  });

  it.each(["", "not a url", "localhost", "https://"])("rejects %j", (input) => {
    expect(brandFromUrl(input)).toBeNull();
  });

  it("keeps sign-sized names", () => {
    expect(brandFromUrl("averyveryveryverylongbrandname.com")?.length).toBeLessThanOrEqual(18);
  });
});
