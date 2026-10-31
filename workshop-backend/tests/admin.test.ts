import { describe, it, expect } from 'vitest';
import { HOUR, PASSWORD, T0, USER, admin, mk, setup } from './helpers';
import { adminHandler } from '../lib/handlers';
import { hashPassword, verifyPassword } from '../lib/auth';
import { sydneyToEpoch, epochToSydneyInput, fmtDuration } from '../public/admin/tz.js';

describe('admin authentication', () => {
  it('every admin endpoint needs a session', async () => {
    const ctx = setup(); const a = admin(ctx);
    for (const [m, p] of [['GET', 'workshop'], ['PUT', 'config'], ['POST', 'workshop-start'], ['POST', 'workshop-disable'], ['POST', 'workshop-extend'], ['POST', 'workshop-end'], ['GET', 'codes'], ['POST', 'codes'], ['POST', 'codes-revoke'], ['POST', 'logout']] as const)
      expect((await a.call(m, p, {})).status, `${m} ${p}`).toBe(401);
    expect((await a.call('GET', 'session')).body).toEqual({ authenticated: false, passkeys: false });
  });
  it('rejects a wrong password, accepts the right one and sets a locked-down cookie', async () => {
    const ctx = setup(); const a = admin(ctx);
    expect((await a.login('nope nope nope')).status).toBe(401);
    expect((await a.login(PASSWORD, 'someone-else')).status).toBe(401); // right password, wrong username
    expect((await a.call('POST', 'login', { password: PASSWORD })).status).toBe(401); // no username at all
    expect(((await a.login('nope nope nope')).body as { message: string }).message).toBe('Wrong username or password.'); // does not say which one
    const r = await a.login(); expect(r.status).toBe(200);
    expect(r.cookies?.[0]).toMatch(/HttpOnly/); expect(r.cookies?.[0]).toMatch(/Secure/); expect(r.cookies?.[0]).toMatch(/SameSite=Strict/);
    expect((await a.call('GET', 'workshop')).status).toBe(200);
  });
  it('limits login attempts per address', async () => {
    const ctx = setup(); const a = admin(ctx);
    const codes: number[] = []; for (let i = 0; i < 7; i++) codes.push((await a.login('wrong password!')).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]); expect(codes[5]).toBe(429);
    expect((await a.login()).status).toBe(429); // even the right password waits
    ctx.clock.t += 16 * 60e3; expect((await a.login()).status).toBe(200);
  });
  it('requires the CSRF token and a same-site origin for changes', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    const good = a.csrf; a.csrf = '';
    expect((await a.call('POST', 'workshop-disable')).status).toBe(403);
    a.csrf = 'forged'; expect((await a.call('POST', 'workshop-disable')).status).toBe(403);
    a.csrf = good; expect((await a.call('POST', 'workshop-disable', {}, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await a.call('POST', 'workshop-disable', {}, { origin: 'https://admin.example' })).status).toBe(200);
  });
  it('a forged or tampered cookie is not a session', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    const [name, val] = a.cookie.split('='); a.cookie = `${name}=${val.slice(0, -2)}xx`; expect((await a.call('GET', 'workshop')).status).toBe(401);
    a.cookie = `${name}=fake.fake`; expect((await a.call('GET', 'workshop')).status).toBe(401);
  });
  it('the session expires after 8 hours and logout ends it at once', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    ctx.clock.t = T0 + 7 * HOUR; expect((await a.call('GET', 'workshop')).status).toBe(200);
    ctx.clock.t = T0 + 8 * HOUR; expect((await a.call('GET', 'workshop')).status).toBe(401);
    const b = admin(ctx, '8.8.8.8'); ctx.clock.t = T0; await b.login(); const cookie = b.cookie;
    await b.call('POST', 'logout'); b.cookie = cookie; expect((await b.call('GET', 'workshop')).status).toBe(401);
  });
  it('has no registration route and no default password', async () => {
    const ctx = setup(); const a = admin(ctx);
    for (const p of ['register', 'signup', 'users']) expect((await a.call('POST', p, { password: 'x' })).status).toBe(401);
    expect(verifyPassword('', ctx.deps.env.adminHash)).toBe(false);
    ctx.deps.env.adminHash = ''; expect((await adminHandler(ctx.deps)(mk('POST', '/api/admin/login', { body: { username: USER, password: PASSWORD } }))).status).toBe(503);
  });
  it('password hashes verify only the right password and are salted', () => {
    const h1 = hashPassword('abc'), h2 = hashPassword('abc');
    expect(h1).not.toBe(h2); expect(verifyPassword('abc', h1)).toBe(true); expect(verifyPassword('abd', h1)).toBe(false); expect(verifyPassword('abc', 'garbage')).toBe(false);
  });
  it('limits can be saved, but only within safe ranges', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    expect((await a.call('PUT', 'config', { maxPerStudent: 12, rpm: 3 })).status).toBe(200);
    for (const bad of [{ rpm: 0 }, { maxOutputTokens: 100000 }, { maxPerStudent: 'x' }, { tokenBudget: -1 }]) expect((await a.call('PUT', 'config', bad)).status).toBe(400);
  });
});

describe('routing on Vercel', () => {
  it('every admin and student route is a single path segment (nested paths are not routed by the [...route] files)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('lib/handlers.ts', 'utf8'); // tests run from the backend folder
    const routes = [...src.matchAll(/case '(?:GET|POST|PUT) ([^']+)'/g)].map((m) => m[1]);
    expect(routes.length).toBeGreaterThan(10);
    for (const r of routes) expect(r, r).not.toContain('/');
  });
  it('codes cannot be made before a workshop exists', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    expect((await a.call('POST', 'codes', { count: 1 })).status).toBe(400);
  });
});

describe('Australia/Sydney time', () => {
  it('converts dashboard times, including daylight saving', () => {
    expect(new Date(sydneyToEpoch('2026-07-01T09:00')).toISOString()).toBe('2026-06-30T23:00:00.000Z'); // AEST +10
    expect(new Date(sydneyToEpoch('2026-12-01T09:00')).toISOString()).toBe('2026-11-30T22:00:00.000Z'); // AEDT +11
    expect(epochToSydneyInput(sydneyToEpoch('2026-12-01T09:30'))).toBe('2026-12-01T09:30');
    expect(fmtDuration(3 * HOUR + 5 * 60e3)).toBe('3h 5m 00s');
  });
});
