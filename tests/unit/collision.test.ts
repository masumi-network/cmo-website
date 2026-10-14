// Cuso never goes through anything. His body (HULL in rig.ts: boxes measured
// from the mesh, turned to where he faces) is sampled along the whole day line
// in both directions, which is every route the site can take: scrolling,
// the rail and Ask Cuso all move him along it, and longer jumps blink him
// straight onto a spot. At each spot he also turns to the camera and may
// cheer (a hop), so those poses are checked too.

import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { heightAt, surfaceAt } from "@/lib/terrain";
import { CAR } from "@/scene/cable-car";
import { FERRY, FERRY_CAR } from "@/scene/ferry";
import { UNION } from "@/scene/union-square";
import { ACCEL, BRAKE, LINE, crossings, cusoMayGo, holdsAtUnion, startCar, stepCar, type CableCar } from "@/scene/cable-line";
import { FLAG, PYRAMID, SPIRE, WINGS, pyramidHalf } from "@/scene/pyramid";
import { ROOFTOP } from "@/scene/rooftop";
import { reliefDepth } from "@/scene/houses";
import { CITY } from "@/scene/layout";
import { DECK, RAIL } from "@/scene/pier";
import { MISSION } from "@/scene/mission";
import { HULL } from "@/scene/rig";
import { SHOP } from "@/scene/shop";
import { HYDRANT, LAMP, SIGN } from "@/scene/street";
import { DAY_LENGTH, FACE, arrival, dayDistance, sampleDay, walkOn } from "@/scene/routes";

/** An axis-aligned box. `slope`: each side moves in by this much per unit up (the pyramid). */
type Solid = { name: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; slope?: number };
type Rect = { x0: number; x1: number; z0: number; z1: number };

const solid = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, slope = 0): Solid => ({ name, x0, x1, y0, y1, z0, z1, slope });
const around = (name: string, x: number, z: number, hx: number, hz: number, y0: number, y1: number) => solid(name, x - hx, x + hx, y0, y1, z - hz, z + hz);

/** Four boxes along the edges of a rectangle: from `out` outside to `inn` inside. */
const ring = (name: string, r: Rect, y0: number, y1: number, out: number, inn: number, sides = [0, 1, 2, 3]) =>
  [
    solid(name, r.x0 - out, r.x1 + out, y0, y1, r.z0 - out, r.z0 + inn), // north
    solid(name, r.x0 - out, r.x1 + out, y0, y1, r.z1 - inn, r.z1 + out), // south
    solid(name, r.x0 - out, r.x0 + inn, y0, y1, r.z0 - out, r.z1 + out), // west
    solid(name, r.x1 - inn, r.x1 + out, y0, y1, r.z0 - out, r.z1 + out), // east
  ].filter((_, i) => sides.includes(i));

/** A cable car standing at x, z on the street at height y. */
function cableCar(name: string, x: number, y: number, z: number): Solid[] {
  const { body, roof, board } = CAR;
  const boards = [-1, 1].flatMap((e) =>
    [-1, 1].map((s) => {
      const xs = [x + e * board.x0, x + e * board.x1];
      const zs = [z + s * body.z, z + s * board.z];
      return solid(`${name} running board`, Math.min(...xs), Math.max(...xs), y + board.top - 0.03, y + board.top, Math.min(...zs), Math.max(...zs));
    }),
  );
  return [
    solid(`${name} body`, x - body.x, x + body.x, y + body.bottom, y + body.top, z - body.z, z + body.z),
    solid(`${name} roof`, x - roof.x, x + roof.x, y + body.top, y + CAR.height, z - roof.z, z + roof.z),
    ...boards,
  ];
}
/** Where a car's floor sits: like cable-car.tsx, the street under its two trucks. */
const y0 = (y: number, x: number, z: number) => y + (surfaceAt(x - 1.3, z) + surfaceAt(x + 1.3, z)) / 2;

function landmarkSolids(): Solid[] {
  const out: Solid[] = [];

  // 06:00 Russian Hill rooftop.
  {
    const g = heightAt(-14, -10.4);
    const r = ROOFTOP;
    const c = r.cornice;
    const b = r.bulkhead;
    out.push(solid("rooftop walls", r.x0, r.x1, g + r.base, g + r.roof, r.z0, r.z1));
    out.push(...ring("rooftop cornice", r, g + c.bottom, g + c.top, c.out, 0.02));
    out.push(...ring("rooftop parapet", r, g + r.roof, g + r.roof + r.parapet, 0.05, r.wall + 0.01));
    out.push(around("rooftop bulkhead", b.x, b.z, b.w / 2, b.d / 2, g + r.roof, g + b.top));
  }

  // 07:00 Hayes Valley shop: the building with its shopfront, the cornice over the sidewalk, sidewalk furniture, the corner lamp.
  {
    const s = SHOP;
    out.push(solid("shop", s.x0 - s.relief, s.x1 + s.relief, s.ground - 1, s.ground + s.storeTop, s.z0, s.z1 + s.relief));
    out.push(solid("shop cornice", s.x0 - s.overhang, s.x1 + s.overhang, s.ground + s.storeTop, s.ground + s.top, s.z0, s.z1 + s.overhang));
    for (const f of s.furniture) out.push(solid(`shop ${f.name}`, f.x0, f.x1, f.y0, f.y1, f.z0, f.z1));
    out.push(around("shop lamp", s.lamp.x, s.lamp.z, LAMP.reach, LAMP.reach, s.lamp.y, s.lamp.y + LAMP.height));
  }

  // 09:00 Mission building: walls, the front's bays, awning and cornice over its sidewalk, the lamps over the posts, the ladder and the paint pail.
  {
    const m = MISSION;
    const g = m.ground;
    out.push(solid("Mission building", m.x0, m.x1, g - 1, g + m.top, m.z0, m.z1));
    out.push(solid("Mission front", m.x0, m.x1, g + m.awning, g + m.top, m.z1, m.z1 + m.reach));
    const { z, y, out: reach } = m.lamps;
    out.push(solid("Mission lamps", m.x1, m.x1 + reach, g + y - 0.3, g + y + 0.1, Math.min(...z) - 0.15, Math.max(...z) + 0.15));
    const l = m.ladder;
    out.push(solid("Mission ladder", l.x - l.h * Math.sin(l.lean) - 0.05, l.x + 0.05, g, g + l.h, l.z - 0.4, l.z + 0.4));
    const b = m.bucket;
    out.push(around("Mission paint pail", b.x, b.z, b.r + 0.02, b.r + 0.02, g, g + b.h + 0.25));
  }

  // 12:00 Union Square: building (with its facade relief), cornices, parapet (not on the south edge),
  // stair bulkhead, billboard, the monument in the square. Its cable car runs: see the last tests.
  {
    const g = heightAt(7, 9);
    const u = UNION;
    const r = u.relief;
    out.push(solid("Union Square walls", u.x0 - r, u.x1 + r, g, g + u.cornice.bottom, u.z0 - r, u.z1 + r));
    out.push(solid("Union Square walls", u.x0, u.x1, g, g + u.roof, u.z0, u.z1));
    const b = u.bulkhead;
    out.push(around("Union Square bulkhead", b.x, b.z, b.w / 2, b.d / 2, g + u.roof, g + b.top));
    const m = u.monument;
    out.push(around("Dewey Monument", m.x, m.z, m.base / 2, m.base / 2, g, g + m.top));
    out.push(...ring("Union Square cornice", u, g + u.cornice.bottom, g + u.cornice.top, u.cornice.out, 0.01));
    out.push(...ring("Union Square belt course", u, g + u.belt.y - 0.06, g + u.belt.y + 0.06, u.belt.out, 0.01));
    out.push(...ring("Union Square parapet", u, g + u.roof, g + u.roof + u.parapet, 0.05, u.wall + 0.01, [0, 2, 3]));
    const bb = u.billboard;
    out.push(solid("Union Square billboard", bb.x0, bb.x1, g + u.roof, g + bb.top, bb.z0, bb.z1));
  }

  // 15:00 Transamerica Pyramid: tapered body, wings, spire and flag.
  {
    const [x, z] = [6.5, -11];
    const g = heightAt(x, z);
    const half = PYRAMID.base + 0.012; // the crown is 0.012 proud of the faces
    out.push(solid("pyramid", x - half, x + half, g, g + PYRAMID.height, z - half, z + half, (PYRAMID.base - PYRAMID.top) / PYRAMID.height));
    for (const [side, y0, y1, w] of WINGS) {
      const xs = [x + side * 0.4, x + side * pyramidHalf(y0)];
      out.push(solid("pyramid wing", Math.min(...xs), Math.max(...xs), g + y0, g + y1, z - w / 2, z + w / 2));
    }
    const sx = x + SPIRE.x;
    const sz = z + SPIRE.z;
    out.push(around("pyramid spire", sx, sz, SPIRE.half, SPIRE.half, g + SPIRE.base, g + SPIRE.top));
    const reach = FLAG.w * Math.sin(FLAG.swing);
    out.push(solid("pyramid flag", sx, sx + FLAG.w, g + FLAG.y - FLAG.h / 2, g + FLAG.y + FLAG.h / 2, sz - reach, sz + reach));
  }

  // 18:00 cable car in front of the Ferry Building, and the Ferry Building itself.
  {
    const [x, y, z] = FERRY_CAR.p;
    out.push(...cableCar("18:00 cable car", x, y0(y, x, z), z));
    const { plinth, hall, tower } = FERRY;
    out.push(around("Ferry Building plinth", FERRY.x, FERRY.z, plinth[0] / 2, plinth[2] / 2, -0.6, plinth[1]));
    out.push(around("Ferry Building", FERRY.x, FERRY.z, hall[0] / 2, hall[2] / 2, plinth[1], hall[1]));
    out.push(around("Ferry Building tower", FERRY.x, FERRY.z, tower[0] / 2, tower[0] / 2, hall[1], tower[1]));
  }

  // 22:00 pier: the deck (from below) and its railing.
  out.push(solid("pier deck", DECK.x0, DECK.x1, DECK.top - 0.2, DECK.top, DECK.z0, DECK.z1)); // planks and stringers
  out.push(solid("pier rail", RAIL.x0, RAIL.x + RAIL.half, DECK.top, DECK.top + RAIL.top, RAIL.z - RAIL.half, RAIL.z + RAIL.half));
  out.push(solid("pier rail", RAIL.x - RAIL.half, RAIL.x + RAIL.half, DECK.top, DECK.top + RAIL.top, RAIL.z, RAIL.z1));
  return out;
}

/** Row houses (with their facade relief and gable, houses.tsx), towers and street furniture, as built in city.tsx. */
const citySolids: Solid[] = [
  ...CITY.lamps.map((l) => around("street lamp", l.x, l.z, LAMP.reach, LAMP.reach, l.y, l.y + LAMP.height)),
  ...CITY.hydrants.map((h) => around("hydrant", h.x, h.z, HYDRANT.reach, HYDRANT.reach, h.y, h.y + HYDRANT.height)),
  ...CITY.signs.map((s) => around("street sign", s.x, s.z, SIGN.reach, SIGN.reach, s.y, s.y + SIGN.height)),
  ...CITY.houses.map((h) => around("house", h.x, h.z, h.w / 2 + 0.01, h.d / 2 + reliefDepth(h), h.y - 1, h.y + h.h + (h.roof === "gable" ? h.w * 0.42 : 0))),
  ...CITY.towers.map((t) => around("tower", t.x, t.z, t.w / 2, t.d / 2, t.y - 1, t.y + t.h)),
];
const SOLIDS = [...citySolids, ...landmarkSolids()];

const EPS = 1e-3; // touching (feet on a roof, back against a wall) is fine

/** The first solid (of `solids`) Cuso's body overlaps at `pos`, facing `heading`, or null. */
function hit(pos: readonly number[], heading: number, solids = SOLIDS): string | null {
  const [px, py, pz] = pos;
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  // his own x and z axes in the world
  const axes = [[1, 0], [0, 1], [c, -s], [s, c]];
  for (const sol of solids) {
    if (px < sol.x0 - 1 || px > sol.x1 + 1 || pz < sol.z0 - 1 || pz > sol.z1 + 1) continue;
    for (const [b0, b1, lx0, lx1, lz0, lz1] of HULL) {
      if (py + b1 <= sol.y0 + EPS || py + b0 >= sol.y1 - EPS) continue;
      const inset = (sol.slope ?? 0) * (Math.max(py + b0, sol.y0) - sol.y0);
      const box = [[sol.x0 + inset, sol.z0 + inset], [sol.x1 - inset, sol.z0 + inset], [sol.x0 + inset, sol.z1 - inset], [sol.x1 - inset, sol.z1 - inset]];
      const body = [[lx0, lz0], [lx1, lz0], [lx0, lz1], [lx1, lz1]].map(([lx, lz]) => [px + lx * c + lz * s, pz - lx * s + lz * c]);
      const apart = axes.some(([ax, az]) => {
        const p1 = body.map(([x, z]) => x * ax + z * az);
        const p2 = box.map(([x, z]) => x * ax + z * az);
        return Math.max(...p1) <= Math.min(...p2) + EPS || Math.max(...p2) <= Math.min(...p1) + EPS;
      });
      if (!apart) return sol.name;
    }
  }
  return null;
}

/** Where he faces while moving (as cuso.tsx does): the move's fixed heading, or a point 1.6 ahead on the line. */
function facing(d: number, dir: 1 | -1, prev: number) {
  const { pos: here, face } = sampleDay(d);
  if (face !== null) return face;
  const ahead = sampleDay(d + dir * 1.6).pos;
  const dx = ahead[0] - here[0];
  const dz = ahead[2] - here[2];
  return Math.hypot(dx, dz) > 0.05 ? Math.atan2(dx, dz) : prev;
}

const STEP = 0.05;
const at = (d: number) => sampleDay(d).pos.map((v) => v.toFixed(2)).join(", ");

describe("Cuso's body never goes through anything", () => {
  it("has the landmark solids next to the houses and towers", () => {
    expect(SOLIDS.length).toBeGreaterThan(citySolids.length + 30);
  });

  it.each([
    ["forward", 1],
    ["backward", -1],
  ] as const)("along the whole day, going %s", (_, dir) => {
    const misses = new Map<string, string>(); // first place for each problem
    let heading = dir > 0 ? 0 : Math.PI;
    for (let k = 0; k <= DAY_LENGTH / STEP; k++) {
      const d = dir > 0 ? k * STEP : DAY_LENGTH - k * STEP;
      heading = facing(d, dir, heading);
      const { pos, leg, mode } = sampleDay(d);
      const thing = hit(pos, heading) ?? (pos[1] < surfaceAt(pos[0], pos[2]) - 1e-6 ? "the ground" : null);
      const key = `leg ${leg} (${mode}): inside ${thing}`;
      if (thing && !misses.has(key)) misses.set(key, `${key}, first at ${at(d)}`);
    }
    expect([...misses.values()]).toEqual([]);
  });

  it("standing on each spot: turning to the camera and cheering", () => {
    const misses = new Set<string>();
    chapters.forEach((ch, i) => {
      const rest = FACE[ch.id] ?? Math.atan2(ch.camera.position[0] - ch.spot[0], ch.camera.position[2] - ch.spot[2]);
      // the way he faces when he gets there, from either side
      const d = dayDistance(i, 0);
      const arrivals = [i > 0 && facing(d - STEP, 1, rest), i < chapters.length - 1 && facing(d + STEP, -1, rest)].filter((h): h is number => h !== false);
      for (const from of arrivals.length ? arrivals : [rest]) {
        const turn = Math.atan2(Math.sin(rest - from), Math.cos(rest - from));
        for (let k = 0; k <= 12; k++) {
          for (const hop of [0, 0.55]) {
            const thing = hit([ch.spot[0], ch.spot[1] + hop, ch.spot[2]], from + (turn * k) / 12);
            if (thing) misses.add(`${ch.id}${hop ? " (cheering)" : ""}: inside ${thing}`);
          }
        }
      }
    });
    expect([...misses]).toEqual([]);
  });

  it("a rail jump pops him in clear of everything, facing his way in", () => {
    for (let i = 0; i < chapters.length; i++) {
      const { from, to } = arrival(i, crossings().windows);
      const dir = to >= from ? 1 : -1;
      expect(hit(sampleDay(from).pos, facing(from, dir, 0)), chapters[i].id).toBeNull();
    }
  });

  it("keeps the pyramid spire out from behind him in the 15:00 shot", () => {
    const seo = chapters.find((c) => c.id === "seo")!;
    const [sx, , sz] = seo.spot;
    const [cx, , cz] = seo.camera.position;
    const len = Math.hypot(sx - cx, sz - cz);
    const [dx, dz] = [(sx - cx) / len, (sz - cz) / len];
    const [rx, rz] = [6.5 + SPIRE.x - sx, -11 + SPIRE.z - sz];
    const sideways = Math.abs(rx * dz - rz * dx);
    const widest = Math.max(...HULL.map(([, , x0, x1]) => Math.max(-x0, x1)));
    expect(sideways - SPIRE.half).toBeGreaterThan(widest + 0.1);
  });
});

// The Union Square cable car runs its line along the z 14 street, which Cuso
// crosses. It yields to him, and he waits at the kerb while it is across his
// way, so the two never meet. These tests check that with his real body
// against the car's solids, wherever the car is when he gets there.
describe("the Union Square cable car never meets Cuso", () => {
  const [W, , E] = [LINE.stops[0], 0, LINE.stops[LINE.stops.length - 1]];
  const carAt = (s: number) => cableCar("Union Square cable car", s, y0(0, s, LINE.z), LINE.z);
  /** Day distances near the line: anywhere his body could reach the car. */
  const nearLine: number[] = [];
  for (let d = 0; d <= DAY_LENGTH; d += STEP) if (Math.abs(sampleDay(d).pos[2] - LINE.z) < 3.5 && sampleDay(d).pos[0] > W - 4 && sampleDay(d).pos[0] < E + 4) nearLine.push(d);
  const inWindow = (d: number) => crossings().windows.some((w) => d > w.a && d < w.b);
  /** He touches the car at day distance d, going either way along his route. */
  const touches = (d: number, s: number) => {
    const { pos } = sampleDay(d);
    if (Math.abs(pos[0] - s) > 4) return false;
    const solids = carAt(s);
    return [1, -1].some((dir) => hit(pos, facing(d, dir as 1 | -1, 0), solids) !== null);
  };

  it("meets him nowhere outside the crossing windows it knows, wherever on its run it is", { timeout: 60_000 }, () => {
    expect(nearLine.length).toBeGreaterThan(100);
    const misses: string[] = [];
    for (const d of nearLine) {
      if (inWindow(d)) continue;
      for (let s = W; s <= E + 1e-9; s += 0.1) if (touches(d, s)) misses.push(`${at(d)} with the car at ${s.toFixed(1)}`);
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  it("yields: for every point on his routes and every way the car can come at him there, it stops short", { timeout: 120_000 }, () => {
    const { spans, windows } = crossings();
    const misses = new Set<string>();
    // only near his crossings can the car touch him at all (the test above)
    const near = nearLine.filter((d, i) => i % 5 === 0 && windows.some((w) => d > w.a - 4 && d < w.b + 4));
    expect(near.length).toBeGreaterThan(50);
    for (const d of near) {
      const { pos } = sampleDay(d);
      const headings = [facing(d, 1, 0), facing(d, -1, 0)];
      const touchesHere = (s: number) => Math.abs(pos[0] - s) < 4 && headings.some((h) => hit(pos, h, carAt(s)) !== null);
      // the crossings he is at or near: the car cannot be inside one unless it got there first (then he waits)
      const close = [...new Set(windows.filter((w) => d > w.a - 4 && d < w.b + 4).map((w) => w.span))];
      for (let s = W; s <= E + 1e-9; s += 0.5) {
        if (touchesHere(s) || close.some((k) => s > spans[k].s0 && s < spans[k].s1)) continue;
        for (const dir of [1, -1] as const) {
          for (const v of [0, 0.8, 1.6]) {
            // coming at him, it has room to brake before his crossing (or it would have stopped already)
            const entry = close.map((k) => (dir > 0 ? spans[k].s0 - s : s - spans[k].s1)).filter((e) => e >= 0);
            if (entry.some((e) => e < (v * v) / (2 * BRAKE) + 0.05)) continue;
            let next = -1;
            LINE.stops.forEach((x, i) => {
              if ((x - s) * dir > 1e-6 && (next < 0 || (x - LINE.stops[next]) * dir < 0)) next = i;
            });
            if (next < 0) continue;
            const car: CableCar = { ...startCar(), s, v, dir, at: -1, next };
            for (let t = 0; t < 10; t += 1 / 20) {
              stepCar(car, 1 / 20, { d, target: d }, false);
              if (touchesHere(car.s)) {
                misses.add(`${at(d)}: car from ${s.toFixed(1)} going ${dir > 0 ? "east" : "west"} at ${v}`);
                break;
              }
            }
          }
        }
      }
    }
    expect([...misses].slice(0, 5)).toEqual([]);
  });

  it("over a whole scroll from any chapter to any other, wherever the car is on its run: he waits at the kerb at worst, never inside it", { timeout: 120_000 }, () => {
    const misses = new Set<string>();
    let waited = 0;
    let [speedUp, slowDown] = [0, 0]; // it yields smoothly too
    for (let from = 0; from < chapters.length; from++) {
      for (let to = 0; to < chapters.length; to++) {
        if (to === from) continue;
        const start = dayDistance(from, 0);
        const target = dayDistance(to, 0);
        // How long he takes with no cable car in the way.
        let free = 0;
        for (let d = start; Math.abs(target - d) > 1e-6 && free < 120; free += 1 / 20) d = walkOn(d, target, 1 / 20);
        for (let phase = 0; phase < 64; phase += 2) {
          const car = startCar();
          for (let t = 0; t < phase; t += 1 / 20) stepCar(car, 1 / 20, { d: start, target: start }, holdsAtUnion(from, "story"));
          let d = start;
          let t = 0;
          for (; t < free + 12 && Math.abs(target - d) > 1e-6; t += 1 / 20) {
            // Each reads where the other was last frame (whichever of them draws first).
            const before: CableCar = { ...car };
            stepCar(car, 1 / 20, { d, target }, holdsAtUnion(to, "story"));
            [speedUp, slowDown] = [Math.max(speedUp, (car.v - before.v) * 20), Math.max(slowDown, (before.v - car.v) * 20)];
            d = cusoMayGo(d, walkOn(d, target, 1 / 20), before);
            if (touches(d, car.s)) misses.add(`${chapters[from].id} to ${chapters[to].id}, car ${phase} s in: at ${at(d)} with the car at ${car.s.toFixed(2)}`);
          }
          expect(Math.abs(target - d), `${chapters[from].id} to ${chapters[to].id}, car ${phase} s in: he gets there`).toBeLessThan(1e-6);
          waited = Math.max(waited, t - free);
        }
      }
    }
    expect([...misses].slice(0, 5)).toEqual([]);
    expect(waited).toBeLessThan(8); // at worst a short wait at the kerb
    expect(speedUp).toBeLessThanOrEqual(ACCEL + 1e-6);
    expect(slowDown).toBeLessThanOrEqual(BRAKE * 1.25);
  });
});
