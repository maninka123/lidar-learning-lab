import { describe, it, expect } from 'vitest';
import { icp, applySim } from '../src/registration/icp';
import { rigidFromEuler, rigidApply, rigidCompose, rotationAngle } from '../src/core/math';
import { makeRng } from '../src/core/rng';
import { deltaOf, transformAt, pairsAt, partialRigid, highlightPair, pairResidual, icpVerdict, axisAngle, poseAtFrame, trailTo, correctionAt, driftAt, relativeMotion } from '../src/guide/replay';
import { makeGuideStore } from '../src/guide/store';
import { exaggeration, moveFraction } from '../src/guide/IcpGuide';
import { frameFor } from '../src/guide/SlamGuide';
import type { SlamResult } from '../src/registration/slam';

function room(n: number) {
  const r = makeRng(3), p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const w = i % 3, a = r.range(0, 6), b = r.range(0, 4); if (w === 0) p.set([a, b, 0], i * 3); else if (w === 1) p.set([a, 0, b], i * 3); else p.set([0, a * 0.66, b], i * 3); }
  return p;
}
const n = 3000, dst = room(n), E = rigidFromEuler(0.3, -0.2, 0.05, 0.1, 0.02, 0);
const src = new Float32Array(dst.length);
for (let i = 0; i < n; i++) src.set(rigidApply(E, [dst[i * 3], dst[i * 3 + 1], dst[i * 3 + 2]]), i * 3);

describe('ICP iteration replay', () => {
  for (const method of ['point', 'plane'] as const) {
    const res = icp(src, n, dst, n, { maxIterations: 40, tolerance: 1e-7, maxCorrDist: 1, sampleMax: 1500, method });
    const h = res.history;
    it(`${method}: each step's move carries T of one iteration to the next`, () => {
      let checked = 0;
      for (let i = 0; i + 1 < h.length; i++) {
        if (!h[i].delta) continue;
        const a = rigidCompose(h[i].delta!, h[i].T), b = h[i + 1].T;
        for (let j = 0; j < 9; j++) expect(a.R[j]).toBeCloseTo(b.R[j], 6);
        for (let j = 0; j < 3; j++) expect(a.t[j]).toBeCloseTo(b.t[j], 6);
        checked++;
      }
      expect(checked).toBeGreaterThan(2);
    });
    it(`${method}: transformAt matches the solver at 0 and 1`, () => {
      const T0 = transformAt(h, 0, 0), T1 = transformAt(h, 0, 1);
      expect(T0.t).toEqual(h[0].T.t);
      for (let j = 0; j < 3; j++) expect(T1.t[j]).toBeCloseTo(h[1].T.t[j], 6);
    });
    it(`${method}: sampled correspondences are the real pairs`, () => {
      h.forEach((it) => {
        expect(it.sample!.length).toBeGreaterThan(0);
        expect(it.sample!.length).toBeLessThanOrEqual(48);
        it.sample!.forEach((p) => {
          const exp = applySim(it.T, it.scale, [src[p.si * 3], src[p.si * 3 + 1], src[p.si * 3 + 2]]);
          for (let j = 0; j < 3; j++) expect(p.p[j]).toBeCloseTo(exp[j], 3);
          expect(p.d).toBeCloseTo(Math.hypot(p.p[0] - p.q[0], p.p[1] - p.q[1], p.p[2] - p.q[2]), 9);
          expect(p.d).toBeLessThanOrEqual((it.gate ?? 1) + 1e-6);
          expect(!!p.n).toBe(method === 'plane');
        });
      });
    });
    it(`${method}: chart values equal the solver's RMSE, and the sample is never wildly unlike it`, () => {
      expect(h.map((x) => x.rmse)).toEqual(h.map((x) => x.rmse));
      expect(h[h.length - 1].rmse).toBeLessThan(h[0].rmse);
      const it0 = h[0], mean = Math.sqrt(it0.sample!.reduce((a, p) => a + p.d * p.d, 0) / it0.sample!.length);
      expect(mean).toBeLessThan(it0.rmse * 3);
    });
  }
  it('plane residual is the part across the surface, never longer than the line', () => {
    const res = icp(src, n, dst, n, { maxIterations: 5, tolerance: 1e-9, maxCorrDist: 1, sampleMax: 800, method: 'plane' });
    res.history[0].sample!.forEach((p) => expect(pairResidual(p)).toBeLessThanOrEqual(p.d + 1e-6));
  });
  it('partial moves interpolate the shift and the turn', () => {
    const d = rigidFromEuler(1, 2, 3, 0.4, 0, 0), half = partialRigid(d, 0.5), full = partialRigid(d, 1);
    expect(half.t).toEqual([0.5, 1, 1.5]);
    expect(rotationAngle(half.R)).toBeCloseTo(0.2, 6);
    expect(rotationAngle(full.R)).toBeCloseTo(0.4, 6);
    expect(axisAngle(d.R).axis[2]).toBeCloseTo(1, 6);
  });
  it('picks a typical pair and judges the run in plain words', () => {
    expect(highlightPair([])).toBe(-1);
    expect(highlightPair([{ si: 0, p: [0, 0, 0], q: [0, 0, 1], d: 1 }, { si: 1, p: [0, 0, 0], q: [0, 0, 3], d: 3 }, { si: 2, p: [0, 0, 0], q: [0, 0, 2], d: 2 }])).toBe(2);
    expect(icpVerdict(true, 0.01, 0.1)).toBe('good');
    expect(icpVerdict(true, 0.6, 5)).toBe('wrong');
    expect(icpVerdict(false, 0.01, 0.1)).toBe('limit');
  });
  it('a poor start can end in a wrong local solution that the gap alone does not reveal', () => {
    const far = rigidFromEuler(1.5, -1.2, 0, 1.4, 0, 0), s2 = new Float32Array(dst.length);
    for (let i = 0; i < n; i++) s2.set(rigidApply(far, [dst[i * 3], dst[i * 3 + 1], dst[i * 3 + 2]]), i * 3);
    const r = icp(s2, n, dst, n, { maxIterations: 60, tolerance: 1e-7, maxCorrDist: 1, sampleMax: 1500 });
    const tot = rigidCompose(r.T, far), err = Math.hypot(...tot.t);
    expect(icpVerdict(r.converged, err, (rotationAngle(tot.R) * 180) / Math.PI)).toBe('wrong');
  });
  it('arrow exaggeration is 1 for big moves and capped for tiny ones', () => {
    expect(exaggeration(5, 10)).toBe(1); expect(exaggeration(0.001, 10)).toBe(60); expect(exaggeration(0, 10)).toBe(1);
    expect(moveFraction(2, 0.7)).toBe(0); expect(moveFraction(3, 1)).toBe(1);
  });
});

describe('guide controls', () => {
  const use = makeGuideStore(5);
  it('steps, plays, pauses and restarts without leaving the range', () => {
    const g = () => use.getState();
    g().start(); expect(g().on && g().step === 0).toBe(true);
    g().goto(9); expect(g().step).toBe(4); g().goto(-3); expect(g().step).toBe(0);
    g().goto(2); g().setProgress(0.6); g().play(); expect(g().playing).toBe(true); g().pause(); expect(g().playing).toBe(false);
    g().scrub(0.3); expect(g().hold).toBe(true); g().goto(3); expect(g().hold).toBe(false);
    g().setIter(4, 0.2); g().restart(); expect(g().step === 0 && g().iter === 0 && g().progress === 0).toBe(true);
    g().close(); expect(g().on).toBe(false);
  });
});

describe('SLAM playback', () => {
  const gt = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0, yaw: 0 }));
  const est = gt.map((q, i) => ({ x: q.x, y: i * 0.1, yaw: i * 0.02 }));
  const corrected = gt.map((q, i) => ({ x: q.x, y: i * 0.1 * (1 - i / 10), yaw: 0 }));
  const r = { gt, est, corrected, errBefore: est.map((q, i) => Math.hypot(q.x - gt[i].x, q.y - gt[i].y)) } as unknown as SlamResult;
  it('interpolates poses and trails by frame', () => {
    expect(poseAtFrame(gt, 2.5).x).toBeCloseTo(2.5); expect(poseAtFrame(gt, 99).x).toBe(10); expect(poseAtFrame(gt, -1).x).toBe(0);
    expect(trailTo(gt, 3.5).length).toBe(5); expect(trailTo(gt, 3).length).toBe(4);
  });
  it('drift grows along the path and matches the stored per-pose error', () => {
    expect(driftAt(r, 0).pos).toBe(0);
    expect(driftAt(r, 10).pos).toBeCloseTo(r.errBefore[10], 9);
    expect(driftAt(r, 10).pos).toBeGreaterThan(driftAt(r, 3).pos);
    expect(driftAt(r, 10).headingDeg).toBeCloseTo((0.2 * 180) / Math.PI, 6);
  });
  it('the correction morphs between the real uncorrected and corrected paths', () => {
    expect(correctionAt(r, 0)[7].y).toBeCloseTo(est[7].y); expect(correctionAt(r, 1)[7].y).toBeCloseTo(corrected[7].y);
    expect(correctionAt(r, 0.5)[7].y).toBeCloseTo((est[7].y + corrected[7].y) / 2);
    expect(correctionAt({ ...r, corrected: null } as SlamResult, 1)[7].y).toBe(est[7].y);
  });
  it('relative motion is in the earlier pose frame', () => {
    const m = relativeMotion({ x: 0, y: 0, yaw: Math.PI / 2 }, { x: 0, y: 1, yaw: Math.PI / 2 + 0.1 });
    expect(m.x).toBeCloseTo(1); expect(m.y).toBeCloseTo(0); expect(m.yaw).toBeCloseTo(0.1);
  });
  it('the playhead covers the path in step 2 and rests at the end afterwards', () => {
    expect(frameFor(1, 0.5, 11)).toBe(5); expect(frameFor(3, 0, 11)).toBe(10); expect(frameFor(0, 1, 11)).toBe(6); expect(frameFor(2, 0.4, 11, true)).toBeCloseTo(4);
  });
});

describe('route drawn by the student', () => {
  it('a route of waypoints is closed, evenly stepped, and ends where it starts', async () => {
    const { pathFromWaypoints } = await import('../src/registration/slam');
    const p = pathFromWaypoints([[0, 0], [10, 0], [10, 6], [0, 6]], 40);
    expect(p.length).toBe(41);
    expect(p[40]).toEqual(p[0]);
    const step = p.slice(1).map((q, i) => Math.hypot(q.x - p[i].x, q.y - p[i].y));
    expect(Math.max(...step) / Math.min(...step)).toBeLessThan(1.5);
    expect(p.every((q) => q.x > -0.5 && q.x < 10.5 && q.y > -0.5 && q.y < 6.5)).toBe(true);
  });
});
