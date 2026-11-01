import type { Deps } from './env';
import type { Store } from './store';
import { costNano } from './pricing';
import * as W from './workshop';

/** Live monitoring: tiny per-minute counters written by the student endpoint and read by the dashboard. Nothing here holds a prompt, an answer, a name or an address. */
const key = (id: string, minute: number) => `ws:${id}:live:${minute}`;
const TTL = 3 * 3600;

export type LiveEvent = 'ok' | 'fail' | 'denied';
/** Count one thing that happened in this minute. Never throws: monitoring must not break a student's request. */
export async function bump(s: Store, workshopId: string, now: number, ev: LiveEvent, o: { ms?: number; reason?: string } = {}) {
  try {
    const k = key(workshopId, Math.floor(now / 60000));
    const jobs: Promise<unknown>[] = [s.hincrby(k, 'req', 1), s.hincrby(k, ev, 1)];
    if (ev === 'ok' && o.ms !== undefined) { jobs.push(s.hincrby(k, 'ms', Math.round(o.ms))); }
    if (ev === 'denied' && o.reason) jobs.push(s.hincrby(k, `d:${o.reason}`, 1));
    await Promise.all(jobs); await s.expire(k, TTL);
  } catch { /* ignore */ }
}

export interface Minute { t: number; req: number; ok: number; fail: number; denied: number; avgMs: number; reasons: Record<string, number> }
export async function series(s: Store, workshopId: string, now: number, minutes = 30): Promise<Minute[]> {
  const cur = Math.floor(now / 60000);
  return Promise.all(Array.from({ length: minutes }, async (_, i) => {
    const m = cur - (minutes - 1 - i), h = (await s.hgetall(key(workshopId, m))) ?? {}, n = (f: string) => Number(h[f] ?? 0) || 0;
    const reasons: Record<string, number> = {}; for (const [f, v] of Object.entries(h)) if (f.startsWith('d:')) reasons[f.slice(2)] = Number(v) || 0;
    return { t: m * 60000, req: n('req'), ok: n('ok'), fail: n('fail'), denied: n('denied'), avgMs: n('ok') ? n('ms') / n('ok') : 0, reasons };
  }));
}

// ------------------------------------------------------------------ DeepSeek balance
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const BALANCE_KEY = 'ws:balance';
export interface Balance { t: number; ok: boolean; ms: number; currency?: string; total?: number; granted?: number; toppedUp?: number; available?: boolean; error?: string }

/** The account's remaining credit, asked of DeepSeek at most twice a minute (the dashboard asks every few seconds). The key stays on the server. */
export async function balance(deps: Deps, now: number, maxAgeMs = 30_000): Promise<Balance> {
  try { const raw = await deps.store.get(BALANCE_KEY); if (raw) { const b = JSON.parse(raw) as Balance; if (now - b.t < maxAgeMs) return b; } } catch { /* fetch fresh */ }
  const t0 = Date.now(); let b: Balance;
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await deps.fetch(BALANCE_URL, { headers: { Authorization: `Bearer ${deps.env.deepseekKey}`, Accept: 'application/json' }, signal: ctl.signal });
      const j = (r.ok ? await r.json().catch(() => null) : null) as { is_available?: boolean; balance_infos?: { currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }[] } | null;
      const i = j?.balance_infos?.find((x) => x.currency === 'USD') ?? j?.balance_infos?.[0];
      b = i ? { t: now, ok: true, ms: Date.now() - t0, currency: i.currency, total: Number(i.total_balance), granted: Number(i.granted_balance), toppedUp: Number(i.topped_up_balance), available: j?.is_available } : { t: now, ok: false, ms: Date.now() - t0, error: r.ok ? 'no balance in the answer' : `HTTP ${r.status}` };
    } finally { clearTimeout(timer); }
  } catch (e) { b = { t: now, ok: false, ms: Date.now() - t0, error: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' }; }
  try { await deps.store.set(BALANCE_KEY, JSON.stringify(b), 600); } catch { /* ignore */ }
  return b;
}

/** About how many more requests the remaining credit pays for, from what a request has cost so far (or a typical request before there is any data). */
export function requestsLeft(b: Balance, spendUsd: number, requests: number, now: number) {
  if (!b.ok || b.total === undefined || !Number.isFinite(b.total)) return null;
  const typical = costNano({ prompt: 2500, hit: 0, out: 500 }, now) / 1e9, measured = requests >= 5 && spendUsd > 0, perReq = measured ? spendUsd / requests : typical;
  const usd = b.currency === 'CNY' ? b.total / 7.2 : b.total; // CNY is converted at about 7.2 to the dollar: only a rough guide
  return { balanceUsd: usd, perRequestUsd: perReq, basis: measured ? 'measured' : 'typical', requests: perReq > 0 ? Math.floor(usd / perReq) : null, approxCurrency: b.currency === 'CNY' };
}

// ------------------------------------------------------------------ the student website (GitHub Pages) and GitHub's own status
const SITE_KEY = 'ws:site', GH_KEY = 'ws:ghstatus', GH_URL = 'https://www.githubstatus.com/api/v2/summary.json';
export interface SiteCheck { t: number; ok: boolean; ms: number; status?: number; throttled: boolean; url: string; error?: string }
export interface GhStatus { t: number; ok: boolean; pages?: string; overall?: string; incident?: string; error?: string }
const cached = async <T extends { t: number }>(s: Store, key: string, now: number, maxAge: number, make: () => Promise<T>): Promise<T> => {
  try { const raw = await s.get(key); if (raw) { const v = JSON.parse(raw) as T; if (now - v.t < maxAge) return v; } } catch { /* look again */ }
  const v = await make(); try { await s.set(key, JSON.stringify(v), 600); } catch { /* ignore */ } return v;
};
/** Where the lab itself is served from: the first allowed origin (for GitHub Pages that is a user site, and the lab lives in a folder). */
export const siteUrl = (deps: Deps) => { const o = deps.env.origins[0] ?? ''; return o ? (/github\.io$/.test(o) ? o + '/lidar-learning-lab/' : o + '/') : ''; };

/** Ask for the student site the way a visitor would. A 429 or 503 means the host is slowing people down. */
export const siteCheck = (deps: Deps, now: number): Promise<SiteCheck> => cached(deps.store, SITE_KEY, now, 30_000, async () => {
  const url = siteUrl(deps), t0 = Date.now(); if (!url) return { t: now, ok: false, ms: 0, throttled: false, url, error: 'no site address set' };
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try { const r = await deps.fetch(url, { method: 'GET', signal: ctl.signal, headers: { Accept: 'text/html' } }); await r.arrayBuffer().catch(() => null); return { t: now, ok: r.ok, ms: Date.now() - t0, status: r.status, throttled: r.status === 429 || r.status === 503, url, error: r.ok ? undefined : `HTTP ${r.status}` }; }
    finally { clearTimeout(timer); }
  } catch (e) { return { t: now, ok: false, ms: Date.now() - t0, throttled: false, url, error: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' }; }
});

/** GitHub's public status page: the "Pages" component and any open incident. */
export const githubStatus = (deps: Deps, now: number): Promise<GhStatus> => cached(deps.store, GH_KEY, now, 60_000, async () => {
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await deps.fetch(GH_URL, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      const j = (r.ok ? await r.json().catch(() => null) : null) as { status?: { indicator?: string; description?: string }; components?: { name?: string; status?: string }[]; incidents?: { name?: string; status?: string }[] } | null;
      if (!j) return { t: now, ok: false, error: r.ok ? 'unreadable' : `HTTP ${r.status}` };
      const pages = j.components?.find((c) => c.name?.toLowerCase() === 'pages')?.status, inc = j.incidents?.find((i) => i.status !== 'resolved' && i.status !== 'postmortem');
      return { t: now, ok: true, pages: pages ?? 'unknown', overall: j.status?.indicator ?? 'unknown', incident: inc?.name };
    } finally { clearTimeout(timer); }
  } catch (e) { return { t: now, ok: false, error: (e as Error).name === 'AbortError' ? 'timeout' : 'unreachable' }; }
});

// ------------------------------------------------------------------ the dashboard view
export async function liveView(deps: Deps, c: W.WorkshopConfig, now: number) {
  const s = deps.store, t0 = Date.now();
  const [ser, bal, codes, tot, site, gh] = await Promise.all([series(s, c.workshopId, now, 30), balance(deps, now), W.listCodes(s, c.workshopId), s.hgetall(W.k.totals(c.workshopId)), siteCheck(deps, now), githubStatus(deps, now)]);
  const storeMs = Date.now() - t0, ACTIVE = 2 * 60e3;
  const requests = Number(tot?.requests ?? 0) || 0, spendUsd = (Number(tot?.costNano ?? 0) || 0) / 1e9;
  const last = (n: number) => ser.slice(-n), sum = (a: Minute[], f: 'req' | 'ok' | 'fail' | 'denied') => a.reduce((x, m) => x + m[f], 0);
  const w5 = last(5), okN = sum(w5, 'ok');
  const reasons: Record<string, number> = {}; ser.forEach((m) => { for (const [r, v] of Object.entries(m.reasons)) reasons[r] = (reasons[r] ?? 0) + v; });
  return {
    now, status: W.statusOf(c, now),
    usersNow: codes.filter((r) => r.lastSeen > now - ACTIVE).length, usersJoined: codes.filter((r) => r.firstSeen > 0).length, maxStudents: c.maxStudents, activeWindowMin: ACTIVE / 60000,
    rpm: ser[ser.length - 2]?.req ?? 0, rpmNow: ser[ser.length - 1]?.req ?? 0, avgMs: okN ? w5.reduce((x, m) => x + m.avgMs * m.ok, 0) / okN : 0,
    series: ser, totals30: { req: sum(ser, 'req'), ok: sum(ser, 'ok'), fail: sum(ser, 'fail'), denied: sum(ser, 'denied'), reasons },
    capacity: { requests, maxTotal: c.maxTotal, spendUsd, perUserLimit: c.maxPerStudent, rpmPerUser: c.rpm, rpmPerAddress: c.rpmAddress },
    balance: bal, left: requestsLeft(bal, spendUsd, requests, now),
    site, github: gh,
    health: { store: { ok: true, ms: storeMs }, deepseek: { ok: bal.ok && bal.available !== false, ms: bal.ms, detail: bal.ok ? (bal.available === false ? 'account says it cannot take requests' : 'reachable') : bal.error } },
    errors: (await W.recentErrors(s)).filter((e) => e.workshopId === c.workshopId || e.workshopId === '-').slice(0, 8),
  };
}
