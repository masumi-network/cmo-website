"use client";

// Camera follows the day: each chapter has a shot; travelling between shots
// lifts over the city. Explore mode pulls back to a bird's-eye view.

import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type PerspectiveCamera } from "three";
import { overviewCamera } from "@/content/day";
import { damp, dayNow, rig, setLerp } from "./shared";

const pos = new Vector3();
const tgt = new Vector3();
const right = new Vector3();
const up = new Vector3(0, 1, 0);
const tmp = new Vector3();

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
      const { a, b, t } = day;
      setLerp(pos, a.camera.position, b.camera.position, t);
      setLerp(tgt, a.camera.target, b.camera.target, t);
      const dist = Math.hypot(b.camera.position[0] - a.camera.position[0], b.camera.position[2] - a.camera.position[2]);
      const lift = Math.sin(Math.PI * t) * Math.min(dist * 0.45, 30);
      pos.y += lift;
      tgt.y += lift * 0.4;
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
