import { createHash, randomBytes } from 'node:crypto';
import type { Store } from './store';
import { geoFrom, addrTag } from './workshop';

/** Industrial Digital Twin Challenge scores sent by students. Independent of Workshop Mode: it works whether or not AI access is switched on. */
export const CH = { subs: 'ch:subs', nets: 'ch:nets', config: 'ch:config', settings: 'ch:settings', rate: (net: string, hour: number) => `ch:rate:${net}:${hour}` };
export const MAX_KEEP = 5000, MAX_PER_NET_HOUR = 80;
const TASKS = ['twin', 'detect', 'colour', 'change', 'quality', 'safety', 'budget'] as const;

export interface Submission {
  id: string; at: number; name: string; index: string; kind: 'practice' | 'final'; team: string;
  missions?: { number: number; status: string; score: number; attempts: number; completed: boolean }[];
  total: number; tasks: Record<string, number>; points: Record<string, number>; cost: number; budget: number;
  attempts: { practice: number; final: number }; startedAt: number | null;
  equipment: { lidars: string[]; cameras: string[]; lights: number; platform: boolean }; pipeline: string[];
  metrics: Record<string, string | number>; client: { tz: string; lang: string };
  /** added by the server: approximate place from the edge headers, a keyed network tag (same network, same tag), and the page address */
  geo: { city: string; country: string }; net: string; origin: string;
  /** the network address of the computer that sent it (recorded so one computer sending under several names can be seen), and a random id the browser keeps */
  ip: string; device: string;
  /** the server's own consistency checks: empty when everything adds up (see scoreFlags) */
  flags?: string[];
}

const clean = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>"'`&]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const bounded = (v: unknown, lo: number, hi: number): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : NaN; };

export type Parsed = { ok: true; value: Omit<Submission, 'id' | 'at' | 'geo' | 'net' | 'origin' | 'ip'> } | { ok: false; message: string };
/** Check everything a student sends. Text is cleaned, numbers are bounded, lists are capped: nothing is stored as received. */
export function parseSubmission(body: unknown): Parsed {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Send a JSON object.' };
  const b = body as Record<string, unknown>;
  const name = clean(b.name, 60), index = clean(b.index, 24);
  if (name.length < 2) return { ok: false, message: 'Enter your name.' };
  if (!/^[A-Za-z0-9._\/\- ]{3,24}$/.test(index)) return { ok: false, message: 'Enter your index number (3 to 24 letters or digits).' };
  if (b.consent !== true) return { ok: false, message: 'Please tick the box to agree to send this.' };
  const total = bounded(b.total, 0, 100); if (Number.isNaN(total)) return { ok: false, message: 'The score is missing.' };
  const tasks: Record<string, number> = {}, points: Record<string, number> = {};
  const tk = (b.tasks && typeof b.tasks === 'object' ? b.tasks : {}) as Record<string, unknown>, pt = (b.points && typeof b.points === 'object' ? b.points : {}) as Record<string, unknown>;
  for (const k of TASKS) { const s = bounded(tk[k], 0, 1), p = bounded(pt[k], 0, 100); tasks[k] = Number.isNaN(s) ? 0 : Math.round(s * 1000) / 1000; points[k] = Number.isNaN(p) ? 0 : Math.round(p * 10) / 10; }
  const list = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => clean(x, len)).filter(Boolean) : []);
  const eq = (b.equipment && typeof b.equipment === 'object' ? b.equipment : {}) as Record<string, unknown>;
  const at = (b.attempts && typeof b.attempts === 'object' ? b.attempts : {}) as Record<string, unknown>;
  const metrics: Record<string, string | number> = {};
  if (b.metrics && typeof b.metrics === 'object') for (const [k, v] of Object.entries(b.metrics as Record<string, unknown>).slice(0, 24)) { const key = clean(k, 30); if (!key) continue; metrics[key] = typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : clean(v, 40); }
  const cl = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>;
  const sa = bounded(b.startedAt, 1e12, 4e12);
  return {
    ok: true,
    value: {
      name, index, kind: b.kind === 'final' ? 'final' : 'practice', team: clean(b.team, 40),
      total: Math.round(total * 10) / 10, tasks, points, cost: Math.round(bounded(b.cost, 0, 1e6) || 0), budget: Math.round(bounded(b.budget, 0, 1e6) || 0),
      attempts: { practice: Math.round(bounded(at.practice, 0, 1e5) || 0), final: Math.round(bounded(at.final, 0, 1e5) || 0) }, startedAt: Number.isNaN(sa) ? null : sa,
      equipment: { lidars: list(eq.lidars, 6, 60), cameras: list(eq.cameras, 4, 60), lights: Math.round(bounded(eq.lights, 0, 10) || 0), platform: eq.platform === true },
      ...(Array.isArray(b.missions) ? { missions: b.missions.slice(0, 7).map((m, i) => { const v = m && typeof m === 'object' ? m as Record<string, unknown> : {}; return { number: i + 1, status: ['stale','needs-improvement','passed','excellent','not-attempted'].includes(String(v.status)) ? String(v.status) : 'not-attempted', score: bounded(v.score, 0, 100) || 0, attempts: Math.round(bounded(v.attempts, 0, 100000) || 0), completed: v.completed === true }; }) } : {}),
      pipeline: list(b.pipeline, 30, 50), metrics, client: { tz: clean(cl.tz, 40), lang: clean(cl.lang, 16) }, device: typeof b.device === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(b.device) ? b.device : '',
    },
  };
}

export const cleanLabel = (v: unknown) => clean(v, 30);
export const netTag = (secret: string, ip: string) => addrTag(secret, ip);

/**
 * Grading runs in the student's browser, so a score cannot be proven genuine. These checks only catch scores whose own numbers contradict each other
 * (a total that is not the sum of its parts, points that do not follow from the task scores and the instructor's weights, spending above the budget,
 * a final evaluation sent before the missions were passed). A determined forger who sends consistent numbers will not be caught.
 */
export function scoreFlags(v: Pick<Submission, 'total' | 'tasks' | 'points' | 'cost' | 'budget' | 'kind' | 'missions'>, st: ChallengeSettings): string[] {
  const flags: string[] = [], sum = TASKS.reduce((a, k) => a + (v.points[k] ?? 0), 0);
  if (Math.abs(v.total - sum) > 0.8) flags.push('The total is not the sum of the task points.');
  const W = TASKS.reduce((a, k) => a + (st.enabled[k] ? st.weights[k] : 0), 0);
  if (W > 0 && TASKS.some((k) => Math.abs((v.points[k] ?? 0) - (st.enabled[k] ? (100 * st.weights[k] * (v.tasks[k] ?? 0)) / W : 0)) > 0.8)) flags.push('Task points do not match the task scores and the current weights.');
  if (v.budget > 0 && v.cost > v.budget + 1) flags.push('Equipment cost is above the budget.');
  if (v.budget > 0 && Math.abs(v.budget - st.budget) > 1) flags.push('The budget differs from the one set here.');
  if (v.kind === 'final' && v.missions && v.missions.slice(0, 6).some((m) => m.status !== 'passed' && m.status !== 'excellent')) flags.push('Final evaluation sent before missions 1 to 6 were passed.');
  return flags;
}

/** Store a submission. Returns false when this network has sent too many in the last hour. */
export async function addSubmission(s: Store, p: Extract<Parsed, { ok: true }>['value'], ctx: { now: number; headers: Record<string, string>; ip: string; secret: string }): Promise<{ ok: true; id: string } | { ok: false }> {
  const net = netTag(ctx.secret, ctx.ip), hour = Math.floor(ctx.now / 3600000), rk = CH.rate(net, hour);
  const n = await s.incr(rk); if (n === 1) await s.expire(rk, 7200);
  if (n > MAX_PER_NET_HOUR) return { ok: false };
  const flags = scoreFlags(p, await loadSettings(s)), id = randomBytes(6).toString('hex'), sub: Submission = { ...p, flags, id, at: ctx.now, geo: geoFrom(ctx.headers), net, origin: clean(ctx.headers['origin'] ?? '', 80), ip: /^[0-9A-Fa-f:.]{3,45}$/.test(ctx.ip) ? ctx.ip : '' };
  await s.lpush(CH.subs, JSON.stringify(sub)); await s.ltrim(CH.subs, 0, MAX_KEEP - 1);
  return { ok: true, id };
}

export async function listSubmissions(s: Store, limit = 2000): Promise<Submission[]> {
  const raw = await s.lrange(CH.subs, 0, limit - 1), out: Submission[] = [];
  for (const r of raw) { try { out.push(JSON.parse(r) as Submission); } catch { /* skip a damaged record */ } }
  return out;
}
export async function netLabels(s: Store): Promise<Record<string, string>> { return (await s.hgetall(CH.nets)) ?? {}; }
export async function setNetLabel(s: Store, tag: string, label: string) { if (!/^[0-9a-f]{16}$/.test(tag)) return false; if (label) await s.hset(CH.nets, { [tag]: label }); else await s.hset(CH.nets, { [tag]: '' }); return true; }
export async function deleteSubmission(s: Store, id: string): Promise<boolean> {
  const raw = await s.lrange(CH.subs, 0, MAX_KEEP - 1); const keep = raw.filter((r) => { try { return (JSON.parse(r) as Submission).id !== id; } catch { return true; } });
  if (keep.length === raw.length) return false;
  await s.del(CH.subs); for (const r of [...keep].reverse()) await s.lpush(CH.subs, r);
  return true;
}
export const clearSubmissions = (s: Store) => s.del(CH.subs);
void createHash;

// ---- accepting scores: the instructor opens and closes it. Unlimited, or for a number of hours or days; the clock is checked on every request.
export interface AcceptConfig { open: boolean; openedAt: number; until: number | null }
export const CLOSED: AcceptConfig = { open: false, openedAt: 0, until: null };
export const MAX_OPEN_MINUTES = 365 * 24 * 60;
export async function loadAccept(s: Store): Promise<AcceptConfig> {
  const raw = await s.get(CH.config); if (!raw) return CLOSED;
  try { const o = JSON.parse(raw) as Partial<AcceptConfig>; return { open: o.open === true, openedAt: Number(o.openedAt) || 0, until: typeof o.until === 'number' ? o.until : null }; } catch { return CLOSED; }
}
export const isAccepting = (c: AcceptConfig, now: number) => c.open && (c.until === null || now < c.until);
/** `minutes` null = unlimited (open until stopped). */
export async function startAccepting(s: Store, now: number, minutes: number | null): Promise<AcceptConfig> {
  const c: AcceptConfig = { open: true, openedAt: now, until: minutes === null ? null : now + minutes * 60000 };
  await s.set(CH.config, JSON.stringify(c)); return c;
}
export async function stopAccepting(s: Store): Promise<AcceptConfig> { const c = { ...(await loadAccept(s)), open: false }; await s.set(CH.config, JSON.stringify(c)); return c; }

// ---- grading settings: set by the instructor here, read by the student app (not editable there)
export type TaskKey = (typeof TASKS)[number];
export interface ChallengeSettings { budget: number; priceScale: number; maxSubmissions: number; weights: Record<TaskKey, number>; enabled: Record<TaskKey, boolean> }
export const DEFAULT_SETTINGS: ChallengeSettings = {
  budget: 3000, priceScale: 1, maxSubmissions: 0,
  weights: { twin: 20, detect: 20, colour: 10, change: 20, quality: 10, safety: 10, budget: 10 },
  enabled: { twin: true, detect: true, colour: true, change: true, quality: true, safety: true, budget: true },
};
export const TASK_LIST = TASKS;
export type ParsedSettings = { ok: true; value: ChallengeSettings } | { ok: false; message: string };
/** Check every number: the dashboard can only ever store sensible values. */
export function parseSettings(body: unknown): ParsedSettings {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Send the settings as JSON.' };
  const b = body as Record<string, unknown>;
  const budget = Number(b.budget), scale = Number(b.priceScale), maxS = Number(b.maxSubmissions);
  if (!Number.isFinite(budget) || budget < 500 || budget > 1e6) return { ok: false, message: 'Budget must be between 500 and 1,000,000 credits.' };
  if (!Number.isFinite(scale) || scale < 0.2 || scale > 5) return { ok: false, message: 'Price scale must be between 0.2 and 5.' };
  if (!Number.isFinite(maxS) || maxS < 0 || maxS > 1000) return { ok: false, message: 'Final evaluations allowed must be between 0 (as many as wanted) and 1000.' };
  const w = (b.weights && typeof b.weights === 'object' ? b.weights : {}) as Record<string, unknown>, e = (b.enabled && typeof b.enabled === 'object' ? b.enabled : {}) as Record<string, unknown>;
  const weights = {} as Record<TaskKey, number>, enabled = {} as Record<TaskKey, boolean>;
  for (const k of TASKS) {
    const v = Number(w[k]); if (!Number.isFinite(v) || v < 0 || v > 100) return { ok: false, message: `The weight of "${k}" must be between 0 and 100.` };
    weights[k] = Math.round(v); enabled[k] = e[k] !== false;
  }
  if (!TASKS.some((k) => enabled[k] && weights[k] > 0)) return { ok: false, message: 'Switch on at least one task with a weight above 0.' };
  return { ok: true, value: { budget: Math.round(budget), priceScale: Math.round(scale * 100) / 100, maxSubmissions: Math.round(maxS), weights, enabled } };
}
export async function loadSettings(s: Store): Promise<ChallengeSettings> {
  const raw = await s.get(CH.settings); if (!raw) return DEFAULT_SETTINGS;
  try { const p = parseSettings(JSON.parse(raw)); return p.ok ? p.value : DEFAULT_SETTINGS; } catch { return DEFAULT_SETTINGS; }
}
export const saveSettings = (s: Store, v: ChallengeSettings) => s.set(CH.settings, JSON.stringify(v));
