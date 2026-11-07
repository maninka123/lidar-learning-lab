import { describe, expect, it } from 'vitest';
import { acquireSurvey } from '../src/twin/acquire';
import { buildFactory } from '../src/twin/factory';
import { inspectionCoverage } from '../src/twin/inspection';
import { initialSave } from '../src/twin/store';
import { INSPECTION_CAMERA_ID, pairedLidarOf, DEFAULT_SETTINGS } from '../src/twin/catalogue';
import { migrateSave } from '../src/twin/store';
import { sampleConfig } from './helpers/twinStrategies';

const factory = buildFactory(11, 'A');
const config = sampleConfig('low');
const design = { ...config.design, cameras: [config.design.cameras[0]] };
const survey = acquireSurvey(factory, design, 11);

describe('critical camera inspection bay', () => {
  it('starts with a specified camera that still needs placement and calibration against the combined cloud', () => {
    const camera = initialSave().design.cameras[0];
    expect(camera).toMatchObject({ id: INSPECTION_CAMERA_ID, item: 'cam-mid', pairedLidarId: 'all', cal: { done: false } });
    expect(pairedLidarOf(camera, design)).toBeUndefined(); // the combined cloud is not one scanner
    expect(inspectionCoverage(factory, { ...design, cameras: [camera] }).coverage).toBeLessThan(.8);
  });
  it('an older save whose camera had no connection recorded is calibrated against the combined cloud', () => {
    const save = JSON.parse(JSON.stringify(initialSave())); delete save.design.cameras[0].pairedLidarId; save.design.cameras.push({ ...save.design.cameras[0], id: 'c-null', pairedLidarId: null });
    const out = migrateSave(save)!; expect(out.design.cameras.map((c) => c.pairedLidarId)).toEqual(['all', 'all']);
  });
  it('a save with the earlier score weights takes the current scoring, one that already has the completion part keeps its own', () => {
    const old = JSON.parse(JSON.stringify(initialSave())); delete old.settings.weights.completion; old.settings.weights.twin = 33;
    expect(migrateSave(old)!.settings.weights).toEqual(DEFAULT_SETTINGS.weights);
    const custom = JSON.parse(JSON.stringify(initialSave())); custom.settings.weights.twin = 33; expect(migrateSave(custom)!.settings.weights.twin).toBe(33);
  });
  it('accepts a real scan with a calibrated camera and overlapping views on the inspection labels', () => {
    const result = inspectionCoverage(factory, design, survey, [.5]);
    expect(result.total).toBe(6);expect(result.calibratedCoverage).toBeGreaterThanOrEqual(.8);
  });
  it('cannot substitute legacy nearest-scanner fallback or an invalid connection for an explicit pair', () => {
    for (const pairedLidarId of [undefined, null, 'missing-lidar']) {
      const result = inspectionCoverage(factory, { ...design, cameras: [{ ...design.cameras[0], pairedLidarId }] }, survey, [.5]);
      expect(result.coverage).toBeGreaterThanOrEqual(.8);expect(result.calibratedCoverage).toBe(0);
    }
  });
  it('rejects a camera aimed away, a LiDAR aimed away, missing returns and inaccurate calibration', () => {
    const camera = design.cameras[0], lidar = design.lidars[0];
    expect(inspectionCoverage(factory, { ...design, cameras: [{ ...camera, yaw: Math.PI / 2 }] }).coverage).toBe(0);
    expect(inspectionCoverage(factory, { ...design, lidars: [{ ...lidar, item: 'avia', yaw: Math.PI / 2 }] }).sharedCoverage).toBe(0);
    expect(inspectionCoverage(factory, design, { ...survey, visible: { ...survey.visible, scans: [] } }, [.5]).calibratedCoverage).toBe(0);
    expect(inspectionCoverage(factory, design, survey, [8]).calibratedCoverage).toBe(0);
    expect(inspectionCoverage(factory, design, survey, [Infinity]).calibratedCoverage).toBe(0);
  });
});
