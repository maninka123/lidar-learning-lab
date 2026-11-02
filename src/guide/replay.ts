import { Rigid, Vec3, identity, rigidApply, rigidCompose } from '../core/math';
import type { IcpIter, IcpPair } from '../registration/icp';
import type { Pose2, SlamResult } from '../registration/slam';

// ---------------------------------------------------------------- rotations
type Quat = [number, number, number, number]; // x y z w

function rToQ(R: number[]): Quat {
  const tr = R[0] + R[4] + R[8];
  let q: Quat;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(R[7] - R[5]) / s, (R[2] - R[6]) / s, (R[3] - R[1]) / s, s / 4]; }
  else if (R[0] > R[4] && R[0] > R[8]) { const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2; q = [s / 4, (R[1] + R[3]) / s, (R[2] + R[6]) / s, (R[7] - R[5]) / s]; }
  else if (R[4] > R[8]) { const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2; q = [(R[1] + R[3]) / s, s / 4, (R[5] + R[7]) / s, (R[2] - R[6]) / s]; }
  else { const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2; q = [(R[2] + R[6]) / s, (R[5] + R[7]) / s, s / 4, (R[3] - R[1]) / s]; }
  return q;
}
function qToR([x, y, z, w]: Quat): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
/** Axis (unit) and angle (rad, 0..π) of a rotation matrix. */
export function axisAngle(R: number[]): { axis: Vec3; angle: number } {
  let q = rToQ(R); if (q[3] < 0) q = [-q[0], -q[1], -q[2], -q[3]];
  const s = Math.hypot(q[0], q[1], q[2]), angle = 2 * Math.atan2(s, q[3]);
  return { axis: s < 1e-9 ? [0, 0, 1] : [q[0] / s, q[1] / s, q[2] / s], angle };
}
/** The fraction `a` (0..1) of a rigid move: the rotation is turned a part of the way, the shift is scaled. a = 1 is the move itself. */
export function partialRigid(d: Rigid, a: number): Rigid {
  const { axis, angle } = axisAngle(d.R), h = (angle * a) / 2, s = Math.sin(h);
  return { R: qToR([axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)]), t: [d.t[0] * a, d.t[1] * a, d.t[2] * a] };
}

// ---------------------------------------------------------------- ICP replay
/** The incremental move of iteration i (identity when the solver took no step there, e.g. the converged one). */
export const deltaOf = (h: IcpIter[], i: number): Rigid => h[Math.min(i, h.length - 1)]?.delta ?? identity();
/** Pose of the moving cloud while iteration i's move is `a` done (0 = before, 1 = after). Same Rigid as the solver's T when a is 0 or 1. */
export function transformAt(h: IcpIter[], i: number, a: number): Rigid {
  const k = Math.min(Math.max(i, 0), h.length - 1);
  return rigidCompose(partialRigid(deltaOf(h, k), a), h[k].T);
}
/** The sampled correspondences of iteration i, carried along with the move. */
export function pairsAt(h: IcpIter[], i: number, a: number): IcpPair[] {
  const k = Math.min(Math.max(i, 0), h.length - 1), m = partialRigid(deltaOf(h, k), a);
  return (h[k].sample ?? []).map((p) => ({ ...p, p: rigidApply(m, p.p) }));
}
/** Index of the sampled pair to talk about: the one with the median gap, so it is typical, not an outlier. */
export function highlightPair(sample: IcpPair[]): number {
  if (!sample.length) return -1;
  return sample.map((p, i) => [p.d, i] as const).sort((a, b) => a[0] - b[0])[sample.length >> 1][1];
}
/** Distance of a pair as the solver's objective sees it: along the line (point-to-point) or along the surface normal (point-to-plane). */
export function pairResidual(p: IcpPair): number {
  return p.n ? Math.abs((p.q[0] - p.p[0]) * p.n[0] + (p.q[1] - p.p[1]) * p.n[1] + (p.q[2] - p.p[2]) * p.n[2]) : p.d;
}
/** Plain words for how an ICP run ended. `errT` (m) and `errDeg` are what is left compared with the true answer. */
export function icpVerdict(converged: boolean, errT: number, errDeg: number): 'good' | 'wrong' | 'limit' {
  if (errT > 0.05 || errDeg > 1) return 'wrong';
  return converged ? 'good' : 'limit';
}

// ---------------------------------------------------------------- SLAM replay
export const lerpPose = (a: Pose2, b: Pose2, f: number): Pose2 => {
  let dy = b.yaw - a.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, yaw: a.yaw + dy * f };
};
/** Pose at a fractional frame position along a trajectory. */
export function poseAtFrame(poses: Pose2[], f: number): Pose2 {
  const c = Math.min(Math.max(f, 0), poses.length - 1), i = Math.min(poses.length - 2, Math.floor(c));
  return poses.length < 2 ? poses[0] : lerpPose(poses[i], poses[i + 1], c - i);
}
/** The first `f` frames of a trajectory plus the interpolated current position. */
export function trailTo(poses: Pose2[], f: number): { x: number; y: number }[] {
  const k = Math.floor(Math.min(f, poses.length - 1)), out = poses.slice(0, k + 1).map((q) => ({ x: q.x, y: q.y }));
  if (k < poses.length - 1 && f > k) { const q = poseAtFrame(poses, f); out.push({ x: q.x, y: q.y }); }
  return out;
}
/** Relative motion between consecutive poses, expressed in the earlier pose's frame: what scan matching estimates. */
export function relativeMotion(a: Pose2, b: Pose2): Pose2 {
  const dx = b.x - a.x, dy = b.y - a.y, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
  let yaw = b.yaw - a.yaw; while (yaw > Math.PI) yaw -= 2 * Math.PI; while (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { x: c * dx + s * dy, y: -s * dx + c * dy, yaw };
}
/** Heading error (deg) and position error (m) of the estimate against the truth, per frame. */
export function driftAt(r: SlamResult, f: number, corrected = false): { pos: number; headingDeg: number } {
  const est = corrected && r.corrected ? r.corrected : r.est, e = poseAtFrame(est, f), g = poseAtFrame(r.gt, f);
  let dy = e.yaw - g.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
  return { pos: Math.hypot(e.x - g.x, e.y - g.y), headingDeg: (dy * 180) / Math.PI };
}
/** Poses morphing from the uncorrected estimate to the corrected one (a = 0..1). Both ends are the simulator's own results. */
export function correctionAt(r: SlamResult, a: number): Pose2[] {
  return r.corrected ? r.est.map((q, i) => lerpPose(q, r.corrected![i], a)) : r.est;
}
