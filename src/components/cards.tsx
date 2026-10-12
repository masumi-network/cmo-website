"use client";

import { CheckCircle2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { Chapter } from "@/content/day";
import { sampleAds, sampleBrand, sampleDraft, sampleNewsletter, sampleRanking, sampleWeeklyNote } from "@/content/sample";
import { useCity } from "@/lib/store";

export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("flex flex-col gap-4 rounded-lg bg-card p-6 text-card-foreground shadow-[0_10px_40px_rgb(17_17_20/0.08)]", className)}
      {...props}
    />
  );
}

export function Eyebrow({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("font-mono text-xs tracking-[0.06em] text-muted-foreground uppercase", className)} {...props} />;
}

export function ChapterCard({ chapter, children }: { chapter: Chapter; children?: React.ReactNode }) {
  return (
    <Card aria-labelledby={`${chapter.id}-title`} className="gap-2.5">
      <div className="font-mono text-[13px] text-cuso">{chapter.time}</div>
      <h2 id={`${chapter.id}-title`} className="text-3xl leading-[1.05] font-semibold tracking-[-0.03em]">
        {chapter.title}
      </h2>
      <p className="text-[15px] leading-normal text-muted-foreground">{chapter.body}</p>
      {children}
    </Card>
  );
}

export function BrandBrainCard() {
  return (
    <Card aria-label="Brand Brain">
      <div className="flex items-center justify-between">
        <Eyebrow>Brand Brain</Eyebrow>
        <div className="font-mono text-xs text-cuso">Learning · 3 of 4</div>
      </div>
      <dl className="grid grid-cols-[104px_1fr] gap-x-3 gap-y-3">
        {sampleBrand.brain.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-sm text-muted-foreground">{row.label}</dt>
            <dd className={cn("text-[15px]", row.pending && "text-muted-foreground")}>{row.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

export function ApprovalCard() {
  const approved = useCity((s) => s.approved);
  const setApproved = useCity((s) => s.setApproved);
  return (
    <Card aria-label="Draft waiting for your OK" className="p-5">
      <div className="flex items-center justify-between">
        <Eyebrow>Draft · {sampleDraft.channel}</Eyebrow>
        <Eyebrow className="normal-case">{sampleDraft.when}</Eyebrow>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- art crop of a local poster */}
      <img src={sampleDraft.image} alt="" className="hidden h-44 w-full rounded-md object-cover object-[92%_20%] md:block" />
      <p className="text-[15px] leading-normal">{sampleDraft.caption}</p>
      {approved ? (
        <div className="flex h-12 items-center justify-between">
          <div className="flex items-center gap-2.5 text-[15px] font-medium text-cuso">
            <CheckCircle2 className="size-5" aria-hidden />
            Scheduled for {sampleDraft.when}
          </div>
          <Button variant="ghost" size="sm" onClick={() => setApproved(false)}>
            Undo
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => setApproved(true)}>
            Approve
          </Button>
          <Button className="flex-1" variant="outline">
            Change it
          </Button>
        </div>
      )}
    </Card>
  );
}

export function AdsCard() {
  return (
    <Card aria-label="Ads this week" className="gap-5">
      <div className="flex items-center justify-between">
        <Eyebrow>Ads this week</Eyebrow>
        <Eyebrow className="normal-case">Google · Meta</Eyebrow>
      </div>
      <div className="flex items-baseline gap-3">
        <div className="text-5xl leading-none font-semibold tracking-[-0.04em]">{sampleAds.roas}</div>
        <div className="text-sm text-muted-foreground">return on ad spend</div>
        <div className="ml-auto font-mono text-[13px] text-cuso">{sampleAds.change}</div>
      </div>
      <ul className="flex flex-col gap-2.5">
        {sampleAds.ads.map((ad) => (
          <li key={ad.name} className={cn("flex items-center gap-3", !ad.winning && "opacity-55")}>
            <div className={cn("size-10 rounded-[10px]", ad.winning ? "bg-cuso" : "bg-muted")} />
            <div className="flex-1">
              <div className="text-[15px] font-medium">{ad.name}</div>
              <div className="text-[13px] text-muted-foreground">{ad.note}</div>
            </div>
            <div className="font-mono text-[13px]">{ad.spend}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function RankCard() {
  const website = useCity((s) => s.website);
  return (
    <Card aria-label="Google ranking">
      <Eyebrow>Google · &ldquo;{sampleRanking.query}&rdquo;</Eyebrow>
      <ol className="flex flex-col gap-1">
        {sampleRanking.results.map((r) =>
          r.rank === 1 ? (
            <li key={r.rank} className="-mx-3 flex items-center gap-3.5 rounded-md bg-white p-3 dark:bg-white/10">
              <span className="w-7 text-[28px] font-semibold tracking-[-0.03em]">1</span>
              <span className="flex-1 truncate text-[15px] font-medium">{website}</span>
              <span className="font-mono text-[13px] text-cuso">{r.change}</span>
            </li>
          ) : (
            <li key={r.rank} className="flex items-center gap-3.5 py-3 text-muted-foreground">
              <span className="w-7 text-xl font-medium">{r.rank}</span>
              <span className="text-[15px]">{r.site}</span>
            </li>
          ),
        )}
      </ol>
    </Card>
  );
}

export function NewsletterCard() {
  return (
    <Card aria-label="Newsletter" className="gap-3.5">
      <div className="flex items-center justify-between">
        <Eyebrow>Newsletter</Eyebrow>
        <Eyebrow className="normal-case">{sampleNewsletter.audience}</Eyebrow>
      </div>
      <div className="text-[22px] font-semibold tracking-[-0.02em]">{sampleNewsletter.subject}</div>
      <p className="text-[15px] leading-normal">{sampleNewsletter.preview}</p>
      <div className="flex items-center gap-3 pt-1">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-cuso" style={{ width: `${sampleNewsletter.openRate}%` }} />
        </div>
        <div className="font-mono text-[13px]">{sampleNewsletter.openRate}% opened</div>
      </div>
    </Card>
  );
}

export function WeeklyNote() {
  const agreed = useCity((s) => s.agreed);
  const agree = useCity((s) => s.agree);
  return (
    <Card aria-label="Weekly note from Cuso" className="gap-5 p-7">
      <Eyebrow>Weekly note · {sampleWeeklyNote.week}</Eyebrow>
      <div className="text-[26px] leading-tight font-semibold tracking-[-0.02em]">Here&apos;s what I learned this week.</div>
      <ol className="flex flex-col gap-3.5">
        {sampleWeeklyNote.items.map((item, i) => (
          <li key={item} className="flex gap-3.5">
            <span className="pt-0.5 font-mono text-[13px] text-cuso">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-[15px] leading-normal">{item}</span>
          </li>
        ))}
      </ol>
      {agreed ? (
        <div className="flex h-12 items-center gap-2.5 text-[15px] font-medium text-cuso">
          <CheckCircle2 className="size-5" aria-hidden />
          Plan updated for next week
        </div>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={agree}>
            Sounds good
          </Button>
          <Button className="flex-1" variant="outline">
            Let&apos;s talk
          </Button>
        </div>
      )}
    </Card>
  );
}
