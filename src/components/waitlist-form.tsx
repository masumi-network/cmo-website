"use client";

import { CheckCircle2 } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { track } from "@/lib/track";
import { normalizeWebsite, waitlistSchema } from "@/lib/waitlist";

/** Which form: the hero card (06:00) or the finale (tomorrow 06:00). Ids and analytics use it. */
export type WaitlistSource = "hero" | "finale";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "error"; message: string };
type Step = "email" | "website" | "done";

async function post(body: Record<string, string>): Promise<string | null> {
  try {
    const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data: unknown = await res.json().catch(() => ({}));
    return data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : "Something went wrong. Try again.";
  } catch {
    return "No connection. Try again.";
  }
}

/**
 * Email first, nothing else. Once on the list, one optional extra step asks
 * for the website, so Cuso can start with it (a second row on Sokosumi).
 */
export function WaitlistForm({ source, className }: { source: WaitlistSource; className?: string }) {
  const id = `waitlist-${source}`;
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [step, setStep] = useState<Step>("email");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const started = useRef(false);

  const fail = (kind: string, message: string) => {
    setStatus({ kind: "error", message });
    track("form_error", { source, kind });
  };

  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trap = new FormData(event.currentTarget).get("nickname") || undefined;
    const check = waitlistSchema.safeParse({ email });
    if (!check.success) return fail("invalid", check.error.issues[0].message);
    setStatus({ kind: "sending" });
    const error = await post({ email, ...(typeof trap === "string" && { nickname: trap }) });
    if (error) return fail(error.startsWith("No connection") ? "network" : "server", error);
    setStatus({ kind: "idle" });
    setStep("website");
    track("sign_up", { method: "waitlist", source });
  }

  async function addSite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!normalizeWebsite(website)) return fail("website", "Please enter a valid website.");
    setStatus({ kind: "sending" });
    const error = await post({ email, website });
    if (error) return fail("server", error);
    setStatus({ kind: "idle" });
    setStep("done");
    track("website_added", { source });
  }

  const error = status.kind === "error" ? status.message : null;
  const sending = status.kind === "sending";
  const alert = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );

  if (step !== "email") {
    return (
      <div className={cn("flex flex-col gap-3 rounded-lg bg-card p-5 text-base", className)}>
        <div role="status" className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-cuso" aria-hidden />
          {step === "done" ? <span>Got it. Cuso starts with {website.trim()}.</span> : <span>You&apos;re on the list. Want Cuso to start with your site?</span>}
        </div>
        {step === "website" && (
          <form noValidate onSubmit={addSite} className="flex flex-col gap-2.5">
            <Label htmlFor={`${id}-site`}>Website</Label>
            <Input
              id={`${id}-site`}
              type="text"
              inputMode="url"
              autoComplete="url"
              placeholder="yourcompany.com"
              value={website}
              aria-invalid={error ? true : undefined}
              onChange={(e) => setWebsite(e.target.value)}
            />
            {alert}
            <Button type="submit" variant="outline" disabled={sending}>
              {sending ? "Adding…" : "Add my site"}
            </Button>
          </form>
        )}
      </div>
    );
  }

  return (
    <form noValidate onSubmit={join} className={cn("flex flex-col gap-2.5", className)}>
      <Label htmlFor={`${id}-email`}>Email</Label>
      <Input
        id={`${id}-email`}
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        aria-invalid={error ? true : undefined}
        onFocus={() => {
          if (started.current) return;
          started.current = true;
          track("form_start", { source });
        }}
        onChange={(e) => setEmail(e.target.value)}
      />
      {/* Honeypot: off screen, hidden from screen readers and the tab order. Bots fill it, people never see it. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor={`${id}-nickname`}>Leave this empty</label>
        <input id={`${id}-nickname`} name="nickname" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {alert}
      <Button type="submit" className="mt-1" disabled={sending}>
        {sending ? "Joining…" : "Join the waitlist"}
      </Button>
      <p className="text-[13px] text-muted-foreground">No spam. We only write when Cuso is ready.</p>
    </form>
  );
}
