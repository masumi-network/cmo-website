import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/waitlist/route";

const post = (body: string) =>
  POST(new Request("http://test/api/waitlist", { method: "POST", body, headers: { "Content-Type": "application/json" } }));

describe("POST /api/waitlist (dummy)", () => {
  it("accepts a valid signup without storing it", async () => {
    const res = await post(JSON.stringify({ email: "a@b.co", website: "b.co" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: false });
  });

  it("rejects a bad email with a readable message", async () => {
    const res = await post(JSON.stringify({ email: "nope" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please enter a valid email." });
  });

  it("rejects non JSON", async () => {
    const res = await post("{");
    expect(res.status).toBe(400);
  });
});
