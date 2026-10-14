// Adds each waitlist signup as a row in the "CMO.xyz Waiting List" table on
// Sokosumi (utxo organization). Ported from main:api/waitlist.js.
//
// Env (server only, never reaches the browser):
//   SOKOSUMI_API_KEY   a Sokosumi API key with access to that table.
// Without it, development accepts signups without storing them, and
// production answers 503 so nobody thinks they signed up.

import { waitlistSchema } from "@/lib/waitlist";

const API = "https://api.sokosumi.com/v1";
const ORG_SLUG = "utxo";
const TABLE_ID = "01a111e2-9c09-7180-9552-44161a45e89d";
const TIMEOUT_MS = 8_000; // per Sokosumi call

// Basic per-IP guard. In memory, so each server instance keeps its own count
// and a cold start resets it. Enough to stop a single noisy client, not a botnet.
const LIMIT = 10;
const WINDOW_MS = 10 * 60 * 1000;
const tries = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (tries.size > 1000) for (const [key, t] of tries) if (t.resetAt <= now) tries.delete(key);
  const t = tries.get(ip);
  if (!t || t.resetAt <= now) {
    tries.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  t.count += 1;
  return t.count > LIMIT;
}

class SokosumiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Sokosumi ${status}`);
  }
}

async function soko(key: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "X-Organization-Slug": ORG_SLUG,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) throw new SokosumiError(res.status, body);
  return body;
}

// Column ids, looked up by name once and cached across warm invocations.
let columnIds: Record<string, string> | null = null;

async function getColumnIds(key: string): Promise<Record<string, string>> {
  if (columnIds) return columnIds;
  const table = (await soko(key, `/drive/tables/${TABLE_ID}`)) as { data?: { columns?: { name: string; id: string }[] } };
  const ids: Record<string, string> = {};
  for (const c of table.data?.columns ?? []) ids[c.name] = c.id;
  if (!ids.Email) throw new Error('Waitlist table has no "Email" column');
  columnIds = ids;
  return ids;
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return Response.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429, headers: { "Retry-After": String(WINDOW_MS / 1000) } });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Please send JSON." }, { status: 400 });
  }
  const parsed = waitlistSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { email, website, nickname } = parsed.data;

  if (nickname) {
    console.warn("waitlist: honeypot filled, signup dropped");
    return Response.json({ ok: true }); // look like success so the bot moves on
  }

  const key = process.env.SOKOSUMI_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      console.error("waitlist: SOKOSUMI_API_KEY is not set; signup refused");
      return Response.json({ error: "Signups are paused for a moment. Please try again soon." }, { status: 503 });
    }
    console.warn("waitlist: SOKOSUMI_API_KEY is not set; signup accepted but not stored (dev)");
    return Response.json({ ok: true, stored: false });
  }

  try {
    const cols = await getColumnIds(key);
    const values: Record<string, string> = { [cols.Email]: email };
    if (cols.URL && website) values[cols.URL] = website;
    await soko(key, `/drive/tables/${TABLE_ID}/rows`, {
      method: "POST",
      body: JSON.stringify({ key: `signup-${crypto.randomUUID()}`, insert: [{ values }] }),
    });
    return Response.json({ ok: true });
  } catch (e) {
    columnIds = null; // re-read the columns next time in case the table changed
    // AbortSignal.timeout rejects with a DOMException named TimeoutError.
    const timedOut = typeof e === "object" && e !== null && "name" in e && e.name === "TimeoutError";
    const detail = e instanceof SokosumiError ? `${e.status} ${JSON.stringify(e.body).slice(0, 500)}` : String(e);
    console.error("waitlist: save failed:", detail);
    return Response.json({ error: "Could not save your signup. Please try again." }, { status: timedOut ? 504 : 502 });
  }
}
