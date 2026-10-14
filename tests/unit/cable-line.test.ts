// The Union Square cable car's line along the z 14 street: where it runs,
// how it moves, and that it comes to rest under the billboard for 12:00.
// Whether it ever meets Cuso is in collision.test.ts.

import { describe, expect, it } from "vitest";
import { surfaceAt } from "@/lib/terrain";
import { CAR, GAUGE } from "@/scene/cable-car";
import { ACCEL, BRAKE, CRUISE, LINE, WHEELS, carGround, crossings, holdsAtUnion, startCar, stepCar, type CableCar } from "@/scene/cable-line";
import { CABLE_RAILS, CROSSWALKS, EDGE, LANE_MARKS, STREET, crosswalkBars, groundAt, inPark, insideLand } from "@/scene/grid";
import { ROADS, piers } from "@/scene/roads";
import { MODELS, carPose, makeTraffic, type Pose } from "@/scene/traffic";
import { UNION_CAR } from "@/scene/union-square";

const [X0, X1] = LINE.rails;
const STOPS = LINE.stops;
const HALF = CAR.length / 2;
/** Cuso far away (the 22:00 pier end of the day), so nothing holds the car up. */
const AWAY = { d: 1e9, target: 1e9 };

/** Runs the car for `seconds`, calling `each` after every step. */
function run(car: CableCar, seconds: number, dt = 1 / 30, hold = false, cuso = AWAY, each?: (car: CableCar, dv: number) => void) {
  for (let t = 0; t < seconds; t += dt) {
    const v = car.v;
    stepCar(car, dt, cuso, hold);
    each?.(car, car.v - v);
  }
  return car;
}

describe("the Union Square cable line", () => {
  it("lays its rails down the middle of the z 14 street, on the street surface", () => {
    expect(CABLE_RAILS).toContainEqual([X0, X1, LINE.z]);
    for (let x = X0; x <= X1; x += 0.1) {
      for (const z of [LINE.z - GAUGE / 2, LINE.z, LINE.z + GAUGE / 2]) {
        expect(groundAt(x, z), `${x.toFixed(1)},${z}`).toBe("street");
        expect(inPark(x, z)).toBe(false);
        expect(insideLand(x, z)).toBe(true);
      }
    }
  });

  it("stops before the traffic junctions at both ends: x -19 to the west, the x 13 junction under the Bay Bridge viaduct to the east", () => {
    // the rails stay off both junctions' crosswalks; the car stays off the cross streets the traffic loop drives
    expect(X0).toBeGreaterThan(-19 + EDGE);
    expect(X1).toBeLessThan(13 - EDGE);
    expect(STOPS[0] - HALF).toBeGreaterThan(-19 + EDGE);
    expect(STOPS[STOPS.length - 1] + HALF).toBeLessThan(13 - STREET / 2 - 0.3);
    const viaduct = ROADS.find((r) => r.name === "bay-bridge-west")!;
    const reach = STOPS[STOPS.length - 1] + HALF;
    for (const [x] of viaduct.points) expect(x).toBeGreaterThan(reach + 1);
    for (const [x, z] of piers(viaduct)) expect(Math.hypot(Math.max(0, x - reach), z - LINE.z)).toBeGreaterThan(2);
  });

  it("leaves room at its east end for the traffic turning at the x 13 junction", () => {
    // the car's footprint at its east stop (roof and running boards), against every traffic car's footprint near there
    const e = STOPS[STOPS.length - 1];
    const box = [[e - HALF, LINE.z - CAR.width / 2], [e + HALF, LINE.z - CAR.width / 2], [e + HALF, LINE.z + CAR.width / 2], [e - HALF, LINE.z + CAR.width / 2]];
    const pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    let near = 0;
    for (const car of makeTraffic()) {
      const { length, width } = MODELS[car.type];
      for (let s = 0; s < car.path.length; s += 0.1) {
        carPose(car, s, pose);
        if (Math.hypot(pose.x - e, pose.z - LINE.z) > 8) continue;
        near++;
        const [fx, fz] = [Math.sin(pose.yaw), Math.cos(pose.yaw)];
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [pose.x + (fx * a * length) / 2 + (fz * b * width) / 2, pose.z + (fz * a * length) / 2 - (fx * b * width) / 2]);
        const apart = [[1, 0], [0, 1], [fx, fz], [fz, -fx]].some(([ux, uz]) => {
          const p = corners.map(([x, z]) => x * ux + z * uz);
          const q = box.map(([x, z]) => x * ux + z * uz);
          return Math.max(...p) < Math.min(...q) - 0.1 || Math.max(...q) < Math.min(...p) - 0.1;
        });
        expect(apart, `${car.type} at ${pose.x.toFixed(2)},${pose.z.toFixed(2)}`).toBe(true);
      }
    }
    expect(near).toBeGreaterThan(0);
  });

  it("keeps both trucks on the rails at every stop and everywhere between", () => {
    expect([...STOPS].sort((a, b) => a - b)).toEqual(STOPS);
    expect(STOPS[0] - WHEELS).toBeGreaterThanOrEqual(X0);
    expect(STOPS[STOPS.length - 1] + WHEELS).toBeLessThanOrEqual(X1);
    // and the car runs only between its end stops
    const car = startCar();
    run(car, 240, 1 / 30, false, AWAY, (c) => {
      expect(c.s).toBeGreaterThanOrEqual(STOPS[0] - 1e-6);
      expect(c.s).toBeLessThanOrEqual(STOPS[STOPS.length - 1] + 1e-6);
    });
  });

  it("follows the street surface, pitching with it", () => {
    const out = { y: 0, tilt: 0 };
    for (let s = STOPS[0]; s <= STOPS[STOPS.length - 1]; s += 0.25) {
      carGround(s, out);
      const [a, b] = [surfaceAt(s - 1.3, LINE.z), surfaceAt(s + 1.3, LINE.z)];
      expect(out.y).toBeCloseTo((a + b) / 2, 6);
      expect(out.tilt).toBeCloseTo(Math.atan2(b - a, 2.6), 6);
    }
    // over Nob Hill's foot the street rises a little: the car pitches there
    expect(Math.abs(carGround(-4, out).tilt)).toBeGreaterThan(0.005);
  });

  it("has no centre line between the rails, and the crosswalk bars it crosses keep off the steel and the cable slot", () => {
    for (const [x0, z0, x1, z1] of LANE_MARKS) {
      const along = Math.abs(z0 - LINE.z) < 1e-6 && Math.abs(z1 - LINE.z) < 1e-6;
      if (along) expect(Math.max(x0, x1) < X0 - 0.3 || Math.min(x0, x1) > X1 + 0.3, `lane mark ${x0}..${x1}`).toBe(true);
    }
    const steel = [LINE.z - GAUGE / 2, LINE.z, LINE.z + GAUGE / 2];
    let crossed = 0;
    for (const c of CROSSWALKS) {
      if (c.x1 < X0 || c.x0 > X1 || c.z0 > LINE.z || c.z1 < LINE.z) continue;
      crossed++;
      const bars = crosswalkBars(c);
      expect(bars.length).toBeGreaterThanOrEqual(5);
      for (const [, , z0, z1] of bars) for (const z of steel) expect(z < z0 - 0.05 || z > z1 + 0.05, `bar ${z0.toFixed(2)}..${z1.toFixed(2)} on the steel at ${z}`).toBe(true);
    }
    expect(crossed).toBeGreaterThanOrEqual(2); // both sides of the x -3 junction
  });
});

describe("the Union Square cable car's run", () => {
  it("stops at Union Square, under the billboard, where the 12:00 shot has it", () => {
    expect(STOPS).toContain(UNION_CAR.p[0]);
    expect(LINE.z).toBe(UNION_CAR.p[2]);
    expect(startCar().s).toBe(UNION_CAR.p[0]); // it starts there, so a page opened at 12:00 has it in place
  });

  it("runs end to end: away from Union Square, to both ends of the line, and back, stopping at each stop", () => {
    const car = startCar();
    const visited = new Set<number>();
    run(car, 180, 1 / 30, false, AWAY, (c) => {
      if (c.at >= 0) visited.add(c.at);
    });
    expect([...visited].sort()).toEqual(STOPS.map((_, i) => i));
  });

  it("moves smoothly: the grip takes the cable gently, cruises at cable speed, brakes into each stop", () => {
    for (const dt of [1 / 120, 1 / 60, 1 / 30, 0.1]) {
      const car = startCar();
      let top = 0;
      run(car, 200, dt, false, AWAY, (c, dv) => {
        expect(dv / dt).toBeLessThanOrEqual(ACCEL + 1e-6);
        expect(-dv / dt).toBeLessThanOrEqual(BRAKE * 1.25);
        expect(c.v).toBeGreaterThanOrEqual(0);
        top = Math.max(top, c.v);
        if (c.at >= 0) expect(c.v).toBe(0);
      });
      expect(top).toBeCloseTo(CRUISE, 1);
    }
  });

  it("stays clear of every place Cuso crosses its street whenever it stands at a stop", () => {
    const { spans } = crossings();
    expect(spans.length).toBeGreaterThanOrEqual(2); // where he crosses at x -1.4 and climbs to Union Square at x 5.6
    for (const s of STOPS) for (const { s0, s1 } of spans) expect(s <= s0 - 0.05 || s >= s1 + 0.05, `stop ${s} in ${s0.toFixed(2)}..${s1.toFixed(2)}`).toBe(true);
  });

  it("comes to rest at Union Square during 07:00 and 12:00 from anywhere on its run, and waits there", () => {
    const union = STOPS.indexOf(UNION_CAR.p[0]);
    for (let phase = 0; phase < 70; phase += 1.5) {
      const car = run(startCar(), phase);
      let t = 0;
      while (!(car.at === union) && t < 40) {
        stepCar(car, 1 / 30, AWAY, true);
        t += 1 / 30;
      }
      expect(car.at, `from ${phase} s into the run`).toBe(union);
      expect(t).toBeLessThan(30);
      run(car, 60, 1 / 30, true, AWAY, (c) => expect(c.s).toBe(UNION_CAR.p[0]));
    }
  });

  it("holds at Union Square for the 07:00 and 12:00 chapters in the story, never in explore mode", () => {
    expect(holdsAtUnion(1, "story")).toBe(true); // 07:00
    expect(holdsAtUnion(3, "story")).toBe(true); // 12:00
    expect(holdsAtUnion(2.8, "story")).toBe(true); // most of the way from 09:00 to 12:00
    expect(holdsAtUnion(2, "story")).toBe(false); // 09:00
    expect(holdsAtUnion(4, "story")).toBe(false); // 15:00
    expect(holdsAtUnion(3, "explore")).toBe(false);
  });
});
