// DUMMY waitlist endpoint: validates like the real one but stores nothing.
// Before launch, port the Sokosumi write from main:api/waitlist.js
// (docs/features/waitlist.md).

import { waitlistSchema } from "@/lib/waitlist";

export async function POST(request: Request) {
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
  return Response.json({ ok: true, stored: false });
}
