import { PointCloud, makeId } from '../core/pointcloud';
import { makeRng } from '../core/rng';
import { SceneDef } from '../scenes/geometry';
import { simulateScan } from '../sensor/simulate';
import { SensorConfig } from '../sensor/presets';
import { icp } from './icp';
import { Rigid, eulerToR, rRoll, Vec3, rigidFromEuler, rigidApply } from '../core/math';

export interface Pose2 { x: number; y: number; yaw: number }
export type OdomMode = 'noisy' | 'icp';
export interface SlamParams {
  seed: number;
  steps: number;
  odom: OdomMode;
  transNoise: number; // m / step (1σ)
  rotNoiseDeg: number; // deg / step (1σ)
  rotBiasDeg: number; // deg / step systematic
  scaleErr: number; // fractional translation scale error
  loopClosure: boolean;
  z: number;
}
export interface SlamResult {
  gt: Pose2[];
  est: Pose2[];
  corrected: Pose2[] | null;
  maps: { gt: PointCloud; est: PointCloud; corrected: PointCloud | null };
  errBefore: number[];
  errAfter: number[] | null;
  ateBefore: number;
  ateAfter: number | null;
  finalDriftBefore: number;
  finalDriftAfter: number | null;
  overlap: number[]; // ICP fitness between consecutive scans (inlier fraction)
  icpRmse: number[];
  closure: { detected: boolean; fitness: number; rmse: number; correctionTrans: number; correctionDeg: number } | null;
  scanPoints: number;
}

const compose = (a: Pose2, d: Pose2): Pose2 => ({ x: a.x + Math.cos(a.yaw) * d.x - Math.sin(a.yaw) * d.y, y: a.y + Math.sin(a.yaw) * d.x + Math.cos(a.yaw) * d.y, yaw: a.yaw + d.yaw });
const inv = (a: Pose2): Pose2 => ({ x: -(Math.cos(a.yaw) * a.x + Math.sin(a.yaw) * a.y), y: -(-Math.sin(a.yaw) * a.x + Math.cos(a.yaw) * a.y), yaw: -a.yaw });
const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export function loopPath(scene: SceneDef, steps: number): Pose2[] {
  const { min, max } = scene.bounds;
  const cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2;
  const hx = ((max[0] - min[0]) / 2) * (scene.id === 'C' ? 0.7 : 0.72), hy = ((max[1] - min[1]) / 2) * (scene.id === 'C' ? 0.45 : 0.62);
  // city district: drive around the school block along the road centre lines (two long roads, two crossings)
  let pts: [number, number][] = scene.id === 'D' ? [[-14, 0], [14, 0], [14, 24], [-14, 24]] : [[cx - hx, cy - hy], [cx + hx, cy - hy], [cx + hx, cy + hy], [cx - hx, cy + hy]];
  for (let it = 0; it < 3; it++) { // Chaikin corner cutting on a closed polygon
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    pts = out;
  }
  // arc-length resample (closed)
  const L: number[] = [0];
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L.push(L[i] + Math.hypot(b[0] - a[0], b[1] - a[1])); }
  const total = L[L.length - 1];
  const poses: Pose2[] = [];
  for (let k = 0; k <= steps; k++) {
    const s = ((k % steps) / steps) * total;
    let i = 0;
    while (i < pts.length - 1 && L[i + 1] < s) i++;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const f = (s - L[i]) / ((L[i + 1] - L[i]) || 1);
    poses.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  poses[steps] = { ...poses[0] };
  return poses;
}

export function runSlam(scene: SceneDef, sensor: SensorConfig, p: SlamParams): SlamResult {
  const rng = makeRng(p.seed);
  const gt = loopPath(scene, p.steps);
  const n = gt.length;
  // 1. local scans (sensor frame) taken from the true poses
  const local: PointCloud[] = [];
  gt.forEach((g, k) => {
    const r = simulateScan({ scene, sensor, trajectory: [{ t: 0, x: g.x, y: g.y, z: p.z, yaw: g.yaw, pitch: 0, roll: 0 }], sweeps: 1, seed: p.seed + k * 13, maxRays: 20000, distortion: false, scanId: k });
    const c = r.cloud, cs = Math.cos(g.yaw), sn = Math.sin(g.yaw);
    for (let i = 0; i < c.count; i++) { // world -> sensor frame
      const dx = c.positions[i * 3] - g.x, dy = c.positions[i * 3 + 1] - g.y;
      c.positions[i * 3] = cs * dx + sn * dy; c.positions[i * 3 + 1] = -sn * dx + cs * dy; c.positions[i * 3 + 2] -= p.z;
    }
    local.push(c);
  });

  // 2. odometry
  const est: Pose2[] = [{ ...gt[0] }];
  const overlap: number[] = [], icpRmse: number[] = [];
  for (let k = 1; k < n; k++) {
    const rel = compose(inv(gt[k - 1]), gt[k]); // true relative motion expressed in frame k-1
    const s = 1 + p.scaleErr;
    const noisy: Pose2 = { x: rel.x * s + p.transNoise * rng.gauss(), y: rel.y * s + p.transNoise * rng.gauss(), yaw: rel.yaw + ((p.rotBiasDeg + p.rotNoiseDeg * rng.gauss()) * Math.PI) / 180 };
    let use = noisy;
    // scan matching between consecutive scans (initialised from the noisy odometry)
    const src = local[k], dst = local[k - 1];
    const init: Rigid = rigidFromEuler(noisy.x, noisy.y, 0, noisy.yaw, 0, 0);
    const res = icp(src.positions, src.count, dst.positions, dst.count, { maxIterations: 40, tolerance: 1e-5, maxCorrDist: 1.0, sampleMax: 1200, init });
    overlap.push(res.fitness); icpRmse.push(res.finalRmse);
    if (p.odom === 'icp' && res.history.length) {
      const e = rRoll(res.T.R);
      use = { x: res.T.t[0], y: res.T.t[1], yaw: e.yaw };
    }
    est.push(compose(est[k - 1], use));
  }
  if (p.odom === 'noisy') est[n - 1] = est[n - 1]; // keep as integrated

  const errOf = (poses: Pose2[]) => poses.map((q, k) => Math.hypot(q.x - gt[k].x, q.y - gt[k].y));
  const errBefore = errOf(est);
  const ate = (e: number[]) => Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length);

  // 3. loop closure (teaching approximation: scan-to-scan registration + linear error distribution)
  let corrected: Pose2[] | null = null;
  let closure: SlamResult['closure'] = null;
  if (p.loopClosure) {
    const a = local[n - 1], b = local[0];
    // Scan-to-scan registration between the last and the first scan (the loop-closure measurement).
    const res = icp(a.positions, a.count, b.positions, b.count, { maxIterations: 60, tolerance: 1e-6, maxCorrDist: 1.5, sampleMax: 1500 });
    const e = rRoll(res.T.R);
    // res.T maps frame N -> frame 0, i.e. it is the pose of N expressed in frame 0.
    const target: Pose2 = compose(est[0], { x: res.T.t[0], y: res.T.t[1], yaw: e.yaw });
    const dTheta = wrap(target.yaw - est[n - 1].yaw);
    const rotEnd = rotatedEnd(est, dTheta, 1);
    const tx = target.x - rotEnd.x, ty = target.y - rotEnd.y;
    const detected = res.fitness > 0.5;
    closure = { detected, fitness: res.fitness, rmse: res.finalRmse, correctionTrans: Math.hypot(target.x - est[n - 1].x, target.y - est[n - 1].y), correctionDeg: (dTheta * 180) / Math.PI };
    if (detected) {
      // Distribute the discrepancy linearly along the path: rotate about the start pose by f*dTheta and translate by f*t.
      corrected = est.map((q, k) => {
        const f = k / (n - 1), th = f * dTheta, c = Math.cos(th), sn = Math.sin(th);
        const rx = q.x - est[0].x, ry = q.y - est[0].y;
        return { x: est[0].x + c * rx - sn * ry + f * tx, y: est[0].y + sn * rx + c * ry + f * ty, yaw: q.yaw + th };
      });
    }
  }
  const errAfter = corrected ? errOf(corrected) : null;

  // 4. maps
  const build = (poses: Pose2[], name: string, kind: 'simulated' | 'estimated'): PointCloud => {
    const total = local.reduce((a, c) => a + c.count, 0);
    const pos = new Float32Array(total * 3), ids = new Uint16Array(total), inten = new Float32Array(total);
    let o = 0;
    local.forEach((c, k) => {
      const q = poses[k], cs = Math.cos(q.yaw), sn = Math.sin(q.yaw);
      for (let i = 0; i < c.count; i++, o++) {
        const x = c.positions[i * 3], y = c.positions[i * 3 + 1];
        pos[o * 3] = q.x + cs * x - sn * y; pos[o * 3 + 1] = q.y + sn * x + cs * y; pos[o * 3 + 2] = c.positions[i * 3 + 2] + p.z;
        ids[o] = k; inten[o] = c.intensity![i];
      }
    });
    return { id: makeId('map'), name, count: total, positions: pos, scanIds: ids, intensity: inten, meta: { kind, source: 'SLAM teaching simulation', units: 'm', sceneId: scene.id, sensor: sensor.name } };
  };
  const total = local.reduce((a, c) => a + c.count, 0);
  void eulerToR; void rigidApply;
  return {
    gt, est, corrected,
    maps: { gt: build(gt, 'Map · ground-truth poses', 'simulated'), est: build(est, 'Map · estimated poses', 'estimated'), corrected: corrected ? build(corrected, 'Map · after loop closure', 'estimated') : null },
    errBefore, errAfter, ateBefore: ate(errBefore), ateAfter: errAfter ? ate(errAfter) : null,
    finalDriftBefore: errBefore[n - 1], finalDriftAfter: errAfter ? errAfter[n - 1] : null,
    overlap, icpRmse, closure, scanPoints: total,
  };
}

/** helper: end-pose position after rotating the estimated trajectory by dTheta about the first pose */
function rotatedEnd(est: Pose2[], dTheta: number, f: number): { x: number; y: number } {
  const q = est[est.length - 1], th = f * dTheta, c = Math.cos(th), s = Math.sin(th);
  const rx = q.x - est[0].x, ry = q.y - est[0].y;
  return { x: est[0].x + c * rx - s * ry, y: est[0].y + s * rx + c * ry };
}
