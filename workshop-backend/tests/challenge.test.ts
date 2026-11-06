import { describe, it, expect } from 'vitest';
import { ORIGIN, T0, admin, mk, setup } from './helpers';
import { studentHandler, publicHandler } from '../lib/handlers';
import { parseSubmission } from '../lib/challenge';

const good = {
  name: 'Ada Lovelace', index: 'z1234567', kind: 'final', consent: true, team: 'Lidar Legends', total: 71.46,
  tasks: { twin: 0.8, detect: 0.6, colour: 0.4, change: 0.7, quality: 0.9, safety: 0.8, budget: 0.5 }, points: { twin: 16, detect: 12, colour: 4, change: 14, quality: 9, safety: 8, budget: 5 },
  device: 'abcDEF123456xyz', cost: 2400, budget: 3000, attempts: { practice: 6, final: 2 }, startedAt: T0 - 3600e3,
  equipment: { lidars: ['Medium-resolution rotating (32 ch) · standard', 'TLS high-density scanner'], cameras: ['Low-light camera'], lights: 1, platform: false },
  pipeline: ['Register scans (ICP)', 'Voxel downsample', 'Euclidean clustering'], metrics: { coverage: 0.74, 'objects found': '31/43' }, client: { tz: 'Australia/Sydney', lang: 'en-AU' },
};
const send = (ctx: ReturnType<typeof setup>, body: unknown, ip = '5.5.5.5', headers: Record<string, string> = {}) =>
  studentHandler(ctx.deps)(mk('POST', '/api/student/submit', { body, ip, headers: { origin: ORIGIN, 'x-vercel-ip-city': 'Sydney', 'x-vercel-ip-country': 'AU', ...headers } }));

/** the instructor opens score collection (the default is closed) */
async function openIt(ctx: ReturnType<typeof setup>, minutes?: number) { const a = admin(ctx); await a.login(); const r = await a.call('POST', 'challenge-start', minutes ? { durationMinutes: minutes } : {}); expect(r.status).toBe(200); return a; }
const status = (ctx: ReturnType<typeof setup>) => publicHandler(ctx.deps)(mk('GET', '/api/public/challenge', { headers: { origin: ORIGIN } }));

describe('challenge score submissions', () => {
  it('stores a score with the time, an approximate place and a network tag, and the admin can read it', async () => {
    const ctx = setup(); await openIt(ctx); ctx.clock.t = T0 + 5000;
    const r = await send(ctx, good); expect(r.status).toBe(200);
    const a = admin(ctx); await a.login();
    const list = (await a.call('GET', 'challenge')).body as { submissions: Array<Record<string, any>>; labels: Record<string, string> };
    expect(list.submissions).toHaveLength(1);
    const s = list.submissions[0];
    expect(s).toMatchObject({ name: 'Ada Lovelace', index: 'z1234567', kind: 'final', total: 71.5, at: T0 + 5000, geo: { city: 'Sydney', country: 'AU' } });
    expect(s.net).toMatch(/^[0-9a-f]{16}$/); expect(s.equipment.lidars).toHaveLength(2); expect(s.pipeline[0]).toBe('Register scans (ICP)');
    expect(s.ip).toBe('5.5.5.5'); // the address of the sending computer is kept, so one computer sending as several people can be seen
  });
  it('works with no AI workshop running (it does not depend on AI access)', async () => {
    const ctx = setup(); await openIt(ctx); expect((await send(ctx, good)).status).toBe(200);
  });
  it('same network gives the same tag, another network another; the admin can label a network', async () => {
    const ctx = setup(); await openIt(ctx); await send(ctx, good, '7.7.7.7'); await send(ctx, { ...good, index: 'z7654321', name: 'Alan Turing' }, '7.7.7.7'); await send(ctx, { ...good, index: 'z1111111', name: 'Grace Hopper' }, '8.8.8.8');
    const a = admin(ctx); await a.login();
    const subs = ((await a.call('GET', 'challenge')).body as { submissions: Array<{ net: string }> }).submissions;
    expect(new Set(subs.map((s) => s.net)).size).toBe(2);
    expect((await a.call('POST', 'challenge-label', { tag: subs[0].net, label: 'Campus Wi-Fi' })).status).toBe(200);
    expect(((await a.call('GET', 'challenge')).body as { labels: Record<string, string> }).labels[subs[0].net]).toBe('Campus Wi-Fi');
    expect((await a.call('POST', 'challenge-label', { tag: 'nope', label: 'x' })).status).toBe(400);
  });
  it('refuses bad input with a clear message and never stores markup or oversized text', async () => {
    const ctx = setup(); await openIt(ctx);
    expect((await send(ctx, { ...good, name: '' })).body).toMatchObject({ error: 'bad_request' });
    expect((await send(ctx, { ...good, index: '1' })).status).toBe(400);
    expect((await send(ctx, { ...good, consent: false })).status).toBe(400);
    expect((await send(ctx, { ...good, total: 'lots' })).status).toBe(400);
    expect((await send(ctx, 'nope')).status).toBe(400);
    expect((await send(ctx, { ...good, name: '<script>alert(1)</script>Bob', team: 'x'.repeat(500), pipeline: Array(100).fill('a') })).status).toBe(200);
    const a = admin(ctx); await a.login();
    const s = ((await a.call('GET', 'challenge')).body as { submissions: Array<Record<string, any>> }).submissions[0];
    expect(s.name).not.toMatch(/[<>]/); expect(s.team.length).toBeLessThanOrEqual(40); expect(s.pipeline.length).toBeLessThanOrEqual(30);
    expect(parseSubmission({ ...good, total: 500 })).toMatchObject({ ok: true, value: { total: 100 } }); // scores are bounded
  });
  it('only accepts requests from the student app and rate-limits a network', async () => {
    const ctx = setup(); await openIt(ctx);
    expect((await send(ctx, good, '1.1.1.1', { origin: 'https://evil.example' })).status).toBe(403);
    let last = 200; for (let i = 0; i < 85; i++) last = (await send(ctx, good, '2.2.2.2')).status;
    expect(last).toBe(429);
    expect((await send(ctx, good, '3.3.3.3')).status).toBe(200);
  });
  it('the dashboard needs a login; records can be deleted one by one or all, never automatically', async () => {
    const ctx = setup(); await openIt(ctx); await send(ctx, good); await send(ctx, { ...good, name: 'Second Person' });
    const anon = admin(ctx); expect((await anon.call('GET', 'challenge')).status).toBe(401);
    const a = admin(ctx); await a.login();
    const subs = ((await a.call('GET', 'challenge')).body as { submissions: Array<{ id: string; name: string }> }).submissions; expect(subs).toHaveLength(2);
    ctx.clock.t = T0 + 365 * 24 * 3600e3; const later = admin(ctx); await later.login(); expect(((await later.call('GET', 'challenge')).body as { submissions: unknown[] }).submissions).toHaveLength(2); // a year on: nothing expired
    ctx.clock.t = T0; 
    expect((await a.call('POST', 'challenge-delete', { id: subs[0].id })).status).toBe(200);
    expect(((await a.call('GET', 'challenge')).body as { submissions: Array<{ name: string }> }).submissions.map((s) => s.name)).toEqual([subs[1].name]);
    expect((await a.call('POST', 'challenge-delete', { id: 'missing' })).status).toBe(404);
    await a.call('POST', 'challenge-clear'); expect(((await a.call('GET', 'challenge')).body as { submissions: unknown[] }).submissions).toHaveLength(0);
  });

  it('is closed until the instructor starts it; the student app can ask whether it is open', async () => {
    const ctx = setup();
    expect((await send(ctx, good)).body).toMatchObject({ error: 'closed' }); expect((await send(ctx, good)).status).toBe(403);
    expect((await status(ctx)).body).toMatchObject({ accepting: false });
    const a = await openIt(ctx); expect((await status(ctx)).body).toMatchObject({ accepting: true });
    expect((await send(ctx, good)).status).toBe(200);
    expect(((await a.call('GET', 'challenge')).body as { accept: { accepting: boolean } }).accept.accepting).toBe(true);
  });
  it('stopping closes it at once, but the scores already sent stay, and it can be opened again', async () => {
    const ctx = setup(); const a = await openIt(ctx); await send(ctx, good);
    expect((await a.call('POST', 'challenge-stop')).status).toBe(200);
    expect((await send(ctx, { ...good, name: 'Late Student' })).status).toBe(403); expect((await status(ctx)).body).toMatchObject({ accepting: false });
    expect(((await a.call('GET', 'challenge')).body as { submissions: unknown[] }).submissions).toHaveLength(1);
    await a.call('POST', 'challenge-start', {}); expect((await send(ctx, { ...good, name: 'Back Again' })).status).toBe(200);
  });
  it('unlimited: once opened it stays open until the instructor stops it', async () => {
    const ctx = setup(); await openIt(ctx);
    ctx.clock.t = T0 + 30 * 24 * 3600e3; expect((await send(ctx, good)).status).toBe(200); expect((await status(ctx)).body).toMatchObject({ accepting: true, until: null });
  });
  it('for a number of hours: closes by itself at the end, checked on every request', async () => {
    const ctx = setup(); await openIt(ctx, 3 * 60);
    expect((await status(ctx)).body).toMatchObject({ accepting: true, until: T0 + 3 * 3600e3 });
    ctx.clock.t = T0 + 3 * 3600e3 - 1; expect((await send(ctx, good)).status).toBe(200);
    ctx.clock.t = T0 + 3 * 3600e3; expect((await send(ctx, good)).status).toBe(403); expect((await status(ctx)).body).toMatchObject({ accepting: false });
  });
  it('for a number of days, and it can be opened again afterwards', async () => {
    const ctx = setup(); const a = await openIt(ctx, 2 * 1440);
    ctx.clock.t = T0 + 2 * 24 * 3600e3 - 1000; expect((await send(ctx, good)).status).toBe(200);
    ctx.clock.t = T0 + 2 * 24 * 3600e3 + 1000; expect((await send(ctx, good)).status).toBe(403);
    const again = admin(ctx); await again.login(); await again.call('POST', 'challenge-start', {}); expect((await send(ctx, good)).status).toBe(200);
    void a;
  });
  it('refuses silly lengths of time', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    for (const bad of [0, -5, 'x', 366 * 1440, 0.2]) expect((await a.call('POST', 'challenge-start', { durationMinutes: bad })).status).toBe(400);
    expect((await a.call('POST', 'challenge-start', { durationMinutes: 365 * 1440 })).status).toBe(200);
  });
  it('only the signed-in administrator can start or stop it', async () => {
    const ctx = setup(); const anon = admin(ctx);
    expect((await anon.call('POST', 'challenge-start', {})).status).toBe(401); expect((await anon.call('POST', 'challenge-stop', {})).status).toBe(401);
  });
  it('is independent of the AI workshop: starting or ending that does not change score collection', async () => {
    const ctx = setup(); const a = await openIt(ctx);
    await a.call('POST', 'workshop-start', { durationMinutes: 60 }); await a.call('POST', 'workshop-disable');
    expect((await send(ctx, good)).status).toBe(200);
  });

  it('grading settings: set in the dashboard, read by the student app, validated, and unchanged by students', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    const def = (await status(ctx)).body as { settings: { budget: number; weights: Record<string, number>; maxSubmissions: number } };
    expect(def.settings.budget).toBe(7000); expect(def.settings.maxSubmissions).toBe(0); expect(Object.values(def.settings.weights).reduce((x, y) => x + y, 0)).toBe(100);
    const next = { budget: 9000, priceScale: 1.5, maxSubmissions: 3, weights: { twin: 30, detect: 30, colour: 0, change: 20, quality: 10, safety: 10, budget: 0 }, enabled: { twin: true, detect: true, colour: false, change: true, quality: true, safety: true, budget: false } };
    expect((await a.call('POST', 'challenge-settings', next)).status).toBe(200);
    const pub = ((await status(ctx)).body as { settings: typeof next }).settings; expect(pub).toEqual(next);
    expect(((await a.call('GET', 'challenge')).body as { settings: typeof next }).settings).toEqual(next);
    for (const bad of [{ ...next, budget: 10 }, { ...next, priceScale: 50 }, { ...next, maxSubmissions: -1 }, { ...next, weights: { ...next.weights, twin: 500 } }, { ...next, enabled: Object.fromEntries(Object.keys(next.enabled).map((k) => [k, false])) }, 'x'])
      expect((await a.call('POST', 'challenge-settings', bad)).status).toBe(400);
    expect(((await status(ctx)).body as { settings: typeof next }).settings.budget).toBe(9000); // refused changes left it alone
    expect((await admin(ctx).call('POST', 'challenge-settings', next)).status).toBe(401); // only the signed-in administrator
  });

  it('records the address and the browser id, so one computer sending under several names can be seen', async () => {
    const ctx = setup(); await openIt(ctx);
    await send(ctx, { ...good, name: 'First Person', index: 'z1111111' }, '6.6.6.6'); await send(ctx, { ...good, name: 'Second Person', index: 'z2222222' }, '6.6.6.6'); await send(ctx, { ...good, name: 'Third Person', index: 'z3333333' }, '9.9.1.1');
    const a = admin(ctx); await a.login();
    const subs = ((await a.call('GET', 'challenge')).body as { submissions: Array<{ index: string; ip: string; device: string }> }).submissions;
    expect(subs.map((s) => s.ip).sort()).toEqual(['6.6.6.6', '6.6.6.6', '9.9.1.1']); expect(subs.every((s) => s.device === 'abcDEF123456xyz')).toBe(true);
    const onIp = (ip: string) => new Set(subs.filter((s) => s.ip === ip).map((s) => s.index)).size;
    expect(onIp('6.6.6.6')).toBe(2); expect(onIp('9.9.1.1')).toBe(1);
  });
  it('a damaged address or browser id is not stored', async () => {
    const ctx = setup(); await openIt(ctx);
    await send(ctx, { ...good, device: '<script>' }, 'not an address'); const a = admin(ctx); await a.login();
    const s = ((await a.call('GET', 'challenge')).body as { submissions: Array<{ ip: string; device: string }> }).submissions[0]; expect(s.ip).toBe(''); expect(s.device).toBe('');
  });
});


it('accepts bounded mission summaries while retaining compatibility with old score records',()=>{
 const old=parseSubmission(good);expect(old.ok).toBe(true);if(old.ok)expect(old.value.missions).toBeUndefined();
 const parsed=parseSubmission({...good,missions:[{number:1,status:'passed',score:85,attempts:3,completed:true},{number:2,status:'<script>',score:999,attempts:-2}]});
 expect(parsed.ok).toBe(true);if(parsed.ok){expect(parsed.value.missions?.[0]).toMatchObject({number:1,status:'passed',score:85,attempts:3,completed:true});expect(parsed.value.missions?.[1]).toMatchObject({status:'not-attempted',score:100,attempts:0});}
});

import { scoreFlags, DEFAULT_SETTINGS } from '../lib/challenge';
describe('score consistency checks', () => {
  const tasks = { twin: 0.8, detect: 0.7, colour: 0.9, change: 0.6, quality: 0.9, safety: 1, budget: 0.5 };
  const W = 100, points = Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, Math.round((100 * (DEFAULT_SETTINGS.weights as Record<string, number>)[k] * v) / W * 10) / 10]));
  const total = Object.values(points).reduce((a, b) => a + b, 0);
  const good = { total, tasks, points, cost: 2500, budget: DEFAULT_SETTINGS.budget, kind: 'final' as const, missions: Array.from({ length: 7 }, (_, i) => ({ number: i + 1, status: i < 6 ? 'passed' : 'not-attempted', score: 80, attempts: 1, completed: i < 6 })) };
  it('an honest score has no flags', () => { expect(scoreFlags(good, DEFAULT_SETTINGS)).toEqual([]); });
  it('catches a total that was edited, spending over budget, a changed budget and a final sent too early', () => {
    expect(scoreFlags({ ...good, total: 100 }, DEFAULT_SETTINGS).join(' ')).toMatch(/not the sum/);
    expect(scoreFlags({ ...good, cost: DEFAULT_SETTINGS.budget + 1000 }, DEFAULT_SETTINGS).join(' ')).toMatch(/above the budget/);
    expect(scoreFlags({ ...good, budget: 99999 }, DEFAULT_SETTINGS).join(' ')).toMatch(/budget differs/);
    expect(scoreFlags({ ...good, points: { ...points, twin: 20 }, total: total - points.twin + 20 }, DEFAULT_SETTINGS).join(' ')).toMatch(/do not match/);
    expect(scoreFlags({ ...good, missions: good.missions.map((m, i) => (i === 2 ? { ...m, status: 'needs-improvement' } : m)) }, DEFAULT_SETTINGS).join(' ')).toMatch(/before missions/);
  });
});
