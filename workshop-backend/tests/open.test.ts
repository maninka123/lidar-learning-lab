import { describe, it, expect } from 'vitest';
import { HOUR, T0, admin, cid, guest, publicStatus, setup, startWorkshop, student, makeCodes } from './helpers';

const dump = (ctx: ReturnType<typeof setup>) => JSON.stringify([
  [...(ctx.store as unknown as { kv: Map<string, string> }).kv.entries()],
  [...(ctx.store as unknown as { h: Map<string, Map<string, string>> }).h.entries()].map(([k, m]) => [k, [...m]]),
]);
type W = { joined: number; perStudent: { label: string; name: string; requests: number; tokensIn: number }[]; requests: number };
const view = async (a: ReturnType<typeof admin>) => (await a.call('GET', 'workshop')).body as W;

describe('open access (no codes)', () => {
  it('is the default: no code is needed, each browser becomes a guest and is counted on its own', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, rpm: 60 }); const g = guest(ctx);
    expect((await publicStatus(ctx)).body).toMatchObject({ available: true, needCode: false });
    expect((await g('chat', cid(1))).status).toBe(200); expect((await g('chat', cid(1))).status).toBe(200); expect((await g('chat', cid(2))).status).toBe(200);
    const v = await view(a);
    expect(v.joined).toBe(2); expect(v.perStudent.map((x) => [x.label, x.requests]).sort()).toEqual([['Guest 1', 2], ['Guest 2', 1]]);
  });

  it('still ends with the workshop and refuses before it starts', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 1, { needCode: false }); const g = guest(ctx);
    ctx.clock.t = T0 + 2 * HOUR; expect((await g('chat', cid(1))).body).toMatchObject({ error: 'expired' });
    await a.login(); // (the old admin session is still valid within 8 h)
    await a.call('POST', 'workshop-disable'); ctx.clock.t = T0; expect((await g('chat', cid(1))).body).toMatchObject({ error: 'workshop_inactive' });
  });

  it('a student can add an optional name, which only the instructor sees', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    expect((await g('validate', cid(1), { name: '  Jo   Lee ' }, { headers: { 'x-vercel-ip-city': 'Perth', 'x-vercel-ip-country': 'AU' } })).status).toBe(200);
    expect((await view(a)).perStudent[0]).toMatchObject({ name: 'Jo Lee', label: 'Guest 1' });
  });

  it('rejects a missing or malformed browser id', async () => {
    const ctx = setup(); await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    for (const id of [null, '', 'short', 'x'.repeat(100), 'has spaces and !!! chars here']) expect((await g('chat', id)).status, String(id)).toBe(400);
    expect(ctx.fetchCalls).toHaveLength(0);
  });

  it('keeps per-student quotas, and the workshop-wide caps still hold', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, maxPerStudent: 2, maxTotal: 5, rpm: 60 }); const g = guest(ctx);
    expect([(await g('chat', cid(1))).status, (await g('chat', cid(1))).status, (await g('chat', cid(1))).body]).toEqual([200, 200, expect.objectContaining({ error: 'student_quota' })]);
    for (const n of [2, 3]) await g('chat', cid(n)); // 2 + 1 + 1 = 4
    expect((await g('chat', cid(4))).status).toBe(200); expect((await g('chat', cid(4))).body).toMatchObject({ error: 'total_quota' });
    expect((await view(a)).requests).toBe(5);
  });

  it('inventing new browser ids cannot get past the per-address limits', async () => {
    const ctx = setup(); await startWorkshop(ctx, 3, { needCode: false, maxPerStudent: 1, maxPerAddress: 6, rpmAddress: 100, maxStudents: 50 }); const g = guest(ctx);
    const out: number[] = []; for (let i = 1; i <= 12; i++) out.push((await g('chat', cid(i), undefined, { ip: '9.9.9.9' })).status);
    expect(out.filter((s) => s === 200)).toHaveLength(6); // one address, many fake students: capped
    expect((await g('chat', cid(99), undefined, { ip: '8.8.8.8' })).status).toBe(200); // a different network is unaffected
  });

  it('a per-minute limit per address, and a refused request gives the address its slot back', async () => {
    const ctx = setup(); await startWorkshop(ctx, 3, { needCode: false, rpmAddress: 3, rpm: 60 }); const g = guest(ctx);
    const out: unknown[] = []; for (let i = 1; i <= 5; i++) out.push((await g('chat', cid(i), undefined, { ip: '5.5.5.5' })).status);
    expect(out).toEqual([200, 200, 200, 429, 429]); ctx.clock.t += 61e3; expect((await g('chat', cid(6), undefined, { ip: '5.5.5.5' })).status).toBe(200);
    ctx.upstream.mode = 'http500'; ctx.clock.t += 61e3; expect((await g('chat', cid(7), undefined, { ip: '5.5.5.5' })).status).toBe(502); // the failed one is not counted
  });

  it('the seat limit stops the workshop filling with fake guests', async () => {
    const ctx = setup(); await startWorkshop(ctx, 3, { needCode: false, maxStudents: 3, maxPerAddress: 1000 }); const g = guest(ctx);
    const out: unknown[] = []; for (let i = 1; i <= 5; i++) out.push((await g('chat', cid(i), undefined, { ip: `1.1.1.${i}` })).status);
    expect(out).toEqual([200, 200, 200, 429, 429]); expect((await g('chat', cid(1), undefined, { ip: '1.1.1.9' })).status).toBe(200); // an existing guest keeps working
    expect((await g('chat', cid(5), undefined, { ip: '1.1.1.9' })).body).toMatchObject({ error: 'workshop_full' });
  });

  it('concurrent first requests from one browser make one guest, not several', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, rpm: 60 }); const g = guest(ctx);
    const rs = await Promise.all([...Array(6)].map(() => g('chat', cid(1))));
    expect(rs.every((r) => r.status === 200)).toBe(true); const v = await view(a); expect(v.perStudent).toHaveLength(1); expect(v.perStudent[0].requests).toBe(6);
  });

  it('an instructor can block one guest', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    await g('chat', cid(1)); const id = (await (a.call('GET', 'codes'))).body as { codes: { id: string }[] };
    await a.call('POST', 'codes-revoke', { id: id.codes[0].id });
    expect((await g('chat', cid(1))).body).toMatchObject({ error: 'revoked' }); expect((await g('chat', cid(2))).status).toBe(200);
  });

  it('never stores the browser id or the IP address in a readable form', async () => {
    const ctx = setup(); await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    await g('chat', cid(1), undefined, { ip: '203.0.113.77', headers: { 'x-forwarded-for': '203.0.113.77' } });
    const all = dump(ctx); expect(all).not.toContain('203.0.113.77'); expect(all).not.toContain(cid(1));
  });

  it('switching to access codes makes the old open access stop, and codes work again', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    expect((await g('chat', cid(1))).status).toBe(200);
    await a.call('PUT', 'config', { needCode: true });
    expect((await g('chat', cid(1))).body).toMatchObject({ error: 'invalid_code' });
    const [c] = await makeCodes(a, 1); expect((await student(ctx)('chat', c.code)).status).toBe(200);
    expect((await a.call('PUT', 'config', { needCode: 'yes' })).status).toBe(400);
  });
});
