import { describe, it, expect } from 'vitest';
import { HOUR, T0, admin, makeCodes, publicStatus, setup, startWorkshop, student } from './helpers';
import { statusOf, loadConfig } from '../lib/workshop';

describe('workshop on/off, schedule, expiry, extend', () => {
  it('is off until started; start now runs for the chosen duration, then expires on its own', async () => {
    const ctx = setup();
    expect(((await publicStatus(ctx)).body as { available: boolean }).available).toBe(false);
    await startWorkshop(ctx, 3);
    expect((await publicStatus(ctx)).body).toMatchObject({ available: true, status: 'active', endsAt: T0 + 3 * HOUR });
    ctx.clock.t = T0 + 3 * HOUR - 1;
    expect(((await publicStatus(ctx)).body as { available: boolean }).available).toBe(true);
    ctx.clock.t = T0 + 3 * HOUR; // the server decides on every request: no timer involved
    expect((await publicStatus(ctx)).body).toMatchObject({ available: false, status: 'inactive' });
    expect(statusOf(await loadConfig(ctx.store), ctx.clock.t)).toBe('expired');
  });

  it('a future workshop is scheduled, becomes active at its start and rejects students before that', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login(); await a.call('PUT', 'config', { needCode: true });
    await a.call('POST', 'workshop-start', { startAt: T0 + 2 * HOUR, endAt: T0 + 5 * HOUR });
    expect((await publicStatus(ctx)).body).toMatchObject({ available: false, status: 'scheduled', startsAt: T0 + 2 * HOUR });
    const [c] = await makeCodes(a, 1);
    expect((await student(ctx)('chat', c.code)).status).toBe(403);
    ctx.clock.t = T0 + 2 * HOUR;
    expect((await student(ctx)('chat', c.code)).status).toBe(200);
  });

  it('extending and shortening move the end; the dashboard can also switch it off immediately', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3); const [c] = await makeCodes(a, 1);
    await a.call('POST', 'workshop-extend', { minutes: 120 });
    ctx.clock.t = T0 + 4 * HOUR; expect((await student(ctx)('chat', c.code)).status).toBe(200);
    ctx.clock.t = T0;
    await a.call('POST', 'workshop-extend', { minutes: -60 });
    expect(((await a.call('GET', 'workshop')).body as { endAt: number }).endAt).toBe(T0 + 4 * HOUR);
    ctx.clock.t = T0 + 4 * HOUR; expect((await student(ctx)('chat', c.code)).status).toBe(403);
    ctx.clock.t = T0 + HOUR; expect((await student(ctx)('chat', c.code)).status).toBe(200);
    await a.call('POST', 'workshop-disable');
    expect((await student(ctx)('chat', c.code)).body).toMatchObject({ error: 'workshop_inactive' });
  });

  it('rejects impossible windows and refuses to extend an expired workshop', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    expect((await a.call('POST', 'workshop-start', { startAt: T0, endAt: T0 - 1 })).status).toBe(400);
    expect((await a.call('POST', 'workshop-start', { durationMinutes: 60 * 24 * 30 })).status).toBe(400);
    await a.call('POST', 'workshop-start', { durationMinutes: 60 });
    ctx.clock.t = T0 + 2 * HOUR;
    expect((await a.call('POST', 'workshop-extend', { minutes: 60 })).status).toBe(400);
  });

  it('codes die with the workshop: after expiry nothing works, and a new workshop starts clean', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 1); const [c] = await makeCodes(a, 1);
    expect((await student(ctx)('chat', c.code)).status).toBe(200);
    ctx.clock.t = T0 + 2 * HOUR;
    expect((await student(ctx)('chat', c.code)).body).toMatchObject({ error: 'expired' });
    expect((await student(ctx)('validate', c.code)).status).toBe(403);
    await a.call('POST', 'workshop-start', { durationMinutes: 60 });
    expect((await student(ctx)('chat', c.code)).body).toMatchObject({ error: 'invalid_code' }); // old code does not carry over
    expect(((await a.call('GET', 'workshop')).body as { requests: number }).requests).toBe(0);
  });
});

describe('access codes', () => {
  it('validates, rejects wrong codes, revokes one student without touching the others, and hides plaintext', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c1, c2] = await makeCodes(a, 2);
    expect((await student(ctx)('validate', c1.code)).body).toMatchObject({ ok: true, remainingRequests: 40 });
    expect((await student(ctx)('validate', c1.code.toLowerCase().replace('-', ' '))).status).toBe(200); // typed loosely
    expect((await student(ctx)('chat', 'AAAAA-AAAAA')).body).toMatchObject({ error: 'invalid_code' });
    expect((await student(ctx)('chat', '')).status).toBe(401);
    await a.call('POST', 'codes-revoke', { id: c1.id });
    expect((await student(ctx)('chat', c1.code)).body).toMatchObject({ error: 'revoked' });
    expect((await student(ctx)('chat', c2.code)).status).toBe(200);
    // the plaintext is nowhere in storage
    const dump = JSON.stringify([...(ctx.store as unknown as { kv: Map<string, string> }).kv.entries(), ...(ctx.store as unknown as { h: Map<string, Map<string, string>> }).h.values()].map((x) => (x instanceof Map ? [...x] : x)));
    expect(dump).not.toContain(c1.code); expect(dump).not.toContain(c1.code.replace('-', ''));
  });

  it('limits how many students can be given codes, and slows down guessing', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxStudents: 3 });
    expect((await a.call('POST', 'codes', { count: 4 })).status).toBe(400);
    await makeCodes(a, 3); expect((await a.call('POST', 'codes', { count: 1 })).status).toBe(400);
    let last = 0; for (let i = 0; i < 20; i++) last = (await student(ctx)('chat', 'WRONG-CODE0', undefined, { ip: '7.7.7.7' })).status;
    expect(last).toBe(429);
  });
});

describe('quotas', () => {
  it('per-student quota', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxPerStudent: 3, rpm: 60 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    for (let i = 0; i < 3; i++) expect((await ask('chat', c.code)).status).toBe(200);
    expect((await ask('chat', c.code)).body).toMatchObject({ error: 'student_quota' });
  });
  it('global quota is shared by all students', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxTotal: 4, rpm: 60 }); const cs = await makeCodes(a, 3); const ask = student(ctx);
    const out: number[] = []; for (const c of [...cs, ...cs]) out.push((await ask('chat', c.code)).status);
    expect(out.filter((s) => s === 200)).toHaveLength(4); expect(out.filter((s) => s === 429)).toHaveLength(2);
  });
  it('rate limit per minute resets the next minute', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { rpm: 2 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    expect((await ask('chat', c.code)).status).toBe(200); expect((await ask('chat', c.code)).status).toBe(200);
    expect((await ask('chat', c.code)).body).toMatchObject({ error: 'rate_limit' });
    ctx.clock.t += 61e3; expect((await ask('chat', c.code)).status).toBe(200);
  });
  it('concurrent requests can never exceed the quota', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxPerStudent: 5, maxTotal: 8, rpm: 60 }); const [c1, c2] = await makeCodes(a, 2); const ask = student(ctx);
    const rs = await Promise.all([...Array(20)].map((_, i) => ask('chat', i % 2 ? c1.code : c2.code)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(8);
    const w = (await a.call('GET', 'workshop')).body as { requests: number; perStudent: { requests: number }[] };
    expect(w.requests).toBe(8); expect(Math.max(...w.perStudent.map((p) => p.requests))).toBeLessThanOrEqual(5);
  });
  it('token budget counts real usage and reservations for requests still in flight', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { tokenBudget: 1000, maxOutputTokens: 200, rpm: 60 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    ctx.upstream.tokens = [300, 100];
    expect((await ask('chat', c.code)).status).toBe(200); expect((await ask('chat', c.code)).status).toBe(200); // 800 used
    expect((await ask('chat', c.code, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 200 })).body).toMatchObject({ error: 'token_budget' }); // 800 + 201 reserved > 1000
    const w = (await a.call('GET', 'workshop')).body as { tokensIn: number; tokensOut: number; tokensRemaining: number; requests: number };
    expect([w.tokensIn, w.tokensOut, w.tokensRemaining, w.requests]).toEqual([600, 200, 200, 2]); // the refused request was given back
  });
  it('output tokens are capped and the model is forced to the allowlist', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxOutputTokens: 300 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    await ask('chat', c.code, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 99999 });
    const sent = JSON.parse(ctx.fetchCalls[0].init.body as string);
    expect(sent.max_tokens).toBe(300); expect(sent.model).toBe('deepseek-v4-flash');
    expect((await ask('chat', c.code, { model: 'deepseek-reasoner', messages: [{ role: 'user', content: 'hi' }] })).status).toBe(400);
  });
});

describe('Upstash replies', () => {
  it('turns the raw HGETALL list (what the real service returns) into a record, so flags like "revoked" are read correctly', async () => {
    const { hashFromReply } = await import('../lib/store');
    expect(hashFromReply(['label', 'Student 1', 'revoked', '1', 'requests', '3'])).toEqual({ label: 'Student 1', revoked: '1', requests: '3' });
    expect(hashFromReply({ label: 'A', requests: 2 })).toEqual({ label: 'A', requests: '2' });
    expect(hashFromReply([])).toBeNull(); expect(hashFromReply(null)).toBeNull();
  });
});

describe('bad input, upstream failures, backend down', () => {
  it('rejects malformed, empty, oversized and extra-roled requests', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    for (const body of [{}, { messages: [] }, { messages: 'x' }, { messages: [{ role: 'tool', content: 'x' }] }, { messages: [{ role: 'user', content: 5 }] }, { messages: [{ role: 'user', content: 'x'.repeat(400_000) }] }, { messages: Array(50).fill({ role: 'user', content: 'x' }) }, { messages: [{ role: 'user', content: 'x' }], max_tokens: -4 }])
      expect((await ask('chat', c.code, body)).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    expect((await ask('chat', c.code, {}, { tooLarge: true })).status).toBe(413);
    expect(ctx.fetchCalls).toHaveLength(0);
  });
  it('a DeepSeek failure returns a clear error and does not use up the student’s quota', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx, 3, { maxPerStudent: 2, rpm: 60 }); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    for (const mode of ['http500', 'throw', 'abort', 'empty'] as const) { ctx.upstream.mode = mode; const r = await ask('chat', c.code); expect(r.status).toBe(502); }
    ctx.upstream.mode = 'ok';
    expect((await ask('chat', c.code)).status).toBe(200); expect((await ask('chat', c.code)).status).toBe(200); // quota untouched by the 4 failures
    const w = (await a.call('GET', 'workshop')).body as { errors: { kind: string }[] };
    expect(w.errors.map((e) => e.kind).sort()).toEqual(['network', 'timeout', 'upstream', 'upstream']);
  });
  it('fails closed when the store is down, and the public status just says “no workshop”', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1);
    ctx.store.down = true;
    expect((await student(ctx)('chat', c.code)).status).toBe(503);
    expect((await publicStatus(ctx)).body).toMatchObject({ available: false });
    expect((await a.call('GET', 'workshop')).status).toBe(503);
    expect(ctx.fetchCalls).toHaveLength(0);
  });
  it('refuses everything when a required secret is missing', async () => {
    const ctx = setup(); ctx.deps.env.deepseekKey = '';
    expect((await student(ctx)('chat', 'AAAAA-AAAAA')).status).toBe(503);
  });
});

describe('the DeepSeek key never leaves the server', () => {
  it('is not in any response, error or stored value, and only goes to DeepSeek', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1); const ask = student(ctx);
    const seen: string[] = [];
    seen.push(JSON.stringify(await ask('chat', c.code)));
    ctx.upstream.mode = 'http500'; seen.push(JSON.stringify(await ask('chat', c.code))); ctx.upstream.mode = 'ok';
    seen.push(JSON.stringify(await ask('chat', 'BAD00-BAD00')), JSON.stringify(await publicStatus(ctx)), JSON.stringify((await a.call('GET', 'workshop')).body));
    ctx.deps.env.redisUrl = ''; seen.push(JSON.stringify(await ask('chat', c.code)));
    for (const s of seen) expect(s).not.toContain('sk-test');
    expect(ctx.fetchCalls.every((f) => f.url === 'https://api.deepseek.com/chat/completions')).toBe(true);
    expect((ctx.fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-secret-key-0000');
    expect(JSON.stringify([...(ctx.store as unknown as { kv: Map<string, string> }).kv.values()])).not.toContain('sk-test');
  });
  it('does not log prompts', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1); ctx.upstream.mode = 'http500';
    await student(ctx)('chat', c.code, { messages: [{ role: 'user', content: 'my secret question' }] });
    expect(JSON.stringify((await a.call('GET', 'workshop')).body)).not.toContain('secret question');
  });
});

describe('CORS', () => {
  it('only the student site may call; other origins are refused and no wildcard is ever sent', async () => {
    const ctx = setup(); const a = await startWorkshop(ctx); const [c] = await makeCodes(a, 1);
    const ok = await student(ctx)('chat', c.code); expect(ok.headers?.['Access-Control-Allow-Origin']).toBe('https://students.example');
    expect((await student(ctx)('chat', c.code, undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await publicStatus(ctx, 'https://evil.example')).headers?.['Access-Control-Allow-Origin']).toBeUndefined();
    for (const r of [ok, await publicStatus(ctx)]) expect(r.headers?.['Access-Control-Allow-Origin']).not.toBe('*');
  });
});
