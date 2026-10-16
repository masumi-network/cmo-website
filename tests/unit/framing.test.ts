import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { chapters, type Chapter } from "@/content/day";
import { PORTRAIT_FOV, fitBand, largestGap } from "@/scene/camera-rig";
import { CAR } from "@/scene/cable-car";
import { FERRY_CAR, envelope } from "@/scene/ferry";
import { FERRY, insideBuilding, sightClear } from "@/scene/layout";
import { BAY_TOWERS, GG } from "@/scene/landmarks";
import { RIDGES, ridgeColumns } from "@/scene/skyline";
import { overlays, rig } from "@/scene/shared";
import { AD_PANEL, FACE_Z, UNION } from "@/scene/union-square";

type Size = { width: number; height: number };
type Box = { left: number; top: number; right: number; bottom: number };

/**
 * Phones as VERIFY.md lists them (portrait, under 768 wide: the phone rig),
 * with the free band between the top bar and the 12:00 card, measured on the
 * real page (Pixel 7 is 412 x 839 in Playwright).
 */
const PHONES: { name: string; size: Size; band: [number, number] }[] = [
  { name: "375x667", size: { width: 375, height: 667 }, band: [76, 499] },
  { name: "390x844", size: { width: 390, height: 844 }, band: [76, 676] },
  { name: "412x915", size: { width: 412, height: 915 }, band: [76, 747] },
  { name: "Pixel 7", size: { width: 412, height: 839 }, band: [76, 671] },
];
/** The bubble: one line of text-lg, as measured (it wraps to the screen less 32 px when longer). */
const BUBBLE = { width: 330, height: 56, anchor: [-0.6, 2.15] as const };

/** The phone rig at rest on a chapter (camera-rig.tsx): pull back and slide so Cuso fits the band. */
function phoneShot(ch: Chapter, size: Size, band: [number, number], bubbleWidth = BUBBLE.width) {
  const pos = new Vector3(...ch.phone.position);
  const tgt = new Vector3(...ch.phone.target);
  rig.cuso.set(...ch.spot);
  const slide = fitBand(pos, tgt, PORTRAIT_FOV, size, band);
  const cam = new PerspectiveCamera(PORTRAIT_FOV, size.width / size.height);
  cam.position.copy(pos);
  cam.lookAt(tgt);
  cam.updateMatrixWorld();
  const px = (p: Vector3) => {
    const n = p.clone().project(cam);
    return { x: ((n.x + 1) * size.width) / 2, y: ((1 - n.y) * size.height) / 2 - slide };
  };
  const boxOf = (ps: Vector3[]): Box => {
    const s = ps.map(px);
    return { left: Math.min(...s.map((p) => p.x)), top: Math.min(...s.map((p) => p.y)), right: Math.max(...s.map((p) => p.x)), bottom: Math.max(...s.map((p) => p.y)) };
  };
  // At rest he faces the camera; the bubble hangs beside his arrow tip (cuso.tsx Bubble)
  const spot = new Vector3(...ch.spot);
  const heading = Math.atan2(pos.x - spot.x, pos.z - spot.z);
  const [ax, ay] = BUBBLE.anchor;
  const anchor = px(new Vector3(spot.x + ax * Math.cos(heading), spot.y + ay, spot.z - ax * Math.sin(heading)));
  const w = Math.min(bubbleWidth, size.width - 32);
  const left = Math.min(Math.max(anchor.x - w / 2, 16), size.width - w - 16);
  const y = Math.max(anchor.y, band[0] + 12 + BUBBLE.height);
  const bubble: Box = { left, top: y - BUBBLE.height, right: left + w, bottom: y };
  // Cuso's box as publishCuso draws it
  const head = px(spot.clone().setY(spot.y + 1.9));
  const feet = px(spot);
  const half = (feet.y - head.y) / 3;
  const cuso: Box = { left: feet.x - half, top: head.y, right: feet.x + half, bottom: feet.y };
  return { boxOf, bubble, cuso };
}

const overlap = (a: Box, b: Box, margin = 0) => a.left < b.right + margin && b.left < a.right + margin && a.top < b.bottom + margin && b.top < a.bottom + margin;

describe("phone framing", () => {
  it("measures the top bar and cards once per scroll position, not every frame (a forced layout each time)", () => {
    document.body.innerHTML = "<header></header><section data-card></section><section data-card></section>";
    const query = vi.spyOn(document, "querySelectorAll");
    const first = overlays();
    expect(first.cards).toHaveLength(2);
    expect(first.header).not.toBeNull();
    overlays();
    overlays();
    expect(query).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    overlays();
    expect(query).toHaveBeenCalledTimes(2);
    query.mockRestore();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    document.body.innerHTML = "";
  });

  it("finds the biggest free stretch between the top bar and the cards", () => {
    // top bar 0..76, two cards stacked at the bottom of an 844 px screen
    expect(largestGap([[0, 76], [449, 630], [642, 829]], 844)).toEqual([76, 449]);
    // hero: bar, text and form on top, the scroll button at the bottom
    expect(largestGap([[0, 76], [96, 478], [770, 818]], 844)).toEqual([478, 770]);
    // overlapping and unsorted edges
    expect(largestGap([[500, 900], [0, 80], [60, 120]], 844)).toEqual([120, 500]);
    // nothing in the way
    expect(largestGap([], 600)).toEqual([0, 600]);
  });

  it.each(PHONES)("on a $name phone Cuso stands inside the screen in every chapter, the hero included", ({ size, band }) => {
    // the hero's free band is below its words and form, above the scroll button (measured on a 390x844 phone)
    const hero: [number, number] = [Math.round(size.height * 0.57), Math.round(size.height * 0.91)];
    for (const ch of chapters) {
      const { cuso } = phoneShot(ch, size, ch.id === "arrive" ? hero : band);
      expect(cuso.top >= 0 && cuso.bottom <= size.height && cuso.left >= 0 && cuso.right <= size.width, `${ch.id}: ${JSON.stringify(cuso)}`).toBe(true);
    }
  });

  it("every chapter has a phone shot that starts outside buildings", () => {
    for (const c of chapters) expect(insideBuilding(...c.phone.position), c.id).toBe(false);
  });

  it.each(PHONES)("12:00 on a $name phone: the ad's words stay readable, clear of the bubble and of Cuso", ({ size, band }) => {
    const ads = chapters.find((c) => c.id === "ads")!;
    const { boxOf, bubble, cuso } = phoneShot(ads, size, band);
    // the words on the sign (textures.ts useSign): the brand centred 40% down, the sale line 74% down, 86% of the width at most
    const [W, H] = AD_PANEL;
    const { x: bx, y: by } = UNION.board;
    const brand = boxOf([-1, 1].flatMap((sx) => [by + 0.25 * H, by - 0.3 * H].map((y) => new Vector3(bx + sx * 0.43 * W, y, FACE_Z))));
    expect(overlap(bubble, brand, 6), `bubble ${JSON.stringify(bubble)} over the brand ${JSON.stringify(brand)}`).toBe(false);
    expect(overlap(cuso, brand), `Cuso over the brand`).toBe(false);
    // on screen, under the top bar and above the card
    expect(brand.top).toBeGreaterThanOrEqual(band[0]);
    expect(brand.bottom).toBeLessThanOrEqual(band[1]);
    expect(brand.left).toBeGreaterThanOrEqual(0);
    expect(brand.right).toBeLessThanOrEqual(size.width);
  });
});

/** Where a point lands on a 1440 x 900 desktop at a chapter's desktop shot. */
function onDesktop(id: Chapter["id"], p: Vector3) {
  const ch = chapters.find((c) => c.id === id)!;
  const size = { width: 1440, height: 900 };
  const cam = new PerspectiveCamera(35, size.width / size.height);
  cam.position.set(...ch.camera.position);
  cam.lookAt(new Vector3(...ch.camera.target));
  cam.updateMatrixWorld();
  const n = p.clone().project(cam);
  return { x: ((n.x + 1) * size.width) / 2, y: ((1 - n.y) * size.height) / 2, front: n.z < 1, from: cam.position };
}
/** In front of the lens, on screen and right of the card column (cards end at 458 px). */
const rightOfCards = ({ x, y, front }: { x: number; y: number; front: boolean }) => front && x > 458 && x < 1440 && y > 0 && y < 900;

describe("the 12:00 desktop shot", () => {
  // Shot like a photo (F13): past Cuso and the billboard to the Golden Gate in the haze, not up at two towers.
  it("looks past Cuso to the Golden Gate, in frame and right of the chapter card", () => {
    const top = new Vector3(GG.x, GG.top + 1, GG.towers[0]); // just over the south tower
    const at = onDesktop("ads", top);
    expect(rightOfCards(at), JSON.stringify(at)).toBe(true);
    expect(sightClear(at.from, top)).toBe(true);
  });
});

describe("the 15:00 desktop shot", () => {
  // Proposal A (2026-10-15): from the pyramid's tip east to the Bay Bridge and the East Bay hills, like concept 05.
  it("looks past Cuso to the Bay Bridge, its first tower in frame and right of the chapter card", () => {
    const top = new Vector3(BAY_TOWERS[0], 25, 14); // just under the west tower's top strut
    const at = onDesktop("seo", top);
    expect(rightOfCards(at), JSON.stringify(at)).toBe(true);
    expect(sightClear(at.from, top)).toBe(true);
  });

  it("has the East Bay hills on the horizon behind the bridge", () => {
    const east = ridgeColumns(RIDGES.find((r) => r.name === "east-bay")!);
    const behind = east.reduce((a, b) => (Math.abs(b.points[b.crest][2] - 14) < Math.abs(a.points[a.crest][2] - 14) ? b : a));
    const at = onDesktop("seo", new Vector3(...behind.points[behind.crest]));
    expect(rightOfCards(at), JSON.stringify(at)).toBe(true);
  });
});

describe("the 18:00 desktop shot", () => {
  // Option 1 (2026-10-15): down the street past the cable car to the Ferry Building and the gold water.
  it("looks past Cuso to the Ferry Building, in frame and right of the chapter card", () => {
    const top = new Vector3(FERRY.x - FERRY.plinth[0] / 2 - 1.2, FERRY.hall[1] * 0.75, FERRY.z + FERRY.hall[2] / 2 - 1); // just off the front, high, by its south end
    const at = onDesktop("newsletter", top);
    expect(rightOfCards(at), JSON.stringify(at)).toBe(true);
    expect(sightClear(at.from, top)).toBe(true);
  });

  it("has Cuso right of the chapter card, his feet above the bottom of the screen", () => {
    const ch = chapters.find((c) => c.id === "newsletter")!;
    const feet = onDesktop("newsletter", new Vector3(...ch.spot));
    const head = onDesktop("newsletter", new Vector3(ch.spot[0], ch.spot[1] + 1.9, ch.spot[2]));
    expect(rightOfCards(feet) && rightOfCards(head), JSON.stringify({ feet, head })).toBe(true);
  });
});

describe("the 18:00 envelopes", () => {
  // Francis (2026-10-16): they flew up at the lens and hung over Cuso's head. Like concept 06 they leave his
  // raised hand and fly away into the scene, smaller and smaller, clear of his face, the bubble and the card.
  const ch = chapters.find((c) => c.id === "newsletter")!;
  const cuso = new Vector3(...ch.spot);
  /** "Special delivery!" on one line, as measured (170 x 52 px). */
  const LINE = 170;
  /** His face: the middle half of his box, its top 45% (the eyes sit there; his raised hand is beside it). */
  const faceOf = (b: Box): Box => {
    const quarter = (b.right - b.left) / 4;
    return { left: b.left + quarter, right: b.right - quarter, top: b.top, bottom: b.top + (b.bottom - b.top) * 0.45 };
  };
  const flights = (shot: Chapter["camera"], phone: boolean) =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const from = new Vector3(...shot.position);
      const look = new Vector3(...shot.target).sub(from);
      const steps: { p: Vector3; scale: number; depth: number }[] = [];
      for (let u = 0; u <= 1.0001; u += 0.02) {
        const p = new Vector3();
        const scale = envelope(u, i, cuso, look, phone, p);
        steps.push({ p, scale, depth: p.clone().sub(from).dot(look.clone().normalize()) });
      }
      return steps;
    });
  /** The bubble on a wide screen hangs left of its anchor (cuso.tsx Bubble), bottom at the anchor. */
  const desktopBubble = (): Box => {
    const camPos = new Vector3(...ch.camera.position);
    const heading = Math.atan2(camPos.x - cuso.x, camPos.z - cuso.z);
    const [ax, ay] = BUBBLE.anchor;
    const a = onDesktop("newsletter", new Vector3(cuso.x + ax * Math.cos(heading), cuso.y + ay, cuso.z - ax * Math.sin(heading)));
    return { left: a.x - LINE, top: a.y - BUBBLE.height, right: a.x, bottom: a.y };
  };
  const inBox = (b: Box, x: number, y: number, margin = 0) => x > b.left - margin && x < b.right + margin && y > b.top - margin && y < b.bottom + margin;

  for (const [name, phone] of [["desktop", false], ["phone", true]] as const) {
    it(`on the ${name} shot they fly away from the lens, shrinking, and never through the cable car or a building`, () => {
      const shot = phone ? ch.phone : ch.camera;
      for (const steps of flights(shot, phone)) {
        const seen = steps.filter((s) => s.scale > 0.05);
        expect(seen.length).toBeGreaterThan(30);
        for (let k = 1; k < seen.length; k++) expect(seen[k].depth).toBeGreaterThan(seen[k - 1].depth);
        // farther by a good stretch, so perspective shrinks them too
        expect(seen.at(-1)!.depth - seen[0].depth).toBeGreaterThan(phone ? 2.5 : 8);
        // they leave his hand at full size and fade (shrink) out at the end
        expect(Math.max(...steps.slice(0, 10).map((s) => s.scale))).toBeGreaterThan(0.9);
        expect(steps.at(-1)!.scale).toBeLessThan(0.05);
        for (const { p } of seen) {
          expect(insideBuilding(p.x, p.y, p.z), `in a building at ${p.toArray()}`).toBe(false);
          const [cx, , cz] = FERRY_CAR.p;
          const inCar = Math.abs(p.x - cx) < CAR.roof.x + 0.1 && Math.abs(p.z - cz) < CAR.roof.z + 0.1 && p.y < cuso.y + CAR.height + 0.15;
          expect(inCar, `through the cable car at ${p.toArray()}`).toBe(false);
        }
      }
    });
  }

  it("on a 1440 x 900 desktop they stay right of the card column, in frame, clear of the bubble and of Cuso's face", () => {
    const bubble = desktopBubble();
    const head = onDesktop("newsletter", cuso.clone().setY(cuso.y + 1.9));
    const feet = onDesktop("newsletter", cuso);
    const half = (feet.y - head.y) / 3;
    const body: Box = { left: feet.x - half, top: head.y, right: feet.x + half, bottom: feet.y };
    const face = faceOf(body);
    for (const steps of flights(ch.camera, false)) {
      const seen = steps.filter((s) => s.scale > 0.05);
      const shown = seen.map(({ p }) => onDesktop("newsletter", p));
      for (const [k, at] of shown.entries()) {
        expect(rightOfCards(at), `step ${k} ${JSON.stringify(at)}`).toBe(true);
        expect(inBox(bubble, at.x, at.y, 16), `step ${k} over the bubble`).toBe(false);
        expect(inBox(face, at.x, at.y, 10), `step ${k} over his face`).toBe(false);
      }
      // past the first few steps out of his hand, they are clear of him altogether
      const out = shown.filter((at) => !inBox(body, at.x, at.y));
      expect(out.length / shown.length).toBeGreaterThan(0.85);
    }
  });

  it.each(PHONES)("on a $name phone they stay in the band, in frame, clear of the bubble and of Cuso's face", ({ size, band }) => {
    const { boxOf, bubble, cuso: body } = phoneShot(ch, size, band, LINE);
    const face = faceOf(body);
    for (const steps of flights(ch.phone, true)) {
      const shown = steps.filter((s) => s.scale > 0.05).map(({ p }) => boxOf([p]));
      for (const [k, at] of shown.entries()) {
        expect(inBox(bubble, at.left, at.top, 16), `step ${k} over the bubble ${JSON.stringify({ at, bubble })}`).toBe(false);
        expect(inBox(face, at.left, at.top, 10), `step ${k} over his face`).toBe(false);
      }
      const inside = shown.filter((at) => at.left > 0 && at.left < size.width && at.top > band[0] && at.top < band[1]);
      expect(inside.length / shown.length).toBeGreaterThan(0.85);
      const out = shown.filter((at) => !inBox(body, at.left, at.top));
      expect(out.length / shown.length).toBeGreaterThan(0.85);
    }
  });
});
