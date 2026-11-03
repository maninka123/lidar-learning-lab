import { PointCloud, concatClouds, transformCloud } from '../core/pointcloud';
import { Rigid, identity, rigidCompose, rotationAngle, R2D } from '../core/math';
import { voxelDownsample } from '../processing/ops';
import { icp, evaluateAlignment } from '../registration/icp';
import type { ScanData } from './acquire';

/** Registration: every scan is recorded in its own scanner's coordinate system. Registration finds how to move each one into a common frame.
 *  These settings are part of the team's design, so the final evaluation uses exactly what the team tuned here. */
export interface RegParams {
  /** merge = only place scans where the scanners were put; first = align every scan to the first; sequential = align each to the one before (mobile) */
  mode: 'merge' | 'first' | 'sequential';
  method: 0 | 1; // 0 point-to-point, 1 point-to-plane
  dist: number; // match distance (m)
  iters: number;
  trim: number; // keep this % of the best pairs
  voxel: number; // registration works on a thinned copy of the scans (m)
  /** start from the positions the scanners were placed at (with their small installation error); without it every scan starts at the origin of its own frame */
  guess: boolean;
}
export const DEFAULT_REG: RegParams = { mode: 'first', method: 1, dist: 0.5, iters: 40, trim: 60, voxel: 0.1, guess: true };
export const defaultRegFor = (mobile: boolean): RegParams => ({ ...DEFAULT_REG, mode: mobile ? 'sequential' : 'first' });
export const regOf = (r: Partial<RegParams> | undefined, mobile: boolean): RegParams => ({ ...defaultRegFor(mobile), ...(r ?? {}) });

export interface ScanReg { name: string; rmseBefore: number; rmseAfter: number; overlapBefore: number; overlapAfter: number; accepted: boolean; moveCm: number; turnDeg: number }
export interface RegReport { mode: RegParams['mode']; rmse: number; overlap: number; scans: ScanReg[]; note: string }
export interface RegResult { cloud: PointCloud; clouds: PointCloud[]; poses: Rigid[]; report: RegReport }

/** how close two scans lie once registered, judged the same way whatever the match distance chosen: RMS gap of points that have a partner within 30 cm, and how many do */
export const EVAL_GATE = 0.3;
const vox = (c: PointCloud, s: number) => (s > 0 ? voxelDownsample(c, s) : c);

export function registerScans(scans: ScanData[], p: RegParams): RegResult {
  const base = scans.map((s) => (p.guess ? s.cloud : s.local)), basePose = scans.map((s) => (p.guess ? s.pose : identity()));
  const poses: Rigid[] = [], clouds: PointCloud[] = [], rep: ScanReg[] = [];
  const method = p.method === 1 ? 'plane' : 'point', trim = p.trim / 100;
  if (!scans.length) return { cloud: concatClouds([], 'Merged survey'), clouds, poses, report: { mode: p.mode, rmse: NaN, overlap: 0, scans: [], note: 'no scans' } };
  let ref = vox(base[0], p.voxel), prev = ref;
  poses.push(basePose[0]); clouds.push(base[0]);
  let used = 0, rejected = 0;
  for (let k = 1; k < scans.length; k++) {
    const src = vox(base[k], p.voxel), dst = p.mode === 'sequential' ? prev : ref;
    const before = evaluateAlignment(src.positions, src.count, dst.positions, dst.count, identity(), EVAL_GATE, 4000);
    let T: Rigid = identity(), ok = false;
    if (p.mode !== 'merge') {
      const r = icp(src.positions, src.count, dst.positions, dst.count, { maxIterations: p.iters, tolerance: 1e-5, maxCorrDist: p.dist, sampleMax: 6000, method, trim: trim < 1 ? trim : undefined });
      const big = Math.hypot(...r.T.t) > (p.guess ? 1.5 : 60) || rotationAngle(r.T.R) > (p.guess ? 0.14 : 4); // a small fix is plausible when the scanner position is known; without it anything goes
      ok = r.history.length > 0 && Number.isFinite(r.finalRmse) && !big; if (ok) T = r.T;
    }
    if (ok) used++; else if (p.mode !== 'merge') rejected++;
    const aligned = ok ? transformCloud(src, T) : src, after = evaluateAlignment(aligned.positions, aligned.count, dst.positions, dst.count, identity(), EVAL_GATE, 4000);
    clouds.push(ok ? transformCloud(base[k], T, base[k].name) : base[k]); poses.push(rigidCompose(T, basePose[k]));
    rep.push({ name: scans[k].name, rmseBefore: before.rmse, rmseAfter: after.rmse, overlapBefore: before.fitness, overlapAfter: after.fitness, accepted: ok, moveCm: 100 * Math.hypot(...T.t), turnDeg: rotationAngle(T.R) * R2D });
    prev = aligned; if (p.mode !== 'sequential') { ref = concatClouds([ref, aligned], 'ref'); if (ref.count > 80000) ref = vox(ref, Math.max(p.voxel, 0.15)); }
  }
  const good = rep.filter((r) => Number.isFinite(r.rmseAfter)), rmse = good.length ? good.reduce((a, r) => a + r.rmseAfter, 0) / good.length : scans.length === 1 ? 0 : NaN;
  const overlap = rep.length ? rep.reduce((a, r) => a + r.overlapAfter, 0) / rep.length : 1;
  const note = p.mode === 'merge' ? `${scans.length} scans placed where the scanners were put` : `${used} of ${scans.length - 1} scans aligned by ICP${rejected ? `, ${rejected} rejected (correction too large)` : ''}`;
  return { cloud: concatClouds(clouds, 'Merged survey', { kind: 'processed', source: 'Registered scans' }), clouds, poses, report: { mode: p.mode, rmse, overlap, scans: rep, note } };
}
