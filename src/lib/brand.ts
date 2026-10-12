// Turn a website into a short brand name for signs in the city.

const MAX = 18;

export function brandFromUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const parts = host.replace(/^www\./, "").split(".").filter(Boolean);
  if (parts.length < 2) return null;
  // example.co.uk -> example
  const shortTld = parts.length >= 3 && parts.at(-1)!.length === 2 && parts.at(-2)!.length <= 3;
  const label = parts.at(shortTld ? -3 : -2)!;
  const name = label.replace(/[-_]+/g, " ").trim();
  return name ? name.slice(0, MAX).trim() : null;
}
