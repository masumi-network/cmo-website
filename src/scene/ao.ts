// Baked contact darkening (ambient occlusion) per vertex, for hero props made
// of boxes (the cable car, the pier deck). Pure: positions and normals in,
// one 0..1 value per vertex out (1 = open sky, 0 = buried). Done once when the
// geometry is built, so it costs nothing per frame. Multiply it into the
// vertex colours.

/** An axis-aligned box that blocks light. */
export type Box = { min: readonly [number, number, number]; max: readonly [number, number, number] };

/**
 * `n` unit directions over the hemisphere around +z, cosine weighted (more
 * rays near the normal, as diffuse light is), on a golden-angle spiral.
 */
export function hemisphere(n: number) {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    out[i * 3] = r * Math.cos(i * golden);
    out[i * 3 + 1] = r * Math.sin(i * golden);
    out[i * 3 + 2] = Math.sqrt(1 - u);
  }
  return out;
}

/** Distance along the ray to the box (0 when it starts inside), or Infinity. */
function hit(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box, reach: number) {
  let near = 0;
  let far = reach;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return Infinity;
      continue;
    }
    let t0 = (b.min[a] - o[a]) / d[a];
    let t1 = (b.max[a] - o[a]) / d[a];
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Infinity;
  }
  return near;
}

const inside = (x: number, y: number, z: number, b: Box) => x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2];

/** How far the point is from the box (0 inside). */
function gap(x: number, y: number, z: number, b: Box) {
  const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
  const dy = Math.max(b.min[1] - y, 0, y - b.max[1]);
  const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
  return Math.hypot(dx, dy, dz);
}

/**
 * Light reaching each vertex: `rays` directions over its hemisphere; a ray
 * that meets a box within `reach` blocks it, fully when the box is close,
 * fading out towards `reach`. A vertex inside a box gets 0. Rays start a
 * millimetre off the surface, so a box never shades its own faces.
 */
export function vertexAO(positions: ArrayLike<number>, normals: ArrayLike<number>, boxes: Box[], rays = 16, reach = 0.35) {
  const count = positions.length / 3;
  const out = new Float32Array(count).fill(1);
  const dirs = hemisphere(rays);
  const near: Box[] = [];
  for (let v = 0; v < count; v++) {
    const [nx, ny, nz] = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    const x = positions[v * 3] + nx * 1e-3;
    const y = positions[v * 3 + 1] + ny * 1e-3;
    const z = positions[v * 3 + 2] + nz * 1e-3;
    near.length = 0;
    for (const b of boxes) if (gap(x, y, z, b) < reach) near.push(b);
    if (!near.length) continue;
    if (near.some((b) => inside(x, y, z, b))) {
      out[v] = 0;
      continue;
    }
    // A tangent frame around the normal (Duff et al. 2017).
    const s = nz >= 0 ? 1 : -1;
    const a = -1 / (s + nz);
    const bb = nx * ny * a;
    const t = [1 + s * nx * nx * a, s * bb, -s * nx];
    const u = [bb, s + ny * ny * a, -ny];
    let blocked = 0;
    for (let r = 0; r < rays; r++) {
      const [lx, ly, lz] = [dirs[r * 3], dirs[r * 3 + 1], dirs[r * 3 + 2]];
      const dx = t[0] * lx + u[0] * ly + nx * lz;
      const dy = t[1] * lx + u[1] * ly + ny * lz;
      const dz = t[2] * lx + u[2] * ly + nz * lz;
      let first = Infinity;
      for (const b of near) first = Math.min(first, hit(x, y, z, dx, dy, dz, b, reach));
      if (first < reach) blocked += 1 - first / reach;
    }
    out[v] = 1 - blocked / rays;
  }
  return out;
}
