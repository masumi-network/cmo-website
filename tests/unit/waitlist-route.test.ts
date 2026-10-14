import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake value only. The route must never call the real Sokosumi API in tests.
const KEY = "not-a-real-key";
const TABLE = "https://api.sokosumi.com/v1/drive/tables/01a111e2-9c09-7180-9552-44161a45e89d";
const columns = { data: { columns: [{ name: "Email", id: "col-email" }, { name: "URL", id: "col-url" }] } };

type Handler = (req: Request) => Promise<Response>;
let POST: Handler;
let fetchMock: ReturnType<typeof vi.fn>;
let errorLog: ReturnType<typeof vi.spyOn>;

/** A fake Sokosumi: answers the table lookup and the row insert. */
function sokosumi({ rowStatus = 200, rowBody = { data: {} } as unknown } = {}) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url === TABLE && !init.method) return Response.json(columns);
    if (url === `${TABLE}/rows` && init.method === "POST") return Response.json(rowBody, { status: rowStatus });
    return new Response("not found", { status: 404 });
  });
}

const post = (body: unknown, ip = "1.2.3.4") =>
  POST(
    new Request("http://test/api/waitlist", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "Content-Type": "application/json", "x-forwarded-for": `${ip}, 10.0.0.1` },
    }),
  );

const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);
const rowSent = (i = 0) => JSON.parse(calls(`${TABLE}/rows`)[i][1].body as string);

beforeEach(async () => {
  vi.resetModules(); // fresh column cache and rate limit per test
  ({ POST } = await import("@/app/api/waitlist/route"));
  fetchMock = sokosumi();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SOKOSUMI_API_KEY", KEY);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("POST /api/waitlist: storing", () => {
  it("writes the email and website as a row in the Sokosumi table", async () => {
    const res = await post({ email: " a@b.co ", website: "b.co" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const [, init] = calls(`${TABLE}/rows`)[0];
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}`, "X-Organization-Slug": "utxo" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const row = rowSent();
    expect(row.key).toMatch(/^signup-/);
    expect(row.insert).toEqual([{ values: { "col-email": "a@b.co", "col-url": "https://b.co" } }]);
  });

  it("leaves the URL column out when no website is given", async () => {
    await post({ email: "a@b.co" });
    expect(rowSent().insert).toEqual([{ values: { "col-email": "a@b.co" } }]);
  });

  it("keeps a website that already has a scheme", async () => {
    await post({ email: "a@b.co", website: "http://shop.com/a" });
    expect(rowSent().insert[0].values["col-url"]).toBe("http://shop.com/a");
  });

  it("looks up the columns once and caches them", async () => {
    await post({ email: "a@b.co" });
    await post({ email: "c@d.co" });
    expect(calls(TABLE)).toHaveLength(1);
    expect(calls(`${TABLE}/rows`)).toHaveLength(2);
  });

  it("reads the columns again after a failed save", async () => {
    fetchMock = sokosumi({ rowStatus: 500 });
    vi.stubGlobal("fetch", fetchMock);
    await post({ email: "a@b.co" });
    await post({ email: "a@b.co" });
    expect(calls(TABLE)).toHaveLength(2);
  });
});

describe("POST /api/waitlist: failures", () => {
  it("returns 502 on a Sokosumi error and keeps its details out of the response", async () => {
    fetchMock = sokosumi({ rowStatus: 500, rowBody: { message: "internal detail xyz" } });
    vi.stubGlobal("fetch", fetchMock);
    const res = await post({ email: "a@b.co" });
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Could not save your signup. Please try again." });
    expect(text).not.toContain("internal detail");
    expect(text).not.toContain(KEY);
    expect(errorLog).toHaveBeenCalled();
    expect(JSON.stringify(errorLog.mock.calls)).toContain("internal detail xyz");
  });

  it("returns 502 when the table has no Email column", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: { columns: [] } })));
    const res = await post({ email: "a@b.co" });
    expect(res.status).toBe(502);
  });

  it("returns 504 when Sokosumi times out", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")));
    const res = await post({ email: "a@b.co" });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: "Could not save your signup. Please try again." });
  });

  it("rejects a bad email with a readable message", async () => {
    const res = await post({ email: "nope" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please enter a valid email." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a bad website", async () => {
    const res = await post({ email: "a@b.co", website: "not a site" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Please enter a valid website, or leave it blank." });
  });

  it("rejects non JSON", async () => {
    const res = await post("{");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/waitlist: missing key", () => {
  beforeEach(() => vi.stubEnv("SOKOSUMI_API_KEY", ""));

  it("in development, accepts the signup without storing it and says so in the log", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await post({ email: "a@b.co" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, stored: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).toContain("SOKOSUMI_API_KEY");
  });

  it("in production, returns 503 with a friendly message", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await post({ email: "a@b.co" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Signups are paused for a moment. Please try again soon." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/waitlist: abuse", () => {
  it("quietly drops a signup that filled the honeypot", async () => {
    const res = await post({ email: "a@b.co", nickname: "bot" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits each IP to 10 tries per 10 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 10; i++) expect((await post({ email: "nope" })).status).toBe(400);

    const limited = await post({ email: "a@b.co" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("600");
    expect(await limited.json()).toEqual({ error: "Too many tries. Please wait a few minutes." });

    expect((await post({ email: "a@b.co" }, "5.6.7.8")).status).toBe(200); // another IP is fine

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect((await post({ email: "a@b.co" })).status).toBe(200); // the window resets
  });
});
