import { describe, it, expect } from 'vitest';
import { getScene } from '../src/scenes';
import { runSlam, SlamParams } from '../src/registration/slam';
import { PRESETS, presetToConfig } from '../src/sensor/presets';

const sensor = { ...presetToConfig(PRESETS.find((p) => p.id === 'rot16')!), hRes: 2, channels: 5, vMin: -20, vMax: 20, maxRange: 30, noise: 0.005, minRange: 0.3 };
const base: SlamParams = { seed: 3, steps: 40, odom: 'noisy', transNoise: 0.012, rotNoiseDeg: 0.35, rotBiasDeg: 0.25, scaleErr: 0.015, loopClosure: true, z: 1.4 };

describe('SLAM teaching simulation', () => {
  const scene = getScene('A');
  it('accumulates drift with noisy odometry and loop closure reduces it', () => {
    const r = runSlam(scene, sensor, base);
    console.log('ATE before', r.ateBefore.toFixed(3), 'after', r.ateAfter?.toFixed(3), 'final', r.finalDriftBefore.toFixed(3), r.finalDriftAfter?.toFixed(3), r.closure);
    expect(r.finalDriftBefore).toBeGreaterThan(0.05);
    expect(r.errBefore[r.errBefore.length - 1]).toBeGreaterThan(r.errBefore[5]);
    expect(r.closure?.detected).toBe(true);
    expect(r.ateAfter!).toBeLessThan(r.ateBefore);
    expect(r.finalDriftAfter!).toBeLessThan(r.finalDriftBefore);
  }, 60000);
  it('with zero injected error the odometry matches ground truth', () => {
    const r = runSlam(scene, sensor, { ...base, transNoise: 0, rotNoiseDeg: 0, rotBiasDeg: 0, scaleErr: 0, loopClosure: false });
    expect(r.ateBefore).toBeLessThan(0.1);
  }, 60000);
  it('ICP scan matching limits drift compared with raw noisy odometry', () => {
    const noisy = runSlam(scene, sensor, { ...base, loopClosure: false });
    const icp = runSlam(scene, sensor, { ...base, odom: 'icp', loopClosure: false });
    console.log('noisy', noisy.ateBefore.toFixed(3), 'icp', icp.ateBefore.toFixed(3));
    expect(icp.ateBefore).toBeLessThan(noisy.ateBefore);
  }, 60000);
});

it('custom routes stay open until a return waypoint is explicitly added', async () => {
 const { pathFromWaypoints, closeRoute, routeIsClosed } = await import('../src/registration/slam');
 const wps: [number,number][]=[[0,0],[5,0],[5,5]], open=pathFromWaypoints(wps,20,false);
 expect(open[0]).toMatchObject({x:0,y:0});expect(open[20]).toMatchObject({x:5,y:5});expect(routeIsClosed(wps)).toBe(false);
 const closed=closeRoute(wps);expect(closed).toHaveLength(4);expect(closed[3]).toEqual(wps[0]);expect(closeRoute(closed)).toBe(closed);
 const loop=pathFromWaypoints(closed,20,true);expect(loop[20]).toEqual(loop[0]);
});
it('an open route ending far from the start cannot invent a loop closure',()=>{
 const r=runSlam(getScene('A'),sensor,{...base,steps:20,waypoints:[[-3,-2],[3,-2],[3,3]],loopClosure:true});
 expect(r.closure?.detected).toBe(false);expect(r.corrected).toBeNull();expect(r.gt.at(-1)).not.toEqual(r.gt[0]);
},60000);
