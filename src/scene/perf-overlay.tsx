"use client";

// Dev only (`?perf`): frame rate, draw calls, triangles and shader programs
// per frame, every pass counted (shadow, mirror, probe, post), in a corner.
// scene.tsx loads it only outside production builds.

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";

export default function PerfOverlay() {
  const gl = useThree((s) => s.gl);
  const el = useMemo(() => document.createElement("pre"), []);
  const stats = useMemo(() => ({ frames: 0, since: 0 }), []);

  useEffect(() => {
    Object.assign(el.style, {
      position: "fixed", right: "8px", bottom: "8px", zIndex: "100", margin: "0", padding: "6px 8px",
      font: "11px/1.4 ui-monospace, monospace", color: "#f7f6f2", background: "rgba(17,17,20,0.75)", borderRadius: "6px", pointerEvents: "none",
    });
    document.body.append(el);
    // Count every render call of a frame, not just the last one.
    gl.info.autoReset = false;
    return () => {
      el.remove();
      gl.info.autoReset = true;
    };
  }, [el, gl]);

  // Runs first in each frame: the counters hold the whole previous frame.
  useFrame(() => {
    const { render, programs } = gl.info;
    stats.frames++;
    const now = performance.now();
    if (now - stats.since > 500) {
      const fps = (stats.frames * 1000) / (now - stats.since);
      el.textContent = `${fps.toFixed(0)} fps  ${render.calls} calls\n${(render.triangles / 1000).toFixed(0)}k tris  ${programs?.length ?? 0} programs  dpr ${gl.getPixelRatio()}`;
      stats.frames = 0;
      stats.since = now;
    }
    gl.info.reset();
  }, -1);

  return null;
}
