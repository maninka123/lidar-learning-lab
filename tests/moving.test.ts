import { describe, it, expect } from 'vitest';
import { simulateScan, staticPose } from '../src/sensor/simulate';
import { PRESETS, presetToConfig } from '../src/sensor/presets';
import { ACTORS, N_FRAMES, DT, EGO, SEG_METHOD, sceneAt, segmentFrame, trackObjects, buildTemporal, temporalText } from '../src/apps/moving';

describe('moving vehicle: series, fast segmentation, tracking, temporal graph', () => {
  it('finds the moving things and their events', () => {
    const sensor = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.25 };
    const frames = Array.from({ length: N_FRAMES }, (_, k) => {
      const e = EGO(k * DT), c = simulateScan({ scene: sceneAt(k * DT), sensor, trajectory: staticPose(e.x, e.y, e.z, e.yaw), sweeps: 1, seed: 3 + k, maxRays: 130000, distortion: false, scanId: k }).cloud;
      return segmentFrame(c, { voxel: 0.12, radius: 0.6, minPts: 8, range: 24, origin: [EGO(k * DT).x, EGO(k * DT).y] });
    });
    ACTORS.forEach((a) => console.log('truth', a.id, frames.map((f, k) => { const p = a.pos(k * DT); const s = f.segs.filter((q) => Math.hypot(q.centre[0] - p.x, q.centre[1] - p.y) < 1.8).sort((u, v) => v.count - u.count)[0]; return s ? s.cls[0] : '-'; }).join('')));
    const tracks = trackObjects(frames), g = buildTemporal(frames, tracks);
    console.log('ms/frame', frames.map((f) => f.ms.toFixed(0)).join(' '), 'segs', frames.map((f) => f.segs.length).join(' '));
    console.log(temporalText(g));
    expect(frames.every((f) => f.segs.length > 3)).toBe(true);
    expect(tracks.some((t) => t.moving && t.cls === 'person')).toBe(true);
    expect(tracks.some((t) => t.moving && (t.cls === 'car' || t.cls === 'large vehicle'))).toBe(true);
  }, 300000);
});

describe('segmentFrame reports what it did and how long each step took', () => {
  it('has the five steps in order, adding up to about the total, with counts that fit together', () => {
    const sensor = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot64')!), hRes: 0.25 }, e = EGO(0);
    const c = simulateScan({ scene: sceneAt(0), sensor, trajectory: staticPose(e.x, e.y, e.z, e.yaw), sweeps: 1, seed: 3, maxRays: 130000, distortion: false, scanId: 0 }).cloud;
    const f = segmentFrame(c, { voxel: 0.12, radius: 0.6, minPts: 8, range: 24, origin: [e.x, e.y] });
    expect(SEG_METHOD.name).toMatch(/Ground plane/);
    expect(f.steps.map((q) => q.name)).toEqual(['Crop', 'Thin', 'Ground', 'Cluster', 'Name']);
    expect(f.steps.reduce((a, q) => a + q.ms, 0)).toBeLessThanOrEqual(f.ms + 1);
    expect(f.steps.reduce((a, q) => a + q.ms, 0)).toBeGreaterThan(f.ms * 0.8);
    expect(f.input).toBe(c.count); expect(f.near).toBeLessThan(f.input); expect(f.thin).toBeLessThan(f.near);
    expect(f.ground + f.kept).toBe(f.thin);
  });
});
