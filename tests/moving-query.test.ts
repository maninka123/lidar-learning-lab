import { describe, it, expect } from 'vitest';
import { answerOffline, OFFLINE_QUESTIONS } from '../src/apps/movingQuery';
import type { TemporalGraph, Track } from '../src/apps/moving';

const seg = (x: number, y: number) => ({ id: 0, cls: 'person' as const, centre: [x, y, 1] as [number, number, number], size: [0.5, 0.5, 1.7] as [number, number, number], min: [x, y, 0] as [number, number, number], max: [x, y, 1.7] as [number, number, number], count: 50 });
const track = (id: number, cls: Track['cls'], moving: boolean, speed: number, n = 5): Track => ({ id, cls, moving, speed, vel: [speed, 0], obs: Array.from({ length: n }, (_, i) => ({ frame: i, seg: seg(i * speed * 0.8, 0) })) });
const g: TemporalGraph = {
  tracks: [track(8, 'person', true, 1.4), track(17, 'car', true, 6.8), track(2, 'car', false, 0), track(5, 'person', false, 0), track(7, 'pole / tree', false, 0), track(9, 'person', false, 0, 2)],
  events: [{ frame: 2, text: 'person #8 crosses the vehicle\'s path 8.0 m ahead', track: 8 }, { frame: 4, text: 'car #17 is approaching: 20.0 m → 9.0 m', track: 17 }, { frame: 4, text: 'car #17 comes within 9.0 m of the vehicle', track: 17 }],
  ego: Array.from({ length: 10 }, (_, i) => ({ x: i * 3.2, y: -2 })),
};

describe('answers without an AI', () => {
  it('every suggested question gets a real answer from the graph', () => {
    for (const q of OFFLINE_QUESTIONS) { const a = answerOffline(q, g); expect(a.intent).not.toBe('unknown'); expect(a.text.length).toBeGreaterThan(20); }
  });
  it('moving objects, fastest first, with their speeds', () => {
    const a = answerOffline('What is moving, and how fast?', g); expect(a.intent).toBe('moving');
    expect(a.text.indexOf('car #17')).toBeLessThan(a.text.indexOf('person #8')); expect(a.text).toContain('6.8 m/s'); expect(a.text).not.toContain('car #2 ');
  });
  it('still objects, counts, approaching, crossing and the event list', () => {
    expect(answerOffline('what is parked or standing still', g).text).toContain('car #2');
    const c = answerOffline('how many people and cars', g); expect(c.intent).toBe('count'); expect(c.text).toMatch(/person \| 2 \| 1/); // the person seen in only 2 frames is not counted
    expect(answerOffline('is anything approaching', g).text).toContain('car #17');
    expect(answerOffline('who crosses my path', g).text).toContain('person #8');
    expect(answerOffline('what happens, in order', g).text.split('\n').filter((l) => l.startsWith('| frame')).length).toBe(3);
  });
  it('says what it can answer when it does not understand', () => { const a = answerOffline('what is the meaning of life', g); expect(a.intent).toBe('unknown'); expect(a.text).toContain('What is moving'); });
});
