// Shared state between the HTML layer and the 3D scene. The scene reads it
// inside useFrame via getState(), so scrolling never re-renders the canvas.

import { create } from "zustand";
import { sampleBrand } from "@/content/sample";

export type Mode = "story" | "explore";

/**
 * A jump to a chapter (the rail, an Explore pin, Ask Cuso): which chapter,
 * when (seconds, performance.now() / 1000), the hour the light showed then,
 * how long the light takes to the new hour (`time`, navigate.ts jumpTime) and
 * `cut` (reduced motion: no flight, he is already there).
 */
export type Jump = { index: number; at: number; hour: number; time: number; cut: boolean };

type CityState = {
  /** Scroll position in sections (2.5 = halfway through section 2). */
  progress: number;
  mode: Mode;
  /** The visitor's website. Drives the signs in the city. */
  website: string;
  approved: boolean;
  agreed: boolean;
  /** Latest thing Cuso said in reply to the visitor. */
  reply: string;
  /** Bumps when Cuso should celebrate (spin). */
  cheer: number;
  jump: Jump | null;
  setProgress: (progress: number) => void;
  setMode: (mode: Mode) => void;
  setWebsite: (website: string) => void;
  setApproved: (approved: boolean) => void;
  agree: () => void;
  say: (reply: string) => void;
  /** Land on chapter `index` now (see Jump). */
  jumpTo: (index: number, hour: number, time: number, cut: boolean) => void;
};

export const initialCity = {
  progress: 0,
  mode: "story" as Mode,
  website: sampleBrand.website,
  approved: false,
  agreed: false,
  reply: "",
  cheer: 0,
  jump: null as Jump | null,
};

export const useCity = create<CityState>((set) => ({
  ...initialCity,
  setProgress: (progress) => set({ progress }),
  setMode: (mode) => set({ mode }),
  setWebsite: (website) => set((s) => ({ website, cheer: s.cheer + 1, reply: "Got it. Putting your name up around town." })),
  setApproved: (approved) => set((s) => ({ approved, cheer: approved ? s.cheer + 1 : s.cheer, reply: approved ? "Done. It goes out at 9." : "" })),
  agree: () => set((s) => ({ agreed: true, cheer: s.cheer + 1, reply: "Great. Sleep well. I got this." })),
  say: (reply) => set({ reply }),
  jumpTo: (index, hour, time, cut) => set({ progress: index, jump: { index, at: performance.now() / 1000, hour, time, cut } }),
}));
