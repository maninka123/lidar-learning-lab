import { createHmac, randomBytes } from 'node:crypto';
import type { Store } from './store';

export interface WorkshopConfig {
  workshopId: string;
  enabled: boolean;
  startAt: number; // epoch ms (UTC); the dashboard shows Australia/Sydney
  endAt: number;
  maxPerStudent: number;
  maxTotal: number;
  maxOutputTokens: number;
  rpm: number; // requests per minute per student
  tokenBudget: number; // 0 = no budget
  maxStudents: number;
  priceInPerM: number; // USD per million tokens; 0 = unknown, so no spend estimate is shown
  priceOutPerM: number;
  retentionDays: number; // participation records are deleted this long after the workshop ends
  updatedAt: number;
}
export type Status = 'off' | 'scheduled' | 'active' | 'expired';

export const DEFAULTS: WorkshopConfig = { workshopId: 'w0', enabled: false, startAt: 0, endAt: 0, maxPerStudent: 40, maxTotal: 1500, maxOutputTokens: 1500, rpm: 6, tokenBudget: 0, maxStudents: 40, priceInPerM: 0, priceOutPerM: 0, retentionDays: 30, updatedAt: 0 };
export const LIMITS = { maxPerStudent: [1, 1000], maxTotal: [1, 100000], maxOutputTokens: [50, 4000], rpm: [1, 60], tokenBudget: [0, 1e9], maxStudents: [1, 500], priceInPerM: [0, 1000], priceOutPerM: [0, 1000], retentionDays: [1, 365] } as const;
export const MODELS = ['deepseek-v4-flash'] as const; // allowlist: the cheap model the app already uses
export const MAX_DURATION_MS = 14 * 864e5;

export const k = {
  config: 'ws:config',
  errors: 'ws:errors',
  totals: (id: string) => `ws:${id}:totals`,
  codes: (id: string) => `ws:${id}:codes`,
  meta: (id: string) => `ws:${id}:meta`,
  history: 'ws:history',
  lastPurge: 'ws:lastPurge',
  code: (id: string, cid: string) => `ws:${id}:code:${cid}`,
  lookup: (id: string, h: string) => `ws:${id}:lookup:${h}`,
  rate: (id: string, cid: string, minute: number) => `ws:${id}:rate:${cid}:${minute}`,
};

export const statusOf = (c: WorkshopConfig, now: number): Status => (!c.enabled ? 'off' : now < c.startAt ? 'scheduled' : now >= c.endAt ? 'expired' : 'active');

export async function loadConfig(s: Store): Promise<WorkshopConfig> {
  const raw = await s.get(k.config);
  if (!raw) return { ...DEFAULTS };
  try { return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WorkshopConfig>) }; } catch { return { ...DEFAULTS }; }
}
export const saveConfig = (s: Store, c: WorkshopConfig, now: number) => s.set(k.config, JSON.stringify({ ...c, updatedAt: now }));

const newId = () => 'w' + randomBytes(5).toString('hex');

/** Check and clamp limit fields from the dashboard. Returns an error message, or the cleaned values. */
export function parseLimits(input: Record<string, unknown>): { ok: true; values: Partial<WorkshopConfig> } | { ok: false; message: string } {
  const out: Record<string, number> = {};
  for (const [name, [lo, hi]] of Object.entries(LIMITS)) {
    if (input[name] === undefined) continue;
    const v = Number(input[name]);
    if (!Number.isFinite(v) || v < lo || v > hi) return { ok: false, message: `${name} must be between ${lo} and ${hi}` };
    out[name] = name.startsWith('price') ? v : Math.floor(v);
  }
  return { ok: true, values: out as Partial<WorkshopConfig> };
}

export type Plan = { startAt: number; endAt: number };
export function checkWindow(p: Plan, now: number): string | null {
  if (!Number.isFinite(p.startAt) || !Number.isFinite(p.endAt)) return 'Start and end must be valid times';
  if (p.endAt <= p.startAt) return 'The end must be after the start';
  if (p.endAt <= now) return 'The end is already in the past';
  if (p.endAt - p.startAt > MAX_DURATION_MS) return 'A workshop can last at most 14 days';
  return null;
}

/** Turn the workshop on for a window. An expired workshop is replaced by a fresh one, so old codes and counters never carry over. */
export function planWorkshop(c: WorkshopConfig, p: Plan, now: number): WorkshopConfig {
  const fresh = statusOf(c, now) === 'expired' || c.workshopId === DEFAULTS.workshopId;
  return { ...c, workshopId: fresh ? newId() : c.workshopId, enabled: true, startAt: p.startAt, endAt: p.endAt };
}
export const disableWorkshop = (c: WorkshopConfig): WorkshopConfig => ({ ...c, enabled: false });
/** Move the end of the window (positive = extend, negative = shorten). Only a running or scheduled workshop can change. */
export function shiftEnd(c: WorkshopConfig, deltaMs: number, now: number): WorkshopConfig | string {
  const st = statusOf(c, now);
  if (st !== 'active' && st !== 'scheduled') return 'Only an active or scheduled workshop can be changed';
  const endAt = c.endAt + deltaMs;
  const bad = checkWindow({ startAt: c.startAt, endAt }, now);
  return bad ?? { ...c, endAt };
}
export function setEnd(c: WorkshopConfig, endAt: number, now: number): WorkshopConfig | string {
  const st = statusOf(c, now);
  if (st !== 'active' && st !== 'scheduled') return 'Only an active or scheduled workshop can be changed';
  const bad = checkWindow({ startAt: c.startAt, endAt }, now);
  return bad ?? { ...c, endAt };
}

// ------------------------------------------------------------------ access codes
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
export const normaliseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const codeHash = (secret: string, code: string) => createHmac('sha256', createHmac('sha256', secret).update('workshop-codes').digest()).update(normaliseCode(code)).digest('hex');
export function randomCode(): string {
  const b = randomBytes(10); let s = '';
  for (let i = 0; i < 10; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`; // 50 bits
}

export interface CodeRecord {
  id: string; label: string; createdAt: number; revoked: boolean; requests: number; tokensIn: number; tokensOut: number; lastUsed: number;
  name: string; city: string; country: string; firstSeen: number; lastSeen: number;
}
const num = (v: string | undefined) => Number(v ?? 0) || 0;
const toRecord = (id: string, h: Record<string, string>): CodeRecord => ({ id, label: h.label ?? '', createdAt: num(h.createdAt), revoked: h.revoked === '1', requests: num(h.requests), tokensIn: num(h.tokensIn), tokensOut: num(h.tokensOut), lastUsed: num(h.lastUsed), name: h.name ?? '', city: h.city ?? '', country: h.country ?? '', firstSeen: num(h.firstSeen), lastSeen: num(h.lastSeen) });

export async function listCodes(s: Store, workshopId: string): Promise<CodeRecord[]> {
  const ids = await s.smembers(k.codes(workshopId));
  const rows = await Promise.all(ids.map(async (id) => { const h = await s.hgetall(k.code(workshopId, id)); return h ? toRecord(id, h) : null; }));
  return rows.filter((r): r is CodeRecord => !!r).sort((a, b) => a.createdAt - b.createdAt || a.label.localeCompare(b.label));
}

/** Create `count` codes. The plaintext codes are returned once and only their keyed hashes are stored. */
export async function createCodes(s: Store, c: WorkshopConfig, secret: string, count: number, labelPrefix: string, now: number): Promise<{ codes: { id: string; label: string; code: string }[] } | { error: string }> {
  if (!Number.isInteger(count) || count < 1 || count > 200) return { error: 'Choose between 1 and 200 codes' };
  const existing = (await listCodes(s, c.workshopId)).filter((r) => !r.revoked).length;
  if (existing + count > c.maxStudents) return { error: `The limit is ${c.maxStudents} students; ${existing} codes already exist` };
  const out: { id: string; label: string; code: string }[] = [];
  const base = existing;
  for (let i = 0; i < count; i++) {
    const code = randomCode(), id = randomBytes(4).toString('hex'), label = `${labelPrefix.trim().slice(0, 30) || 'Student'} ${base + i + 1}`;
    const hash = codeHash(secret, code); // a keyed one-way hash: kept so the record can be deleted later, useless for guessing the code
    await s.hset(k.code(c.workshopId, id), { label, createdAt: String(now), revoked: '0', requests: '0', tokensIn: '0', tokensOut: '0', lastUsed: '0', hash, firstSeen: '0', lastSeen: '0' });
    await s.set(k.lookup(c.workshopId, hash), id);
    await s.sadd(k.codes(c.workshopId), id);
    out.push({ id, label, code });
  }
  return { codes: out };
}
export async function revokeCode(s: Store, workshopId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}$/.test(id) || !(await s.hgetall(k.code(workshopId, id)))) return false;
  await s.hset(k.code(workshopId, id), { revoked: '1' });
  return true;
}
export async function findCode(s: Store, c: WorkshopConfig, secret: string, code: string): Promise<CodeRecord | null> {
  if (normaliseCode(code).length !== 10) return null;
  const id = await s.get(k.lookup(c.workshopId, codeHash(secret, code)));
  if (!id) return null;
  const h = await s.hgetall(k.code(c.workshopId, id));
  return h ? toRecord(id, h) : null;
}

// ------------------------------------------------------------------ quotas
export type Denied = 'revoked' | 'student_quota' | 'total_quota' | 'rate_limit' | 'token_budget';
export interface Reservation { id: string; tokens: number; minute: number }

/**
 * Take one request slot for a student. Each step is an atomic increment; if a later step refuses, the earlier ones are
 * given back, so concurrent requests can never push a counter past its limit for longer than the instant it takes to undo.
 */
export async function reserve(s: Store, c: WorkshopConfig, rec: CodeRecord, reserveTokens: number, now: number): Promise<Reservation | Denied> {
  if (rec.revoked) return 'revoked';
  const id = c.workshopId, cid = rec.id, minute = Math.floor(now / 60000), undo: (() => Promise<unknown>)[] = [];
  const rollback = async () => { for (const u of undo.reverse()) await u().catch(() => undefined); };
  const rk = k.rate(id, cid, minute);
  const n = await s.incr(rk);
  await s.expire(rk, 120);
  if (n > c.rpm) return 'rate_limit';
  if ((await s.hincrby(k.code(id, cid), 'requests', 1)) > c.maxPerStudent) { await s.hincrby(k.code(id, cid), 'requests', -1); return 'student_quota'; }
  undo.push(() => s.hincrby(k.code(id, cid), 'requests', -1));
  if ((await s.hincrby(k.totals(id), 'requests', 1)) > c.maxTotal) { await s.hincrby(k.totals(id), 'requests', -1); await rollback(); return 'total_quota'; }
  undo.push(() => s.hincrby(k.totals(id), 'requests', -1));
  if (c.tokenBudget > 0) {
    const reserved = await s.hincrby(k.totals(id), 'reserved', reserveTokens);
    const used = num((await s.hget(k.totals(id), 'tokensIn')) ?? '0') + num((await s.hget(k.totals(id), 'tokensOut')) ?? '0');
    if (used + reserved > c.tokenBudget) { await s.hincrby(k.totals(id), 'reserved', -reserveTokens); await rollback(); return 'token_budget'; }
    undo.push(() => s.hincrby(k.totals(id), 'reserved', -reserveTokens));
  }
  return { id: cid, tokens: c.tokenBudget > 0 ? reserveTokens : 0, minute };
}

/** Replace the reservation with what DeepSeek actually reported. */
export async function finalize(s: Store, c: WorkshopConfig, r: Reservation, tokensIn: number, tokensOut: number, now: number) {
  const id = c.workshopId;
  if (r.tokens) await s.hincrby(k.totals(id), 'reserved', -r.tokens);
  await s.hincrby(k.totals(id), 'tokensIn', tokensIn); await s.hincrby(k.totals(id), 'tokensOut', tokensOut);
  await s.hincrby(k.code(id, r.id), 'tokensIn', tokensIn); await s.hincrby(k.code(id, r.id), 'tokensOut', tokensOut);
  await s.hset(k.code(id, r.id), { lastUsed: String(now) });
}
/** The request did not produce an answer: give the slot and the reserved tokens back. */
export async function release(s: Store, c: WorkshopConfig, r: Reservation) {
  const id = c.workshopId;
  await s.hincrby(k.code(id, r.id), 'requests', -1); await s.hincrby(k.totals(id), 'requests', -1);
  if (r.tokens) await s.hincrby(k.totals(id), 'reserved', -r.tokens);
}

export interface ErrorEntry { t: number; workshopId: string; code: string; kind: string; status?: number }
/** Errors are logged without prompts, answers, codes or keys. */
export async function logError(s: Store, e: ErrorEntry) { try { await s.lpush(k.errors, JSON.stringify(e)); await s.ltrim(k.errors, 0, 49); } catch { /* logging must never break a request */ } }
export async function recentErrors(s: Store): Promise<ErrorEntry[]> {
  return (await s.lrange(k.errors, 0, 19)).map((x) => { try { return JSON.parse(x) as ErrorEntry; } catch { return null; } }).filter((x): x is ErrorEntry => !!x);
}

// ------------------------------------------------------------------ participant analytics
export const ACTIVE_WINDOW_MS = 10 * 60e3;

/** A display name typed by the student: short, plain text. */
export function cleanName(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>"'`&]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);
}
/** Approximate place from Vercel's edge headers: city and country only. The IP address itself is never read here or stored. */
export function geoFrom(headers: Record<string, string>): { city: string; country: string } {
  let city = headers['x-vercel-ip-city'] ?? '';
  try { city = decodeURIComponent(city); } catch { /* keep as is */ }
  city = city.replace(/[\u0000-\u001f\u007f<>"'`&]/g, '').trim().slice(0, 60);
  const c = (headers['x-vercel-ip-country'] ?? '').toUpperCase();
  return { city, country: /^[A-Z]{2}$/.test(c) ? c : '' };
}

/** Record that this participant was active now. The first time sets "joined". */
export async function touchParticipant(s: Store, workshopId: string, rec: CodeRecord, now: number, geo: { city: string; country: string }, name?: string) {
  const v: Record<string, string> = { lastSeen: String(now) };
  if (!rec.firstSeen) v.firstSeen = String(now);
  if (geo.country || geo.city) { v.city = geo.city; v.country = geo.country; }
  if (name) v.name = name;
  await s.hset(k.code(workshopId, rec.id), v);
}

/** Remember that this workshop exists and when it ends, so its participant records can be deleted after the retention period. */
export async function registerWorkshop(s: Store, c: WorkshopConfig) {
  if (c.workshopId === DEFAULTS.workshopId) return;
  await s.sadd(k.history, c.workshopId);
  await s.set(k.meta(c.workshopId), JSON.stringify({ startAt: c.startAt, endAt: c.endAt }));
}

/** Delete everything about the participants of one workshop: codes, names, places and usage. */
export async function purgeWorkshop(s: Store, workshopId: string) {
  for (const cid of await s.smembers(k.codes(workshopId))) {
    const h = await s.hgetall(k.code(workshopId, cid));
    if (h?.hash) await s.del(k.lookup(workshopId, h.hash));
    await s.del(k.code(workshopId, cid));
  }
  await s.del(k.codes(workshopId)); await s.del(k.totals(workshopId)); await s.del(k.meta(workshopId)); await s.srem(k.history, workshopId);
}

/** Delete the records of workshops that ended more than `retentionDays` ago. Runs at most every 10 minutes. */
export async function purgeExpired(s: Store, c: WorkshopConfig, now: number): Promise<number> {
  const last = Number((await s.get(k.lastPurge)) ?? 0);
  if (now - last < 600e3) return 0;
  await s.set(k.lastPurge, String(now));
  let n = 0;
  for (const id of await s.smembers(k.history)) {
    const raw = await s.get(k.meta(id));
    let endAt = 0; try { endAt = raw ? (JSON.parse(raw) as { endAt: number }).endAt : 0; } catch { /* treat as unknown */ }
    if (!endAt || endAt + c.retentionDays * 864e5 < now) { await purgeWorkshop(s, id); n++; }
  }
  return n;
}

// ------------------------------------------------------------------ statistics
export async function stats(s: Store, c: WorkshopConfig, now: number) {
  const t = (await s.hgetall(k.totals(c.workshopId))) ?? {}, codes = await listCodes(s, c.workshopId);
  const requests = num(t.requests), tokensIn = num(t.tokensIn), tokensOut = num(t.tokensOut);
  const priced = c.priceInPerM > 0 || c.priceOutPerM > 0;
  return {
    status: statusOf(c, now), now, startAt: c.startAt, endAt: c.endAt, remainingMs: statusOf(c, now) === 'active' ? c.endAt - now : 0,
    requests, requestsRemaining: Math.max(0, c.maxTotal - requests), tokensIn, tokensOut,
    tokenBudget: c.tokenBudget, tokensRemaining: c.tokenBudget > 0 ? Math.max(0, c.tokenBudget - tokensIn - tokensOut - num(t.reserved)) : null,
    estimatedSpendUsd: priced ? (tokensIn * c.priceInPerM + tokensOut * c.priceOutPerM) / 1e6 : null,
    codes: codes.length, activeStudents: codes.filter((r) => r.requests > 0).length, retentionDays: c.retentionDays, joined: codes.filter((r) => r.firstSeen > 0).length, activeNow: codes.filter((r) => r.lastSeen > now - ACTIVE_WINDOW_MS).length, activeWindowMin: ACTIVE_WINDOW_MS / 60e3,
    perStudent: codes.map((r) => ({ ...r, remaining: Math.max(0, c.maxPerStudent - r.requests), costUsd: priced ? (r.tokensIn * c.priceInPerM + r.tokensOut * c.priceOutPerM) / 1e6 : null })),
    errors: (await recentErrors(s)).filter((e) => e.workshopId === c.workshopId || e.workshopId === '-'),
  };
}
