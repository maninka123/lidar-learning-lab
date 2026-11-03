import { describe, it, expect } from 'vitest';
import { ORIGIN, T0, admin, mk, setup } from './helpers';
import { studentHandler } from '../lib/handlers';
import { parseFeedback, summarise, csvCell, toCsv, changeOf, type Feedback } from '../lib/feedback';

const good = { sid: 'sid-aaaaaaaaaaaa', before: [2, 2, 1], after: [4, 3, 1], helpful: 5, module: 'registration', text: 'More on SLAM, please. It\'s great!', version: '1.2.3' };
let n = 0;
const send = (ctx: ReturnType<typeof setup>, body: unknown, ip = '5.5.5.5', origin: string | null = ORIGIN) =>
  studentHandler(ctx.deps)(mk('POST', '/api/student/feedback', { body, ip, headers: origin ? { origin } : {} }));
const post = (ctx: ReturnType<typeof setup>, over: Record<string, unknown> = {}, ip = `6.6.${Math.floor(++n / 200)}.${n % 200}`) => send(ctx, { ...good, sid: `sid-${String(n).padStart(12, '0')}`, ...over }, ip);
const rec = (o: Partial<Feedback>): Feedback => ({ id: 'a'.repeat(12), at: T0, before: [3, 3, 3], after: [3, 3, 3], helpful: 3, module: 'fusion', text: '', version: '', ...o });

describe('feedback: public submission', () => {
  it('stores an anonymous response and the admin can read it; no address or id is kept', async () => {
    const ctx = setup(); ctx.clock.t = T0 + 1000;
    const r = await send(ctx, good); expect(r.status).toBe(200); expect(r.body).toMatchObject({ ok: true, duplicate: false });
    const a = admin(ctx); await a.login();
    const body = (await a.call('GET', 'feedback')).body as { total: number; items: Array<Record<string, unknown>> };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ before: [2, 2, 1], after: [4, 3, 1], helpful: 5, module: 'registration', at: T0 + 1000, moduleLabel: 'Registration and SLAM', changes: [2, 1, 0] });
    const raw = JSON.stringify([...(await ctx.store.lrange('fb:list', 0, 10))]);
    expect(raw).not.toContain('5.5.5.5'); expect(raw).not.toMatch(/"(ip|net|device|geo)"/);
  });
  it('works with no workshop running and no access code', async () => {
    const ctx = setup(); expect((await send(ctx, good)).status).toBe(200);
  });
  it('rejects every missing or out-of-range answer on the server, and nothing is stored', async () => {
    const ctx = setup();
    for (const bad of [
      { before: [0, 2, 2] }, { before: [1, 2, 6] }, { before: [1, 2] }, { before: [1.5, 2, 2] }, { before: ['3', 2, 2] }, { after: [1, 2, null] }, { after: undefined },
      { helpful: 0 }, { helpful: 6 }, { helpful: undefined }, { module: 'nope' }, { module: undefined }, { sid: 'short' }, { sid: 'has spaces in it!' }, { text: 'x'.repeat(1001) }, { text: 42 },
    ]) { const r = await post(ctx, bad); expect(r.status, JSON.stringify(bad)).toBe(400); }
    expect((await send(ctx, 'nope')).status).toBe(400); expect((await send(ctx, [1, 2])).status).toBe(400); expect((await send(ctx, null)).status).toBe(400);
    expect(await ctx.store.lrange('fb:list', 0, 10)).toHaveLength(0);
  });
  it('accepts equal and lower After ratings, and an empty suggestion', async () => {
    const ctx = setup();
    expect((await post(ctx, { before: [5, 5, 5], after: [1, 3, 5], text: '' })).status).toBe(200);
    const a = admin(ctx); await a.login(); const it = ((await a.call('GET', 'feedback')).body as { items: { changes: number[]; text: string }[] }).items[0];
    expect(it.changes).toEqual([-4, -2, 0]); expect(it.text).toBe('');
  });
  it('keeps punctuation in comments, removes control characters, and stores no markup execution (text is shown as plain text)', () => {
    const p = parseFeedback({ ...good, text: 'It\u0000 works\u0007, "really"\r\n\r\n\r\n\r\n<b>yes</b>' });
    expect(p.ok && p.value.text).toBe('It works, "really"\n\n<b>yes</b>');
  });
  it('a repeated send of the same form is stored once (double click or a retry after a lost reply)', async () => {
    const ctx = setup(); const r1 = await send(ctx, good), r2 = await send(ctx, good);
    expect(r1.body).toMatchObject({ duplicate: false }); expect(r2.status).toBe(200); expect(r2.body).toMatchObject({ ok: true, duplicate: true });
    expect(await ctx.store.lrange('fb:list', 0, 10)).toHaveLength(1);
  });
  it('a save that fails does not make the retry look like a duplicate', async () => {
    const ctx = setup(); const lp = ctx.store.lpush.bind(ctx.store); let fail = true;
    ctx.store.lpush = async (k: string, v: string) => { if (fail) { fail = false; throw new Error('down'); } return lp(k, v); };
    expect((await send(ctx, good)).status).toBeGreaterThanOrEqual(500);
    const r = await send(ctx, good); expect(r.body).toMatchObject({ ok: true, duplicate: false }); expect(await ctx.store.lrange('fb:list', 0, 10)).toHaveLength(1);
  });
  it('is rate-limited per network address, and a window passes', async () => {
    const ctx = setup(); const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await send(ctx, { ...good, sid: `rate-${String(i).padStart(10, '0')}` }, '7.7.7.7')).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(12); expect(codes.slice(12)).toEqual([429, 429]);
    expect((await send(ctx, { ...good, sid: 'rate-other-ip-0001' }, '8.8.8.8')).status).toBe(200);
    ctx.clock.t += 3700e3; expect((await send(ctx, { ...good, sid: 'rate-next-hour-01' }, '7.7.7.7')).status).toBe(200);
  });
  it('refuses a page that is not an allowed origin, and an oversized body', async () => {
    const ctx = setup(); expect((await send(ctx, good, '5.5.5.5', 'https://evil.example')).status).toBe(403);
    expect((await studentHandler(ctx.deps)(mk('POST', '/api/student/feedback', { body: null, tooLarge: true, headers: { origin: ORIGIN } }))).status).toBe(413);
  });
  it('answers CORS for the allowed origin only', async () => {
    const ctx = setup(); const ok = await send(ctx, good); expect(ok.headers?.['Access-Control-Allow-Origin']).toBe(ORIGIN);
  });
});

describe('feedback: admin endpoints are private', () => {
  it('every admin feedback route needs a signed-in admin (and a CSRF token to change anything)', async () => {
    const ctx = setup(); await send(ctx, good); const a = admin(ctx);
    for (const [m, r] of [['GET', 'feedback'], ['GET', 'feedback-summary'], ['GET', 'feedback-export'], ['POST', 'feedback-delete'], ['POST', 'feedback-clear']] as const) expect((await a.call(m, r, {})).status, r).toBe(401);
    await a.login(); const csrf = a.csrf; a.csrf = '';
    expect((await a.call('POST', 'feedback-delete', { ids: ['0'.repeat(12)] })).status).toBe(403); expect((await a.call('POST', 'feedback-clear', { confirm: 'DELETE' })).status).toBe(403);
    a.csrf = csrf; expect((await a.call('GET', 'feedback')).status).toBe(200);
  });
  it('the public routes never return stored responses', async () => {
    const ctx = setup(); await send(ctx, good);
    const r = await studentHandler(ctx.deps)(mk('GET', '/api/student/feedback', { headers: { origin: ORIGIN } })); expect(r.status).toBe(404);
  });
});

describe('feedback: listing, filters, paging', () => {
  async function fill() {
    const ctx = setup();
    const set: Array<[number, Record<string, unknown>]> = [
      [0, { module: 'fusion', helpful: 5, text: 'Loved the fusion tab' }], [1, { module: 'fusion', helpful: 4, text: '' }], [2, { module: 'registration', helpful: 2, text: 'ICP was confusing' }],
      [30, { module: 'processing', helpful: 3, text: 'More examples for filtering' }], [31, { module: 'other', helpful: 5, text: 'FUSION again' }],
    ];
    for (const [h, o] of set) { ctx.clock.t = T0 + h * 3600e3; expect((await post(ctx, o)).status).toBe(200); }
    const a = admin(ctx); await a.login(); return { ctx, a };
  }
  it('pages, sorts and filters on the server', async () => {
    const { a } = await fill();
    const call = (q: Record<string, string>) => a.call('GET', 'feedback', undefined, {}, q);
    const l = (await call({})).body as { total: number; items: { text: string; at: number }[] }; expect(l.total).toBe(5); expect(l.items[0].at).toBeGreaterThan(l.items[4].at);
    expect(((await call({ sort: 'old' })).body as { items: { at: number }[] }).items[0].at).toBe(T0);
    const p = (await call({ pageSize: '2', page: '3' })).body as { items: unknown[]; page: number; pages: number }; expect(p).toMatchObject({ page: 3, pages: 3 }); expect(p.items).toHaveLength(1);
    expect(((await call({ pageSize: '2', page: '99' })).body as { page: number }).page).toBe(3);
    expect(((await call({ module: 'fusion' })).body as { total: number }).total).toBe(2);
    expect(((await call({ helpful: '5' })).body as { total: number }).total).toBe(2);
    expect(((await call({ q: 'fusion' })).body as { total: number }).total).toBe(2);
    expect(((await call({ from: String(T0 + 24 * 3600e3) })).body as { total: number }).total).toBe(2);
    expect(((await call({ to: String(T0 + 3600e3), module: 'fusion', helpful: '4' })).body as { total: number }).total).toBe(1);
  });
});
describe('feedback: summary numbers', () => {
  it('has clear empty values and no divide-by-zero', () => {
    const s = summarise([]); expect(s.total).toBe(0); expect(s.overall).toMatchObject({ meanBefore: null, meanAfter: null, meanChange: null, improvedPct: 0 });
    expect(s.helpful).toMatchObject({ n: 0, mean: null, top2Pct: 0, dist: [0, 0, 0, 0, 0] }); expect(s.modules).toEqual([]); expect(s.trend).toEqual([]);
    for (const t of s.topics) expect(t).toMatchObject({ n: 0, meanBefore: null, meanChange: null, improvedPct: 0 });
  });
  it('averages each topic from paired before/after answers, counting improvements, no change and decreases', () => {
    const s = summarise([
      rec({ id: '1'.repeat(12), before: [1, 2, 3], after: [4, 2, 2] }), rec({ id: '2'.repeat(12), before: [2, 2, 5], after: [4, 1, 5] }), rec({ id: '3'.repeat(12), before: [3, 3, 3], after: [3, 3, 3] }), rec({ id: '4'.repeat(12), before: [1, 1, 1], after: [5, 5, 5] }),
    ]);
    const [a, b, c] = s.topics;
    expect(a).toMatchObject({ n: 4, meanBefore: 1.75, meanAfter: 4, meanChange: 2.25, improved: 3, same: 1, decreased: 0, improvedPct: 75, samePct: 25, decreasedPct: 0, distBefore: [2, 1, 1, 0, 0], distAfter: [0, 0, 1, 2, 1] });
    expect(b).toMatchObject({ meanChange: 0.75, improved: 1, same: 2, decreased: 1 });
    expect(c).toMatchObject({ meanBefore: 3, meanAfter: 3.75, improved: 1, same: 2, decreased: 1 });
    expect(s.overall).toMatchObject({ meanBefore: 2.25, meanAfter: 3.5, meanChange: 1.25, improved: 3, same: 1, decreased: 0 });
  });
  it('an overall decrease is counted as a decrease', () => {
    const s = summarise([rec({ before: [5, 5, 5], after: [4, 4, 4] }), rec({ id: 'b'.repeat(12), before: [2, 3, 4], after: [4, 3, 2] })]);
    expect(s.overall).toMatchObject({ improved: 0, same: 1, decreased: 1, meanChange: -0.5 }); expect(changeOf(rec({ before: [5, 5, 5], after: [4, 4, 4] }))).toBe(-1);
  });
  it('helpfulness: mean, share rating 4 or 5, and the distribution', () => {
    const s = summarise([5, 4, 4, 2, 1].map((h, i) => rec({ id: String(i).repeat(12), helpful: h })));
    expect(s.helpful).toMatchObject({ n: 5, mean: 3.2, top2Pct: 60, dist: [1, 1, 0, 2, 1] });
  });
  it('ranks modules, shows shares, and keeps a retired id readable', () => {
    const s = summarise([rec({ module: 'fusion' }), rec({ id: 'b'.repeat(12), module: 'fusion' }), rec({ id: 'c'.repeat(12), module: 'old-tab-7' }), rec({ id: 'd'.repeat(12), module: 'change' })]);
    expect(s.modules.map((m) => [m.id, m.count, m.pct])).toEqual([['fusion', 2, 50], ['change', 1, 25], ['old-tab-7', 1, 25]]);
    expect(s.modules[2]).toMatchObject({ retired: true, label: 'old-tab-7 (retired)' }); expect(s.modules[0].label).toBe('LiDAR and camera fusion');
  });
  it('counts submissions per day and the most repeated words in comments (a plain rule, no AI)', () => {
    const s = summarise([rec({ at: T0, text: 'Registration was confusing' }), rec({ id: 'b'.repeat(12), at: T0 + 3600e3, text: 'More registration examples' }), rec({ id: 'c'.repeat(12), at: T0 + 86400e3 + 1, text: 'Nothing' })]);
    expect(s.trend).toEqual([{ day: '2026-11-05', count: 2 }, { day: '2026-11-06', count: 1 }]); expect(s.keywords).toEqual([{ word: 'registration', count: 2 }]);
  });
});

describe('feedback: delete, clear, export', () => {
  async function seeded(k = 4) {
    const ctx = setup(); for (let i = 0; i < k; i++) { ctx.clock.t = T0 + i * 1000; await post(ctx, { module: i % 2 ? 'fusion' : 'change', text: `note ${i}` }); }
    const a = admin(ctx); await a.login(); const items = ((await a.call('GET', 'feedback')).body as { items: { id: string }[] }).items; return { ctx, a, ids: items.map((x) => x.id) };
  }
  it('deletes one response for good, and the summary and exports no longer count it', async () => {
    const { ctx, a, ids } = await seeded();
    expect((await a.call('POST', 'feedback-delete', { ids: [ids[0]] })).body).toMatchObject({ ok: true, deleted: 1 });
    expect(((await a.call('GET', 'feedback')).body as { total: number }).total).toBe(3);
    expect(((await a.call('GET', 'feedback-summary')).body as { total: number }).total).toBe(3);
    expect(((await a.call('GET', 'feedback-export')).body as { count: number; csv: string }).csv).not.toContain('note 3');
    expect(await ctx.store.lrange('fb:list', 0, 10)).toHaveLength(3);
    expect((await a.call('POST', 'feedback-delete', { ids: [ids[0]] })).status).toBe(404); // a repeat finds nothing
  });
  it('deletes several at once and ignores malformed ids', async () => {
    const { a, ids } = await seeded();
    expect((await a.call('POST', 'feedback-delete', { ids: [ids[1], ids[2], 'bad', 7] })).body).toMatchObject({ deleted: 2 });
    expect(((await a.call('GET', 'feedback')).body as { total: number }).total).toBe(2);
    expect((await a.call('POST', 'feedback-delete', { ids: [] })).status).toBe(400); expect((await a.call('POST', 'feedback-delete', {})).status).toBe(400);
  });
  it('delete all needs the word DELETE', async () => {
    const { a } = await seeded();
    expect((await a.call('POST', 'feedback-clear', {})).status).toBe(400); expect((await a.call('POST', 'feedback-clear', { confirm: 'delete' })).status).toBe(400);
    expect(((await a.call('GET', 'feedback')).body as { total: number }).total).toBe(4);
    expect((await a.call('POST', 'feedback-clear', { confirm: 'DELETE' })).status).toBe(200);
    expect(((await a.call('GET', 'feedback-summary')).body as { total: number }).total).toBe(0);
  });
  it('the CSV has one row per response with the changes, and nothing beyond the answers', async () => {
    const { a } = await seeded(2);
    const { csv, count } = (await a.call('GET', 'feedback-export')).body as { csv: string; count: number }; const lines = csv.trim().split('\r\n');
    expect(count).toBe(2); expect(lines).toHaveLength(3); expect(lines[0]).toContain('Change: LiDAR technology and 3D scanning'); expect(lines[0]).toContain('Average change');
    expect(lines[1]).toMatch(/^"2026-11-05T00:00:01\.000Z",2,2,1,4,3,1,2,1,0,/); expect(csv).not.toMatch(/sid-|5\.5\.5\.5|csrf|cookie/i);
  });
  it('neutralises spreadsheet formulas and quotes', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`); expect(csvCell('+1')).toBe(`"'+1"`); expect(csvCell('-2')).toBe(`"'-2"`); expect(csvCell('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvCell('fine, "ok"')).toBe('"fine, ""ok"""'); expect(csvCell(4)).toBe('4');
    expect(toCsv([rec({ text: '=cmd|"/c calc"!A1' })])).toContain(`"'=cmd|""/c calc""!A1"`);
  });
});
