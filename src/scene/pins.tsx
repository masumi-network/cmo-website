"use client";

// Explore mode: a pin on every place. Click one and Cuso goes there.

import { Html } from "@react-three/drei";
import { chapters, type ChapterId } from "@/content/day";
import { useCity } from "@/lib/store";

/** Pins that line up from the bird's-eye view lean apart. */
const LEAN: Partial<Record<ChapterId, string>> = { arrive: "-translate-x-full", seo: "translate-x-0" };

export function Pins({ onGo }: { onGo: (index: number) => void }) {
  const mode = useCity((s) => s.mode);
  const setMode = useCity((s) => s.setMode);
  if (mode !== "explore") return null;
  return (
    <>
      {chapters.map((c, i) =>
        c.id === "join" ? null : (
          <Html key={c.id} position={[c.spot[0], c.spot[1] + 2.4, c.spot[2]]} zIndexRange={[30, 0]}>
            <button
              type="button"
              onClick={() => {
                setMode("story");
                onGo(i);
              }}
              className={`flex ${LEAN[c.id] ?? "-translate-x-1/2"} -translate-y-full cursor-pointer items-center gap-2.5 rounded-full bg-[#f7f6f2] py-1.5 pr-4 pl-1.5 text-left whitespace-nowrap text-[#111114] shadow-[0_6px_20px_rgb(17_17_20/0.16)] transition-transform hover:scale-105 focus-visible:ring-[3px] focus-visible:ring-[#3d5afe]/60 focus-visible:outline-none`}
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-[#111114] font-mono text-[11px] text-[#f7f6f2]">{c.time.slice(0, 2)}</span>
              <span className="flex flex-col">
                <span className="text-sm leading-tight font-semibold">{c.label}</span>
                <span className="text-xs leading-tight text-[#5e5e66]">{c.place}</span>
              </span>
            </button>
          </Html>
        ),
      )}
    </>
  );
}
