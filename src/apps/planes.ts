import { makeRng } from '../core/rng';
import { jacobiEigen, Vec3 } from '../core/math';
import { KDTree } from '../core/kdtree';

export type PlaneKind = 'floor' | 'ceiling' | 'wall' | 'horizontal' | 'slanted';
export interface Plane {
  id: number; kind: PlaneKind; normal: Vec3; d: number; inliers: Int32Array;
  threshold: number; iterations: number; sigma: number; meanZ: number; purity: number | null; majorLabel: number | null;
}
export interface PlaneRun {
  mode: 'fixed' | 'adaptive'; planes: Plane[]; assigned: Int32Array; spacing: number; ms: number; totalIterations: number; coverage: number;
}
export interface PlaneOpts {
  mode: 'fixed' | 'adaptive';
  threshold: number; // fixed: inlier distance (m)
  iterations: number; // fixed: RANSAC trials per plane
  confidence: number; // adaptive: probability of finding the best plane
  minFraction: number; // stop when the best plane holds fewer than this fraction of all points
  maxPlanes: number;
  seed: number;
}

/** Median distance to the nearest neighbour: the typical point spacing. */
export function estimateSpacing(pos: Float32Array, n: number, seed = 1): number {
  const tree = new KDTree(pos, n), rng = makeRng(seed), d: number[] = [];
  for (let k = 0; k < Math.min(1500, n); k++) { const i = rng.int(n); const r = tree.knn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], 2); if (r.d2.length > 1) d.push(Math.sqrt(r.d2[1])); }
  d.sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : 0.01;
}

/** Trials needed to find a plane with probability p when a fraction w of the points lie on it: N = log(1 − p) / log(1 − w³). */
export const trialsNeeded = (p: number, w: number) => (w <= 0 ? Infinity : w >= 1 ? 1 : Math.ceil(Math.log(1 - p) / Math.log(1 - w * w * w)));

function fitPCA(pos: Float32Array, ids: ArrayLike<number>): { n: Vec3; d: number } | null {
  const m = ids.length; if (m < 3) return null;
  let mx = 0, my = 0, mz = 0;
  for (let k = 0; k < m; k++) { const j = ids[k]; mx += pos[j * 3]; my += pos[j * 3 + 1]; mz += pos[j * 3 + 2]; }
  mx /= m; my /= m; mz /= m;
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (let k = 0; k < m; k++) { const j = ids[k], a = pos[j * 3] - mx, b = pos[j * 3 + 1] - my, c = pos[j * 3 + 2] - mz; xx += a * a; xy += a * b; xz += a * c; yy += b * b; yz += b * c; zz += c * c; }
  const { values, vectors } = jacobiEigen([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
  let mi = 0; for (let e = 1; e < 3; e++) if (values[e] < values[mi]) mi = e;
  const nv: Vec3 = [vectors[mi], vectors[3 + mi], vectors[6 + mi]];
  return { n: nv, d: -(nv[0] * mx + nv[1] * my + nv[2] * mz) };
}

/**
 * Sequential RANSAC plane extraction. `fixed` uses the threshold and trial count you give it.
 * `adaptive` measures the point spacing and noise itself, sets the inlier distance per plane and stops each search
 * as soon as the trial count N = log(1 − p)/log(1 − w³) is reached for the best inlier ratio w found so far.
 */
export function detectPlanes(pos: Float32Array, n: number, labels: ArrayLike<number> | null, o: PlaneOpts): PlaneRun {
  const t0 = performance.now();
  const rng = makeRng(o.seed);
  const spacing = estimateSpacing(pos, n, o.seed);
  const assigned = new Int32Array(n).fill(-1);
  let remaining = Int32Array.from({ length: n }, (_, i) => i);
  const minPts = Math.max(150, Math.floor(o.minFraction * n));
  const planes: Plane[] = [];
  let totalIt = 0;
  const maxTrials = o.mode === 'adaptive' ? 2000 : o.iterations;

  for (let pi = 0; pi < o.maxPlanes && remaining.length >= minPts; pi++) {
    // work on a random sample of what is left: cheap trials, exact final assignment
    const capN = Math.min(remaining.length, 30000);
    const cand = new Int32Array(capN);
    if (capN === remaining.length) cand.set(remaining); else for (let k = 0; k < capN; k++) cand[k] = remaining[rng.int(remaining.length)];
    const thr0 = o.mode === 'fixed' ? o.threshold : Math.max(2.5 * spacing, 0.015);
    let best = { cnt: 0, nx: 0, ny: 0, nz: 1, d: 0 }, need = maxTrials, it = 0;
    while (it < need) {
      it++;
      const a = cand[rng.int(capN)], b = cand[rng.int(capN)], c = cand[rng.int(capN)];
      const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
      const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      const d = -(nx * pos[a * 3] + ny * pos[a * 3 + 1] + nz * pos[a * 3 + 2]);
      let cnt = 0;
      for (let k = 0; k < capN; k += 2) { const j = cand[k]; if (Math.abs(nx * pos[j * 3] + ny * pos[j * 3 + 1] + nz * pos[j * 3 + 2] + d) <= thr0) cnt++; }
      if (cnt > best.cnt) {
        best = { cnt, nx, ny, nz, d };
        if (o.mode === 'adaptive') need = Math.min(maxTrials, Math.max(10, trialsNeeded(o.confidence, cnt / Math.ceil(capN / 2))));
      }
    }
    totalIt += it;
    // refit on the inliers; the adaptive mode then re-measures the noise and sets its own threshold
    const first: number[] = [];
    for (let k = 0; k < capN; k++) { const j = cand[k]; if (Math.abs(best.nx * pos[j * 3] + best.ny * pos[j * 3 + 1] + best.nz * pos[j * 3 + 2] + best.d) <= thr0) first.push(j); }
    const fit = fitPCA(pos, first); if (!fit) break;
    const res = (j: number) => fit.n[0] * pos[j * 3] + fit.n[1] * pos[j * 3 + 1] + fit.n[2] * pos[j * 3 + 2] + fit.d;
    let sigma = 0, thr = thr0;
    {
      const r = first.map((j) => Math.abs(res(j))).sort((a, b) => a - b);
      sigma = 1.4826 * (r[r.length >> 1] ?? 0);
      if (o.mode === 'adaptive') thr = Math.min(0.06, Math.max(0.6 * spacing, 3 * sigma));
    }
    const inl: number[] = [], rest: number[] = [];
    for (let k = 0; k < remaining.length; k++) { const j = remaining[k]; (Math.abs(res(j)) <= thr ? inl : rest).push(j); }
    if (inl.length < minPts) break;
    let mz = 0; for (const j of inl) mz += pos[j * 3 + 2]; mz /= inl.length;
    const id = planes.length;
    for (const j of inl) assigned[j] = id;
    let purity: number | null = null, major: number | null = null;
    if (labels) {
      const cnt = new Map<number, number>(); for (const j of inl) cnt.set(labels[j], (cnt.get(labels[j]) ?? 0) + 1);
      let bl = -1, bc = 0; cnt.forEach((v, k) => { if (v > bc) { bc = v; bl = k; } });
      purity = bc / inl.length; major = bl;
    }
    planes.push({ id, kind: 'slanted', normal: fit.n, d: fit.d, inliers: Int32Array.from(inl), threshold: thr, iterations: it, sigma, meanZ: mz, purity, majorLabel: major });
    remaining = Int32Array.from(rest);
  }
  // name the planes by orientation and height
  const horiz = planes.filter((p) => Math.abs(p.normal[2]) > 0.9);
  const lo = horiz.reduce<Plane | null>((m, p) => (!m || p.meanZ < m.meanZ ? p : m), null);
  const hi = horiz.reduce<Plane | null>((m, p) => (!m || p.meanZ > m.meanZ ? p : m), null);
  for (const p of planes) {
    const nz = Math.abs(p.normal[2]);
    p.kind = nz > 0.9 ? (p === lo && lo !== hi ? 'floor' : p === hi && lo !== hi ? 'ceiling' : 'horizontal') : nz < 0.25 ? 'wall' : 'slanted';
  }
  return { mode: o.mode, planes, assigned, spacing, ms: performance.now() - t0, totalIterations: totalIt, coverage: assigned.reduce((s, v) => s + (v >= 0 ? 1 : 0), 0) / n };
}
