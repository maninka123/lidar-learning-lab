import { describe, it, expect } from 'vitest';
import { presetRoutes, routeLength, SPEEDS, slamPlan, SLAM_LIDARS, MAX_MAP_SCANS, type Platform } from '../src/registration/routes';
import { routeIsClosed } from '../src/registration/slam';

const B = { min: [-30, -20, 0], max: [30, 20, 10] };
describe('preset routes and speeds', () => {
  it.each(['A', 'D'])('every platform offers valid routes in scene %s', (id) => {
    for (const pl of ['handheld', 'vehicle', 'uav'] as Platform[]) {
      const rs = presetRoutes(id, B, pl);
      expect(rs.length).toBe(2);
      for (const r of rs) { expect(r.wps.length).toBeGreaterThanOrEqual(3); expect(routeLength(r.wps)).toBeGreaterThan(10); }
    }
  });
  it('closed presets are recognised as loops', () => {
    expect(routeIsClosed(presetRoutes('A', B, 'handheld')[0].wps)).toBe(true);
    expect(routeIsClosed(presetRoutes('A', B, 'uav')[1].wps)).toBe(true);
  });
  it('speed limits grow from walking to driving', () => {
    expect(SPEEDS.handheld.max).toBeLessThan(SPEEDS.vehicle.max);
    for (const v of Object.values(SPEEDS)) { expect(v.def).toBeGreaterThanOrEqual(v.min); expect(v.def).toBeLessThanOrEqual(v.max); }
  });
  it('scan count follows the scanner rate and the time on the route', () => {
    const slow = slamPlan(100, 1, 10), fast = slamPlan(100, 10, 10);
    expect(slow.captured).toBe(1000); expect(fast.captured).toBe(100);
    expect(slamPlan(100, 1, 40).captured).toBe(4000);
    expect(slow.used).toBe(MAX_MAP_SCANS); expect(slow.thinned).toBe(true);
    expect(slamPlan(60, 14, 10).used).toBeGreaterThanOrEqual(6);
    expect(slamPlan(60, 14, 10).spacing).toBeGreaterThan(slamPlan(60, 7, 10).spacing);
  });
  it('offers a rotating, a line and a solid-state LiDAR', () => { expect(SLAM_LIDARS.map((l) => l.id)).toEqual(['vlp16', 'hokuyo', 'mid360']); });
});
