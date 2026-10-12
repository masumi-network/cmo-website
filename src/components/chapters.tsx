"use client";

// The scroll story. One section per chapter; its cards stay put (sticky)
// while the camera rests, then scroll away as Cuso moves on.

import { ArrowDown } from "lucide-react";
import { cn } from "cn";
import { AdsCard, ApprovalCard, BrandBrainCard, Card, ChapterCard, NewsletterCard, RankCard, WeeklyNote } from "@/components/cards";
import { BrandForm } from "@/components/brand-form";
import { WaitlistForm } from "@/components/waitlist-form";
import { chapters, type Chapter, type ChapterId } from "@/content/day";
import { SECTION_VH } from "@/lib/navigate";

/** Detail card per chapter. Hidden on phones unless it is the thing to do. */
const DETAIL: Partial<Record<ChapterId, { card: React.ReactNode; onPhone?: boolean }>> = {
  learn: { card: <BrandBrainCard /> },
  social: { card: <ApprovalCard />, onPhone: true },
  ads: { card: <AdsCard /> },
  seo: { card: <RankCard /> },
  newsletter: { card: <NewsletterCard /> },
  night: { card: <WeeklyNote />, onPhone: true },
};

function Hero({ chapter, onGo }: { chapter: Chapter; onGo: (index: number) => void }) {
  return (
    <>
      <div className="pointer-events-auto absolute inset-x-4 top-24 flex max-w-[520px] flex-col gap-5 md:top-36 md:left-12">
        <div className="font-mono text-xs tracking-[0.06em] uppercase md:text-[13px]">
          {chapter.time} · San Francisco
        </div>
        <h1 className="text-[44px] leading-none font-semibold tracking-[-0.04em] md:text-[76px] md:leading-[0.98]">{chapter.title}</h1>
        <p className="max-w-[440px] text-base leading-relaxed md:text-xl">{chapter.body}</p>
        <Card className="max-w-[440px] p-4">
          <WaitlistForm />
        </Card>
      </div>
      <button
        type="button"
        onClick={() => onGo(1)}
        className="pointer-events-auto absolute bottom-8 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full bg-card/92 px-5 py-3 text-sm font-medium backdrop-blur-sm"
      >
        <ArrowDown className="size-4" aria-hidden />
        Scroll to start the day
      </button>
    </>
  );
}

function Finale({ chapter }: { chapter: Chapter }) {
  return (
    <Card className="pointer-events-auto absolute inset-x-4 bottom-4 max-w-[480px] gap-5 p-6 md:top-1/2 md:bottom-auto md:left-12 md:-translate-y-1/2 md:p-8">
      <div className="font-mono text-xs tracking-[0.06em] text-cuso uppercase md:text-[13px]">{chapter.time} · Tomorrow</div>
      <h2 className="text-[40px] leading-none font-semibold tracking-[-0.04em] md:text-6xl md:leading-[0.98]">{chapter.title}</h2>
      <p className="text-base leading-relaxed text-muted-foreground md:text-lg">{chapter.body}</p>
      <WaitlistForm withWebsite />
    </Card>
  );
}

function Work({ chapter }: { chapter: Chapter }) {
  const detail = DETAIL[chapter.id];
  const right = chapter.id === "night";
  return (
    <div
      className={cn(
        "absolute inset-x-4 top-20 bottom-4 flex flex-col justify-end gap-3 md:top-28 md:bottom-10 md:w-[410px] md:justify-between md:gap-4",
        right ? "md:right-12 md:left-auto" : "md:left-12",
      )}
    >
      {detail && <div className={cn("pointer-events-auto", !detail.onPhone && "hidden md:block")}>{detail.card}</div>}
      <div className="pointer-events-auto">
        <ChapterCard chapter={chapter}>{chapter.id === "learn" && <BrandForm />}</ChapterCard>
      </div>
    </div>
  );
}

export function Chapters({ onGo }: { onGo: (index: number) => void }) {
  return (
    <>
      {chapters.map((chapter, i) => {
        const last = i === chapters.length - 1;
        return (
          <section
            key={chapter.id}
            id={`chapter-${chapter.id}`}
            aria-label={`${chapter.time} ${chapter.label}`}
            className={cn("pointer-events-none relative", chapter.dark && "dark text-foreground")}
            style={{ height: last ? "100svh" : `${SECTION_VH * 100}svh` }}
          >
            <div className="sticky top-0 h-svh text-foreground">
              {chapter.id === "arrive" ? <Hero chapter={chapter} onGo={onGo} /> : last ? <Finale chapter={chapter} /> : <Work chapter={chapter} />}
            </div>
          </section>
        );
      })}
    </>
  );
}
