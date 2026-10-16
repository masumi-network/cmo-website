// Fly mode, the default: one scroll gesture (wheel, trackpad, swipe, key)
// moves one chapter, with the same camera flight as the time rail. Walk mode,
// a setting in the top bar, brings back the scroll walk (experience.tsx).

import { chapters } from "@/content/day";
import { goToChapter, sectionHeight } from "./navigate";
import { useCity } from "./store";
import { activeIndex } from "./time";

/** Wheel travel (px) before a step. A mouse notch is about 100. */
const THRESHOLD = 40;
/** A gap this long (ms) between wheel events ends a gesture. Trackpad inertia sends one every frame. */
const QUIET = 200;
/** A push this much stronger than the last event, this long (ms) after a step, is a new flick inside an inertia tail. */
const PUSH = 2;
const PUSH_AFTER = 600;
/** Finger travel (px) before a swipe counts. */
const SWIPE = 40;
/** The page settles (ms after the last scroll) before it snaps to the chapter. */
const SETTLE = 150;
const KEY = "cmo.walk";

export type Wheel = { last: number; sum: number; locked: boolean; stepAt: number; prev: number };
export const freshWheel: Wheel = { last: -Infinity, sum: 0, locked: false, stepAt: -Infinity, prev: 0 };

/** One wheel event (`delta` px, at `now` ms): the next state and the step it makes (-1, 0 or 1). */
export function wheelStep(w: Wheel, delta: number, now: number): [Wheel, number] {
  const size = Math.abs(delta);
  const fresh = now - w.last > QUIET || (w.locked && now - w.stepAt > PUSH_AFTER && size >= THRESHOLD / 2 && size > PUSH * w.prev);
  const sum = (fresh ? 0 : w.sum) + delta;
  const locked = fresh ? false : w.locked;
  const step = !locked && Math.abs(sum) >= THRESHOLD ? Math.sign(sum) : 0;
  return [{ last: now, sum, locked: locked || step !== 0, stepAt: step ? now : w.stepAt, prev: size }, step];
}

/** The chapter a key takes you to from `current`, or null for keys that don't move. */
export function keyTarget(key: string, shift: boolean, current: number, count: number) {
  const by: Record<string, number> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1, " ": shift ? -1 : 1, Home: -count, End: count };
  if (!(key in by)) return null;
  return Math.min(count - 1, Math.max(0, current + by[key]));
}

/** A finger that moved `dy` px (negative is up): forward, back or nothing. */
export const swipeStep = (dy: number) => (Math.abs(dy) < SWIPE ? 0 : dy < 0 ? 1 : -1);

export function loadWalk() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveWalk(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {}
}

const editable = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
const pressable = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest("button, a, summary, [role=button]");

/**
 * Takes over scrolling while the page is in fly mode; returns the cleanup.
 * Scrolls it did not make (the scrollbar, an anchor, focus moving into a
 * card, find in page) fly to the chapter they reach, then the page snaps to it.
 */
export function attachFly() {
  const count = chapters.length;
  const story = () => useCity.getState().mode === "story";
  const current = () => Math.round(useCity.getState().progress);
  const step = (by: number) => {
    const to = Math.min(count - 1, Math.max(0, current() + by));
    if (to !== current()) goToChapter(to);
  };

  // Land on a chapter: the one the page shows now (a reload, a deep link, walk mode turned off).
  const snap = () => {
    const top = current() * sectionHeight();
    if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: "instant" });
  };
  useCity.getState().setProgress(activeIndex(window.scrollY / sectionHeight(), count));
  snap();

  let wheel = freshWheel;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey || !story()) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    let by: number;
    [wheel, by] = wheelStep(wheel, e.deltaY * px, e.timeStamp);
    if (by) step(by);
  };

  let y0: number | null = null;
  let swiped = false;
  const onTouchStart = (e: TouchEvent) => {
    y0 = e.touches.length === 1 ? e.touches[0].clientY : null;
    swiped = false;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (y0 === null || e.touches.length !== 1 || !story()) return; // two fingers: pinch zoom
    e.preventDefault();
    const by = swipeStep(e.touches[0].clientY - y0);
    if (by && !swiped) {
      swiped = true;
      step(by);
    }
  };
  const onTouchEnd = () => (y0 = null);

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !story() || editable(e.target)) return;
    if (e.key === " " && pressable(e.target)) return;
    const to = keyTarget(e.key, e.shiftKey, current(), count);
    if (to === null) return;
    e.preventDefault();
    if (to !== current()) goToChapter(to);
  };

  let settle = 0;
  const onScroll = () => {
    if (!story()) return;
    const to = activeIndex(window.scrollY / sectionHeight(), count);
    if (to !== current()) goToChapter(to, false);
    clearTimeout(settle);
    settle = window.setTimeout(() => !editable(document.activeElement) && snap(), SETTLE);
  };

  const active = { passive: false } as const;
  window.addEventListener("wheel", onWheel, active);
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, active);
  window.addEventListener("touchend", onTouchEnd);
  window.addEventListener("touchcancel", onTouchEnd);
  window.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", snap);
  return () => {
    clearTimeout(settle);
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchEnd);
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", snap);
  };
}
