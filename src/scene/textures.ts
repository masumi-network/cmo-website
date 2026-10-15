// Textures drawn with the 2D canvas: signs that show the visitor's brand,
// the street mask for the ground, little screens.

import { useEffect, useMemo } from "react";
import { CanvasTexture, NoColorSpace, SRGBColorSpace } from "three";
import { CROSSWALKS, EDGE, LANE_MARKS, crosswalkBars, LAND_BOUNDS, PARKS, STREET, X_STREETS, Z_STREETS } from "./grid";

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

const fontFamily = () => getComputedStyle(document.body).fontFamily || "sans-serif";

/** `panel` is the [width, height] of the face the sign is drawn on, in world units. */
type SignStyle = { bg: string; fg: string; panel: readonly [number, number]; sub?: string; width?: number; tracking?: number };

/** Canvas size for a sign: same shape as its panel, so the text is never stretched. */
export const signSize = (panel: readonly [number, number], width = 1024): [number, number] => [width, Math.round((width * panel[1]) / panel[0])];

/** A sign with one line of big text and an optional small line under it. */
export function useSign(text: string, style: SignStyle) {
  const { bg, fg, sub, panel, tracking = 0.14 } = style;
  const [width, height] = signSize(panel, style.width);
  const texture = useMemo(
    () =>
      canvasTexture(width, height, (ctx) => {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = fg;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        let size = height * (sub ? 0.34 : 0.42);
        ctx.font = `600 ${size}px ${fontFamily()}`;
        ctx.letterSpacing = `${size * tracking}px`;
        while (ctx.measureText(text).width > width * 0.86 && size > 12) {
          size -= 4;
          ctx.font = `600 ${size}px ${fontFamily()}`;
          ctx.letterSpacing = `${size * tracking}px`;
        }
        ctx.fillText(text, width / 2, sub ? height * 0.4 : height / 2);
        if (sub) {
          const s = Math.min(height * 0.15, size * 0.5); // never as big as the brand
          ctx.font = `500 ${s}px ${fontFamily()}`;
          ctx.letterSpacing = "0px";
          ctx.globalAlpha = 0.85;
          ctx.fillText(sub, width / 2, height * 0.74);
        }
      }),
    [text, bg, fg, sub, width, height, tracking],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/**
 * The ground as a mask for groundMaterial (materials.ts): red = asphalt,
 * green = sidewalk, blue = grass, white = paint (lane marks, crosswalks),
 * black = block ground. It paints exactly groundAt() in grid.ts: streets
 * first, then each park's sidewalk across the streets it closes and its lawn
 * inside the kerbs. Grass is never painted anywhere else. Mapped onto the
 * terrain in world units (see terrainGeometry in ground.ts).
 */
export function groundMask() {
  const PX = 16; // pixels per world unit
  return landTexture(PX, (ctx, X, Z) => {
    const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
    const [W, H] = [(maxX - minX) * PX, (maxZ - minZ) * PX];
    const rect = (x0: number, x1: number, z0: number, z1: number) => ctx.fillRect(X(x0), Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
    for (const [width, color] of [[EDGE * 2, "#00ff00"], [STREET, "#ff0000"]] as const) {
      ctx.fillStyle = color;
      for (const x of X_STREETS) ctx.fillRect(X(x - width / 2), 0, width * PX, H);
      for (const z of Z_STREETS) ctx.fillRect(0, Z(z - width / 2), W, width * PX);
    }
    for (const [inset, color] of [[STREET / 2, "#00ff00"], [EDGE, "#0000ff"]] as const) {
      ctx.fillStyle = color;
      for (const [x0, x1, z0, z1] of PARKS) rect(x0 + inset, x1 - inset, z0 + inset, z1 - inset);
    }
    // Paint: dashed centre lines (stopping short of the junctions) and zebra crosswalks.
    ctx.strokeStyle = ctx.fillStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.setLineDash([PX * 1.4, PX * 1.4]);
    for (const [x0, z0, x1, z1] of LANE_MARKS) {
      ctx.lineDashOffset = X(x0) + Z(z0); // keeps the dashes in step along the street
      ctx.beginPath();
      ctx.moveTo(X(x0), Z(z0));
      ctx.lineTo(X(x1), Z(z1));
      ctx.stroke();
    }
    for (const c of CROSSWALKS) for (const [x0, x1, z0, z1] of crosswalkBars(c)) rect(x0, x1, z0, z1);
  });
}

type Footprint = { x: number; z: number; w: number; d: number };
/** How far the contact shade reaches past a building's walls at full strength (it then fades over about as much). */
const CONTACT_PAD = 0.15;

/** Every house and tower footprint [x0, x1, z0, z1], a little larger, for the contact shade in lampLight. */
export function contactRects(city: { houses: Footprint[]; towers: Footprint[] }) {
  return [...city.houses, ...city.towers].map(({ x, z, w, d }) => [x - w / 2 - CONTACT_PAD, x + w / 2 + CONTACT_PAD, z - d / 2 - CONTACT_PAD, z + d / 2 + CONTACT_PAD] as const);
}

/**
 * For groundMaterial: the street lamps' light pools (night) in red, and in
 * green a soft shade where buildings meet the ground (`contact`, from
 * contactRects), which ambient occlusion used to give.
 */
export function lampLight(lamps: { x: number; z: number }[], contact: readonly (readonly [number, number, number, number])[]) {
  const PX = 4;
  const R = 1.8; // world units
  return landTexture(PX, (ctx, X, Z) => {
    ctx.globalCompositeOperation = "lighter";
    for (const { x, z } of lamps) {
      const g = ctx.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), R * PX);
      for (const [t, a] of [[0, 1], [0.3, 0.7], [0.65, 0.22], [1, 0]]) g.addColorStop(t, `rgba(255,0,0,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(X(x - R), Z(z - R), 2 * R * PX, 2 * R * PX);
    }
    // Blurred by drawing each rectangle off the canvas and only its shadow on it (ctx.filter is not everywhere).
    const off = ctx.canvas.width;
    Object.assign(ctx, { shadowColor: "#00ff00", shadowBlur: 4 * CONTACT_PAD * PX, shadowOffsetX: off, fillStyle: "#00ff00" });
    for (const [x0, x1, z0, z1] of contact) ctx.fillRect(X(x0) - off, Z(z0), (x1 - x0) * PX, (z1 - z0) * PX);
  });
}

/** A data texture over the land, PX pixels per world unit, on black; mapped like the terrain's UVs, (x, -z) in world units. */
function landTexture(PX: number, draw: (ctx: CanvasRenderingContext2D, X: (x: number) => number, Z: (z: number) => number) => void) {
  const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
  const texture = canvasTexture((maxX - minX) * PX, (maxZ - minZ) * PX, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    draw(ctx, (x) => (x - minX) * PX, (z) => (z - minZ) * PX);
  });
  texture.colorSpace = NoColorSpace;
  texture.anisotropy = 16;
  texture.repeat.set(1 / (maxX - minX), 1 / (maxZ - minZ));
  texture.offset.set(-minX / (maxX - minX), 1 + minZ / (maxZ - minZ));
  return texture;
}

/** A tiny laptop screen with a rising bar chart. */
export function chartTexture() {
  return canvasTexture(256, 160, (ctx) => {
    ctx.fillStyle = "#0e1230";
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = "#3d5afe";
    [0.3, 0.45, 0.4, 0.62, 0.8].forEach((h, i) => ctx.fillRect(40 + i * 38, 140 - h * 110, 24, h * 110));
  });
}
