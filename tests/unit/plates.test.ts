import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { PLATE_RANGE, cropScale, decodePlate, encodePlate, newSettle, parseManifest, photorealOn, plateFor, poseNear, settle, type PlateEntry } from "@/lib/plates";

const entry = (o: Partial<PlateEntry> = {}): PlateEntry => ({
  chapter: 0,
  hour: 6,
  file: "ch0.webp",
  width: 3456,
  height: 1728,
  fov: 35,
  position: [1, 2, 3],
  quaternion: [0, 0, 0, 1],
  ...o,
});

describe("photo-real flag", () => {
  it("is off by default", () => {
    expect(photorealOn({ lite: false, search: "" })).toBe(false);
  });

  it("turns on with ?photoreal or the env switch, on desktops only", () => {
    expect(photorealOn({ lite: false, search: "?photoreal" })).toBe(true);
    expect(photorealOn({ lite: false, search: "", env: "1" })).toBe(true);
    expect(photorealOn({ lite: true, search: "?photoreal", env: "1" })).toBe(false);
  });
});

describe("plate manifest", () => {
  it("reads a valid manifest and finds a chapter's plate", () => {
    const m = parseManifest({ range: 2, plates: [entry(), entry({ chapter: 3, file: "ch3.webp" })] });
    expect(m).not.toBeNull();
    expect(plateFor(m!, 3)?.file).toBe("ch3.webp");
    expect(plateFor(m!, 5)).toBeNull();
  });

  it("rejects anything else rather than half-reading it", () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({ range: 2, plates: [{ chapter: 0 }] })).toBeNull();
    expect(parseManifest({ range: -1, plates: [] })).toBeNull();
  });
});

describe("plate colour", () => {
  it("round-trips linear colour within the range to 8-bit and back, closely", () => {
    const linear = new Float32Array([0, 0.002, 0.18, 1, 0.5, 1.2, 1.9, 1]);
    const back = decodePlate(encodePlate(linear, PLATE_RANGE), PLATE_RANGE);
    for (const [i, v] of linear.entries()) {
      if (i % 4 === 3) continue; // alpha
      expect(Math.abs(back[i] - v)).toBeLessThan(Math.max(0.002, v * 0.02));
    }
  });

  it("clips above the range and below zero, and keeps alpha opaque", () => {
    const out = encodePlate(new Float32Array([5, -1, 1, 0.3]), PLATE_RANGE);
    expect([...out]).toEqual([255, 0, 188, 255]);
  });
});

describe("plate crop", () => {
  it("shows the middle of a wide plate on a narrower screen", () => {
    expect(cropScale(2, 1.6)).toBeCloseTo(0.8);
    expect(cropScale(2, 2)).toBe(1);
  });

  it("has no plate for a screen wider than it", () => {
    expect(cropScale(2, 2.4)).toBeNull();
  });
});

describe("rest pose", () => {
  const plate = entry({ position: [1, 2, 3], quaternion: [0, 0, 0, 1] });

  it("is near when the camera has eased to within a couple of centimetres and a fraction of a degree", () => {
    expect(poseNear(new Vector3(1.01, 2, 3), new Quaternion(), plate)).toBe(true);
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.002);
    expect(poseNear(new Vector3(1, 2, 3), turned, plate)).toBe(true);
  });

  it("is not near while the camera still moves or looks elsewhere", () => {
    expect(poseNear(new Vector3(1.25, 2, 3), new Quaternion(), plate)).toBe(false);
    const turned = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.05);
    expect(poseNear(new Vector3(1, 2, 3), turned, plate)).toBe(false);
  });
});

describe("settling onto a plate", () => {
  const plate = entry({ position: [0, 2, 10], quaternion: [0, 0, 0, 1] });
  const q = new Quaternion();
  const DT = 1 / 60;
  /** Runs frames with the rig's eased camera at `at(i)`; returns the settle state. */
  const run = (frames: number, at: (i: number) => Vector3, s = newSettle()) => {
    for (let i = 0; i < frames; i++) settle(s, at(i), q, [plate], DT);
    return s;
  };

  it("glides a camera that came to rest near a plate onto it, and then rests", () => {
    const s = run(120, () => new Vector3(0.15, 2.05, 10.1)); // 18 cm off, like chapter 1
    expect(s.plate).toBe(plate);
    expect(s.pull).toBe(1);
  });

  it("does not pull a camera that is still moving", () => {
    const s = run(120, (i) => new Vector3(0.3 - i * 0.003, 2, 10));
    expect(s.pull).toBe(0);
  });

  it("lets go once the camera moves on, back to the rig's own path", () => {
    const s = run(120, () => new Vector3(0.15, 2, 10));
    run(60, (i) => new Vector3(0.15 + i * 0.01, 2, 10), s);
    expect(s.pull).toBe(0);
  });

  it("ignores plates out of reach", () => {
    const s = run(120, () => new Vector3(1.5, 2, 10));
    expect(s.plate).toBeNull();
    expect(s.pull).toBe(0);
  });
});
