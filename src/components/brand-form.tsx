"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brandFromUrl } from "@/lib/brand";
import { useCity } from "@/lib/store";

/** The visitor's website goes up on the signs around the city. */
export function BrandForm() {
  const website = useCity((s) => s.website);
  const setWebsite = useCity((s) => s.setWebsite);
  const [value, setValue] = useState(website);
  const [error, setError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!brandFromUrl(value)) {
      setError("That doesn't look like a website.");
      return;
    }
    setError(null);
    setWebsite(value.trim());
  }

  return (
    <form noValidate onSubmit={submit} className="mt-1 flex flex-col gap-2">
      <Label htmlFor="brand-site">Your website</Label>
      <div className="flex gap-2">
        <Input id="brand-site" inputMode="url" value={value} aria-invalid={error ? true : undefined} onChange={(e) => setValue(e.target.value)} />
        <Button type="submit">Learn my brand</Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
