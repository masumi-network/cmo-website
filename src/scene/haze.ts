// Height-aware haze in three's fog chunks (see src/lib/haze.ts): linear fog
// reaches farther for high ground, so far hills keep their silhouette. Patched
// once at import (atmosphere.tsx), before Ready compiles any shader.
// Dev only: `?haze=off` keeps three's fog, for before and after screenshots.

import { ShaderChunk } from "three";
import { HAZE } from "@/lib/haze";

type Key = "fog_pars_vertex" | "fog_vertex" | "fog_pars_fragment" | "fog_fragment";
type Chunks = Record<Key, string>;

// three's own chunks, kept across hot reloads so a patch always starts from them.
const store = globalThis as { __threeFogChunks?: Chunks };
const three: Chunks = (store.__threeFogChunks ??= {
  fog_pars_vertex: ShaderChunk.fog_pars_vertex,
  fog_vertex: ShaderChunk.fog_vertex,
  fog_pars_fragment: ShaderChunk.fog_pars_fragment,
  fog_fragment: ShaderChunk.fog_fragment,
});

const f = (n: number) => n.toFixed(3);
const declare = (chunk: string) => chunk.replace("varying float vFogDepth;", "varying float vFogDepth;\n\tvarying float vFogY;");

const hazy: Chunks = {
  fog_pars_vertex: declare(three.fog_pars_vertex),
  fog_pars_fragment: declare(three.fog_pars_fragment),
  // World height: the view matrix is a rotation plus a move, so its inverse is the transpose (one dot for y).
  fog_vertex: three.fog_vertex.replace(
    "vFogDepth = - mvPosition.z;",
    "vFogDepth = - mvPosition.z;\n\tvFogY = dot( viewMatrix[ 1 ].xyz, mvPosition.xyz - viewMatrix[ 3 ].xyz );",
  ),
  fog_fragment: three.fog_fragment.replace(
    "float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );",
    `float fogLow = smoothstep( fogNear, fogFar, vFogDepth );
		float fogHigh = min( fogLow, 1.0 - exp( - max( vFogDepth - fogNear, 0.0 ) / ( ${f(HAZE.reach)} * fogFar ) ) );
		float fogFactor = mix( fogLow, fogHigh, smoothstep( ${f(HAZE.y0)}, ${f(HAZE.y1)}, vFogY ) );`,
  ),
};

/** Puts the hazy chunks in (or three's back). Safe to call again: it always starts from three's. */
export function applyHaze(on: boolean) {
  Object.assign(ShaderChunk, on ? hazy : three);
}

const OFF = process.env.NODE_ENV !== "production" && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("haze") === "off";
applyHaze(!OFF);
