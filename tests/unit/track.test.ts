// Measuring the signup funnel: GA events (only when GA is loaded), and the
// one A/B test: phones get the live 3D city or posters only.

import { afterEach, describe, expect, it, vi } from "vitest";
import { phoneVariant, setTrackContext, track } from "@/lib/track";

afterEach(() => {
  vi.unstubAllGlobals();
  setTrackContext({});
  localStorage.clear();
});

describe("track", () => {
  it("sends a GA event with its params and the visit's context", () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    setTrackContext({ phone_test: "posters" });
    track("cta_click", { source: "topbar" });
    expect(gtag).toHaveBeenCalledWith("event", "cta_click", { source: "topbar", phone_test: "posters" });
  });

  it("does nothing without GA (dev, tests, blocked)", () => {
    expect(() => track("sign_up", { method: "waitlist" })).not.toThrow();
  });
});

describe("the phone test", () => {
  it("can be forced with ?v=", () => {
    expect(phoneVariant("?v=posters", () => 0.9)).toBe("posters");
    expect(phoneVariant("?v=3d", () => 0.1)).toBe("3d");
  });

  it("splits visitors in half and keeps each one in their half", () => {
    expect(phoneVariant("", () => 0.2)).toBe("posters");
    expect(phoneVariant("", () => 0.9)).toBe("posters"); // remembered from the first visit
    localStorage.clear();
    expect(phoneVariant("", () => 0.7)).toBe("3d");
    expect(phoneVariant("", () => 0.1)).toBe("3d");
  });

  it("still works when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(phoneVariant("", () => 0.7)).toBe("3d");
    vi.restoreAllMocks();
  });
});
