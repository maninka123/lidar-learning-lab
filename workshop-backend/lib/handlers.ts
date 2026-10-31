import type { Deps } from './env';
import { missingEnv } from './env';
import { Req, Res, json, err, corsHeaders, originAllowed, ipTag, clientIp, MAX_BODY } from './http';
import { StoreUnavailable } from './store';
import { clearCookie, createSession, csrfOk, destroySession, getSession, loginAllowed, sameOrigin, verifyPassword } from './auth';
import * as W from './workshop';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const UPSTREAM_TIMEOUT_MS = 55_000;
const MAX_MESSAGES = 40, MAX_CHARS = 380_000;

/** Run a handler so that a missing setting or an unreachable store always ends in a safe refusal, never in a stack trace. */
async function guarded(req: Req, deps: Deps, f: () => Promise<Res>, cors = false): Promise<Res> {
  let res: Res;
  try {
    const missing = missingEnv(deps.env);
    res = missing.length ? err(503, 'not_configured') : await f();
  } catch (e) {
    res = e instanceof StoreUnavailable ? err(503, 'store_unavailable') : err(500, 'server_error');
  }
  return cors ? { ...res, headers: { ...corsHeaders(req, deps), ...res.headers } } : res;
}

// ================================================================== public: is a workshop running?
export const publicHandler = (deps: Deps) => async (req: Req): Promise<Res> => {
  if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders(req, deps) };
  if (req.method !== 'GET') return err(405, 'method_not_allowed');
  // Fail closed: if anything is wrong the student app simply sees "no workshop" and keeps its normal behaviour.
  const res = await guarded(req, deps, async () => {
    const c = await W.loadConfig(deps.store), st = W.statusOf(c, deps.now());
    const body = st === 'active' ? { available: true, status: 'active', endsAt: c.endAt, maxOutputTokens: c.maxOutputTokens, retentionDays: c.retentionDays } : st === 'scheduled' ? { available: false, status: 'scheduled', startsAt: c.startAt } : { available: false, status: 'inactive' };
    return json(200, body);
  }, true);
  return res.status >= 500 ? { ...json(200, { available: false, status: 'inactive' }), headers: res.headers } : res;
};

// ================================================================== student: validate a code, chat
interface ChatInput { messages: { role: string; content: string }[]; maxTokens: number; temperature: number; chars: number; model: string }
export function parseChat(body: unknown, maxOut: number): ChatInput | string {
  if (!body || typeof body !== 'object') return 'Request body must be JSON';
  const b = body as Record<string, unknown>;
  const model = typeof b.model === 'string' ? b.model : W.MODELS[0];
  if (!(W.MODELS as readonly string[]).includes(model)) return 'That model is not available in the workshop';
  if (!Array.isArray(b.messages) || !b.messages.length || b.messages.length > MAX_MESSAGES) return `Send between 1 and ${MAX_MESSAGES} messages`;
  let chars = 0;
  const messages: { role: string; content: string }[] = [];
  for (const m of b.messages) {
    if (!m || typeof m !== 'object') return 'Invalid message';
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return 'Invalid message role';
    if (typeof content !== 'string' || !content.length) return 'Every message needs text';
    chars += content.length; messages.push({ role, content });
  }
  if (chars > MAX_CHARS) return 'The prompt is too long for the workshop';
  const mt = b.max_tokens === undefined ? 700 : Number(b.max_tokens), temp = b.temperature === undefined ? 0.2 : Number(b.temperature);
  if (!Number.isFinite(mt) || mt < 1 || !Number.isFinite(temp)) return 'Invalid max_tokens or temperature';
  return { messages, maxTokens: Math.min(Math.floor(mt), maxOut), temperature: Math.min(1, Math.max(0, temp)), chars, model };
}

const DENIED: Record<W.Denied, [number, string, string]> = {
  revoked: [403, 'revoked', 'This access code has been revoked.'],
  student_quota: [429, 'student_quota', 'You have used all of your workshop AI requests.'],
  total_quota: [429, 'total_quota', 'The workshop has reached its overall request limit.'],
  rate_limit: [429, 'rate_limit', 'Too many requests too quickly. Wait a few seconds and try again.'],
  token_budget: [429, 'token_budget', 'The workshop has reached its AI usage budget.'],
};

export const studentHandler = (deps: Deps) => async (req: Req): Promise<Res> => {
  if (req.method === 'OPTIONS') return { status: 204, headers: corsHeaders(req, deps) };
  const origin = req.headers['origin'];
  if (origin && !originAllowed(origin, deps)) return err(403, 'origin_not_allowed');
  const route = req.path.replace(/^\/api\/student\/?/, '').replace(/\/$/, '');
  if (req.method !== 'POST' || (route !== 'validate' && route !== 'chat')) return err(404, 'not_found');
  return guarded(req, deps, async () => {
    if (req.tooLarge) return err(413, 'too_large', 'The request is too large.');
    const now = deps.now(), c = await W.loadConfig(deps.store), st = W.statusOf(c, now);
    // Expiry is decided here, on every request: no timer or scheduled job is involved.
    if (st !== 'active') return err(403, st === 'expired' ? 'expired' : 'workshop_inactive', st === 'expired' ? 'The workshop has ended.' : 'There is no workshop running right now.');
    const tag = ipTag(clientIp(req.headers, req.ip)), minute = Math.floor(now / 60000), failKey = `ws:fail:${tag}:${minute}`;
    if (Number((await deps.store.get(failKey)) ?? 0) >= 15) return err(429, 'too_many_attempts', 'Too many wrong codes. Wait a minute and try again.');
    const rec = await W.findCode(deps.store, c, deps.env.authSecret, req.headers['x-workshop-code'] ?? '');
    if (!rec) { await deps.store.incr(failKey); await deps.store.expire(failKey, 120); return err(401, 'invalid_code', 'That access code is not valid.'); }
    if (rec.revoked) return err(403, 'revoked', DENIED.revoked[2]);

    const geo = W.geoFrom(req.headers); // approximate place from Vercel's headers; the address itself is not used
    await W.touchParticipant(deps.store, c.workshopId, rec, now, geo, route === 'validate' ? W.cleanName((req.body as { name?: unknown } | null)?.name) : undefined);
    await W.purgeExpired(deps.store, c, now).catch(() => 0);

    if (route === 'validate') return json(200, { ok: true, label: rec.label, remainingRequests: Math.max(0, c.maxPerStudent - rec.requests), maxOutputTokens: c.maxOutputTokens, endsAt: c.endAt, retentionDays: c.retentionDays });

    const input = parseChat(req.body, c.maxOutputTokens);
    if (typeof input === 'string') return err(400, 'bad_request', input);
    const estimate = Math.ceil(input.chars / 2.5) + input.maxTokens;
    const slot = await W.reserve(deps.store, c, rec, estimate, now);
    if (typeof slot === 'string') { const [status, code, message] = DENIED[slot]; return err(status, code, message); }

    let upstream: Response | null = null, failure = '';
    try {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
      try {
        upstream = await deps.fetch(DEEPSEEK_URL, {
          method: 'POST', signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deps.env.deepseekKey}` },
          body: JSON.stringify({ model: input.model, messages: input.messages, max_tokens: input.maxTokens, temperature: input.temperature, thinking: { type: 'disabled' } }),
        });
      } finally { clearTimeout(timer); }
    } catch (e) { failure = (e as Error).name === 'AbortError' ? 'timeout' : 'network'; }

    const data = upstream && upstream.ok ? ((await upstream.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null) : null;
    if (!data?.choices?.length) {
      await W.release(deps.store, c, slot);
      await W.logError(deps.store, { t: now, workshopId: c.workshopId, code: rec.id, kind: failure || 'upstream', status: upstream?.status });
      return err(502, 'upstream_error', failure === 'timeout' ? 'The AI took too long to answer. Try again.' : 'The AI service could not answer. Your request was not counted. Try again shortly.');
    }
    const tin = data.usage?.prompt_tokens ?? Math.ceil(input.chars / 3), tout = data.usage?.completion_tokens ?? 0;
    await W.finalize(deps.store, c, slot, tin, tout, deps.now());
    return json(200, { choices: [{ message: { content: data.choices[0].message?.content ?? '' } }], usage: { prompt_tokens: tin, completion_tokens: tout }, workshop: { remainingRequests: Math.max(0, c.maxPerStudent - rec.requests - 1) } });
  }, true);
};

// ================================================================== admin
const ok = (extra: object = {}) => json(200, { ok: true, ...extra });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

export const adminHandler = (deps: Deps) => async (req: Req): Promise<Res> => {
  if (req.tooLarge) return err(413, 'too_large');
  const route = req.path.replace(/^\/api\/admin\/?/, '').replace(/\/$/, '');
  const base = await guarded(req, deps, async () => {
    const now = deps.now();
    if (req.method !== 'GET' && !sameOrigin(req)) return err(403, 'bad_origin');

    if (route === 'login' && req.method === 'POST') {
      if (!(await loginAllowed(req, deps))) return err(429, 'too_many_attempts', 'Too many login attempts. Wait 15 minutes.');
      const pw = (req.body as { password?: unknown } | null)?.password;
      if (typeof pw !== 'string' || pw.length > 200 || !verifyPassword(pw, deps.env.adminHash)) return err(401, 'bad_login', 'Wrong password.');
      const { cookie, session } = await createSession(deps);
      return json(200, { ok: true, csrf: session.csrf, expiresAt: session.expiresAt }, { cookies: [cookie] });
    }
    const session = await getSession(req, deps);
    if (route === 'session' && req.method === 'GET') return json(200, session ? { authenticated: true, csrf: session.csrf, expiresAt: session.expiresAt, now } : { authenticated: false });
    if (!session) return err(401, 'unauthorized');
    if (req.method !== 'GET' && !csrfOk(req, session)) return err(403, 'bad_csrf');

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
    const c = await W.loadConfig(deps.store);
    const save = async (n: W.WorkshopConfig) => { await W.saveConfig(deps.store, n, now); await W.registerWorkshop(deps.store, n); return ok({ config: await W.loadConfig(deps.store), status: W.statusOf(n, now) }); };

    switch (`${req.method} ${route}`) {
      case 'POST logout': await destroySession(deps, session); return json(200, { ok: true }, { cookies: [clearCookie()] });
      case 'GET workshop': await W.purgeExpired(deps.store, c, now); return json(200, { config: c, ...(await W.stats(deps.store, c, now)) });
      case 'PUT config': {
        const p = W.parseLimits(body);
        return p.ok ? save({ ...c, ...p.values }) : err(400, 'bad_request', p.message);
      }
      case 'POST workshop-start': {
        const dur = num(body.durationMinutes), startAt = body.startAt === undefined ? now : num(body.startAt), endAt = Number.isNaN(dur) ? num(body.endAt) : startAt + dur * 60000;
        const bad = W.checkWindow({ startAt, endAt }, now);
        return bad ? err(400, 'bad_request', bad) : save(W.planWorkshop(c, { startAt, endAt }, now));
      }
      case 'POST workshop-disable': return save(W.disableWorkshop(c));
      case 'POST workshop-extend': { const d = num(body.minutes); if (!Number.isFinite(d) || d === 0) return err(400, 'bad_request', 'Give a number of minutes'); const r = W.shiftEnd(c, d * 60000, now); return typeof r === 'string' ? err(400, 'bad_request', r) : save(r); }
      case 'POST workshop-end': { const r = W.setEnd(c, num(body.endAt), now); return typeof r === 'string' ? err(400, 'bad_request', r) : save(r); }
      case 'GET codes': return json(200, { codes: await W.listCodes(deps.store, c.workshopId) });
      case 'POST codes': {
        if (c.workshopId === W.DEFAULTS.workshopId) return err(400, 'bad_request', 'Start or schedule a workshop first, then generate codes.');
        const r = await W.createCodes(deps.store, c, deps.env.authSecret, num(body.count), String(body.prefix ?? ''), now);
        return 'error' in r ? err(400, 'bad_request', r.error) : json(200, { ok: true, codes: r.codes, note: 'Copy these now. They cannot be shown again.' });
      }
      case 'POST data-delete': await W.purgeWorkshop(deps.store, c.workshopId); return ok();
      case 'POST codes-revoke': return (await W.revokeCode(deps.store, c.workshopId, String(body.id ?? ''))) ? ok() : err(404, 'not_found');
      default: return err(404, 'not_found');
    }
  });
  return { ...base, headers: { 'Cache-Control': 'no-store', ...base.headers } };
};
