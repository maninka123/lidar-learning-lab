import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chatDeepSeek, NoKeyError } from '../src/apps/deepseek';
import { loadWorkshopCode, refreshWorkshopStatus, saveWorkshopCode, setWorkshopApi, workshopSnapshot, WorkshopError, noKeyMessage, validateWorkshopCode } from '../src/apps/workshop';

const API = 'https://workshop.example';
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const calls: { url: string; init?: RequestInit }[] = [];
let route: (url: string, init?: RequestInit) => Response | Promise<Response>;
const msgs = [{ role: 'user' as const, content: 'hi' }];

beforeEach(() => {
  store.clear(); calls.length = 0; setWorkshopApi(API);
  route = () => json(404, {});
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, init }); return route(url, init); });
});

describe('student app: Workshop Mode', () => {
  it('does nothing when no backend address is built in: behaves exactly as before', async () => {
    setWorkshopApi('');
    expect(await refreshWorkshopStatus()).toMatchObject({ available: false });
    expect(calls).toHaveLength(0);
    saveWorkshopCode('ABCDE-FGHJK'); // even a stale saved code is ignored
    await expect(chatDeepSeek(msgs)).rejects.toBeInstanceOf(NoKeyError);
    expect(calls.every((c) => !c.url.includes('workshop.example'))).toBe(true);
  });

  it('asks the backend whether a workshop is on, and treats errors and timeouts as "no workshop"', async () => {
    route = (u) => (u.endsWith('/api/public/status') ? json(200, { available: true, status: 'active', endsAt: 123 }) : json(404, {}));
    expect(await refreshWorkshopStatus()).toMatchObject({ available: true, status: 'active', endsAt: 123 });
    route = () => json(500, { error: 'x' }); expect((await refreshWorkshopStatus()).available).toBe(false);
    route = () => { throw new Error('offline'); }; expect((await refreshWorkshopStatus()).available).toBe(false);
    route = () => json(200, { weird: true }); expect((await refreshWorkshopStatus()).available).toBe(false);
    expect(noKeyMessage('Send')).toMatch(/DeepSeek key/); // no workshop: the usual own-key message
  });

  it('with a saved code the AI call goes to the workshop backend, with the code and never a DeepSeek key', async () => {
    saveWorkshopCode('ABCDE-FGHJK');
    route = (u) => (u.includes('/api/student/chat') ? json(200, { choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 9, completion_tokens: 2 } }) : json(404, {}));
    const r = await chatDeepSeek(msgs, 300);
    expect(r).toMatchObject({ text: 'hello', promptTokens: 9, completionTokens: 2, via: 'workshop' });
    const call = calls.find((c) => c.url.includes('/api/student/chat'))!;
    expect((call.init!.headers as Record<string, string>)['X-Workshop-Code']).toBe('ABCDE-FGHJK');
    expect(JSON.stringify(call.init)).not.toMatch(/Authorization|Bearer|sk-/i);
    expect(JSON.parse(call.init!.body as string)).toMatchObject({ model: 'deepseek-v4-flash', max_tokens: 300 });
  });

  it('a student’s own key still wins and goes straight to DeepSeek', async () => {
    saveWorkshopCode('ABCDE-FGHJK');
    route = (u) => (u.startsWith('https://api.deepseek.com') ? json(200, { choices: [{ message: { content: 'mine' } }], usage: {} }) : json(404, {}));
    expect((await chatDeepSeek(msgs, 300, 'sk-own')).via).toBe('own key');
    expect(calls.some((c) => c.url.includes('workshop.example/api/student'))).toBe(false);
  });

  it('shows clear messages for a wrong code, a revoked code and used-up quotas', async () => {
    saveWorkshopCode('ABCDE-FGHJK');
    for (const [status, code, text] of [[401, 'invalid_code', /not valid/], [403, 'revoked', /turned off/], [429, 'student_quota', /used all/], [429, 'total_quota', /overall/], [429, 'rate_limit', /too quickly/]] as const) {
      route = (u) => (u.includes('/api/student/') ? json(status, { error: code }) : json(404, {}));
      await expect(chatDeepSeek(msgs)).rejects.toThrow(text);
    }
    route = (u) => (u.includes('/api/student/validate') ? json(401, { error: 'invalid_code' }) : json(404, {}));
    await expect(validateWorkshopCode('NOPE')).rejects.toBeInstanceOf(WorkshopError);
  });

  it('when the workshop has ended the app falls back to the bring-your-own-key behaviour', async () => {
    saveWorkshopCode('ABCDE-FGHJK');
    route = (u) => (u.includes('/api/student/chat') ? json(403, { error: 'expired' }) : u.endsWith('/api/public/status') ? json(200, { available: false, status: 'inactive' }) : json(404, {}));
    await expect(chatDeepSeek(msgs)).rejects.toBeInstanceOf(NoKeyError);
    expect(workshopSnapshot().available).toBe(false);
    expect(noKeyMessage('Send')).toMatch(/Paste your key/);
  });

  it('an unreachable backend gives a friendly message, not a crash', async () => {
    saveWorkshopCode('ABCDE-FGHJK');
    route = (u) => { if (u.includes('/api/student/')) throw new Error('offline'); return json(404, {}); };
    await expect(chatDeepSeek(msgs)).rejects.toThrow(/Could not reach the workshop service/);
    expect(loadWorkshopCode()).toBe('ABCDE-FGHJK');
  });
});
