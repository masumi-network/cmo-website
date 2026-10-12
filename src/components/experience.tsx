"use client";

// The whole page: 3D city (or posters when 3D is off), HUD, scroll story.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { AskBar } from "@/components/ask-bar";
import { Chapters } from "@/components/chapters";
import { Hud } from "@/components/hud";
import { chapters } from "@/content/day";
import { goToChapter, sectionHeight } from "@/lib/navigate";
import { useCity } from "@/lib/store";
import { activeIndex } from "@/lib/time";

const Scene = dynamic(() => import("@/scene/scene"), { ssr: false });

type Support = { webgl: boolean; lite: boolean } | null;

let support: Support = null;
function detect(): Support {
  if (support) return support;
  const params = new URLSearchParams(window.location.search);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let gl = false;
  try {
    gl = !!document.createElement("canvas").getContext("webgl2");
  } catch {}
  const lite = params.has("lite") || window.matchMedia("(pointer: coarse)").matches || navigator.hardwareConcurrency <= 4;
  support = { webgl: gl && !reduced && !params.has("static"), lite };
  return support;
}
const noop = () => () => {};

/** Concept renders behind everything: loading state and no-WebGL fallback. */
function Posters({ visible }: { visible: boolean }) {
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  return (
    <div aria-hidden className={cn("fixed inset-0 transition-opacity duration-700", visible ? "opacity-100" : "opacity-0")}>
      {chapters.map((c, i) => (
        // eslint-disable-next-line @next/next/no-img-element -- full-bleed art, swapped by CSS
        <img
          key={c.id}
          src={c.poster}
          alt=""
          loading={i === 0 ? "eager" : "lazy"}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-700", i === active ? "opacity-100" : "opacity-0")}
        />
      ))}
    </div>
  );
}

/** Without 3D, Cuso's line sits in the corner and Explore becomes a list. */
function FlatExtras({ onGo }: { onGo: (index: number) => void }) {
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  const reply = useCity((s) => s.reply);
  const mode = useCity((s) => s.mode);
  const setMode = useCity((s) => s.setMode);
  if (mode === "explore") {
    return (
      <nav aria-label="Places" className="fixed inset-x-4 top-24 z-20 mx-auto flex max-w-md flex-col gap-2 rounded-lg bg-card p-4">
        {chapters.map((c, i) => (
          <button key={c.id} type="button" onClick={() => { setMode("story"); onGo(i); }} className="flex h-12 cursor-pointer items-center gap-3 rounded-md px-3 text-left hover:bg-muted">
            <span className="font-mono text-xs text-cuso">{c.time}</span>
            <span className="font-medium">{c.label}</span>
            <span className="text-sm text-muted-foreground">{c.place}</span>
          </button>
        ))}
      </nav>
    );
  }
  return (
    <div className="pointer-events-none fixed top-1/3 right-6 z-10 hidden rounded-[20px_20px_6px_20px] bg-[#f7f6f2] px-4 py-3 text-lg font-medium text-[#111114] md:block">
      {reply || chapters[active].bubble}
    </div>
  );
}

export function Experience() {
  const env = useSyncExternalStore(noop, detect, () => null);
  const [ready, setReady] = useState(false);
  const mode = useCity((s) => s.mode);
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  const onReady = useCallback(() => setReady(true), []);
  const onGo = useCallback((index: number) => goToChapter(index), []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => useCity.getState().setProgress(window.scrollY / sectionHeight()));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = mode === "explore" ? "hidden" : "";
  }, [mode]);

  const id = chapters[active].id;
  const showAsk = mode === "story" && id !== "arrive" && id !== "join";

  return (
    <>
      {/* lvh: phone browser bars sliding in and out never resize the 3D. */}
      <div className="fixed inset-x-0 top-0 h-lvh bg-[#e9dfd0]" data-scene={!env ? "pending" : !env.webgl ? "static" : ready ? "ready" : "loading"}>
        <Posters visible={!env?.webgl || !ready} />
        {env?.webgl && (
          <div className={cn("fixed inset-x-0 top-0 h-lvh transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}>
            <Scene onReady={onReady} onGo={onGo} lite={env.lite} />
          </div>
        )}
      </div>
      <Hud onGo={onGo} />
      <main inert={mode === "explore"} className={cn("relative z-10 transition-opacity duration-500", mode === "explore" && "opacity-0")}>
        <Chapters onGo={onGo} />
      </main>
      {showAsk && (
        // Beside the cards on tablets, centred once there is room.
        <div
          className={cn(
            "fixed bottom-10 z-20 hidden w-[min(480px,calc(100vw-554px))] md:block short:hidden min-[1100px]:right-auto min-[1100px]:left-1/2 min-[1100px]:w-[480px] min-[1100px]:-translate-x-1/2",
            id === "night" ? "left-(--edge-l)" : "right-(--edge-r)",
            chapters[active].dark && "dark",
          )}
        >
          <AskBar onGo={onGo} />
        </div>
      )}
      {env && !env.webgl && <FlatExtras onGo={onGo} />}
    </>
  );
}
