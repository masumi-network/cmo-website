"use client";

import { CheckCircle2 } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { waitlistSchema } from "@/lib/waitlist";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void; // set by the GA script in the root layout, when enabled
  }
}

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "done" } | { kind: "error"; message: string };

export function WaitlistForm({ withWebsite = false, className }: { withWebsite?: boolean; className?: string }) {
  const id = useId();
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trap = new FormData(event.currentTarget).get("nickname") || undefined;
    const check = waitlistSchema.safeParse({ email, website });
    if (!check.success) {
      setStatus({ kind: "error", message: check.error.issues[0].message });
      return;
    }
    setStatus({ kind: "sending" });
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(withWebsite && { website }), ...(trap && { nickname: trap }) }),
      });
      const body: unknown = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "Something went wrong. Try again.";
        setStatus({ kind: "error", message });
        return;
      }
      setStatus({ kind: "done" });
      window.gtag?.("event", "sign_up", { method: "waitlist" });
    } catch {
      setStatus({ kind: "error", message: "No connection. Try again." });
    }
  }

  if (status.kind === "done") {
    return (
      <div role="status" className={cn("flex items-center gap-3 rounded-lg bg-card p-5 text-base", className)}>
        <CheckCircle2 className="size-5 text-cuso" aria-hidden />
        You&apos;re on the list. Cuso will write to you when he&apos;s ready.
      </div>
    );
  }

  const error = status.kind === "error" ? status.message : null;
  return (
    <form noValidate onSubmit={submit} className={cn("flex flex-col gap-2.5", className)}>
      <Label htmlFor={`${id}-email`}>Email</Label>
      <Input
        id={`${id}-email`}
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setEmail(e.target.value)}
      />
      {withWebsite && (
        <>
          <Label htmlFor={`${id}-site`} className="mt-1">
            Website (optional)
          </Label>
          <Input id={`${id}-site`} type="text" inputMode="url" placeholder="yourcompany.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </>
      )}
      {/* Honeypot: off screen, hidden from screen readers and the tab order. Bots fill it, people never see it. */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor={`${id}-nickname`}>Leave this empty</label>
        <input id={`${id}-nickname`} name="nickname" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-1" disabled={status.kind === "sending"}>
        {status.kind === "sending" ? "Joining…" : "Join the waitlist"}
      </Button>
    </form>
  );
}
