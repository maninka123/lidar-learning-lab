import { KDTree } from '../core/kdtree';
import { Rigid, bestFitTransform, identity, mulR, applyR, Vec3, eulerToR, jacobiEigen } from '../core/math';

export interface IcpOptions {
  maxIterations: number;
  tolerance: number; // stop when RMSE improvement < tolerance
  maxCorrDist: number;
  sampleMax: number;
  withScale?: boolean;
  init?: Rigid;
  initScale?: number;
  scaleBounds?: [number, number];
  method?: 'point' | 'plane'; // point-to-point (default) or point-to-plane
  trim?: number; // keep only this fraction of the best pairs each iteration (robust to non-overlap), 0..1
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
  const nrm = new Float32Array(m * 3);
  const d2s = new Float64Array(m);
  const nCache = new Map<number, Vec3>();
  /** Surface normal of dst point i from PCA of its 10 nearest neighbours (computed lazily, cached). */
  const normalAt = (i: number): Vec3 => {
    const c = nCache.get(i);
    if (c) return c;
    const r = tree.knn(dst[i * 3], dst[i * 3 + 1], dst[i * 3 + 2], 10);
    let mx = 0, my = 0, mz = 0;
    for (const j of r.idx) { mx += dst[j * 3]; my += dst[j * 3 + 1]; mz += dst[j * 3 + 2]; }
    const q = r.idx.length || 1; mx /= q; my /= q; mz /= q;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const j of r.idx) { const a = dst[j * 3] - mx, b = dst[j * 3 + 1] - my, e = dst[j * 3 + 2] - mz; xx += a * a; xy += a * b; xz += a * e; yy += b * b; yz += b * e; zz += e * e; }
    const { vectors, values } = jacobiEigen([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
    let mi = 0; for (let e = 1; e < 3; e++) if (values[e] < values[mi]) mi = e;
    const v: Vec3 = [vectors[mi], vectors[3 + mi], vectors[6 + mi]];
    nCache.set(i, v);
    return v;
  };
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
      if (o.method === 'plane') { const nv = normalAt(nn.index); nrm[k * 3] = nv[0]; nrm[k * 3 + 1] = nv[1]; nrm[k * 3 + 2] = nv[2]; }
      d2s[k] = nn.dist2;
      se += nn.dist2;
      k++;
    }
    if (k < 3) break;
    if (o.trim && o.trim < 1) {
      // keep the best fraction of pairs (trimmed ICP): robust when the clouds only partly overlap
      const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => d2s[a] - d2s[b]).slice(0, Math.max(3, Math.floor(k * o.trim)));
      const c2 = new Float32Array(order.length * 3), t2 = new Float32Array(order.length * 3), n2 = new Float32Array(order.length * 3);
      let se2 = 0;
      order.forEach((i, j) => { c2.set(cur.subarray(i * 3, i * 3 + 3), j * 3); t2.set(tgt.subarray(i * 3, i * 3 + 3), j * 3); n2.set(nrm.subarray(i * 3, i * 3 + 3), j * 3); se2 += d2s[i]; });
      cur.set(c2); tgt.set(t2); nrm.set(n2); k = order.length; se = se2;
    }
    const rmse = Math.sqrt(se / k);
    lastRmse = rmse; lastFit = k / m;
    history.push({ iter: it, rmse, fitness: k / m, T: { R: T.R.slice(), t: [...T.t] as Vec3 }, scale: s, pairs: k });
    if (Math.abs(prev - rmse) < o.tolerance) {
      if (gate > minGate * 1.01) { gate = Math.max(minGate, gate / 2); maxD2 = gate * gate; prev = Infinity; continue; }
      converged = true; break;
    }
    prev = rmse;
    let d: Rigid & { scale: number };
    if (o.method === 'plane') {
      d = planeStep(cur, tgt, nrm, k) ?? bestFitTransform(cur, tgt, k, false);
    } else d = bestFitTransform(cur, tgt, k, !!o.withScale);
    if (o.method !== 'plane' && o.withScale && o.scaleBounds && (s * d.scale < o.scaleBounds[0] || s * d.scale > o.scaleBounds[1])) d = bestFitTransform(cur, tgt, k, false);
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

/** One linearised point-to-plane step: minimise Σ ((R p + t − q)·n)² for small rotations. */
function planeStep(p: Float32Array, q: Float32Array, n: Float32Array, k: number): (Rigid & { scale: number }) | null {
  const A = new Array(36).fill(0), b = new Array(6).fill(0);
  for (let i = 0; i < k; i++) {
    const px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2], nx = n[i * 3], ny = n[i * 3 + 1], nz = n[i * 3 + 2];
    const cx = py * nz - pz * ny, cy = pz * nx - px * nz, cz = px * ny - py * nx; // p × n
    const J = [cx, cy, cz, nx, ny, nz];
    const r = (q[i * 3] - px) * nx + (q[i * 3 + 1] - py) * ny + (q[i * 3 + 2] - pz) * nz;
    for (let a = 0; a < 6; a++) { b[a] += J[a] * r; for (let c = 0; c < 6; c++) A[a * 6 + c] += J[a] * J[c]; }
  }
  for (let a = 0; a < 6; a++) A[a * 6 + a] += 1e-9;
  // Gaussian elimination
  const m: number[][] = Array.from({ length: 6 }, (_, r) => [...A.slice(r * 6, r * 6 + 6), b[r]]);
  for (let c = 0; c < 6; c++) {
    let piv = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-14) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = c + 1; r < 6; r++) { const f = m[r][c] / m[c][c]; for (let k2 = c; k2 < 7; k2++) m[r][k2] -= f * m[c][k2]; }
  }
  const x = new Array(6).fill(0);
  for (let r = 5; r >= 0; r--) { let sum = m[r][6]; for (let c = r + 1; c < 6; c++) sum -= m[r][c] * x[c]; x[r] = sum / m[r][r]; }
  const R = eulerToR(x[2], x[1], x[0]); // small angles: yaw=x[2], pitch=x[1], roll=x[0]
  return { R, t: [x[3], x[4], x[5]], scale: 1 };
}
