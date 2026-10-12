"use client";

// Camera follows the day: each chapter has a shot. While Cuso walks to the
// next place the camera chases him from behind, then settles into the next
// shot. Explore mode pulls back to a bird's-eye view.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import { chapters, overviewCamera } from "@/content/day";
import { insideBuilding } from "./layout";
import { damp, dayNow, rig, setLerp } from "./shared";

const pos = new Vector3();
const tgt = new Vector3();
const right = new Vector3();
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();
const chasePos = new Vector3();
const chaseTgt = new Vector3();

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

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function CameraRig() {
  const look = useRef<Vector3 | null>(null);

  useFrame(({ camera, size }, dt) => {
    const day = dayNow();
    const portrait = size.width < size.height;
    const cam = camera as PerspectiveCamera;
    const fov = portrait ? 52 : 35;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    if (day.mode === "explore") {
      pos.set(...overviewCamera.position);
      tgt.set(...overviewCamera.target);
    } else {
      // Follow where Cuso really is (he walks at his own pace behind the scroll).
      const tv = rig.travel;
      const a = chapters[tv.leg];
      const b = chapters[Math.min(tv.leg + 1, chapters.length - 1)];
      const t = smoothstep(0, 1, tv.t);
      setLerp(pos, a.camera.position, b.camera.position, t);
      setLerp(tgt, a.camera.target, b.camera.target, t);
      // Chase cam: behind and above Cuso once he is a few steps out, until a few steps from arrival.
      const chase = smoothstep(1, 7, tv.s) * (1 - smoothstep(tv.length - 7, tv.length - 1, tv.s));
      if (chase > 0) {
        const h = rig.heading;
        chasePos.set(rig.cuso.x - Math.sin(h) * 7.5 + Math.cos(h) * 1.5, rig.cuso.y + 5.2, rig.cuso.z - Math.cos(h) * 7.5 - Math.sin(h) * 1.5);
        chaseTgt.set(rig.cuso.x + Math.sin(h) * 3, rig.cuso.y + 1.2, rig.cuso.z + Math.cos(h) * 3);
        keepClear(chasePos);
        pos.lerp(chasePos, chase);
        tgt.lerp(chaseTgt, chase);
      }
      if (portrait) {
        // Phones: Cuso centred and a step back. The hero card sits on top, so
        // Cuso goes low; everywhere else cards sit at the bottom, so he goes high.
        const low = (id: string) => (id === "arrive" ? 2.4 : -0.2);
        tgt.lerp(tmp.copy(rig.cuso).setY(rig.cuso.y + low(a.id) + (low(b.id) - low(a.id)) * t), 0.7);
        pos.sub(tgt).multiplyScalar(1.3).add(tgt);
      }
      // A little parallax with the pointer.
      right.subVectors(tgt, pos).cross(up).normalize();
      pos.addScaledVector(right, rig.pointer.x * 0.35).addScaledVector(up, rig.pointer.y * 0.2);
    }

    if (!look.current) {
      camera.position.copy(pos);
      look.current = tgt.clone();
    }
    const k = damp(day.mode === "explore" ? 2 : 3.2, dt);
    camera.position.lerp(pos, k);
    look.current.lerp(tgt, k);
    camera.lookAt(look.current);
    rig.target.copy(look.current);
  });

  return null;
}
