// Textures drawn with the 2D canvas: signs that show the visitor's brand,
// window grids for night lights, little screens.

import { useEffect, useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";

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

/** Random lit windows, used as an emissive map on buildings. */
export function windowsTexture(seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const texture = canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, 64, 128);
    for (let y = 6; y < 124; y += 10) {
      for (let x = 5; x < 60; x += 11) {
        if (rand() < 0.42) {
          ctx.fillStyle = rand() < 0.8 ? "#ffcf8a" : "#fff2d6";
          ctx.fillRect(x, y, 6, 5);
        }
      }
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping;
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
