"use client";

import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { chapterIndex } from "@/content/day";
import { askCuso } from "@/lib/ask";
import { useCity } from "@/lib/store";

export function AskBar({ onGo, className }: { onGo: (index: number) => void; className?: string }) {
  const [question, setQuestion] = useState("");
  const reply = useCity((s) => s.reply);
  const say = useCity((s) => s.say);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const answer = askCuso(question);
    if (!answer.reply) return;
    say(answer.reply);
    if (answer.chapter) onGo(chapterIndex(answer.chapter));
    setQuestion("");
  }

  return (
    <form onSubmit={submit} className={cn("flex h-15 items-center gap-2 rounded-full bg-card py-2 pr-2 pl-5 shadow-[0_10px_40px_rgb(17_17_20/0.1)]", className)}>
      <label htmlFor="ask-cuso" className="sr-only">
        Ask Cuso
      </label>
      <input
        id="ask-cuso"
        type="text"
        autoComplete="off"
        placeholder="Ask Cuso anything…"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-card-foreground outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="icon" aria-label="Send to Cuso">
        <ArrowRight className="size-[18px]" />
      </Button>
      <p aria-live="polite" className="sr-only">
        {reply}
      </p>
    </form>
  );
}
