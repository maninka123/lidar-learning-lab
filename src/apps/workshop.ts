import { useEffect, useSyncExternalStore } from 'react';
import type { ChatMsg } from './deepseek';

/**
 * Workshop Mode, student side. When the instructor has switched a workshop on, students can use the AI features with
 * an access code instead of their own key. The backend (workshop-backend/, hosted separately) holds the key, the limits
 * and the clock. If no backend address is built in, or it cannot be reached, none of this shows and nothing changes.
 */
let api = ((import.meta.env.VITE_WORKSHOP_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '');
export const workshopConfigured = () => /^https:\/\//.test(api) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api);
/** For tests only. */
export const setWorkshopApi = (url: string) => { api = url.replace(/\/+$/, ''); status = { available: false, status: 'inactive' }; fetchedAt = 0; };

const CODE_KEY = 'lidar-lab-workshop-code';
export const loadWorkshopCode = (): string => { try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; } };
/** An anonymous id for this browser, so open-access usage is counted per user without anyone typing a code. */
const CLIENT_KEY = 'lidar-lab-workshop-client';
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const b = new Uint8Array(18); crypto.getRandomValues(b);
      id = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch { return 'session-' + Math.random().toString(36).slice(2, 12).padEnd(10, '0'); }
}

const NAME_KEY = 'lidar-lab-workshop-name';
export const loadWorkshopName = (): string => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };
export const saveWorkshopName = (n: string): void => { try { if (n) localStorage.setItem(NAME_KEY, n); else localStorage.removeItem(NAME_KEY); } catch { /* ignore */ } };
export const saveWorkshopCode = (c: string): void => { try { if (c) localStorage.setItem(CODE_KEY, c); else localStorage.removeItem(CODE_KEY); } catch { /* ignore */ } };

export interface WorkshopStatus { available: boolean; status: 'active' | 'scheduled' | 'inactive'; endsAt?: number; startsAt?: number; maxOutputTokens?: number; retentionDays?: number; needCode?: boolean }
let status: WorkshopStatus = { available: false, status: 'inactive' };
let fetchedAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Ask the backend whether a workshop is running. Any problem counts as "no workshop". */
export async function refreshWorkshopStatus(timeoutMs = 4000): Promise<WorkshopStatus> {
  let next: WorkshopStatus = { available: false, status: 'inactive' };
  if (workshopConfigured()) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(`${api}/api/public/status`, { signal: ctl.signal, cache: 'no-store' });
      const j = r.ok ? ((await r.json()) as Partial<WorkshopStatus>) : null;
      if (j && typeof j.available === 'boolean') next = { available: j.available, status: j.status === 'active' || j.status === 'scheduled' ? j.status : 'inactive', endsAt: j.endsAt, startsAt: j.startsAt, maxOutputTokens: j.maxOutputTokens, retentionDays: j.retentionDays, needCode: j.needCode !== false };
    } catch { /* unreachable: behave as if there is no workshop */ } finally { clearTimeout(timer); }
  }
  fetchedAt = Date.now();
  if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; emit(); }
  return status;
}
export const workshopSnapshot = () => status;

/** React hook: the current workshop status, refreshed on mount, every minute and when the tab regains focus. */
export function useWorkshopStatus(): WorkshopStatus {
  useEffect(() => {
    if (!workshopConfigured()) return;
    if (Date.now() - fetchedAt > 20_000) void refreshWorkshopStatus();
    const id = setInterval(() => void refreshWorkshopStatus(), 60_000), onFocus = () => void refreshWorkshopStatus();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, workshopSnapshot, workshopSnapshot);
}

export class WorkshopError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const FRIENDLY: Record<string, string> = {
  invalid_code: 'That access code is not valid. Check it and try again.',
  revoked: 'This access code has been turned off by the instructor.',
  student_quota: 'You have used all of your workshop AI requests.',
  total_quota: 'The workshop has reached its overall AI request limit.',
  rate_limit: 'Too many requests too quickly. Wait a few seconds and try again.',
  token_budget: 'The workshop has reached its AI usage budget.',
  too_many_attempts: 'Too many tries. Wait a minute and try again.',
  expired: 'The workshop has ended.',
  workshop_inactive: 'There is no workshop running right now.',
  upstream_error: 'The AI service could not answer. Try again shortly.',
};

async function post(route: 'chat' | 'validate', code: string, body: unknown): Promise<{ r: Response; j: Record<string, any> | null }> {
  let r: Response;
  try { r = await fetch(`${api}/api/student/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workshop-Client': clientId(), ...(code ? { 'X-Workshop-Code': code } : {}) }, body: JSON.stringify(body) }); }
  catch { throw new WorkshopError('unreachable', 'Could not reach the workshop service. Check your connection and try again.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const c = (j?.error as string) ?? 'error';
    if (c === 'expired' || c === 'workshop_inactive') void refreshWorkshopStatus();
    throw new WorkshopError(c, j?.message ?? FRIENDLY[c] ?? `The workshop service answered with an error (HTTP ${r.status}).`);
  }
  return { r, j };
}

/** Check a code (or, in open access, just join) and return what is left. */
export async function validateWorkshopCode(code: string, name = ''): Promise<{ remainingRequests: number; endsAt: number }> {
  const { j } = await post('validate', code, name.trim() ? { name: name.trim().slice(0, 30) } : {});
  return { remainingRequests: j?.remainingRequests ?? 0, endsAt: j?.endsAt ?? 0 };
}

export async function workshopChat(code: string, messages: ChatMsg[], maxTokens: number, model: string) {
  const { j } = await post('chat', code, { model, messages, max_tokens: maxTokens, temperature: 0.2 });
  return { text: (j?.choices?.[0]?.message?.content as string) ?? '', promptTokens: (j?.usage?.prompt_tokens as number) ?? 0, completionTokens: (j?.usage?.completion_tokens as number) ?? 0 };
}

/** What to tell a student whose AI request found no key. */
export const noKeyMessage = (action: string) => (workshopSnapshot().available
  ? `Enter your workshop access code below, then press ${action} again.`
  : `No AI key yet. Paste your own DeepSeek key below (it stays in this browser), then press ${action} again.`);
