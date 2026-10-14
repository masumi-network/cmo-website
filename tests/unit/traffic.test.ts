import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { surfaceAt } from "@/lib/terrain";
import { WALK_X, WALK_Z, X_STREETS, Z_STREETS, insideLand } from "@/scene/grid";
import { MAX_GRADE, ROADS, ROAD_WIDTH, onRoad } from "@/scene/roads";
import { type Car, type Pose, MODELS, carPose, driveCars, makeTraffic, outOfSight, pointAt, spacing, wheelAngle } from "@/scene/traffic";

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
        const near = (cs: number[], v: number) => cs.some((c) => Math.abs(v - c) < 2); // a corner
        const turning = near(carX, p.x) && near(carZ, p.z);
        expect(inLane(carX, p.x) || inLane(carZ, p.z) || turning, `${p.x},${p.z}`).toBe(true);
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
    // radius 6 bend at full grade: on the inside lane its axles are not square to the road). Springs take that up.
    ["bridge", bridge, 0.065],
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
    expect(rolled[0]).toBeCloseTo(5 * cars[0].speed, 3);
    expect(wheelAngle(rolled[0], radius)).toBeCloseTo((5 * cars[0].speed) / radius, 2);
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
    for (const path of routes) {
      const pts = samples(path);
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [onRoad(pts[i - 1].x, pts[i - 1].z), onRoad(pts[i].x, pts[i].z)];
        if (!next(pts, i) || !a || !b || a.name !== b.name || Math.abs(b.s - a.s) < 0.05) continue;
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
        expect(Math.abs(pts[i].y - pts[i - 6].y) / Math.abs(b.s - a.s), b.name).toBeLessThanOrEqual(MAX_GRADE + 0.005);
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
        const junction = X_STREETS.some((sx) => Math.abs(x - sx) < 2.6) && Z_STREETS.some((sz) => Math.abs(z - sz) < 2.6);
        expect(inLane(carX, x) || inLane(carZ, z) || junction, `${x},${z}`).toBe(true);
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
