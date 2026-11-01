import { describe, it, expect } from 'vitest';
import { HOUR, T0, balanceCalls, cid, guest, setup, startWorkshop, DS_KEY } from './helpers';
import { requestsLeft } from '../lib/live';

type Live = { usersNow: number; usersJoined: number; rpm: number; rpmNow: number; avgMs: number; series: { req: number; ok: number; fail: number; denied: number }[]; totals30: { req: number; ok: number; fail: number; denied: number; reasons: Record<string, number> }; balance: { ok: boolean; total?: number; currency?: string; error?: string }; left: { requests: number; basis: string; balanceUsd: number } | null; health: { store: { ok: boolean }; deepseek: { ok: boolean; detail?: string } }; capacity: { requests: number; maxTotal: number }; errors: unknown[] };
const live = async (a: Awaited<ReturnType<typeof startWorkshop>>) => (await a.call('GET', 'live')).body as Live;

describe('live monitor', () => {
  it('needs an admin session', async () => {
    const ctx = setup(); const { admin } = await import('./helpers'); expect((await admin(ctx).call('GET', 'live')).status).toBe(401);
  });

  it('counts who is here right now (last 2 minutes) and the requests of each minute', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, rpm: 60, rpmAddress: 600 }); const g = guest(ctx);
    await g('chat', cid(1)); await g('chat', cid(1)); await g('chat', cid(2));
    let v = await live(a);
    expect(v.usersNow).toBe(2); expect(v.rpmNow).toBe(3); expect(v.totals30).toMatchObject({ req: 3, ok: 3, fail: 0, denied: 0 });
    expect(v.series).toHaveLength(30); expect(v.series[29].ok).toBe(3);
    ctx.clock.t = T0 + 90e3; v = await live(a); // a minute and a half later: still here
    expect(v.usersNow).toBe(2); expect(v.rpm).toBe(3);
    ctx.clock.t = T0 + 5 * 60e3; v = await live(a); // five minutes later nobody is "now", but the history stays
    expect(v.usersNow).toBe(0); expect(v.usersJoined).toBe(2); expect(v.totals30.ok).toBe(3);
  });

  it('shows throttling and failures, with the reason', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, rpm: 2, rpmAddress: 600, maxPerStudent: 50 }); const g = guest(ctx);
    for (let i = 0; i < 4; i++) await g('chat', cid(1));
    ctx.upstream.mode = 'http500'; await g('chat', cid(2)); ctx.upstream.mode = 'ok';
    const v = await live(a);
    expect(v.totals30).toMatchObject({ ok: 2, denied: 2, fail: 1 }); expect(v.totals30.reasons.rate_limit).toBe(2);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it('asks DeepSeek for the balance with the server key, at most twice a minute, and never shows the key', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false });
    const v1 = await live(a); await live(a); await live(a);
    expect(balanceCalls).toHaveLength(1); expect((balanceCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${DS_KEY}`);
    expect(v1.balance).toMatchObject({ ok: true, total: 4.2, currency: 'USD' }); expect(JSON.stringify(v1)).not.toContain(DS_KEY);
    ctx.clock.t = T0 + 31e3; await live(a); expect(balanceCalls).toHaveLength(2);
  });

  it('turns the balance into a rough number of requests: typical at first, then from what requests really cost', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false, rpm: 60, rpmAddress: 600 }); const g = guest(ctx);
    const v0 = await live(a); expect(v0.left?.basis).toBe('typical'); expect(v0.left!.requests).toBeGreaterThan(1000);
    for (let i = 0; i < 6; i++) await g('chat', cid(1));
    ctx.clock.t = T0 + 40e3; const v1 = await live(a); expect(v1.left?.basis).toBe('measured'); // 100 in + 50 out tokens each: very cheap, so very many left
    expect(v1.left!.requests).toBeGreaterThan(v0.left!.requests);
  });

  it('copes with DeepSeek being unreachable, refusing the key, or giving no balance', async () => {
    for (const mode of ['down', 'http401', 'none'] as const) {
      const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false }); ctx.upstream.balance = mode;
      const r = await a.call('GET', 'live'); expect(r.status, mode).toBe(200); const v = r.body as Live;
      expect(v.balance.ok).toBe(false); expect(v.left).toBeNull(); expect(v.health.deepseek.ok).toBe(false); expect(v.health.deepseek.detail).toBeTruthy(); expect(v.health.store.ok).toBe(true);
    }
  });

  it('converts a balance in yuan roughly, and says so', () => {
    const r = requestsLeft({ t: 0, ok: true, ms: 1, currency: 'CNY', total: 72 }, 0, 0, T0)!; expect(r.approxCurrency).toBe(true); expect(r.balanceUsd).toBeCloseTo(10, 5);
  });

  it('keeps no prompts, answers, names or addresses in the counters', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { needCode: false }); const g = guest(ctx);
    await g('validate', cid(1), { name: 'Private Person' }); await g('chat', cid(1)); await live(a);
    const kv = JSON.stringify([...(ctx.store as unknown as { h: Map<string, Map<string, string>> }).h.entries()].filter(([k]) => k.includes(':live:')).map(([k, m]) => [k, [...m]]));
    expect(kv).not.toMatch(/Private|hello|9\.9\.9|1\.2\.3/); expect(HOUR).toBeGreaterThan(0);
  });
});
