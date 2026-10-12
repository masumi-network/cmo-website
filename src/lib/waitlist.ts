// Waitlist input rules, shared by the form and the API route.
// Ported from the live site's api/waitlist.js (on main).

import { z } from "zod";

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/i;

/** Accepts a site with or without a scheme. "" when blank, null when invalid. */
export function normalizeWebsite(website: string): string | null {
  const raw = website.trim();
  if (!raw) return "";
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
  try {
    return DOMAIN.test(new URL(url).hostname) ? url : null;
  } catch {
    return null;
  }
}

export const waitlistSchema = z.object({
  email: z.string().trim().pipe(z.email({ error: "Please enter a valid email." })),
  website: z
    .string()
    .optional()
    .default("")
    .transform((value, ctx) => {
      const site = normalizeWebsite(value);
      if (site === null) {
        ctx.addIssue({ code: "custom", message: "Please enter a valid website, or leave it blank." });
        return z.NEVER;
      }
      return site;
    }),
});

export type WaitlistEntry = z.infer<typeof waitlistSchema>;
