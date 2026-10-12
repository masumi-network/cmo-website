// Textures drawn with the 2D canvas: signs that show the visitor's brand,
// the street mask for the ground, little screens.

import { useEffect, useMemo } from "react";
import { CanvasTexture, NoColorSpace, SRGBColorSpace } from "three";
import { LAND_BOUNDS, PARKS, SIDEWALK, STREET, X_STREETS, Z_STREETS } from "./layout";

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

type SignStyle = { bg: string; fg: string; sub?: string; width?: number; height?: number; tracking?: number };

/** A sign with one line of big text and an optional small line under it. */
export function useSign(text: string, style: SignStyle) {
  const { bg, fg, sub, width = 1024, height = 256, tracking = 0.14 } = style;
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
          const s = height * 0.15;
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
 * Mapped onto the terrain in world units (see Land in city.tsx).
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
    for (const [width, color] of [[STREET + SIDEWALK * 2, "#00ff00"], [STREET, "#ff0000"]] as const) {
      ctx.fillStyle = color;
      for (const x of X_STREETS) ctx.fillRect(X(x - width / 2), 0, width * PX, H);
      for (const z of Z_STREETS) ctx.fillRect(0, Z(z - width / 2), W, width * PX);
    }
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.setLineDash([PX * 1.4, PX * 1.4]);
    for (const x of X_STREETS) {
      ctx.beginPath();
      ctx.moveTo(X(x), 0);
      ctx.lineTo(X(x), H);
      ctx.stroke();
    }
    for (const z of Z_STREETS) {
      ctx.beginPath();
      ctx.moveTo(0, Z(z));
      ctx.lineTo(W, Z(z));
      ctx.stroke();
    }
    ctx.fillStyle = "#0000ff";
    const edge = STREET / 2 + SIDEWALK;
    for (const [x0, x1, z0, z1] of PARKS) ctx.fillRect(X(x0 + edge), Z(z0 + edge), (x1 - x0 - edge * 2) * PX, (z1 - z0 - edge * 2) * PX);
    // Grassy hilltops: Telegraph Hill and Twin Peaks.
    for (const [x, z, r] of [[2, -26, 6], [-34, 30, 9]]) {
      ctx.beginPath();
      ctx.arc(X(x), Z(z), r * PX, 0, Math.PI * 2);
      ctx.fill();
    }
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
