// Serverless function (Vercel) — adds each waitlist signup as a row in the
// "CMO.xyz Waiting List" table on Sokosumi (utxo organization).
//
// Required env var (Vercel → Project → Settings → Environment Variables):
//   SOKOSUMI_API_KEY   a Sokosumi API key with access to that table
// The key never reaches the browser.

const API = "https://api.sokosumi.com/v1";
const ORG_SLUG = "utxo";
const TABLE_ID = "01a111e2-9c09-7180-9552-44161a45e89d";

// Column ids, looked up by name once and cached across warm invocations.
let columnIds = null; // { Email: "...", URL: "..." }

async function soko(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.SOKOSUMI_API_KEY}`,
      "X-Organization-Slug": ORG_SLUG,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
  if (!res.ok) {
    const err = new Error(`Sokosumi ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

async function getColumnIds() {
  if (columnIds) return columnIds;
  const table = (await soko(`/drive/tables/${TABLE_ID}`)).data;
  const ids = {};
  for (const c of table.columns || []) ids[c.name] = c.id;
  if (!ids.Email) throw new Error('Waitlist table has no "Email" column');
  columnIds = ids;
  return ids;
}

// Website is optional. Accept it with or without a scheme (add https:// when
// missing), then check it points at a real domain. Returns null if invalid.
function normalizeWebsite(website) {
  if (!website) return "";
  if (!/^https?:\/\//i.test(website)) website = "https://" + website.replace(/^\/+/, "");
  let host = "";
  try { host = new URL(website).hostname; } catch (_) {}
  const validDomain = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i.test(host);
  return validDomain ? website : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let email = "";
  let website = "";
  try {
    const data = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    email = String(data.email || "").trim();
    website = String(data.website || "").trim();
  } catch (_) {}

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Please enter a valid email." });
    return;
  }
  website = normalizeWebsite(website);
  if (website === null) {
    res.status(400).json({ error: "Please enter a valid website, or leave it blank." });
    return;
  }

  if (!process.env.SOKOSUMI_API_KEY) {
    console.error("waitlist: SOKOSUMI_API_KEY is not set; signup not saved:", email);
    res.status(503).json({ error: "Signups are paused for a moment. Please try again soon." });
    return;
  }

  try {
    const cols = await getColumnIds();
    const values = { [cols.Email]: email };
    if (cols.URL && website) values[cols.URL] = website;
    await soko(`/drive/tables/${TABLE_ID}/rows`, {
      method: "POST",
      body: JSON.stringify({
        key: `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        insert: [{ values }],
      }),
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    columnIds = null; // re-read the columns next time in case the table changed
    console.error("waitlist save failed:", e.status, JSON.stringify(e.body || e.message));
    res.status(502).json({ error: "Could not save your signup. Please try again." });
  }
};
