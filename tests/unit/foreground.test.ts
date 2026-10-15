import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { chapters } from "@/content/day";
import { heightAt } from "@/lib/terrain";
import { FOREGROUNDS, foregroundAt, leafLayout, propFade, propPose, SPRITE } from "@/scene/foreground";
import { AD_PANEL, FACE_Z, UNION } from "@/scene/union-square";

type Box = { left: number; top: number; right: number; bottom: number };
const overlap = (a: Box, b: Box, margin = 0) => a.left < b.right + margin && b.left < a.right + margin && a.top < b.bottom + margin && b.top < a.bottom + margin;

type Chapter = (typeof chapters)[number];
const ads = chapters.find((c) => c.id === "ads")!;
const prop = FOREGROUNDS.ads![0];
/** Every prop with its chapter. */
const PROPS = Object.entries(FOREGROUNDS).flatMap(([id, props]) => props!.map((p, i) => [`${id} ${i}`, chapters.find((c) => c.id === id)!, p] as const));
/** Desktop and laptop screens, 4:3 to 2:1 (the card column is 458 px wide on all of them). */
const SIZES = [
  { width: 1200, height: 900 },
  { width: 1440, height: 900 },
  { width: 1800, height: 900 },
];
const CARD = 458;
/** The bubble as measured at 1440x900 (one line), up and left of the anchor beside his arrow tip (cuso.tsx). */
const BUBBLE = { width: 330, height: 52, anchor: [-0.6, 2.15] as const };
/** The pointer parallax (camera-rig.tsx): the camera moves up to 0.35 sideways and 0.2 up. */
const POINTERS = [[0, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;

/** A chapter's desktop shot at rest (12:00 by default), the pointer at (px, py). */
function shot(size: { width: number; height: number }, px = 0, py = 0, chapter: Chapter = ads, p = prop) {
  const cam = new PerspectiveCamera(35, size.width / size.height, 0.2, 1200);
  const pos = new Vector3(...chapter.camera.position);
  const tgt = new Vector3(...chapter.camera.target);
  const right = tgt.clone().sub(pos).cross(new Vector3(0, 1, 0)).normalize();
  pos.addScaledVector(right, px * 0.35).add(new Vector3(0, py * 0.2, 0));
  cam.position.copy(pos);
  cam.lookAt(tgt);
  cam.updateMatrixWorld();
  const px2 = (p: Vector3) => {
    const n = p.clone().project(cam);
    return { x: ((n.x + 1) * size.width) / 2, y: ((1 - n.y) * size.height) / 2, z: n.z };
  };
  const boxOf = (ps: Vector3[]): Box => {
    const s = ps.map(px2);
    return { left: Math.min(...s.map((p) => p.x)), top: Math.min(...s.map((p) => p.y)), right: Math.max(...s.map((p) => p.x)), bottom: Math.max(...s.map((p) => p.y)) };
  };
  const spot = new Vector3(...chapter.spot);
  const head = px2(spot.clone().setY(spot.y + 1.9));
  const feet = px2(spot);
  const half = (feet.y - head.y) / 3;
  const cuso: Box = { left: feet.x - half, top: head.y, right: feet.x + half, bottom: feet.y };
  const heading = Math.atan2(cam.position.x - spot.x, cam.position.z - spot.z);
  const [ax, ay] = BUBBLE.anchor;
  const anchor = px2(new Vector3(spot.x + ax * Math.cos(heading), spot.y + ay, spot.z - ax * Math.sin(heading)));
  const bubble: Box = { left: anchor.x - BUBBLE.width, top: anchor.y - BUBBLE.height, right: anchor.x, bottom: anchor.y };
  // the whole ad face and its frame (union-square.tsx: the building stands on heightAt(7, 9))
  const [W, H] = AD_PANEL;
  const bx = UNION.board.x;
  const by = UNION.board.y + heightAt(7, 9);
  const board = boxOf([-1, 1].flatMap((sx) => [-1, 1].map((sy) => new Vector3(bx + (sx * W) / 2 + sx * 0.1, by + (sy * H) / 2 + sy * 0.1, FACE_Z))));
  // the prop as drawn, pushed the other way by the pointer like the component does
  const pose = propPose(cam, p, [-px, -py]);
  const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => new Vector3(sx * pose.width / 2, sy * pose.height / 2, 0).applyQuaternion(pose.quaternion).add(pose.position)));
  const leaves = boxOf(corners);
  const depth = corners.map((c) => c.clone().applyMatrix4(cam.matrixWorldInverse).z);
  return { cam, cuso, bubble, board, leaves, corners, depth, ndc: corners.map((c) => px2(c).z) };
}

describe("foreground props", () => {
  it("at most one per chapter, only where its concept has one", () => {
    for (const props of Object.values(FOREGROUNDS)) expect(props).toHaveLength(1);
    expect(FOREGROUNDS.ads).toHaveLength(1);
  });

  it.each(PROPS)("%s: never covers Cuso, his bubble or the chapter card, at any size or pointer", (_, chapter, p) => {
    for (const size of SIZES)
      for (const [px, py] of POINTERS) {
        const { leaves, cuso, bubble } = shot(size, px, py, chapter, p);
        const at = `${size.width}x${size.height} pointer ${px},${py}: leaves ${JSON.stringify(leaves)}`;
        expect(overlap(leaves, cuso, 24), `${at} over Cuso ${JSON.stringify(cuso)}`).toBe(false);
        expect(overlap(leaves, bubble, 24), `${at} over the bubble`).toBe(false);
        // the cards stand on the right at 22:00 (chapters.tsx), on the left at every other hour
        if (chapter.id === "night") expect(leaves.left, at).toBeGreaterThan(size.width + 24);
        else expect(leaves.left, at).toBeGreaterThan(CARD + 24);
      }
  });

  it.each(PROPS)("%s: shows only at rest on its own desktop shot", (_, chapter) => {
    const at = (s: { position: readonly number[]; target: readonly number[] }) => {
      const c = new PerspectiveCamera(35, 1.6);
      c.position.set(s.position[0], s.position[1], s.position[2]);
      c.lookAt(s.target[0], s.target[1], s.target[2]);
      c.updateMatrixWorld();
      return c;
    };
    expect(propFade(at(chapter.camera), chapter.camera, false)).toBe(1);
    for (const ch of chapters) {
      expect(propFade(at(ch.phone), chapter.camera, false), `${ch.id} phone`).toBe(0);
      if (ch.id !== chapter.id && ch.camera !== chapter.camera) expect(propFade(at(ch.camera), chapter.camera, false), ch.id).toBe(0);
    }
  });
});

describe("foreground prop at 12:00", () => {
  it.each(SIZES)("sits in the bottom-right corner of a $width x $height frame, touching both edges, small", (size) => {
    for (const [px, py] of POINTERS) {
      const { leaves } = shot(size, px, py);
      expect(leaves.right, `pointer ${px},${py}`).toBeGreaterThanOrEqual(size.width);
      expect(leaves.bottom).toBeGreaterThanOrEqual(size.height);
      const shown = (size.width - Math.max(leaves.left, 0)) * (size.height - Math.max(leaves.top, 0));
      expect(shown / (size.width * size.height)).toBeLessThanOrEqual(0.15);
      expect(shown / (size.width * size.height)).toBeGreaterThanOrEqual(0.04);
    }
  });

  it.each(SIZES)("on $width x $height never covers the ad", (size) => {
    for (const [px, py] of POINTERS) {
      const { leaves, board } = shot(size, px, py);
      expect(overlap(leaves, board, 8), `pointer ${px},${py}: leaves ${JSON.stringify(leaves)} over the ad ${JSON.stringify(board)}`).toBe(false);
    }
  });

  it("stands in front of the lens, past the near plane", () => {
    const { depth, ndc, cam } = shot(SIZES[1]);
    for (const z of depth) expect(-z).toBeGreaterThan(cam.near * 2);
    for (const z of ndc) expect(Math.abs(z)).toBeLessThan(1);
  });

  it("shows only at rest on the 12:00 desktop shot", () => {
    const { cam } = shot(SIZES[1]);
    expect(propFade(cam, ads.camera, false)).toBe(1);
    // the pointer parallax keeps it
    expect(propFade(shot(SIZES[1], 1, 1).cam, ads.camera, false)).toBe(1);
    // Explore
    expect(propFade(cam, ads.camera, true)).toBe(0);
    // every other chapter's desktop shot, and every phone shot
    const at = (s: { position: readonly number[]; target: readonly number[] }) => {
      const c = new PerspectiveCamera(35, 1.6);
      c.position.set(s.position[0], s.position[1], s.position[2]);
      c.lookAt(s.target[0], s.target[1], s.target[2]);
      c.updateMatrixWorld();
      return c;
    };
    for (const ch of chapters) {
      expect(propFade(at(ch.phone), ads.camera, false), `${ch.id} phone`).toBe(0);
      if (ch.id !== "ads") expect(propFade(at(ch.camera), ads.camera, false), ch.id).toBe(0);
    }
    // a tablet stands upright 1.3x farther back (camera-rig.tsx)
    const tablet = at({ position: new Vector3(...ads.camera.position).sub(new Vector3(...ads.camera.target)).multiplyScalar(1.3).add(new Vector3(...ads.camera.target)).toArray(), target: ads.camera.target });
    expect(propFade(tablet, ads.camera, false)).toBe(0);
  });

  it("fades with distance from the shot, never pops", () => {
    const { cam } = shot(SIZES[1]);
    const dir = new Vector3(1, 0.3, -0.5).normalize();
    let last = 1;
    for (let d = 0; d <= 2.5; d += 0.05) {
      const c = cam.clone();
      c.position.addScaledVector(dir, d);
      c.updateMatrixWorld();
      const f = propFade(c, ads.camera, false);
      expect(f).toBeLessThanOrEqual(last);
      expect(last - f).toBeLessThan(0.1);
      if (d <= 0.8) expect(f).toBe(1);
      if (d >= 2) expect(f).toBe(0);
      last = f;
    }
  });

  it("hides when the camera looks away (a flight passing the spot)", () => {
    const { cam } = shot(SIZES[1]);
    cam.lookAt(cam.position.clone().add(new Vector3(-1, 0, 0)));
    cam.updateMatrixWorld();
    expect(propFade(cam, ads.camera, false)).toBe(0);
  });

  it("is tinted by the hour's light, and never pops while scrolling", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let h = 6; h < 30; h += 0.05) {
      const a = rgb(foregroundAt(h).tint);
      const b = rgb(foregroundAt(h + 0.05).tint);
      a.forEach((v, i) => expect(Math.abs(b[i] - v), `${h.toFixed(2)}`).toBeLessThanOrEqual(4));
    }
    // darker at night than at noon
    expect(rgb(foregroundAt(22).tint)[1]).toBeLessThan(rgb(foregroundAt(12).tint)[1]);
  });

  it("lays out leaves the same way every time, inside the sprite, soft toward the frame", () => {
    const a = leafLayout(prop.seed);
    expect(leafLayout(prop.seed)).toEqual(a);
    expect(leafLayout(prop.seed + 1)).not.toEqual(a);
    expect(a.length).toBeGreaterThan(30);
    const [w, h] = SPRITE;
    for (const l of a) {
      // the inner edges (top and left, toward the picture) stay clear so the blur never shows a hard edge
      expect(l.x - l.r).toBeGreaterThanOrEqual(w * 0.04);
      expect(l.y - l.r).toBeGreaterThanOrEqual(h * 0.04);
      expect(l.x).toBeLessThanOrEqual(w);
      expect(l.y).toBeLessThanOrEqual(h);
    }
    // real foliage: several greens, a few warm sunlit edges, not one flat colour
    expect(new Set(a.map((l) => l.color)).size).toBeGreaterThanOrEqual(4);
    expect(a.some((l) => l.warm)).toBe(true);
    expect(a.filter((l) => l.warm).length).toBeLessThan(a.length / 3);
  });
});
