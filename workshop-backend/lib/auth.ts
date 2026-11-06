import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Deps } from './env';
import type { Req } from './http';
import { clientIp, ipTag } from './http';

const SESSION_MS = 8 * 3600e3;
export const COOKIE = 'ws_admin';

// ---------------------------------------------------------------- password (scrypt)
/** 2^17, the current OWASP recommendation for scrypt (r = 8, p = 1). Older hashes keep working: the parameters are stored inside each hash. */
export const SCRYPT_N = 131072;
const maxMem = (N: number, r: number) => 256 * N * r; // twice what scrypt needs, because Node's default limit (32 MiB) is too small for N = 2^17
export function hashPassword(password: string): string {
  const salt = randomBytes(16), N = SCRYPT_N, r = 8, p = 1;
  const h = scryptSync(password, salt, 32, { N, r, p, maxmem: maxMem(N, r) });
  return `scrypt:${N}:${r}:${p}:${salt.toString('base64')}:${h.toString('base64')}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  const [alg, N, r, p, salt, hash] = stored.split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  try {
    const n = +N, rr = +r; if (!(n >= 1024 && n <= 2 ** 20) || !(rr >= 1 && rr <= 16)) return false;
    const want = Buffer.from(hash, 'base64'), got = scryptSync(password, Buffer.from(salt, 'base64'), want.length, { N: n, r: rr, p: +p, maxmem: maxMem(n, rr) });
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

// ---------------------------------------------------------------- sessions
const sign = (secret: string, v: string) => createHmac('sha256', secret).update('session:' + v).digest('base64url');
const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export interface Session { id: string; csrf: string; expiresAt: number }

export async function createSession(deps: Deps): Promise<{ cookie: string; session: Session }> {
  const id = randomBytes(24).toString('base64url'), csrf = randomBytes(24).toString('base64url'), expiresAt = deps.now() + SESSION_MS;
  await deps.store.set(`sess:${id}`, JSON.stringify({ csrf, expiresAt }), Math.ceil(SESSION_MS / 1000));
  const value = `${id}.${sign(deps.env.authSecret, id)}`;
  return { cookie: `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`, session: { id, csrf, expiresAt } };
}
export const clearCookie = () => `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

function readCookie(req: Req): string | null {
  const m = (req.headers['cookie'] ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return m ? m.slice(COOKIE.length + 1) : null;
}

/** The logged-in session for this request, or null. Expiry is checked here on every call, not only by the store's TTL. */
export async function getSession(req: Req, deps: Deps): Promise<Session | null> {
  const v = readCookie(req);
  if (!v) return null;
  const [id, sig] = v.split('.');
  if (!id || !sig || !same(sig, sign(deps.env.authSecret, id))) return null;
  const raw = await deps.store.get(`sess:${id}`);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as { csrf: string; expiresAt: number };
    if (deps.now() >= s.expiresAt) { await deps.store.del(`sess:${id}`); return null; }
    return { id, csrf: s.csrf, expiresAt: s.expiresAt };
  } catch { return null; }
}
export const destroySession = (deps: Deps, s: Session) => deps.store.del(`sess:${s.id}`);

/** Browsers send Origin on cross-site requests; an admin request must come from the dashboard's own site. */
export function sameOrigin(req: Req): boolean {
  const o = req.headers['origin'];
  if (!o) return true;
  try { return new URL(o).host === (req.headers['host'] ?? '').toLowerCase(); } catch { return false; }
}
export const csrfOk = (req: Req, s: Session) => same(req.headers['x-csrf-token'] ?? '', s.csrf);

// ---------------------------------------------------------------- login throttling
/**
 * Password guesses are limited: 5 wrong tries per address and 60 overall per 15 minutes. A passkey cannot be guessed, so it has its own, much
 * larger bucket: students hammering the password form on a shared network cannot stop the instructor signing in with a passkey.
 * The attempt is counted before it is checked (so parallel guesses cannot slip past), and handed back when the sign-in succeeds, so only failures use it up.
 */
export type LoginKind = 'password' | 'passkey';
const LIMITS: Record<LoginKind, { ip: number; all: number }> = { password: { ip: 5, all: 60 }, passkey: { ip: 100, all: Infinity } };
const loginKeys = (req: Req, deps: Deps, kind: LoginKind) => {
  const win = Math.floor(deps.now() / 900e3), ip = ipTag(clientIp(req.headers, req.ip));
  return { ip: `login:${kind}:ip:${ip}:${win}`, all: `login:${kind}:all:${win}` };
};
/** Returns true if this attempt may proceed. */
export async function loginAllowed(req: Req, deps: Deps, kind: LoginKind = 'password'): Promise<boolean> {
  const k = loginKeys(req, deps, kind), lim = LIMITS[kind];
  const a = await deps.store.hincrby(k.ip, 'n', 1), b = await deps.store.hincrby(k.all, 'n', 1);
  await deps.store.expire(k.ip, 1000); await deps.store.expire(k.all, 1000);
  return a <= lim.ip && b <= lim.all;
}
/** A successful sign-in does not count against the limit. */
export async function loginSucceeded(req: Req, deps: Deps, kind: LoginKind = 'password'): Promise<void> {
  const k = loginKeys(req, deps, kind);
  await deps.store.hincrby(k.ip, 'n', -1); await deps.store.hincrby(k.all, 'n', -1);
}

/** Generic per-address limiter: true while this address is under `limit` calls in the current 15 minutes. */
export async function underLimit(req: Req, deps: Deps, name: string, limit: number): Promise<boolean> {
  const win = Math.floor(deps.now() / 900e3), key = `limit:${name}:${ipTag(clientIp(req.headers, req.ip))}:${win}`;
  const n = await deps.store.incr(key); await deps.store.expire(key, 1000);
  return n <= limit;
}
