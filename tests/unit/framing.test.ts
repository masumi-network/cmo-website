import { describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { chapters, type Chapter } from "@/content/day";
import { PORTRAIT_FOV, fitBand, largestGap } from "@/scene/camera-rig";
import { insideBuilding } from "@/scene/layout";
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
function phoneShot(ch: Chapter, size: Size, band: [number, number]) {
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
  const w = Math.min(BUBBLE.width, size.width - 32);
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
