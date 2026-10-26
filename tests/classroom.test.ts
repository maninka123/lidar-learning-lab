import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { parsePointCloud } from '../src/io/load';
import { voxelDownsample } from '../src/processing/ops';
import { cloudBounds, PointCloud } from '../src/core/pointcloud';
import { detectPlanes } from '../src/apps/planes';
import { slicePoints, extractWalls, extractPlan, extractPlanBands, straighten, toDXF, segLen } from '../src/apps/cad';
import { makeSeries, detectChanges } from '../src/apps/change';
import { heightMapMesh, meshStats } from '../src/apps/mesh';
import { surfaceMesh } from '../src/recon/recon';
import { icp } from '../src/registration/icp';
import { segment } from '../src/segmentation/segment';
import { transformCloud } from '../src/core/pointcloud';

/** The real classroom scan that ships with the app. */
function load(voxel: number): PointCloud {
  const buf = fs.readFileSync('public/data/classroom_scene.ply');
  const c = parsePointCloud(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, 'classroom_scene.ply');
  const b = cloudBounds(c), cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < c.count; i++) { c.positions[i * 3] -= cx; c.positions[i * 3 + 1] -= cy; c.positions[i * 3 + 2] -= b.min[2]; }
  return voxelDownsample(c, voxel);
}
const room = load(0.03);

describe('classroom scan shipped with the app', () => {
  it('has colours, labels and a sensible size', () => {
    expect(room.count).toBeGreaterThan(100000);
    expect(room.colors).toBeTruthy(); expect(room.labels).toBeTruthy();
    const b = cloudBounds(room); expect(b.max[2]).toBeGreaterThan(2.4); expect(b.max[2]).toBeLessThan(3);
  });
  it('adaptive RANSAC finds floor, ceiling and walls; fixed settings with silly values still run', { timeout: 120000 }, () => {
    const o = { threshold: 0.02, iterations: 100, confidence: 0.99, minFraction: 0.02, maxPlanes: 12, seed: 3 };
    const a = detectPlanes(room.positions, room.count, room.labels!, { ...o, mode: 'adaptive' });
    expect(a.planes.some((p) => p.kind === 'floor') && a.planes.some((p) => p.kind === 'ceiling')).toBe(true);
    expect(a.planes.filter((p) => p.kind === 'wall').length).toBeGreaterThanOrEqual(3);
    expect(a.coverage).toBeGreaterThan(0.5);
    for (const threshold of [0.002, 0.1]) for (const iterations of [10, 1000]) {
      const f = detectPlanes(room.positions, room.count, room.labels!, { ...o, mode: 'fixed', threshold, iterations, maxPlanes: 4 });
      expect(f.planes.length).toBeLessThanOrEqual(4); expect(f.coverage).toBeLessThanOrEqual(1);
    }
  });
  it('scan to CAD: finds the four walls, handles empty and extreme slices', () => {
    const fine = voxelDownsample(room, 0.02);
    const segs = straighten(extractWalls(slicePoints(fine.positions, fine.count, 1.1, 1.3), { tol: 0.04, minLen: 1, minPts: 40, maxLines: 14, gap: 2.5, seed: 4 }));
    expect(segs.length).toBeGreaterThanOrEqual(4);
    expect(segLen(segs[0])).toBeGreaterThan(7);
    expect(toDXF(segs).match(/\nLINE\n/g)!.length).toBe(segs.length);
    for (const [z0, z1] of [[0.0, 0.02], [2.6, 2.7], [10, 11]]) {
      const xy = slicePoints(fine.positions, fine.count, z0, z1);
      const r = straighten(extractWalls(xy, { tol: 0.04, minLen: 1, minPts: 40, maxLines: 14, gap: 2.5, seed: 4 }));
      expect(Array.isArray(r)).toBe(true);
    }
    expect(toDXF([]).trim().endsWith('EOF')).toBe(true);
  });
  it('change detection: five visits, every edit between neighbouring visits is found', () => {
    const series = makeSeries(room);
    expect(series.length).toBe(5);
    expect(series.map((e) => e.truth.length)).toEqual([0, 2, 1, 1, 3]);
    for (let k = 1; k < 5; k++) {
      const res = detectChanges(series[k - 1].cloud, series[k].cloud, 0.06, 80, series[k].truth);
      expect(res.recall).toBe(1); expect(res.falseRegions).toBeLessThanOrEqual(2);
    }
    const same = detectChanges(series[0].cloud, series[0].cloud, 0.06, 80, []);
    expect(same.regions.length).toBe(0);
  }, 90000);
  it('meshing: every method returns a surface, and in a sensible time', () => {
    const t0 = performance.now();
    const chairLike = voxelDownsample(room, 0.06);
    for (const method of ['voxel', 'smooth'] as const) expect(surfaceMesh(chairLike, { method, voxel: 0.06, iterations: 6 }).indices.length).toBeGreaterThan(1000);
    const h = heightMapMesh(chairLike, 0.1); expect(meshStats(h).area).toBeGreaterThan(10);
    expect(performance.now() - t0).toBeLessThan(20000);
  }, 60000);
  it('segmentation: one RANSAC plane step takes out floor and walls, then clusters the furniture', () => {
    const small = voxelDownsample(room, 0.05);
    const r = segment(small, { planeConfidence: 0.99, planeMinPct: 2, planeMax: 12, algo: 'euclidean', eps: 0.15, minPts: 8, radius: 0.15, minCluster: 30, seed: 11 });
    expect(r.planes.some((p) => p.kind === 'floor')).toBe(true);
    expect(r.planes.filter((p) => p.kind === 'wall').length).toBeGreaterThanOrEqual(3);
    expect(r.clusters.length).toBeGreaterThanOrEqual(8);
    const none = segment(small, { planeConfidence: 0.99, planeMinPct: 2, planeMax: 0, algo: 'euclidean', eps: 0.15, minPts: 8, radius: 0.15, minCluster: 30, seed: 11 });
    expect(none.planes.length).toBe(0);
  }, 120000);
  it('floor plan: four right-angle walls of a 10.6 × 5.3 m room, whatever the slice', () => {
    const fine = voxelDownsample(room, 0.02);
    const p = extractPlanBands(fine.positions, fine.count, 0.6, 2.2, { tol: 0.08, minLen: 1, gap: 2.5 });
    expect(p.walls.length).toBeGreaterThanOrEqual(4);
    expect(p.walls.every((w) => w.x1 === w.x2 || w.y1 === w.y2)).toBe(true);
    const lens = p.walls.map(segLen).sort((a, b) => b - a);
    expect(lens[0]).toBeGreaterThan(10); expect(lens[0]).toBeLessThan(11);
    for (const [a, b] of [[0, 0.02], [2.6, 2.7], [10, 11]]) expect(Array.isArray(extractPlan(slicePoints(fine.positions, fine.count, a, b), { tol: 0.08, minLen: 1, gap: 2.5 }).walls)).toBe(true);
  });
});
