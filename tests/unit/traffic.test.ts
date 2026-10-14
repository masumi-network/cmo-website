import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { heightAt, surfaceAt } from "@/lib/terrain";
import { WALK_X, WALK_Z, X_STREETS, Z_STREETS, groundAt, insideLand } from "@/scene/grid";
import { CITY, OBSTACLES, PYRAMID, pyramidHalf } from "@/scene/layout";
import { HYDRANT, LAMP, SIGN } from "@/scene/street";
import { PATHS } from "@/scene/routes";
import { chapters } from "@/content/day";
import { MAX_GRADE, ROADS, ROAD_WIDTH, onRoad } from "@/scene/roads";
import { type Car, type Pose, LOOPS, MODELS, carPose, driveCars, makeTraffic, outOfSight, pointAt, spacing, wheelAngle } from "@/scene/traffic";

const cars = makeTraffic();
/** Cars on a city loop; the others cross a bridge (their path knows the road surface). */
const city = cars.filter((c) => !c.path.ys);
const bridge = cars.filter((c) => c.path.ys);
const routes = [...new Set(bridge.map((c) => c.path))];
const carX = X_STREETS.filter((v) => !WALK_X.includes(v));
const carZ = Z_STREETS.filter((v) => !WALK_Z.includes(v));
const far = { x: 999, z: 999 };
const newPose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0 });
const LANE = 0.75;

/** The Yerba Buena tunnel portal: [x, y, z] where the Bay Bridge's east road ends. */
const PORTAL = ROADS.find((r) => r.tunnel)!.points.at(-1)!;
/** Where the Marin road goes into the fog (it ends at z -288). */
const FOG_Z = -280;

/** What a tyre stands on: a bridge deck or road, the tunnel floor, or the ground (streets a kerb below their sidewalks). */
function surface(x: number, z: number) {
  if (x > PORTAL[0] && Math.abs(z - PORTAL[2]) < ROAD_WIDTH / 2) return PORTAL[1];
  const r = onRoad(x, z);
  return r ? Math.max(r.y, surfaceAt(x, z)) : surfaceAt(x, z);
}

/** Two cars overlap if no axis of either footprint separates them. */
function overlap(a: Car, sa: number, b: Car, sb: number) {
  const corners = (car: Car, s: number) => {
    const p = carPose(car, s, newPose());
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

/** No two visible cars overlap (a car out of sight in the tunnel or the fog can't be seen touching). */
function noOverlap(driven: Float32Array) {
  const poses = cars.map((car, i) => carPose(car, driven[i], newPose()));
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const [a, b] = [poses[i], poses[j]];
      if (outOfSight(a.x, a.z) || outOfSight(b.x, b.z) || Math.hypot(a.x - b.x, a.z - b.z) > 6) continue;
      expect(overlap(cars[i], driven[i], cars[j], driven[j]), `cars ${i} and ${j} at ${a.x.toFixed(1)},${a.z.toFixed(1)}`).toBe(false);
    }
  }
}

/** Every visible sample of a bridge route, about every half unit. */
function samples(path: Car["path"]) {
  const out: { s: number; x: number; y: number; z: number }[] = [];
  for (let s = 0; s < path.length; s += 0.5) {
    const p = pointAt(path, s, { x: 0, y: 0, z: 0 });
    if (!outOfSight(p.x, p.z)) out.push({ s, x: p.x, y: p.y, z: p.z });
  }
  return out;
}

/** Sample i follows sample i - 1 on the path (no stretch out of sight between them). */
const next = (pts: { s: number }[], i: number) => pts[i].s - pts[i - 1].s < 0.6;

describe("traffic", () => {
  it("is a few cars: seven on the city loops, a few more over the bridges", () => {
    // Was 6 to 10 before the bridges carried traffic; now 11 to 13 in all.
    expect(cars.length).toBeGreaterThanOrEqual(11);
    expect(cars.length).toBeLessThanOrEqual(13);
    expect(city).toHaveLength(7);
    expect(bridge.length).toBeGreaterThanOrEqual(4);
    expect(bridge.length).toBeLessThanOrEqual(6);
  });

  it("is the same every time (seeded)", () => {
    expect(makeTraffic()).toEqual(cars);
  });

  it("keeps every city car on land and in a lane of a car street", () => {
    const p = { x: 0, z: 0 };
    for (const car of city) {
      for (let s = 0; s < car.path.length; s += 0.5) {
        pointAt(car.path, s, p);
        expect(insideLand(p.x, p.z), `${p.x},${p.z}`).toBe(true);
        const inLane = (cs: number[], v: number) => cs.some((c) => Math.abs(Math.abs(v - c) - LANE) < 0.02);
        // turning (a left turn starts well before its corner), or drifting back into its lane after one, still on a car street
        const near = (r: number) => carX.some((c) => Math.abs(p.x - c) < r) && carZ.some((c) => Math.abs(p.z - c) < r);
        const onStreet = carX.some((c) => Math.abs(p.x - c) < 1.5) || carZ.some((c) => Math.abs(p.z - c) < 1.5);
        expect(inLane(carX, p.x) || inLane(carZ, p.z) || near(6) || (near(18) && onStreet), `${p.x},${p.z}`).toBe(true);
      }
    }
  });

  it("never lets two cars overlap, city and bridge cars together, and nobody gets stuck", () => {
    // 25 minutes; every 20 s Cuso either steps out just ahead of a car (next one in turn) or stays away,
    // so queues form on the shared lanes, round corners and at the junctions.
    const driven = Float32Array.from(cars, (c) => c.offset);
    const rolled = new Float64Array(cars.length);
    const waited = new Float64Array(cars.length);
    let longest = 0;
    let cuso = far;
    for (let n = 0; n < 15000; n++) {
      if (n % 200 === 0) {
        const k = n / 200;
        const c = (k * 7) % cars.length;
        cuso = k % 2 ? carPose(cars[c], driven[c] + 5, newPose()) : far;
      }
      const before = Float64Array.from(rolled);
      driveCars(cars, driven, 0.1, cuso, rolled);
      noOverlap(driven);
      cars.forEach((_, i) => {
        waited[i] = rolled[i] === before[i] ? waited[i] + 0.1 : 0;
        longest = Math.max(longest, waited[i]);
      });
    }
    // Cuso holds a car up to 20 s; taking turns at a junction adds a few seconds, never a jam.
    expect(longest).toBeLessThan(30);
  });

  it("never puts two oncoming cars where they would touch, outside a junction they take turns at", () => {
    // Every pair of places on every pair of routes, each as the biggest car on it: side by side in
    // opposite lanes they clear each other, except round tight bends and junctions (ZONES).
    const paths = [...new Set(cars.map((c) => c.path))];
    const size = (c: Car) => MODELS[c.type].length * MODELS[c.type].width;
    const big = (path: Car["path"]): Car => cars.filter((c) => c.path === path).reduce((a, b) => (size(b) > size(a) ? b : a));
    const zone = (path: Car["path"], s: number) => path.zones[Math.floor((s / path.length) * path.zones.length) % path.zones.length];
    const touching: string[] = [];
    paths.forEach((pa, a) =>
      paths.slice(a).forEach((pb) => {
        for (let sa = 0; sa < pa.length; sa += 0.5) {
          const p = carPose(big(pa), sa, newPose());
          if (outOfSight(p.x, p.z)) continue;
          for (let sb = pa === pb ? sa + 10 : 0; sb < (pa === pb ? sa + pa.length - 10 : pb.length); sb += 0.5) {
            const q = carPose(big(pb), sb % pb.length, newPose());
            if (Math.hypot(p.x - q.x, p.z - q.z) > 5 || outOfSight(q.x, q.z) || zone(pa, sa) & zone(pb, sb % pb.length)) continue;
            if (Math.sin(p.yaw) * Math.sin(q.yaw) + Math.cos(p.yaw) * Math.cos(q.yaw) > -0.3) continue; // following: the gap rules
            if (overlap(big(pa), sa, big(pb), sb % pb.length)) touching.push(`${p.x.toFixed(1)},${p.z.toFixed(1)} ${q.x.toFixed(1)},${q.z.toFixed(1)} ${paths.indexOf(pa)}-${paths.indexOf(pb)}`);
          }
        }
      }),
    );
    expect(touching).toEqual([]);
  }, 30_000); // every pair of places on every pair of routes: seconds on a slow CI runner

  it("stops for Cuso, and the cars behind queue without touching", () => {
    const driven = Float32Array.from(cars, (c) => c.offset);
    const first = carPose(cars[0], driven[0] + 6, newPose());
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
    let steepest = 0;
    for (const car of city) {
      for (let s = 0; s < car.path.length; s += 1) {
        const p = carPose(car, s, newPose());
        const [fx, fz] = [Math.sin(p.yaw) * 0.2, Math.cos(p.yaw) * 0.2];
        const slope = (surfaceAt(p.x + fx, p.z + fz) - surfaceAt(p.x - fx, p.z - fz)) / 0.4;
        expect(Math.abs(p.y - surfaceAt(p.x, p.z))).toBeLessThan(0.12);
        expect(Math.abs(p.pitch + Math.atan(slope))).toBeLessThan(0.06); // pitch > 0 is nose down
        steepest = Math.max(steepest, Math.abs(p.pitch));
      }
    }
    expect(steepest).toBeGreaterThan(0.1); // the routes do climb hills
  });

  it("looks like San Francisco traffic: mostly Model 3s and Model Ys, the odd Cybertruck and Roadster", () => {
    const of = (type: string, list = cars) => list.filter((c) => c.type === type).length;
    expect(of("cybertruck")).toBe(2);
    expect(of("roadster")).toBe(1);
    expect(of("model3")).toBeGreaterThanOrEqual(4);
    expect(of("modely")).toBeGreaterThanOrEqual(4);
    expect(of("model3") + of("modely")).toBe(cars.length - 3);
    for (const type of ["model3", "modely"]) for (const route of routes) expect(of(type, bridge.filter((c) => c.path === route)), type).toBeGreaterThan(0);
  });

  it("keeps a longer gap behind and in front of a longer car", () => {
    const [sedan, truck] = [cars.find((c) => c.type === "model3")!, cars.find((c) => c.type === "cybertruck")!];
    expect(spacing(truck, sedan)).toBeGreaterThan(spacing(sedan, sedan));
    expect(spacing(truck, sedan)).toBeCloseTo((MODELS.cybertruck.length + MODELS.model3.length) / 2 + 1.4, 5);
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

  it.each([
    ["city", city, 0.05],
    // A rigid car can't touch with all four tyres where the road twists under it (the Golden Gate's
    // radius 6 bend at full grade: on the inside lane its axles are not square to the road), nor turning onto the
    // foot of the Bay Bridge ramp across the seam with the street. Springs take that up.
    ["bridge", bridge, 0.075],
  ] as const)("keeps every tyre of the %s cars on the road, round corners, over hills and over the bridges", (_, list, most) => {
    let worst = 0;
    for (const car of list) {
      const m = MODELS[car.type];
      const buf = readFileSync(join(process.cwd(), "public", m.url));
      const { wheels } = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()).nodes[0].extras as { wheels: number[][] };
      for (let s = 0; s < car.path.length; s += 0.5) {
        const p = carPose(car, s, newPose());
        if (outOfSight(p.x, p.z)) continue;
        const turn = new Euler(p.pitch, p.yaw, p.roll, "YXZ");
        for (const [x, y, z, r] of wheels) {
          const bottom = new Vector3(x, y - r, z).multiplyScalar(m.scale).applyEuler(turn).add(new Vector3(p.x, p.y, p.z));
          worst = Math.max(worst, Math.abs(bottom.y - surface(bottom.x, bottom.z)));
        }
      }
    }
    expect(worst).toBeLessThan(most); // no gap you could see, no tyre sunk in
  });

  it("rolls the wheels by the distance driven, and not while waiting", () => {
    const driven = Float32Array.from(cars, (c) => c.offset);
    const rolled = new Float64Array(cars.length);
    const radius = 0.25;
    for (let k = 0; k < 50; k++) driveCars(cars, driven, 0.1, far, rolled); // 5 s, nothing in the way
    // as far as it went along its path (slower round a corner)
    const along = (driven[0] - cars[0].offset + cars[0].path.length) % cars[0].path.length;
    expect(rolled[0]).toBeCloseTo(along, 3);
    expect(rolled[0]).toBeGreaterThan(5 * cars[0].speed * 0.5);
    expect(wheelAngle(rolled[0], radius)).toBeCloseTo(along / radius, 2);
    expect(wheelAngle(2 * rolled[0], radius)).toBeGreaterThan(wheelAngle(rolled[0], radius));
    // Cuso steps out just ahead of car 0: it stops, and so do its wheels.
    const ahead = carPose(cars[0], driven[0] + 2.5, newPose());
    for (let k = 0; k < 20; k++) driveCars(cars, driven, 0.1, ahead, rolled);
    const stopped = rolled[0];
    for (let k = 0; k < 30; k++) driveCars(cars, driven, 0.1, ahead, rolled);
    expect(rolled[0]).toBe(stopped);
  });

  /** A GLB's JSON chunk. */
  const json = (url: string) => {
    const buf = readFileSync(join(process.cwd(), "public", url));
    return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  };
  /** Triangles a car draws: its parts once, the wheel (tyre and rim) four times. */
  const drawn = (url: string) => {
    const { meshes, accessors, materials } = json(url) as { meshes: { primitives: { indices: number; material: number }[] }[]; accessors: { count: number }[]; materials: { name: string }[] };
    const wheel = (p: { material: number }) => (["tyre", "rim"].includes(materials[p.material].name) ? 4 : 1);
    return meshes.flatMap((mesh) => mesh.primitives).reduce((sum, p) => sum + (accessors[p.indices].count / 3) * wheel(p), 0);
  };

  it.each(Object.entries(MODELS))("gives phones a %s with at most 60% of the triangles", (_, m) => {
    expect(drawn(m.liteUrl)).toBeLessThan(drawn(m.url) * 0.6);
  });

  // Per car, wheels counted four times. 13 cars at the most are on screen; a phone draws the lite ones.
  it.each(Object.entries(MODELS))("keeps the %s within its triangle budget", (_, m) => {
    expect(drawn(m.url)).toBeLessThan(25_000);
    expect(drawn(m.url)).toBeGreaterThan(4_000); // not simplified to a blob
    expect(drawn(m.liteUrl)).toBeLessThan(10_000);
  });

  describe.each(Object.entries(MODELS).flatMap(([type, m]) => [[type, m, m.url], [`${type} (lite)`, m, m.liteUrl]] as const))("the %s model", (type, m, url) => {
    const file = join(process.cwd(), "public", url);
    const gltf = () => json(url);

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
        expect(r, `${type} wheel radius in metres`).toBeGreaterThan(0.3); // 19 to 22 inch wheels with their tyres
        expect(r, `${type} wheel radius in metres`).toBeLessThan(0.48);
        expect(y, `${type} wheel touches the ground`).toBeCloseTo(r, 2);
        expect(Math.abs(x) + 0.1).toBeLessThan(m.metres.width / 2);
        expect(Math.abs(z) * 2).toBeCloseTo(m.metres.wheelbase, 1);
      }
      expect(wheels.map(([x, , z]) => [Math.sign(x), Math.sign(z)])).toEqual([[1, 1], [-1, 1], [1, -1], [-1, -1]]);
    });

    it("maps every material to a part traffic.tsx knows, no logo", () => {
      const names = gltf().materials.map((mat: { name: string }) => mat.name);
      expect([...names].sort()).toEqual(["glass", "light_front", "light_rear", "paint", "rim", "trim", "tyre"]); // a draw call each
    });
  });
});

describe("bridge traffic", () => {
  it("crosses both bridges both ways, on the right-hand lane", () => {
    for (const deck of ["golden-gate-deck", "bay-bridge-deck"]) {
      const ways = new Set<number>();
      for (const path of routes) {
        const pts = samples(path);
        for (let i = 1; i < pts.length; i++) {
          const [a, b] = [onRoad(pts[i - 1].x, pts[i - 1].z), onRoad(pts[i].x, pts[i].z)];
          if (next(pts, i) && a?.name === deck && b?.name === deck) ways.add(Math.sign(b.s - a.s));
        }
      }
      expect([...ways].sort(), deck).toEqual([-1, 1]);
    }
  });

  it("keeps to the right-hand lane of every bridge road, the whole car on the road", () => {
    const widest = Math.max(...bridge.map((c) => MODELS[c.type].width));
    /** Turning at a bridge junction, or drifting back into its lane after a left turn there (the turn tests cover it). */
    const turning = ({ x, z }: { x: number; z: number }) => [[13, 14], [-51, -36]].some(([jx, jz]) => Math.hypot(x - jx, z - jz) < 14);
    for (const path of routes) {
      const pts = samples(path);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [onRoad(pts[i - 1].x, pts[i - 1].z), onRoad(pts[i].x, pts[i].z)];
        if (!next(pts, i) || !a || !b || a.name !== b.name || Math.abs(b.s - a.s) < 0.05 || turning(pts[i])) continue;
        const at = `${b.name} ${pts[i].x.toFixed(1)},${pts[i].z.toFixed(1)}`;
        // The road's left is +offset: driving along it, the right lane is at -LANE; against it, +LANE.
        expect(b.offset * Math.sign(b.s - a.s), at).toBeCloseTo(-LANE, 1);
        expect(Math.abs(b.offset) + widest / 2, at).toBeLessThanOrEqual(ROAD_WIDTH / 2);
      }
    }
  });

  it("is always on the road surface: decks, approaches, tunnel floor, streets", () => {
    for (const path of routes) {
      for (const { x, y, z } of samples(path)) expect(Math.abs(y - surface(x, z)), `${x.toFixed(1)},${z.toFixed(1)}`).toBeLessThan(0.05);
    }
  });

  it("is never steeper than the roads allow, and pitches with the slope", () => {
    for (const path of routes) {
      const pts = samples(path);
      // Over 3 units, measured along the road (the inner lane of a bend is shorter, so steeper per lane length).
      for (let i = 6; i < pts.length; i++) {
        const [a, b] = [onRoad(pts[i - 6].x, pts[i - 6].z), onRoad(pts[i].x, pts[i].z)];
        if (pts[i].s - pts[i - 6].s > 3.1 || !a || !b || a.name !== b.name) continue;
        expect(Math.abs(pts[i].y - pts[i - 6].y) / Math.abs(b.s - a.s), b.name).toBeLessThanOrEqual(MAX_GRADE + 0.006);
      }
    }
    let steepest = 0;
    for (const car of bridge) {
      for (let s = 0; s < car.path.length; s += 1) {
        const p = carPose(car, s, newPose());
        if (outOfSight(p.x, p.z)) continue;
        const [fx, fz] = [Math.sin(p.yaw), Math.cos(p.yaw)];
        const half = MODELS[car.type].wheelbase / 2;
        const slope = (surface(p.x + fx * half, p.z + fz * half) - surface(p.x - fx * half, p.z - fz * half)) / (2 * half);
        expect(Math.abs(p.pitch + Math.atan(slope)), `${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBeLessThan(0.03);
        steepest = Math.max(steepest, Math.abs(p.pitch));
      }
    }
    expect(steepest).toBeGreaterThan(0.25); // down the approaches
  });

  it("joins the city streets at the bridge junctions, and keeps to car lanes there", () => {
    const junctions = [[13, 14], [-67, -36]];
    for (const path of routes) {
      const pts = samples(path);
      /** On a bridge road or in the tunnel. */
      const onBridge = ({ x, z }: { x: number; z: number }) => !!onRoad(x, z) || x > PORTAL[0];
      for (let i = 0; i < pts.length; i++) {
        const { x, z } = pts[i];
        // where a road meets the street
        if (onBridge(pts[i]) !== onBridge(pts[(i + pts.length - 1) % pts.length])) {
          expect(junctions.some(([jx, jz]) => Math.hypot(x - jx, z - jz) < 3), `${x},${z}`).toBe(true);
        }
        if (onBridge(pts[i])) continue;
        expect(insideLand(x, z), `${x},${z}`).toBe(true);
        const inLane = (cs: number[], v: number) => cs.some((c) => Math.abs(Math.abs(v - c) - LANE) < 0.02);
        // turning (a left turn starts well before its corner), or drifting back into its lane after one, still on a car street
        const near = (r: number) => X_STREETS.some((sx) => Math.abs(x - sx) < r) && Z_STREETS.some((sz) => Math.abs(z - sz) < r);
        const onStreet = carX.some((c) => Math.abs(x - c) < 1.5) || carZ.some((c) => Math.abs(z - c) < 1.5);
        expect(inLane(carX, x) || inLane(carZ, z) || near(6) || (near(14) && onStreet), `${x},${z}`).toBe(true);
      }
    }
  });

  it("goes out of sight only inside the Yerba Buena tunnel or in the Marin fog, and turns round there", () => {
    for (const car of cars) {
      let hidden = 0;
      for (let s = 0; s < car.path.length; s += 0.25) {
        const p = carPose(car, s, newPose());
        if (!outOfSight(p.x, p.z)) continue;
        hidden++;
        // whole car behind the portal's dark face, or past the fog line
        const inTunnel = p.x - MODELS[car.type].length / 2 > PORTAL[0] + 0.3 && Math.abs(p.z - PORTAL[2]) < ROAD_WIDTH / 2;
        expect(inTunnel || p.z < FOG_Z, `${p.x.toFixed(1)},${p.z.toFixed(1)}`).toBe(true);
      }
      expect(hidden > 0, `car ${car.type} ${car.color}`).toBe(!!car.path.ys);
    }
  });

  it("stops for Cuso where it crosses his walking line, not for him under a raised road", () => {
    const car = bridge.find((c) => c.path.ys && pointAt(c.path, 0, { x: 0, z: 0 }).x > 0)!; // a Bay Bridge car
    const find = (ok: (p: Pose) => boolean) => {
      for (let s = 0; s < car.path.length; s += 0.25) if (ok(carPose(car, s, newPose()))) return s;
      throw new Error("no such spot");
    };
    // Heading south on x 13 towards the z 4 walking line, where Cuso crosses.
    const s0 = find((p) => Math.abs(p.x - 12.25) < 0.1 && Math.abs(p.z - 0) < 0.2 && Math.cos(p.yaw) > 0.9);
    const driven = Float32Array.from([s0]);
    const cuso = { x: 12.4, y: surfaceAt(12.4, 5.6), z: 5.6 };
    for (let k = 0; k < 100; k++) driveCars([car], driven, 0.1, cuso);
    const p = carPose(car, driven[0], newPose());
    expect(p.z).toBeGreaterThan(1);
    expect(p.z + MODELS[car.type].length / 2).toBeLessThan(cuso.z - 0.4);
    // High on the Bay Bridge ramp, with Cuso on the sidewalk below: it drives on.
    const s1 = find((p) => p.y > 2 && p.x < 30 && p.z > 14 && Math.sin(p.yaw) > 0.9);
    const high = carPose(car, s1, newPose());
    driven[0] = s1;
    driveCars([car], driven, 0.1, { x: high.x + 2, y: surfaceAt(high.x + 2, 15.6), z: 15.6 });
    expect(driven[0]).toBeGreaterThan(s1);
  });
});

/** A car's body as points: its outline at the sill, the mirrors and the roof (narrower), turned and tilted with its pose. */
function body(car: Car, s: number) {
  const p = carPose(car, s, newPose());
  const { length, width } = MODELS[car.type];
  const turn = new Euler(p.pitch, p.yaw, p.roll, "YXZ");
  const pts: Vector3[] = [];
  for (const [h, w] of [[0.15, 1], [0.6, 1], [1, 0.75]]) {
    for (let a = -1; a <= 1; a += 0.125) for (const side of [-1, 1]) pts.push(new Vector3((side * width * w) / 2, h, (a * length) / 2).applyEuler(turn).add(new Vector3(p.x, p.y, p.z)));
    for (let b = -1; b <= 1; b += 0.25) for (const end of [-1, 1]) pts.push(new Vector3((b * width * w) / 2, h, (end * length) / 2).applyEuler(turn).add(new Vector3(p.x, p.y, p.z)));
  }
  return { p, pts };
}

/** Where a car's tyres touch the road: each wheel's footprint, front and back edge, both sides (from the GLB). */
function tyres(car: Car, s: number) {
  const m = MODELS[car.type];
  const buf = readFileSync(join(process.cwd(), "public", m.url));
  const { wheels } = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString()).nodes[0].extras as { wheels: number[][] };
  const p = carPose(car, s, newPose());
  const [fx, fz] = [Math.sin(p.yaw), Math.cos(p.yaw)];
  // a tyre is about 0.25 m wide: its outer edge
  return wheels.flatMap(([x, , z, r]) =>
    [-r, r].map((d) => {
      const [ax, az] = [(x + Math.sign(x) * 0.12) * m.scale, (z + d) * m.scale];
      return { x: p.x + fx * az + fz * ax, z: p.z + fz * az - fx * ax };
    }),
  );
}

/** Drives one car alone round its whole route at 60 fps: time, pose and speed per frame. */
function drive(car: Car) {
  const driven = Float32Array.from([car.offset]);
  const rolled = new Float64Array(1);
  const frames: { pose: Pose; v: number }[] = [];
  for (let n = 0; rolled[0] < car.path.length; n++) {
    const before = rolled[0];
    driveCars([car], driven, 1 / 60, far, rolled);
    frames.push({ pose: carPose(car, driven[0], newPose()), v: (rolled[0] - before) * 60 });
  }
  return frames;
}
const turnOf = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const DEG = 180 / Math.PI;
/** One car of each route, the biggest on it. */
const biggest = [...new Set(cars.map((c) => c.path))].map((path) => cars.filter((c) => c.path === path).reduce((a, b) => (MODELS[b.type].length > MODELS[a.type].length ? b : a)));

describe("turns", () => {
  it("never puts a car body into the Pyramid, a building, a landmark or street furniture", () => {
    const g = heightAt(PYRAMID.x, PYRAMID.z);
    const posts = [
      ...CITY.lamps.map((l) => ({ ...l, r: LAMP.reach, h: LAMP.height })),
      ...CITY.hydrants.map((l) => ({ ...l, r: HYDRANT.reach, h: HYDRANT.height })),
      ...CITY.signs.map((l) => ({ ...l, r: SIGN.reach, h: SIGN.height })),
    ];
    const hits = new Set<string>();
    for (const car of cars) {
      for (let s = 0; s < car.path.length; s += 0.1) {
        const { p, pts } = body(car, s);
        if (outOfSight(p.x, p.z)) continue;
        for (const v of pts) {
          // the Pyramid's tapered body, with 5 cm of air (its north face stands 0.1 off the kerb)
          const half = pyramidHalf(Math.max(0, v.y - g)) + 0.05;
          if (Math.abs(v.x - PYRAMID.x) < half && Math.abs(v.z - PYRAMID.z) < half) hits.add(`Pyramid at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
          const box = OBSTACLES.find((b) => v.x > b.minX && v.x < b.maxX && v.z > b.minZ && v.z < b.maxZ && v.y < b.top);
          if (box) hits.add(`building at ${v.x.toFixed(1)},${v.z.toFixed(1)}`);
          const post = posts.find((o) => Math.abs(v.x - o.x) < o.r && Math.abs(v.z - o.z) < o.r && v.y < o.y + o.h);
          if (post) hits.add(`post at ${post.x.toFixed(1)},${post.z.toFixed(1)}`);
        }
      }
    }
    expect([...hits]).toEqual([]);
  }, 60_000);

  it("keeps the tyres on the asphalt and the body over the kerb by a hair at most, round every corner", () => {
    /** On a street, a bridge road or in the tunnel. */
    const paved = (x: number, z: number) => groundAt(x, z) === "street" || !!onRoad(x, z) || x > PORTAL[0];
    for (const car of biggest) {
      let tyre = 0;
      let over = 0;
      for (let s = 0; s < car.path.length; s += 0.1) {
        const { p, pts } = body(car, s);
        if (outOfSight(p.x, p.z) || onRoad(p.x, p.z)) continue;
        tyre += tyres(car, s).filter((t) => !paved(t.x, t.z)).length;
        // how far the body's sill reaches over a sidewalk: step it back towards the car's centre line
        for (const v of pts.slice(0, 50)) {
          let d = 0;
          const [lx, lz] = [p.x - v.x, p.z - v.z].map((c) => c / Math.hypot(p.x - v.x, p.z - v.z));
          while (!paved(v.x + lx * d, v.z + lz * d) && d < 1) d += 0.01;
          over = Math.max(over, d);
        }
      }
      expect(tyre, `${car.type} tyres off the asphalt`).toBe(0);
      // Was 0.66: the old cars pivoted over the corners. Measured from the car's middle out, so a corner counts a little
      // more than it sticks out. A left turn into a lane as narrow as the car still puts a nose over the far kerb.
      expect(over, `${car.type} body over a sidewalk`).toBeLessThan(0.25);
    }
  }, 60_000);

  it("keeps a city car on its own side of every street: the rear axle never crosses a centre line, the body only round a corner", () => {
    /** How far x, z is outside a ring of street centre lines (0 inside). */
    const outside = (ring: [number, number][], x: number, z: number) => {
      let inside = false;
      let edge = Infinity;
      ring.forEach(([ax, az], k) => {
        const [bx, bz] = ring[(k + 1) % ring.length];
        if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        edge = Math.min(edge, Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t));
      });
      return inside ? 0 : edge;
    };
    for (const { ring } of LOOPS) {
      const car = city.find((c) => outside(ring, pointAt(c.path, 0, { x: 0, z: 0 }).x, pointAt(c.path, 0, { x: 0, z: 0 }).z) === 0 && c.path.length < 2 * ring.reduce((sum, [x, z], k) => sum + Math.hypot(x - ring[(k + 1) % ring.length][0], z - ring[(k + 1) % ring.length][1]), 0))!;
      // an inside corner of the ring is a left turn: the car comes out over the centre line and drifts back over 12
      const left = ring.filter(([x, z], k) => {
        const [px, pz] = ring[(k + ring.length - 1) % ring.length];
        const [nx, nz] = ring[(k + 1) % ring.length];
        return (x - px) * (nz - z) - (z - pz) * (nx - x) < 0;
      });
      for (let s = 0; s < car.path.length; s += 0.1) {
        const { p, pts } = body(car, s);
        const half = MODELS[car.type].wheelbase / 2;
        const rear = { x: p.x - Math.sin(p.yaw) * half, z: p.z - Math.cos(p.yaw) * half };
        const drifting = left.some(([x, z]) => Math.hypot(rear.x - x, rear.z - z) < 18);
        // (but a left turn cuts its corner, as a real one does)
        const cutting = left.some(([x, z]) => Math.hypot(rear.x - x, rear.z - z) < 6);
        if (!cutting) expect(outside(ring, rear.x, rear.z), `rear axle ${rear.x.toFixed(2)},${rear.z.toFixed(2)}`).toBe(0);
        // The sill (the mirrors lean with the hill) keeps to its own side of the centre lines away from the corners.
        // Round one, and a car length past it, a real car's nose swings wide in a turn this tight, then straightens.
        for (const v of pts.slice(0, 52)) {
          const corner = ring.some(([x, z]) => Math.abs(v.x - x) < 5.2 && Math.abs(v.z - z) < 5.2);
          if (corner) continue;
          expect(outside(ring, v.x, v.z), `body ${v.x.toFixed(2)},${v.z.toFixed(2)}`).toBeLessThan(drifting ? 0.6 : 0.05);
        }
      }
    }
  });


  it.each(biggest.map((car, i) => [i, car] as const))("route %i: the body never snaps round, and on the streets points along the path from its rear axle", (_, car) => {
    const frames = drive(car);
    const half = MODELS[car.type].wheelbase / 2;
    let rate = 0;
    let jerk = 0;
    let slip = 0;
    for (let n = 2; n < frames.length; n++) {
      const [a, b, c] = [frames[n - 2].pose, frames[n - 1].pose, frames[n].pose];
      if ([a, b, c].some((q) => outOfSight(q.x, q.z)) || frames[n].v === 0) continue;
      const r1 = turnOf(a.yaw, b.yaw) * 60;
      const r2 = turnOf(b.yaw, c.yaw) * 60;
      rate = Math.max(rate, Math.abs(r2));
      jerk = Math.max(jerk, Math.abs(r2 - r1));
      // the rear axle rolls along the way the car points: no sideways slide
      const [bx, bz] = [b.x - Math.sin(b.yaw) * half, b.z - Math.cos(b.yaw) * half];
      const [cx, cz] = [c.x - Math.sin(c.yaw) * half, c.z - Math.cos(c.yaw) * half];
      if (Math.hypot(cx - bx, cz - bz) > 1e-3 && !onRoad(c.x, c.z)) slip = Math.max(slip, Math.abs(turnOf(Math.atan2(cx - bx, cz - bz), b.yaw + turnOf(b.yaw, c.yaw) / 2)));
    }
    expect(rate * DEG, "yaw rate, degrees a second").toBeLessThan(75); // was 122
    expect(jerk * DEG, "change of yaw rate frame to frame, degrees a second").toBeLessThan(10); // was 71: the old turns started and ended at once
    expect(slip * DEG, "rear axle sliding sideways, degrees").toBeLessThan(2); // the old body pivoted round its middle (55 degrees)
  });

  it.each(biggest.map((car, i) => [i, car] as const))("route %i: slows into each turn and speeds up out of it, never braking or pulling away hard", (_, car) => {
    const frames = drive(car);
    let slowest = Infinity;
    let accel = 0;
    let sideways = 0;
    for (let n = 1; n < frames.length; n++) {
      const [a, b] = [frames[n - 1], frames[n]];
      if (outOfSight(b.pose.x, b.pose.z)) continue;
      const rate = Math.abs(turnOf(a.pose.yaw, b.pose.yaw)) * 60;
      accel = Math.max(accel, Math.abs(b.v - a.v) * 60);
      sideways = Math.max(sideways, b.v * rate);
      if (rate * DEG > 60) slowest = Math.min(slowest, b.v);
      if (rate * DEG > 60) expect(b.v, `turning hard at ${b.pose.x.toFixed(1)},${b.pose.z.toFixed(1)}`).toBeLessThan(car.speed * 0.6);
    }
    expect(accel, "units a second squared").toBeLessThan(2); // the old cars took corners at full speed
    expect(sideways, "sideways acceleration, units a second squared").toBeLessThan(1.5);
    expect(Math.max(...frames.map((f) => f.v))).toBeCloseTo(car.speed, 3); // full speed on the straights
    expect(slowest).toBeLessThan(car.speed * 0.5);
  });

});

describe("the Roadster", () => {
  const roadster = cars.find((c) => c.type === "roadster")!;
  const along = (step: number) => Array.from({ length: Math.floor(roadster.path.length / step) }, (_, k) => carPose(roadster, k * step, newPose()));

  it("takes the long way round, through several districts, not round one block", () => {
    const poses = along(0.5);
    const xs = poses.map((p) => p.x);
    const zs = poses.map((p) => p.z);
    // a block is 16 east to west and 10 north to south
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(16 + 10);
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(5 * 10);
    // the blocks (between car streets) it drives along the edge of
    const cells = new Set(poses.map((p) => `${Math.floor((p.x + 67) / 16)},${Math.floor((p.z + 46) / 10)}`));
    expect(cells.size).toBeGreaterThanOrEqual(10);
    // more than a square's four corners: an inside corner, so a left turn too
    const ring = LOOPS.find((l) => l.cars === 1 && l.ring.length > 4)!.ring;
    expect(ring.length).toBeGreaterThan(4);
    expect(roadster.path.length).toBeGreaterThan(150);
  });

  it("never needs to stop for Cuso: his day never comes near its streets", () => {
    let nearest = Infinity;
    for (const { points } of PATHS) {
      for (const [x, , z] of points) for (const p of along(0.5)) nearest = Math.min(nearest, Math.hypot(x - p.x, z - p.z));
    }
    expect(nearest).toBeGreaterThan(4); // a car stops for him when he is up to 2.4 past its nose and 1.2 to its side
  });

  it("never passes between a chapter's camera and Cuso", () => {
    const poses = along(0.25);
    for (const ch of chapters) {
      const [cx, cy, cz] = ch.camera.position;
      const [sx, sy, sz] = ch.spot;
      for (let t = 0; t <= 1; t += 0.01) {
        const [x, y, z] = [cx + (sx - cx) * t, cy + (sy + 1 - cy) * t, cz + (sz - cz) * t];
        if (y - surfaceAt(x, z) > 1.4) continue; // over a car's roof
        const near = poses.some((p) => Math.hypot(p.x - x, p.z - z) < 2);
        expect(near, `${ch.id} at ${x.toFixed(1)},${z.toFixed(1)}`).toBe(false);
      }
    }
  });
});
