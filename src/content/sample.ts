// Dummy data for the demo. Replace with real data before launch (see
// docs/features). Nothing here comes from a real customer.

export const sampleBrand = {
  website: "northwindcoffee.com",
  brain: [
    { label: "Voice", value: "Warm, plain, a little funny" },
    { label: "Audience", value: "Remote workers who love good coffee" },
    { label: "Products", value: "Single origin beans, subscriptions" },
    { label: "Competitors", value: "Reading…", pending: true },
  ],
};

export const sampleDraft = {
  channel: "Instagram",
  when: "Tue 09:00",
  caption: "Fresh roast, fresh week. Our Ethiopia Guji is back. 20% off until Sunday.",
  image: "/concepts/03-social.jpg",
};

export const sampleAds = {
  roas: "3.8×",
  change: "+42%",
  ads: [
    { name: "Weekend sale", note: "Budget raised", spend: "$820", winning: true },
    { name: "Morning ritual", note: "Paused, not selling", spend: "$420", winning: false },
  ],
};

export const sampleRanking = {
  query: "coffee subscription",
  results: [
    { rank: 1, site: "yours", change: "▲ 12" },
    { rank: 2, site: "Competitor A" },
    { rank: 3, site: "Competitor B" },
  ],
};

export const sampleNewsletter = {
  subject: "Your October update",
  audience: "To 2,480 people",
  preview: "New roast, new mugs, and a little something for our regulars.",
  openRate: 48,
};

export const sampleWeeklyNote = {
  week: "Week 42",
  items: [
    "Morning posts got the most saves. I'll post at 8 from now on.",
    "The weekend sale ad sells. I moved more budget to it.",
    "More people search for \"cold brew\". I'm writing a page for it.",
  ],
};
