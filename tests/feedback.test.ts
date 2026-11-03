import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { emptyForm, missing, toPayload, newSid, changeText, labelOf, shortLabel, MODULES, TOPICS, SCALE, MAX_TEXT, FormState, Rating } from '../src/feedback/model';
import { submitFeedback, setWorkshopApi } from '../src/apps/workshop';

const filled = (over: Partial<FormState> = {}): FormState => ({ before: [2, 2, 1], after: [4, 3, 1], helpful: 5, module: 'fusion', text: '', ...over });
afterEach(() => { vi.unstubAllGlobals(); setWorkshopApi(''); });

describe('feedback form model', () => {
  it('starts with every rating unanswered: nothing is pre-selected', () => {
    const f = emptyForm(); expect(f.before).toEqual([null, null, null]); expect(f.after).toEqual([null, null, null]); expect(f.helpful).toBeNull(); expect(f.module).toBe(''); expect(f.text).toBe('');
    expect(missing(f)).toEqual(['before-0', 'after-0', 'before-1', 'after-1', 'before-2', 'after-2', 'helpful', 'module']);
  });
  it('asks three topics, one scale of five words, and a module list that matches the server', () => {
    expect(TOPICS).toHaveLength(3); expect(SCALE).toEqual(['No understanding', 'Basic understanding', 'Moderate understanding', 'Good understanding', 'Excellent understanding']);
    const server = readFileSync('workshop-backend/lib/feedback.ts', 'utf8'), block = server.slice(server.indexOf('export const MODULES'), server.indexOf('export const moduleLabel'));
    const ids = [...block.matchAll(/id: '([a-z]+)', label: '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(ids).toEqual(MODULES.map((m) => [m.id, m.label]));
  });
  it('only blanks are errors: equal and lower After ratings are fine', () => {
    expect(missing(filled())).toEqual([]); expect(missing(filled({ before: [5, 5, 5], after: [1, 5, 3] }))).toEqual([]);
    expect(missing(filled({ after: [4, null, 1] }))).toEqual(['after-1']); expect(missing(filled({ helpful: null }))).toEqual(['helpful']); expect(missing(filled({ module: '' }))).toEqual(['module']); expect(missing(filled({ module: 'nope' }))).toEqual(['module']);
    expect(missing(filled({ text: '' }))).toEqual([]); // the suggestion is optional
  });
  it('builds a payload only from a complete form, trims and caps the comment, and carries the same id for a retry', () => {
    expect(toPayload(emptyForm(), 'sid')).toBeNull();
    const sid = newSid(), p = toPayload(filled({ text: `  ${'x'.repeat(MAX_TEXT + 50)}  ` }), sid, '1.2.3')!;
    expect(p).toMatchObject({ sid, before: [2, 2, 1], after: [4, 3, 1], helpful: 5, module: 'fusion', version: '1.2.3' }); expect(p.text).toHaveLength(MAX_TEXT);
    expect(toPayload(filled(), sid)!.version).toBeUndefined(); expect(Object.keys(toPayload(filled(), sid)!).sort()).toEqual(['after', 'before', 'helpful', 'module', 'sid', 'text']); // nothing personal
  });
  it('makes unique ids that the server accepts', () => {
    const ids = new Set(Array.from({ length: 200 }, newSid)); expect(ids.size).toBe(200); for (const i of ids) expect(i).toMatch(/^[A-Za-z0-9_-]{12,64}$/);
  });
  it('words the change for a pair, including no change and a decrease', () => {
    const t = (b: Rating, a: Rating) => changeText(b, a); expect(t(2, 4)).toBe('+2'); expect(t(3, 3)).toBe('no change'); expect(t(5, 2)).toBe('−3'); expect(changeText(null, 3)).toBe('');
    expect(labelOf('before-1')).toContain('Before: Understanding of point cloud'); expect(labelOf('helpful')).toMatch(/simulations/); expect(labelOf('module')).toMatch(/useful/);
    expect(missing(emptyForm()).map(shortLabel)).toEqual(['Question 1 · Before', 'Question 1 · After', 'Question 2 · Before', 'Question 2 · After', 'Question 3 · Before', 'Question 3 · After', 'Question 4 · Helpfulness', 'Question 5 · Most useful part']);
  });
});

describe('sending feedback', () => {
  it('posts the answers to the lab server with no identifying headers, and reports a stored response', async () => {
    setWorkshopApi('https://backend.example'); const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, duplicate: false }), { status: 200 }); }));
    const r = await submitFeedback(toPayload(filled(), newSid()));
    expect(r.ok).toBe(true); expect(calls[0].url).toBe('https://backend.example/api/student/feedback'); expect(calls[0].init.method).toBe('POST');
    expect(Object.keys(calls[0].init.headers as Record<string, string>)).toEqual(['Content-Type']); expect(calls[0].init.credentials).toBeUndefined();
  });
  it('a repeated send is reported as sent, not as an error', async () => {
    setWorkshopApi('https://backend.example'); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 })));
    expect(await submitFeedback({})).toMatchObject({ ok: true, duplicate: true });
  });
  it('never claims success when the server refuses, is slow or is unreachable', async () => {
    setWorkshopApi('https://backend.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'bad_request', message: 'Choose the part of the lab you found most useful.' }), { status: 400 })));
    expect(await submitFeedback({})).toMatchObject({ ok: false, message: 'Choose the part of the lab you found most useful.' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 }))); expect((await submitFeedback({})).message).toMatch(/Too many/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 502 }))); expect((await submitFeedback({})).ok).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }))); expect((await submitFeedback({})).ok).toBe(false); // only an explicit ok counts
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); })); expect((await submitFeedback({})).message).toMatch(/Could not reach/);
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_res, rej) => { (init.signal as AbortSignal).addEventListener('abort', () => rej(new Error('aborted'))); })));
    expect((await submitFeedback({}, 20)).message).toMatch(/Could not reach/);
  });
  it('does nothing, and says so, when this copy of the lab has no server', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f); setWorkshopApi(''); const r = await submitFeedback({}); expect(r.ok).toBe(false); expect(r.message).toMatch(/not set up/); expect(f).not.toHaveBeenCalled();
  });
});
