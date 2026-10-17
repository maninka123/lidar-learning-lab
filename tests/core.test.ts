import { describe, it, expect } from 'vitest';
import { RayScene, newHit, box, finalize, SceneDef, getScene } from '../src/scenes';
import { simulateScan, staticPose, sweepDirections } from '../src/sensor/simulate';
import { PRESETS, presetToConfig, SensorConfig } from '../src/sensor/presets';
import { newCloud, PointCloud, cloudBounds } from '../src/core/pointcloud';
import { makeRng } from '../src/core/rng';
import { voxelDownsample, randomDownsample, gaussianNoise, addOutliers, statisticalOutlierRemoval, radiusOutlierRemoval } from '../src/processing/ops';
import { ransacPlane } from '../src/segmentation/ransac';
import { dbscan, euclideanClustering } from '../src/segmentation/clustering';
import { icp } from '../src/registration/icp';
import { rigidFromEuler, rigidApply, D2R, rotationAngle, mulR, transposeR } from '../src/core/math';
import { KDTree } from '../src/core/kdtree';

function wallScene(): SceneDef {
  const objs = finalize([
    { id: 'wall', name: 'wall', classId: 2, color: [200, 200, 200], reflectivity: 0.8, parts: [box([5.1, 0, 0], [0.2, 40, 40])] },
  ] as never);
  return { id: 'T', name: 't', description: '', objects: objs, bounds: { min: [0, -20, -20], max: [5, 20, 20] }, defaultPose: { x: 0, y: 0, z: 0, yaw: 0 }, cameraHome: [0, 0, 0], cameraTarget: [0, 0, 0] };
}
const cfg = (patch: Partial<SensorConfig> = {}): SensorConfig => ({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), noise: 0, ...patch });

describe('ray casting', () => {
  it('measures the exact range to a known planar wall', () => {
    const rs = new RayScene(wallScene());
    const hit = newHit();
    expect(rs.cast(0, 0, 0, 1, 0, 0, 0, 100, hit)).toBe(true);
    expect(hit.t).toBeCloseTo(5, 6);
    expect(hit.nx).toBeCloseTo(-1, 6);
    // oblique ray: range = 5 / cos(angle)
    const a = 30 * D2R;
    rs.cast(0, 0, 0, Math.cos(a), Math.sin(a), 0, 0, 100, hit);
    expect(hit.t).toBeCloseTo(5 / Math.cos(a), 6);
  });
  it('simulated scan points lie on the wall plane with correct sensor range', () => {
    const r = simulateScan({ scene: wallScene(), sensor: cfg({ hFov: 60, hRes: 1 }), trajectory: staticPose(0, 0, 0, 0), sweeps: 1, seed: 1, maxRays: 1e5, distortion: false, scanId: 0 });
    expect(r.cloud.count).toBeGreaterThan(100);
    for (let i = 0; i < r.cloud.count; i++) expect(r.cloud.positions[i * 3]).toBeCloseTo(5, 4);
    for (let i = 0; i < r.cloud.count; i++) {
      const [x, y, z] = [r.cloud.positions[i * 3], r.cloud.positions[i * 3 + 1], r.cloud.positions[i * 3 + 2]];
      expect(r.cloud.ranges![i]).toBeCloseTo(Math.hypot(x, y, z), 4);
    }
  });
});

describe('FOV and resolution', () => {
  const scan = (patch: Partial<SensorConfig>) => simulateScan({ scene: wallScene(), sensor: cfg(patch), trajectory: staticPose(0, 0, 0, 0), sweeps: 1, seed: 1, maxRays: 1e6, distortion: false, scanId: 0 });
  it('wider FOV covers a wider region of the wall', () => {
    const a = cloudBounds(scan({ hFov: 40, hRes: 1 }).cloud), b = cloudBounds(scan({ hFov: 80, hRes: 1 }).cloud);
    expect(b.max[1] - b.min[1]).toBeGreaterThan(a.max[1] - a.min[1]);
    expect(b.max[1]).toBeCloseTo(5 * Math.tan(40 * D2R), 0);
  });
  it('finer angular resolution gives more points and tighter spacing', () => {
    const coarse = scan({ hFov: 60, hRes: 1 }), fine = scan({ hFov: 60, hRes: 0.25 });
    expect(fine.cloud.count).toBeGreaterThan(coarse.cloud.count * 3);
    const d = sweepDirections(cfg({ hFov: 60, hRes: 0.5 }), 0);
    expect(d.n).toBe(121 * 16);
  });
  it('more channels give more points', () => {
    expect(scan({ channels: 32, vMin: -15, vMax: 15, hFov: 60 }).cloud.count).toBeGreaterThan(scan({ channels: 16, hFov: 60 }).cloud.count);
  });
});

describe('sensor motion and intensity', () => {
  it('moving the scanner changes the measurements', () => {
    const scene = getScene('A');
    const run = (x: number) => simulateScan({ scene, sensor: cfg({ hRes: 1 }), trajectory: staticPose(x, 0, 1.4, 0), sweeps: 1, seed: 1, maxRays: 1e5, distortion: false, scanId: 0 });
    const a = run(-1), b = run(1);
    let diff = 0;
    for (let i = 0; i < Math.min(a.cloud.count, b.cloud.count); i++) diff += Math.abs(a.cloud.ranges![i] - b.cloud.ranges![i]);
    expect(diff).toBeGreaterThan(10);
  });
  it('is deterministic for a fixed seed', () => {
    const scene = getScene('A');
    const run = () => simulateScan({ scene, sensor: cfg({ hRes: 2, noise: 0.02 }), trajectory: staticPose(0, 0, 1.4, 0), sweeps: 1, seed: 7, maxRays: 1e5, distortion: false, scanId: 0 });
    expect(Array.from(run().cloud.positions.slice(0, 60))).toEqual(Array.from(run().cloud.positions.slice(0, 60)));
  });
  it('intensity is separate from RGB (dark-but-reflective vs bright-but-matte surfaces)', () => {
    const objs = finalize([
      { id: 'a', name: 'bright matte', classId: 6, color: [250, 250, 250], reflectivity: 0.05, parts: [box([5, -2, 0], [0.2, 3, 3])] },
      { id: 'b', name: 'dark retro', classId: 6, color: [20, 20, 20], reflectivity: 0.95, parts: [box([5, 2, 0], [0.2, 3, 3])] },
    ] as never);
    const scene: SceneDef = { ...wallScene(), objects: objs };
    const r = simulateScan({ scene, sensor: cfg({ hFov: 120, hRes: 2, channels: 1, vMin: 0, vMax: 0 }), trajectory: staticPose(0, 0, 0, 0), sweeps: 1, seed: 1, maxRays: 1e5, distortion: false, scanId: 0 });
    const c = r.cloud;
    let iA = 0, nA = 0, iB = 0, nB = 0, cA = 0, cB = 0;
    for (let i = 0; i < c.count; i++) {
      if (c.instances![i] === 1) { iA += c.intensity![i]; cA += c.colors![i * 3]; nA++; } else { iB += c.intensity![i]; cB += c.colors![i * 3]; nB++; }
    }
    expect(nA).toBeGreaterThan(0); expect(nB).toBeGreaterThan(0);
    expect(iB / nB).toBeGreaterThan(iA / nA);
    expect(cA / nA).toBeGreaterThan(cB / nB);
  });
  it('motion creates distortion relative to the correct per-point pose', () => {
    const scene = getScene('A');
    const traj = [{ t: 0, x: -2, y: 0, z: 1.4, yaw: 0, pitch: 0, roll: 0 }, { t: 1, x: 2, y: 0, z: 1.4, yaw: 0, pitch: 0, roll: 0 }];
    const run = (distortion: boolean) => simulateScan({ scene, sensor: cfg({ hRes: 1 }), trajectory: traj, sweeps: 1, seed: 1, maxRays: 1e5, distortion, scanId: 0 });
    const good = run(false), bad = run(true);
    expect(good.cloud.count).toBe(bad.cloud.count);
    let d = 0;
    for (let i = 0; i < good.cloud.positions.length; i++) d += Math.abs(good.cloud.positions[i] - bad.cloud.positions[i]);
    expect(d).toBeGreaterThan(1);
  });
});

function planeWithNoise(n: number, seed: number): PointCloud {
  const c = newCloud(n, 'plane', { kind: 'simulated', source: 'test' });
  const rng = makeRng(seed);
  for (let i = 0; i < n; i++) { c.positions[i * 3] = rng.range(-2, 2); c.positions[i * 3 + 1] = rng.range(-2, 2); c.positions[i * 3 + 2] = 0.3 + 0.005 * rng.gauss(); }
  return c;
}
function blobs(): { c: PointCloud; truth: Int32Array } {
  const centers = [[0, 0, 0], [3, 0, 0], [0, 3, 0]];
  const n = 300;
  const c = newCloud(n * centers.length, 'blobs', { kind: 'simulated', source: 'test' });
  const truth = new Int32Array(c.count);
  const rng = makeRng(5);
  centers.forEach((ce, k) => { for (let i = 0; i < n; i++) { const j = k * n + i; for (let a = 0; a < 3; a++) c.positions[j * 3 + a] = ce[a] + 0.1 * rng.gauss(); truth[j] = k; } });
  return { c, truth };
}

describe('processing', () => {
  it('voxel downsampling reduces (or preserves) the point count', () => {
    const c = planeWithNoise(5000, 1);
    expect(voxelDownsample(c, 0.2).count).toBeLessThan(c.count);
    expect(voxelDownsample(c, 1e-6).count).toBeLessThanOrEqual(c.count);
    expect(randomDownsample(c, 0.3, 1).count).toBeLessThan(c.count);
  });
  it('noise injection modifies positions reproducibly', () => {
    const c = planeWithNoise(500, 1);
    const a = gaussianNoise(c, 0.05, 3), b = gaussianNoise(c, 0.05, 3), d = gaussianNoise(c, 0.05, 4);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.positions)).not.toEqual(Array.from(c.positions));
    expect(Array.from(a.positions)).not.toEqual(Array.from(d.positions));
  });
  it('SOR and ROR remove injected outliers while keeping most of the object', () => {
    const base = planeWithNoise(4000, 2);
    const dirty = addOutliers(base, 0.05, 9);
    const injected = dirty.count - base.count;
    for (const cleaned of [statisticalOutlierRemoval(dirty, 16, 1.0), radiusOutlierRemoval(dirty, 0.3, 4)]) {
      let remaining = 0;
      for (let i = 0; i < cleaned.count; i++) remaining += cleaned.tags![i];
      expect(1 - remaining / injected).toBeGreaterThan(0.7);
      expect(cleaned.count - remaining).toBeGreaterThan(base.count * 0.85);
    }
  });
});

describe('segmentation', () => {
  it('RANSAC recovers a known plane', () => {
    const c = planeWithNoise(3000, 3);
    const fit = ransacPlane(c.positions, c.count, { threshold: 0.02, iterations: 100, seed: 1 })!;
    expect(Math.abs(fit.normal[2])).toBeGreaterThan(0.999);
    expect(Math.abs(fit.d / fit.normal[2])).toBeCloseTo(0.3, 1);
    expect(fit.inliers.length).toBeGreaterThan(2800);
  });
  it('DBSCAN separates well-separated clusters; Euclidean clustering agrees', () => {
    const { c, truth } = blobs();
    const r = dbscan(c.positions, c.count, 0.3, 5);
    expect(r.clusters).toBe(3);
    for (let k = 0; k < 3; k++) { const set = new Set<number>(); for (let i = 0; i < c.count; i++) if (truth[i] === k && r.labels[i] >= 0) set.add(r.labels[i]); expect(set.size).toBe(1); }
    expect(euclideanClustering(c.positions, c.count, 0.4, 20).clusters).toBe(3);
  });
});

describe('registration', () => {
  it('ICP recovers a known small rigid transformation', () => {
    const scan = simulateScan({ scene: getScene('A'), sensor: cfg({ ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 1, noise: 0.002 }), trajectory: staticPose(-0.2, 0.2, 1.4, 0), sweeps: 1, seed: 4, maxRays: 1e5, distortion: false, scanId: 0 }).cloud;
    const T = rigidFromEuler(0.08, -0.05, 0.03, 2 * D2R, 0.5 * D2R, -0.5 * D2R);
    const moved = new Float32Array(scan.positions.length);
    for (let i = 0; i < scan.count; i++) {
      const p = rigidApply(T, [scan.positions[i * 3], scan.positions[i * 3 + 1], scan.positions[i * 3 + 2]]);
      moved.set(p, i * 3);
    }
    const res = icp(moved, scan.count, scan.positions, scan.count, { maxIterations: 60, tolerance: 1e-6, maxCorrDist: 1, sampleMax: 3000 });
    // res.T maps moved -> original, so res.T∘T ≈ I
    const rel = mulR(res.T.R, T.R);
    expect(rotationAngle(rel) / D2R).toBeLessThan(0.5);
    const p = rigidApply(res.T, rigidApply(T, [1, 2, 1]));
    expect(Math.hypot(p[0] - 1, p[1] - 2, p[2] - 1)).toBeLessThan(0.03);
    expect(res.history[res.history.length - 1].rmse).toBeLessThan(res.history[0].rmse * 0.5);
    void transposeR;
  });
});

describe('kd-tree', () => {
  it('matches brute force nearest neighbour', () => {
    const rng = makeRng(2);
    const pts = new Float32Array(3000);
    for (let i = 0; i < pts.length; i++) pts[i] = rng.range(-1, 1);
    const t = new KDTree(pts);
    for (let q = 0; q < 50; q++) {
      const x = rng.range(-1, 1), y = rng.range(-1, 1), z = rng.range(-1, 1);
      let best = Infinity;
      for (let i = 0; i < 1000; i++) best = Math.min(best, (pts[i * 3] - x) ** 2 + (pts[i * 3 + 1] - y) ** 2 + (pts[i * 3 + 2] - z) ** 2);
      expect(t.nearest(x, y, z).dist2).toBeCloseTo(best, 6);
    }
  });
});

import { exportCloud, parsePointCloud } from '../src/io/load';
describe('import / export', () => {
  const sample = () => simulateScan({ scene: getScene('A'), sensor: cfg({ hRes: 3 }), trajectory: staticPose(0, 0, 1.4, 0), sweeps: 1, seed: 2, maxRays: 1e5, distortion: false, scanId: 3 }).cloud;
  for (const fmt of ['ply', 'ply-ascii', 'pcd', 'pcd-ascii'] as const) {
    it(`round-trips ${fmt} with attributes`, () => {
      const c = sample();
      const e = exportCloud(c, fmt);
      const back = parsePointCloud(e.data, e.filename);
      expect(back.count).toBe(c.count);
      expect(back.colors).toBeTruthy(); expect(back.intensity).toBeTruthy(); expect(back.normals).toBeTruthy(); expect(back.labels).toBeTruthy();
      const tol = fmt.endsWith('ascii') ? 1e-4 : 1e-5;
      for (let i = 0; i < c.count; i += 17) {
        expect(back.positions[i * 3]).toBeCloseTo(c.positions[i * 3], 4);
        expect(back.intensity![i]).toBeCloseTo(c.intensity![i], 4);
        expect(back.colors![i * 3 + 1]).toBe(c.colors![i * 3 + 1]);
        expect(back.labels![i]).toBe(c.labels![i]);
        expect(Math.abs(back.normals![i * 3 + 2] - c.normals![i * 3 + 2])).toBeLessThan(tol * 10);
      }
    });
  }
});
