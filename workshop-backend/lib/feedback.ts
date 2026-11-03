import { randomBytes } from 'node:crypto';
import type { Store } from './store';
import { ipTag } from './http';

/**
 * Anonymous student feedback from the Thank You page. It is independent of Workshop Mode and of the AI key.
 * A record holds ratings, a module choice and an optional comment: no name, no address, no browser id.
 * Records live in the same Redis as everything else (never in serverless memory).
 */
export const FB = { list: 'fb:list', rate: (tag: string, hour: number) => `fb:rate:${tag}:${hour}`, idem: (sid: string) => `fb:idem:${sid}` };
export const MAX_KEEP = 5000, MAX_PER_ADDR_HOUR = 12, MAX_TEXT = 1000, RETAIN_NOTE = 'The newest 5,000 responses are kept; delete a response and it is removed from the store, the charts and every export.';

/** The three knowledge areas, in the order the form asks them. */
export const TOPICS = [
  { key: 'lidar', label: 'LiDAR technology and 3D scanning' },
  { key: 'processing', label: 'Point cloud processing, registration and mapping' },
  { key: 'applications', label: 'LiDAR applications, sensor fusion and AI' },
] as const;

/** Stable ids for "most useful part". A retired id still reads fine in old records: it is shown under its own id, marked retired. */
export const MODULES: { id: string; label: string }[] = [
  { id: 'fundamentals', label: 'LiDAR fundamentals and scanner simulation' },
  { id: 'placement', label: 'Sensor selection and placement' },
  { id: 'processing', label: 'Point cloud processing' },
  { id: 'registration', label: 'Registration and SLAM' },
  { id: 'fusion', label: 'LiDAR and camera fusion' },
  { id: 'clustering', label: 'Clustering and segmentation' },
  { id: 'supervised', label: 'Supervised learning and AI' },
  { id: 'scene', label: 'Scene graphs and spatial reasoning' },
  { id: 'change', label: 'Change detection' },
  { id: 'surfaces', label: 'Meshing, surfaces and scan to CAD' },
  { id: 'challenge', label: 'Final industrial challenge' },
  { id: 'other', label: 'Other' },
];
export const moduleLabel = (id: string) => MODULES.find((m) => m.id === id)?.label ?? `${id} (retired)`;

export interface Feedback {
  id: string; at: number;
  /** self-rated understanding 1–5, in TOPICS order, before and after using the lab */
  before: [number, number, number]; after: [number, number, number];
  helpful: number; module: string; text: string; version: string;
}

const rating = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);
const triple = (v: unknown): [number, number, number] | null => {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const r = v.map(rating); return r.every((x) => x !== null) ? (r as [number, number, number]) : null;
};
/** Comments keep their punctuation and line breaks; only control characters go. They are only ever shown as plain text. */
export const cleanText = (v: unknown): string => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : '');

export type ParsedFeedback = { ok: true; sid: string; value: Omit<Feedback, 'id' | 'at'> } | { ok: false; message: string };
/** Everything a student sends is checked here, on the server: strict values only, nothing is stored as received. */
export function parseFeedback(body: unknown): ParsedFeedback {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: 'Send a JSON object.' };
  const b = body as Record<string, unknown>;
  const before = triple(b.before), after = triple(b.after), helpful = rating(b.helpful);
  if (!before) return { ok: false, message: 'Rate your understanding before using the lab for all three areas (1 to 5).' };
  if (!after) return { ok: false, message: 'Rate your understanding after using the lab for all three areas (1 to 5).' };
  if (helpful === null) return { ok: false, message: 'Rate how helpful the simulations were (1 to 5).' };
  if (typeof b.module !== 'string' || !MODULES.some((m) => m.id === b.module)) return { ok: false, message: 'Choose the part of the lab you found most useful.' };
  const raw = b.text === undefined || b.text === null ? '' : b.text;
  if (typeof raw !== 'string') return { ok: false, message: 'The suggestion must be text.' };
  if (raw.length > MAX_TEXT * 2) return { ok: false, message: `Keep suggestions under ${MAX_TEXT} characters.` };
  const text = cleanText(raw);
  if (text.length > MAX_TEXT) return { ok: false, message: `Keep suggestions under ${MAX_TEXT} characters.` };
  const sid = typeof b.sid === 'string' && /^[A-Za-z0-9_-]{12,64}$/.test(b.sid) ? b.sid : '';
  if (!sid) return { ok: false, message: 'Reload the lab and try again.' };
  const version = typeof b.version === 'string' ? b.version.replace(/[^A-Za-z0-9._+-]/g, '').slice(0, 20) : '';
  return { ok: true, sid, value: { before, after, helpful, module: b.module, text, version } };
}

/** Store one response. A repeated send of the same form (double click, or a retry after a lost reply) is accepted once. */
export async function addFeedback(s: Store, p: Extract<ParsedFeedback, { ok: true }>, ctx: { now: number; ip: string }): Promise<{ ok: true; id: string; duplicate: boolean } | { ok: false; reason: 'rate' }> {
  const hour = Math.floor(ctx.now / 3600000), rk = FB.rate(ipTag(ctx.ip), hour), ik = FB.idem(p.sid);
  const n = await s.incr(rk); if (n === 1) await s.expire(rk, 7200);
  if (n > MAX_PER_ADDR_HOUR) return { ok: false, reason: 'rate' };
  const first = await s.incr(ik); await s.expire(ik, 7 * 86400);
  if (first > 1) return { ok: true, id: '', duplicate: true };
  const id = randomBytes(6).toString('hex'), rec: Feedback = { ...p.value, id, at: ctx.now };
  try { await s.lpush(FB.list, JSON.stringify(rec)); await s.ltrim(FB.list, 0, MAX_KEEP - 1); }
  catch (e) { await s.del(ik).catch(() => undefined); throw e; } // a failed save must not make the retry look like a duplicate
  return { ok: true, id, duplicate: false };
}

export async function allFeedback(s: Store): Promise<Feedback[]> {
  const raw = await s.lrange(FB.list, 0, MAX_KEEP - 1), out: Feedback[] = [];
  for (const r of raw) { try { const f = JSON.parse(r) as Feedback; if (f && typeof f.id === 'string' && triple(f.before) && triple(f.after)) out.push(f); } catch { /* skip a damaged record */ } }
  return out;
}

// ------------------------------------------------------------------ the numbers
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: readonly number[]) => (a.length ? sum(a) / a.length : 0);
const r2 = (x: number) => Math.round(x * 100) / 100;
const EPS = 1e-9;
export const avgBefore = (f: Feedback) => mean(f.before);
export const avgAfter = (f: Feedback) => mean(f.after);
/** learning change = after − before (per topic, or averaged over the three topics). Zero and negative values are real answers. */
export const changeOf = (f: Feedback) => avgAfter(f) - avgBefore(f);
export const view = (f: Feedback) => ({ ...f, moduleLabel: moduleLabel(f.module), avgBefore: r2(avgBefore(f)), avgAfter: r2(avgAfter(f)), change: r2(changeOf(f)), changes: f.after.map((a, i) => a - f.before[i]) });

const dist = (xs: readonly number[]) => [1, 2, 3, 4, 5].map((v) => xs.filter((x) => x === v).length);
const pctOf = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const STOP = new Set('about above after again also because been before being could does doing from have having help here into just like more most much really should some something than that their them then there these they this those very want what when where which while will with would your were make made lot lots'.split(' '));

/** Summary of a set of responses (all of them unless filtered). Averages are null when there is nothing to average. */
export function summarise(list: Feedback[]) {
  const n = list.length, orNull = (x: number) => (n ? r2(x) : null);
  const topics = TOPICS.map((t, i) => {
    const b = list.map((f) => f.before[i]), a = list.map((f) => f.after[i]), d = list.map((_, k) => a[k] - b[k]);
    const up = d.filter((x) => x > 0).length, same = d.filter((x) => x === 0).length, down = d.filter((x) => x < 0).length;
    return { key: t.key, label: t.label, n, meanBefore: orNull(mean(b)), meanAfter: orNull(mean(a)), meanChange: orNull(mean(d)), improved: up, same, decreased: down, improvedPct: pctOf(up, n), samePct: pctOf(same, n), decreasedPct: pctOf(down, n), distBefore: dist(b), distAfter: dist(a) };
  });
  const per = list.map(changeOf), up = per.filter((x) => x > EPS).length, down = per.filter((x) => x < -EPS).length;
  const hs = list.map((f) => f.helpful), top2 = hs.filter((x) => x >= 4).length;
  const counts = new Map<string, number>(); for (const f of list) counts.set(f.module, (counts.get(f.module) ?? 0) + 1);
  const modules = [...counts.entries()].map(([id, count]) => ({ id, label: moduleLabel(id), count, pct: pctOf(count, n), retired: !MODULES.some((m) => m.id === id) })).sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
  const days = new Map<string, number>(); for (const f of list) { const k = new Date(f.at).toISOString().slice(0, 10); days.set(k, (days.get(k) ?? 0) + 1); }
  const words = new Map<string, number>();
  for (const f of list) for (const w of new Set((f.text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []).filter((x) => !STOP.has(x)))) words.set(w, (words.get(w) ?? 0) + 1);
  return {
    total: n, withText: list.filter((f) => f.text).length,
    overall: { meanBefore: orNull(mean(list.map(avgBefore))), meanAfter: orNull(mean(list.map(avgAfter))), meanChange: orNull(mean(per)), improved: up, same: n - up - down, decreased: down, improvedPct: pctOf(up, n), samePct: pctOf(n - up - down, n), decreasedPct: pctOf(down, n) },
    topics,
    helpful: { n, mean: orNull(mean(hs)), top2Pct: pctOf(top2, n), dist: dist(hs) },
    modules,
    trend: [...days.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([day, count]) => ({ day, count })),
    keywords: [...words.entries()].filter(([, c]) => c >= 2).sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).slice(0, 12).map(([word, count]) => ({ word, count })),
    note: 'Self-reported understanding, not a measured gain in knowledge. Differences use each student’s own before and after ratings.',
  };
}

// ------------------------------------------------------------------ filtering, paging, export
export interface Filter { from?: number; to?: number; module?: string; helpful?: number; q?: string; sort: 'new' | 'old' }
export function parseFilter(q: Record<string, string> = {}): Filter {
  const num = (v: string | undefined) => { const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) ? x : undefined; };
  const h = num(q.helpful);
  return { from: num(q.from), to: num(q.to), module: q.module ? q.module.slice(0, 40) : undefined, helpful: h && Number.isInteger(h) && h >= 1 && h <= 5 ? h : undefined, q: q.q ? q.q.slice(0, 80).toLowerCase() : undefined, sort: q.sort === 'old' ? 'old' : 'new' };
}
export function applyFilter(list: Feedback[], f: Filter): Feedback[] {
  const out = list.filter((x) => (f.from === undefined || x.at >= f.from) && (f.to === undefined || x.at <= f.to) && (!f.module || x.module === f.module) && (f.helpful === undefined || x.helpful === f.helpful) && (!f.q || x.text.toLowerCase().includes(f.q)));
  return out.sort((a, b) => (f.sort === 'old' ? a.at - b.at : b.at - a.at));
}
export function page(list: Feedback[], pageNo: number, size: number) {
  const s = Math.min(100, Math.max(1, Math.floor(size) || 25)), pages = Math.max(1, Math.ceil(list.length / s)), p = Math.min(pages, Math.max(1, Math.floor(pageNo) || 1));
  return { total: list.length, page: p, pages, pageSize: s, items: list.slice((p - 1) * s, p * s).map(view) };
}

/** A cell that a spreadsheet could run as a formula is made harmless, and every text cell is quoted. */
export const csvCell = (v: string | number): string => {
  if (typeof v === 'number') return String(v);
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${t.replace(/"/g, '""')}"`;
};
export function toCsv(list: Feedback[]): string {
  const head = ['Submitted (UTC)', ...TOPICS.map((t) => `Before: ${t.label}`), ...TOPICS.map((t) => `After: ${t.label}`), ...TOPICS.map((t) => `Change: ${t.label}`), 'Average before', 'Average after', 'Average change', 'Simulation helpfulness', 'Most useful part', 'Suggestions'];
  const rows = list.map((f) => { const v = view(f); return [new Date(f.at).toISOString(), ...f.before, ...f.after, ...v.changes, v.avgBefore, v.avgAfter, v.change, f.helpful, v.moduleLabel, f.text.replace(/\n/g, ' ')].map((c) => csvCell(c as string | number)).join(','); });
  return [head.map(csvCell).join(','), ...rows].join('\r\n') + '\r\n';
}

// ------------------------------------------------------------------ deleting
/** Remove the responses with these ids from the store for good. Returns how many were removed. */
export async function deleteFeedback(s: Store, ids: string[]): Promise<number> {
  const set = new Set(ids), raw = await s.lrange(FB.list, 0, MAX_KEEP - 1);
  const keep = raw.filter((r) => { try { return !set.has((JSON.parse(r) as Feedback).id); } catch { return true; } });
  const removed = raw.length - keep.length;
  if (!removed) return 0;
  await s.del(FB.list); for (const r of [...keep].reverse()) await s.lpush(FB.list, r);
  return removed;
}
export const clearFeedback = (s: Store) => s.del(FB.list);
