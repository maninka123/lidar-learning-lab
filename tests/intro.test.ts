import { describe, it, expect } from 'vitest';
import { canLeave, rememberIntro, shouldShowIntro, KV } from '../src/intro/logic';
import { INTRO, INTRO_COOLDOWN_MS } from '../src/intro/config';

const store = (init: Record<string, string> = {}): KV & { m: Record<string, string> } => { const m = { ...init }; return { m, getItem: (k) => m[k] ?? null, setItem: (k, v) => { m[k] = v; } }; };
const H = 3600e3, NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

describe('intro: the 2-hour cooldown', () => {
  it('is two hours, as a named constant', () => { expect(INTRO_COOLDOWN_MS).toBe(2 * 60 * 60 * 1000); expect(INTRO.cooldownMs).toBe(INTRO_COOLDOWN_MS); expect(INTRO.show).toBe('cooldown'); });
  it('shows on the first visit, and recording the time stops it showing again within two hours', () => {
    const s = store(); expect(shouldShowIntro('cooldown', s, NOW)).toBe(true); rememberIntro(s, NOW);
    expect(s.m[INTRO.storageKey]).toBe(String(NOW));
    expect(shouldShowIntro('cooldown', s, NOW + 1000)).toBe(false);            // a refresh or another tab
    expect(shouldShowIntro('cooldown', s, NOW + 2 * H - 1)).toBe(false);       // just under two hours
  });
  it('shows again at exactly two hours and the next day', () => {
    const s = store({ [INTRO.storageKey]: String(NOW) });
    expect(shouldShowIntro('cooldown', s, NOW + 2 * H)).toBe(true); expect(shouldShowIntro('cooldown', s, NOW + 24 * H)).toBe(true);
  });
  it('is measured from when the intro was shown: visits that skip it do not move the timer', () => {
    const s = store(); rememberIntro(s, NOW);                                  // shown at 12:00
    for (const m of [10, 50, 90, 119]) expect(shouldShowIntro('cooldown', s, NOW + m * 60e3)).toBe(false); // visits that skip it write nothing
    expect(s.m[INTRO.storageKey]).toBe(String(NOW));
    expect(shouldShowIntro('cooldown', s, NOW + 121 * 60e3)).toBe(true);       // 14:01: measured from 12:00, not from the 13:59 visit
  });
  it('a time in the future (clock changed), or rubbish, counts as long ago', () => {
    expect(shouldShowIntro('cooldown', store({ [INTRO.storageKey]: String(NOW + 5 * H) }), NOW)).toBe(true);
    for (const v of ['', 'abc', 'NaN']) expect(shouldShowIntro('cooldown', store({ [INTRO.storageKey]: v }), NOW), v).toBe(true);
  });
  it('"always" and "never" ignore the stored time', () => {
    const s = store({ [INTRO.storageKey]: String(NOW) }); expect(shouldShowIntro('always', s, NOW)).toBe(true); expect(shouldShowIntro('never', store(), NOW)).toBe(false);
  });
  it('the cooldown can be changed', () => { const s = store({ [INTRO.storageKey]: String(NOW) }); expect(shouldShowIntro('cooldown', s, NOW + 31 * 60e3, 30 * 60e3)).toBe(true); expect(shouldShowIntro('cooldown', s, NOW + 29 * 60e3, 30 * 60e3)).toBe(false); });
  it('unavailable or throwing storage never breaks it', () => {
    const bad: KV = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(shouldShowIntro('cooldown', bad, NOW)).toBe(true); expect(() => rememberIntro(bad, NOW)).not.toThrow(); expect(shouldShowIntro('cooldown', null, NOW)).toBe(true); expect(() => rememberIntro(null, NOW)).not.toThrow();
  });
});

describe('intro: when it may leave (unchanged)', () => {
  const base = { minMs: 2800, maxWaitMs: 15000 };
  it('not before the minimum time, even if the app is ready at once', () => expect(canLeave({ ...base, elapsedMs: 900, ready: true, skipped: false })).toBe(false));
  it('not before the app is ready, even after the minimum time', () => expect(canLeave({ ...base, elapsedMs: 5000, ready: false, skipped: false })).toBe(false));
  it('when both are true', () => expect(canLeave({ ...base, elapsedMs: 2800, ready: true, skipped: false })).toBe(true));
  it('skipping leaves at once', () => expect(canLeave({ ...base, elapsedMs: 10, ready: false, skipped: true })).toBe(true));
  it('the safety net lets go if the app never reports ready', () => { expect(canLeave({ ...base, elapsedMs: 14999, ready: false, skipped: false })).toBe(false); expect(canLeave({ ...base, elapsedMs: 15000, ready: false, skipped: false })).toBe(true); });
  it('the name is unchanged', () => expect(INTRO.title).toBe('LiDAR Learning Lab'));
});

import { buildScene, camera, project, updateDynamic, HALL } from '../src/intro/scene';
describe('intro: the point cloud scene', () => {
  const S = buildScene();
  it('is a real hall, not scattered dots: thousands of points inside the room, the same every time', () => {
    expect(S.n).toBeGreaterThan(4500); expect(S.n).toBeLessThan(7000);
    expect(Array.from(buildScene().pos.slice(0, 60))).toEqual(Array.from(S.pos.slice(0, 60)));
    for (let i = 0; i < S.dynStart; i++) { expect(Math.abs(S.pos[i * 3])).toBeLessThanOrEqual(HALL.w / 2 + 0.1); expect(S.pos[i * 3 + 1]).toBeGreaterThanOrEqual(-0.1); expect(S.pos[i * 3 + 1]).toBeLessThanOrEqual(HALL.h + 0.1); expect(S.pos[i * 3 + 2]).toBeLessThanOrEqual(HALL.depth + 0.1); }
    expect(new Set(S.cls).size).toBeGreaterThanOrEqual(8); // heights plus the amber, green and rose accents
  });
  it('the orb and dust move, the hall does not', () => {
    const before = Array.from(S.pos); updateDynamic(S, 5);
    expect(S.pos[0]).toBe(before[0]); expect(S.pos[(S.dynStart - 1) * 3]).toBe(before[(S.dynStart - 1) * 3]);
    expect(Array.from(S.pos.slice(S.dynStart * 3 + 6, S.dynStart * 3 + 30))).not.toEqual(before.slice(S.dynStart * 3 + 6, S.dynStart * 3 + 30));
  });
  it('the camera sways by at most about 5 degrees and things further away project smaller and nearer the centre', () => {
    for (let t = 0; t < 60; t += 0.7) { const c = camera(t, { calm: false, px: 0, py: 0, w: 1500, h: 900 }); expect(Math.abs(Math.asin(c.x / 14)) * 180 / Math.PI).toBeLessThan(5.2); }
    const c = camera(0, { calm: true, px: 0, py: 0, w: 1500, h: 900 }), a = { x: 0, y: 0, d: 0 }, b = { x: 0, y: 0, d: 0 };
    project(c, 3, 1, 2, 750, 450, a); project(c, 3, 1, 10, 750, 450, b); expect(b.d).toBeGreaterThan(a.d); expect(Math.abs(b.x - 750)).toBeLessThan(Math.abs(a.x - 750));
  });
});
