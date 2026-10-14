"use client";

import { ArrowRight } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { chapterIndex } from "@/content/day";
import { askCuso, type IntentId } from "@/lib/ask";
import { useCity } from "@/lib/store";

export function AskBar({ onGo, className }: { onGo: (index: number) => void; className?: string }) {
  const [question, setQuestion] = useState("");
  // When he doesn't know, a few things to ask instead. Gone once you type or ask.
  const [suggest, setSuggest] = useState<string[]>([]);
  const asked = useRef<IntentId[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const reply = useCity((s) => s.reply);
  const say = useCity((s) => s.say);

  function ask(text: string) {
    const answer = askCuso(text, asked.current);
    if (!answer.reply) return;
    if (answer.intent) asked.current.push(answer.intent);
    say(answer.reply);
    setSuggest(answer.suggest ?? []);
    if (answer.chapter) onGo(chapterIndex(answer.chapter));
    setQuestion("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask(question);
      }}
      className={cn("relative flex h-15 items-center gap-2 rounded-full bg-card py-2 pr-2 pl-5 shadow-[0_10px_40px_rgb(17_17_20/0.1)]", className)}
    >
      <label htmlFor="ask-cuso" className="sr-only">
        Ask Cuso
      </label>
      <input
        ref={input}
        id="ask-cuso"
        type="text"
        autoComplete="off"
        placeholder="Ask Cuso anything…"
        value={question}
        onChange={(e) => {
          setQuestion(e.target.value);
          setSuggest([]);
        }}
        className="h-full min-w-0 flex-1 bg-transparent text-base text-card-foreground outline-none placeholder:text-muted-foreground"
      />
      <Button type="submit" size="icon" aria-label="Send to Cuso">
        <ArrowRight className="size-[18px]" />
      </Button>
      {suggest.length > 0 && (
        <div role="group" aria-label="Try asking" className="absolute bottom-full left-1/2 mb-3 flex -translate-x-1/2 gap-2">
          {suggest.map((label) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              size="sm"
              className="h-9 rounded-full bg-card px-4 text-card-foreground shadow-[0_6px_24px_rgb(17_17_20/0.08)]"
              onClick={() => {
                ask(label);
                input.current?.focus();
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      <p aria-live="polite" className="sr-only">
        {reply}
      </p>
    </form>
  );
}
