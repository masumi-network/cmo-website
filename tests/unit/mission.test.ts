// The 09:00 Mission building (mission.tsx): a three-storey corner building
// with a taqueria under two floors of flats, the visitor's posts pasted on
// its flat side wall. The posts keep their grid; everything stays in its
// footprint or on its own sidewalk, off the street and off Cuso's routes.

import { BufferGeometry, PlaneGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { SLOT, SLOTS } from "@/scene/house-models";
import { CITY } from "@/scene/layout";
import { groundAt, streetDrop } from "@/scene/grid";
import { MENU, MISSION, POSTS, TAQUERIA_MAT, missionParts, postUv } from "@/scene/mission";
import { PATHS } from "@/scene/routes";

const parts = missionParts();
const EPS = 1e-6;
const M = MISSION;

/** Every vertex of a part in world coordinates (parts are built in world x, z; y from the ground). */
function points(g: BufferGeometry) {
  const pos = g.attributes.position;
  return Array.from({ length: pos.count }, (_, i) => new Vector3(pos.getX(i), M.ground + pos.getY(i), pos.getZ(i)));
}
const inFootprint = (p: Vector3) => p.x >= M.x0 - EPS && p.x <= M.x1 + EPS && p.z >= M.z0 - EPS && p.z <= M.z1 + EPS;
const tris = (g: BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Cuso's whole day, every 0.25 in x and z. */
const ROUTE: [number, number][] = PATHS.flatMap(({ points: pts }) =>
  pts.slice(1).flatMap((b, i) => {
    const a = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);

describe("the Mission posts", () => {
  it("keeps the 4 x 3 grid of posts where it was, one of them new", () => {
    expect(POSTS).toHaveLength(12);
    POSTS.forEach((p, i) => {
      expect(p.row).toBe(Math.floor(i / 4));
      expect(p.col).toBe(i % 4);
      expect(p.y).toBeCloseTo(1.2 + p.row * 1.35, 9);
      expect(p.z).toBeCloseTo(27.1 + p.col * 1.25, 9);
    });
    expect(POSTS.filter((p) => p.fresh).map((p) => [p.row, p.col])).toEqual([[1, 2]]);
  });

  it("shows each post's own square of the photo grid", () => {
    for (const { row, col } of POSTS) {
      const uv = postUv(new PlaneGeometry(1.1, 1.1), row, col).attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThan(col / 4);
        expect(uv.getX(i)).toBeLessThan((col + 1) / 4);
        expect(uv.getY(i)).toBeGreaterThan(row / 3);
        expect(uv.getY(i)).toBeLessThan((row + 1) / 3);
      }
    }
  });

  it("pastes them on the building's side wall, facing the street Cuso stands on", () => {
    expect(M.x1).toBe(-5.4);
    for (const p of POSTS) {
      expect(p.z - 0.59).toBeGreaterThan(M.z0);
      expect(p.z + 0.59).toBeLessThan(M.z1);
      expect(p.y + 0.59).toBeLessThan(M.top);
    }
  });
});

describe("the Mission building", () => {
  it("is a few parts with finite vertices and a modest triangle count", () => {
    for (const [name, g] of Object.entries(parts)) {
      const pos = g.attributes.position;
      expect(pos.count, name).toBeGreaterThan(0);
      for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]), name).toBe(true);
    }
    expect(Object.keys(parts).length).toBeLessThanOrEqual(5);
    const outside = tris(parts.shell) + tris(parts.props) + tris(parts.bulbs);
    expect(outside).toBeLessThan(12_000);
    // the taqueria inside, with its glass
    expect(tris(parts.interior) + tris(parts.glass)).toBeLessThan(10_000);
  });

  it("paints the building with the row houses' material: known paints, every pane a window", () => {
    const { shell } = parts;
    const slot = shell.attributes.aSlot;
    const win = shell.attributes.aWin;
    expect(slot.count).toBe(shell.attributes.position.count);
    for (let i = 0; i < slot.count; i++) {
      expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
      expect(win.getX(i) > 0).toBe(slot.getX(i) === SLOT.glass);
    }
    // bay windows on the front, windows on the back street
    expect(new Set(Array.from(win.array).filter((w) => w > 0)).size).toBeGreaterThanOrEqual(10);
    // the shop has clear glass of its own (parts.glass), not the houses' dark panes
    const pos = shell.attributes.position;
    for (let i = 0; i < slot.count; i++) {
      if (slot.getX(i) !== SLOT.glass) continue;
      const shopfront = pos.getZ(i) > M.z1 - 0.4 && pos.getY(i) < 2.5 && pos.getX(i) > M.room.x0;
      expect(shopfront, `${pos.getX(i)}, ${pos.getY(i)}, ${pos.getZ(i)}`).toBe(false);
    }
    // stucco walls, not lap siding
    expect(Array.from(slot.array).includes(SLOT.body)).toBe(false);
  });

  it("keeps the side wall flat behind the posts: only the ladder and the lamps stand off it", () => {
    for (const p of points(parts.shell)) {
      expect(p.x, `${p.x}, ${p.y}, ${p.z}`).toBeLessThan(M.x1 + 0.006);
    }
  });

  it("keeps the building in its footprint; only the front's bays, awning and cornice reach over its sidewalk, sills over the back one", () => {
    for (const p of points(parts.shell)) {
      if (inFootprint(p)) continue;
      const across = p.x >= M.x0 - EPS && p.x <= M.x1 + 0.006;
      const front = p.z > M.z1 && p.z <= M.z1 + M.reach + EPS;
      const back = p.z < M.z0 && p.z >= M.z0 - 0.06; // sills and a door hood on the back street
      expect(across && (front || back) || (p.x > M.x1 && p.x < M.x1 + 0.006), `${p.x}, ${p.y}, ${p.z}`).toBe(true);
    }
    // the reach stays on the sidewalk (the street's kerb is at z 32.5)
    expect(groundAt(-8, M.z1 + M.reach)).toBe("sidewalk");
    // low parts over the sidewalk leave headroom: nothing out there below the awning's edge
    for (const p of points(parts.shell)) if (p.z > M.z1 + 0.25) expect(p.y - M.ground).toBeGreaterThan(M.awning - EPS);
  });

  it("fits the taqueria inside the building, behind the shopfront, under its ceiling", () => {
    const r = M.room;
    expect(r.x0).toBeGreaterThan(M.x0);
    expect(r.x1).toBeLessThan(M.x1);
    expect(r.z0).toBeGreaterThan(M.z0);
    expect(r.z1).toBeLessThan(M.z1);
    // the floor clears the ground under it, and the ceiling stays under the shopfront's cornice
    for (let x = r.x0; x <= r.x1; x += 0.25) for (let z = r.z0; z <= r.z1; z += 0.25) expect(M.ground + r.floor).toBeGreaterThan(heightAt(x, z));
    expect(r.floor + r.h).toBeLessThan(2.9);
    for (const p of points(parts.interior)) {
      const ok = p.x >= r.x0 - EPS && p.x <= r.x1 + EPS && p.z >= r.z0 - EPS && p.z <= r.z1 + EPS && p.y - M.ground >= r.floor - EPS && p.y - M.ground <= r.floor + r.h + EPS;
      expect(ok, `${p.x}, ${p.y}, ${p.z}`).toBe(true);
    }
    // the glass: the shopfront's panes and the coolers inside, all in the footprint
    for (const p of points(parts.glass)) expect(inFootprint(p), `${p.x}, ${p.z}`).toBe(true);
    expect(Math.max(...points(parts.glass).map((p) => p.z))).toBeGreaterThan(M.z1 - 0.1);
  });

  it("dresses the taqueria: saltillo floor, tiled wainscot, plaster, wood, metal, glazed things, a lit menu", () => {
    const g = parts.interior;
    for (const a of ["color", "aGlow", "aMat", "uv"]) expect(g.attributes[a].count, a).toBe(g.attributes.position.count);
    const used = new Set(Array.from(g.attributes.aMat.array));
    for (const m of ["floor", "tile", "plaster", "wood", "metal", "glaze", "menu"] as const) expect(used.has(TAQUERIA_MAT[m]), m).toBe(true);
    // everything inside glows a little (the room's own light); the menu and the coolers more
    const glow = Array.from(g.attributes.aGlow.array);
    expect(Math.min(...glow)).toBeGreaterThan(0);
    expect(Math.max(...glow)).toBeGreaterThan(1.5);
  });

  it("writes the menu in plain words with prices", () => {
    expect(MENU.length).toBeGreaterThanOrEqual(6);
    for (const [name, price] of MENU) {
      expect(name).toMatch(/^[A-Za-z ]+$/);
      expect(price).toMatch(/^\d+(\.\d\d)?$/);
    }
  });

  it("stays clear of the row houses next door", () => {
    for (const h of CITY.houses) {
      const apart = h.x + h.w / 2 < M.x0 - 0.1 || h.x - h.w / 2 > M.x1 || h.z + h.d / 2 < M.z0 || h.z - h.d / 2 > M.z1;
      expect(apart, `${h.x}, ${h.z}`).toBe(true);
    }
  });

  it("stands the ladder and the paint bucket on the sidewalk in front of the wall", () => {
    for (const p of points(parts.props)) {
      if (inFootprint(p)) continue;
      expect(groundAt(p.x, p.z), `${p.x}, ${p.z}`).not.toBe("street");
      expect(streetDrop(p.x, p.z)).toBe(0);
      expect(p.y).toBeGreaterThan(heightAt(p.x, p.z) - 0.02);
    }
    const { bucket, ladder } = M;
    expect(groundAt(bucket.x, bucket.z)).toBe("sidewalk");
    expect(bucket.x - bucket.r).toBeGreaterThan(M.x1);
    // the ladder leans on the wall without going into the posts
    const props = points(parts.props).filter((p) => p.z > ladder.z - 0.5 && p.z < ladder.z + 0.5 && p.y > 2.5);
    expect(Math.min(...props.map((p) => p.x))).toBeGreaterThan(M.x1 + 0.025);
    expect(Math.min(...props.map((p) => p.x))).toBeLessThan(M.x1 + 0.08);
  });

  it("hangs the lamps over the posts, inside the box the collision check uses", () => {
    const { z, y, out } = M.lamps;
    const high = [...points(parts.props), ...points(parts.bulbs)].filter((p) => p.y - M.ground > 4);
    expect(high.length).toBeGreaterThan(0);
    for (const p of high) {
      expect(p.x).toBeGreaterThan(M.x1 - EPS);
      expect(p.x).toBeLessThan(M.x1 + out);
      expect(p.y - M.ground).toBeGreaterThan(Math.max(...POSTS.map((q) => q.y)) + 0.6);
      expect(p.y - M.ground).toBeLessThan(y + 0.1);
      expect(z.some((c) => Math.abs(p.z - c) < 0.15)).toBe(true);
    }
  });

  it("keeps everything at least 1.2 off Cuso's routes", () => {
    const all = [...points(parts.shell), ...points(parts.props), ...points(parts.bulbs)];
    const xs = all.map((p) => p.x);
    const zs = all.map((p) => p.z);
    const box = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
    for (const [x, z] of ROUTE) {
      const dx = Math.max(box.x0 - x, 0, x - box.x1);
      const dz = Math.max(box.z0 - z, 0, z - box.z1);
      expect(Math.hypot(dx, dz), `${x}, ${z}`).toBeGreaterThan(1.2);
    }
  });
});
