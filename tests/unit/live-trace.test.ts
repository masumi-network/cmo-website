import { describe, expect, it } from "vitest";
import { STILL_FOR, newLive, stepLive, type Pose } from "@/lib/live-trace";

const at = (x: number, yaw = 0): Pose => ({ position: { x, y: 40, z: 0 }, quaternion: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } });
const frame = 1 / 60;

/** Runs frames at one pose until something other than "wait" happens, or `seconds` pass. */
function hold(s: ReturnType<typeof newLive>, pose: Pose, seconds: number, extra: Partial<Parameters<typeof stepLive>[1]> = {}) {
  const actions: string[] = [];
  for (let t = 0; t < seconds; t += frame) {
    const a = stepLive(s, { pose, dt: frame, explore: true, done: false, ...extra });
    if (a !== "wait") actions.push(a);
  }
  return actions;
}

describe("the live trace in Explore", () => {
  it("starts once the map has been still a moment, not before", () => {
    const s = newLive();
    expect(hold(s, at(0), STILL_FOR - 0.05)).toEqual([]);
    expect(hold(s, at(0), 0.1)).toEqual(["start"]);
    expect(s.tracing).toEqual(at(0));
  });

  it("shows the image when the trace is done and the camera has not moved", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    expect(stepLive(s, { pose: at(0), dt: frame, explore: true, done: true })).toBe("show");
    expect(s.shown).toEqual(at(0));
    expect(s.tracing).toBeNull();
    // shown: no new trace while it stays still
    expect(hold(s, at(0), 2)).toEqual([]);
  });

  it("drops it the moment the map moves (a drag or a zoom), and traces again once still", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    stepLive(s, { pose: at(0), dt: frame, explore: true, done: true });
    expect(stepLive(s, { pose: at(0.3), dt: frame, explore: true, done: false })).toBe("drop");
    expect(s.shown).toBeNull();
    expect(hold(s, at(0.3), 0.5)).toEqual(["start"]);
  });

  it("stops a trace still running when the map moves, and never shows it", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    expect(stepLive(s, { pose: at(0, 0.2), dt: frame, explore: true, done: false })).toBe("drop");
    expect(stepLive(s, { pose: at(0, 0.2), dt: frame, explore: true, done: true })).toBe("wait");
    expect(s.shown).toBeNull();
  });

  it("waits for the camera's easing to settle (a trace takes seconds: a creep would carry it off its plate)", () => {
    const run = (perFrame: number) => {
      const s = newLive();
      let x = 0;
      const actions: string[] = [];
      for (let t = 0; t < 0.6; t += frame) {
        x += perFrame;
        const a = stepLive(s, { pose: at(x), dt: frame, explore: true, done: false });
        if (a !== "wait") actions.push(a);
      }
      return actions;
    };
    expect(run(0.0004)).toEqual([]); // 2.4 cm a second: still easing
    expect(run(0.00005)).toEqual(["start"]); // 3 mm a second: settled
  });

  it("keeps the image when the rig snaps the camera back onto its pose (a centimetre in one frame), not when a drag goes further", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    // the camera eased 2 cm while the trace ran (seconds, so slowly), then the trace is done
    expect(stepLive(s, { pose: at(0.02), dt: 5, explore: true, done: true })).toBe("show");
    expect(stepLive(s, { pose: at(0), dt: frame, explore: true, done: false })).toBe("wait");
    expect(stepLive(s, { pose: at(0.2), dt: frame, explore: true, done: false })).toBe("drop");
  });

  it("starts over when the camera drifts off a trace's pose while it runs (a long frame lets the easing jump)", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    expect(stepLive(s, { pose: at(0.08), dt: 2.5, explore: true, done: false })).toBe("drop");
  });

  it("drops everything when leaving Explore", () => {
    const s = newLive();
    hold(s, at(0), 0.5);
    stepLive(s, { pose: at(0), dt: frame, explore: true, done: true });
    expect(stepLive(s, { pose: at(0), dt: frame, explore: false, done: false })).toBe("drop");
    expect(hold(s, at(0), 1, { explore: false })).toEqual([]);
  });
});
