import { it, expect } from 'vitest';
import { getScene } from '../src/scenes';
import { simulateScan, staticPose } from '../src/sensor/simulate';
import { PRESETS, presetToConfig } from '../src/sensor/presets';
import { segment, evaluateAgainstGT } from '../src/segmentation/segment';

it('segments a simulated room scan', () => {
  const scene = getScene('A');
  const cfg = presetToConfig(PRESETS.find((p) => p.id === 'rot32')!);
  const cloud = simulateScan({ scene, sensor: cfg, trajectory: staticPose(-0.2, 0.2, 1.4, 0), sweeps: 1, seed: 42, maxRays: 150000, distortion: false, scanId: 0 }).cloud;
  const ignore = new Set(scene.objects.filter((o) => o.structural).map((o) => o.instanceId));
  for (const algo of ['euclidean', 'dbscan'] as const) {
    for (const radius of [0.08, 0.12, 0.2, 0.3]) {
      const r = segment(cloud, { removeGround: true, extraPlanes: 5, ransacThreshold: 0.03, ransacIterations: 200, algo, eps: radius, minPts: 8, radius, minCluster: 30, seed: 11 });
      const g = evaluateAgainstGT(cloud, r, ignore)!;
      console.log(algo, radius, 'pts', cloud.count, 'planes', r.planes.map((p) => p.kind + ':' + p.count).join(','), 'clusters', r.clusters.length, 'recovered', g.recovered.length, '/', g.gtObjects, 'over', g.overSegmented, 'under', g.underSegmented, r.ms.toFixed(0) + 'ms');
    }
  }
  expect(cloud.count).toBeGreaterThan(1000);
}, 120000);
