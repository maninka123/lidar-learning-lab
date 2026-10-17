import { makeRng } from '../core/rng';
import { jacobiEigen } from '../core/math';

export interface PlaneFit { normal: [number, number, number]; d: number; inliers: Int32Array; iterations: number; rmse: number }

/** plane: n·x + d = 0 with |n| = 1 */
export function ransacPlane(
  pos: Float32Array,
  n: number,
  opts: { threshold: number; iterations: number; seed: number; candidates?: Int32Array | null; maxTiltDeg?: number },
): PlaneFit | null {
  const rng = makeRng(opts.seed);
  const cand = opts.candidates ?? null;
  const m = cand ? cand.length : n;
  if (m < 3) return null;
  const at = (i: number) => (cand ? cand[i] : i);
  const minNz = opts.maxTiltDeg !== undefined ? Math.cos((opts.maxTiltDeg * Math.PI) / 180) : -1;
  let best: { n: [number, number, number]; d: number; count: number } | null = null;

  for (let it = 0; it < opts.iterations; it++) {
    const a = at(rng.int(m)), b = at(rng.int(m)), c = at(rng.int(m));
    if (a === b || b === c || a === c) continue;
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    if (Math.abs(nz) < minNz) continue;
    const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
    let count = 0;
    for (let i = 0; i < m; i++) {
      const j = at(i);
      if (Math.abs(nx * pos[j * 3] + ny * pos[j * 3 + 1] + nz * pos[j * 3 + 2] + d) <= opts.threshold) count++;
    }
    if (!best || count > best.count) best = { n: [nx, ny, nz], d, count };
  }
  if (!best) return null;

  // Refit by PCA on the inliers, then collect the final inlier set.
  let [nx, ny, nz] = best.n;
  let d = best.d;
  const first: number[] = [];
  for (let i = 0; i < m; i++) {
    const j = at(i);
    if (Math.abs(nx * pos[j * 3] + ny * pos[j * 3 + 1] + nz * pos[j * 3 + 2] + d) <= opts.threshold) first.push(j);
  }
  if (first.length >= 3) {
    let mx = 0, my = 0, mz = 0;
    for (const j of first) { mx += pos[j * 3]; my += pos[j * 3 + 1]; mz += pos[j * 3 + 2]; }
    mx /= first.length; my /= first.length; mz /= first.length;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const j of first) {
      const a = pos[j * 3] - mx, b = pos[j * 3 + 1] - my, c = pos[j * 3 + 2] - mz;
      xx += a * a; xy += a * b; xz += a * c; yy += b * b; yz += b * c; zz += c * c;
    }
    const { values, vectors } = jacobiEigen([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
    let mi = 0;
    for (let e = 1; e < 3; e++) if (values[e] < values[mi]) mi = e;
    let fx = vectors[mi], fy = vectors[3 + mi], fz = vectors[6 + mi];
    if (fx * nx + fy * ny + fz * nz < 0) { fx = -fx; fy = -fy; fz = -fz; }
    if (Math.abs(fz) >= minNz) { nx = fx; ny = fy; nz = fz; d = -(nx * mx + ny * my + nz * mz); }
  }
  const inl: number[] = [];
  let se = 0;
  for (let i = 0; i < m; i++) {
    const j = at(i);
    const e = nx * pos[j * 3] + ny * pos[j * 3 + 1] + nz * pos[j * 3 + 2] + d;
    if (Math.abs(e) <= opts.threshold) { inl.push(j); se += e * e; }
  }
  return { normal: [nx, ny, nz], d, inliers: Int32Array.from(inl), iterations: opts.iterations, rmse: Math.sqrt(se / Math.max(1, inl.length)) };
}
