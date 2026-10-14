// Jumping to a chapter (the rail, an Explore pin, Ask Cuso): the page lands
// on it at once; the scene flies the camera there (jumpTime) while Cuso
// walks his last few steps in (camera-rig.tsx, cuso.tsx), and the light
// cross-fades to the new hour. Scrolling instead walks him the whole way.

import { Vector3 } from "three";
import { chapters } from "@/content/day";
import { flightTime } from "@/scene/flight";
import { type Jump, useCity } from "./store";
import { travel } from "./time";

// Each chapter is one section, SECTION_VH viewports tall (the last is one).
export const SECTION_VH = 1.6;

/** Seconds the light takes on a jump from chapter `from` to `to`: as long as the flight between their desktop shots (the flight times itself, flight.ts). */
export const jumpTime = (from: number, to: number) => flightTime(new Vector3(...chapters[from].camera.position), new Vector3(...chapters[to].camera.position));

/** Measured, not computed: sections are in svh, and innerHeight changes as phone browser bars show and hide. */
export const sectionHeight = () => document.querySelector<HTMLElement>("main > section")?.offsetHeight || window.innerHeight * SECTION_VH;

/** How far through a jump of `time` s started at `at` we are at `now` (seconds), eased: no speed at either end. */
export function jumpEase(at: number, now: number, time: number) {
  const t = Math.min(1, Math.max(0, (now - at) / time));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** From hour `a` to `b` at u (0..1), the short way round the clock; within 6..30 like the chapters. */
export function sweepHour(a: number, b: number, u: number) {
  let d = b - a;
  if (d > 12) d -= 24;
  if (d < -12) d += 24;
  const h = a + d * u;
  return h >= 30 ? h - 24 : h < 6 ? h + 24 : h;
}

/** The hour the scene shows: the scroll's, eased in from where the light was when a jump began. */
export function shownHour({ progress, jump }: { progress: number; jump: Jump | null }, now: number) {
  const { from, to, t } = travel(progress, chapters.length);
  const hour = chapters[from].hour + (chapters[to].hour - chapters[from].hour) * t;
  if (!jump || jump.cut) return hour;
  const u = jumpEase(jump.at, now, jump.time);
  return u >= 1 ? hour : sweepHour(jump.hour, hour, u);
}

export function goToChapter(index: number) {
  const cut = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = useCity.getState();
  state.jumpTo(index, shownHour(state, performance.now() / 1000), jumpTime(Math.min(Math.round(state.progress), chapters.length - 1), index), cut);
  window.scrollTo({ top: index * sectionHeight(), behavior: "instant" });
}
