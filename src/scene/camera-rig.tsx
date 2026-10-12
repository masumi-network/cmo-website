"use client";

// Camera follows the day: each chapter has a shot. While Cuso walks to the
// next place the camera leads him (he walks towards us), then settles into
// the next shot. Explore mode pulls back to a bird's-eye view.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PerspectiveCamera, Vector3, type Camera } from "three";
import { chapters, overview } from "@/content/day";
import { usePan } from "@/lib/pan";
import { insideBuilding } from "./layout";
import { damp, dayNow, rig, setLerp } from "./shared";

const pos = new Vector3();
const tgt = new Vector3();
const right = new Vector3();
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const chasePos = new Vector3();
const chaseTgt = new Vector3();

/** Fit Explore's view so every pin stays inside the frame (room for labels and the top bar), then ease out a little. */
const fit = { aspect: 0, fov: 0, pos: new Vector3(), tgt: new Vector3() };
const probeCam = new PerspectiveCamera();
const ndc = new Vector3();
function fitOverview(aspect: number, fov: number) {
  if (fit.aspect === aspect && fit.fov === fov) return fit;
  const points = [...chapters.filter((c) => c.id !== "join").map((c) => new Vector3(c.spot[0], c.spot[1] + 2.4, c.spot[2])), ...overview.include.map((p) => new Vector3(...p))];
  const center = points.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / points.length).setY(0);
  const dir = new Vector3(...overview.direction).normalize();
  probeCam.fov = fov;
  probeCam.aspect = aspect;
  probeCam.updateProjectionMatrix();
  const fits = (d: number) => {
    probeCam.position.copy(center).addScaledVector(dir, d);
    probeCam.lookAt(center);
    probeCam.updateMatrixWorld();
    return points.every((p) => {
      ndc.copy(p).project(probeCam);
      return Math.abs(ndc.x) < 0.8 && ndc.y > -0.82 && ndc.y < 0.7; // room for pin labels and the top bar
    });
  };
  let lo = 40;
  let hi = 600;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  fit.aspect = aspect;
  fit.fov = fov;
  fit.tgt.copy(center);
  fit.pos.copy(center).addScaledVector(dir, hi * 1.12);
  return fit;
}

/** Where the fitted overview looks (the middle of the pins). */
export const overviewCenter = () => ({ x: fit.tgt.x, z: fit.tgt.z });

const eye = new Vector3();
const probe = new Vector3();

/** Pull the camera towards Cuso (and up) until nothing solid is in between. */
function keepClear(camera: Vector3) {
  eye.set(rig.cuso.x, rig.cuso.y + 1.4, rig.cuso.z);
  for (let lift = 0; lift < 3; lift++) {
    let clearTo = 1;
    for (let k = 1; k <= 20; k++) {
      probe.lerpVectors(eye, camera, k / 20);
      if (insideBuilding(probe.x, probe.y, probe.z)) {
        clearTo = (k - 1) / 20;
        break;
      }
    }
    if (clearTo === 1) return;
    if (clearTo > 0.55) {
      camera.lerpVectors(eye, camera, clearTo);
      return;
    }
    camera.y += 3; // too close: go over it
  }
}

/** Dev only: `?cam=px,py,pz,tx,ty,tz` pins the camera, for close-up screenshots of one object. */
const PIN = (() => {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("cam")?.split(",").map(Number);
  return v?.length === 6 && v.every(Number.isFinite) ? v : null;
})();

const smoothstep =(a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The biggest free stretch of screen, top to bottom, between the things drawn
 * over the scene (`edges`: [top, bottom] in px). On phones Cuso stands in it.
 */
export function largestGap(edges: readonly (readonly [number, number])[], height: number): [number, number] {
  const sorted = [...edges].sort((p, q) => p[0] - q[0]);
  let best: [number, number] = [0, height];
  let size = -1;
  let y = 0;
  for (const [top, bottom] of [...sorted, [height, height] as const]) {
    const end = Math.min(top, height);
    if (end - y > size) {
      size = end - y;
      best = [y, end];
    }
    y = Math.max(y, bottom);
  }
  return best;
}

/** What covers the scene right now: the top bar and every card (`data-card`). */
function freeBand(height: number) {
  const edges: [number, number][] = [];
  for (const el of document.querySelectorAll("header, [data-card]")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.bottom > 0 && r.top < height) edges.push([r.top, r.bottom]);
  }
  return largestGap(edges, height);
}

/** Room kept above his head for the speech bubble, in px. */
const BUBBLE = 72;
const screenY = (y: number, height: number) => ((1 - ndc.set(rig.cuso.x, rig.cuso.y + y, rig.cuso.z).project(probeCam).y) * height) / 2;

/**
 * Phones: pull back until Cuso and his bubble fit the free band, then return
 * how far (px) to slide the picture so he stands in the middle of it.
 */
function fitBand(camPos: Vector3, camTgt: Vector3, fov: number, size: { width: number; height: number }) {
  const [top, bottom] = freeBand(size.height);
  probeCam.fov = fov;
  probeCam.aspect = size.width / size.height;
  probeCam.updateProjectionMatrix();
  const aim = () => {
    probeCam.position.copy(camPos);
    probeCam.lookAt(camTgt);
    probeCam.updateMatrixWorld();
  };
  aim();
  const room = Math.max(48, (bottom - top) * 0.85 - BUBBLE);
  const tall = screenY(0, size.height) - screenY(1.9, size.height);
  if (tall > room) camPos.sub(camTgt).multiplyScalar(Math.min(2, tall / room)).add(camTgt);
  keepClear(camPos);
  aim();
  const middle = (screenY(1.9, size.height) - BUBBLE + screenY(0, size.height)) / 2;
  return middle - (top + bottom) / 2;
}

/**
 * Cuso's box on screen (left,top,right,bottom in px) as `data-cuso` on the
 * canvas, so tests can check that no card covers him.
 */
function publishCuso(canvas: HTMLCanvasElement, camera: Camera, height: number) {
  camera.updateMatrixWorld();
  const head = ndc.set(rig.cuso.x, rig.cuso.y + 1.9, rig.cuso.z).project(camera);
  const top = ((1 - head.y) * height) / 2;
  const feet = ndc.set(rig.cuso.x, rig.cuso.y, rig.cuso.z).project(camera);
  const bottom = ((1 - feet.y) * height) / 2;
  const x = ((feet.x + 1) * canvas.clientWidth) / 2;
  const half = (bottom - top) / 3; // he is about two thirds as wide as he is tall
  const box = [x - half, top, x + half, bottom].map(Math.round).join(",");
  if (canvas.dataset.cuso !== box) canvas.dataset.cuso = box;
}

export function CameraRig() {
  const look = useRef<Vector3 | null>(null);
  const slide = useRef(0);

  useFrame(({ camera, size, gl }, dt) => {
    const day = dayNow();
    const portrait = size.width < size.height;
    const phone = portrait && size.width < 768;
    let slideTo = 0;
    const cam = camera as PerspectiveCamera;
    const fov = portrait ? 52 : 35;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (day.mode === "explore") {
      // The fitted overview, moved and zoomed by the visitor (drag, pinch, wheel).
      const f = fitOverview(size.width / size.height, cam.fov);
      const { pan, zoom } = usePan.getState();
      tgt.copy(f.tgt).add(tmp.set(pan.x, 0, pan.z));
      pos.subVectors(f.pos, f.tgt).multiplyScalar(zoom).add(tgt);
    } else {
      // Follow where Cuso really is (he walks at his own pace behind the scroll).
      const tv = rig.travel;
      const a = chapters[tv.leg];
      const b = chapters[Math.min(tv.leg + 1, chapters.length - 1)];
      const t = smoothstep(0, 1, tv.t);
      const shotA = phone ? a.phone : a.camera;
      const shotB = phone ? b.phone : b.camera;
      setLerp(pos, shotA.position, shotB.position, t);
      setLerp(tgt, shotA.target, shotB.target, t);
      // Lead cam: ahead of Cuso and off to one side, so we see his face (and his
      // arrow the right way round) as he walks towards us. From a few steps out
      // until a few steps from arrival.
      const chase = smoothstep(1, 7, tv.s) * (1 - smoothstep(tv.length - 7, tv.length - 1, tv.s));
      if (chase > 0) {
        const h = rig.heading;
        const fx = Math.sin(h);
        const fz = Math.cos(h);
        chasePos.set(rig.cuso.x + fx * 7 + fz * 3.2, rig.cuso.y + 3.6, rig.cuso.z + fz * 7 - fx * 3.2);
        chaseTgt.set(rig.cuso.x - fx * 1.5, rig.cuso.y + 1.1, rig.cuso.z - fz * 1.5);
        keepClear(chasePos);
        pos.lerp(chasePos, chase);
        tgt.lerp(chaseTgt, chase);
      }
      if (phone) {
        slideTo = fitBand(pos, tgt, fov, size);
      } else if (portrait) {
        // Tablets upright: Cuso centred and a step back. The hero card sits on
        // top, so Cuso goes low; everywhere else he goes high.
        const low = (id: string) => (id === "arrive" ? 2.4 : -0.2);
        tgt.lerp(tmp.copy(rig.cuso).setY(rig.cuso.y + low(a.id) + (low(b.id) - low(a.id)) * t), 0.7);
        pos.sub(tgt).multiplyScalar(1.3).add(tgt);
      }
      // A little parallax with the pointer.
      right.subVectors(tgt, pos).cross(up).normalize();
      pos.addScaledVector(right, rig.pointer.x * 0.35).addScaledVector(up, rig.pointer.y * 0.2);
    }

    if (PIN) {
      pos.set(PIN[0], PIN[1], PIN[2]);
      tgt.set(PIN[3], PIN[4], PIN[5]);
      look.current = null;
    }

    if (!look.current) {
      camera.position.copy(pos);
      look.current = tgt.clone();
    }
    const k = damp(day.mode === "explore" ? 2 : 3.2, dt);
    // Slide the picture (not the camera) so Cuso sits in the free band.
    slide.current += (slideTo - slide.current) * k;
    if (Math.abs(slide.current) > 0.5) cam.setViewOffset(size.width, size.height, 0, slide.current, size.width, size.height);
    else if (cam.view?.enabled) cam.clearViewOffset();
    camera.position.lerp(pos, k);
    look.current.lerp(tgt, k);
    camera.lookAt(look.current);
    rig.target.copy(look.current);
    publishCuso(gl.domElement, camera, size.height);
  });

  return null;
}
