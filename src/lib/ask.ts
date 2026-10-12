// DUMMY "Ask Cuso". Keyword routing with canned replies, so the interaction
// can be designed and tested now. Replace with a real model before launch
// (docs/features/ask-cuso.md).

import type { ChapterId } from "@/content/day";

export type Answer = { reply: string; chapter?: ChapterId };

const ROUTES: { chapter: ChapterId; words: RegExp; reply: string }[] = [
  { chapter: "ads", words: /\b(ads?|advert\w*|meta|facebook|ppc|budget|campaigns?)\b/, reply: "Ads? Follow me to Union Square." },
  { chapter: "seo", words: /\b(seo|rank\w*|search|found)\b/, reply: "Let's climb. SEO lives at the top of the pyramid." },
  { chapter: "social", words: /\b(social|instagram|tiktok|linkedin|posts?|posting)\b/, reply: "Posts are my morning job. Come see." },
  { chapter: "newsletter", words: /\b(newsletter|email|emails|mail)\b/, reply: "Newsletters go out at six. Hop on." },
  { chapter: "learn", words: /\b(brand|voice|tone|website|audience)\b/, reply: "First I learn your brand. Here's how." },
  { chapter: "night", words: /\b(report|results?|week|numbers|learn(ed)?|did we do)\b/, reply: "Every week I tell you what worked. Here's one." },
  { chapter: "join", words: /\b(sign ?up|waitlist|join|price|pricing|start)\b/, reply: "I'm almost ready. Let me save you a spot." },
];

export function askCuso(question: string): Answer {
  const q = question.trim().toLowerCase();
  if (!q) return { reply: "" };
  // "Google" alone is ambiguous: ads unless the question is about search.
  if (/\bgoogle\b/.test(q) && !ROUTES[1].words.test(q)) return { chapter: "ads", reply: ROUTES[0].reply };
  const route = ROUTES.find((r) => r.words.test(q));
  if (route) return { chapter: route.chapter, reply: route.reply };
  return { reply: "Good question. I'm still learning that one. Try asking about posts, ads, SEO or email." };
}
