// The photo look's colour grade and film grain, one post effect after tone mapping (values in 0..1).
// Mirrors gradePixel in src/lib/look.ts, which the tests check.

import { Effect } from "postprocessing";
import { Uniform, Vector3 } from "three";
import type { Look } from "@/lib/look";

const fragment = /* glsl */ `
  uniform vec3 gain;
  uniform vec3 lift;
  uniform float contrast;
  uniform float grain;
  uniform float seed;
  uniform float grainScale;

  float grainHash(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 p = sqrt(clamp(inputColor.rgb, 0.0, 1.0));
    p = clamp(p * gain + lift * (1.0 - p), 0.0, 1.0);
    p = mix(p, p * p * (3.0 - 2.0 * p), contrast);
    float n = grainHash(floor(gl_FragCoord.xy / grainScale) + seed);
    p = clamp(p + (n - 0.5) * grain * 4.0 * p * (1.0 - p), 0.0, 1.0);
    outputColor = vec4(p * p, inputColor.a);
  }
`;

export class GradeEffect extends Effect {
  constructor() {
    super("GradeEffect", fragment, {
      uniforms: new Map<string, Uniform>([
        ["gain", new Uniform(new Vector3(1, 1, 1))],
        ["lift", new Uniform(new Vector3())],
        ["contrast", new Uniform(0)],
        ["grain", new Uniform(0)],
        ["seed", new Uniform(0)],
        ["grainScale", new Uniform(1)],
      ]),
    });
  }

  /** Per frame: the look's grade, a new grain pattern, grain about one CSS pixel big. */
  set(look: Look, pixelRatio: number) {
    const u = this.uniforms;
    (u.get("gain")!.value as Vector3).set(...look.gain);
    (u.get("lift")!.value as Vector3).set(...look.lift);
    u.get("contrast")!.value = look.contrast;
    u.get("grain")!.value = look.grain;
    u.get("seed")!.value = Math.floor(Math.random() * 1000);
    u.get("grainScale")!.value = Math.max(1, pixelRatio);
  }
}
