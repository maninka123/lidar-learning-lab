import { describe, it, expect } from 'vitest';
import { getScene, SceneDef } from '../src/scenes';
import { box } from '../src/scenes/geometry';
import { evaluate, visibilityStatus, samplesFor, coverageStats, statusShares, compareArrangements, inFov, toSensorAngles, rayFan, insideSolid, sensorOf, Scanner, SEEN, HIDDEN, OUT_FOV, OUT_RANGE } from '../src/occlusion/coverage';
import { CHALLENGES, evaluateChallenge, advice } from '../src/occlusion/challenges';

const sc = (o: Partial<Scanner> = {}): Scanner => ({ id: 0, x: 0, y: 0, z: 1.5, yaw: 0, pitch: 0, preset: 'tls', ...o });
/** a tiny world: floor, one wall straight ahead of the scanner and a second wall behind it */
const tiny = (): SceneDef => ({
  id: 'T', name: 'tiny', description: '', bounds: { min: [-6, -4, 0], max: [6, 4, 3] }, defaultPose: { x: 0, y: 0, z: 1.5, yaw: 0 }, cameraHome: [8, -8, 6], cameraTarget: [0, 0, 1],
  objects: [
    { id: 'floor', name: 'floor', classId: 0, instanceId: 0, parts: [box([0, 0, -0.05], [12, 8, 0.1])], color: [150, 150, 150], reflectivity: 0.5, scannable: true, structural: true },
    { id: 'wall', name: 'wall', classId: 1, instanceId: 1, parts: [box([3, 0, 1.5], [0.2, 2, 3])], color: [200, 200, 200], reflectivity: 0.6, scannable: true },
    { id: 'back', name: 'back', classId: 1, instanceId: 2, parts: [box([5.5, 0, 1.5], [0.2, 6, 3])], color: [100, 100, 100], reflectivity: 0.6, scannable: true },
  ],
});

describe('scanner geometry', () => {
  it('turns a world point into the scanner frame', () => {
    const a = toSensorAngles(sc({ yaw: Math.PI / 2 }), 0, 5, 1.5);
    expect(a.az).toBeCloseTo(0, 6); expect(a.dist).toBeCloseTo(5, 6);
    expect(toSensorAngles(sc(), 3, 3, 1.5).az).toBeCloseTo(45, 6);
    expect(toSensorAngles(sc({ pitch: 0.5 }), 5, 0, 1.5).el).toBeGreaterThan(0); // positive pitch = nose down, as in the scanner simulation
  });
  it('applies the horizontal and vertical field of view', () => {
    const lim = { ...sensorOf('avia') }; // 70° wide
    expect(inFov(lim, 30, 0)).toBe(true); expect(inFov(lim, 40, 0)).toBe(false); expect(inFov(lim, 0, 45)).toBe(false);
    expect(inFov(sensorOf('rot16'), 179, 10)).toBe(true); expect(inFov(sensorOf('rot16'), 0, 40)).toBe(false);
  });
});

describe('visibility', () => {
  const scene = tiny(), samples = samplesFor(scene, 4000), at = (i: number) => [samples.pos[i * 3], samples.pos[i * 3 + 1], samples.pos[i * 3 + 2]];
  const st = visibilityStatus(scene, samples, sc());
  it('sees the wall in front and not the back wall behind it', () => {
    let front = 0, behind = 0, frontSeen = 0, behindSeen = 0;
    for (let i = 0; i < samples.count; i++) {
      const [x, y] = at(i);
      if (x > 2.8 && x < 3.2 && Math.abs(y) < 1 && samples.normal[i * 3] < -0.9) { front++; if (st[i] === SEEN) frontSeen++; }
      if (x > 5.3 && Math.abs(y) < 0.8 && samples.normal[i * 3] < -0.9) { behind++; if (st[i] === SEEN) behindSeen++; }
    }
    expect(front).toBeGreaterThan(3); expect(frontSeen).toBe(front);
    expect(behind).toBeGreaterThan(3); expect(behindSeen).toBe(0);
  });
  it('marks surfaces facing away as hidden', () => {
    for (let i = 0; i < samples.count; i++) { const [x, y] = at(i); if (x > 3.05 && x < 3.2 && Math.abs(y) < 0.9 && samples.normal[i * 3] > 0.9) expect(st[i]).toBe(HIDDEN); }
  });
  it('the shadow behind an obstacle is hidden, and moving sideways reveals it', () => {
    const idx: number[] = []; for (let i = 0; i < samples.count; i++) { const [x, y] = at(i); if (x > 5.3 && Math.abs(y) < 0.8 && samples.normal[i * 3] < -0.9) idx.push(i); }
    const moved = visibilityStatus(scene, samples, sc({ y: 3 }));
    expect(idx.every((i) => st[i] === HIDDEN)).toBe(true);
    expect(idx.some((i) => moved[i] === SEEN)).toBe(true);
  });
  it('range: too far is not seen', () => {
    const far = visibilityStatus(scene, samples, sc({ preset: 'planar' })); // 30 m: everything near; use a short range override
    expect(far.some((v) => v === SEEN)).toBe(true);
    const short = visibilityStatus(scene, samples, sc(), { ...sensorOf('tls'), maxRange: 2 });
    expect(short.some((v) => v === OUT_RANGE)).toBe(true); expect(short.every((v, i) => (v === SEEN ? Math.hypot(...at(i).map((q, k) => q - [0, 0, 1.5][k])) <= 2 : true))).toBe(true);
  });
  it('field of view: a camera-like sensor looking away sees nothing of what is behind it', () => {
    const away = visibilityStatus(scene, samples, sc({ preset: 'avia', yaw: Math.PI }));
    expect(away.some((v) => v === OUT_FOV)).toBe(true);
    for (let i = 0; i < samples.count; i++) if (at(i)[0] > 2.5) expect(away[i]).not.toBe(SEEN);
  });
  it('a scanner cannot stand inside an object', () => {
    expect(insideSolid(scene, 3, 0, 1.5)).toBe(true); expect(insideSolid(scene, 0, 0, 1.5)).toBe(false);
  });
});

describe('coverage and overlap', () => {
  const scene = tiny(), samples = samplesFor(scene, 4000);
  const a = sc({ id: 0, x: -2, y: 0 }), b = sc({ id: 1, x: 4.4, y: 3 }), c = sc({ id: 2, x: 4.4, y: -3 });
  it('more scanners never see less, and overlap needs two', () => {
    const e1 = evaluate(scene, [a]).stats, e2 = evaluate(scene, [a, b]).stats, e3 = evaluate(scene, [a, b, c]).stats;
    expect(e2.coverage).toBeGreaterThanOrEqual(e1.coverage); expect(e3.coverage).toBeGreaterThanOrEqual(e2.coverage);
    expect(e1.overlap).toBe(0); expect(e2.overlap).toBeGreaterThan(0); expect(e2.overlap).toBeLessThanOrEqual(e2.coverage);
    expect(e1.coverage + e1.unobserved).toBeCloseTo(1, 6);
  });
  it('per-scanner shares, unique shares and area weighting add up', () => {
    const e = evaluate(scene, [a, b]).stats;
    expect(e.perScanner[0].seen).toBeGreaterThan(e.perScanner[0].unique);
    const union = e.perScanner[0].unique + e.perScanner[1].unique + e.overlap;
    expect(union).toBeCloseTo(e.coverage, 6);
    expect(e.why.hidden + e.why.outFov + e.why.outRange).toBeCloseTo(e.unobserved > 0 ? 1 : 0, 6);
  });
  it('the same scanner twice adds coverage of nothing but overlap', () => {
    const one = evaluate(scene, [a]).stats, two = evaluate(scene, [a, { ...a, id: 1 }]).stats;
    expect(two.coverage).toBeCloseTo(one.coverage, 9); expect(two.overlap).toBeCloseTo(one.coverage, 9);
  });
  it('no scanners: nothing observed', () => { const e = evaluate(scene, []).stats; expect(e.coverage).toBe(0); expect(e.unobserved).toBeCloseTo(1, 9); });
  it('single-scanner shares sum to one', () => {
    const s = statusShares(samples, evaluate(scene, [a]).status[0]); expect(s.seen + s.hidden + s.outFov + s.outRange).toBeCloseTo(1, 6);
  });
  it('compares two arrangements: gained and lost surface', () => {
    const A = evaluate(scene, [a]).stats, B = evaluate(scene, [a, b]).stats, d = compareArrangements(samples, A, B);
    expect(d.gained).toBeGreaterThan(0); expect(d.lost).toBe(0); expect(d.delta).toBeCloseTo(B.coverage - A.coverage, 9);
    const r = compareArrangements(samples, B, A); expect(r.lost).toBeCloseTo(d.gained, 9);
  });
  it('is deterministic', () => { expect(evaluate(scene, [a, b]).stats.coverage).toBe(evaluate(scene, [a, b]).stats.coverage); });
  it('coverageStats works with raw status arrays', () => {
    const s = coverageStats(samples, [new Uint8Array(samples.count).fill(SEEN)]); expect(s.coverage).toBeCloseTo(1, 9); expect(s.perScanner[0].unique).toBeCloseTo(1, 9);
  });
  it('the ray fan hits walls and misses nothing inside a closed room', () => {
    const fan = rayFan(getScene('A'), sc({ x: 0, y: 0 }), sensorOf('rot16'), 60, 3);
    expect(fan.n).toBe(180); expect(fan.hit.some((h) => h === 1)).toBe(true);
  });
});

describe('real environments', () => {
  it('the three environments give a stable, plausible coverage for a single scanner', () => {
    for (const id of ['A', 'B', 'C'] as const) {
      const scene = getScene(id), e = evaluate(scene, [sc({ x: scene.defaultPose.x, y: scene.defaultPose.y })]);
      expect(e.samples.count).toBeGreaterThan(1500); expect(e.stats.coverage).toBeGreaterThan(0.3); expect(e.stats.coverage).toBeLessThan(1);
    }
  });
  it('switching environment changes the samples (stale results cannot be reused)', () => {
    expect(samplesFor(getScene('A')).count).not.toBe(samplesFor(getScene('B')).count);
    expect(samplesFor(getScene('A'))).toBe(samplesFor(getScene('A')));
  });
});

describe('challenges', () => {
  for (const ch of CHALLENGES) {
    it(`${ch.id}: the reference placement wins within the scanner limit, and one scanner alone is not enough`, () => {
      const scene = getScene(ch.scene), sc2 = ch.reference.map((p, i) => sc({ id: i, x: p.x, y: p.y, z: ch.height, preset: ch.preset }));
      expect(sc2.length).toBeLessThanOrEqual(ch.maxScanners);
      sc2.forEach((s) => expect(insideSolid(scene, s.x, s.y, s.z)).toBe(false));
      const e = evaluate(scene, sc2).stats, r = evaluateChallenge(ch, sc2.length, e);
      expect(e.coverage).toBeGreaterThanOrEqual(ch.target); expect(r.done).toBe(true);
      expect(evaluate(scene, [sc2[0]]).stats.coverage).toBeLessThan(ch.target);
    });
  }
  it('too many scanners do not count, and advice explains a poor placement', () => {
    const ch = CHALLENGES[0], scene = getScene(ch.scene), bad = [sc({ x: 3, y: 2, preset: 'tls' }), sc({ id: 1, x: 3.1, y: 2.1, preset: 'tls' })];
    const e = evaluate(scene, bad).stats;
    expect(evaluateChallenge(ch, 9, { ...e, coverage: 1 }).done).toBe(false);
    expect(evaluateChallenge(ch, 9, e).overLimit).toBe(true);
    const tips = advice(ch, e);
    expect(tips.length).toBeGreaterThan(0); expect(tips.join(' ')).toMatch(/adds almost nothing|mostly the same/);
    expect(advice(ch, null)[0]).toMatch(/Place a scanner/);
  });
});
