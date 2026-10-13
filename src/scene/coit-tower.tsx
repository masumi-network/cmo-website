"use client";

// Coit Tower on Telegraph Hill, in Pioneer Park: a fluted concrete column on a
// low lobby, arched openings at the observation deck, a crown of small arched
// windows and a flat parapet top. It stands on the round summit plaza with a
// short wall around it. Two draw calls: the tower (one atlas texture, windows
// and a soft floodlight glow at night) and the stone plaza.

import { useMemo } from "react";
import { BufferGeometry, CanvasTexture, Color, ExtrudeGeometry, Float32BufferAttribute, LatheGeometry, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, Shape, Vector2 } from "three";
import { heightAt } from "@/lib/terrain";
import { box, cyl, merged } from "./landmark-kit";
import { useNightGlow } from "./shared";

/**
 * Sizes, y above the plaza. The plaza is level with the highest ground under
 * it, so the hill never pokes through; its wall reaches `footing` below the
 * lowest ground, so it never floats on the downhill side.
 */
export const COIT = {
  x: 2,
  z: -26,
  plaza: 1.3,
  footing: 0.4,
  parapet: { h: 0.14, t: 0.07 },
  lobby: { w: 1.3, h: 0.5 },
  shaft: { r: 0.48, top: 5.0, flutes: 20, depth: 0.035 },
  deck: { r: 0.5, top: 5.6 },
  crown: { r: 0.53, top: 5.95 },
  top: 6.06,
};

/** Plaza top and wall bottom, from the ground under the plaza (sampled on rings). */
export function coitSeat() {
  let hi = -Infinity;
  let lo = Infinity;
  for (let r = 0; r <= COIT.plaza + 1e-9; r += COIT.plaza / 10) {
    for (let a = 0; a < 48; a++) {
      const h = heightAt(COIT.x + r * Math.cos((a / 48) * Math.PI * 2), COIT.z + r * Math.sin((a / 48) * Math.PI * 2));
      hi = Math.max(hi, h);
      lo = Math.min(lo, h);
    }
  }
  return { top: hi + 0.03, bottom: lo - COIT.footing };
}

// Atlas (canvas y down, so v 1 is the top row):
//   v 0.75..1   crown, small arched windows, all the way round
//   v 0.5..0.75 observation deck, tall arches, all the way round
//   v 0..0.5    left half: plain column (v follows height), right half: lobby facade
const ATLAS = 1024;
const COLUMN_U = 0.25;
const columnV = (y: number) => 0.03 + 0.44 * Math.min(1, Math.max(0, y / COIT.shaft.top));

/** Moves a geometry's 0..1 uvs into an atlas rectangle. */
function region(g: BufferGeometry, u0: number, u1: number, v0: number, v1: number) {
  const uv = g.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  return g;
}

/** Plain concrete: every vertex samples the column strip at its own height. */
function plain(g: BufferGeometry) {
  const p = g.getAttribute("position");
  const uv = new Float32BufferAttribute(new Float32Array(p.count * 2), 2);
  for (let i = 0; i < p.count; i++) uv.setXY(i, COLUMN_U, columnV(p.getY(i)));
  g.setAttribute("uv", uv);
  return g;
}

/** A row of arches across a band of the atlas, drawn in world units (w by h) so they keep their shape. */
function arches(ctx: CanvasRenderingContext2D, y0: number, px: number, w: number, h: number, n: number, ow: number, sill: number, spring: number, fill: string) {
  ctx.save();
  ctx.translate(0, y0);
  ctx.scale(ATLAS / w, px / h);
  ctx.fillStyle = fill;
  for (let i = 0; i < n; i++) {
    const cx = ((i + 0.5) * w) / n;
    ctx.beginPath();
    ctx.moveTo(cx - ow / 2, h - sill);
    ctx.lineTo(cx - ow / 2, h - spring);
    ctx.ellipse(cx, h - spring, ow / 2, ow / 2, 0, Math.PI, 0);
    ctx.lineTo(cx + ow / 2, h - sill);
    ctx.fill();
  }
  ctx.restore();
}

/** The tower atlas. `mask` draws the night glow instead: windows, lobby, a floodlight fading up the column. */
function atlas(mask: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ATLAS;
  const ctx = canvas.getContext("2d")!;
  const H = ATLAS / 4;
  ctx.fillStyle = mask ? "#000" : "#ece5d6";
  ctx.fillRect(0, 0, ATLAS, ATLAS);
  if (mask) {
    ctx.fillStyle = "#1c1c1c"; // the floodlight's spill up on the deck and crown
    ctx.fillRect(0, 0, ATLAS, ATLAS / 2);
    // floodlights at the foot wash the column, brightest low down
    const g = ctx.createLinearGradient(0, ATLAS, 0, ATLAS / 2);
    g.addColorStop(0, "#5a5a5a");
    g.addColorStop(1, "#202020");
    ctx.fillStyle = g;
    ctx.fillRect(0, ATLAS / 2, ATLAS / 2, ATLAS / 2);
  } else {
    // weathering: a little warmer and darker towards the foot
    const g = ctx.createLinearGradient(0, ATLAS, 0, ATLAS / 2);
    g.addColorStop(0, "rgba(150, 125, 95, 0.22)");
    g.addColorStop(1, "rgba(150, 125, 95, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, ATLAS / 2, ATLAS / 2, ATLAS / 2);
  }
  const { shaft, deck, crown, lobby } = COIT;
  // crown: 24 small arched windows between two string courses
  const crownH = crown.top - deck.top;
  if (!mask) {
    ctx.fillStyle = "rgba(90, 75, 55, 0.25)";
    ctx.fillRect(0, H * 0.12, ATLAS, 4);
    ctx.fillRect(0, H * 0.86, ATLAS, 4);
  }
  arches(ctx, 0, H, 2 * Math.PI * crown.r, crownH, 24, 0.055, crownH * 0.28, crownH * 0.6, mask ? "#808080" : "#3e3a35");
  // observation deck: 12 tall open arches with slim piers between
  const deckH = deck.top - shaft.top;
  arches(ctx, H, H, 2 * Math.PI * deck.r, deckH, 12, 0.16, deckH * 0.1, deckH * 0.68, mask ? "#b4b4b4" : "#433e39");
  // lobby facade: an arched door between two tall windows, under a cornice line
  const lobbyY = ATLAS / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ATLAS / 2, lobbyY, ATLAS / 2, ATLAS / 2);
  ctx.clip();
  ctx.translate(ATLAS / 2, lobbyY);
  ctx.scale(ATLAS / 2 / lobby.w, ATLAS / 2 / lobby.h);
  if (!mask) {
    ctx.fillStyle = "rgba(90, 75, 55, 0.25)";
    ctx.fillRect(0, 0.07, lobby.w, 0.012);
  }
  ctx.fillStyle = mask ? "#cfcfcf" : "#3a3631";
  const door = (cx: number, w: number, top: number) => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, lobby.h);
    ctx.lineTo(cx - w / 2, top + w / 2);
    ctx.ellipse(cx, top + w / 2, w / 2, w / 2, 0, Math.PI, 0);
    ctx.lineTo(cx + w / 2, lobby.h);
    ctx.fill();
  };
  door(lobby.w / 2, 0.2, 0.17);
  for (const s of [-1, 1]) {
    const cx = lobby.w / 2 + s * 0.4;
    ctx.fillRect(cx - 0.07, 0.17, 0.14, 0.2);
  }
  ctx.restore();
  const t = new CanvasTexture(canvas);
  if (!mask) t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The fluted shaft: a ring of shallow flat-faced channels between sharp ridges. */
function shaftGeometry() {
  const { r, top, flutes, depth } = COIT.shaft;
  const shape = new Shape();
  const pts: Vector2[] = [];
  for (let i = 0; i < flutes; i++) {
    for (let k = 0; k < 4; k++) {
      // ridge, then three points across the channel (deepest in the middle)
      const a = ((i + k / 4) / flutes) * Math.PI * 2;
      const rr = k === 0 ? r : k === 2 ? r - depth : r - depth * 0.7;
      pts.push(new Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
    }
  }
  shape.setFromPoints(pts);
  const g = new ExtrudeGeometry(shape, { depth: top - COIT.lobby.h + 0.05, bevelEnabled: false, steps: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, COIT.lobby.h - 0.05, 0);
  return plain(g);
}

/** A thin ring wall from radius r - t to r, h tall, standing on y. */
function ring(r: number, t: number, y: number, h: number, seg = 48) {
  const pts = [new Vector2(r - t, y), new Vector2(r, y), new Vector2(r, y + h), new Vector2(r - t, y + h), new Vector2(r - t, y)];
  return new LatheGeometry(pts, seg);
}

const COURSE = 0.075;
const BLOCK = 0.2;

/** Ashlar courses in running bond, one tile is four courses of two blocks. */
function masonry() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 600; i++) {
    ctx.fillStyle = `rgba(${i % 2 ? "255,255,255" : "110,100,85"}, 0.08)`;
    ctx.fillRect((i * 73) % 256, (i * 151) % 256, 3, 3);
  }
  ctx.fillStyle = "rgba(95, 85, 70, 0.3)";
  for (let row = 0; row < 4; row++) {
    ctx.fillRect(0, row * 64, 256, 4);
    for (const x of row % 2 ? [64, 192] : [0, 128]) ctx.fillRect(x, row * 64, 4, 64);
  }
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Stone parts: paving on top (one plain spot of the tile), coursed wall on
 * the sides (r is the radius, so the blocks wrap round without a seam).
 */
function masoned(g: BufferGeometry, r: number, top: string, side: string) {
  const n = g.getAttribute("normal");
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const a = new Color(top);
  const b = new Color(side);
  const k = Math.round((2 * Math.PI * r) / (2 * BLOCK));
  const out = new Float32Array(n.count * 3);
  for (let i = 0; i < n.count; i++) {
    const up = n.getY(i) > 0.7;
    (up ? a : b).toArray(out, i * 3);
    if (up) uv.setXY(i, 0.5, 0.125);
    else uv.setXY(i, uv.getX(i) * k, p.getY(i) / (4 * COURSE));
  }
  g.setAttribute("color", new Float32BufferAttribute(out, 3));
  return g;
}

const seat = coitSeat();

export function CoitTower() {
  const skin = useMemo(() => new MeshStandardMaterial({ map: atlas(false), emissiveMap: atlas(true), emissive: "#ffd7a1", emissiveIntensity: 0, roughness: 0.8 }), []);
  useNightGlow(skin, 1.25, 0);
  const stoneMat = useMemo(() => new MeshStandardMaterial({ map: masonry(), vertexColors: true, roughness: 0.92 }), []);
  const parts = useMemo(() => {
    const { lobby, shaft, deck, crown, top, plaza, parapet } = COIT;
    const deckH = deck.top - shaft.top;
    const crownH = crown.top - deck.top;
    const tower = merged([
      // lobby: four facades, a cornice slab and a low roof step to the column
      region(box([0, lobby.h / 2, 0], [lobby.w, lobby.h, lobby.w]), 0.5, 1, 0, 0.5),
      plain(box([0, lobby.h + 0.03, 0], [lobby.w + 0.08, 0.06, lobby.w + 0.08])),
      plain(cyl([0, lobby.h + 0.1, 0], shaft.r + 0.08, shaft.r + 0.12, 0.1, 24)),
      shaftGeometry(),
      // observation deck: a sill, the arcade and a cornice
      plain(cyl([0, shaft.top + 0.025, 0], deck.r + 0.035, deck.r + 0.035, 0.05, 32)),
      region(cyl([0, shaft.top + deckH / 2, 0], deck.r, deck.r, deckH, 36, [0, Math.PI / 2, 0]), 0, 1, 0.5, 0.75),
      plain(cyl([0, deck.top + 0.03, 0], crown.r + 0.04, deck.r + 0.02, 0.06, 32)),
      // crown with small arched windows, then the flat parapet top
      region(cyl([0, deck.top + crownH / 2, 0], crown.r, crown.r, crownH, 36, [0, Math.PI / 2, 0]), 0, 1, 0.75, 1),
      plain(cyl([0, crown.top + 0.025, 0], crown.r + 0.04, crown.r + 0.03, 0.05, 32)),
      plain(ring(crown.r + 0.03, 0.06, crown.top + 0.05, top - crown.top - 0.05, 32)),
    ]);
    const wallH = seat.top - seat.bottom;
    const stone = merged([
      // the plaza: one level stone drum set into the summit, paved on top
      masoned(cyl([0, -wallH / 2, 0], plaza, plaza + 0.04, wallH, 56), plaza, "#bdb6aa", "#cfc6b5"),
      // a short wall round the edge, with a coping
      masoned(ring(plaza, parapet.t, 0, parapet.h, 56), plaza, "#ddd6c9", "#d6cdbc"),
      masoned(ring(plaza + 0.015, parapet.t + 0.03, parapet.h, 0.03, 56), plaza, "#e2dbce", "#ddd5c6"),
    ]);
    return { tower, stone };
  }, []);
  return (
    <group position={[COIT.x, seat.top, COIT.z]}>
      <mesh geometry={parts.tower} material={skin} castShadow receiveShadow />
      <mesh geometry={parts.stone} material={stoneMat} castShadow receiveShadow />
    </group>
  );
}
