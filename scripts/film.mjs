// "One day in Cuso's City": a scripted drone film of the 3D city, rendered
// frame by frame on the real GPU. The script is docs/film/script.md; each shot
// below is one row of it.
//
// Needs a build with the film hook (docs/film/film-hook.patch) served at BASE.
// Usage:
//   node scripts/film.mjs stills <out-dir> [shot,shot]   K frames of each shot (default 3) as jpg
//   node scripts/film.mjs render <out-dir> [shot,shot]   one mp4 per shot, then film.mp4 (all shots)
//   node scripts/film.mjs join <out-dir>                 film.mp4 from the shots already rendered there
// Env: BASE (http://localhost:3200), FPS (24), W x H (1280x720, portrait 1080x1920), SCALE (device
// pixels per CSS pixel, 2 for 4K from 1920x1080), SUB (motion blur samples per frame, 1 = none),
// PORTRAIT=1 (9:16, wider lens, titles clear of app captions).
import { chromium } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const [mode, out, only] = process.argv.slice(2);
if (!["stills", "render", "join"].includes(mode) || !out) throw new Error("usage: node scripts/film.mjs stills|render|join <out-dir> [shot,shot]");
const BASE = process.env.BASE ?? "http://localhost:3200";
const FPS = Number(process.env.FPS ?? 24);
const PORTRAIT = process.env.PORTRAIT === "1";
const W = Number(process.env.W ?? (PORTRAIT ? 1080 : 1280));
const H = Number(process.env.H ?? (PORTRAIT ? 1920 : 720));
const SCALE = Number(process.env.SCALE ?? 1);
const SUB = mode === "render" ? Number(process.env.SUB ?? 1) : 1;
const SHUTTER = 0.5; // 180 degrees: the blur spans half a frame, like a film camera

// ---- camera maths ---------------------------------------------------------

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const EASE = {
  linear: (t) => t,
  inout: (t) => lerp(t, smooth(t), 0.7),
  out: (t) => 1 - (1 - t) * (1 - t) * 0.5 - (1 - t) * 0.5, // moving at the start, settles at the end
};

/** Catmull-Rom through `pts` (arrays of numbers) at u (0..1). */
function spline(pts, u) {
  const n = pts.length - 1;
  const x = Math.min(n - 1e-9, Math.max(0, u * n));
  const i = Math.floor(x);
  const t = x - i;
  const p0 = pts[Math.max(0, i - 1)];
  const [p1, p2] = [pts[i], pts[i + 1]];
  const p3 = pts[Math.min(n, i + 2)];
  return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t));
}

/**
 * Camera round `spot`: `yaw` degrees (0 = south, 90 = east), `dist` away, `up` above, looking `look`
 * above it and `side` units to the right of it.
 */
function orbit(spot, { yaw, dist, up, look = 1.2, side = 0 }) {
  const a = (yaw * Math.PI) / 180;
  const [sx, sz] = [Math.sin(a), Math.cos(a)];
  return { pos: [spot[0] + sx * dist, spot[1] + up, spot[2] + sz * dist], tgt: [spot[0] + sz * side, spot[1] + look, spot[2] - sx * side] };
}
/** An orbit move: from one orbit pose to another, through any in between. */
const move = (spot, ...poses) => poses.map((p) => orbit(spot, p));

// ---- the script ---------------------------------------------------------------

/** Chapter index by id, and its spot, read from the page. */
let CH = [];
const spot = (id) => CH.find((c) => c.id === id).spot;
const index = (id) => CH.findIndex((c) => c.id === id);

// Cut to "Sunny SF Drone Flight" (Flow Music) sped to 120 BPM: every cut lands on a beat, the drop on Cuso (0:14),
// the breakdown on the night pier (0:40) and the big drop on the dawn pull-back and end card (0:46).
const SHOTS = () => [
  {
    id: "gate",
    secs: 14,
    progress: 0,
    fov: 40,
    ease: "out",
    // Low over the Pacific through Karl the fog, up over the Golden Gate's deck, then a bank right to the city.
    keys: [
      { pos: [-270, 3, -106], tgt: [-80, 13, -103] },
      { pos: [-185, 6, -103], tgt: [-80, 17, -101] },
      { pos: [-128, 15, -102], tgt: [-60, 21, -92] },
      { pos: [-80, 27, -101], tgt: [-4, 10, -44] },
      { pos: [-56, 33, -82], tgt: [0, 6, -20] },
      { pos: [-34, 30, -56], tgt: [8, 6, -10] },
    ],
    titles: [
      { from: 1.5, to: 5.5, kind: "label", text: "San Francisco, 06:00" },
      { from: 9.6, to: 14, kind: "big", text: "Marketing, on autopilot." },
    ],
  },
  {
    id: "arrive",
    secs: 4,
    fov: [40, 33], // a punch in
    ease: "out",
    keys: () => move(spot("arrive"), { yaw: 58, dist: 12, up: 3.4, look: 1.6 }, { yaw: 30, dist: 6.6, up: 1.8, look: 1.5 }),
    titles: [{ from: 0.3, to: 4, kind: "big", text: "Meet Cuso, your AI CMO." }],
  },
  {
    id: "park",
    secs: 4,
    progress: () => index("learn"),
    fov: [44, 38],
    ease: "linear",
    // Golden Gate Park: a dive from over Ocean Beach, then a glide just over the trees towards downtown.
    keys: [
      { pos: [-84, 17, 30], tgt: [-56, 1, 19] },
      { pos: [-72, 8, 21], tgt: [-46, 2, 19] },
      { pos: [-60, 5.6, 19.2], tgt: [-36, 2.4, 19] },
      { pos: [-50, 6.4, 19], tgt: [-28, 3, 19] },
    ],
    titles: [{ from: 0.4, to: 3.8, kind: "label", text: "Golden Gate Park, 07:00" }],
  },
  chapterShot("learn", 3, { yaw: 44, dist: 9.5, up: 2.4 }, { yaw: 8, dist: 6.2, up: 1.1 }),
  chapterShot("social", 3, { yaw: 100, dist: 9.5, up: 2.6 }, { yaw: 58, dist: 6.2, up: 1.1 }),
  chapterShot(
    "ads",
    3,
    // upright, aim right of him so the billboard stays in frame
    { yaw: 2, dist: 11, up: -0.5, side: PORTRAIT ? 1.1 : 0 },
    { yaw: 22, dist: 8.4, up: -1.2, look: 1.6, side: PORTRAIT ? 1.1 : 0 },
  ),
  { ...chapterShot("seo", 4, { yaw: 300, dist: 17, up: -18, look: -7 }, { yaw: 272, dist: 9.5, up: 3.6, look: 0.4 }), ease: "inout" },
  chapterShot("newsletter", 5, { yaw: 90, dist: 34, up: 14, look: 5 }, { yaw: 78, dist: 19, up: 6, look: 2.4 }, { yaw: 66, dist: 13, up: 4, look: 1.7 }, { yaw: 42, dist: 7.5, up: 0.9, look: 1.5 }),
  chapterShot("night", 6, { yaw: 300, dist: 5.8, up: 1, look: 1.2 }, { yaw: 308, dist: 6.6, up: 2.8, look: 1.1 }, { yaw: 312, dist: 7.5, up: 5.8, look: 1 }),
  {
    id: "join",
    secs: 6,
    progress: () => index("join"),
    fov: 35,
    ease: "inout",
    keys: () => move(spot("join"), { yaw: 332, dist: 6, up: 1.8, look: 1.4 }, { yaw: 322, dist: 30, up: 13, look: 2 }, { yaw: 312, dist: 64, up: 31, look: -2 }),
    titles: [{ from: 0.6, to: 8, kind: "end", text: "Your city. Your CMO.", sub: "Join the waitlist at cmo.xyz" }],
  },
];

/** A chapter: Cuso at his spot, the chapter's hour, a quick move round him that settles, its time and title. */
function chapterShot(id, secs, ...poses) {
  return {
    id,
    secs,
    progress: () => index(id),
    fov: [37, 34],
    ease: "out",
    keys: () => move(spot(id), ...poses),
    titles: () => {
      const c = CH[index(id)];
      return [{ from: 0.2, to: secs - 0.15, kind: "chapter", label: c.time, text: c.title }];
    },
  };
}

// ---- titles (drawn over the canvas, in the site's type and colours) --------

const TITLE_CSS = `
  body * { visibility: hidden !important; }
  canvas, #film, #film * { visibility: visible !important; }
  #film { position: fixed; inset: 0; z-index: 99; pointer-events: none; font-family: var(--font-geist-sans), system-ui, sans-serif; color: #f7f6f2; }
  #film:has(.label, .big, .chapter) { background: linear-gradient(to top, rgb(17 17 20 / 0.5), transparent 45%); }
  #film .t { position: absolute; left: 5vw; bottom: 5vw; text-shadow: 0 0.15vw 1.9vw rgb(17 17 20 / 0.45); }
  #film .label { font-family: var(--font-geist-mono), monospace; font-size: 1.4vw; letter-spacing: 0.04em; }
  #film .big { font-size: 4.4vw; font-weight: 600; letter-spacing: -0.02em; }
  #film .chapter .time { font-family: var(--font-geist-mono), monospace; font-size: 1.25vw; opacity: 0.9; margin-bottom: 0.5vw; }
  #film .chapter .title { font-size: 3.45vw; font-weight: 600; letter-spacing: -0.015em; }
  #film .end { left: 0; right: 0; padding: 9vw 0; background: radial-gradient(closest-side, rgb(17 17 20 / 0.35), transparent); bottom: auto; top: 50%; transform: translateY(-50%); text-align: center; }
  #film .end .title { font-size: 5vw; font-weight: 600; letter-spacing: -0.02em; }
  #film .end .sub { display: inline-block; margin-top: 1.56vw; font-size: 1.56vw; padding: 0.8vw 1.56vw; border-radius: 999px; background: #3d5afe; text-shadow: none; }
  @media (orientation: portrait) {
    #film:has(.label, .big, .chapter) { background: linear-gradient(to top, transparent 12%, rgb(17 17 20 / 0.45) 24%, transparent 50%); }
    #film .t { left: 7vw; right: 7vw; bottom: 26vh; }
    #film .label { font-size: 3vw; }
    #film .big { font-size: 8.5vw; line-height: 1.1; }
    #film .chapter .time { font-size: 2.8vw; margin-bottom: 1vw; }
    #film .chapter .title { font-size: 7vw; line-height: 1.1; }
    #film .end { left: 0; right: 0; bottom: auto; padding: 20vw 0; }
    #film .end .title { font-size: 10vw; line-height: 1.1; }
    #film .end .sub { font-size: 3.6vw; margin-top: 4vw; padding: 2vw 4vw; }
  }
`;

function titleHtml(t) {
  if (t.kind === "label") return `<div class="t label">${t.text}</div>`;
  if (t.kind === "big") return `<div class="t big">${t.text}</div>`;
  if (t.kind === "chapter") return `<div class="t chapter"><div class="time">${t.label}</div><div class="title">${t.text}</div></div>`;
  return `<div class="t end"><div class="title">${t.text}</div><div class="sub">${t.sub}</div></div>`;
}

/** What the title layer shows at second `s` of a shot: html and opacity (0.35 s fades). */
function titleAt(titles, s) {
  for (const t of titles) {
    if (s < t.from || s > t.to) continue;
    const o = Math.min(1, (s - t.from) / 0.35, (t.to - s) / 0.35);
    return { html: titleHtml(t), opacity: smooth(Math.max(0, o)) };
  }
  return { html: "", opacity: 0 };
}

// ---- rendering --------------------------------------------------------------

if (mode !== "join") {
  const browser = await chromium.launch({ headless: false, args: ["--use-angle=metal", "--window-position=-2400,0"] });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
  await page.addInitScript(() => Object.assign(window, { __filmMode: true })); // keep full resolution however slow it gets
  await page.goto(BASE);
  await page.waitForSelector('[data-scene="ready"]', { timeout: 180_000 });
  await page.addStyleTag({ content: TITLE_CSS });
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<div id="film"></div>'));
  CH = await page.evaluate(() => window.__chapters.map((c) => ({ id: c.id, spot: [...c.spot], time: c.time, title: c.title })));
  // From here time only moves when we say so: every frame is exactly 1/FPS later.
  await page.clock.install();

  const shots = SHOTS().filter((s) => !only || only.split(",").includes(s.id));
  const call = (v) => (typeof v === "function" ? v() : v);
  /** A wider lens upright, so a 9:16 frame still holds the place. */
  /** The lens at u (0..1): `fov` is fixed or [from, to] (a punch in); wider upright, so a 9:16 frame still holds the place. */
  const fovOf = (shot, u) => {
    const f = Array.isArray(shot.fov) ? lerp(shot.fov[0], shot.fov[1], u) : shot.fov;
    return PORTRAIT ? Math.min(64, f * 1.55) : f;
  };

  /** Put the camera and titles where they are at frame `f` (fractional for motion blur samples). */
  async function pose(shot, keys, titles, f, n) {
    const u = EASE[shot.ease ?? "inout"](n === 1 ? 0 : Math.min(1, f / (n - 1)));
    const pos = spline(keys.map((k) => k.pos), u);
    const tgt = spline(keys.map((k) => k.tgt), u);
    const title = titleAt(titles, Math.round(f) / FPS);
    await page.evaluate(
      ({ pos, tgt, fov, title }) => {
        window.__film = { pos, tgt, fov };
        const el = document.getElementById("film");
        if (el.dataset.html !== title.html) el.innerHTML = el.dataset.html = title.html;
        el.style.opacity = String(title.opacity);
      },
      { pos, tgt, fov: fovOf(shot, u), title },
    );
  }

  /** ffmpeg reading jpgs on stdin: SUB samples blend into one frame. */
  function encoder(file) {
    const blur = SUB > 1 ? [`tmix=frames=${SUB}`, `select='eq(mod(n,${SUB}),${SUB - 1})'`, `setpts=N/(${FPS}*TB)`] : [];
    const vf = [...blur, "format=yuv420p"].join(",");
    const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS * SUB), "-i", "-", "-vf", vf, "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "14", file], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise((ok, fail) => ff.on("close", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${code}`)))));
    return {
      write: (buf) => new Promise((ok) => (ff.stdin.write(buf) ? ok() : ff.stdin.once("drain", ok))),
      end: () => (ff.stdin.end(), done),
    };
  }
  const grab = () => page.screenshot({ type: "jpeg", quality: 95 });

  for (const shot of shots) {
    const keys = call(shot.keys);
    const titles = call(shot.titles) ?? [];
    const progress = call(shot.progress) ?? 0;
    const n = Math.round(shot.secs * FPS);
    // Cut to the chapter (Cuso is already there, the light is that hour), let it settle.
    // `lead`: more seconds first, so moving things (the cable car) are where the shot wants them.
    await page.evaluate((p) => {
      const city = window.__city.getState();
      city.jumpTo(Math.floor(p), 0, true);
      city.setProgress(p);
    }, progress);
    await pose(shot, keys, titles, 0, n);
    for (let i = 0; i < 4 + 2 * (shot.lead ?? 0); i++) await page.clock.runFor(500);

    if (mode === "stills") {
      const dir = `${out}/${shot.id}`;
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const K = Number(process.env.K ?? 3);
      let last = 0;
      for (const f of [...Array(K).keys()].map((k) => Math.round((k * (n - 1)) / (K - 1)))) {
        if (f > 0) await page.clock.runFor(((f - last) * 1000) / FPS);
        last = f;
        await pose(shot, keys, titles, f, n);
        await page.clock.runFor(1000 / FPS);
        await page.screenshot({ path: `${dir}/${String(f).padStart(5, "0")}.jpg`, type: "jpeg", quality: 92 });
      }
      console.log(`${shot.id}: ${K} stills`);
      continue;
    }

    const enc = encoder(`${out}/${shot.id}.mp4`);
    for (let f = 0; f < n; f++) {
      // the frame's first sample moves time on one frame; the others only move the camera
      await pose(shot, keys, titles, f, n);
      await page.clock.runFor(1000 / FPS);
      await enc.write(await grab());
      for (let k = 1; k < SUB; k++) {
        await pose(shot, keys, titles, f + (k * SHUTTER) / SUB, n);
        await page.evaluate(() => window.__draw());
        await enc.write(await grab());
      }
    }
    await enc.end();
    console.log(`${shot.id}: ${n} frames x ${SUB} samples`);
  }
  await browser.close();
}

// One film: the shots in order, hard cuts on the bar, in from and out to black.
if (mode === "join" || (mode === "render" && !only)) {
  const all = SHOTS();
  const inputs = all.flatMap((s) => ["-i", `${out}/${s.id}.mp4`]);
  const total = all.reduce((t, s) => t + s.secs, 0);
  const chain = `${all.map((_, i) => `[${i}:v]`).join("")}concat=n=${all.length}:v=1:a=0,fade=t=in:st=0:d=1.2,fade=t=out:st=${total - 1.5}:d=1.5[f]`;
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", ...inputs, "-filter_complex", chain, "-map", "[f]", "-c:v", "libx264", "-preset", "slow", "-pix_fmt", "yuv420p", "-crf", "16", "-movflags", "+faststart", `${out}/film.mp4`]);
  console.log(`${out}/film.mp4 (${total} s)`);
}
