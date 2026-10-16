"use client";

import { LocateFixed, Map as MapIcon, Settings2, X } from "lucide-react";
import { Popover, Switch } from "radix-ui";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { chapterIndex, chapters } from "@/content/day";
import { saveWalk } from "@/lib/fly";
import { track } from "@/lib/track";
import { activeIndex } from "@/lib/time";
import { isMoved, usePan } from "@/lib/pan";
import { useCity } from "@/lib/store";

const RAIL = chapters.filter((c) => c.id !== "join");

/** Top bar: wordmark, the day rail, Story/Explore, settings, and the waitlist button. */
export function Hud({ onGo }: { onGo: (index: number) => void }) {
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  const mode = useCity((s) => s.mode);
  const setMode = useCity((s) => s.setMode);
  const moved = usePan(isMoved);
  const recenter = usePan((s) => s.reset);
  const chapter = chapters[active];
  const dark = mode === "story" && chapter.dark;

  // On the hero its own form is right there: go to it. Anywhere else, fly to the finale's.
  const join = () => {
    track("cta_click", { source: "topbar", chapter: chapter.id });
    const hero = active === 0;
    const field = () => document.getElementById(hero ? "waitlist-hero-email" : "waitlist-finale-email")?.focus({ preventScroll: true });
    setMode("story");
    if (!hero) onGo(chapterIndex("join"));
    field();
    if (mode === "explore") requestAnimationFrame(field); // the story is inert until Explore has closed
  };

  const segment = (on: boolean) =>
    cn("flex h-11 items-center rounded-full px-4 text-sm font-medium transition-colors", on ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted");

  return (
    <>
      <header className={cn("pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between gap-3 pr-(--edge-r) pl-(--edge-l) py-4 md:py-6 short:py-3", dark && "dark")}>
        <button
          type="button"
          onClick={() => onGo(0)}
          className="pointer-events-auto flex h-11 cursor-pointer items-center text-lg font-bold tracking-[-0.02em] text-foreground [text-shadow:0_1px_12px_rgb(255_255_255/0.5)] md:text-xl dark:[text-shadow:0_1px_12px_rgb(0_0_0/0.4)]"
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
          {/* Phones: one icon button that flips between the map and the story (words would push the waitlist button off a 375 px screen). */}
          <button
            type="button"
            aria-label={mode === "explore" ? "Story" : "Explore"}
            className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-card/92 text-foreground backdrop-blur-sm md:hidden"
            onClick={() => setMode(mode === "explore" ? "story" : "explore")}
          >
            {mode === "explore" ? <X className="size-4" aria-hidden /> : <MapIcon className="size-4" aria-hidden />}
          </button>
          <div className="hidden rounded-full bg-card/92 p-1 backdrop-blur-sm md:flex">
            <button type="button" className={segment(mode === "story")} aria-pressed={mode === "story"} onClick={() => setMode("story")}>
              Story
            </button>
            <button type="button" className={segment(mode === "explore")} aria-pressed={mode === "explore"} onClick={() => setMode("explore")}>
              Explore
            </button>
          </div>
          <Settings />
          <Button className="rounded-full" size="sm" onClick={join}>
            Join the waitlist
          </Button>
        </div>
      </header>
      {mode === "explore" && moved && (
        // The map was dragged or zoomed: one tap eases back to the whole city.
        <button
          type="button"
          onClick={recenter}
          className="fixed bottom-(--edge-b) left-1/2 z-30 flex h-11 -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-card/92 px-5 text-sm font-medium text-foreground backdrop-blur-sm md:bottom-10"
        >
          <LocateFixed className="size-4" aria-hidden />
          Recenter
        </button>
      )}
    </>
  );
}


/** Settings: walk mode for now (off is fly mode, the default). Remembered per visitor. */
function Settings() {
  const walk = useCity((s) => s.walk);
  const setWalk = useCity((s) => s.setWalk);
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Settings"
        className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-card/92 text-foreground backdrop-blur-sm transition-colors hover:bg-muted"
      >
        <Settings2 className="size-4" aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} collisionPadding={16} className="z-40 w-72 rounded-lg bg-card p-4 text-card-foreground shadow-sm">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm font-medium">Walk mode</span>
              <span className="block text-[13px] text-muted-foreground">Scroll to walk the streets with Cuso. Off, each scroll flies to the next stop.</span>
            </span>
            <Switch.Root
              checked={walk}
              onCheckedChange={(on) => {
                setWalk(on);
                saveWalk(on);
                track("walk_mode", { on });
              }}
              aria-label="Walk mode"
              className="relative h-6 w-10 shrink-0 cursor-pointer rounded-full bg-muted transition-colors data-[state=checked]:bg-primary"
            >
              <Switch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-[18px]" />
            </Switch.Root>
          </label>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
