// 12:00 Union Square: a modelled early-1900s commercial block in the row
// houses' paints (house-models.ts), the rooftop billboard on its steel truss,
// and a hint of the square west of it.

import { describe, expect, it } from "vitest";
import { Color, SRGBColorSpace, Vector3, type BufferGeometry } from "three";
import { groundAt } from "@/scene/grid";
import { PALETTES, SLOT, SLOTS, type Frame } from "@/scene/house-models";
import { AD_PANEL, LAMPS, LOBBY, SHOP_BAYS, SHOWCASE, UNION, UNION_CAR, billboardGeometry, buildingGeometry, displayGeometry, glowGeometry } from "@/scene/union-square";

const U = UNION;
const EPS = 1e-6;
const g = buildingGeometry();
const pos = g.attributes.position;
const slot = g.attributes.aSlot;
const win = g.attributes.aWin;
const P = (geo: BufferGeometry, i: number) => new Vector3().fromBufferAttribute(geo.attributes.position, i);
const verts = Array.from({ length: pos.count }, (_, i) => i);
const all = verts.map((i) => P(g, i));
/** How far a point stands out of the building's walls (negative inside). */
const out = (p: Vector3) => Math.max(U.x0 - p.x, p.x - U.x1, U.z0 - p.z, p.z - U.z1);
/** The building alone (the square is west of it). */
const onBuilding = (p: Vector3) => p.x > U.x0 - U.cornice.out - EPS;

type Tri = { a: Vector3; b: Vector3; c: Vector3; n: Vector3; id: number; s: number };
function tris(geo: BufferGeometry): Tri[] {
  const idx = geo.index;
  const n = idx ? idx.count : geo.attributes.position.count;
  const at = (t: number) => (idx ? idx.getX(t) : t);
  const out: Tri[] = [];
  for (let t = 0; t < n; t += 3) {
    const [a, b, c] = [at(t), at(t + 1), at(t + 2)].map((k) => P(geo, k));
    const nrm = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize();
    out.push({ a, b, c, n: nrm, id: geo.attributes.aWin?.getX(at(t)) ?? 0, s: geo.attributes.aSlot?.getX(at(t)) ?? -1 });
  }
  return out;
}
const faces = tris(g);
const glass = faces.filter((f) => f.s === SLOT.glass);
const mid = (f: Tri) => new Vector3().add(f.a).add(f.b).add(f.c).divideScalar(3);
/** A world point's place in a wall frame: [a along it, c out of it]. */
const local = ({ o, u }: Frame, p: Vector3) => [(p.x - o[0]) * u[0] + (p.z - o[2]) * u[2], -(p.x - o[0]) * u[2] + (p.z - o[2]) * u[0]];
const world = ({ o, u }: Frame, a: number, c: number, y: number) => new Vector3(o[0] + u[0] * a - u[2] * c, y, o[2] + u[2] * a + u[0] * c);
const displayless = (geo: BufferGeometry) => Array.from({ length: geo.attributes.position.count }, (_, i) => P(geo, i));

describe("12:00 Union Square", () => {
  it("keeps the footprint, roof, billboard box, ad and car (Cuso's route and the collision test read them)", () => {
    expect(U).toMatchObject({
      x0: 3.5, x1: 10.5, z0: 6.4, z1: 11.6, roof: 5,
      wall: 0.16, parapet: 0.27,
      cornice: { out: 0.16, bottom: 4.73, top: 4.97 },
      board: { y: 8, z: 6.72 },
      billboard: { z0: 6.72 - 0.07, z1: 7.72, top: 8 + 1.7 },
    });
    expect(AD_PANEL).toEqual([5.58, 2.78]);
    expect(UNION_CAR.p).toEqual([2.1, 0, 14]);
  });

  it("is one finite model in the row houses' paints, cream, where only glass is lit by window id", () => {
    expect(PALETTES[U.palette].name).toBe("cream");
    const pal = g.attributes.aPalette;
    const nrm = g.attributes.normal;
    for (const i of verts) {
      for (const v of [pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
      expect(Number.isInteger(slot.getX(i)) && slot.getX(i) >= 0 && slot.getX(i) < SLOTS.length).toBe(true);
      if (win.getX(i) > 0) expect(slot.getX(i)).toBe(SLOT.glass);
      expect(pal.getX(i)).toBe(U.palette);
    }
    // terracotta (stucco) walls, a deeper cream base, white trim, bronze frames, a gravel roof; no siding or shingles
    const used = new Set(slot.array);
    for (const s of ["stucco", "panel", "trim", "sash", "glass", "gravel", "stone", "tar"] as const) expect(used.has(SLOT[s]), s).toBe(true);
    for (const s of ["body", "roof", "scales"] as const) expect(used.has(SLOT[s]), s).toBe(false);
  });

  it("stands out of its walls no further than its relief, the belt course and the cornice (the collision solids)", () => {
    for (const p of all.filter(onBuilding)) {
      expect(out(p)).toBeLessThanOrEqual(U.cornice.out + EPS);
      if (p.y < U.cornice.bottom - EPS) {
        const belt = Math.abs(p.y - U.belt.y) <= 0.06 + EPS;
        expect(out(p)).toBeLessThanOrEqual((belt ? U.belt.out : U.relief) + EPS);
      }
      // above the cornice only the parapet's coping overhangs (by 0.05, the collision ring)
      if (p.y > U.cornice.top + EPS) expect(out(p)).toBeLessThanOrEqual(0.05 + EPS);
    }
    // the crown reaches the cornice line, between the ring's bottom and top
    const crown = all.filter((p) => Math.abs(out(p) - U.cornice.out) < EPS && onBuilding(p));
    expect(crown.length).toBeGreaterThan(0);
    expect(Math.min(...crown.map((p) => p.y))).toBeGreaterThanOrEqual(U.cornice.bottom - EPS);
    expect(Math.max(...crown.map((p) => p.y))).toBeCloseTo(U.cornice.top, 6);
  });

  it("has a parapet on the north, east and west, and none on the south edge where Cuso jumps up", () => {
    const top = U.roof + U.parapet;
    expect(Math.max(...all.filter((p) => onBuilding(p) && p.z < U.z0 + U.wall).map((p) => p.y))).toBeCloseTo(top, 6);
    expect(Math.max(...all.filter((p) => onBuilding(p) && p.x < U.x0 + U.wall && p.z > U.z0 + 1).map((p) => p.y))).toBeCloseTo(top, 6);
    expect(Math.max(...all.filter((p) => p.x > U.x1 - U.wall && p.z > U.z0 + 1).map((p) => p.y))).toBeCloseTo(top, 6);
    // the south edge: nothing above the roof between the side parapets (but the bulkhead in its corner, off Cuso's way)
    const b = U.bulkhead;
    const inBulkhead = (p: Vector3) => Math.abs(p.x - b.x) <= b.w / 2 + EPS && Math.abs(p.z - b.z) <= b.d / 2 + EPS;
    const south = all.filter((p) => p.z > U.z1 - 0.6 && p.x > U.x0 + U.wall + 0.06 && p.x < U.x1 - U.wall - 0.06 && !inBulkhead(p));
    expect(south.length).toBeGreaterThan(0);
    expect(Math.max(...south.map((p) => p.y))).toBeLessThanOrEqual(U.roof + EPS);
  });

  it("has a tar-and-gravel roof, and a stair bulkhead clear of Cuso's way up and of the billboard", () => {
    const deck = faces.filter((f) => f.s === SLOT.gravel && f.n.y > 0.99);
    expect(deck.length).toBeGreaterThan(0);
    for (const f of deck) for (const p of [f.a, f.b, f.c]) expect(p.y).toBeCloseTo(U.roof, 6);
    const area = deck.reduce((s, f) => s + new Vector3().subVectors(f.b, f.a).cross(new Vector3().subVectors(f.c, f.a)).length() / 2, 0);
    expect(area).toBeGreaterThan((U.x1 - U.x0 - 0.5) * (U.z1 - U.z0 - 0.5) * 0.8);
    // above the parapet: only the bulkhead
    const b = U.bulkhead;
    for (const p of all.filter((q) => onBuilding(q) && q.y > U.roof + U.parapet + EPS)) {
      expect(Math.abs(p.x - b.x)).toBeLessThanOrEqual(b.w / 2 + EPS);
      expect(Math.abs(p.z - b.z)).toBeLessThanOrEqual(b.d / 2 + EPS);
      expect(p.y).toBeLessThanOrEqual(b.top + EPS);
    }
    // inside the parapets, clear of the billboard's box and of Cuso (he stands at x 5.6, z 10.4 to 12.2, 0.63 round)
    expect(b.x - b.w / 2).toBeGreaterThanOrEqual(U.x0 + U.wall);
    expect(b.z - b.d / 2).toBeGreaterThanOrEqual(U.z0 + U.wall);
    expect(b.x + b.w / 2 < U.billboard.x0 || b.z - b.d / 2 > U.billboard.z1).toBe(true);
    expect(b.z + b.d / 2 < 10.4 - 0.63 - 0.3 || b.x - b.w / 2 > 5.6 + 0.63 + 0.3).toBe(true);
    expect(b.z + b.d / 2).toBeLessThan(U.z1 - 0.2); // off the south coping
  });

  it("has a two-storey shop base: clear display windows on every side and glass doors on the south-west corner", () => {
    const panes = tris(displayGeometry().glass);
    expect(panes.length).toBe(2 * (SHOP_BAYS.length + 1));
    const sides = { "0,1": 4, "0,-1": 4, "1,0": 3, "-1,0": 3 };
    for (const [key, n] of Object.entries(sides)) {
      const [nx, nz] = key.split(",").map(Number);
      const facing = panes.filter((f) => Math.abs(f.n.x - nx) < 1e-3 && Math.abs(f.n.z - nz) < 1e-3);
      expect(facing.length, key).toBe(2 * n);
      // big: most of the ground storey, from the stallriser to the transom
      const ys = facing.flatMap((f) => [f.a.y, f.b.y, f.c.y]);
      expect(Math.max(...ys) - Math.min(...ys), key).toBeCloseTo(SHOWCASE.ceiling - SHOWCASE.floor, 6);
    }
    // the corner doors face the street corner, south-west
    const corner = panes.filter((f) => f.n.x < -0.6 && f.n.z > 0.6);
    expect(corner.length).toBe(2);
    for (const f of corner) expect(mid(f).x - U.x0 + (U.z1 - mid(f).z)).toBeLessThan(1.2);
    // the building's own (opaque) glass stays above the displays and the doors: mezzanine lights and transoms
    for (const f of glass.filter((q) => mid(q).y < U.belt.y)) expect(Math.min(f.a.y, f.b.y, f.c.y)).toBeGreaterThanOrEqual(1.14 - EPS);
  });

  it("has three office storeys of tripartite Chicago windows: one window (id) of three lights per bay", () => {
    const upper = glass.filter((f) => mid(f).y > U.belt.y && mid(f).y < U.cornice.bottom);
    const byId = new Map<number, Tri[]>();
    for (const f of upper) byId.set(f.id, [...(byId.get(f.id) ?? []), f]);
    expect(byId.has(0)).toBe(false);
    expect(byId.size).toBe(3 * (U.bays.x * 2 + U.bays.z * 2));
    for (const [id, panes] of byId) {
      expect(panes.length, `window ${id}`).toBe(6); // three lights, two triangles each
      const widths = [0, 2, 4].map((k) => {
        const ps = [...panes.slice(k, k + 2).flatMap((f) => [f.a, f.b, f.c])];
        return Math.max(Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x)), Math.max(...ps.map((p) => p.z)) - Math.min(...ps.map((p) => p.z)));
      });
      // a wide fixed light between two narrow sashes
      const sorted = [...widths].sort((a, b) => a - b);
      expect(sorted[2]).toBeGreaterThan(sorted[1] * 1.8);
    }
  });

  it("centres the billboard on the roof, its whole structure inside the parapets", () => {
    expect(Math.abs(U.board.x - (U.x0 + U.x1) / 2)).toBeLessThan(1e-6);
    expect(U.billboard.x0 + U.billboard.x1).toBeCloseTo(U.x0 + U.x1, 9);
    const s = billboardGeometry();
    const ps = Array.from({ length: s.attributes.position.count }, (_, i) => P(s, i));
    // the steel, the lamps and the box round them, all clear of the parapets' inner faces
    for (const p of [...ps, ...LAMPS.map((l) => new Vector3(...l.p)), new Vector3(U.billboard.x0, U.roof, U.billboard.z0), new Vector3(U.billboard.x1, U.roof, U.billboard.z1)]) {
      expect(p.x).toBeGreaterThanOrEqual(U.x0 + U.wall - EPS);
      expect(p.x).toBeLessThanOrEqual(U.x1 - U.wall + EPS);
      expect(p.z).toBeGreaterThanOrEqual(U.z0 + U.wall - EPS);
      expect(p.z).toBeLessThanOrEqual(U.z1 - EPS);
    }
    // symmetric about the roof's centre line
    const xs = ps.map((p) => p.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(U.x0 + U.x1, 6);
  });

  it("is a rooftop billboard: steel inside its box, diagonal bracing, a catwalk railing in front of the face", () => {
    const s = billboardGeometry();
    const bb = U.billboard;
    const ps = Array.from({ length: s.attributes.position.count }, (_, i) => P(s, i));
    for (const p of ps) {
      expect(p.x).toBeGreaterThanOrEqual(bb.x0 - EPS);
      expect(p.x).toBeLessThanOrEqual(bb.x1 + EPS);
      expect(p.z).toBeGreaterThanOrEqual(bb.z0 - EPS);
      expect(p.z).toBeLessThanOrEqual(bb.z1 + EPS);
      expect(p.y).toBeGreaterThanOrEqual(U.roof - EPS);
      expect(p.y).toBeLessThanOrEqual(bb.top + EPS);
    }
    // braces run on the slant
    expect(tris(s).some((f) => Math.abs(f.n.y) > 0.2 && Math.abs(f.n.y) < 0.95)).toBe(true);
    // the catwalk's railing: in front of the face, its top rail just under the face's trim
    const face = { z: 6.95, bottom: U.board.y - AD_PANEL[1] / 2 };
    const rail = ps.filter((p) => p.z > face.z + 0.4 && p.y > face.bottom - 0.5 && p.y < face.bottom);
    expect(rail.length).toBeGreaterThan(0);
    expect(Math.max(...rail.map((p) => p.x)) - Math.min(...rail.map((p) => p.x))).toBeGreaterThan(AD_PANEL[0]);
    // a trim frame round the face, and nothing in front of the ad above the railing
    expect(Math.min(...ps.map((p) => p.x))).toBeLessThan(U.board.x - AD_PANEL[0] / 2);
    for (const p of ps) {
      const overFace = Math.abs(p.x - U.board.x) < AD_PANEL[0] / 2 - 0.1 && p.y > face.bottom + 0.1 && p.y < U.board.y + AD_PANEL[1] / 2 - 0.1;
      if (overFace) expect(p.z).toBeLessThanOrEqual(face.z + EPS);
    }
  });

  it("lights the ad with gooseneck lamps over its top edge, aimed at the face", () => {
    expect(LAMPS.length).toBeGreaterThanOrEqual(3);
    for (const l of LAMPS) {
      expect(l.p[1]).toBeGreaterThan(U.board.y + AD_PANEL[1] / 2);
      expect(l.p[2]).toBeGreaterThan(6.95 + 0.3);
      expect(l.p[2]).toBeLessThan(U.billboard.z1);
      // pointing down and back at the face, hitting it inside its edges
      const t = (6.95 - l.p[2]) / l.aim[2];
      const y = l.p[1] + l.aim[1] * t;
      expect(t).toBeGreaterThan(0);
      expect(Math.abs(y - U.board.y)).toBeLessThan(AD_PANEL[1] / 2);
    }
  });

  it("glows only at the lamps (the shops light themselves)", () => {
    const glow = displayless(glowGeometry());
    for (const p of glow) expect(Math.min(...LAMPS.map((l) => p.distanceTo(new Vector3(...l.p))))).toBeLessThan(0.15);
  });

  it("fills every display with a closed showcase behind its glass, and the doors with a lobby: inside, finite, apart", () => {
    const { content } = displayGeometry();
    const col = content.attributes.color;
    const nrm = content.attributes.normal;
    const S = SHOWCASE;
    const boxes = [...SHOP_BAYS.map((b) => ({ f: b.f, a0: b.a0, a1: b.a1, c0: S.back, c1: S.glass, y0: S.floor, y1: S.ceiling })), { ...LOBBY, y0: 0, y1: LOBBY.top }];
    const inBox = (p: Vector3, b: (typeof boxes)[number], e = EPS) => {
      const [a, c] = local(b.f, p);
      return a >= b.a0 - e && a <= b.a1 + e && c >= b.c0 - e && c <= b.c1 + e && p.y >= b.y0 - e && p.y <= b.y1 + e;
    };
    const per = boxes.map(() => 0);
    for (let i = 0; i < content.attributes.position.count; i++) {
      const p = P(content, i);
      for (const v of [p.x, p.y, p.z, nrm.getX(i), nrm.getY(i), nrm.getZ(i), col.getX(i), col.getY(i), col.getZ(i)]) expect(Number.isFinite(v)).toBe(true);
      const k = boxes.findIndex((b) => inBox(p, b));
      expect(k, `${p.toArray()}`).toBeGreaterThanOrEqual(0);
      per[k]++;
    }
    // every showcase is dressed: back, floor, ceiling, sides and pieces on show
    for (const [k, n] of per.entries()) expect(n, `box ${k}`).toBeGreaterThan(150);
    // inside the building, and apart: no showcase reaches into another or into the lobby
    for (const b of boxes) {
      for (const [a, c] of [[b.a0, b.c0], [b.a1, b.c0], [b.a0, b.c1], [b.a1, b.c1]]) expect(out(world(b.f, a, c, 0.5))).toBeLessThan(EPS);
    }
    for (const [i, b] of boxes.entries()) {
      for (let s = 0; s <= 6; s++) {
        for (let t = 0; t <= 6; t++) {
          const p = world(b.f, b.a0 + ((b.a1 - b.a0) * s) / 6, b.c0 + ((b.c1 - b.c0) * t) / 6, 0.5);
          for (const [j, o] of boxes.entries()) if (j !== i) expect(inBox(p, o, -1e-3), `box ${i} in box ${j}`).toBe(false);
        }
      }
    }
  });

  it("dresses each display differently, in muted colours, lit by spots in its soffit (baked: brighter at the top)", () => {
    for (let i = 1; i < SHOP_BAYS.length; i++) {
      expect(SHOP_BAYS[i].theme, `bay ${i}`).not.toBe(SHOP_BAYS[i - 1].theme);
      expect(SHOP_BAYS[i].back, `bay ${i}`).not.toBe(SHOP_BAYS[i - 1].back);
    }
    expect(new Set(SHOP_BAYS.map((b) => b.theme)).size).toBeGreaterThanOrEqual(4);
    const { content } = displayGeometry();
    const col = content.attributes.color;
    const S = SHOWCASE;
    const hsl = { h: 0, s: 0, l: 0 };
    for (const [k, b] of SHOP_BAYS.entries()) {
      let spots = 0;
      const back: [number, number][] = [];
      for (let i = 0; i < content.attributes.position.count; i++) {
        const p = P(content, i);
        const [a, c] = local(b.f, p);
        if (a < b.a0 - EPS || a > b.a1 + EPS || c < S.back - EPS || c > S.glass + EPS || p.y > S.ceiling + EPS) continue;
        const rgb = [col.getX(i), col.getY(i), col.getZ(i)];
        if (Math.max(...rgb) > 1.6) {
          if (p.y > S.ceiling - 0.06) spots++;
          continue;
        }
        // muted: never a loud colour
        new Color(...rgb.map((v) => Math.min(1, v)) as [number, number, number]).getHSL(hsl, SRGBColorSpace);
        expect(hsl.s, `bay ${k} ${rgb}`).toBeLessThan(0.5);
        if (Math.abs(c - S.back) < EPS) back.push([p.y, rgb[0] + rgb[1] + rgb[2]]);
      }
      expect(spots, `bay ${k}`).toBeGreaterThan(0);
      const mean = (ys: [number, number][]) => ys.reduce((s, [, v]) => s + v, 0) / ys.length;
      const midY = (S.floor + S.ceiling) / 2;
      expect(mean(back.filter(([y]) => y > midY + 0.15)), `bay ${k}`).toBeGreaterThan(mean(back.filter(([y]) => y < midY - 0.15)));
    }
  });

  it("shows a lobby through the corner doors: a two-tone marble floor, brass elevator doors and a pendant", () => {
    const { content } = displayGeometry();
    const col = content.attributes.color;
    const L = LOBBY;
    const tones: number[] = [];
    let brass = 0;
    let pendant = 0;
    const hsl = { h: 0, s: 0, l: 0 };
    for (let i = 0; i < content.attributes.position.count; i++) {
      const p = P(content, i);
      const [a, c] = local(L.f, p);
      if (a < L.a0 - EPS || a > L.a1 + EPS || c < L.c0 - EPS || c > L.c1 + EPS) continue;
      const rgb = [col.getX(i), col.getY(i), col.getZ(i)];
      if (p.y < EPS) tones.push(rgb[0] + rgb[1] + rgb[2]);
      new Color(...rgb.map((v) => Math.min(1, v)) as [number, number, number]).getHSL(hsl, SRGBColorSpace);
      if (Math.abs(c - L.c0) < 0.03 && hsl.h > 0.07 && hsl.h < 0.14 && hsl.s > 0.25) brass++;
      if (p.y > 0.75 && p.y < L.top - 0.04 && c > L.c0 + 0.05 && c < L.c1 - 0.05) pendant++;
    }
    // light and dark marble: far apart
    expect(Math.max(...tones)).toBeGreaterThan(3 * Math.min(...tones));
    expect(brass).toBeGreaterThan(0);
    expect(pendant).toBeGreaterThan(0);
  });

  it("puts the Dewey Monument in the square: inside the block, off the streets and sidewalks", () => {
    const m = U.monument;
    expect(groundAt(m.x, m.z)).toBe("block");
    const square = all.filter((p) => !onBuilding(p));
    expect(square.length).toBeGreaterThan(0);
    for (const p of square) expect(groundAt(p.x, p.z), `${p.x}, ${p.z}`).toBe("block");
    expect(Math.max(...square.map((p) => p.y))).toBeCloseTo(m.top, 6);
    expect(m.top).toBeLessThan(U.roof + 1);
  });

  it("stays a handful of triangles", () => {
    const n = (geo: BufferGeometry) => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    expect(n(g) + n(billboardGeometry()) + n(glowGeometry())).toBeLessThan(10000);
    // the displays and the lobby: about 8k more
    const d = displayGeometry();
    expect(n(d.content) + n(d.glass)).toBeLessThan(8500);
  });
});
