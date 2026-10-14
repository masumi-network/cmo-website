// Tree textures, drawn once on canvases at load (no files to fetch). The leaf
// atlas holds leaf-cluster sprites with alpha for each kind (plane, ficus,
// cypress) and two palm frond strips; the bark atlas holds a tiling column per
// kind and a cast-iron tree grate. Layout in tree-models.ts (LEAF, BARK).

import { CanvasTexture, ClampToEdgeWrapping, RepeatWrapping, SRGBColorSpace } from "three";
import { BARK, BARK_COLUMN, LEAF } from "./tree-models";

function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}
type Rand = () => number;
type Ctx = CanvasRenderingContext2D;

function texture(width: number, height: number, draw: (ctx: Ctx) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;
/** Inside a sprite of size S at x0, y0: draws f with the canvas moved there, clipped to it. */
function within(ctx: Ctx, x0: number, y0: number, w: number, h: number, f: () => void) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.translate(x0, y0);
  f();
  ctx.restore();
}

// ---------- Leaves ----------

/** A London plane leaf: five pointed lobes, palmate veins, base at 0,0, tip up the -y axis. */
function planeLeaf(ctx: Ctx, size: number, fill: string, vein: string) {
  const lobes: [number, number][] = [[-82, 0.5], [-42, 0.85], [0, 1], [42, 0.85], [82, 0.5]];
  const c = { x: 0, y: -0.38 * size };
  const at = (deg: number, r: number) => [c.x + Math.sin((deg * Math.PI) / 180) * r * size, c.y - Math.cos((deg * Math.PI) / 180) * r * size] as const;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(...at(-125, 0.3));
  lobes.forEach(([deg, len], i) => {
    ctx.lineTo(...at(deg - 13, len * 0.42));
    ctx.lineTo(...at(deg, len * 0.62));
    ctx.lineTo(...at(deg + 13, len * 0.42));
    if (i < lobes.length - 1) ctx.lineTo(...at((deg + lobes[i + 1][0]) / 2, 0.24));
  });
  ctx.lineTo(...at(125, 0.3));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  // One half a little lighter: the leaf is folded along its midrib.
  const g = ctx.createLinearGradient(-size * 0.5, 0, size * 0.5, 0);
  g.addColorStop(0, "rgba(255,255,220,0.12)");
  g.addColorStop(0.5, "rgba(255,255,220,0)");
  g.addColorStop(1, "rgba(0,20,0,0.18)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = vein;
  ctx.lineWidth = Math.max(1, size * 0.025);
  for (const [deg, len] of lobes) {
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(...at(deg, len * 0.55));
    ctx.stroke();
  }
}

/** A small pointed oval leaf (ficus), base at 0,0, tip up -y, a midrib and a glossy edge. */
function ovalLeaf(ctx: Ctx, len: number, wide: number, fill: string) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(wide, -len * 0.45, 0, -len);
  ctx.quadraticCurveTo(-wide, -len * 0.45, 0, 0);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,230,0.18)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(wide * 0.3, -len * 0.2);
  ctx.quadraticCurveTo(wide * 0.75, -len * 0.5, 0, -len * 0.92);
  ctx.stroke();
  ctx.strokeStyle = "rgba(20,30,10,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -len * 0.05);
  ctx.lineTo(0, -len * 0.9);
  ctx.stroke();
}

/** London plane: about twenty leaves on stalks round a twig, mid green, some lit yellow-green. */
function planeSprite(ctx: Ctx, rand: Rand) {
  const S = 256;
  const n = 17 + Math.floor(rand() * 5);
  const leaves = Array.from({ length: n }, () => ({ a: rand() * Math.PI * 2, r: 18 + rand() * 72, size: 46 + rand() * 18, l: rand() }));
  leaves.sort((p, q) => p.l - q.l);
  for (const { a, r, size, l } of leaves) {
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    ctx.strokeStyle = hsl(75, 30, 26, 0.6);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(S / 2, S / 2);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (rand() - 0.5) * 0.8);
    planeLeaf(ctx, size, hsl(78 + rand() * 16, 34 + rand() * 16, 24 + l * 18), hsl(70, 30, 45 + l * 10, 0.28));
    ctx.restore();
  }
}

/** Ficus: forty small dark glossy leaves packed round a twig. */
function ficusSprite(ctx: Ctx, rand: Rand) {
  const S = 256;
  for (let i = 0; i < 46; i++) {
    const a = rand() * Math.PI * 2;
    const r = 10 + Math.sqrt(rand()) * 78;
    const x = S / 2 + Math.cos(a) * r;
    const y = S / 2 + Math.sin(a) * r;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a + Math.PI / 2 + (rand() - 0.5) * 1.2);
    ovalLeaf(ctx, 34 + rand() * 14, 15 + rand() * 5, hsl(100 + rand() * 18, 42 + rand() * 14, 15 + rand() * 14));
    ctx.restore();
  }
}

/** Monterey cypress: a flat spray of scaly sprigs, dense in the middle, ragged at the rim, dark green. */
function cypressSprite(ctx: Ctx, rand: Rand) {
  const S = 256;
  const sprig = (x: number, y: number, a: number, len: number, depth: number) => {
    let px = x;
    let py = y;
    const steps = Math.max(2, Math.floor(len / 5));
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 0.25;
      px += Math.cos(a) * 5;
      py += Math.sin(a) * 5;
      const t = i / steps;
      ctx.fillStyle = t > 0.8 ? hsl(85 + rand() * 12, 34, 34 + rand() * 8) : hsl(100 + rand() * 25, 26 + rand() * 12, 19 + rand() * 14);
      ctx.beginPath();
      ctx.arc(px, py, (depth ? 3.2 : 4.5) * (1 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
      if (depth < 2 && i % 2 === 1 && t < 0.85) sprig(px, py, a + (i % 4 === 1 ? 0.9 : -0.9), len * (0.45 - t * 0.25), depth + 1);
    }
  };
  for (let k = 0; k < 7; k++) sprig(S / 2, S / 2, (k / 7) * Math.PI * 2 + rand() * 0.5, 80 + rand() * 30, 0);
}

/**
 * One palm frond, flat: the midrib up the middle (base at the bottom), stiff
 * narrow leaflets angled to the tip, short spines near the base.
 */
function frondSprite(ctx: Ctx, rand: Rand, w: number, h: number, angle: number, yellow: number) {
  const mid = w / 2;
  for (let t = 0.03; t < 0.985; t += 0.0115) {
    const y = h * (1 - t);
    const spine = t < 0.12;
    const len = spine ? 14 + t * 160 : (w / 2 - 4) * Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.92)) ** 0.55;
    for (const s of [-1, 1]) {
      const a = angle + (rand() - 0.5) * 0.12;
      const ex = mid + s * Math.sin(a) * len;
      const ey = y - Math.cos(a) * len * 0.55 + len * 0.05;
      ctx.fillStyle = spine ? hsl(48, 45, 52) : hsl(80 - yellow * 25 + rand() * 8, 30 + rand() * 12 + yellow * 10, 27 + rand() * 12 + yellow * 8);
      ctx.beginPath();
      ctx.moveTo(mid + s * 1.5, y + 2.6);
      ctx.quadraticCurveTo(mid + s * Math.sin(a) * len * 0.55, y - Math.cos(a) * len * 0.3 - 1, ex, ey + len * 0.06);
      ctx.quadraticCurveTo(mid + s * Math.sin(a) * len * 0.5, y - Math.cos(a) * len * 0.25 + 3.5, mid + s * 1.5, y - 1.6);
      ctx.fill();
    }
  }
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, hsl(50, 40, 52));
  grad.addColorStop(1, hsl(70, 30, 40));
  ctx.strokeStyle = grad;
  ctx.lineCap = "round";
  for (let i = 0; i < 12; i++) {
    ctx.lineWidth = 6 - i * 0.4;
    ctx.beginPath();
    ctx.moveTo(mid, h * (1 - i / 12) + 1);
    ctx.lineTo(mid, h * (1 - (i + 1) / 12));
    ctx.stroke();
  }
}

/** The leaf atlas: one quadrant per kind (LEAF), transparent between the leaves. */
/**
 * Spreads leaves into the gaps between them (RGBA, in place): a box blur of
 * colour weighted by alpha, `radius` px, with the blurred alpha doubled.
 * Opaque pixels keep their colour; a gap among leaves turns leaf-coloured
 * and opaque, a wide clear space stays clear. For the photo-real bake: the
 * raster keeps far crowns full by boosting mipmapped alpha (KEEP_ALPHA in
 * trees.tsx), the path tracer reads the full-size sprite and saw lace.
 */
export function fillGaps(data: Uint8ClampedArray, w: number, h: number, radius: number) {
  const blur = (src: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sum = [0, 0, 0, 0];
        for (let k = -radius; k <= radius; k++) {
          const [sx, sy] = horizontal ? [x + k, y] : [x, y + k];
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          for (let c = 0; c < 4; c++) sum[c] += src[(sy * w + sx) * 4 + c];
        }
        for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = sum[c] / (2 * radius + 1);
      }
    }
    return out;
  };
  const premultiplied = new Float32Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    premultiplied.set([data[i] * a, data[i + 1] * a, data[i + 2] * a, a], i);
  }
  const blurred = blur(blur(premultiplied, true), false);
  for (let i = 0; i < data.length; i += 4) {
    const a = blurred[i + 3];
    if (data[i + 3] === 255 || a <= 0) continue;
    data.set([blurred[i] / a, blurred[i + 1] / a, blurred[i + 2] / a, Math.max(data[i + 3], Math.min(255, a * 2 * 255))], i);
  }
  return data;
}

/** The leaf atlas with its gaps filled (fillGaps), for the photo-real bake. */
export function fullerLeaves(t: CanvasTexture) {
  const canvas = t.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  fillGaps(image.data, canvas.width, canvas.height, 4);
  ctx.putImageData(image, 0, 0);
  t.needsUpdate = true;
  return t;
}

export function leafAtlas() {
  const N = LEAF.size;
  const half = N / 2;
  const t = texture(N, N, (ctx) => {
    ctx.clearRect(0, 0, N, N);
    const draw = { plane: planeSprite, ficus: ficusSprite, cypress: cypressSprite };
    for (const [kind, f] of Object.entries(draw)) {
      const [qx, qy] = LEAF.quadrant[kind as keyof typeof draw];
      for (let i = 0; i < 4; i++) {
        const rand = seeded(31 + i * 7 + qx * 3 + qy * 5);
        within(ctx, qx * half + (i % 2) * 256, qy * half + Math.floor(i / 2) * 256, 256, 256, () => f(ctx, rand));
      }
    }
    const [px, py] = LEAF.quadrant.palm;
    within(ctx, px * half, py * half, 256, 512, () => frondSprite(ctx, seeded(5), 256, 512, 0.95, 0));
    within(ctx, px * half + 256, py * half, 256, 512, () => frondSprite(ctx, seeded(9), 256, 512, 0.85, 0.5));
  });
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}

// ---------- Bark ----------

/** Draws f at x, y and its copies one tile across and down, so the column tiles. */
const wrapped = (w: number, h: number, x: number, y: number, f: (x: number, y: number) => void) => {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) f(x + ox, y + oy);
};

/** Irregular blob of radius r round x, y, a little taller than wide. */
function blob(ctx: Ctx, rand: Rand, x: number, y: number, r: number) {
  const n = 9;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = r * (0.6 + rand() * 0.5);
    return [x + Math.cos(a) * k, y + Math.sin(a) * k * 1.5] as const;
  });
  ctx.beginPath();
  ctx.moveTo(...pts[0]);
  pts.forEach((p) => ctx.lineTo(...p));
  ctx.closePath();
}

/** London plane: peeling camouflage of cream, olive and grey patches. */
function planeBark(ctx: Ctx, rand: Rand, w: number, h: number) {
  ctx.fillStyle = "#b5b08f";
  ctx.fillRect(0, 0, w, h);
  const colors = ["#ddd6b6", "#cfc8a4", "#9d9b77", "#878c66", "#a9a796", "#e6dfc2", "#7b8261", "#c2bb98"];
  for (let i = 0; i < 70; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 7 + rand() * 18;
    const color = colors[Math.floor(rand() * colors.length)];
    const seed = Math.floor(rand() * 1e6);
    wrapped(w, h, x, y, (px, py) => {
      blob(ctx, seeded(seed), px, py, r);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "rgba(60,60,35,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
  }
}

/** Ficus: smooth grey with faint streaks and lenticels. */
function ficusBark(ctx: Ctx, rand: Rand, w: number, h: number) {
  ctx.fillStyle = "#9c9a92";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 30; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const r = 6 + rand() * 14;
    wrapped(w, h, x, y, (px, py) => {
      ctx.fillStyle = rand() < 0.5 ? "rgba(190,188,180,0.35)" : "rgba(110,108,100,0.25)";
      ctx.beginPath();
      ctx.ellipse(px, py, r, r * 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.strokeStyle = "rgba(70,68,62,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 120; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const l = 3 + rand() * 6;
    wrapped(w, h, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px - l / 2, py);
      ctx.lineTo(px + l / 2, py);
      ctx.stroke();
    });
  }
}

/** Monterey cypress: dark red-brown, deep fibrous furrows, grey weathering. */
function cypressBark(ctx: Ctx, rand: Rand, w: number, h: number) {
  ctx.fillStyle = "#5e5047";
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    let x = rand() * w;
    const dark = i % 2 === 0;
    ctx.strokeStyle = dark ? "rgba(35,25,18,0.75)" : rand() < 0.4 ? "rgba(160,152,142,0.4)" : "rgba(120,100,84,0.8)";
    ctx.lineWidth = dark ? 1 + rand() * 2 : 2 + rand() * 3;
    const pts: [number, number][] = [];
    for (let y = 0; y <= h; y += 16) {
      x += (rand() - 0.5) * 7;
      pts.push([x, y]);
    }
    pts[pts.length - 1][0] = pts[0][0]; // ends meet, so the column tiles
    for (const ox of [-w, 0, w]) {
      ctx.beginPath();
      pts.forEach(([px, py], k) => (k ? ctx.lineTo(px + ox, py) : ctx.moveTo(px + ox, py)));
      ctx.stroke();
    }
  }
}

/** Canary palm: the diamond lattice of old leaf bases, with fibres. */
function palmBark(ctx: Ctx, rand: Rand, w: number, h: number) {
  ctx.fillStyle = "#5c5042";
  ctx.fillRect(0, 0, w, h);
  const across = 12;
  const dw = w / across;
  const dh = 12.8;
  for (let row = 0; row < h / dh; row++) {
    for (let k = 0; k <= across; k++) {
      const cx = k * dw + (row % 2) * (dw / 2);
      const cy = row * dh + dh / 2;
      const l = 40 + rand() * 12;
      wrapped(w, h, cx, cy, (x, y) => {
        const g = ctx.createLinearGradient(0, y - dh, 0, y + dh);
        g.addColorStop(0, hsl(36, 20, l));
        g.addColorStop(1, hsl(32, 22, l - 12));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(x, y - dh * 0.62);
        ctx.lineTo(x + dw * 0.48, y);
        ctx.lineTo(x, y + dh * 0.62);
        ctx.lineTo(x - dw * 0.48, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(40,30,20,0.55)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
  }
  ctx.strokeStyle = "rgba(170,150,110,0.18)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 160; i++) {
    const x = rand() * w;
    const y = rand() * h;
    wrapped(w, h, x, y, (px, py) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (rand() - 0.5) * 6, py + 6 + rand() * 6);
      ctx.stroke();
    });
  }
}

/** A square cast-iron tree grate: frame, rings of slots, mulch round the trunk hole. */
function grate(ctx: Ctx, rand: Rand, s: number) {
  ctx.fillStyle = "#57534c";
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "#77736a";
  ctx.lineWidth = 3;
  ctx.strokeRect(2.5, 2.5, s - 5, s - 5);
  const c = s / 2;
  ctx.fillStyle = "#3b2d22";
  ctx.beginPath();
  ctx.arc(c, c, s * 0.21, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 90; i++) {
    const a = rand() * Math.PI * 2;
    const r = rand() * s * 0.2;
    ctx.fillStyle = rand() < 0.5 ? "#5a4532" : "#2a1f17";
    ctx.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 2, 2);
  }
  ctx.strokeStyle = "#2c2219";
  ctx.lineCap = "round";
  ctx.lineWidth = 3;
  for (const [r0, r1, n] of [[0.26, 0.34, 20], [0.37, 0.45, 28]]) {
    for (let i = 0; i < n; i++) {
      const a = ((i + (r0 > 0.3 ? 0.5 : 0)) / n) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * r0 * s, c + Math.sin(a) * r0 * s);
      ctx.lineTo(c + Math.cos(a) * r1 * s, c + Math.sin(a) * r1 * s);
      ctx.stroke();
    }
  }
}

/** The bark atlas: a tiling column per kind, then the grate (BARK). */
export function barkAtlas() {
  const { width, height, column } = BARK;
  const t = texture(width, height, (ctx) => {
    const draw = { plane: planeBark, ficus: ficusBark, cypress: cypressBark, palm: palmBark };
    for (const [kind, f] of Object.entries(draw)) {
      within(ctx, BARK_COLUMN[kind as keyof typeof draw] * column, 0, column, height, () => f(ctx, seeded(17 + BARK_COLUMN[kind as keyof typeof draw]), column, height));
    }
    within(ctx, BARK.grate * column, 0, column, height, () => {
      ctx.fillStyle = "#57534c";
      ctx.fillRect(0, 0, column, height);
      grate(ctx, seeded(3), column);
    });
  });
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = RepeatWrapping;
  return t;
}
