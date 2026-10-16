// One day in Cuso's City. Each chapter is one scroll section, one place in the
// city and one job Cuso does. Positions are world units (Cuso is ~1 unit tall).

export type ChapterId =
  | "arrive"
  | "learn"
  | "social"
  | "ads"
  | "seo"
  | "newsletter"
  | "night"
  | "join";

import { at, heightAt } from "@/lib/terrain";

export type Vec3 = readonly [number, number, number];

// Rooftops are flat, so spots on them use the ground under the building's centre.
const RUSSIAN_HILL_ROOF = 8 + heightAt(-14, -10.4);
const UNION_SQUARE_ROOF = 5 + heightAt(7, 9);
const PYRAMID_TIP = 28 + heightAt(6.5, -11);

type Shot = { position: Vec3; target: Vec3 };

/**
 * Frame Cuso like a photographer would. `yaw` is where the camera stands,
 * seen from Cuso (0 = south, 90 = east). `side` moves Cuso off-centre:
 * +0.3 puts him on the right third, -0.3 on the left (cards take the other side).
 */
function frame(spot: Vec3, o: { yaw: number; distance: number; height: number; look?: number; side?: number }): Shot {
  const [x, y, z] = spot;
  const yaw = (o.yaw * Math.PI) / 180;
  const cx = x + Math.sin(yaw) * o.distance;
  const cz = z + Math.cos(yaw) * o.distance;
  const dx = (x - cx) / o.distance;
  const dz = (z - cz) / o.distance;
  const halfWidth = Math.tan((17.5 * Math.PI) / 180) * 1.6 * o.distance;
  const shift = (o.side ?? 0.3) * halfWidth;
  return {
    position: [cx, y + o.height, cz],
    target: [x + dz * shift, y + (o.look ?? 1.2), z - dx * shift],
  };
}

export type Chapter = {
  id: ChapterId;
  /** Hours since midnight. Past 24 means the next day (30 = 06:00 tomorrow). */
  hour: number;
  time: string;
  /** Short label for the day rail. */
  label: string;
  title: string;
  body: string;
  place: string;
  /** What Cuso says when he arrives. */
  bubble: string;
  /** Rendered from this chapter's 3D shot (scripts/posters.mjs): the loading cover and the no-3D fallback. A `-phone` twin sits beside it. */
  poster: string;
  /** Where Cuso stands. */
  spot: Vec3;
  camera: Shot;
  /**
   * The same place on a phone (portrait, under 768 px wide). Cuso is centred
   * (side 0); the camera rig then slides the picture up or down so he stands
   * in the free space between the top bar and the cards.
   */
  phone: Shot;
  /** Dark UI on top of a dark scene. */
  dark: boolean;
};

export const chapters: readonly Chapter[] = [
  {
    id: "arrive",
    hour: 6,
    time: "06:00",
    label: "Hello",
    title: "Marketing, on autopilot.",
    body: "Cuso is an AI CMO for founders. He runs your social, ads, SEO and email. Nothing goes out without your OK.",
    place: "Russian Hill",
    bubble: "Morning! I'm Cuso.",
    poster: "/posters/arrive.jpg",
    spot: [-14, RUSSIAN_HILL_ROOF, -12.9],
    camera: frame([-14, RUSSIAN_HILL_ROOF, -12.9], { yaw: 37, distance: 7.5, height: 2.0, look: 2.2 }),
    phone: frame([-14, RUSSIAN_HILL_ROOF, -12.9], { yaw: 37, distance: 9.5, height: 2.2, look: 1, side: 0 }),
    dark: false,
  },
  {
    id: "learn",
    hour: 7,
    time: "07:00",
    label: "Learn",
    title: "Learns your brand",
    body: "Give Cuso your website. He reads every page and learns how you talk, who you sell to and who you compete with.",
    place: "Hayes Valley",
    bubble: "Reading your About page. I like your tone.",
    poster: "/posters/learn.jpg",
    spot: at(-9.6, 0, 14.6),
    camera: frame(at(-9.6, 0, 14.6), { yaw: 18, distance: 7, height: 1.3, look: 1.8 }),
    phone: frame(at(-9.6, 0, 14.6), { yaw: 18, distance: 10, height: 5, look: 1.8, side: 0 }),
    dark: false,
  },
  {
    id: "social",
    hour: 9,
    time: "09:00",
    label: "Social",
    title: "Runs your social",
    body: "Cuso picks what to post and when, and writes it in your voice. Nothing goes out without your OK.",
    place: "Mission",
    bubble: "This one for Tuesday morning?",
    poster: "/posters/social.jpg",
    spot: at(-2.8, 0, 29.6),
    // low, along the sidewalk: the mural wall runs away on the right, the street on the left (concept 03, F13)
    camera: frame(at(-2.8, 0, 29.6), { yaw: 135, distance: 7.5, height: 0.9, look: 1.5, side: 0.28 }),
    phone: frame(at(-2.8, 0, 29.6), { yaw: 68, distance: 9, height: 1.4, look: 1, side: 0 }),
    dark: false,
  },
  {
    id: "ads",
    hour: 12,
    time: "12:00",
    label: "Ads",
    title: "Runs your ads",
    body: "Cuso builds your Google and Meta ads, then moves money to the ones that sell.",
    place: "Union Square",
    bubble: "Out with the old one. This one sells.",
    poster: "/posters/ads.jpg",
    spot: [5.6, UNION_SQUARE_ROOF, 10.4],
    // south-east, just over the roof: past Cuso and the billboard to the Golden Gate in the haze (F13)
    camera: frame([5.6, UNION_SQUARE_ROOF, 10.4], { yaw: 36, distance: 17.5, height: 1.5, look: 1.1, side: 0.3 }),
    // from above, so the billboard stands over Cuso and his bubble, never behind them (framing.test.ts)
    phone: frame([5.6, UNION_SQUARE_ROOF, 10.4], { yaw: 10, distance: 10, height: 7, look: 1.4, side: -0.3 }),
    dark: false,
  },
  {
    id: "seo",
    hour: 15,
    time: "15:00",
    label: "SEO",
    title: "Gets you found on Google",
    body: "Cuso finds what people search for, then updates your pages to match. You climb.",
    place: "Transamerica Pyramid",
    bubble: "Number one. Nice view up here.",
    poster: "/posters/seo.jpg",
    spot: [6.5, PYRAMID_TIP, -11],
    camera: frame([6.5, PYRAMID_TIP, -11], { yaw: 265, distance: 14, height: 4, look: 0.5, side: 0.25 }),
    phone: frame([6.5, PYRAMID_TIP, -11], { yaw: 285, distance: 11.5, height: 4.2, look: 0.2, side: 0 }),
    dark: false,
  },
  {
    id: "newsletter",
    hour: 18,
    time: "18:00",
    label: "Email",
    title: "Sends your newsletter",
    body: "Cuso turns your news into an email people want to read. Then he sends it and tracks who opens it.",
    place: "Ferry Building",
    bubble: "Special delivery!",
    poster: "/posters/newsletter.jpg",
    // He waits on the sidewalk beside the cable car's step (at(19.95, 0.34, 5.1)), which both shots frame:
    // on the step itself the car's roof is in the way of turning to the lens.
    spot: at(19.95, 0, 5.7),
    camera: frame(at(19.95, 0.34, 5.1), { yaw: 290, distance: 8, height: 1.4, look: 1.7, side: 0.3 }),
    phone: frame(at(19.95, 0.34, 5.1), { yaw: 42, distance: 9, height: 1, look: 1, side: 0 }),
    dark: false,
  },
  {
    id: "night",
    hour: 22,
    time: "22:00",
    label: "Report",
    title: "Learns while you sleep",
    body: "Every night Cuso checks what worked. Every week he tells you what he'll change.",
    place: "Embarcadero",
    bubble: "Night shift. Got a minute?",
    poster: "/posters/night.jpg",
    spot: [33.6, 0.55, 24.2],
    camera: frame([33.6, 0.55, 24.2], { yaw: 315, distance: 6.5, height: 1.1, look: 1.3, side: -0.3 }),
    phone: frame([33.6, 0.55, 24.2], { yaw: 315, distance: 5, height: 5.5, look: 0.6, side: 0 }),
    dark: true,
  },
  {
    id: "join",
    hour: 30,
    time: "06:00",
    label: "Tomorrow",
    title: "Your city. Your CMO.",
    body: "Cuso is almost ready. Join the waitlist and he starts with your brand first.",
    place: "Russian Hill",
    bubble: "Same time tomorrow?",
    poster: "/posters/join.jpg",
    spot: [-14, RUSSIAN_HILL_ROOF, -12.9],
    camera: frame([-14, RUSSIAN_HILL_ROOF, -12.9], { yaw: 322, distance: 30, height: 13, look: 2, side: 0.2 }),
    phone: frame([-14, RUSSIAN_HILL_ROOF, -12.9], { yaw: 332, distance: 34, height: 15, look: 2, side: 0 }),
    dark: false,
  },
];

/**
 * Explore mode's bird's-eye view: the direction it looks from, and the places
 * that must be in frame (every pin plus the Golden Gate). The camera rig
 * fits the distance to the screen, so nothing gets cut off on any size.
 */
export const overview = {
  direction: [0.42, 0.8, 0.44] as Vec3,
  include: [] as Vec3[],
};

export const chapterIndex = (id: ChapterId): number => chapters.findIndex((c) => c.id === id);
