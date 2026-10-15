// Photo-real mode (F12) was removed on 2026-10-15 (docs/features/photoreal.md).
// This keeps it gone: no tracer packages, no plate or probe files, no switch.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("photo-real mode is removed", () => {
  it("drops the tracer packages", () => {
    const { dependencies = {}, devDependencies = {} } = JSON.parse(read("package.json"));
    for (const name of ["three-gpu-pathtracer", "three-mesh-bvh", "oidn-web", "xatlas-web"]) {
      expect(dependencies, name).not.toHaveProperty(name);
      expect(devDependencies, name).not.toHaveProperty(name);
    }
  });

  it.each([
    "src/lib/plates.ts",
    "src/lib/probes.ts",
    "src/lib/live-trace.ts",
    "src/scene/plates.tsx",
    "src/scene/probes.tsx",
    "src/scene/explore-trace.tsx",
    "src/scene/tracer.ts",
    "src/scene/traced.ts",
    "src/scene/trace-info.ts",
    "src/scene/raytrace-lab.tsx",
    "public/plates",
    "public/probes",
    "public/oidn",
  ])("%s is gone", (p) => {
    expect(existsSync(join(ROOT, p))).toBe(false);
  });

  it("has no photo-real switch or flag in the page", () => {
    for (const p of ["src/components/experience.tsx", "src/components/hud.tsx", "src/scene/scene.tsx"]) expect(read(p), p).not.toMatch(/photoreal|photo-real/i);
  });
});
