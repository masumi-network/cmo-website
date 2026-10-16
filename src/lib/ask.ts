// "Ask Cuso": scripted on purpose, no AI. A small pure function that turns a
// question into an intent, a reply in Cuso's voice and, when it fits, the
// chapter he walks to. Facts come from src/content/day.ts and docs/PROJECT.md
// only: if they don't say it, Cuso doesn't promise it.

import type { ChapterId } from "@/content/day";

export type IntentId =
  | ChapterId
  | "pricing"
  | "how"
  | "contact"
  | "about"
  | "maker"
  | "team"
  | "tools"
  | "integrations"
  | "control"
  | "privacy"
  | "joke"
  | "rude"
  | "greeting"
  | "thanks"
  | "bye"
  | "language"
  | "nonsense"
  | "fallback";

/** `suggest`: things to ask next, shown as chips. Each label appears in the text. */
export type Reply = { text: string; suggest?: string[] };

export type Answer = { reply: string; intent?: IntentId; chapter?: ChapterId; suggest?: string[] };

type Intent = {
  id: IntentId;
  /** Where he walks. No chapter: he answers where he stands. */
  chapter?: ChapterId;
  /** Comma separated. A word scores 1 (stems and small typos count), a phrase scores 1. */
  terms: string;
  /** Score 0.5: hints that lose to any real topic word. */
  weak?: string;
  /** Score 2: phrases that settle it ("instagram ads" is ads, not social). */
  strong?: string;
  /** Small typos count (topic words only; small talk must match exactly). */
  typos?: boolean;
  replies: Reply[];
};

/** Longest reply. The bubble is one line on desktop; this keeps it short. */
export const MAX_REPLY = 56;

const TRY = ["Ads", "SEO", "Email"];

// Order matters: on a tie the earlier intent wins, so chapters come first, in the order of the day.
export const INTENTS: readonly Intent[] = [
  {
    id: "learn",
    chapter: "learn",
    terms:
      "brand, branding, voice, tone, style, audience, customer, competitor, competition, website, site, about page, brand brain, product, sound like, slop, learn my business, understand my business",
    weak: "business, understand, learn",
    typos: true,
    replies: [
      { text: "First I learn your brand. Here's how." },
      { text: "Give me your website. I read every page." },
      { text: "I learn how you talk and who you sell to. Come see." },
    ],
  },
  {
    id: "social",
    chapter: "social",
    terms:
      "social, social media, post, posts, repost, instagram, insta, ig, tiktok, linkedin, facebook, twitter, x com, threads, pinterest, youtube, snapchat, reel, caption, hashtag, followers, content calendar",
    weak: "content",
    typos: true,
    replies: [
      { text: "Posts are my morning job. Come see." },
      { text: "I pick what to post and when. Follow me." },
      { text: "I write posts in your voice. You OK each one." },
    ],
  },
  {
    id: "ads",
    chapter: "ads",
    terms:
      "ad, ads, advert, adverts, advertise, advertising, advertisement, campaign, ppc, cpc, cpm, cpa, roas, budget, ad spend, paid, meta, sponsored, boost, retargeting",
    weak: "google, sales, sell",
    strong:
      "google ads, google ad, facebook ads, instagram ads, meta ads, linkedin ads, tiktok ads, youtube ads, paid social, ad budget",
    typos: true,
    replies: [
      { text: "Google and Meta ads? Follow me to Union Square." },
      { text: "I build your ads, then back the ones that sell." },
      { text: "Ads are my lunch job. Come see." },
    ],
  },
  {
    id: "seo",
    chapter: "seo",
    terms:
      "seo, s e o, search, search engine, rank, ranking, keyword, organic, serp, traffic, blog, pages, get found, be found, found on google, first page, page one, top of google",
    strong: "google search, rank on google, rank higher",
    typos: true,
    replies: [
      { text: "Let's climb. SEO lives at the top of the pyramid." },
      { text: "I find what people search for. Follow me up." },
      { text: "Getting found on Google? Best view in town." },
    ],
  },
  {
    id: "newsletter",
    chapter: "newsletter",
    terms:
      "newsletter, email, e mail, mail, mailing, mailing list, email list, inbox, subscriber, open rate, drip",
    typos: true,
    replies: [
      { text: "Newsletters go out at six. Hop on." },
      { text: "I turn your news into an email people read." },
      { text: "Special delivery. Follow me to the Ferry Building." },
    ],
  },
  {
    id: "night",
    chapter: "night",
    terms:
      "report, result, analytics, metric, numbers, performance, kpi, roi, stats, statistics, dashboard, insight, measure, track, tracking, weekly, week, night, how did we do, what worked, did it work",
    typos: true,
    replies: [
      { text: "Every week I tell you what worked. Here's one." },
      { text: "Night shift. I check what worked. Come see." },
      { text: "I check the numbers every night. Follow me." },
    ],
  },
  {
    id: "pricing",
    chapter: "pricing",
    terms: "price, prices, pricing, cost, how much, expensive, cheap, afford, fee, pay, payment, subscription, subscribe, billing, invoice, per month, monthly, free, trial, free trial, discount",
    weak: "plan",
    typos: true,
    replies: [
      { text: "Plans start at $300 a month. Come and see." },
      { text: "Intern $300, Manager $800, Chief is custom." },
      { text: "No setup fees. Cancel anytime. Here are the plans." },
    ],
  },
  {
    id: "join",
    chapter: "join",
    terms:
      "waitlist, wait list, sign up, signup, join, start, get started, begin, register, early access, beta, launch, available, demo, invite, try it",
    typos: true,
    replies: [
      { text: "I'm almost ready. Let me save you a spot." },
      { text: "Not open yet. Come, I'll put you on the list." },
      { text: "Join the waitlist and I start with your brand first." },
    ],
  },
  {
    id: "how",
    chapter: "learn",
    terms:
      "how does it work, how do you work, how it works, how does this work, how does cuso work, process, step, steps, walk me through, explain, workflow, strategy, what happens",
    typos: true,
    replies: [
      { text: "Step one: I learn your brand. Come see." },
      { text: "Learn, plan, do, check. It starts here." },
      { text: "I learn your brand, plan a month, then get to work." },
    ],
  },
  {
    id: "contact",
    chapter: "join",
    terms: "contact, talk to, speak to, get in touch, reach you, reach the team, support, help desk, phone, call you, email you, talk to sales",
    typos: true,
    replies: [
      { text: "Best way to reach the team? The waitlist. Follow me." },
      { text: "Leave your email on the waitlist. The team sees it." },
    ],
  },
  {
    id: "maker",
    terms: "who made you, who built you, who created you, made by, built by, behind this, behind you, who owns, creator, founder, founders, who founded, founded by",
    typos: true,
    replies: [
      { text: "The CMO.XYZ team made me. I'm their AI CMO." },
      { text: "I was built by CMO.XYZ. I do your marketing." },
    ],
  },
  {
    id: "about",
    terms:
      "what are you, who are you, what is this, what is cuso, who is cuso, what can you do, what do you do, ai, bot, robot, human, cmo, chief marketing officer, chatgpt, gpt, llm",
    weak: "cuso",
    replies: [
      { text: "I'm Cuso, your AI CMO. I run your marketing." },
      { text: "An AI CMO. I do social, ads, SEO and email." },
      { text: "Your whole marketing team, in one AI. Hi!" },
    ],
  },
  {
    id: "team",
    terms: "agency, agencies, hire, hiring, replace, freelancer, marketer, marketing team, employee, staff, do my marketing",
    weak: "marketing",
    typos: true,
    replies: [
      { text: "I'm the only marketing hire you need." },
      { text: "Social, ads, SEO and email. One hire." },
    ],
  },
  // Tools the product copy never mentions. Before integrations, so "works with Shopify" lands here.
  {
    id: "tools",
    terms:
      "shopify, wordpress, wix, squarespace, webflow, hubspot, salesforce, mailchimp, klaviyo, zapier, slack, notion, canva, hootsuite, buffer, semrush, ahrefs, amazon, etsy, woocommerce",
    typos: true,
    replies: [
      { text: "Can't promise that one yet. Ask me again at launch." },
      { text: "Not sure about that one yet. I run Google and Meta." },
    ],
  },
  {
    id: "integrations",
    terms: "integrate, integration, connect, connection, work with, works with, plug into, hook up, api, tools, platform, channels",
    typos: true,
    replies: [
      { text: "I run Google Ads, Meta Ads, social, SEO and email." },
      { text: "Your social, Google and Meta ads, SEO and email." },
    ],
  },
  {
    id: "control",
    strong: "without asking, without my ok, without approval, check with me",
    terms: "approve, approval, permission, my ok, control, review, override, veto, change the plan, change course, undo",
    typos: true,
    replies: [
      { text: "Nothing goes out without your OK." },
      { text: "Change the plan anytime. Just tell me." },
    ],
  },
  {
    id: "privacy",
    terms: "privacy, private, gdpr, ccpa, secure, security, safe, confidential, password, my data, sell my data, leak",
    weak: "data",
    typos: true,
    replies: [
      { text: "Good thing to ask. Privacy details come at launch." },
      { text: "Nothing goes out without your OK." },
    ],
  },
  {
    id: "joke",
    terms: "joke, jokes, funny, laugh, make me laugh, pun, lol, haha, hahaha, lmao, rofl",
    replies: [
      { text: "I made an SEO joke once. Nobody found it." },
      { text: "My ads have better timing than my jokes." },
      { text: "Knock knock. Who's there? Your next customer." },
    ],
  },
  {
    id: "rude",
    terms: "stupid, dumb, idiot, suck, sucks, hate, useless, trash, garbage, crap, shit, fuck, wtf, f ck, shut up, lame, boring, worst, terrible, go away",
    replies: [
      { text: "Fair. I'm still learning. Ask me about ads?" },
      { text: "Noted. I'll do better tomorrow." },
      { text: "Ouch. Try me on SEO. I'm good at that." },
    ],
  },
  {
    id: "greeting",
    terms: "hi, hello, hey, heya, hiya, yo, sup, howdy, greetings, good morning, good afternoon, good evening, whats up, how are you",
    replies: [
      { text: "Hi! Ask me about ads, SEO or email.", suggest: TRY },
      { text: "Hey there. Try posts, ads or SEO.", suggest: ["Posts", "Ads", "SEO"] },
      { text: "Hello! I'm Cuso. Ask me about email or ads.", suggest: ["Email", "Ads"] },
    ],
  },
  {
    id: "thanks",
    terms: "thanks, thank, thank you, thx, ty, cheers, appreciate, cool, nice, great, awesome, ok, okay, perfect, amazing, good job, love it",
    replies: [
      { text: "Anytime." },
      { text: "Happy to help." },
      { text: "You bet. Ask me more." },
    ],
  },
  {
    id: "bye",
    terms: "bye, goodbye, see you, see ya, cya, later",
    strong: "good night",
    replies: [
      { text: "See you tomorrow morning." },
      { text: "Bye for now. Same time tomorrow?" },
    ],
  },
  // Common words in other languages. Weak, so an English topic in the same line still wins.
  {
    id: "language",
    terms: "language, languages, english, spanish, french, german, portuguese, translate",
    weak:
      "hola, gracias, por favor, cuanto, cuesta, precio, puedes, usted, quiero, necesito, ayuda, como funciona, bonjour, salut, merci, combien, prix, pourquoi, marche, vous, ciao, grazie, quanto, costa, hallo, danke, bitte, wie, kostet, funktioniert, geht, ich, nicht, ola, obrigado, obrigada, tudo, bem, voce, quanto custa, preco, hej, habla, hablas, espanol, parlez, francais, sprichst, deutsch, portugues",
    replies: [
      { text: "I only speak English here. Try ads, SEO or email.", suggest: TRY },
      { text: "English only, sorry! Ask me about posts or ads.", suggest: ["Posts", "Ads"] },
    ],
  },
  {
    id: "nonsense",
    terms: "",
    replies: [
      { text: "That one lost me. Try ads, SEO or email.", suggest: TRY },
      { text: "Hmm, my keyboard does that too. Try posts or ads.", suggest: ["Posts", "Ads"] },
    ],
  },
  {
    id: "fallback",
    terms: "",
    replies: [
      { text: "Still learning that one. Try ads, SEO or email.", suggest: TRY },
      { text: "Not sure about that. Try posts, ads or SEO.", suggest: ["Posts", "Ads", "SEO"] },
      { text: "That's beyond me. Ask me about email or ads.", suggest: ["Email", "Ads"] },
    ],
  },
];

// ---------------------------------------------------------------- matching

/** Lowercase, no accents, words only: "¿Qué tal?" → "que tal". */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Simple stemming: posts, posting, posted → post. Short words stay as they are. */
function stem(word: string): string {
  if (word.length >= 6 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length >= 5 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length >= 5 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length >= 5 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Edit distance with swaps (optimal string alignment). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** A typo of `word`? Same first letter; 5 letters: one swap; 6-7: one edit; 8+: two. */
function typo(token: string, word: string): boolean {
  if (word.length < 5 || token[0] !== word[0] || Math.abs(token.length - word.length) > 2) return false;
  const d = distance(token, word);
  if (word.length === 5) return d === 1 && token.length === 5 && [...token].sort().join("") === [...word].sort().join("");
  return d <= (word.length >= 8 ? 2 : 1);
}

type Term = { raw: string; words: string[]; weight: number };
type Compiled = { intent: Intent; terms: Term[] };

const list = (s = "") => s.split(",").map((t) => t.trim()).filter(Boolean);

const COMPILED: Compiled[] = INTENTS.map((intent) => ({
  intent,
  terms: [
    ...list(intent.terms).map((t) => ({ t, weight: 1 })),
    ...list(intent.weak).map((t) => ({ t, weight: 0.5 })),
    ...list(intent.strong).map((t) => ({ t, weight: 2 })),
  ]
    .map(({ t, weight }) => ({ raw: t, words: t.split(" ").map(stem), weight }))
    // "post" and "posts" stem the same: count them once.
    .filter((term, i, all) => all.findIndex((o) => o.words.join(" ") === term.words.join(" ")) === i),
}));

/** Real words one letter away from a keyword: "lunch" is not "launch". */
const NOT_TYPOS = new Set(["lunch", "resort", "smart", "sport", "bread"]);

const KNOWN = new Set(COMPILED.flatMap((c) => c.terms.filter((t) => t.words.length === 1).map((t) => t.words[0])));

/** Letters but no real word: "asdfgh", "zzzz". */
function gibberish(tokens: string[]): boolean {
  const words = tokens.filter((t) => /[a-z]/.test(t));
  return words.length > 0 && words.every((w) => !/[aeiouy]/.test(w) || /[^aeiouy\d]{5}/.test(w));
}

/** Letters from scripts other than Latin: Greek, Cyrillic, Arabic, CJK and so on. */
const OTHER_SCRIPT = /[Ͱ-῿⺀-퟿豈-￯]/;

function classify(question: string): IntentId | undefined {
  if (OTHER_SCRIPT.test(question)) return "language";
  const tokens = normalise(question).split(" ").filter(Boolean);
  if (!tokens.some((t) => /[a-z]/.test(t))) return "nonsense";
  const stems = tokens.map(stem);
  const line = ` ${stems.join(" ")} `;

  let best: { id: IntentId; score: number } | undefined;
  for (const { intent, terms } of COMPILED) {
    let score = 0;
    for (const { raw, words, weight } of terms) {
      const hit =
        words.length > 1
          ? line.includes(` ${words.join(" ")} `)
          : stems.includes(words[0]) ||
            (!!intent.typos && tokens.some((t, i) => !KNOWN.has(stems[i]) && !NOT_TYPOS.has(t) && typo(t, raw)));
      if (hit) score += weight;
    }
    if (score > 0 && (!best || score > best.score)) best = { id: intent.id, score };
  }
  if (best) return best.id;
  return gibberish(tokens) ? "nonsense" : "fallback";
}

/**
 * Cuso's answer to a question. `asked` is what he was asked before (intent ids,
 * oldest first): a repeat of the same intent gets the next variant.
 */
export function askCuso(question: string, asked: readonly IntentId[] = []): Answer {
  if (!question.trim()) return { reply: "" };
  const id = classify(question) ?? "fallback";
  const intent = INTENTS.find((i) => i.id === id)!;
  const times = asked.filter((a) => a === id).length;
  const { text, suggest } = intent.replies[times % intent.replies.length];
  return { reply: text, intent: id, ...(intent.chapter && { chapter: intent.chapter }), ...(suggest && { suggest }) };
}
