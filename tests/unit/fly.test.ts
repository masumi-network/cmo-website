// Fly mode (the default): one scroll gesture moves one chapter, with the same
// camera flight as the time rail. Walk mode (a setting) brings back the
// continuous scroll walk.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chapters } from "@/content/day";
import { attachFly, freshWheel, keyTarget, loadWalk, saveWalk, swipeStep, wheelStep, type Wheel } from "@/lib/fly";
import { sectionHeight } from "@/lib/navigate";
import { initialCity, useCity } from "@/lib/store";

const LAST = chapters.length - 1;

/** Feed wheel deltas (one every `gap` ms from `start`) and count the steps. */
function feed(deltas: number[], gap = 16, start = 0, from: Wheel = freshWheel) {
  let w = from;
  const steps: number[] = [];
  deltas.forEach((d, i) => {
    let step: number;
    [w, step] = wheelStep(w, d, start + i * gap);
    if (step) steps.push(step);
  });
  return { w, steps };
}

/** A trackpad flick: a push, then the inertia tail decaying for about 1.5 s. */
const flick = (sign = 1) => Array.from({ length: 95 }, (_, i) => sign * Math.max(1, 60 * 0.95 ** i));

describe("wheel gestures", () => {
  it("one mouse notch is one step, either way", () => {
    expect(feed([100]).steps).toEqual([1]);
    expect(feed([-100]).steps).toEqual([-1]);
  });

  it("small trackpad deltas add up before a step", () => {
    expect(feed([5, 5, 5]).steps).toEqual([]);
    expect(feed([5, 5, 5, 10, 10, 10]).steps).toEqual([1]);
  });

  it("a flick and its whole inertia tail is one step", () => {
    expect(feed(flick()).steps).toEqual([1]);
  });

  it("a quick spin of the wheel is one step; a pause starts the next", () => {
    expect(feed([100, 100, 100, 100], 40).steps).toEqual([1]);
    const first = feed([100], 0, 0);
    expect(feed([100], 0, 400, first.w).steps).toEqual([1]);
  });

  it("a fresh push during a long inertia tail is a new step", () => {
    const tail = feed(flick());
    const push = feed([40, 80], 16, 95 * 16, tail.w);
    expect(push.steps).toEqual([1]);
  });

  it("no new step from the tail's own wobble right after a step", () => {
    expect(feed([60, 20, 45, 10, 30]).steps).toEqual([1]);
  });
});

describe("keys", () => {
  it.each([
    ["ArrowDown", false, 3],
    ["PageDown", false, 3],
    [" ", false, 3],
    ["ArrowUp", false, 1],
    ["PageUp", false, 1],
    [" ", true, 1],
    ["Home", false, 0],
    ["End", false, LAST],
  ])("%s (shift %s) from chapter 2 goes to %i", (key, shift, to) => {
    expect(keyTarget(key, shift, 2, chapters.length)).toBe(to);
  });

  it("stays inside the day and ignores other keys", () => {
    expect(keyTarget("ArrowUp", false, 0, chapters.length)).toBe(0);
    expect(keyTarget("ArrowDown", false, LAST, chapters.length)).toBe(LAST);
    expect(keyTarget("a", false, 2, chapters.length)).toBeNull();
    expect(keyTarget("Tab", false, 2, chapters.length)).toBeNull();
  });
});

describe("swipes", () => {
  it("a finger moving up goes forward, down goes back, a nudge does nothing", () => {
    expect(swipeStep(-60)).toBe(1);
    expect(swipeStep(60)).toBe(-1);
    expect(swipeStep(-20)).toBe(0);
  });
});

describe("the walk setting is remembered", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("is off (fly) until turned on, and comes back after a reload", () => {
    expect(loadWalk()).toBe(false);
    saveWalk(true);
    expect(loadWalk()).toBe(true);
    saveWalk(false);
    expect(loadWalk()).toBe(false);
  });

  it("falls back to fly when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveWalk(true)).not.toThrow();
    expect(loadWalk()).toBe(false);
  });
});

describe("fly mode on the page", () => {
  let detach: () => void;
  let scrollTo: ReturnType<typeof vi.spyOn>;
  const at = (y: number) => Object.defineProperty(window, "scrollY", { value: y, configurable: true });

  beforeEach(() => {
    vi.useFakeTimers();
    useCity.setState(initialCity);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    at(0);
    scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(((o: ScrollToOptions) => at(o.top ?? 0)) as typeof window.scrollTo);
    detach = attachFly();
  });

  afterEach(() => {
    detach();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const wheel = (deltaY: number, init: WheelEventInit = {}) => {
    const e = new WheelEvent("wheel", { deltaY, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };
  const touch = (type: string, y: number | null) => {
    const e = new Event(type, { cancelable: true });
    Object.defineProperty(e, "touches", { value: y === null ? [] : [{ clientY: y }] });
    window.dispatchEvent(e);
    return e;
  };

  it("a wheel step flies to the next chapter and lands the page on it", () => {
    const e = wheel(100);
    expect(e.defaultPrevented).toBe(true);
    expect(useCity.getState().progress).toBe(1);
    expect(useCity.getState().jump).toMatchObject({ index: 1 });
    expect(window.scrollY).toBe(sectionHeight());
  });

  it("leaves pinch zoom and Explore alone", () => {
    expect(wheel(100, { ctrlKey: true }).defaultPrevented).toBe(false);
    useCity.setState({ mode: "explore" });
    expect(wheel(100).defaultPrevented).toBe(false);
    expect(useCity.getState().progress).toBe(0);
  });

  it("keys move a chapter, but not while typing", () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "End", cancelable: true }));
    expect(useCity.getState().progress).toBe(LAST);
    const input = document.body.appendChild(document.createElement("input"));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    expect(useCity.getState().progress).toBe(LAST);
    input.remove();
  });

  it("a swipe moves one chapter however long the finger keeps going", () => {
    touch("touchstart", 500);
    expect(touch("touchmove", 470).defaultPrevented).toBe(true);
    touch("touchmove", 420);
    touch("touchmove", 200);
    touch("touchend", null);
    expect(useCity.getState().progress).toBe(1);
    touch("touchstart", 300);
    touch("touchmove", 400);
    touch("touchend", null);
    expect(useCity.getState().progress).toBe(0);
  });

  it("a scroll it did not make (scrollbar, anchor, focus) flies to that chapter, then snaps the page to it", () => {
    at(sectionHeight() * 3.2);
    window.dispatchEvent(new Event("scroll"));
    expect(useCity.getState().jump).toMatchObject({ index: 3 });
    expect(scrollTo).not.toHaveBeenCalled(); // not while the scroll may still be going
    vi.advanceTimersByTime(300);
    expect(window.scrollY).toBe(sectionHeight() * 3);
  });

  it("stops listening once detached (walk mode)", () => {
    detach();
    expect(wheel(100).defaultPrevented).toBe(false);
    expect(useCity.getState().progress).toBe(0);
    detach = () => {};
  });
});
