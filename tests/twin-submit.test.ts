import { describe, it, expect, vi } from 'vitest';
import { runScenario, RunConfig } from '../src/twin/runner';
import { DEFAULT_SETTINGS, EMPTY_DESIGN } from '../src/twin/catalogue';
import { newBlock } from '../src/twin/pipeline';
import { buildSubmission, validIndex } from '../src/twin/submit';
import { initialSave, parseSave } from '../src/twin/store';
import { submitChallengeScore, setWorkshopApi } from '../src/apps/workshop';
import { feedbackFor, reportMarkdown } from '../src/twin/feedback';

const cfg: RunConfig = { design: { ...EMPTY_DESIGN, lidars: [{ id: 'a', item: 'rot16', res: 'standard', x: 0, y: -0.3, z: 1.8, yaw: 0, pitch: 0 }] }, pipeline: ['icp', 'crop', 'voxel', 'euclid', 'classify'].map((k) => newBlock(k as never)), settings: DEFAULT_SETTINGS };
const run = runScenario(cfg, 11);
const ctx = { practice: run, final: null, design: cfg.design, pipeline: cfg.pipeline, settings: DEFAULT_SETTINGS, attempts: [{ at: 1, kind: 'practice' as const, seed: 11, total: 10, tasks: {}, cost: 1 }, { at: 2, kind: 'practice' as const, seed: 11, total: 12, tasks: {}, cost: 1 }], startedAt: 1_700_000_000_000 };
const form = { name: 'Ada Lovelace', index: 'z1234567', consent: true, team: 'Lidar Legends' };

describe('sending a score', () => {
  it('builds a short, honest summary: score, equipment, blocks, key results; no clouds and no hidden truth', () => {
    const b = buildSubmission(form, ctx, 'practice')!;
    expect(b.total).toBe(run.grade.total); expect(b.index).toBe('z1234567'); expect(b.attempts).toEqual({ practice: 2, final: 0 });
    expect(b.equipment.lidars[0]).toMatch(/Low-resolution rotating/); expect(b.pipeline).toContain('Euclidean clustering'); expect(Object.keys(b.tasks).sort()).toEqual(['budget', 'change', 'colour', 'detect', 'quality', 'safety', 'twin']);
    const text = JSON.stringify(b); expect(text.length).toBeLessThan(6000);
    expect(text).not.toMatch(/positions|instances|"refs"|truth/i);
  });
  it('a bypassed block is not listed, and a missing result gives nothing to send', () => {
    const p = ctx.pipeline.map((x, i) => (i === 2 ? { ...x, bypass: true } : x)); expect(buildSubmission(form, { ...ctx, pipeline: p }, 'practice')!.pipeline).not.toContain('Voxel downsample');
    expect(buildSubmission(form, ctx, 'final')).toBeNull(); expect(buildSubmission(form, { ...ctx, practice: null }, 'practice')).toBeNull();
  });
  it('checks the index number format', () => { expect(validIndex('z1234567')).toBe(true); expect(validIndex('12')).toBe(false); expect(validIndex('a<b>c')).toBe(false); });
  it('posts to the instructor server and reports success, refusal and network trouble in plain words', async () => {
    setWorkshopApi('https://backend.example');
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ ok: true, id: 'abc' }), { status: 200 }); }));
    const r = await submitChallengeScore(buildSubmission(form, ctx, 'practice'));
    expect(r.ok).toBe(true); expect(calls[0].url).toBe('https://backend.example/api/student/submit'); expect(calls[0].init.method).toBe('POST');
    expect(Object.keys(calls[0].init.headers as Record<string, string>)).toEqual(['Content-Type']); // nothing identifying beyond the body
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'too_many', message: 'Too many scores' }), { status: 429 })));
    expect((await submitChallengeScore({})).message).toMatch(/Too many/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect((await submitChallengeScore({})).message).toMatch(/Could not reach/);
    setWorkshopApi(''); expect((await submitChallengeScore({})).ok).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('workspace save and restore', () => {
  it('exports and imports the whole configuration, and rejects other files', () => {
    const s = { ...initialSave(), team: 'Team X', design: cfg.design, pipeline: cfg.pipeline, student: { name: 'Ada', index: 'z1' } };
    const back = parseSave(JSON.stringify(s))!; expect(back.team).toBe('Team X'); expect(back.design.lidars).toHaveLength(1); expect(back.pipeline.map((b) => b.kind)).toEqual(['icp', 'crop', 'voxel', 'euclid', 'classify']); expect(back.student.name).toBe('Ada');
    expect(parseSave('not json')).toBeNull(); expect(parseSave(JSON.stringify({ version: 2 }))).toBeNull(); expect(parseSave(JSON.stringify({ version: 1 }))).toBeNull();
    expect(initialSave().settings.maxSubmissions).toBe(0); expect(initialSave().pipeline).toEqual([]);
  });
  it('feedback quotes the measured numbers, and the report lists every task', () => {
    const fb = feedbackFor(run); expect(fb.twin[0]).toMatch(/% of the surface/); expect(fb.detect[0]).toContain(`of ${run.tasks.detect.refs}`);
    const md = reportMarkdown('Team', ['A', 'B'], run, null, run.cost.total, 3000); expect(md).toContain('Total'); expect(md).toContain('Digital twin'); expect(md).toContain('not a certified');
  });
});

describe('is the instructor accepting scores?', () => {
  it('asks the server, and treats any problem as "not known" rather than "closed"', async () => {
    const { challengeAccepting } = await import('../src/apps/workshop');
    setWorkshopApi('https://backend.example');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { expect(url).toBe('https://backend.example/api/public/challenge'); return new Response(JSON.stringify({ accepting: true }), { status: 200 }); }));
    expect(await challengeAccepting()).toMatchObject({ known: true, accepting: true, until: null });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepting: false }), { status: 200 })));
    expect(await challengeAccepting()).toMatchObject({ known: true, accepting: false });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 }))); expect((await challengeAccepting()).known).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); })); expect((await challengeAccepting()).known).toBe(false);
    setWorkshopApi(''); expect((await challengeAccepting()).known).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'closed', message: 'Scores are not being accepted right now. Keep grading, and send when it opens.' }), { status: 403 })));
    setWorkshopApi('https://backend.example'); expect((await submitChallengeScore({})).message).toMatch(/not being accepted/);
    setWorkshopApi(''); vi.unstubAllGlobals();
  });
});

describe('grading settings from the instructor', () => {
  it('are read from the server response, and a damaged or odd answer is ignored', async () => {
    const { readSettings, challengeAccepting } = await import('../src/apps/workshop');
    const ok = { budget: 9000, priceScale: 1.5, maxSubmissions: 3, weights: { twin: 30, detect: 30, colour: 0, change: 20, quality: 10, safety: 10, budget: 0 }, enabled: { twin: true, detect: true, colour: false, change: true, quality: true, safety: true, budget: false } };
    expect(readSettings(ok)).toEqual(ok); expect(readSettings({ ...ok, budget: 1 })).toBeUndefined(); expect(readSettings({ ...ok, weights: { ...ok.weights, twin: 'x' } })).toBeUndefined(); expect(readSettings(null)).toBeUndefined(); expect(readSettings('x')).toBeUndefined();
    setWorkshopApi('https://backend.example');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepting: false, settings: ok }), { status: 200 })));
    expect((await challengeAccepting()).settings).toEqual(ok);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ accepting: true }), { status: 200 })));
    expect((await challengeAccepting()).settings).toBeUndefined();
    setWorkshopApi(''); vi.unstubAllGlobals();
  });
});

it('mission records accompany new score submissions and invalid imports are rejected',()=>{
 const save=initialSave();const b=buildSubmission(form,{...ctx,progress:save.progress},'practice')!;
 expect(b.missions).toHaveLength(7);expect(b.missions![0]).toMatchObject({number:1,status:'not-attempted',completed:false});
 expect(parseSave(JSON.stringify({...save,pipeline:[{kind:'unknown',params:{}}]}))).toBeNull();
});

it('refuses final submission when prerequisite mission results are stale or missing',()=>{
 const final={runs:[run],grade:run.grade,cost:run.cost,scores:{}};
 expect(buildSubmission(form,{...ctx,final,progress:initialSave().progress},'final')).toBeNull();
});
