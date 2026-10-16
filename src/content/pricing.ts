// The plans, as on the live cmo.xyz (read 2026-10-16). Shown at 23:00 (the
// pricing chapter, day.ts) by components/pricing.tsx.

export type PlanId = "intern" | "manager" | "chief";

export type Plan = {
  id: PlanId;
  name: string;
  price: string;
  /** After the price: "/mo", or nothing for a custom plan. */
  per: string;
  /** Who it is for. */
  for: string;
  features: string[];
  popular?: boolean;
  /** No link: joins the waitlist (flies to the finale). A link: opens it. */
  cta: { label: string; href?: string };
};

export const plans: readonly Plan[] = [
  {
    id: "intern",
    name: "Intern",
    price: "$300",
    per: "/mo",
    for: "For founders who are just starting out.",
    features: ["Standard AI usage, reset each month", "Daily market research", "Social posts written and scheduled", "Images and graphics", "Google and Meta ads", "Basic SEO for your site"],
    cta: { label: "Join the waitlist" },
  },
  {
    id: "manager",
    name: "Manager",
    price: "$800",
    per: "/mo",
    for: "For small teams and agencies.",
    features: ["Everything in Intern", "4x more AI usage", "Full SEO strategy", "Priority support"],
    popular: true,
    cta: { label: "Join the waitlist" },
  },
  {
    id: "chief",
    name: "Chief",
    price: "Custom",
    per: "",
    for: "Need something special? We build a plan just for you.",
    features: ["Everything in Manager", "Tools built for you", "We set it all up with you"],
    cta: { label: "Schedule a call", href: "https://cal.com/patricktobler" },
  },
];

export const adSpendNote = "Ad spend is not included. You pay platforms like Google and Meta directly.";
