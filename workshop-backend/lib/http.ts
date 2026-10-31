import type { Deps } from './env';

export interface Req { method: string; path: string; headers: Record<string, string>; ip: string; body: unknown; tooLarge?: boolean }
export interface Res { status: number; headers?: Record<string, string>; body?: unknown; cookies?: string[] }

export const json = (status: number, body: unknown, extra: Partial<Res> = {}): Res => ({ status, body, ...extra });
export const err = (status: number, code: string, message?: string): Res => json(status, { error: code, ...(message ? { message } : {}) });

export const MAX_BODY = 450_000; // bytes; a prompt with a thinned point cloud fits comfortably

/** Is this origin one the student app may be served from? */
export function originAllowed(origin: string, deps: Deps): boolean {
  const o = origin.replace(/\/$/, '');
  if (deps.env.origins.includes(o)) return true;
  return deps.env.allowLocalhost && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

/** CORS for the public student endpoints only: exact-match origins, never a wildcard. */
export function corsHeaders(req: Req, deps: Deps): Record<string, string> {
  const origin = req.headers['origin'];
  if (!origin || !originAllowed(origin, deps)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, x-workshop-code, x-workshop-client', 'Access-Control-Max-Age': '600' };
}

/** A short, non-reversible tag for an IP address, used only for rate limiting. */
import { createHash } from 'node:crypto';
export const ipTag = (ip: string) => createHash('sha256').update('ip:' + ip).digest('hex').slice(0, 16);

export const clientIp = (h: Record<string, string>, fallback = 'unknown') => (h['x-forwarded-for']?.split(',')[0].trim() || h['x-real-ip'] || fallback);
