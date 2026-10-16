// Measuring the signup funnel. Events go to GA only when the root layout
// loaded it (NEXT_PUBLIC_GA_ID), so dev and tests send nothing.
// Event names and params: docs/features/waitlist.md.

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

type Params = Record<string, string | number | boolean>;

/** Sent with every event: which half of the phone test this visit is in. */
let context: Params = {};
export const setTrackContext = (params: Params) => (context = params);

export function track(event: string, params: Params = {}) {
  window.gtag?.("event", event, { ...params, ...context });
}

export type PhoneVariant = "3d" | "posters";
const KEY = "cmo.v";

/**
 * The A/B test on phones: the live 3D city, or the posters only (rendered
 * from the same shots, scripts/posters.mjs). Half and half, kept per visitor;
 * `?v=3d` or `?v=posters` forces one.
 */
export function phoneVariant(search: string, random = Math.random): PhoneVariant {
  const forced = new URLSearchParams(search).get("v");
  if (forced === "3d" || forced === "posters") return forced;
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "3d" || kept === "posters") return kept;
  } catch {}
  const picked: PhoneVariant = random() < 0.5 ? "posters" : "3d";
  try {
    localStorage.setItem(KEY, picked);
  } catch {}
  return picked;
}
