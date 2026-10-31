import { describe, it, expect } from 'vitest';
import { HOUR, T0, admin, makeCodes, publicStatus, setup, startWorkshop, student } from './helpers';
import { cleanName, geoFrom } from '../lib/workshop';

const dump = (ctx: ReturnType<typeof setup>) => JSON.stringify([
  [...(ctx.store as unknown as { kv: Map<string, string> }).kv.entries()],
  [...(ctx.store as unknown as { h: Map<string, Map<string, string>> }).h.entries()].map(([k, m]) => [k, [...m]]),
  [...(ctx.store as unknown as { l: Map<string, string[]> }).l.entries()],
]);
type Row = { label: string; name: string; city: string; country: string; firstSeen: number; lastSeen: number; requests: number; tokensIn: number; tokensOut: number; costUsd: number };
const view = async (a: ReturnType<typeof admin>) => (await a.call('GET', 'workshop')).body as { joined: number; activeNow: number; perStudent: Row[]; spendUsd: number; pricing: { peak: boolean; miss: number; out: number; model: string }; retentionDays: number };
const SYD = { 'x-vercel-ip-city': 'Sydney', 'x-vercel-ip-country': 'AU', 'x-forwarded-for': '203.0.113.77' };

describe('student analytics', () => {
  it('records joined time, name and approximate place when a student enters a code', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c1, c2] = await makeCodes(a, 2); const ask = student(ctx);
    let v = await view(a); expect(v.joined).toBe(0); expect(v.perStudent[0].firstSeen).toBe(0);
    ctx.clock.t = T0 + 5 * 60e3;
    await ask('validate', c1.code, { name: '  Priya  S. ' }, { headers: { 'x-vercel-ip-city': 'S%C3%A3o%20Paulo', 'x-vercel-ip-country': 'br' } });
    ctx.clock.t = T0 + 20 * 60e3; await ask('chat', c1.code, undefined, { headers: SYD });
    v = await view(a);
    const r = v.perStudent.find((x) => x.label === c1.label)!;
    expect(r).toMatchObject({ name: 'Priya S.', city: 'Sydney', country: 'AU', firstSeen: T0 + 5 * 60e3, lastSeen: T0 + 20 * 60e3, requests: 1 });
    expect(v.joined).toBe(1);
    expect(v.perStudent.find((x) => x.label === c2.label)!.firstSeen).toBe(0); // never joined
  });

  it('counts "active now" from recent activity only', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3); const [c1, c2] = await makeCodes(a, 2); const ask = student(ctx);
    await ask('validate', c1.code); ctx.clock.t = T0 + 8 * 60e3; await ask('validate', c2.code);
    ctx.clock.t = T0 + 12 * 60e3; expect((await view(a)).activeNow).toBe(1); // c1 last seen 12 min ago, c2 4 min ago
    ctx.clock.t = T0 + 30 * 60e3; expect((await view(a)).activeNow).toBe(0);
  });

  it('adds up the real cost per user from DeepSeek\'s advertised prices (off-peak)', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { rpm: 60 }); const [c] = await makeCodes(a, 1); // 2026-11-05 00:00 UTC is a Thursday night: off-peak
    ctx.upstream.tokens = [1000, 500]; const ask = student(ctx); await ask('chat', c.code); await ask('chat', c.code);
    const v = await view(a);
    expect(v.perStudent[0]).toMatchObject({ requests: 2, tokensIn: 2000, tokensOut: 1000 });
    const want = (2000 * 0.15 + 1000 * 0.6) / 1e6; // $0.15 in (cache miss) and $0.60 out, per 1M tokens
    expect(v.perStudent[0].costUsd).toBeCloseTo(want, 9); expect(v.spendUsd).toBeCloseTo(want, 9);
    expect(v.pricing).toMatchObject({ peak: false, miss: 0.15, out: 0.6, model: 'deepseek-flash' });
  });

  it('charges peak prices (double) during DeepSeek\'s peak hours, weekdays only, and cache hits at the cheap rate', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 72, { rpm: 60 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    ctx.upstream.tokens = [1000, 500];
    ctx.clock.t = T0 + 2 * HOUR; await ask('chat', c.code); // Thursday 02:00 UTC: peak
    const v1 = await view(a); expect(v1.spendUsd).toBeCloseTo((1000 * 0.3 + 500 * 1.2) / 1e6, 9); expect(v1.pricing.peak).toBe(true);
    ctx.clock.t = T0 + 2 * 864e5 + 2 * HOUR; // Saturday 02:00 UTC: weekend, so off-peak
    const b = admin(ctx, '6.6.6.6'); await b.login(); ctx.upstream.hit = 600; // 600 of the 1000 input tokens came from the cache
    await ask('chat', c.code);
    const v2 = (await b.call('GET', 'workshop')).body as { spendUsd: number; pricing: { peak: boolean } };
    expect(v2.pricing.peak).toBe(false);
    expect(v2.spendUsd - v1.spendUsd).toBeCloseTo((600 * 0.003 + 400 * 0.15 + 500 * 0.6) / 1e6, 9);
  });

  it('never stores an IP address, and only people who enter a code are tracked', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    await ask('validate', c.code, { name: 'Sam' }, { ip: '198.51.100.9', headers: SYD }); await ask('chat', c.code, undefined, { ip: '198.51.100.9', headers: SYD });
    await ask('chat', 'WRONG-CODE0', undefined, { ip: '198.51.100.50', headers: { ...SYD, 'x-forwarded-for': '198.51.100.50' } });
    const all = dump(ctx);
    for (const ip of ['203.0.113.77', '198.51.100.9', '198.51.100.50']) expect(all).not.toContain(ip);
    // a visitor who only opens the public page leaves no record at all
    const before = dump(ctx); await publicStatus(ctx); await publicStatus(ctx, null);
    expect(dump(ctx)).toBe(before);
    expect((await view(a)).perStudent).toHaveLength(1);
  });

  it('tells students what is collected and for how long', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1);
    expect((await publicStatus(ctx)).body).toMatchObject({ retentionDays: 30 });
    expect((await student(ctx)('validate', c.code)).body).toMatchObject({ retentionDays: 30 });
  });

  it('sanitises names and places', () => {
    expect(cleanName('<script>alert(1)</script> Al')).toBe('scriptalert(1)/script Al');
    expect(cleanName('x'.repeat(100))).toHaveLength(30); expect(cleanName(42)).toBe(''); expect(cleanName('  a \n b  ')).toBe('a b');
    expect(geoFrom({ 'x-vercel-ip-city': '%E0%A4%A', 'x-vercel-ip-country': 'ZZZ' })).toEqual({ city: '%E0%A4%A', country: '' });
    expect(geoFrom({ 'x-vercel-ip-city': 'Z%C3%BCrich', 'x-vercel-ip-country': 'ch' })).toEqual({ city: 'Zürich', country: 'CH' });
  });
});

describe('retention and deletion', () => {
  it('deletes participant records once the retention period after the workshop has passed, not before', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { retentionDays: 2 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    await ask('validate', c.code, { name: 'Kim' }, { headers: SYD }); await ask('chat', c.code);
    ctx.clock.t = T0 + 3 * HOUR + 47 * HOUR; // 47 h after the end (the old admin session has expired: log in again)
    const b = admin(ctx, '5.5.5.5'); await b.login();
    await b.call('GET', 'workshop'); expect(dump(ctx)).toContain('Kim');
    ctx.clock.t = T0 + 3 * HOUR + 49 * HOUR + 11 * 60e3; // beyond 2 days (and the 10-minute purge interval)
    expect((await b.call('GET', 'workshop')).status).toBe(200);
    const all = dump(ctx); expect(all).not.toContain('Kim'); expect(all).not.toContain('Sydney'); expect(all).not.toContain(':code:'); expect(all).not.toContain(':lookup:'); // (rate counters hold only an id and expire by themselves)
  });
  it('the retention setting is validated, and the dashboard can delete everything right away', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 2); await student(ctx)('validate', c.code, { name: 'Lee' }, { headers: SYD });
    for (const bad of [0, 400, 'x']) expect((await a.call('PUT', 'config', { retentionDays: bad })).status).toBe(400);
    expect((await a.call('PUT', 'config', { retentionDays: 7 })).status).toBe(200);
    expect((await a.call('POST', 'data-delete')).status).toBe(200);
    expect(dump(ctx)).not.toContain('Lee'); expect((await view(a)).perStudent).toHaveLength(0);
    expect((await student(ctx)('validate', c.code)).body).toMatchObject({ error: 'invalid_code' }); // the codes went with the records
  });
  it('purging needs an administrator', async () => {
    const ctx = setup(); expect((await admin(ctx).call('POST', 'data-delete')).status).toBe(401);
  });
});
