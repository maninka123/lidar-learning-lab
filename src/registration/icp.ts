import { KDTree } from '../core/kdtree';
import { Rigid, bestFitTransform, identity, mulR, applyR, Vec3 } from '../core/math';

export interface IcpOptions {
  maxIterations: number;
  tolerance: number; // stop when RMSE improvement < tolerance
  maxCorrDist: number;
  sampleMax: number;
  withScale?: boolean;
  init?: Rigid;
  initScale?: number;
  scaleBounds?: [number, number];
}
export interface IcpIter { iter: number; rmse: number; fitness: number; T: Rigid; scale: number; pairs: number }
export interface IcpResult { T: Rigid; scale: number; history: IcpIter[]; converged: boolean; finalRmse: number; fitness: number }

/** Apply similarity transform x' = s R x + t */
export function applySim(T: Rigid, s: number, p: Vec3): Vec3 {
  const r = applyR(T.R, p);
  return [s * r[0] + T.t[0], s * r[1] + T.t[1], s * r[2] + T.t[2]];
}

/** Point-to-point ICP aligning src onto dst (both xyz Float32Arrays). */
export function icp(src: Float32Array, nSrc: number, dst: Float32Array, nDst: number, o: IcpOptions): IcpResult {
  const tree = new KDTree(dst, nDst);
  const stride = Math.max(1, Math.ceil(nSrc / o.sampleMax));
  const idx: number[] = [];
  for (let i = 0; i < nSrc; i += stride) idx.push(i);
  const m = idx.length;
  let T: Rigid = o.init ? { R: o.init.R.slice(), t: [...o.init.t] as Vec3 } : identity();
  let s = o.initScale ?? 1;
  const history: IcpIter[] = [];
  const cur = new Float32Array(m * 3);
  const tgt = new Float32Array(m * 3);
  let prev = Infinity;
  let converged = false;
  let lastRmse = Infinity, lastFit = 0;
  // Coarse-to-fine correspondence gating: the distance threshold is tightened whenever ICP stalls.
  let gate = o.maxCorrDist;
  const minGate = Math.max(o.maxCorrDist / 8, 0.02);
  let maxD2 = gate * gate;

  for (let it = 0; it < o.maxIterations; it++) {
    let k = 0, se = 0;
    const srcSel = new Float32Array(m * 3);
    for (let a = 0; a < m; a++) {
      const i = idx[a];
      const p = applySim(T, s, [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]]);
      const nn = tree.nearest(p[0], p[1], p[2], maxD2);
      if (nn.index < 0) continue;
      cur[k * 3] = p[0]; cur[k * 3 + 1] = p[1]; cur[k * 3 + 2] = p[2];
      srcSel[k * 3] = p[0];
      tgt[k * 3] = dst[nn.index * 3]; tgt[k * 3 + 1] = dst[nn.index * 3 + 1]; tgt[k * 3 + 2] = dst[nn.index * 3 + 2];
      se += nn.dist2;
      k++;
    }
    if (k < 3) break;
    const rmse = Math.sqrt(se / k);
    lastRmse = rmse; lastFit = k / m;
    history.push({ iter: it, rmse, fitness: k / m, T: { R: T.R.slice(), t: [...T.t] as Vec3 }, scale: s, pairs: k });
    if (Math.abs(prev - rmse) < o.tolerance) {
      if (gate > minGate * 1.01) { gate = Math.max(minGate, gate / 2); maxD2 = gate * gate; prev = Infinity; continue; }
      converged = true; break;
    }
    prev = rmse;
    let d = bestFitTransform(cur, tgt, k, !!o.withScale);
    if (o.withScale && o.scaleBounds && (s * d.scale < o.scaleBounds[0] || s * d.scale > o.scaleBounds[1])) d = bestFitTransform(cur, tgt, k, false);
    // compose incremental similarity: x'' = ds*dR*(s R x + t) + dt
    const ds = d.scale;
    T = { R: mulR(d.R, T.R), t: (() => { const r = applyR(d.R, T.t); return [ds * r[0] + d.t[0], ds * r[1] + d.t[1], ds * r[2] + d.t[2]] as Vec3; })() };
    s *= ds;
    // keep scale folded in s; since T.t already contains ds, and R excludes scale: x' = s R x + t holds with s*=ds
  }
  // final residual after last update
  const last = history[history.length - 1];
  return { T, scale: s, history, converged, finalRmse: history.length ? Math.min(lastRmse, last.rmse) : Infinity, fitness: lastFit };
}

/** RMSE / fitness of src (transformed) against dst without iterating. */
export function evaluateAlignment(src: Float32Array, nSrc: number, dst: Float32Array, nDst: number, T: Rigid, maxCorrDist: number, sampleMax = 4000, s = 1) {
  const tree = new KDTree(dst, nDst);
  const stride = Math.max(1, Math.ceil(nSrc / sampleMax));
  let k = 0, se = 0, total = 0;
  for (let i = 0; i < nSrc; i += stride) {
    total++;
    const p = applySim(T, s, [src[i * 3], src[i * 3 + 1], src[i * 3 + 2]]);
    const nn = tree.nearest(p[0], p[1], p[2], maxCorrDist * maxCorrDist);
    if (nn.index >= 0) { k++; se += nn.dist2; }
  }
  return { rmse: k ? Math.sqrt(se / k) : Infinity, fitness: total ? k / total : 0, pairs: k };
}
