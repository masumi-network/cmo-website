"use client";

// The 3D city. Loaded only in the browser, only when WebGL is available and
// the visitor has not asked for reduced motion (see Experience).

import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer, HueSaturation, TiltShift2, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useEffect, useRef, useState } from "react";
import { WebGLRenderTarget, type Material, type Mesh, type Texture } from "three";
import { Atmosphere } from "./atmosphere";
import { CameraRig } from "./camera-rig";
import { City } from "./city";
import { CoitTower } from "./coit-tower";
import { Cuso } from "./cuso";
import { BayBridge, FerryBuilding, GoldenGate, MuralWall, Pyramid, Roads, Rooftop, Shopfront, UnionSquare } from "./landmarks";
import { Pier } from "./pier";
import { Pins } from "./pins";
import { rig } from "./shared";

type Props = { onReady: () => void; onGo: (index: number) => void; lite: boolean };

/**
 * Ready once every shader is compiled and every texture uploaded, so the
 * first scroll through a chapter never stalls. Starts after the first frame,
 * when the lights, shadows and environment are in place (they are part of
 * each shader), and compiles in parallel where the browser can.
 */
function Ready({ onReady }: { onReady: () => void }) {
  const started = useRef(false);
  useFrame(({ gl, scene, camera }) => {
    if (started.current) return;
    started.current = true;
    scene.traverse((o) => {
      for (const m of [(o as Mesh).material ?? []].flat() as Material[])
        for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) gl.initTexture(v as Texture);
    });
    // Into a render target, like the post effects draw: shaders differ by output.
    const target = new WebGLRenderTarget(1, 1);
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(target);
    const compiled = gl.compileAsync(scene, camera); // collects the materials right away
    gl.setRenderTarget(previous);
    target.dispose();
    compiled.then(onReady, onReady);
  });
  return null;
}

export default function Scene({ onReady, onGo, lite }: Props) {
  // Sharp on retina screens, until the GPU can't keep up: then one pixel per pixel.
  const [dpr, setDpr] = useState<[number, number]>(lite ? [1, 1.5] : [1, 2]);
  useEffect(() => {
    const move = (e: PointerEvent) => rig.pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  return (
    <Canvas
      shadows="percentage"
      flat
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      camera={{ fov: 35, near: 0.2, far: 1200 }}
      // Hide the pixels from screen readers, not the pins drawn over them.
      onCreated={({ gl }) => {
        gl.domElement.setAttribute("aria-hidden", "true");
        // Reading the shader log waits for each compile to finish: a stall per new material.
        gl.debug.checkShaderErrors = process.env.NODE_ENV !== "production";
      }}
    >
      <PerformanceMonitor onDecline={() => setDpr([1, 1])} />
      <Suspense fallback={null}>
        <Atmosphere />
        <Environment resolution={128} frames={1} environmentIntensity={0.5}>
          <Lightformer intensity={1.6} position={[0, 12, 12]} scale={[40, 12, 1]} />
          <Lightformer intensity={0.8} position={[-20, 6, -10]} rotation-y={Math.PI / 2} scale={[30, 8, 1]} />
        </Environment>
        <City lite={lite} />
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
        <Roads />
        <Cuso />
        <Pins onGo={onGo} />
        <Ready onReady={onReady} />
      </Suspense>
      <CameraRig />
      {lite ? (
        <EffectComposer multisampling={2}>
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.5} />
          <Vignette offset={0.3} darkness={0.4} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.6} />
          <TiltShift2 blur={0.04} />
          <HueSaturation saturation={0.08} />
          <Vignette offset={0.3} darkness={0.45} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
