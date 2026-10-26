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

import { surfaceMesh } from '../src/recon/recon';
describe('images and meshing', () => {
  it('returns the scene overview plus the views used, and both meshing methods give triangles', () => {
    const out = reconstruct({ object: 'crate', method: 'photogrammetry', views: 4, seed: 3 });
    expect(out.photos.length).toBe(2 + 4);
    expect(out.photos[0].label).toContain('Scene overview');
    for (const method of ['voxel', 'smooth'] as const) {
      const m = surfaceMesh(out.cloud, { method, voxel: 0.03 });
      expect(m.indices.length).toBeGreaterThan(300);
    }
  });
});

import { RECON_SCENES, ReconObjectId } from '../src/recon/recon';
describe('scenes', () => {
  for (const id of Object.keys(RECON_SCENES) as ReconObjectId[]) {
    it(`${id}: LiDAR and RGB-D reconstruction both see the scene and align`, () => {
      const lidar = scanObject(id, 5, 2), out = reconstruct({ object: id, method: 'rgbd', views: 8, seed: 5 });
      expect(lidar.count).toBeGreaterThan(1500); expect(out.cloud.count).toBeGreaterThan(3000);
      expect(alignToLidar(out.cloud, lidar).valid).toBe(true);
    }, 120000);
  }
});
