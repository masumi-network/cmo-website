"use client";

// The 3D city. Loaded only in the browser, only when WebGL is available and
// the visitor has not asked for reduced motion (see Experience).

import { Environment, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, TiltShift2, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect } from "react";
import { Atmosphere } from "./atmosphere";
import { CameraRig } from "./camera-rig";
import { Buildings, Hills, Land, Trees, Water } from "./city";
import { Cuso } from "./cuso";
import { BayBridge, CoitTower, FerryBuilding, GoldenGate, MuralWall, Pier, Pyramid, Rooftop, Shopfront, UnionSquare } from "./landmarks";
import { Pins } from "./pins";
import { rig } from "./shared";

type Props = { onReady: () => void; onGo: (index: number) => void; lite: boolean };

function Ready({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return null;
}

export default function Scene({ onReady, onGo, lite }: Props) {
  useEffect(() => {
    const move = (e: PointerEvent) => rig.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={lite ? [1, 1.5] : [1, 2]}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 35, near: 0.2, far: 1200 }}
      // Hide the pixels from screen readers, not the pins drawn over them.
      onCreated={({ gl }) => gl.domElement.setAttribute("aria-hidden", "true")}
    >
      <Suspense fallback={null}>
        <Atmosphere />
        <Environment resolution={128} frames={1} environmentIntensity={0.5}>
          <Lightformer intensity={1.6} position={[0, 12, 12]} scale={[40, 12, 1]} />
          <Lightformer intensity={0.8} position={[-20, 6, -10]} rotation-y={Math.PI / 2} scale={[30, 8, 1]} />
        </Environment>
        <Land />
        <Water lite={lite} />
        <Hills />
        <Buildings />
        <Trees />
        <Rooftop />
        <Shopfront />
        <MuralWall />
        <UnionSquare />
        <Pyramid />
        <CoitTower />
        <FerryBuilding />
        <Pier />
        <BayBridge />
        <GoldenGate />
        <Cuso />
        <Pins onGo={onGo} />
        <Ready onReady={onReady} />
      </Suspense>
      <CameraRig />
      {lite ? (
        <EffectComposer multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.5} />
          <Vignette offset={0.3} darkness={0.4} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={4}>
          <N8AO aoRadius={1.2} intensity={1.4} distanceFalloff={0.6} quality="performance" />
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.6} />
          <TiltShift2 blur={0.04} />
          <Vignette offset={0.3} darkness={0.45} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
