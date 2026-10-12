import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { heightAt } from "@/lib/terrain";
import { WALK_X, WALK_Z, X_STREETS, Z_STREETS, insideLand } from "@/scene/grid";
import { type Car, MODELS, carPose, driveCars, makeCars, pointAt, spacing, wheelAngle } from "@/scene/traffic";

const cars = makeCars();
const carX = X_STREETS.filter((v) => !WALK_X.includes(v));
const carZ = Z_STREETS.filter((v) => !WALK_Z.includes(v));
const far = { x: 999, z: 999 };

/** Two cars overlap if no axis of either footprint separates them. */
function overlap(a: Car, sa: number, b: Car, sb: number) {
  const corners = (car: Car, s: number) => {
    const p = carPose(car, s, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
    const f = [Math.sin(p.yaw), Math.cos(p.yaw)];
    const l = [f[1], -f[0]];
    const { length, width } = MODELS[car.type];
    return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [
      p.x + f[0] * i * (length / 2) + l[0] * j * (width / 2),
      p.z + f[1] * i * (length / 2) + l[1] * j * (width / 2),
    ]);
  };
  const A = corners(a, sa);
  const B = corners(b, sb);
  const axes = [A, B].flatMap((P) => [0, 1].map((k) => [P[k + 1][0] - P[k][0], P[k + 1][1] - P[k][1]]));
  return axes.every(([ax, az]) => {
    const proj = (P: number[][]) => P.map(([x, z]) => x * ax + z * az);
    return Math.max(...proj(A)) > Math.min(...proj(B)) && Math.max(...proj(B)) > Math.min(...proj(A));
  });
}

function noOverlap(driven: Float32Array) {
  for (let i = 0; i < cars.length; i++)
    for (let j = i + 1; j < cars.length; j++) expect(overlap(cars[i], driven[i], cars[j], driven[j]), `cars ${i} and ${j}`).toBe(false);
}

describe("traffic", () => {
  it("is just a few cars", () => {
    expect(cars.length).toBeGreaterThanOrEqual(6);
    expect(cars.length).toBeLessThanOrEqual(10);
  });

  it("is the same every time (seeded)", () => {
    expect(makeCars()).toEqual(cars);
  });

  it("keeps every car on land and in a lane of a car street", () => {
    const p = { x: 0, z: 0 };
    for (const car of cars) {
      for (let s = 0; s < car.path.length; s += 0.5) {
        pointAt(car.path, s, p);
        expect(insideLand(p.x, p.z), `${p.x},${p.z}`).toBe(true);
        const inLane = (cs: number[], v: number) => cs.some((c) => Math.abs(Math.abs(v - c) - 0.75) < 0.02);
        const near = (cs: number[], v: number) => cs.some((c) => Math.abs(v - c) < 2); // a corner
        const turning = near(carX, p.x) && near(carZ, p.z);
        expect(inLane(carX, p.x) || inLane(carZ, p.z) || turning, `${p.x},${p.z}`).toBe(true);
      }
    }
  });

  it("never lets two cars overlap", () => {
    const driven = Float32Array.from(cars, (c) => c.offset);
    for (let t = 0; t < 240; t += 0.1) {
      driveCars(cars, driven, 0.1, far);
      noOverlap(driven);
    }
  });

  it("stops for Cuso, and the cars behind queue without touching", () => {
    const driven = Float32Array.from(cars, (c) => c.offset);
    const first = carPose(cars[0], driven[0] + 6, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
    const cuso = { x: first.x, z: first.z };
    const start = driven[0];
    for (let t = 0; t < 120; t += 0.1) {
      driveCars(cars, driven, 0.1, cuso);
      noOverlap(driven);
    }
    const moved = (driven[0] - start + cars[0].path.length) % cars[0].path.length;
    expect(moved).toBeGreaterThan(1);
    expect(moved).toBeLessThan(6);
  });

  it("sits on the road and tilts with the hill", () => {
    const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 };
    let steepest = 0;
    for (const car of cars) {
      for (let s = 0; s < car.path.length; s += 1) {
        const p = carPose(car, s, pose);
        const [fx, fz] = [Math.sin(p.yaw) * 0.2, Math.cos(p.yaw) * 0.2];
        const slope = (heightAt(p.x + fx, p.z + fz) - heightAt(p.x - fx, p.z - fz)) / 0.4;
        expect(Math.abs(p.y - heightAt(p.x, p.z))).toBeLessThan(0.12);
        expect(Math.abs(p.pitch + Math.atan(slope))).toBeLessThan(0.06); // pitch > 0 is nose down
        steepest = Math.max(steepest, Math.abs(p.pitch));
      }
    }
    expect(steepest).toBeGreaterThan(0.1); // the routes do climb hills
  });

  it("is mostly the sedan, with one Cybertruck and one Roadster", () => {
    const of = (type: string) => cars.filter((c) => c.type === type).length;
    expect(of("cybertruck")).toBe(1);
    expect(of("roadster")).toBe(1);
    expect(of("model")).toBe(cars.length - 2);
  });

  it("keeps a longer gap behind and in front of a longer car", () => {
    const [sedan, truck] = [cars.find((c) => c.type === "model")!, cars.find((c) => c.type === "cybertruck")!];
    expect(spacing(truck, sedan)).toBeGreaterThan(spacing(sedan, sedan));
    expect(spacing(truck, sedan)).toBeCloseTo((MODELS.cybertruck.length + MODELS.model.length) / 2 + 1.4, 5);
    // Same distance to the car in front: a sedan may roll on, the Cybertruck waits.
    const path = sedan.path;
    const between = (spacing(sedan, sedan) + spacing(truck, sedan)) / 2;
    for (const [follower, moves] of [[sedan, true], [truck, false]] as const) {
      const pair: Car[] = [{ ...follower, path }, { ...sedan, path }];
      const driven = Float32Array.from([10, 10 + between]);
      driveCars(pair, driven, 0.1, far);
      expect(driven[0] > 10, follower.type).toBe(moves);
    }
  });

  it("keeps every tyre on the road, round corners and over hills", () => {
    let worst = 0;
    for (const car of cars) {
      const m = MODELS[car.type];
      const buf = readFileSync(join(process.cwd(), "public", m.url));
      const { wheels } = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()).nodes[0].extras as { wheels: number[][] };
      for (let s = 0; s < car.path.length; s += 0.5) {
        const p = carPose(car, s, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
        const turn = new Euler(p.pitch, p.yaw, p.roll, "YXZ");
        for (const [x, y, z, r] of wheels) {
          const bottom = new Vector3(x, y - r, z).multiplyScalar(m.scale).applyEuler(turn).add(new Vector3(p.x, p.y, p.z));
          worst = Math.max(worst, Math.abs(bottom.y - heightAt(bottom.x, bottom.z)));
        }
      }
    }
    expect(worst).toBeLessThan(0.05); // no gap you could see, no tyre sunk in
  });

  it("rolls the wheels by the distance driven, and not while waiting", () => {
    const driven = Float32Array.from(cars, (c) => c.offset);
    const rolled = new Float64Array(cars.length);
    const radius = 0.25;
    for (let k = 0; k < 50; k++) driveCars(cars, driven, 0.1, far, rolled); // 5 s, nothing in the way
    expect(rolled[0]).toBeCloseTo(5 * cars[0].speed, 3);
    expect(wheelAngle(rolled[0], radius)).toBeCloseTo((5 * cars[0].speed) / radius, 2);
    expect(wheelAngle(2 * rolled[0], radius)).toBeGreaterThan(wheelAngle(rolled[0], radius));
    // Cuso steps out just ahead of car 0: it stops, and so do its wheels.
    const ahead = carPose(cars[0], driven[0] + 2.5, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
    for (let k = 0; k < 20; k++) driveCars(cars, driven, 0.1, ahead, rolled);
    const stopped = rolled[0];
    for (let k = 0; k < 30; k++) driveCars(cars, driven, 0.1, ahead, rolled);
    expect(rolled[0]).toBe(stopped);
  });

  describe.each(Object.entries(MODELS))("the %s model", (type, m) => {
    const file = join(process.cwd(), "public", m.url);
    /** The GLB's JSON chunk. */
    const gltf = () => {
      const buf = readFileSync(file);
      return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
    };

    it("is a small GLB", () => {
      expect(statSync(file).size).toBeLessThan(400 * 1024);
    });

    it("has the size the traffic plans with, and fits a lane", () => {
      const { nodes } = gltf();
      const extras = nodes.find((n: { extras?: object }) => n.extras).extras;
      for (const k of ["length", "width", "wheelbase"] as const) expect(extras[k], `${type} ${k}`).toBeCloseTo(m.metres[k], 2);
      expect(m.width).toBeLessThan(1.5); // a lane is 1.5 wide
      expect(m.length).toBeGreaterThan(2.8);
      expect(m.length).toBeLessThan(4);
    });

    it("has four wheels on the ground, under the car, at its wheelbase", () => {
      const { wheels } = gltf().nodes.find((n: { extras?: object }) => n.extras).extras as { wheels: number[][] };
      expect(wheels).toHaveLength(4);
      for (const [x, y, z, r] of wheels) {
        expect(y, `${type} wheel touches the ground`).toBeCloseTo(r, 2);
        expect(Math.abs(x) + 0.1).toBeLessThan(m.metres.width / 2);
        expect(Math.abs(z) * 2).toBeCloseTo(m.metres.wheelbase, 1);
      }
      expect(wheels.map(([x, , z]) => [Math.sign(x), Math.sign(z)])).toEqual([[1, 1], [-1, 1], [1, -1], [-1, -1]]);
    });

    it("has only the named materials, no logo", () => {
      const names = gltf().materials.map((mat: { name: string }) => mat.name);
      expect(names).toEqual(expect.arrayContaining(["paint", "glass", "trim", "tyre", "rim", "light_front", "light_rear"]));
      expect(names).toHaveLength(7); // a draw call each
    });
  });
});
