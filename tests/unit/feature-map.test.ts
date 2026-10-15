// Keeps docs/features/README.md honest: every row points at real docs, code
// and tests, and every feature doc is on the map.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const DIR = join(ROOT, "docs/features");
const STATUS = ["done", "dummy", "v0", "planned", "removed"];
const LAUNCH = ["ok", "blocker"];

type Row = { id: string; feature: string; status: string; launch: string; doc: string; code: string[]; tests: string[] };

const paths = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

function readMap(): Row[] {
  return readFileSync(join(DIR, "README.md"), "utf8")
    .split("\n")
    .filter((line) => /^\|\s*F\d+/.test(line))
    .map((line) => {
      const [id, feature, status, launch, doc, code, tests] = line.split("|").slice(1, -1).map((c) => c.trim());
      return { id, feature, status, launch, doc: doc.match(/\(([^)]+)\)/)?.[1] ?? "", code: paths(code), tests: paths(tests) };
    });
}

const rows = readMap();

describe("feature map", () => {
  it("lists features with unique ids", () => {
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  it("lists every feature doc in docs/features", () => {
    const docs = readdirSync(DIR).filter((f) => f.endsWith(".md") && f !== "README.md");
    expect(rows.map((r) => r.doc).sort()).toEqual(docs.sort());
  });

  it.each(rows)("$id has a valid status and launch flag", (row) => {
    expect(STATUS).toContain(row.status);
    expect(LAUNCH).toContain(row.launch);
  });

  it.each(rows)("$id points at files that exist", (row) => {
    expect(existsSync(join(DIR, row.doc)), row.doc).toBe(true);
    for (const p of [...row.code, ...row.tests]) expect(existsSync(join(ROOT, p)), p).toBe(true);
  });

  it.each(rows.filter((r) => r.status !== "planned" && r.status !== "removed"))("$id is built, so it has code and tests", (row) => {
    expect(row.code.length).toBeGreaterThan(0);
    expect(row.tests.length).toBeGreaterThan(0);
  });

  it.each(rows)("$id doc says when it was last updated", (row) => {
    expect(readFileSync(join(DIR, row.doc), "utf8")).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/);
  });
});
