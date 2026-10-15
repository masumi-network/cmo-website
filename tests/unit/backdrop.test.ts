import { describe, expect, it } from "vitest";
import { Color, PerspectiveCamera, Vector3 } from "three";
import { chapters } from "@/content/day";
import { HEADLANDS, headlandHeight } from "@/lib/terrain";
import { lightingAt } from "@/lib/time";
import { fogRange } from "@/scene/atmosphere";
import { PORTRAIT_FOV, fitBand } from "@/scene/camera-rig";
import { WATER_Y } from "@/scene/bay";
import { ALCATRAZ, TREASURE_ISLAND } from "@/scene/islands";
import { GG } from "@/scene/landmarks";
import { insideLand } from "@/scene/layout";
import { BAY_ANCHORS, ISLAND } from "@/scene/roads";
import { rig } from "@/scene/shared";
import { horizonColor, skyAt } from "@/scene/sky";
import { MAST, PEAKS, RIDGES, TOWERS, backdropAt, backdropFade, backdropRegions, hazeColors, layerAt, ridgeColumns, townLights } from "@/scene/skyline";

const DEG = Math.PI / 180;
const regions = backdropRegions();
const lite = backdropRegions(true);
const vertices = (r: { position: number[] }) => Array.from({ length: r.position.length / 3 }, (_, i) => r.position.slice(i * 3, i * 3 + 3) as [number, number, number]);
const all = regions.flatMap(vertices);

/** Every chapter camera: desktop, and the phone rig at rest on the phones framing.test.ts checks (it may pull back). */
const PHONES = [
  { size: { width: 375, height: 667 }, band: [76, 499] as [number, number] },
  { size: { width: 390, height: 844 }, band: [76, 676] as [number, number] },
  { size: { width: 412, height: 915 }, band: [76, 747] as [number, number] },
];
const cameras = chapters.flatMap((c) => [
  { id: `${c.id} desktop`, hour: c.hour, pos: [...c.camera.position], tgt: [...c.camera.target] },
  ...PHONES.map(({ size, band }) => {
    rig.cuso.set(...c.spot);
    const pos = new Vector3(...c.phone.position);
    const hero: [number, number] = [Math.round(size.height * 0.57), Math.round(size.height * 0.91)];
    fitBand(pos, new Vector3(...c.phone.target), PORTRAIT_FOV, size, c.id === "arrive" ? hero : band);
    return { id: `${c.id} phone ${size.width}`, hour: c.hour, pos: pos.toArray(), tgt: [...c.phone.target] };
  }),
]);
const fogFar = Math.max(...chapters.map((c) => fogRange(Math.hypot(...c.camera.position.map((p, i) => p - c.camera.target[i])), false, skyAt(c.hour).fogScale).far));

const bearing = (from: readonly number[], x: number, z: number) => Math.atan2(x - from[0], -(z - from[2]));
const elevation = (from: readonly number[], x: number, y: number, z: number) => Math.atan2(y - from[1], Math.hypot(x - from[0], z - from[2]));
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

function desktopCamera(shot: { position: readonly number[]; target: readonly number[] }, size = { width: 1440, height: 900 }, fov = 35) {
  const cam = new PerspectiveCamera(fov, size.width / size.height, 0.2, 1200);
  cam.position.set(shot.position[0], shot.position[1], shot.position[2]);
  cam.lookAt(new Vector3(shot.target[0], shot.target[1], shot.target[2]));
  cam.updateMatrixWorld();
  return (x: number, y: number, z: number) => {
    const n = new Vector3(x, y, z).project(cam);
    return { x: ((n.x + 1) * size.width) / 2, y: ((1 - n.y) * size.height) / 2, front: n.z < 1 && n.z > -1 };
  };
}

describe("backdrop geometry", () => {
  it("is finite and small: under 10k triangles, the same on phones", () => {
    for (const set of [regions, lite]) {
      const tris = set.reduce((n, r) => n + r.index.length / 3, 0);
      expect(tris).toBeLessThan(10_000);
      expect(tris).toBeGreaterThan(3_000);
      for (const r of set) {
        expect(r.position.every(Number.isFinite), r.name).toBe(true);
        expect(r.normal.every(Number.isFinite), r.name).toBe(true);
        expect(r.index.every((i) => i < r.position.length / 3), r.name).toBe(true);
      }
    }
    expect(regions.map((r) => r.name).sort()).toEqual(["east", "marin", "north", "south"]);
  });

  it("stands on water past the modelled world: not over the city, the headlands, the islands or a bridge", () => {
    for (const [x, , z] of all) {
      expect(insideLand(x, z), `${x},${z}`).toBe(false);
      if (x > HEADLANDS.x0 && x < HEADLANDS.x1 && z > HEADLANDS.z0 && z < HEADLANDS.z1) expect(headlandHeight(x, z)).toBeLessThan(WATER_Y);
      expect(Math.hypot(x - ALCATRAZ.x, z - ALCATRAZ.z)).toBeGreaterThan(60);
      expect(Math.hypot(x - ISLAND.x, z - ISLAND.z)).toBeGreaterThan(60);
      for (const [cx, cz] of TREASURE_ISLAND) expect(Math.hypot(x - cx, z - cz)).toBeGreaterThan(60);
      // Golden Gate (x -80, z south..north) and the Bay Bridge (z 14, west anchorage..east anchorage)
      expect(Math.abs(x - GG.x) > 60 || z < GG.north - 60 || z > GG.south + 60).toBe(true);
      expect(Math.abs(z - 14) > 60 || x < BAY_ANCHORS[0] - 60 || x > BAY_ANCHORS[1] + 60).toBe(true);
    }
  });

  it("stays on the water plane (|x|, |z| < 690) and inside the far plane from every chapter camera", () => {
    for (const [x, , z] of all) {
      expect(Math.abs(x)).toBeLessThan(690);
      expect(Math.abs(z)).toBeLessThan(690);
      for (const c of cameras) expect(Math.hypot(x - c.pos[0], z - c.pos[2])).toBeLessThan(1150);
    }
  });

  it("starts past the story fog: every toe is farther than the fog's far distance from every chapter camera", () => {
    expect(fogFar).toBeGreaterThan(250);
    for (const ridge of RIDGES)
      for (const col of ridgeColumns(ridge)) {
        const [x, , z] = col.points[0];
        for (const c of cameras) expect(Math.hypot(x - c.pos[0], z - c.pos[2]), `${ridge.name} toe from ${c.id}`).toBeGreaterThan(fogFar);
      }
  });

  it("is a ridge, not a card: every cross-section rises from under the water to the crest and falls behind it", () => {
    for (const ridge of RIDGES)
      for (const col of ridgeColumns(ridge)) {
        const ys = col.points.map((p) => p[1]);
        const top = ys.indexOf(Math.max(...ys));
        expect(ys[0], ridge.name).toBeLessThan(WATER_Y);
        for (let i = 1; i <= top; i++) expect(ys[i], ridge.name).toBeGreaterThanOrEqual(ys[i - 1]);
        for (let i = top + 1; i < ys.length; i++) expect(ys[i], ridge.name).toBeLessThanOrEqual(ys[i - 1]);
        if (ys[col.crest] > WATER_Y) expect(top, ridge.name).toBe(col.crest); // not at the drowned ends
        // with depth: the crest stands well back from the toe
        const [tx, , tz] = col.points[0];
        const [cx, , cz] = col.points[col.crest];
        expect(Math.hypot(cx - tx, cz - tz), ridge.name).toBeGreaterThan(30);
      }
  });

  it("tapers into the water at both ends", () => {
    for (const ridge of RIDGES) {
      const cols = ridgeColumns(ridge);
      for (const col of [cols[0], cols[cols.length - 1]]) for (const [, y] of col.points) expect(y, ridge.name).toBeLessThan(WATER_Y);
      const peak = Math.max(...cols.map((c) => c.points[c.crest][1]));
      expect(peak, ridge.name).toBeGreaterThan(15);
    }
  });

  it("faces the city: the slopes in front of each crest turn toward the chapter cameras", () => {
    for (const r of regions) {
      let toward = 0;
      let away = 0;
      for (let t = 0; t < r.index.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((k) => r.index[t + k] * 3);
        const p = [0, 1, 2].map((k) => (r.position[a + k] + r.position[b + k] + r.position[c + k]) / 3);
        const e1 = [0, 1, 2].map((k) => r.position[b + k] - r.position[a + k]);
        const e2 = [0, 1, 2].map((k) => r.position[c + k] - r.position[a + k]);
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        // the winding agrees with the shading normal
        const vn = [0, 1, 2].map((k) => r.normal[a + k]);
        expect(n[0] * vn[0] + n[1] * vn[1] + n[2] * vn[2]).toBeGreaterThanOrEqual(-1e-6);
        const v = [-15 - p[0], 8 - p[1], 10 - p[2]];
        if (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] > 0) toward++;
        else away++;
      }
      expect(toward / (toward + away), r.name).toBeGreaterThan(0.6);
    }
  });
});

describe("what the chapter cameras see", () => {
  const crests = RIDGES.flatMap((r) => ridgeColumns(r).map((c) => ({ ridge: r, p: c.points[c.crest] })));
  const tall = [...crests.map((c) => c.p), [MAST.x, MAST.y + MAST.height, MAST.z] as const, ...TOWERS.map((t) => [t.x, t.h, t.z] as const)];

  it("Mount Tam shows over the headland crest along the same bearing, in frame, from the 06:00, 07:00 and 12:00 cameras", () => {
    const tam = PEAKS.tam;
    const top = crests.filter((c) => c.ridge.name === "tam").reduce((a, b) => (Math.hypot(b.p[0] - tam.x, b.p[2] - tam.z) < Math.hypot(a.p[0] - tam.x, a.p[2] - tam.z) ? b : a)).p;
    expect(top[1]).toBeGreaterThan(55);
    for (const id of ["arrive", "learn", "ads"]) {
      const ch = chapters.find((c) => c.id === id)!;
      const pos = ch.camera.position;
      const d = Math.hypot(top[0] - pos[0], top[2] - pos[2]);
      let headland = -Infinity;
      for (let t = 1; t < d; t += 1) {
        const x = pos[0] + ((top[0] - pos[0]) * t) / d;
        const z = pos[2] + ((top[2] - pos[2]) * t) / d;
        if (x > HEADLANDS.x0 && x < HEADLANDS.x1 && z > HEADLANDS.z0 && z < HEADLANDS.z1) headland = Math.max(headland, elevation(pos, x, headlandHeight(x, z), z));
      }
      expect(headland, id).toBeGreaterThan(-Infinity); // the headlands are in front
      expect(elevation(pos, ...top) - headland, id).toBeGreaterThan(1 * DEG);
      const s = desktopCamera(ch.camera)(...top);
      expect(s.front && s.x > 0 && s.x < 1440 && s.y > 0 && s.y < 900, `${id}: ${JSON.stringify(s)}`).toBe(true);
    }
  });

  it("never hides the sun: at least 3 degrees under it wherever it is in or near the frame, at each chapter's hour and its neighbours'", () => {
    let checked = 0;
    chapters.forEach((ch, i) => {
      const hours = [chapters[i - 1]?.hour, ch.hour, chapters[i + 1]?.hour].filter((h) => h !== undefined);
      for (const hour of hours) {
        const L = lightingAt(hour);
        if (L.elevation <= 0) continue;
        const sun = Math.atan2(Math.sin(L.azimuth * DEG), -Math.cos(L.azimuth * DEG));
        for (const c of cameras.filter((c) => c.id.startsWith(ch.id))) {
          // half the frame's width (the phone is narrower) and 15 degrees of slack for the boom and the flights
          const half = (c.id.includes("phone") ? 13 : 27) * DEG + 15 * DEG;
          if (angleBetween(bearing(c.pos, c.tgt[0], c.tgt[2]), sun) > half) continue;
          checked++;
          for (const p of tall)
            if (angleBetween(bearing(c.pos, p[0], p[2]), sun) < 3 * DEG)
              expect(elevation(c.pos, p[0], p[1], p[2]) / DEG, `${c.id} at ${hour}`).toBeLessThan(L.elevation - 3);
        }
      }
    });
    expect(checked).toBeGreaterThan(3); // 06:00 and the morning shots look toward the sun
  });

  it("09:00: the Sutro-like mast stands on the south ridge in the desktop frame, in the sky between the card and the trees", () => {
    const social = chapters.find((c) => c.id === "social")!;
    const px = desktopCamera(social.camera);
    const top = px(MAST.x, MAST.y + MAST.height, MAST.z);
    const foot = px(MAST.x, MAST.y, MAST.z);
    expect(top.front).toBe(true);
    expect(top.x).toBeGreaterThan(470); // the card column ends at 458
    expect(top.x).toBeLessThan(600); // clear sky: the palm and the trees stand from about 560 to the mural wall
    expect(top.y).toBeGreaterThan(80);
    expect(foot.y).toBeLessThan(620); // above the street's end
    expect(top.y).toBeLessThan(foot.y - 60); // tall enough to read
    // the south ridge runs right across that gap
    const south = crests.filter((c) => c.ridge.region === "south").map((c) => px(...c.p)).filter((s) => s.front && s.y > 0 && s.y < 900);
    for (let x = 470; x < 960; x += 40) expect(south.some((s) => s.x >= x && s.x < x + 40), `column ${x}`).toBe(true);
  });

  it("the East Bay and North Bay fill most of the horizon at 22:00 (desktop) and in the finale (phone)", () => {
    const night = chapters.find((c) => c.id === "night")!;
    const join = chapters.find((c) => c.id === "join")!;
    const frames = [
      { id: "night", px: desktopCamera(night.camera), size: { width: 1440, height: 900 } },
      { id: "join phone", px: desktopCamera(join.phone, { width: 390, height: 844 }, 52), size: { width: 390, height: 844 } },
    ];
    for (const f of frames) {
      const seen = crests.filter((c) => c.ridge.region === "east" || c.ridge.region === "north").map((c) => f.px(...c.p)).filter((s) => s.front && s.y > 0 && s.y < f.size.height);
      const step = f.size.width / 30;
      let filled = 0;
      for (let x = 0; x < f.size.width; x += step) if (seen.some((s) => s.x >= x && s.x < x + step)) filled++;
      expect(filled / 30, f.id).toBeGreaterThan(0.75);
    }
  });
});

describe("backdrop look through the day", () => {
  const rgb = (c: Color) => [c.r, c.g, c.b];
  const blueness = (c: Color) => c.b / (c.r + c.g + c.b);

  it("gets hazier and bluer with distance at every hour", () => {
    expect(layerAt(-15, 300)).toBeLessThan(layerAt(-15, 600));
    for (let h = 6; h <= 30; h += 0.5) {
      const k = backdropAt(h);
      expect(k.hazeFar, `${h}`).toBeGreaterThan(k.hazeNear);
      expect(k.hazeNear, `${h}`).toBeGreaterThan(0.2);
      expect(k.hazeFar, `${h}`).toBeLessThan(1);
      const L = lightingAt(h);
      const c = hazeColors(new Color(L.fog), new Color(horizonColor(L, skyAt(h))), new Color(L.skyTop), k.blue);
      expect(blueness(c.far), `${h}`).toBeGreaterThanOrEqual(blueness(c.near) - 0.005);
      expect(rgb(c.toe)).toEqual(rgb(new Color(L.fog)));
    }
  });

  it("never pops while scrolling (every 0.05 h), and the finale is 06:00", () => {
    for (let h = 6; h < 30; h += 0.05) {
      const a = backdropAt(h);
      const b = backdropAt(h + 0.05);
      for (const k of Object.keys(a) as (keyof typeof a)[]) expect(Math.abs(b[k] - a[k]), `${k} at ${h.toFixed(2)}`).toBeLessThan(0.03);
    }
    expect(backdropAt(30)).toEqual(backdropAt(6));
  });

  it("glows when backlit at sunrise and sunset more than at noon", () => {
    expect(backdropAt(6).glow).toBeGreaterThan(backdropAt(12).glow * 2);
    expect(backdropAt(18).glow).toBeGreaterThan(backdropAt(12).glow * 2);
  });

  it("lights the towns only at night", () => {
    for (let h = 6; h <= 30; h += 0.25) expect(backdropAt(h).lights, `${h}`).toBeLessThanOrEqual(lightingAt(h).night + 1e-9);
    for (const h of [6, 7, 9, 12, 15, 18, 30]) expect(backdropAt(h).lights).toBe(0);
    expect(backdropAt(22).lights).toBe(1);
  });

  it("is full in every story shot and gone in Explore", () => {
    for (const c of chapters)
      for (const s of [c.camera, c.phone]) expect(backdropFade(Math.hypot(...s.position.map((p, i) => p - s.target[i]))), c.id).toBe(1);
    expect(backdropFade(120)).toBe(0);
    expect(backdropFade(400)).toBe(0);
  });
});

describe("town lights", () => {
  const lights = townLights();
  const at = (i: number) => [lights.position[i * 3], lights.position[i * 3 + 1], lights.position[i * 3 + 2]];

  it("are deterministic and few: at most 3000, fewer on phones", () => {
    expect(townLights().position).toEqual(lights.position);
    expect(lights.count).toBeLessThanOrEqual(3000);
    expect(lights.count).toBeGreaterThan(1500);
    expect(townLights(true).count).toBeLessThanOrEqual(2500);
    expect(lights.position.every(Number.isFinite)).toBe(true);
  });

  it("sit on their layer's land, under the crest: never in the sky or on the water", () => {
    // every ground light just above a backdrop triangle
    const tris = regions.flatMap((r) => {
      const out: number[][][] = [];
      for (let t = 0; t < r.index.length; t += 3) out.push([0, 1, 2].map((k) => r.position.slice(r.index[t + k] * 3, r.index[t + k] * 3 + 3)));
      return out;
    });
    const under = (x: number, z: number) => {
      let best = -Infinity;
      for (const [a, b, c] of tris) {
        const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        if (Math.abs(d) < 1e-9) continue;
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d;
        const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d;
        if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
        best = Math.max(best, u * a[1] + v * b[1] + (1 - u - v) * c[1]);
      }
      return best;
    };
    for (let i = 0; i < lights.count; i += 7) {
      const [x, y, z] = at(i);
      if (lights.kind[i] === 0) {
        const ground = under(x, z);
        expect(y - ground, `${x},${y},${z}`).toBeGreaterThan(0);
        expect(y - ground, `${x},${y},${z}`).toBeLessThan(1.5);
        expect(ground).toBeGreaterThan(WATER_Y);
      } else if (lights.kind[i] === 1) {
        expect(TOWERS.some((t) => Math.abs(x - t.x) <= t.w / 2 + 0.3 && Math.abs(z - t.z) <= t.d / 2 + 0.3 && y > 0 && y <= t.h)).toBe(true);
      }
    }
  });

  it("are densest on the flats", () => {
    const east = RIDGES.find((r) => r.name === "east-bay")!;
    const flats = ridgeColumns(east).map((c) => c.points[east.flats ?? 0]);
    let onFlats = 0;
    let elsewhere = 0;
    for (let i = 0; i < lights.count; i++) {
      if (lights.kind[i] !== 0) continue;
      const [x, , z] = at(i);
      if (flats.some(([fx, , fz]) => Math.abs(z - fz) < 3 && x > 320 && x < fx + 1)) onFlats++;
      else elsewhere++;
    }
    expect(onFlats).toBeGreaterThan(elsewhere * 0.8);
  });

  it("only the mast blinks: two red lights on its top", () => {
    const mast = [...lights.kind.keys()].filter((i) => lights.kind[i] === 2);
    expect(mast).toHaveLength(2);
    for (const i of mast) {
      const [x, y, z] = at(i);
      expect(Math.hypot(x - MAST.x, z - MAST.z)).toBeLessThan(6);
      expect(y).toBeGreaterThan(MAST.y + MAST.height - 2);
    }
  });
});
