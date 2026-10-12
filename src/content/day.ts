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

export type Vec3 = readonly [number, number, number];

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
  /** Concept render, used as poster and as the no-WebGL fallback. */
  poster: string;
  /** Where Cuso stands. */
  spot: Vec3;
  camera: Shot;
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
    body: "Meet Cuso, your AI CMO. Spend one day with him in the city and watch him do the work.",
    place: "Russian Hill",
    bubble: "Morning! I'm Cuso.",
    poster: "/concepts/01-hero-rooftop.jpg",
    spot: [-14, 8, -12.9],
    camera: frame([-14, 8, -12.9], { yaw: 352, distance: 7, height: 1.6, look: 1.9 }),
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
    poster: "/concepts/02-brand-brain.jpg",
    spot: [-9.6, 0, 14.6],
    camera: frame([-9.6, 0, 14.6], { yaw: 18, distance: 7, height: 1.3, look: 1.8 }),
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
    poster: "/concepts/03-social.jpg",
    spot: [-2.8, 0, 29.6],
    camera: frame([-2.8, 0, 29.6], { yaw: 68, distance: 6.8, height: 1.3, look: 1.8, side: 0.28 }),
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
    poster: "/concepts/04-ads.jpg",
    spot: [5.6, 5, 10.4],
    camera: frame([5.6, 5, 10.4], { yaw: 12, distance: 9, height: -1.2, look: 1.9, side: -0.05 }),
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
    poster: "/concepts/05-seo.jpg",
    spot: [6.5, 28, -11],
    camera: frame([6.5, 28, -11], { yaw: 285, distance: 9, height: 4.2, look: -0.6, side: 0.25 }),
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
    poster: "/concepts/06-newsletter.jpg",
    spot: [20.9, 0.9, 5.2],
    camera: frame([20.9, 0.9, 5.2], { yaw: 90, distance: 6.5, height: 0.7, look: 1.5 }),
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
    poster: "/concepts/07-night.jpg",
    spot: [33.6, 0.55, 24.2],
    camera: frame([33.6, 0.55, 24.2], { yaw: 315, distance: 6.5, height: 1.1, look: 1.3, side: -0.3 }),
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
    poster: "/concepts/09-finale.jpg",
    spot: [-14, 8, -12.9],
    camera: frame([-14, 8, -12.9], { yaw: 322, distance: 30, height: 13, look: 2, side: 0.2 }),
    dark: false,
  },
];

/** Bird's-eye camera for Explore mode. */
export const overviewCamera = { position: [52, 86, 92] as Vec3, target: [0, 0, 4] as Vec3 };

export const chapterIndex = (id: ChapterId): number => chapters.findIndex((c) => c.id === id);
