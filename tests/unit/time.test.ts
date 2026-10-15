import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { chapters } from "@/content/day";
import { PORTRAIT_FOV } from "@/scene/camera-rig";
import { GG, GG_PYLON } from "@/scene/landmarks";
import { activeIndex, lightingAt, mixHex, travel } from "@/lib/time";

describe("travel", () => {
  it("rests on a chapter for the first part of its section", () => {
    expect(travel(2, 8)).toEqual({ from: 2, to: 3, t: 0 });
    expect(travel(2.3, 8).t).toBe(0);
  });

  it("moves to the next chapter by the end of the section", () => {
    const mid = travel(2.7, 8);
    expect(mid.from).toBe(2);
    expect(mid.to).toBe(3);
    expect(mid.t).toBeGreaterThan(0);
    expect(mid.t).toBeLessThan(1);
    expect(travel(2.99, 8).t).toBeGreaterThan(0.95);
  });

  it("clamps outside the day", () => {
    expect(travel(-1, 8)).toEqual({ from: 0, to: 1, t: 0 });
    expect(travel(42, 8)).toEqual({ from: 7, to: 7, t: 0 });
  });
});

describe("activeIndex", () => {
  it("switches to the next chapter halfway through travel", () => {
    expect(activeIndex(2.1, 8)).toBe(2);
    expect(activeIndex(2.99, 8)).toBe(3);
    expect(activeIndex(100, 8)).toBe(7);
  });
});

describe("mixHex", () => {
  it("blends two colors", () => {
    expect(mixHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mixHex("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("lightingAt", () => {
  it("is bright at noon and dark at night", () => {
    expect(lightingAt(12).night).toBe(0);
    expect(lightingAt(22).night).toBe(1);
    expect(lightingAt(12).sunIntensity).toBeGreaterThan(lightingAt(22).sunIntensity);
  });

  it("puts the sun high at noon and low at sunrise", () => {
    expect(lightingAt(12).elevation).toBeGreaterThan(lightingAt(6).elevation);
  });

  it("wraps past midnight to the next morning (the opening shot's sun is dimmer and turned onto the pylons)", () => {
    const sky = (h: number) => ({ ...lightingAt(h), sunIntensity: 0, ambient: 0, azimuth: 0 });
    expect(sky(30)).toEqual(sky(6));
    expect(Math.abs(lightingAt(30).azimuth - lightingAt(6).azimuth)).toBeLessThanOrEqual(3);
    expect(lightingAt(26).night).toBeGreaterThan(0);
  });

  it("dims the 06:00 sun by a fifth: it glints off the bay in the opening shot; the finale keeps it", () => {
    expect(lightingAt(6).sunIntensity).toBeCloseTo(lightingAt(30).sunIntensity * 0.8);
    expect(lightingAt(30).sunIntensity).toBe(3.6);
  });

  // Where the sun (and its mirror image on the bay) lands on screen. atmosphere.tsx points the sun along
  // (cos el sin az, sin el, cos el cos az). The water's brightest glare sits a little above the mirror point.
  const DEG = Math.PI / 180;
  function onScreen(shot: { position: readonly number[]; target: readonly number[] }, size: { width: number; height: number }, fov: number) {
    const cam = new PerspectiveCamera(fov, size.width / size.height, 0.2, 5000);
    cam.position.set(shot.position[0], shot.position[1], shot.position[2]);
    cam.lookAt(shot.target[0], shot.target[1], shot.target[2]);
    cam.updateMatrixWorld();
    const px = (p: Vector3) => {
      const n = p.project(cam);
      return { x: ((n.x + 1) * size.width) / 2, y: ((1 - n.y) * size.height) / 2 };
    };
    return { point: (p: Vector3) => px(p.clone()), far: (dir: Vector3) => px(cam.position.clone().addScaledVector(dir, 2000)) };
  }
  const sunAt = (hour: number) => {
    const { azimuth: az, elevation: el } = lightingAt(hour);
    return new Vector3(Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.cos(az * DEG));
  };

  it("06:00 hides the low sun's glint on the bay behind the Golden Gate's south anchorage and pylons, far from Cuso", () => {
    const arrive = chapters.find((c) => c.id === "arrive")!;
    const sun = sunAt(6);
    const glint = new Vector3(sun.x, -sun.y, sun.z);
    const middle = new Vector3(arrive.spot[0], arrive.spot[1] + 0.95, arrive.spot[2]);
    // the anchorage block (water to road) and the two pylons on it (landmarks.tsx)
    const corners: Vector3[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      for (const y of [0, GG.anchorTop]) corners.push(new Vector3(GG.x + sx * 2.3, y, GG.south + sz * 2));
      for (const y of [GG.anchorTop, GG_PYLON.top]) corners.push(new Vector3(GG.x + sx * (GG_PYLON.x + 0.3), y, GG.south + sz * 0.9));
    }
    for (const size of [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
      const view = onScreen(arrive.camera, size, 35);
      const box = corners.map(view.point);
      const [x0, x1] = [Math.min(...box.map((b) => b.x)), Math.max(...box.map((b) => b.x))];
      const [y0, y1] = [Math.min(...box.map((b) => b.y)), Math.max(...box.map((b) => b.y))];
      const s = view.far(sun);
      const g = view.far(glint);
      const him = view.point(middle);
      const at = `${size.width}: glint ${Math.round(g.x)},${Math.round(g.y)} behind ${Math.round(x0)}..${Math.round(x1)}, ${Math.round(y0)}..${Math.round(y1)}`;
      expect(g.x > x0 && g.x < x1 && g.y > y0 && g.y < y1, at).toBe(true);
      expect(s.x > x0 && s.x < x1 && s.y > 0, at).toBe(true); // the sun stands in the sky straight above them
      expect(g.x, at).toBeLessThan(size.width * 0.35); // out of the middle
      expect(Math.hypot(g.x - him.x, g.y - him.y), at).toBeGreaterThan(size.width * 0.3);
    }
    // the phone looks straight at Cuso: the sun and its glint stay out of its narrow frame
    const phone = onScreen(arrive.phone, { width: 390, height: 844 }, PORTRAIT_FOV);
    expect(phone.far(sun).x).toBeLessThan(0);
    expect(phone.far(glint).x).toBeLessThan(0);
  });

  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  it("has a low warm sun in the morning and the evening (photo look, F13)", () => {
    for (const id of ["arrive", "learn", "newsletter", "join"] as const) {
      const L = lightingAt(chapters.find((c) => c.id === id)!.hour);
      expect(L.elevation, id).toBeGreaterThan(0);
      expect(L.elevation, id).toBeLessThan(20);
      const [r, , b] = rgb(L.sunColor);
      expect(r - b, id).toBeGreaterThan(60);
    }
  });

  it("casts deep shadows by day: little fill next to the sun", () => {
    for (const c of chapters.filter((c) => !c.dark)) {
      const L = lightingAt(c.hour);
      expect(L.ambient / L.sunIntensity, c.id).toBeLessThanOrEqual(0.14);
    }
  });
});
