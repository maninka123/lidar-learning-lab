import { PointCloud } from '../core/pointcloud';
import { loadWorkshopCode, refreshWorkshopStatus, workshopChat, workshopConfigured, workshopSnapshot, WorkshopError } from './workshop';

/** The cheap, fast DeepSeek chat model (V4 Flash). */
export const DEEPSEEK_MODEL = 'deepseek-v4-flash';
const KEY_NAME = 'lidar-lab-deepseek-key';

export const loadOwnKey = (): string => { try { return localStorage.getItem(KEY_NAME) ?? ''; } catch { return ''; } };
export const saveOwnKey = (k: string): void => { try { if (k) localStorage.setItem(KEY_NAME, k); else localStorage.removeItem(KEY_NAME); } catch { /* ignore */ } };

/** Thin the cloud to about `n` points and write them as plain text: one point per line, "x y z" and optionally "r g b". */
export function pointCloudToText(c: PointCloud, n: number, withColour: boolean, seed = 7): { text: string; count: number } {
  const stride = Math.max(1, Math.floor(c.count / n)), lines: string[] = [];
  let off = seed % stride;
  for (let i = off; i < c.count && lines.length < n; i += stride) {
    const p = c.positions, xyz = `${p[i * 3].toFixed(2)} ${p[i * 3 + 1].toFixed(2)} ${p[i * 3 + 2].toFixed(2)}`;
    lines.push(withColour && c.colors ? `${xyz} ${c.colors[i * 3]} ${c.colors[i * 3 + 1]} ${c.colors[i * 3 + 2]}` : xyz);
  }
  off = 0;
  return { text: lines.join('\n'), count: lines.length };
}

/** A rough token count for numbers written as text: about 3.4 tokens per number. */
export const estimateTokens = (points: number, withColour: boolean) => Math.round(points * (withColour ? 6 : 3) * 3.4);

export interface AiResult { text: string; promptTokens: number; completionTokens: number; ms: number; via: 'server' | 'own key' | 'workshop' }
export class NoKeyError extends Error { constructor() { super('No DeepSeek key is available on this site.'); } }

/**
 * Ask the model. The request first goes to /api/deepseek on the dev / preview server, which adds the key itself (the key is never in the page).
 * A static site has no such server, so then the key you paste in (kept only in this browser) is used, if there is one.
 */
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }
export const askDeepSeek = (system: string, user: string, maxTokens = 700, ownKey = '') => chatDeepSeek([{ role: 'system', content: system }, { role: 'user', content: user }], maxTokens, ownKey);

/** A whole conversation: the system message, then the turns so far, ending with the new user question. */
export async function chatDeepSeek(messages: ChatMsg[], maxTokens = 700, ownKey = ''): Promise<AiResult> {
  const body = JSON.stringify({ model: DEEPSEEK_MODEL, messages, max_tokens: maxTokens, temperature: 0.2, thinking: { type: 'disabled' } });
  const t0 = performance.now();
  const call = async (url: string, headers: Record<string, string>) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });
    const ct = r.headers.get('content-type') ?? '';
    return { r, json: ct.includes('json') ? await r.json().catch(() => null) : null };
  };
  let via: AiResult['via'] = 'server';
  let res = await call('/api/deepseek/chat/completions', {}).catch(() => null);
  if (!res || !res.json || res.r.status === 404 || res.r.status === 405) {
    if (!ownKey) {
      // During a workshop the lab's AI is shared: with an access code, or open to everyone, depending on the instructor's choice.
      let w = workshopSnapshot();
      if (workshopConfigured() && !w.available) w = await refreshWorkshopStatus();
      const code = loadWorkshopCode();
      if (!workshopConfigured() || !w.available || (w.needCode && !code)) throw new NoKeyError();
      try { const r = await workshopChat(w.needCode ? code : '', messages, maxTokens, DEEPSEEK_MODEL); return { ...r, ms: performance.now() - t0, via: 'workshop' }; }
      catch (e) { if (e instanceof WorkshopError && (e.code === 'expired' || e.code === 'workshop_inactive')) { await refreshWorkshopStatus(); throw new NoKeyError(); } throw e; }
    }
    via = 'own key';
    res = await call('https://api.deepseek.com/chat/completions', { Authorization: `Bearer ${ownKey}` });
  }
  const j = res.json as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } } | null;
  if (!res.r.ok || !j?.choices) throw new Error(j?.error?.message ?? `DeepSeek answered with an error (HTTP ${res.r.status}).`);
  return { text: j.choices[0]?.message?.content ?? '', promptTokens: j.usage?.prompt_tokens ?? 0, completionTokens: j.usage?.completion_tokens ?? 0, ms: performance.now() - t0, via };
}
