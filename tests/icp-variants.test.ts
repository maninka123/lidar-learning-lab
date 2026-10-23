import { describe, it, expect } from 'vitest';
import { icp } from '../src/registration/icp';
import { rigidFromEuler, rigidApply, rigidCompose } from '../src/core/math';
import { makeRng } from '../src/core/rng';

function room(n: number) {
  const r = makeRng(3);
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const w = i % 3, a = r.range(0, 6), b = r.range(0, 4);
    if (w === 0) { p[i * 3] = a; p[i * 3 + 1] = b; p[i * 3 + 2] = 0; }
    else if (w === 1) { p[i * 3] = a; p[i * 3 + 1] = 0; p[i * 3 + 2] = b; }
    else { p[i * 3] = 0; p[i * 3 + 1] = a * 0.66; p[i * 3 + 2] = b; }
  }
  return p;
}
describe('ICP variants', () => {
  const dst = room(6000), n = 6000;
  const E = rigidFromEuler(0.12, -0.08, 0.04, 0.05, 0.01, 0);
  const src = new Float32Array(dst.length);
  for (let i = 0; i < n; i++) { const q = rigidApply(E, [dst[i * 3], dst[i * 3 + 1], dst[i * 3 + 2]]); src.set(q, i * 3); }
  for (const method of ['point', 'plane'] as const) {
    it(`${method} recovers a small rigid error`, () => {
      const r = icp(src, n, dst, n, { maxIterations: 80, tolerance: 1e-8, maxCorrDist: 1, sampleMax: 3000, method });
      const tot = rigidCompose(r.T, E);
      expect(Math.hypot(...tot.t)).toBeLessThan(0.05);
    });
  }
  it('trimmed ICP runs', () => {
    const r = icp(src, n, dst, n, { maxIterations: 60, tolerance: 1e-8, maxCorrDist: 1, sampleMax: 3000, trim: 0.7 });
    expect(r.finalRmse).toBeLessThan(0.1);
  });
});
