// Parked cars along the kerbs (src/scene/parked.ts): on the asphalt by the
// kerb, the way the traffic goes, with gaps, and never where they would get in
// the way: moving lanes, the cable car, Cuso's walks, crossings and curb ramps,
// garages, hydrants, landmarks or a chapter's camera.

import { describe, expect, it } from "vitest";
import { chapters } from "@/content/day";
import { surfaceAt } from "@/lib/terrain";
import { CABLE_RAILS, CROSSWALKS, EDGE, KERB, SIDEWALK, STREET, WALK_X, WALK_Z, X_STREETS, Z_STREETS, groundAt, insideLand, streetDrop } from "@/scene/grid";
import { CITY, CLEAR, generateCity } from "@/scene/layout";
import { VARIANTS } from "@/scene/house-models";
import { variantOf } from "@/scene/houses";
import { PARKED_PAINTS, parkCars, type ParkedCar } from "@/scene/parked";
import { onRoad } from "@/scene/roads";
import { PATHS } from "@/scene/routes";
import { MODELS, type Pose, carPose, driveCars, makeTraffic } from "@/scene/traffic";

const cars = parkCars();
const lite = cars.filter((c) => c.lite);

/** A parked car's corners (body over the mirrors), a little `pad` out. */
function corners(c: ParkedCar, pad = 0) {
  const { length, width } = MODELS[c.type];
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const [lx, lz] = [fz, -fx];
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]): [number, number] => [
    c.x + fx * i * (length / 2 + pad) + lx * j * (width / 2 + pad),
    c.z + fz * i * (length / 2 + pad) + lz * j * (width / 2 + pad),
  ]);
}

/** Points on and inside the body's footprint (the mirrors may reach over the kerb), every ~0.2. */
function cover(c: ParkedCar) {
  const { length } = MODELS[c.type];
  const width = MODELS[c.type].width * 0.89;
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const out: [number, number][] = [];
  for (let a = -length / 2; a <= length / 2 + 1e-6; a += length / 16)
    for (let b = -width / 2; b <= width / 2 + 1e-6; b += width / 6) out.push([c.x + fx * a + fz * b, c.z + fz * a - fx * b]);
  return out;
}

/** How far a point is from a car's footprint (0 inside). */
function away(c: ParkedCar, x: number, z: number) {
  const { length, width } = MODELS[c.type];
  const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
  const along = (x - c.x) * fx + (z - c.z) * fz;
  const side = (x - c.x) * fz - (z - c.z) * fx;
  return Math.hypot(Math.max(0, Math.abs(along) - length / 2), Math.max(0, Math.abs(side) - width / 2));
}

/** Whether two footprints (x, z, yaw, length, width) overlap: no axis of either separates them. */
function overlap(a: [number, number][], b: [number, number][]) {
  const axes = [a, b].flatMap((P) => [0, 1].map((k) => [P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]]));
  return axes.every(([ax, az]) => {
    const proj = (P: [number, number][]) => P.map(([x, z]) => x * ax + z * az);
    return Math.max(...proj(a)) > Math.min(...proj(b)) && Math.max(...proj(b)) > Math.min(...proj(a));
  });
}

/** Which street a car is parked on: the centre line it runs along, and which side of it. */
function streetOf(c: ParkedCar) {
  const alongZ = Math.abs(Math.sin(c.yaw)) < 0.5; // pointing north or south: on a north-south (X) street
  const lines = alongZ ? X_STREETS : Z_STREETS;
  const v = alongZ ? c.x : c.z;
  const centre = lines.reduce((a, b) => (Math.abs(v - b) < Math.abs(v - a) ? b : a));
  return { alongZ, centre, side: Math.sign(v - centre), offset: Math.abs(v - centre) };
}

/** Cuso's whole day, every 0.25 in x and z (jumps included). */
const ROUTE: [number, number][] = PATHS.flatMap(({ points }) =>
  points.slice(1).flatMap((b, i) => {
    const a = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25));
    return Array.from({ length: n + 1 }, (_, k): [number, number] => [a[0] + ((b[0] - a[0]) * k) / n, a[2] + ((b[2] - a[2]) * k) / n]);
  }),
);

describe("parked cars", () => {
  it("are the same on every visit", () => {
    expect(parkCars()).toEqual(cars);
  });

  it("leave the city layout as it was (their own random numbers)", () => {
    expect(generateCity()).toEqual(CITY);
  });

  it("are a few dozen, and phones get about half of them", () => {
    expect(cars.length).toBeGreaterThanOrEqual(24);
    expect(cars.length).toBeLessThanOrEqual(60);
    expect(lite.length).toBeGreaterThanOrEqual(10);
    expect(lite.length).toBeLessThanOrEqual(cars.length * 0.6);
  });

  it("are mostly Model 3s and Ys in calm paints, the odd Cybertruck, no Roadster", () => {
    const count = (t: string) => cars.filter((c) => c.type === t).length;
    expect(count("model3") + count("modely")).toBeGreaterThanOrEqual(cars.length * 0.8);
    expect(count("roadster")).toBe(0);
    for (const c of cars) expect(PARKED_PAINTS).toContain(c.color);
    expect(new Set(cars.map((c) => c.color)).size).toBeGreaterThanOrEqual(4);
  });

  it("stand on the asphalt of an open street, off the bridge roads", () => {
    for (const c of cars) {
      for (const [x, z] of cover(c)) {
        expect(insideLand(x, z)).toBe(true);
        expect(groundAt(x, z)).toBe("street");
        expect(streetDrop(x, z)).toBe(KERB);
        expect(onRoad(x, z)).toBeUndefined();
      }
      expect(c.y).toBeCloseTo(surfaceAt(c.x, c.z), 1);
    }
  });

  it("sit close to the kerb, square to the street, facing the way the traffic goes on their side", () => {
    for (const c of cars) {
      const { alongZ, side, offset } = streetOf(c);
      const { width } = MODELS[c.type];
      // the body (about 0.89 of the width over the mirrors) ends a few centimetres from the kerb
      const kerbGap = STREET / 2 - offset - (width * 0.89) / 2;
      expect(kerbGap).toBeGreaterThan(0.02);
      expect(kerbGap).toBeLessThan(0.2);
      // right-hand traffic: the south and west kerbs face east and south, the north and east kerbs west and north
      const [fx, fz] = [Math.sin(c.yaw), Math.cos(c.yaw)];
      if (alongZ) expect(Math.sign(fz)).toBe(-side);
      else expect(Math.sign(fx)).toBe(side);
      expect(Math.abs(alongZ ? fx : fz)).toBeLessThan(0.05);
    }
  });

  it("are never on Cuso's walking streets or the cable car line", () => {
    for (const c of cars) {
      const { alongZ, centre } = streetOf(c);
      expect((alongZ ? WALK_X : WALK_Z).includes(centre)).toBe(false);
      for (const [x0, x1, z] of CABLE_RAILS) for (let x = x0; x <= x1; x += 0.5) expect(away(c, x, z)).toBeGreaterThan(1.5);
    }
  });

  it("keep well clear of Cuso's whole day and every chapter spot", () => {
    for (const c of cars) {
      for (const [x, z] of ROUTE) expect(away(c, x, z)).toBeGreaterThan(1);
      for (const ch of chapters) expect(Math.hypot(c.x - ch.spot[0], c.z - ch.spot[2])).toBeGreaterThan(6);
    }
  });

  it("keep out of every moving lane: no car on a route touches a parked one", () => {
    const traffic = makeTraffic();
    for (const path of new Set(traffic.map((t) => t.path))) {
      for (let i = 0; i < path.pts.length; i += 2) for (const c of cars) expect(away(c, path.pts[i], path.pts[i + 1])).toBeGreaterThan(1.2);
    }
    // and driving: three minutes of traffic, every footprint against every parked car
    const driven = Float32Array.from(traffic, (t) => t.offset);
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    const parked = cars.map((c) => corners(c, 0.1));
    for (let step = 0; step < 1800; step++) {
      driveCars(traffic, driven, 0.1, { x: 999, z: 999 });
      traffic.forEach((t, i) => {
        carPose(t, driven[i], pose);
        const moving = corners({ ...pose, type: t.type, color: "", lite: false });
        parked.forEach((p, k) => {
          if (Math.hypot(cars[k].x - pose.x, cars[k].z - pose.z) < 6) expect(overlap(moving, p)).toBe(false);
        });
      });
    }
  });

  it("keep off the crosswalks and curb ramps, a car length or so from each junction", () => {
    for (const c of cars) {
      for (const w of CROSSWALKS) expect(overlap(corners(c, 0.5), [[w.x0, w.z0], [w.x1, w.z0], [w.x1, w.z1], [w.x0, w.z1]])).toBe(false);
      const { alongZ, centre, side } = streetOf(c);
      // the sidewalk beside the car is level: no curb ramp
      for (const [x, z] of corners(c)) {
        const [sx, sz] = alongZ ? [centre + side * (STREET / 2 + SIDEWALK / 2), z] : [x, centre + side * (STREET / 2 + SIDEWALK / 2)];
        expect(streetDrop(sx, sz)).toBe(0);
      }
      // the body ends past the cross street's sidewalk
      const along = alongZ ? c.z : c.x;
      const cross = alongZ ? Z_STREETS : X_STREETS;
      const near = Math.min(...cross.map((s) => Math.abs(along - s)));
      expect(near - MODELS[c.type].length / 2).toBeGreaterThan(EDGE + 0.5);
    }
  });

  it("leave a gap between cars: never bumper to bumper", () => {
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++) expect(overlap(corners(cars[i], 0.25), corners(cars[j], 0.25))).toBe(false);
  });

  it("never stand in front of a garage or a hydrant", () => {
    const garages = CITY.houses.filter((h, i) => VARIANTS[variantOf(h, i)].garage);
    expect(garages.length).toBeGreaterThan(0);
    for (const c of cars) {
      for (const h of garages) {
        const kerb = h.z + h.facing * (h.d / 2 + SIDEWALK);
        const front = Array.from({ length: 11 }, (_, k): [number, number] => [h.x - h.w / 2 + (h.w * k) / 10, kerb + h.facing * 0.8]);
        for (const [x, z] of front) expect(away(c, x, z)).toBeGreaterThan(0.3);
      }
      for (const f of CITY.hydrants) expect(away(c, f.x, f.z)).toBeGreaterThan(1);
    }
  });

  it("keep clear of the landmarks", () => {
    for (const c of cars) for (const [x, z, r] of CLEAR) for (const [px, pz] of corners(c)) expect(Math.hypot(px - x, pz - z)).toBeGreaterThan(r);
  });

  it("never get between a chapter's camera and its subject, desktop or phone", () => {
    for (const c of cars) {
      const top = c.y + 1.1;
      const reach = MODELS[c.type].length / 2;
      for (const ch of chapters) {
        for (const { position: p, target: q } of [ch.camera, ch.phone]) {
          for (let s = 0; s <= 1.0001; s += 0.02) {
            const [px, py, pz] = [0, 1, 2].map((k) => p[k] + (q[k] - p[k]) * s);
            expect(Math.hypot(px - c.x, pz - c.z) < reach + 1.2 && py < top + 0.8, `${ch.id} at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBe(false);
          }
        }
      }
    }
  });
});
