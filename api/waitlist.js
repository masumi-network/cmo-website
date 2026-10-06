// Serverless function (Vercel) — saves waitlist signups to a Sokosumi drive table.
//
// The Sokosumi API key is read from the SOKOSUMI_API_KEY environment variable and
// never reaches the browser. On first use this creates a "Waitlist Signups" table
// (Email, Signed up, Source); after that it just appends a row per signup.
//
// Required env var (set in Vercel → Project → Settings → Environment Variables):
//   SOKOSUMI_API_KEY   a Sokosumi API key with drive/tables access (coworker_… / sokoBot_…)

const API = "https://api.sokosumi.com/v1";
const TABLE_TITLE = "Waitlist Signups";
const TABLE_KEY = "cmo-xyz-waitlist";
const COLUMNS = [
  { name: "Email", type: "email" },
  { name: "Website", type: "url" },
  { name: "Signed up", type: "text" },
  { name: "Source", type: "text" },
];

// Cached across warm invocations so we don't re-list/create on every request.
let tableCache = null; // { id, colIdByName }

async function soko(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.SOKOSUMI_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(opts.headers || {}),
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

function colIdByName(columns) {
  const map = {};
  for (const c of columns || []) map[c.name] = c.id;
  return map;
}

async function getTable() {
  if (tableCache) return tableCache;
  // Find an existing (non-archived) table by title.
  const list = await soko("/drive/tables?limit=100");
  const found = (list && list.data ? list.data : []).find(
    (t) => t.title === TABLE_TITLE && !t.archivedAt
  );
  let table = found;
  if (!table) {
    const created = await soko("/drive/tables", {
      method: "POST",
      body: JSON.stringify({ key: TABLE_KEY, title: TABLE_TITLE, columns: COLUMNS }),
    });
    table = created.data;
  }
  tableCache = { id: table.id, cols: colIdByName(table.columns) };
  return tableCache;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  // Parse the body (Vercel usually parses JSON for us). Email required, website optional.
  let email = "";
  let website = "";
  try {
    const data = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    email = String(data.email || "").trim();
    website = String(data.website || "").trim();
  } catch (_) {
    email = "";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Please enter a valid email." });
    return;
  }

  // Let people type a bare domain (e.g. "nmkr.io") — add the scheme ourselves
  // so it stores cleanly in the URL column.
  if (website && !/^https?:\/\//i.test(website)) {
    website = "https://" + website.replace(/^\/+/, "");
  }

  // Storage not wired up yet: accept the signup so the UI works, but don't store.
  // Add SOKOSUMI_API_KEY (or SHEET_WEBHOOK_URL) and it starts saving automatically.
  if (!process.env.SOKOSUMI_API_KEY && !process.env.SHEET_WEBHOOK_URL) {
    console.log("waitlist signup (not stored — storage not configured):", email, website);
    res.status(200).json({ ok: true, stored: false });
    return;
  }

  const signedUp = new Date().toISOString();
  const source = "cmo.xyz waitlist";

  try {
    // Preferred: Sokosumi table. Fallback: a Google Sheet webhook (set either env var).
    if (process.env.SOKOSUMI_API_KEY) {
      const { id, cols } = await getTable();
      const values = {};
      if (cols["Email"]) values[cols["Email"]] = email;
      if (cols["Website"] && website) values[cols["Website"]] = website;
      if (cols["Signed up"]) values[cols["Signed up"]] = signedUp;
      if (cols["Source"]) values[cols["Source"]] = source;
      await soko(`/drive/tables/${id}/rows`, {
        method: "POST",
        body: JSON.stringify({
          key: `signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          insert: [{ values }],
        }),
      });
    } else {
      // Google Apps Script web app that appends a row to a sheet.
      const r = await fetch(process.env.SHEET_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, website, signedUp, source }),
      });
      if (!r.ok) throw new Error(`Sheet webhook ${r.status}`);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    tableCache = null; // rebuild table mapping next time in case it changed
    console.error("waitlist save failed:", e.status, JSON.stringify(e.body || e.message));
    res.status(502).json({ error: "Could not save your signup. Please try again." });
  }
};
