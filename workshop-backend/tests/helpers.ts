import { Deps, readEnv } from '../lib/env';
import { hashPassword } from '../lib/auth';
import { MemoryStore } from '../lib/store';
import type { Req, Res } from '../lib/http';
import { adminHandler, publicHandler, studentHandler } from '../lib/handlers';

export const DS_KEY = 'sk-test-secret-key-0000';
export const PASSWORD = 'correct horse battery';
export const SECRET = 'x'.repeat(40);
export const ORIGIN = 'https://students.example';
export const T0 = Date.UTC(2026, 10, 5, 0, 0, 0);
export const HOUR = 3600e3;

export interface Ctx { deps: Deps; store: MemoryStore; clock: { t: number }; fetchCalls: { url: string; init: RequestInit }[]; upstream: { mode: 'ok' | 'http500' | 'throw' | 'abort' | 'empty'; tokens: [number, number] } }

export function setup(): Ctx {
  const store = new MemoryStore(), clock = { t: T0 }, fetchCalls: Ctx['fetchCalls'] = [], upstream: Ctx['upstream'] = { mode: 'ok', tokens: [100, 50] };
  const env = readEnv({ DEEPSEEK_API_KEY: DS_KEY, ADMIN_PASSWORD_HASH: hashPassword(PASSWORD), ADMIN_AUTH_SECRET: SECRET, FRONTEND_ORIGIN: ORIGIN, UPSTASH_REDIS_REST_URL: 'x', UPSTASH_REDIS_REST_TOKEN: 'x' });
  const fetchMock = (async (url: string, init: RequestInit) => {
    fetchCalls.push({ url, init });
    if (upstream.mode === 'throw') throw new Error('network down');
    if (upstream.mode === 'abort') { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (upstream.mode === 'http500') return new Response('{"error":{"message":"boom"}}', { status: 500, headers: { 'content-type': 'application/json' } });
    if (upstream.mode === 'empty') return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: upstream.tokens[0], completion_tokens: upstream.tokens[1] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { deps: { store, env, now: () => clock.t, fetch: fetchMock }, store, clock, fetchCalls, upstream };
}

export const mk = (method: string, path: string, o: { headers?: Record<string, string>; body?: unknown; ip?: string; tooLarge?: boolean } = {}): Req => ({ method, path, headers: { host: 'admin.example', ...(o.headers ?? {}) }, ip: o.ip ?? '1.1.1.1', body: o.body ?? null, tooLarge: o.tooLarge });

/** An admin client that keeps its session cookie and CSRF token, like the dashboard. */
export function admin(ctx: Ctx, ip = '9.9.9.9') {
  const h = adminHandler(ctx.deps); let cookie = '', csrf = '';
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Res> => {
    const res = await h(mk(method, '/api/admin/' + path, { body, ip, headers: { ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...extra } }));
    return res;
  };
  return {
    call,
    async login(pw = PASSWORD) {
      const r = await call('POST', 'login', { password: pw });
      if (r.status === 200) { cookie = (r.cookies?.[0] ?? '').split(';')[0]; csrf = (r.body as { csrf: string }).csrf; }
      return r;
    },
    get cookie() { return cookie; }, set cookie(v: string) { cookie = v; }, get csrf() { return csrf; }, set csrf(v: string) { csrf = v; },
  };
}

export async function startWorkshop(ctx: Ctx, hours = 3, limits: Record<string, number> = {}) {
  const a = admin(ctx); await a.login();
  if (Object.keys(limits).length) { const r = await a.call('PUT', 'config', limits); if (r.status !== 200) throw new Error(JSON.stringify(r.body)); }
  const r = await a.call('POST', 'workshop-start', { durationMinutes: hours * 60 });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return a;
}
export async function makeCodes(a: ReturnType<typeof admin>, count = 3) { return ((await a.call('POST', 'codes', { count, prefix: 'S' })).body as { codes: { id: string; code: string; label: string }[] }).codes; }

export const student = (ctx: Ctx) => {
  const h = studentHandler(ctx.deps);
  return (route: 'chat' | 'validate', code: string, body?: unknown, o: { ip?: string; origin?: string | null; tooLarge?: boolean; headers?: Record<string, string> } = {}) =>
    h(mk('POST', '/api/student/' + route, { body: body ?? { messages: [{ role: 'user', content: 'hi' }], max_tokens: 100 }, ip: o.ip, tooLarge: o.tooLarge, headers: { 'x-workshop-code': code, ...(o.origin === null ? {} : { origin: o.origin ?? ORIGIN }), ...(o.headers ?? {}) } }));
};
export const publicStatus = (ctx: Ctx, origin: string | null = ORIGIN) => publicHandler(ctx.deps)(mk('GET', '/api/public/status', { headers: origin ? { origin } : {} }));
