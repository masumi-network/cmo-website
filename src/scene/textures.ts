// Textures drawn with the 2D canvas: signs that show the visitor's brand,
// the street mask for the ground, little screens.

import { useEffect, useMemo } from "react";
import { CanvasTexture, NoColorSpace, SRGBColorSpace } from "three";
import { EDGE, LAND_BOUNDS, PARKS, STREET, X_STREETS, Z_STREETS, inPark } from "./grid";

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
 * green = sidewalk, blue = grass, white = lane marks, black = block ground.
 * It paints exactly groundAt() in grid.ts: streets first, then park lawns
 * inside their kerbs (closing the streets inside a park). Grass is never
 * painted anywhere else. Mapped onto the terrain in world units (see Land in city.tsx).
 */
export function groundMask() {
  const { minX, maxX, minZ, maxZ } = LAND_BOUNDS;
  const PX = 16; // pixels per world unit
  const W = (maxX - minX) * PX;
  const H = (maxZ - minZ) * PX;
  const X = (x: number) => (x - minX) * PX;
  const Z = (z: number) => (z - minZ) * PX;
  const texture = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    for (const [width, color] of [[EDGE * 2, "#00ff00"], [STREET, "#ff0000"]] as const) {
      ctx.fillStyle = color;
      for (const x of X_STREETS) ctx.fillRect(X(x - width / 2), 0, width * PX, H);
      for (const z of Z_STREETS) ctx.fillRect(0, Z(z - width / 2), W, width * PX);
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.setLineDash([PX * 1.4, PX * 1.4]);
    // Centre lines block by block; none on a street a park closes (a T junction stays a T).
    const stops = (cross: number[], lo: number, hi: number) => [lo, ...cross, hi];
    const dash = (x0: number, z0: number, x1: number, z1: number) => {
      if (inPark((x0 + x1) / 2, (z0 + z1) / 2)) return;
      ctx.lineDashOffset = X(x0) + Z(z0); // keeps the dashes in step along the street
      ctx.beginPath();
      ctx.moveTo(X(x0), Z(z0));
      ctx.lineTo(X(x1), Z(z1));
      ctx.stroke();
    };
    for (const x of X_STREETS) stops(Z_STREETS, minZ, maxZ).forEach((z, i, zs) => i && dash(x, zs[i - 1], x, z));
    for (const z of Z_STREETS) stops(X_STREETS, minX, maxX).forEach((x, i, xs) => i && dash(xs[i - 1], z, x, z));
    ctx.fillStyle = "#0000ff";
    for (const [x0, x1, z0, z1] of PARKS) ctx.fillRect(X(x0 + EDGE), Z(z0 + EDGE), (x1 - x0 - EDGE * 2) * PX, (z1 - z0 - EDGE * 2) * PX);
  });
  texture.colorSpace = NoColorSpace;
  texture.anisotropy = 16;
  // The terrain's UVs are (x, -z) in world units.
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
