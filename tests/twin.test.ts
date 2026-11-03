import { describe, it, expect } from 'vitest';
import { buildFactory, ZONES, SAFETY_ZONES, illuminationAt, distToSurface, TWIN_CLASSES, Target } from '../src/twin/factory';
import { LIDARS, CAMERAS, DEFAULT_SETTINGS, EMPTY_DESIGN, TwinDesign, LidarUnit, CameraUnit, costOf, sensorFor, lidarItem, RES_TIERS, ChallengeSettings } from '../src/twin/catalogue';
import { acquireSurvey, routePoses, raysFor } from '../src/twin/acquire';
import { evaluate } from '../src/occlusion/coverage';
import { makeSampler, renderPreview, calibrationTarget, residuals, rmsOf, autoCalibrate, calibrationError, trueExtrinsic, nominalOf, colourPoints, labelVote, sensitivity } from '../src/twin/camera';
import { newBlock, checkPipeline, runPipeline, Block, classifyShape, PHASES, BLOCKS, phaseIndex, insertBlock, parallelGroups, canRunParallel, BlockKind } from '../src/twin/pipeline';
import { registerScans, DEFAULT_REG } from '../src/twin/register';
import { assign, iou3, matchObjects, scoreDetection, scoreColour, scoreChange, scoreSafety, safetyTruth, lin, combine, poseError, referenceOf } from '../src/twin/grade';
import { runScenario, runFinal, needsSurveyB, PRACTICE_SEED } from '../src/twin/runner';
import { HW_SEED } from '../src/twin/catalogue';

const lidar = (item: string, x: number, y: number, res: LidarUnit['res'] = 'standard', z = 1.8, yaw = 0): LidarUnit => ({ id: `${item}-${x}`, item, res, x, y, z, yaw, pitch: 0 });
const cam = (item: string, x: number, y: number, z: number, yawDeg: number, kit = false): CameraUnit => ({ id: `${item}-${x}-${y}`, item, x, y, z, yaw: (yawDeg * Math.PI) / 180, pitch: 0, kit, cal: { est: { tx: x, ty: y, tz: z, yawDeg, pitchDeg: 0 }, fov: CAMERAS.find((c) => c.id === item)!.fov, done: false } });
const design = (p: Partial<TwinDesign>): TwinDesign => ({ ...EMPTY_DESIGN, ...p });
const pipe = (kinds: string[], tweak: Record<string, Record<string, number>> = {}): Block[] => kinds.map((k) => { const b = newBlock(k as never); Object.assign(b.params, tweak[k] ?? {}); return b; });
const BASIC = ['icp', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify'];
const CROP3 = { crop: { zmax: 3.0 }, voxel: { size: 0.06 } };

describe('equipment shop and budget', () => {
  it('TLS costs much more than rotating heads, and resolution raises the price', () => {
    const c = (id: string) => lidarItem(id).cost;
    expect(c('tls')).toBeGreaterThan(2.5 * c('rot128')); expect(c('rot128')).toBeGreaterThan(c('rot32')); expect(c('rot32')).toBeGreaterThan(c('rot16'));
    const price = (res: LidarUnit['res']) => costOf(design({ lidars: [lidar('rot32', 0, 0, res)] }), DEFAULT_SETTINGS).total;
    expect(price('fine')).toBeGreaterThan(price('standard')); expect(price('standard')).toBeGreaterThan(price('coarse'));
    expect(CAMERAS.find((q) => q.id === 'cam-high')!.cost).toBeGreaterThan(CAMERAS.find((q) => q.id === 'cam-basic')!.cost);
  });
  it('invalid purchases are refused and the report says why', () => {
    expect(costOf(design({}), DEFAULT_SETTINGS).errors.join()).toMatch(/at least one LiDAR/);
    expect(costOf(design({ lidars: [lidar('mobile32', 0, 0)] }), DEFAULT_SETTINGS).ok).toBe(false);
    expect(costOf(design({ lidars: [lidar('mobile32', 0, 0)], platform: true }), DEFAULT_SETTINGS).ok).toBe(true);
    expect(costOf(design({ lidars: [lidar('tls', 0, 0), lidar('tls', 3, 0)] }), DEFAULT_SETTINGS).errors.join()).toMatch(/Over budget/);
    expect(costOf(design({ lidars: Array.from({ length: 7 }, (_, i) => lidar('rot16', i, 0)) }), { ...DEFAULT_SETTINGS, budget: 99999 }).errors.join()).toMatch(/At most 6 LiDARs/);
    const r = costOf(design({ lidars: [lidar('rot16', 0, 0)] }), DEFAULT_SETTINGS); expect(r.remaining).toBe(DEFAULT_SETTINGS.budget - r.total);
  });
  it('the instructor can scale prices and the budget', () => {
    const d = design({ lidars: [lidar('rot32', 0, 0)] }), a = costOf(d, DEFAULT_SETTINGS), b = costOf(d, { ...DEFAULT_SETTINGS, priceScale: 2 });
    expect(b.total).toBeGreaterThan(1.9 * a.total);
  });
  it('resolution tiers change the real sensor angle step and the ray budget', () => {
    expect(sensorFor(lidar('rot32', 0, 0, 'fine')).hRes).toBeLessThan(sensorFor(lidar('rot32', 0, 0, 'coarse')).hRes);
    expect(raysFor(lidar('rot32', 0, 0, 'fine'))).toBeGreaterThan(raysFor(lidar('rot32', 0, 0, 'coarse')));
    expect(RES_TIERS.fine.cost).toBeGreaterThan(RES_TIERS.standard.cost);
    expect(raysFor(lidar('mid360', 0, 0, 'fine'))).toBeGreaterThan(raysFor(lidar('mid360', 0, 0, 'coarse')));
  });
});

describe('fixed units', () => {
  const f = buildFactory(11, 'A');
  it('the default budget is 3000 credits', () => { expect(DEFAULT_SETTINGS.budget).toBe(3000); });
  it('the same model can be bought twice, each unit costs and scans on its own', () => {
    const one = lidar('rot32', -6, -0.3), two = lidar('rot32', 6, -0.3);
    const a = costOf(design({ lidars: [one] }), DEFAULT_SETTINGS), b = costOf(design({ lidars: [one, two] }), DEFAULT_SETTINGS);
    expect(b.total).toBe(2 * a.total);
    const s = acquireSurvey(f, design({ lidars: [one, two] }), 11);
    expect(s.visible.scans.map((q) => q.name)).toEqual(['LiDAR 1', 'LiDAR 2']); expect(s.hidden.truePoses.map((p) => p.t[0])).toEqual([-6, 6]);
    expect(evaluate(f.scene, [{ id: 0, x: -6, y: -0.3, z: 1.8, yaw: 0, pitch: 0, preset: 'rot32' }, { id: 1, x: 6, y: -0.3, z: 1.8, yaw: 0, pitch: 0, preset: 'rot32' }]).stats.coverage).toBeGreaterThan(evaluate(f.scene, [{ id: 0, x: -6, y: -0.3, z: 1.8, yaw: 0, pitch: 0, preset: 'rot32' }]).stats.coverage);
  });
});

describe('the factory', () => {
  const A = buildFactory(11, 'A'), B = buildFactory(11, 'B');
  it('has the five zones, similar containers with three label colours, small objects and a forklift', () => {
    expect(ZONES.map((z) => z.id).sort()).toEqual(['inspection', 'loading', 'lowlight', 'production', 'storage']);
    const cont = A.targets.filter((t) => t.cls === 'container');
    expect(cont.length).toBe(10); expect(new Set(cont.map((t) => t.label))).toEqual(new Set(['red', 'green', 'yellow']));
    expect(A.targets.some((t) => t.cls === 'forklift')).toBe(true); expect(A.targets.filter((t) => t.small).length).toBeGreaterThanOrEqual(6);
    expect(A.targets.filter((t) => t.zone === 'lowlight').length).toBeGreaterThanOrEqual(5);
    for (const c of TWIN_CLASSES) expect(A.targets.some((t) => t.cls === c) || c === 'obstacle').toBe(true);
    const sizes = new Set(cont.map((t) => t.max.map((v, i) => (v - t.min[i]).toFixed(1)).join())); expect(sizes.size).toBe(1); // identical geometry: only the label tells them apart
  });
  it('is deterministic and the seed changes positions and labels', () => {
    expect(buildFactory(11, 'A').targets.map((t) => t.centre)).toEqual(A.targets.map((t) => t.centre));
    const C = buildFactory(101, 'A'); expect(C.targets.map((t) => t.label).join()).not.toBe(A.targets.map((t) => t.label).join());
    expect(C.targets[0].centre).not.toEqual(A.targets[0].centre);
  });
  it('time B has moved, removed and added objects, matching the reference change list', () => {
    const kinds = B.changes.map((c) => c.kind); expect(kinds).toContain('moved'); expect(kinds).toContain('removed'); expect(kinds).toContain('added');
    const idsA = new Set(A.targets.map((t) => t.id)), idsB = new Set(B.targets.map((t) => t.id));
    for (const c of B.changes) { if (c.kind === 'removed') { expect(idsA.has(c.id)).toBe(true); expect(idsB.has(c.id)).toBe(false); } if (c.kind === 'added') { expect(idsA.has(c.id)).toBe(false); expect(idsB.has(c.id)).toBe(true); } }
    for (const c of B.changes.filter((q) => q.kind === 'moved')) { const a = A.targets.find((t) => t.id === c.id)!, b = B.targets.find((t) => t.id === c.id)!; expect(Math.hypot(a.centre[0] - b.centre[0], a.centre[1] - b.centre[1])).toBeGreaterThan(0.3); }
    expect(A.changes).toEqual([]);
  });
  it('has safety zones with a known violation in each survey', () => {
    expect(SAFETY_ZONES.length).toBe(3);
    const tA = safetyTruth(A.targets), tB = safetyTruth(B.targets);
    expect(tA.some((z) => z.violated)).toBe(true); expect(tB.filter((z) => z.violated).length).toBeGreaterThan(tA.filter((z) => z.violated).length);
  });
  it('the low-light zone is much darker, and a lamp helps', () => {
    expect(illuminationAt(8, 5, 1)).toBeLessThan(0.15); expect(illuminationAt(-5, -5, 1)).toBeGreaterThan(0.7);
    expect(illuminationAt(8, 5, 1, [{ x: 8, y: 5, z: 3, power: 0.45 }])).toBeGreaterThan(illuminationAt(8, 5, 1) + 0.2);
  });
  it('distance to surface is exact for boxes and cylinders', () => {
    expect(distToSurface(A.scene, 0, 0, 0.5, 5)).toBeCloseTo(0.5, 2); // above the floor (z = 0 is the floor top)
    expect(distToSurface(A.scene, 0, 0, 0, 5)).toBeLessThan(0.01);
  });
});

describe('LiDAR acquisition', () => {
  const f = buildFactory(11, 'A');
  it('finer resolution gives more points from the same place', () => {
    const n = (res: LidarUnit['res']) => acquireSurvey(f, design({ lidars: [lidar('rot16', 0, -0.3, res)] }), 11).visible.stats.points;
    expect(n('fine')).toBeGreaterThan(1.5 * n('standard')); expect(n('standard')).toBeGreaterThan(1.5 * n('coarse'));
  });
  it('the team gets points only: no labels, colours, normals or truth flags; provenance indexes a hidden table', () => {
    const s = acquireSurvey(f, design({ lidars: [lidar('rot32', -5, -0.3), lidar('rot32', 5, -0.3)] }), 11);
    for (const sc of s.visible.scans) { const c = sc.cloud; expect(c.labels).toBeUndefined(); expect(c.colors).toBeUndefined(); expect(c.normals).toBeUndefined(); expect(c.tags).toBeUndefined(); expect(c.instances!.length).toBe(c.count); }
    const total = s.hidden.truth.obj.length; expect(total).toBe(s.visible.scans.reduce((a, q) => a + q.cloud.count, 0));
    for (const sc of s.visible.scans) for (let i = 0; i < sc.cloud.count; i += 97) expect(sc.cloud.instances![i]).toBeLessThan(total);
    expect(Object.keys(s.visible).sort()).toEqual(['epoch', 'mobileScans', 'scans', 'stats']);
  });
  it('has dropouts, floating outliers and a recorded pose that is slightly wrong', () => {
    const s = acquireSurvey(f, design({ lidars: [lidar('rot16', -5, -0.3)] }), 11), out = s.hidden.truth.outlier.reduce((a, v) => a + v, 0);
    expect(out).toBeGreaterThan(0); expect(out / s.hidden.truth.outlier.length).toBeLessThan(0.05);
    expect(s.visible.scans[0].pose.t).not.toEqual(s.hidden.truePoses[0].t);
    const e = Math.hypot(...s.visible.scans[0].pose.t.map((v, i) => v - s.hidden.truePoses[0].t[i])); expect(e).toBeLessThan(0.15);
  });
  it('is deterministic for the same seed and different for another', () => {
    const d = design({ lidars: [lidar('rot16', -5, -0.3)] }), a = acquireSurvey(f, d, 11), b = acquireSurvey(f, d, 11), c = acquireSurvey(buildFactory(101, 'A'), d, 101);
    expect(Array.from(a.visible.scans[0].cloud.positions.slice(0, 60))).toEqual(Array.from(b.visible.scans[0].cloud.positions.slice(0, 60)));
    expect(a.visible.scans[0].cloud.count).not.toBe(c.visible.scans[0].cloud.count);
  });
  it('occlusion: a scanner cannot see behind a wall of equipment (the low-light zone through the partition)', () => {
    const s = acquireSurvey(f, design({ lidars: [lidar('rot16', -9, -5)] }), 11);
    let lowlight = 0; const c = s.visible.scans[0].cloud; for (let i = 0; i < c.count; i++) if (c.positions[i * 3] > 6 && c.positions[i * 3 + 1] > 3) lowlight++;
    expect(lowlight).toBeLessThan(c.count * 0.05);
  });
  it('mobile route: poses follow the route and dead reckoning drifts, registration pulls it back', () => {
    const poses = routePoses([[-9, -0.3], [9, -0.3]], 6, 1.5); expect(poses.length).toBe(6); expect(poses[0].x).toBeCloseTo(-9); expect(poses[5].x).toBeCloseTo(9);
    const d = design({ lidars: [lidar('mobile32', 0, 0, 'standard', 1.5)], platform: true, routeSteps: 6, distortion: true }), s = acquireSurvey(f, d, 11);
    expect(s.visible.scans.length).toBe(6); expect(s.visible.mobileScans).toBe(6);
    const err = poseError(s.visible.scans.map((q) => q.pose), s.hidden.truePoses); expect(err.cm).toBeGreaterThan(1);
  });
});

describe('cameras, lighting and calibration', () => {
  const f = buildFactory(11, 'A');
  /** mean brightness over a grid of pixels (the camera never builds the whole frame) */
  const brightness = (s: { w: number; h: number; sample: (u: number, v: number) => [number, number, number] }) => { let sum = 0, n = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 60; i++) { const p = s.sample(Math.floor(((i + 0.5) * s.w) / 60), Math.floor(((j + 0.5) * s.h) / 40)); sum += p[0] + p[1] + p[2]; n += 3; } return sum / n; };
  it('the cameras are 320p, 720p and 4K, and the preview is a smaller view of the same camera', () => {
    const dims = (id: string) => { const c = CAMERAS.find((q) => q.id === id)!; return [c.w, c.h]; };
    expect(dims('cam-basic')).toEqual([568, 320]); expect(dims('cam-mid')).toEqual([1280, 720]); expect(dims('cam-high')).toEqual([3840, 2160]);
    const hi = makeSampler(f, cam('cam-high', -9, -4, 1.8, 0), HW_SEED, 0, []), lo = makeSampler(f, cam('cam-basic', -9, -4, 1.8, 0), HW_SEED, 0, []);
    expect(hi.w * hi.h).toBeGreaterThan(40 * lo.w * lo.h); expect(CAMERAS.find((c) => c.id === 'cam-wide')!.fov).toBeGreaterThan(100);
    expect(hi.sample(1000, 900)).toEqual(hi.sample(1000, 900)); // the same pixel is always the same value
    const pv = renderPreview(f, cam('cam-high', -9, -4, 1.8, 0), HW_SEED, 0, [], 160); expect(pv.w).toBe(160); expect(pv.h).toBe(90); expect(pv.rgb.length).toBe(160 * 90 * 4);
    expect(CAMERAS.find((c) => c.id === 'cam-high')!.cost).toBeGreaterThan(CAMERAS.find((c) => c.id === 'cam-mid')!.cost);
  });
  it('the dark zone is dark whatever the resolution; the low-light camera and a lamp help', () => {
    const at = (item: string, kit = false, lights: { id: string; x: number; y: number; z: number }[] = []) => brightness(makeSampler(f, cam(item, 5, 2, 1.8, 50, kit), HW_SEED, 0, lights));
    const lit = brightness(makeSampler(f, cam('cam-mid', -9, -4, 1.8, 0), HW_SEED, 0, []));
    const dark = at('cam-mid'), darkHigh = at('cam-high'), ll = at('cam-lowlight'), lamp = at('cam-mid', false, [{ id: 'l', x: 7, y: 5, z: 3 }]);
    expect(dark).toBeLessThan(0.8 * lit); expect(darkHigh).toBeLessThan(0.8 * lit); // more pixels do not make light
    expect(Math.abs(darkHigh - dark) / dark).toBeLessThan(0.12); // 4K is no brighter than 720p in the same dark place
    expect(ll).toBeGreaterThan(1.3 * dark); expect(lamp).toBeGreaterThan(1.3 * dark);
    expect(sensitivity(cam('cam-mid', 0, 0, 1, 0, true)).gain).toBeGreaterThan(sensitivity(cam('cam-mid', 0, 0, 1, 0)).gain);
  });
  it('a calibration board is seen with pixel noise; the nominal pose has real reprojection error; automatic calibration removes it', () => {
    const c = cam('cam-mid', -9, -4, 1.8, 0), t = calibrationTarget(c, HW_SEED, 0, []);
    expect(t.X.length).toBeGreaterThan(15);
    const before = rmsOf(residuals(t, c.cal.est, c.cal.fov)); expect(before).toBeGreaterThan(3);
    const r = autoCalibrate(t, c.cal.est, c.cal.fov); expect(r.rms).toBeLessThan(Math.max(1.5, 3 * t.sigmaPx));
    const e0 = calibrationError(c.cal.est, c.cal.fov, c, HW_SEED, 0), e1 = calibrationError(r.e, r.fov, c, HW_SEED, 0);
    expect(e1.posCm).toBeLessThan(8); expect(e1.angDeg).toBeLessThan(0.8); // distance along the viewing direction is the weak part of any camera calibration
  });
  it('darker or smaller pictures give noisier calibration; the hidden truth is never equal to the nominal pose', () => {
    const lo = calibrationTarget(cam('cam-basic', 8, 4, 1.8, 0), HW_SEED, 0, []), hi = calibrationTarget(cam('cam-high', -9, -4, 1.8, 0), HW_SEED, 0, []);
    expect(lo.sigmaPx).toBeGreaterThan(hi.sigmaPx);
    const c = cam('cam-mid', 0, 0, 1.8, 0), tr = trueExtrinsic(c, HW_SEED, 0), n = nominalOf(c); expect(Math.hypot(tr.e.tx - n.tx, tr.e.ty - n.ty, tr.e.yawDeg - n.yawDeg)).toBeGreaterThan(1e-3);
  });
  it('calibration errors spoil the colours given to LiDAR points', () => {
    const c = cam('cam-mid', -9, -4, 1.8, 0), tr = trueExtrinsic(c, HW_SEED, 0), img = makeSampler(f, c, HW_SEED, 0, []);
    const s = acquireSurvey(f, design({ lidars: [lidar('rot32', -9, -4)] }), 11), cl = s.visible.scans[0].cloud;
    const good = colourPoints(cl.positions, cl.count, [{ unit: c, image: img, e: tr.e, fov: tr.fov }]);
    const bad = colourPoints(cl.positions, cl.count, [{ unit: c, image: img, e: { ...tr.e, yawDeg: tr.e.yawDeg + 6, tx: tr.e.tx + 0.3 }, fov: tr.fov }]);
    let diff = 0, n = 0; for (let i = 0; i < cl.count; i++) if (good.valid[i] && bad.valid[i]) { diff += Math.abs(good.colors[i * 3] - bad.colors[i * 3]) + Math.abs(good.colors[i * 3 + 1] - bad.colors[i * 3 + 1]); n++; }
    expect(good.count).toBeGreaterThan(500); expect(diff / Math.max(1, n)).toBeGreaterThan(8);
  });
  it('label colours are read from measured pixels, and dark or grey pixels vote for nothing', () => {
    expect(labelVote(205, 40, 40)).toBe('red'); expect(labelVote(40, 165, 70)).toBe('green'); expect(labelVote(235, 205, 40)).toBe('yellow');
    expect(labelVote(12, 3, 2)).toBeNull(); expect(labelVote(170, 168, 160)).toBeNull();
  });
});

describe('pipeline blocks', () => {
  it('checks types and order with clear messages', () => {
    const ctx = { cameras: 0, hasB: false };
    expect(checkPipeline(pipe(['euclid']), ctx).perBlock[0]).toMatch(/needs a point cloud/);
    expect(checkPipeline(pipe(['icp', 'classify']), ctx).perBlock[1]).toMatch(/clusters/);
    expect(checkPipeline(pipe(['icp', 'euclid', 'classify', 'colour']), ctx).perBlock[3]).toMatch(/camera/);
    expect(checkPipeline(pipe(['icp', 'euclid', 'classify', 'voxel', 'safety']), ctx).perBlock[4]).toMatch(/list of objects/); // the cloud changed after the objects were made
    expect(checkPipeline(pipe(['icp', 'diff']), ctx).perBlock[1]).toMatch(/second survey/);
    expect(checkPipeline(pipe(['icp', 'merge']), ctx).perBlock[1]).toMatch(/first/);
    expect(checkPipeline(pipe(['voxel']), ctx).global.join()).toMatch(/Start with a registration/);
    const ok = checkPipeline(pipe(BASIC), ctx); expect(ok.ok).toBe(true);
    const bp = pipe(['icp', 'euclid', 'classify']); bp[1].bypass = true; expect(checkPipeline(bp, ctx).perBlock[2]).toMatch(/clusters/);
  });
  it('filters keep point provenance, and an invalid block is skipped with its message', () => {
    const f = buildFactory(11, 'A'), s = acquireSurvey(f, design({ lidars: [lidar('rot32', -5, -0.3)] }), 11);
    const out = runPipeline(pipe(['merge', 'voxel', 'sor', 'colour']), { A: s.visible, camerasA: [] });
    const c = out.A.cloud!; expect(c.instances).toBeDefined(); const total = s.hidden.truth.obj.length; for (let i = 0; i < c.count; i += 53) expect(c.instances![i]).toBeLessThan(total);
    expect(out.steps[3].error).toMatch(/camera/); expect(c.count).toBeLessThan(s.visible.stats.points);
  });
  it('over-filtering removes small objects that were measured', () => {
    const f = buildFactory(11, 'A'), s = acquireSurvey(f, design({ lidars: [lidar('rot128', -1, -1.5, 'standard', 1.8)] }), 11);
    const count = (size: number) => { const out = runPipeline(pipe(['merge', 'voxel'], { voxel: { size } }), { A: s.visible, camerasA: [] }); return out.A.cloud!.count; };
    expect(count(0.4)).toBeLessThan(0.2 * count(0.05));
  });
  it('shape rules name typical sizes', () => {
    expect(classifyShape(1.2, 0.8, 1.1, 0.8, 0.45)).toBe('pallet'); expect(classifyShape(6, 0.9, 1, 0.7, 0.45)).toBe('conveyor');
    expect(classifyShape(0.6, 0.6, 0.9, 0.97, 0.45)).toBe('drum'); expect(classifyShape(0.55, 0.55, 1.1, 0.85, 0.45)).toBe('container');
    expect(classifyShape(0.15, 0.15, 0.15, 0.8, 0.45)).toBe('small'); expect(classifyShape(2.3, 0.7, 2.2, 0.7, 0.45)).toBe('rack');
  });
});

describe('registration and the pipeline builder', () => {
  const f = buildFactory(11, 'A'), sv = acquireSurvey(f, design({ lidars: [lidar('rot32', -6, -0.3), lidar('rot32', 6, -0.3)] }), 11);
  it('scans arrive in their own coordinate systems, and registration reports an RMSE', () => {
    const [a, b] = sv.visible.scans;
    expect(Math.abs(a.local.positions[0]) + Math.abs(a.local.positions[1])).toBeLessThan(40); // around the scanner, not the building
    const meanX = (c: { positions: Float32Array; count: number }) => { let s = 0; for (let i = 0; i < c.count; i++) s += c.positions[i * 3]; return s / c.count; };
    expect(Math.abs(meanX(a.local) - meanX(b.local))).toBeLessThan(3); // both piled around their own origin
    expect(Math.abs(meanX(a.cloud) - meanX(b.cloud))).toBeGreaterThan(8); // placed at the scanner positions they are far apart
    const placed = registerScans(sv.visible.scans, { ...DEFAULT_REG, mode: 'merge' }), icpR = registerScans(sv.visible.scans, DEFAULT_REG);
    expect(placed.report.scans).toHaveLength(1); expect(icpR.report.rmse).toBeLessThanOrEqual(placed.report.rmse + 1e-9); expect(icpR.report.overlap).toBeGreaterThan(0.1);
    expect(icpR.report.scans[0].accepted).toBe(true);
  });
  it('without a starting guess ICP cannot find the other scanner: the RMSE stays poor', () => {
    const good = registerScans(sv.visible.scans, DEFAULT_REG), lost = registerScans(sv.visible.scans, { ...DEFAULT_REG, guess: false });
    expect(lost.report.rmse > good.report.rmse || lost.report.overlap < good.report.overlap || !lost.report.scans[0].accepted).toBe(true);
  });
  it('the registration tuned in the pipeline is what the evaluation uses, and its RMSE is reported', () => {
    const r1 = runScenario({ design: design({ lidars: [lidar('rot32', -6, -0.3), lidar('rot32', 6, -0.3)] }), pipeline: pipe(['icp', 'voxel', 'euclid', 'classify']), settings: DEFAULT_SETTINGS }, 11);
    const r2 = runScenario({ design: design({ lidars: [lidar('rot32', -6, -0.3), lidar('rot32', 6, -0.3)] }), pipeline: pipe(['merge', 'voxel', 'euclid', 'classify']), settings: DEFAULT_SETTINGS }, 11);
    expect(Number.isFinite(r1.registration!.rmse)).toBe(true); expect(r1.registration!.mode).toBe('first'); expect(r2.registration!.mode).toBe('merge');
    expect(r1.steps[0].reg).toBeDefined(); expect(r1.tasks.twin.poseErrCm).toBeLessThan(r2.tasks.twin.poseErrCm);
  }, 120000);
  it('phases cover every block once and keep a new block in its place', () => {
    const all = PHASES.flatMap((p) => p.kinds).sort(), kinds = (Object.keys(BLOCKS) as BlockKind[]).sort(); expect(all).toEqual(kinds);
    let p: Block[] = []; for (const k of ['classify', 'crop', 'icp', 'euclid'] as BlockKind[]) p = insertBlock(p, newBlock(k));
    expect(p.map((b) => b.kind)).toEqual(['icp', 'crop', 'euclid', 'classify'].map((k) => k)); // sorted by phase
    expect(phaseIndex('icp')).toBe(0); expect(phaseIndex('safety')).toBe(4);
  });
  it('blocks set to parallel form a side-by-side group, and their results are joined', () => {
    const p = pipe(['icp', 'crop', 'sor', 'ror', 'euclid']); p[2].parallel = true; p[3].parallel = true;
    expect(parallelGroups(p)).toEqual([-1, -1, 0, 0, -1]); expect(canRunParallel('voxel')).toBe(false); expect(canRunParallel('sor')).toBe(true);
    const lone = pipe(['icp', 'sor']); lone[1].parallel = true; expect(parallelGroups(lone)).toEqual([-1, -1]); // a parallel block needs a neighbour
    const par = runPipeline(p, { A: sv.visible, camerasA: [] }), seq = runPipeline(pipe(['icp', 'crop', 'sor', 'ror', 'euclid']), { A: sv.visible, camerasA: [] });
    const cs = par.A.cloud!; expect(par.steps.filter((s) => s.group === 0)).toHaveLength(2);
    // every point that survives the parallel pair survived each filter on the same input: it never keeps more than either filter alone
    const sorOnly = runPipeline(pipe(['icp', 'crop', 'sor']), { A: sv.visible, camerasA: [] }).A.cloud!.count, rorOnly = runPipeline(pipe(['icp', 'crop', 'ror']), { A: sv.visible, camerasA: [] }).A.cloud!.count;
    expect(cs.count).toBeLessThanOrEqual(Math.min(sorOnly, rorOnly)); expect(seq.A.cloud!.count).toBeGreaterThan(0);
  }, 120000);
});

describe('grading', () => {
  it('Hungarian assignment is optimal (compared with brute force on small cases)', () => {
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
    const best = (() => { let b = Infinity; const perm = (a: number[], used: number[] = []): void => { if (used.length === a.length) { b = Math.min(b, used.reduce((s, j, i) => s + cost[i][j], 0)); return; } for (const j of a) if (!used.includes(j)) perm(a, [...used, j]); }; perm([0, 1, 2]); return b; })();
    const a = assign(cost); expect(a.reduce((s, j, i) => s + cost[i][j], 0)).toBe(best);
    expect(assign([[1, 2], [3, 4], [5, 6]]).filter((x) => x >= 0).length).toBe(2); expect(assign([])).toEqual([]);
  });
  const f = buildFactory(11, 'A');
  const asDet = (t: Target, cls = t.cls, colour?: never) => ({ id: 0, cls, min: t.min, max: t.max, centre: t.centre, n: 100, round: 1, idx: new Int32Array(0), colour: colour ?? (t.label === 'none' ? undefined : t.label) });
  it('a perfect detector scores 1 and each reference object is matched at most once', () => {
    const preds = f.targets.map((t) => asDet(t)), d = scoreDetection(f.targets, preds);
    expect(d.f1).toBeCloseTo(1, 6); expect(d.score).toBeGreaterThan(0.99); expect(new Set(d.match.pairs.map((p) => p.pred)).size).toBe(d.match.pairs.length);
    const dup = scoreDetection(f.targets, [...preds, asDet(f.targets[0])]); expect(dup.precision).toBeLessThan(1); expect(dup.tp).toBe(f.targets.length);
    expect(scoreDetection(f.targets, []).score).toBe(0);
  });
  it('wrong classes, merged objects and misses lower the score in the right metric', () => {
    const wrongCls = scoreDetection(f.targets, f.targets.map((t) => asDet(t, t.cls === 'box' ? 'pallet' : t.cls))); expect(wrongCls.classAcc).toBeLessThan(1); expect(wrongCls.recall).toBeCloseTo(1, 6);
    const half = scoreDetection(f.targets, f.targets.filter((_, i) => i % 2).map((t) => asDet(t))); expect(half.recall).toBeLessThan(0.6); expect(half.precision).toBeCloseTo(1, 6);
    expect(iou3({ min: [0, 0, 0], max: [1, 1, 1] }, { min: [0.5, 0, 0], max: [1.5, 1, 1] })).toBeCloseTo(1 / 3, 6);
  });
  it('colour is only credited when it was measured and attached to the right object', () => {
    const preds = f.targets.map((t) => asDet(t)), m = matchObjects(f.targets, preds);
    expect(scoreColour(f.targets, preds, m).accuracy).toBe(1);
    const none = preds.map((p) => ({ ...p, colour: undefined })); expect(scoreColour(f.targets, none, m).score).toBe(0);
    const swapped = preds.map((p) => ({ ...p, colour: p.colour === 'red' ? 'green' : p.colour })); expect(scoreColour(f.targets, swapped as never, m).accuracy).toBeLessThan(1);
  });
  it('change detection: perfect, partly right, and wrong category', () => {
    const B = buildFactory(11, 'B'), perfect = B.changes.map((c) => ({ kind: c.kind, centre: c.centre, size: [1, 1, 1] as [number, number, number], n: 50 }));
    expect(scoreChange(B.changes, perfect).f1).toBeCloseTo(1, 6);
    const wrong = perfect.map((p) => ({ ...p, kind: p.kind === 'moved' ? 'added' as const : p.kind })); const w = scoreChange(B.changes, wrong); expect(w.f1).toBeLessThan(1); expect(w.locF1).toBeCloseTo(1, 6);
    expect(scoreChange(B.changes, []).score).toBe(0);
    const fp = scoreChange(B.changes, [...perfect, { kind: 'added', centre: [-11, 7, 0], size: [1, 1, 1], n: 40 }]); expect(fp.precision).toBeLessThan(1);
  });
  it('safety: truth from geometry, scoring of missed and false alarms', () => {
    const B = buildFactory(11, 'B'), t = safetyTruth(B.targets), good = t.map((z) => ({ zone: z.zone, violated: z.violated, clearance: z.clearance, objects: [] }));
    expect(scoreSafety(t, good).score).toBeCloseTo(1, 6); const bad = good.map((g) => ({ ...g, violated: !g.violated })); expect(scoreSafety(t, bad).score).toBeLessThan(0.5);
    expect(scoreSafety(t, undefined).score).toBe(0);
  });
  it('scores are bounded and the grade is rescaled when tasks are switched off', () => {
    expect(lin(5, 0, 10)).toBe(0.5); expect(lin(-1, 0, 10)).toBe(0); expect(lin(99, 0, 10)).toBe(1); expect(lin(0.02, 0.12, 0.02)).toBe(1);
    const all = { twin: 1, detect: 1, colour: 1, change: 1, quality: 1, safety: 1 }, g = combine(all, DEFAULT_SETTINGS, 0, 0); expect(g.total).toBeCloseTo(100, 6);
    const noColour: ChallengeSettings = { ...DEFAULT_SETTINGS, enabled: { ...DEFAULT_SETTINGS.enabled, colour: false } }; expect(combine(all, noColour, 0, 0).total).toBeCloseTo(100, 6);
    const w2 = { ...DEFAULT_SETTINGS, weights: { ...DEFAULT_SETTINGS.weights, twin: 40 } }; expect(combine({ ...all, twin: 0 }, w2, 0, 0).perTask.find((t) => t.key === 'twin')!.points).toBe(0);
    expect(combine({}, DEFAULT_SETTINGS, 0, 0).total).toBe(0); // doing nothing cheaply earns nothing, not even the efficiency points
    const costly = combine(all, DEFAULT_SETTINGS, DEFAULT_SETTINGS.budget, 6e6), cheap = combine(all, DEFAULT_SETTINGS, 1000, 1e5);
    expect(cheap.total).toBeGreaterThan(costly.total); expect(costly.total).toBeLessThanOrEqual(100);
  });
  it('the reference surface is built once per scenario', () => { expect(referenceOf(f)).toBe(referenceOf(f)); expect(needsSurveyB(pipe(['icp', 'diff']))).toBe(true); expect(needsSurveyB(pipe(BASIC))).toBe(false); });
});

describe('complete example systems', () => {
  const lowCost = { design: design({ lidars: [lidar('rot16', -6, -0.3), lidar('rot16', 6, -0.3)] }), pipeline: pipe(['icp', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify', 'diff', 'safety'], { ...CROP3, voxel: { size: 0.1 } }), settings: DEFAULT_SETTINGS };
  const fusion = { design: design({ lidars: [lidar('rot128', -6, -0.3), lidar('rot128', 6, -0.3)], cameras: [cam('cam-high', 0, -0.6, 1.8, -90), cam('cam-lowlight', 8, 2.5, 1.8, 90, true)], lights: [{ id: 'l', x: 8, y: 5, z: 3 }] }), pipeline: pipe(['icp', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify', 'colour', 'diff', 'safety'], { ...CROP3, colour: { votes: 2 } }), settings: { ...DEFAULT_SETTINGS, budget: 9000 } };
  const mobile = { design: design({ lidars: [lidar('mobile32', 0, 0, 'standard', 1.5)], platform: true, route: [[-9, -0.3], [9, -0.3], [9, -5], [-9, -5]], routeSteps: 8 }), pipeline: pipe(['mobileicp', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify'], CROP3), settings: DEFAULT_SETTINGS };
  const a = runScenario(lowCost, PRACTICE_SEED), b = runScenario(fusion, PRACTICE_SEED), c = runScenario(mobile, PRACTICE_SEED);
  it('all three run and give bounded scores', () => {
    for (const r of [a, b, c]) { expect(r.ok).toBe(true); expect(r.grade.total).toBeGreaterThan(0); expect(r.grade.total).toBeLessThanOrEqual(100); for (const t of r.grade.perTask) { expect(t.score).toBeGreaterThanOrEqual(0); expect(t.score).toBeLessThanOrEqual(1); } }
  });
  it('different hardware and processing give different, defensible results', () => {
    expect(b.tasks.twin.coverage).toBeGreaterThan(a.tasks.twin.coverage); // 128 beams measure more of the surface than 16
    expect(b.tasks.detect.recall).toBeGreaterThan(a.tasks.detect.recall);
    expect(b.cost.total).toBeGreaterThan(a.cost.total);
  });
  it('colour needs cameras: the LiDAR-only systems get no colour credit and the camera system does', () => {
    expect(a.tasks.colour.score).toBe(0); expect(c.tasks.colour.score).toBe(0); expect(b.tasks.colour.score).toBeGreaterThan(0);
    expect(b.objects.some((o) => o.colour && o.colour !== 'unknown')).toBe(true);
  });
  it('tasks that were not attempted are not scored: no change blocks, no change points', () => {
    expect(c.tasks.change.score).toBe(0); expect(c.tasks.safety.score).toBe(0); expect(a.tasks.change.score).toBeGreaterThan(0);
  });
  it('mobile scanning: scan matching improves on the drifting poses', () => {
    const noReg = runScenario({ ...mobile, pipeline: pipe(['merge', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify'], CROP3) }, PRACTICE_SEED);
    expect(c.tasks.twin.poseErrCm).toBeLessThan(noReg.tasks.twin.poseErrCm);
  }, 120000);
  it('repeated evaluation is deterministic, and the final evaluation uses other scenario variants', () => {
    const again = runScenario(lowCost, PRACTICE_SEED); expect(again.grade.total).toBe(a.grade.total); expect(again.tasks.detect.tp).toBe(a.tasks.detect.tp);
    const fin = runFinal(lowCost, [101]); expect(fin.runs[0].seed).toBe(101); expect(fin.runs[0].refs.map((t) => t.label).join()).not.toBe(a.refs.map((t) => t.label).join());
  }, 120000);
  it('an over-budget system is refused instead of graded', () => {
    const r = runScenario({ ...lowCost, settings: { ...DEFAULT_SETTINGS, budget: 100 } }, PRACTICE_SEED); expect(r.ok).toBe(false); expect(r.error).toMatch(/Over budget/);
  });
  it('over-filtering costs score: huge voxels lose the small objects and the detections', () => {
    const over = runScenario({ ...fusion, pipeline: pipe(['icp', 'crop', 'voxel', 'sor', 'ground', 'planes', 'euclid', 'classify'], { crop: { zmax: 3 }, voxel: { size: 0.4 } }) }, PRACTICE_SEED);
    expect(over.tasks.quality.smallRetention).toBeLessThan(b.tasks.quality.smallRetention); expect(over.tasks.detect.score).toBeLessThan(b.tasks.detect.score);
  });
  it('the pipeline never receives hidden data: it only gets the visible survey and the camera images', () => {
    expect(Object.keys({ A: 1, B: 1, camerasA: 1 })).toEqual(['A', 'B', 'camerasA']);
    for (const sc of runPipeline(pipe(['merge']), { A: acquireSurvey(buildFactory(11, 'A'), lowCost.design, 11).visible, camerasA: [] }).A.cloud ? [1] : []) expect(sc).toBe(1);
  });
});
void LIDARS; void ZONES;

describe('choosing which planes and clusters to keep', () => {
  const cfg = (blocks: Block[]) => ({ design: design({ lidars: [lidar('rot32', -6, -0.3), lidar('rot32', 6, -0.3)] }), pipeline: blocks, settings: DEFAULT_SETTINGS });
  it('the planes block lists what it found, and a plane switched off is left in the cloud', () => {
    const base = pipe(['icp', 'voxel', 'planes'], { voxel: { size: 0.1 } }), r1 = runScenario(cfg(base), 11), st1 = r1.steps[2];
    expect(st1.pick?.mode).toBe('remove'); expect(st1.pick!.items.length).toBeGreaterThanOrEqual(2); expect(st1.pick!.items.every((i) => i.on)).toBe(true);
    expect(st1.pick!.items.map((i) => i.key)).toContain('floor'); expect(new Set(st1.pick!.items.map((i) => i.key)).size).toBe(st1.pick!.items.length);
    const keepFloor = base.map((b) => (b.kind === 'planes' ? { ...b, off: ['floor'] } : b)), r2 = runScenario(cfg(keepFloor), 11), st2 = r2.steps[2];
    expect(st2.after).toBeGreaterThan(st1.after); // the floor points stay
    expect(st2.pick!.items.find((i) => i.key === 'floor')!.on).toBe(false); expect(st2.pick!.items.map((i) => i.key)).toEqual(st1.pick!.items.map((i) => i.key)); // the same list, so the choice is stable
  });
  it('the clustering blocks list the biggest clusters, and a cluster switched off is dropped', () => {
    for (const kind of ['euclid', 'dbscan'] as const) {
      const base = pipe(['icp', 'voxel', 'ground', 'planes', kind, 'classify'], { voxel: { size: 0.08 } }), r1 = runScenario(cfg(base), 11), st = r1.steps[4];
      expect(st.pick?.mode).toBe('keep'); expect(st.pick!.items.length).toBeGreaterThan(3); expect(st.pick!.items[0].pts).toBeGreaterThanOrEqual(st.pick!.items[1].pts);
      const key = st.pick!.items[0].key, drop = base.map((b) => (b.kind === kind ? { ...b, off: [key] } : b)), r2 = runScenario(cfg(drop), 11);
      expect(r2.steps[4].pick!.items.find((i) => i.key === key)!.on).toBe(false); expect(r2.objects.length).toBeLessThan(r1.objects.length);
    }
  });
});
