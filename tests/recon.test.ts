import { describe, it, expect } from 'vitest';
import { reconstruct, scanObject, alignToLidar, compareReconstruction, ReconMethod } from '../src/recon/recon';

describe('image-to-3D comparison (simulated pipelines)', () => {
  const lidar = scanObject('chair', 5, 2);
  for (const method of ['photogrammetry', 'rgbd', 'monocular'] as ReconMethod[]) {
    it(`${method}: reconstructs, aligns (with scale) and measures`, () => {
      const t0 = Date.now();
      const out = reconstruct({ object: 'chair', method, views: 8, seed: 5 });
      const al = alignToLidar(out.cloud, lidar);
      const cmp = al.valid ? compareReconstruction('chair', al.aligned, lidar) : null;
      console.log(method, 'lidar', lidar.count, 'recon', out.cloud.count, 'scale', al.scale.toFixed(3), 'true', out.hiddenTransform ? (1 / out.hiddenTransform.scale).toFixed(3) : '-', 'fit', al.fitness.toFixed(2), 'rmse', al.rmse.toFixed(4), 'valid', al.valid, cmp ? `mean ${(cmp.stats.accuracyVsLidar.mean * 1000).toFixed(1)}mm compRecon ${cmp.stats.completenessRecon.toFixed(2)} compLidar ${cmp.stats.completenessLidar.toFixed(2)}` : '', Date.now() - t0, 'ms');
      expect(out.cloud.count).toBeGreaterThan(500);
      if (method === 'photogrammetry' && out.hiddenTransform) expect(Math.abs(al.scale - 1 / out.hiddenTransform.scale)).toBeLessThan(0.1);
    }, 120000);
  }
});
