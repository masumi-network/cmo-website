"use client";

// The whole page: 3D city (or posters when 3D is off), HUD, scroll story.

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import { AskBar } from "@/components/ask-bar";
import { Chapters } from "@/components/chapters";
import { Hud } from "@/components/hud";
import { chapters } from "@/content/day";
import { attachFly, loadWalk } from "@/lib/fly";
import { goToChapter, sectionHeight } from "@/lib/navigate";
import { useCity } from "@/lib/store";
import { activeIndex } from "@/lib/time";
import { phoneVariant, setTrackContext, track } from "@/lib/track";

const Scene = dynamic(() => import("@/scene/scene"), { ssr: false });

/** Why there is no 3D: no WebGL, reduced motion, `?static`, or the posters half of the phone test. */
type Flat = "nowebgl" | "reduced" | "param" | "posters" | null;
type Support = { webgl: boolean; lite: boolean; flat: Flat } | null;

let support: Support = null;
function detect(): Support {
  if (support) return support;
  const params = new URLSearchParams(window.location.search);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = window.matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) < 768;
  const variant = phone ? phoneVariant(window.location.search) : null;
  setTrackContext(variant ? { phone_test: variant } : {});
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2");
  } catch {}
  const flat: Flat = !gl ? "nowebgl" : reduced ? "reduced" : params.has("static") ? "param" : variant === "posters" ? "posters" : null;
  support = { webgl: !flat, lite: params.has("lite") || weak(gl), flat };
  gl?.getExtension("WEBGL_lose_context")?.loseContext(); // only asked; the scene makes its own
  return support;
}

/**
 * Lite for phones and tablets (touch first), few cores, little memory, or an
 * integrated or mobile GPU (Intel, Mali, Adreno, PowerVR), where the full
 * city (water mirror, 4x MSAA, tilt shift) would drop frames.
 */
function weak(gl: WebGL2RenderingContext | null) {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (window.matchMedia("(pointer: coarse)").matches || navigator.hardwareConcurrency <= 4 || (memory !== undefined && memory <= 4)) return true;
  const info = gl?.getExtension("WEBGL_debug_renderer_info");
  const gpu = info ? String(gl!.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
  return /intel|mali|adreno|powervr/i.test(gpu);
}

const noop = () => () => {};

/**
 * Posters behind everything, rendered from the 3D shots: loading state, no-WebGL fallback, the phone test's posters half.
 * Only this chapter's poster and its neighbours load (they all stack in view,
 * so `loading="lazy"` would fetch every one).
 */
function Posters({ visible }: { visible: boolean }) {
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  return (
    <div aria-hidden className={cn("fixed inset-0 transition-opacity duration-700", visible ? "opacity-100" : "opacity-0")}>
      {chapters.map(
        (c, i) =>
          Math.abs(i - active) <= 1 && (
            // Phones in portrait get the phone shot, framed for their cards (isPhone in shared.ts).
            <picture key={c.id}>
              <source media="(orientation: portrait) and (max-width: 767px)" srcSet={c.poster.replace(/\.jpg$/, "-phone.jpg")} />
              <img
                src={c.poster}
                alt=""
                className={cn("absolute inset-0 size-full object-cover transition-opacity duration-700", i === active ? "opacity-100" : "opacity-0")}
              />
            </picture>
          ),
      )}
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

/**
 * The Ask bar keeps to the free space beside the card column (410 px at the
 * screen edge, `Work` in chapters.tsx): centred on the screen when it fits
 * there, otherwise next to the column, narrower if it must. `cards` is the
 * side the cards are on (the right at 22:00).
 */
function askPlace(cards: "left" | "right"): React.CSSProperties {
  const near = cards === "left" ? "var(--edge-l)" : "var(--edge-r)";
  const far = cards === "left" ? "var(--edge-r)" : "var(--edge-l)";
  const column = `calc(${near} + 410px + 24px)`;
  const width = `min(480px, calc(100% - ${column} - ${far}))`;
  return { width, [cards]: `max(calc(50% - ${width} / 2), ${column})` };
}

export function Experience() {
  const env = useSyncExternalStore(noop, detect, () => null);
  const [ready, setReady] = useState(false);
  // The posters go once the 3D has faded in over them.
  const [covered, setCovered] = useState(false);
  const mode = useCity((s) => s.mode);
  const walk = useCity((s) => s.walk);
  const active = useCity((s) => activeIndex(s.progress, chapters.length));
  const onReady = useCallback(() => {
    setReady(true);
    track("scene_ready", { ms: Math.round(performance.now()), lite: !!support?.lite });
  }, []);
  const onGo = useCallback((index: number) => goToChapter(index), []);

  // The walk setting, as this visitor left it.
  useEffect(() => useCity.getState().setWalk(loadWalk()), []);

  // Fly mode (default): one scroll, one chapter (fly.ts). Walk mode: the scroll is the time of day.
  useEffect(() => {
    document.documentElement.toggleAttribute("data-walk", walk);
    if (!walk) return attachFly();
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
  }, [walk]);

  useEffect(() => {
    document.documentElement.style.overflow = mode === "explore" ? "hidden" : "";
    if (mode === "explore") track("explore_open");
  }, [mode]);

  // The funnel: how far into the day people get, and whether they saw the 3D.
  useEffect(() => {
    if (env?.flat) track("scene_static", { reason: env.flat });
  }, [env]);
  useEffect(() => track("chapter_view", { chapter: chapters[active].id, index: active, walk: useCity.getState().walk }), [active]);

  const id = chapters[active].id;
  const showAsk = mode === "story" && id !== "arrive" && id !== "join";

  return (
    <>
      {/* lvh: phone browser bars sliding in and out never resize the 3D. */}
      <div className="fixed inset-x-0 top-0 h-lvh bg-[#e9dfd0]" data-scene={!env ? "pending" : !env.webgl ? "static" : ready ? "ready" : "loading"}>
        {!covered && <Posters visible={!env?.webgl || !ready} />}
        {env?.webgl && (
          <div
            className={cn("fixed inset-x-0 top-0 h-lvh transition-opacity duration-1000", ready ? "opacity-100" : "opacity-0")}
            onTransitionEnd={(e) => ready && e.target === e.currentTarget && setCovered(true)}
          >
            <Scene onReady={onReady} onGo={onGo} lite={env.lite} />
          </div>
        )}
      </div>
      <Hud onGo={onGo} />
      <main inert={mode === "explore"} className={cn("relative z-10 transition-opacity duration-500", mode === "explore" && "opacity-0")}>
        <Chapters onGo={onGo} />
      </main>
      {showAsk && (
        <div
          className={cn("fixed bottom-10 z-20 hidden md:block short:hidden", chapters[active].dark && "dark")}
          style={askPlace(id === "night" ? "right" : "left")}
        >
          <AskBar onGo={onGo} />
        </div>
      )}
      {env && !env.webgl && <FlatExtras onGo={onGo} />}
    </>
  );
}
