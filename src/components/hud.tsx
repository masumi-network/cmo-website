"use client";

import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { chapterIndex, chapters } from "@/content/day";
import { activeIndex } from "@/lib/time";
import { useCity } from "@/lib/store";

const RAIL = chapters.filter((c) => c.id !== "join");

/** Top bar: wordmark, the day rail, Story/Explore, and the waitlist button. */
export function Hud({ onGo }: { onGo: (index: number) => void }) {
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  const mode = useCity((s) => s.mode);
  const setMode = useCity((s) => s.setMode);
  const chapter = chapters[active];
  const dark = mode === "story" && chapter.dark;

  const segment = (on: boolean) =>
    cn("flex h-11 items-center rounded-full px-4 text-sm font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted");

  return (
    <header className={cn("pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 py-4 md:px-12 md:py-6", dark && "dark")}>
      <button
        type="button"
        onClick={() => onGo(0)}
        className="pointer-events-auto text-lg font-bold tracking-[-0.02em] text-foreground [text-shadow:0_1px_12px_rgb(255_255_255/0.5)] md:text-xl dark:[text-shadow:0_1px_12px_rgb(0_0_0/0.4)]"
      >
        CMO.XYZ
      </button>

      {mode === "story" && (
        <nav aria-label="Time of day" className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 gap-0.5 rounded-full bg-card/92 p-1 backdrop-blur-sm lg:flex">
          {RAIL.map((c) => {
            const i = chapterIndex(c.id);
            const on = i === active;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={on ? "step" : undefined}
                onClick={() => onGo(i)}
                className={cn(
                  "flex h-11 min-w-16 cursor-pointer flex-col items-center justify-center rounded-full px-2.5 transition-colors",
                  on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted",
                )}
              >
                <span className="font-mono text-xs leading-none">{c.time}</span>
                <span className="text-[11px] leading-snug opacity-80">{c.label}</span>
              </button>
            );
          })}
        </nav>
      )}

      <div className="pointer-events-auto flex items-center gap-2">
        <div className="hidden rounded-full bg-card/92 p-1 backdrop-blur-sm md:flex">
          <button type="button" className={segment(mode === "story")} aria-pressed={mode === "story"} onClick={() => setMode("story")}>
            Story
          </button>
          <button type="button" className={segment(mode === "explore")} aria-pressed={mode === "explore"} onClick={() => setMode("explore")}>
            Explore
          </button>
        </div>
        <Button className="rounded-full" size="sm" onClick={() => { setMode("story"); onGo(chapterIndex("join")); }}>
          Join the waitlist
        </Button>
      </div>
    </header>
  );
}
