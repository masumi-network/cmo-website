"use client";

// 23:00 at Coit Tower: the price card. Three plans side by side on desktop,
// three rows (one open) on phones and short screens. A plan's Join flies to
// the finale's signup and remembers the plan; Chief books a call.

import { useEffect, useState } from "react";
import { cn } from "cn";
import { Card, Eyebrow } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { focusSignup } from "@/components/waitlist-form";
import { chapterIndex, chapters, type Chapter } from "@/content/day";
import { adSpendNote, plans, type Plan, type PlanId } from "@/content/pricing";
import { useCity } from "@/lib/store";
import { activeIndex } from "@/lib/time";
import { track } from "@/lib/track";

/** Counted once a visit, the first time the stop is on screen. */
let viewed = false;

function Cta({ plan, onGo }: { plan: Plan; onGo: (index: number) => void }) {
  const setPlan = useCity((s) => s.setPlan);
  const variant = plan.popular ? "default" : "outline";
  if (plan.cta.href) {
    return (
      <Button asChild size="sm" variant={variant} className="rounded-full">
        <a href={plan.cta.href} target="_blank" rel="noopener" onClick={() => track("plan_cta", { plan: plan.id })}>
          {plan.cta.label}
        </a>
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant={variant}
      className="rounded-full"
      onClick={() => {
        track("plan_cta", { plan: plan.id });
        setPlan(plan.id);
        onGo(chapterIndex("join"));
        focusSignup("finale");
      }}
    >
      {plan.cta.label}
    </Button>
  );
}

const Price = ({ plan, small }: { plan: Plan; small?: boolean }) => (
  <span>
    <span className={cn("font-semibold tracking-[-0.03em]", small ? "text-lg" : "text-3xl")}>{plan.price}</span>
    <span className={cn("text-muted-foreground", small && "text-sm")}>{plan.per}</span>
  </span>
);

export function Pricing({ chapter, onGo }: { chapter: Chapter; onGo: (index: number) => void }) {
  const [open, setOpen] = useState<PlanId>("manager");
  const here = useCity((s) => activeIndex(s.progress, chapters.length) === chapterIndex(chapter.id));

  useEffect(() => {
    if (!here || viewed) return;
    viewed = true;
    track("pricing_view");
  }, [here]);

  return (
    <div className="absolute top-20 right-(--edge-r) bottom-(--edge-b) left-(--edge-l) flex flex-col items-center justify-end md:top-28 md:bottom-10 short:top-16 short:bottom-(--edge-b)">
      <Card aria-labelledby="pricing-title" className="pointer-events-auto w-full max-w-[960px] gap-4 p-5 md:gap-5 md:p-6 short:gap-3 short:p-4">
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
          <div className="font-mono text-[13px] text-cuso">{chapter.time}</div>
          <h2 id="pricing-title" className="text-[26px] leading-[1.05] font-semibold tracking-[-0.03em] md:text-3xl short:text-[26px]">
            {chapter.title}
          </h2>
          <p className="text-[15px] text-muted-foreground">{chapter.body}</p>
        </div>

        {/* Desktop: the three plans side by side, the popular one on a muted panel. */}
        <ul aria-label="Plans" className="hidden grid-cols-3 gap-2 md:grid short:hidden">
          {plans.map((p) => (
            <li key={p.id} aria-labelledby={`plan-${p.id}`} className={cn("flex flex-col gap-3 rounded-md p-4", p.popular && "bg-muted")}>
              <div className="flex items-center justify-between">
                <span id={`plan-${p.id}`} className="font-medium">
                  {p.name}
                </span>
                {p.popular && <Eyebrow className="text-cuso">Popular</Eyebrow>}
              </div>
              <Price plan={p} />
              <p className="min-h-10 text-[13px] leading-snug text-muted-foreground">{p.for}</p>
              <Cta plan={p} onGo={onGo} />
              <ul className="flex flex-col gap-1 text-[13px] leading-snug">
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {/* Phones and short screens: three rows, one open at a time. */}
        <ul aria-label="Plans, compact" className="-mx-2 flex flex-col md:hidden short:flex">
          {plans.map((p) => (
            <li key={p.id} className={cn("rounded-md px-3 py-2.5", open === p.id && "bg-muted")}>
              <button
                type="button"
                aria-expanded={open === p.id}
                onClick={() => {
                  setOpen(p.id);
                  track("plan_open", { plan: p.id });
                }}
                className="flex min-h-7 w-full cursor-pointer items-baseline justify-between text-left"
              >
                <span className="font-medium">
                  {p.name}
                  {p.popular && <span className="ml-2 font-mono text-[11px] text-cuso uppercase">Popular</span>}
                </span>
                <Price plan={p} small />
              </button>
              {open === p.id && (
                <div className="flex flex-col gap-2 pt-1.5">
                  <p className="text-[13px] text-muted-foreground">{p.features.join(" · ")}</p>
                  <Cta plan={p} onGo={onGo} />
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="text-[12px] text-muted-foreground md:text-[13px]">{adSpendNote}</p>
      </Card>
    </div>
  );
}
