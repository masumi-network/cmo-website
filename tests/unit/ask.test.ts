import { describe, expect, it } from "vitest";
import { askCuso } from "@/lib/ask";

describe("askCuso (dummy)", () => {
  it.each([
    ["Can you post on Instagram for me?", "social"],
    ["How do you run my Google ads?", "ads"],
    ["I want to rank higher on Google search", "seo"],
    ["Write our newsletter", "newsletter"],
    ["What do you know about my brand?", "learn"],
    ["How did we do this week?", "night"],
    ["How do I sign up?", "join"],
  ])("routes %j to %s", (question, chapter) => {
    const answer = askCuso(question);
    expect(answer.chapter).toBe(chapter);
    expect(answer.reply.length).toBeGreaterThan(0);
  });

  it("answers anything else without moving", () => {
    const answer = askCuso("what is the meaning of life");
    expect(answer.chapter).toBeUndefined();
    expect(answer.reply).toMatch(/\S/);
  });

  it("ignores empty input", () => {
    expect(askCuso("   ")).toEqual({ reply: "" });
  });
});
