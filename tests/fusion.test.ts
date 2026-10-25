import { describe, it, expect } from 'vitest';
import { cameraPose, project, solveExtrinsic, reprojection, rmsPx } from '../src/apps/fusion';
import { makeRng } from '../src/core/rng';

describe('LiDAR–camera calibration', () => {
  const rig = { x: 0.3, y: -0.2, z: 1.4, yaw: 0.2 }, truth = { tx: 0.14, ty: -0.09, tz: 0.11, yawDeg: 2.5, pitchDeg: -4 };
  const rng = makeRng(2);
  const X = Array.from({ length: 40 }, () => [rng.range(2, 6) + rig.x, rng.range(-2.5, 2.5) + rig.y, rng.range(0, 2.5)] as [number, number, number]);
  const W = 320, H = 240, fov = 60;
  const cam = cameraPose(rig, truth);
  const m = X.map((p) => { const q = project(cam, p, W, H, fov)!; return [q.u + 0.5 * rng.gauss(), q.v + 0.5 * rng.gauss()] as [number, number]; });
  it('a point straight ahead lands in the middle of the image', () => {
    const c = cameraPose({ x: 0, y: 0, z: 1, yaw: 0 }, { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 });
    const q = project(c, [5, 0, 1], W, H, fov)!; expect(Math.abs(q.u - 159.5)).toBeLessThan(0.01); expect(Math.abs(q.v - 119.5)).toBeLessThan(0.01);
  });
  it('recovers the offset from noisy matches', () => {
    const r = solveExtrinsic(rig, X, m, { tx: 0, ty: 0, tz: 0, yawDeg: 0, pitchDeg: 0 }, W, H, fov);
    expect(r.rms).toBeLessThan(1);
    expect(Math.hypot(r.e.tx - truth.tx, r.e.ty - truth.ty, r.e.tz - truth.tz)).toBeLessThan(0.03);
    expect(Math.abs(r.e.yawDeg - truth.yawDeg)).toBeLessThan(0.5);
    expect(rmsPx(reprojection(rig, truth, X, m, W, H, fov))).toBeLessThan(1);
  });
});
