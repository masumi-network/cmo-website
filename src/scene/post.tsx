"use client";

// Post effects. Today's look at every hour, except where src/lib/look.ts tunes it (12:00: depth of field
// on Cuso, a warm grade and film grain). Everything stays mounted: per frame only uniforms
// and `enabled` change, so no shader compiles after the poster fades.

import { useFrame } from "@react-three/fiber";
import { Bloom, DepthOfField, EffectComposer, EffectGroup, HueSaturation, TiltShift2, ToneMapping, Vignette, type TiltShiftEffect } from "@react-three/postprocessing";
import { type DepthOfFieldEffect, type EffectPass, type HueSaturationEffect, ToneMappingMode } from "postprocessing";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import { TODAY, dofAmount, focusGoal, liteLook, lookFor, passOn, stepFocus } from "@/lib/look";
import { overhead } from "./atmosphere";
import { GradeEffect } from "./grade";
import { dayNow, rig } from "./shared";

/** Dev only: `?look=off` shows today's look at every hour (A/B screenshots). */
const LOOK_OFF =
  process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("look") === "off";

type Props = { lite: boolean; multisampling: number };

export function Post({ lite, multisampling }: Props) {
  const grade = useMemo(() => new GradeEffect(), []);
  useEffect(() => () => grade.dispose(), [grade]);
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
