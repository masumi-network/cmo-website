import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { askCuso, INTENTS, MAX_REPLY, type IntentId } from "@/lib/ask";

// What visitors really type, and where Cuso should go. `undefined` = he stays put.
const CASES: [string, IntentId, string | undefined][] = [
  // Brand (07:00)
  ["What do you know about my brand?", "learn", "learn"],
  ["can you learn our brand voice", "learn", "learn"],
  ["Do you understand my audience and competitors?", "learn", "learn"],
  ["will it sound like us or like AI slop", "learn", "learn"],
  ["read my website", "learn", "learn"],
  ["brnad", "learn", "learn"],
  ["What is the Brand Brain?", "learn", "learn"],
  // Social (09:00)
  ["Can you post on Instagram for me?", "social", "social"],
  ["posting schedule?", "social", "social"],
  ["do you do tiktok", "social", "social"],
  ["LinkedIn posts for B2B", "social", "social"],
  ["Instagarm", "social", "social"],
  ["linkdin", "social", "social"],
  ["write captions for my reels", "social", "social"],
  ["Facebook", "social", "social"],
  ["social media", "social", "social"],
  ["Socail", "social", "social"],
  // Ads (12:00)
  ["How do you run my Google ads?", "ads", "ads"],
  ["Can you run my ads?", "ads", "ads"],
  ["Google", "ads", "ads"],
  ["facebook ads", "ads", "ads"],
  ["instagram ads please", "ads", "ads"],
  ["Meta", "ads", "ads"],
  ["What's my ROAS?", "ads", "ads"],
  ["manage my ad budget", "ads", "ads"],
  ["PPC campaigns", "ads", "ads"],
  ["campain", "ads", "ads"],
  ["advertisment", "ads", "ads"],
  ["googel", "ads", "ads"],
  // SEO (15:00)
  ["I want to rank higher on Google search", "seo", "seo"],
  ["SEO", "seo", "seo"],
  ["s.e.o.", "seo", "seo"],
  ["how do I get found on google?", "seo", "seo"],
  ["keywords for my blog", "seo", "seo"],
  ["more organic traffic", "seo", "seo"],
  ["serch ranking", "seo", "seo"],
  ["first page of google", "seo", "seo"],
  // Newsletter (18:00)
  ["Write our newsletter", "newsletter", "newsletter"],
  ["can you write our newsletter?", "newsletter", "newsletter"],
  ["email marketing", "newsletter", "newsletter"],
  ["E-mails to my subscribers", "newsletter", "newsletter"],
  ["emial", "newsletter", "newsletter"],
  ["newsleter", "newsletter", "newsletter"],
  ["what's a good open rate", "newsletter", "newsletter"],
  // Report (22:00)
  ["How did we do this week?", "night", "night"],
  ["weekly report", "night", "night"],
  ["show me the analytics", "night", "night"],
  ["what are my results", "night", "night"],
  ["reprot", "night", "night"],
  ["do you track performance and ROI?", "night", "night"],
  // Waitlist (finale)
  ["How do I sign up?", "join", "join"],
  ["join the waitlist", "join", "join"],
  ["wiatlist", "join", "join"],
  ["When do you launch?", "join", "join"],
  ["get started", "join", "join"],
  ["early access?", "join", "join"],
  ["can I see a demo", "join", "join"],
  // Pricing (23:00, Coit Tower)
  ["How much does it cost?", "pricing", "pricing"],
  ["pricing", "pricing", "pricing"],
  ["pricng", "pricing", "pricing"],
  ["is it free?", "pricing", "pricing"],
  ["how does billing work", "pricing", "pricing"],
  ["what's the monthly subscription", "pricing", "pricing"],
  // Not a chapter: he answers where he stands
  ["What are you?", "about", undefined],
  ["who are you", "about", undefined],
  ["Are you a real person or a bot?", "about", undefined],
  ["what is cmo.xyz", "about", undefined],
  ["what can you do?", "about", undefined],
  ["Who made you?", "maker", undefined],
  ["who founded cmo.xyz", "maker", undefined],
  ["who's the founder", "maker", undefined],
  ["How does it work?", "how", "learn"],
  ["walk me through the process", "how", "learn"],
  ["Do you integrate with other tools?", "integrations", undefined],
  ["which platforms do you connect to", "integrations", undefined],
  ["Shopify?", "tools", undefined],
  ["does it work with WordPress", "tools", undefined],
  ["hubspot integration", "tools", undefined],
  ["Is my data safe?", "privacy", undefined],
  ["privacy policy", "privacy", undefined],
  ["GDPR", "privacy", undefined],
  ["do I have to approve everything", "control", undefined],
  ["will you post without asking me?", "control", undefined],
  ["can I change the plan later", "control", undefined],
  ["Can you replace my marketing agency?", "team", undefined],
  ["should I hire a marketer", "team", undefined],
  ["How can I contact you?", "contact", "join"],
  ["talk to a human", "contact", "join"],
  // Small talk
  ["hi", "greeting", undefined],
  ["Hello!!", "greeting", undefined],
  ["hey cuso", "greeting", undefined],
  ["good morning", "greeting", undefined],
  ["thanks", "thanks", undefined],
  ["thank you so much", "thanks", undefined],
  ["cool", "thanks", undefined],
  ["bye", "bye", undefined],
  ["good night", "bye", undefined],
  ["tell me a joke", "joke", undefined],
  ["lol", "joke", undefined],
  ["you're stupid", "rude", undefined],
  ["this sucks", "rude", undefined],
  ["f*ck you", "rude", undefined],
  // Other languages: a short friendly reply in English
  ["¿Cuánto cuesta?", "language", undefined],
  ["Bonjour, comment ça marche ?", "language", undefined],
  ["Wie funktioniert das?", "language", undefined],
  ["olá, tudo bem?", "language", undefined],
  ["你好", "language", undefined],
  ["こんにちは", "language", undefined],
  ["Привет", "language", undefined],
  ["habla español?", "language", undefined],
  ["what languages do you speak", "language", undefined],
  // Nonsense
  ["asdfghjkl", "nonsense", undefined],
  ["???", "nonsense", undefined],
  ["12345", "nonsense", undefined],
  ["zzzz xkcd", "nonsense", undefined],
  // Anything else
  ["what is the meaning of life", "fallback", undefined],
  ["do you like pizza", "fallback", undefined],
  ["are you smart", "fallback", undefined],
  // Several things at once: the strongest wins, ties go to the earliest chapter
  ["hi, can you help with SEO?", "seo", "seo"],
  ["I need help with ads and SEO", "ads", "ads"],
  ["SEO and newsletter", "seo", "seo"],
  ["thanks! how much is it?", "pricing", "pricing"],
  ["Instagram posts and email", "social", "social"],
  ["hello, wie geht's? I need ads", "ads", "ads"],
];

describe("askCuso", () => {
  it("has a big table of real questions", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(80);
  });

  it.each(CASES)("%j → %s", (question, intent, chapter) => {
    const answer = askCuso(question);
    expect(answer.intent).toBe(intent);
    expect(answer.chapter).toBe(chapter);
    expect(answer.reply).toMatch(/\S/);
  });

  it("ignores empty input", () => {
    expect(askCuso("   ")).toEqual({ reply: "" });
  });

  it("does not mistake common words for typos", () => {
    const common =
      "think thing where there their about would could should people other which these those first after before today never always smart start lunch please really maybe little money month world write right light night bread posture rapport resort plans plane";
    const misread = common.split(" ").filter((word) => {
      const { intent } = askCuso(word);
      return intent !== "fallback" && intent !== "nonsense";
    });
    // A few of these are real keywords on purpose.
    expect(misread.sort()).toEqual(["night", "plans", "start"]);
  });
});

describe("Cuso's replies", () => {
  const replies = INTENTS.flatMap((i) => i.replies.map((r) => ({ intent: i.id, ...r })));

  it("every intent has two or three variants", () => {
    for (const i of INTENTS) expect(i.replies.length, i.id).toBeGreaterThanOrEqual(2);
    for (const i of INTENTS) expect(i.replies.length, i.id).toBeLessThanOrEqual(3);
  });

  it.each(replies)("$intent: $text", ({ text, suggest }) => {
    expect(text).not.toMatch(/[—–]/); // no em or en dashes
    expect(text.length).toBeLessThanOrEqual(MAX_REPLY);
    expect(text).toMatch(/^[A-Z0-9¿"]/);
    expect(text).toMatch(/[.!?]$/);
    // Chips say what the line says, and each one takes him somewhere.
    for (const label of suggest ?? []) {
      expect(text.toLowerCase()).toContain(label.toLowerCase());
      expect(askCuso(label).chapter, label).toBeDefined();
    }
  });

  it("only routes to real chapters", () => {
    const ids = new Set(chapters.map((c) => c.id));
    for (const i of INTENTS) if (i.chapter) expect(ids.has(i.chapter), i.id).toBe(true);
  });

  it("the first ads line names Union Square", () => {
    expect(askCuso("Can you run my ads?").reply).toMatch(/Union Square/);
  });

  it("rotates variants per intent, so a repeat sounds different", () => {
    const first = askCuso("seo");
    const second = askCuso("rank me", ["seo"]);
    const third = askCuso("SEO please", ["seo", "ads", "seo"]);
    expect(second.reply).not.toBe(first.reply);
    expect(third.reply).not.toBe(second.reply);
    // Other intents in the history do not move this one on.
    expect(askCuso("seo", ["ads", "social"]).reply).toBe(first.reply);
    // And it wraps around.
    const n = INTENTS.find((i) => i.id === "seo")!.replies.length;
    expect(askCuso("seo", Array(n).fill("seo")).reply).toBe(first.reply);
  });

  it("is deterministic", () => {
    expect(askCuso("what is this", ["about"])).toEqual(askCuso("what is this", ["about"]));
  });

  it("offers clickable suggestions when it does not know", () => {
    for (const q of ["what is the meaning of life", "asdfghjkl", "hola"]) {
      const { suggest } = askCuso(q);
      expect(suggest?.length, q).toBeGreaterThanOrEqual(2);
      expect(suggest?.length, q).toBeLessThanOrEqual(3);
    }
    expect(askCuso("seo").suggest).toBeUndefined();
  });
});
