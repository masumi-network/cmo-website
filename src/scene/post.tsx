"use client";

// Post effects. Today's look at every hour, except where src/lib/look.ts tunes it (12:00: contact shadows,
// depth of field on Cuso, a warm grade and film grain). Everything stays mounted: per frame only uniforms
// and `enabled` change, so no shader compiles after the poster fades.

import { useFrame } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, EffectGroup, HueSaturation, N8AO, TiltShift2, ToneMapping, Vignette, type TiltShiftEffect } from "@react-three/postprocessing";
import { type DepthOfFieldEffect, type EffectPass, type HueSaturationEffect, ToneMappingMode } from "postprocessing";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Fog, Vector3, type Scene } from "three";
import { TODAY, dofAmount, focusGoal, liteLook, lookFor, passOn, stepFocus } from "@/lib/look";
import { overhead } from "./atmosphere";
import { GradeEffect } from "./grade";
import { dayNow, rig } from "./shared";

/** Dev only: `?look=off` shows today's look at every hour (A/B screenshots). */
const LOOK_OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("look") === "off";

/** The bits of n8ao's N8AOPostPass used here (the package ships no types). */
type AOPass = {
  enabled: boolean;
  scene: Scene;
  autoDetectTransparency: boolean;
  configuration: { intensity: number; transparencyAware: boolean };
  render: (...args: unknown[]) => void;
};

/**
 * AO only near the camera: n8ao fades AO by the scene fog, so during its render the scene gets a short fog of
 * its own. Far thin edges got dark halos and AO hid the distance fog (city-scene.md). Transparency detection
 * off: it walks the scene and renders it twice more every frame.
 */
const AO_FADE = new Fog(0x000000, 25, 70);
const nearAO = (pass: AOPass) => {
  pass.autoDetectTransparency = false;
  pass.configuration.transparencyAware = false;
  const render = pass.render.bind(pass);
  pass.render = (...args) => {
    const fog = pass.scene.fog;
    pass.scene.fog = AO_FADE;
    try {
      render(...args);
    } finally {
      pass.scene.fog = fog;
    }
  };
};

type Props = { lite: boolean; multisampling: number; declined: boolean };

export function Post({ lite, multisampling, declined }: Props) {
  const grade = useMemo(() => new GradeEffect(), []);
  useEffect(() => () => grade.dispose(), [grade]);
  const ao = useRef<AOPass | null>(null);
  const setAO = useCallback((pass: AOPass | null) => {
    if (pass && ao.current !== pass) nearAO(pass);
    ao.current = pass;
  }, []);
  const dofPass = useRef<EffectPass>(null);
  const dof = useRef<DepthOfFieldEffect>(null);
  const tilt = useRef<TiltShiftEffect>(null);
  const hue = useRef<HueSaturationEffect>(null);
  const live = useRef({ focus: null as number | null, bokeh: 0 });
  const forward = useMemo(() => new Vector3(), []);

  useFrame(({ camera, scene, gl }, dt) => {
    const day = dayNow();
    const L = LOOK_OFF ? TODAY : lite ? liteLook(lookFor(day.hour)) : lookFor(day.hour);
    const ready = scene.userData.shadersReady === true;
    const s = live.current;
    scene.environmentIntensity = L.env;
    grade.set(L, gl.getPixelRatio());
    if (lite) return;

    if (ao.current) {
      const intensity = declined ? 0 : L.ao;
      if (ao.current.configuration.intensity !== intensity) ao.current.configuration.intensity = intensity;
      ao.current.enabled = passOn(intensity, ready);
    }

    // Depth of field: focus pulls to Cuso; it fades out as the camera rises over the city.
    const high = day.mode === "explore" ? 1 : overhead(camera.position.distanceTo(rig.target));
    const bokeh = dofAmount(L, high);
    s.bokeh = bokeh === 0 && s.bokeh < 1e-3 ? 0 : s.bokeh + (bokeh - s.bokeh) * (1 - Math.exp(-4 * dt));
    camera.getWorldDirection(forward);
    s.focus = stepFocus(s.focus, focusGoal(camera.position, forward, rig.placed ? rig.cuso : null, rig.target), dt);
    if (dof.current) {
      dof.current.cocMaterial.focusDistance = s.focus;
      dof.current.cocMaterial.focusRange = L.focusRange;
      dof.current.bokehScale = s.bokeh;
    }
    if (dofPass.current) dofPass.current.enabled = passOn(s.bokeh, ready);

    if (tilt.current) tilt.current.blur = L.tilt;
    if (hue.current) hue.current.saturation = L.saturation;
  });

  if (lite)
    return (
      <EffectComposer multisampling={multisampling}>
        <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.5} />
        <Vignette offset={0.3} darkness={0.4} />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <primitive object={grade} />
      </EffectComposer>
    );

  return (
    <EffectComposer multisampling={multisampling}>
      <N8AO ref={setAO} halfRes depthAwareUpsampling aoSamples={16} denoiseSamples={8} aoRadius={3} distanceFalloff={0.6} intensity={0} screenSpaceRadius={false} />
      <EffectGroup ref={dofPass}>
        <DepthOfField ref={dof} worldFocusDistance={9} worldFocusRange={TODAY.focusRange} bokehScale={0} resolutionScale={0.5} />
      </EffectGroup>
      {/* the tilt-shift sorts first in this pass (a convolution), as before */}
      <Bloom mipmapBlur luminanceThreshold={0.9} intensity={0.6} />
      <TiltShift2 ref={tilt} blur={TODAY.tilt} />
      <HueSaturation ref={hue} saturation={TODAY.saturation} />
      <Vignette offset={0.3} darkness={0.45} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <primitive object={grade} />
    </EffectComposer>
  );
}
