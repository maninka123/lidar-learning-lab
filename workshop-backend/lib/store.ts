import { Redis } from '@upstash/redis';

/**
 * The small set of Redis commands the backend needs. Every value is a string.
 * Quotas rely on INCR / HINCRBY, which Redis runs atomically, so concurrent requests cannot both take the last slot.
 */
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<void>;
  hincrby(key: string, field: string, by: number): Promise<number>;
  hset(key: string, values: Record<string, string>): Promise<void>;
  hget(key: string, field: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string> | null>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  lpush(key: string, value: string): Promise<void>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

export class StoreUnavailable extends Error { constructor(cause?: unknown) { super('store_unavailable'); this.cause = cause; } }

/** Upstash (with automatic JSON parsing off) answers HGETALL with a flat [field, value, ...] list; make it an object of strings. */
export function hashFromReply(raw: unknown): Record<string, string> | null {
  const o: Record<string, string> = {};
  if (Array.isArray(raw)) for (let i = 0; i + 1 < raw.length; i += 2) o[String(raw[i])] = String(raw[i + 1]);
  else if (raw && typeof raw === 'object') for (const [a, b] of Object.entries(raw as Record<string, unknown>)) o[a] = String(b);
  return Object.keys(o).length ? o : null;
}

export function upstashStore(url: string, token: string): Store {
  const r = new Redis({ url, token, automaticDeserialization: false, retry: { retries: 1, backoff: () => 100 } });
  const wrap = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f(); } catch (e) { throw new StoreUnavailable(e); } };
  return {
    get: (k) => wrap(async () => (await r.get<string | null>(k)) ?? null),
    set: (k, v, ex) => wrap(async () => { if (ex) await r.set(k, v, { ex }); else await r.set(k, v); }),
    del: (k) => wrap(async () => { await r.del(k); }),
    incr: (k) => wrap(() => r.incr(k)),
    expire: (k, s) => wrap(async () => { await r.expire(k, s); }),
    hincrby: (k, f, n) => wrap(() => r.hincrby(k, f, n)),
    hset: (k, v) => wrap(async () => { await r.hset(k, v); }),
    hget: (k, f) => wrap(async () => (await r.hget<string | null>(k, f)) ?? null),
    hgetall: (k) => wrap(async () => hashFromReply(await r.hgetall(k))),
    sadd: (k, m) => wrap(async () => { await r.sadd(k, m); }),
    srem: (k, m) => wrap(async () => { await r.srem(k, m); }),
    smembers: (k) => wrap(() => r.smembers(k) as Promise<string[]>),
    lpush: (k, v) => wrap(async () => { await r.lpush(k, v); }),
    ltrim: (k, a, b) => wrap(async () => { await r.ltrim(k, a, b); }),
    lrange: (k, a, b) => wrap(() => r.lrange(k, a, b) as Promise<string[]>),
  };
}

/** In-memory store with the same semantics, used by the tests and the local dev server. */
export class MemoryStore implements Store {
  private kv = new Map<string, string>();
  private h = new Map<string, Map<string, string>>();
  private s = new Map<string, Set<string>>();
  private l = new Map<string, string[]>();
  down = false;
  private chk() { if (this.down) throw new StoreUnavailable(); }
  async get(k: string) { this.chk(); return this.kv.get(k) ?? null; }
  async set(k: string, v: string) { this.chk(); this.kv.set(k, v); }
  async del(k: string) { this.chk(); this.kv.delete(k); this.h.delete(k); this.s.delete(k); this.l.delete(k); }
  async incr(k: string) { this.chk(); const n = Number(this.kv.get(k) ?? 0) + 1; this.kv.set(k, String(n)); return n; }
  async expire() { this.chk(); }
  async hincrby(k: string, f: string, by: number) { this.chk(); const m = this.h.get(k) ?? new Map(); this.h.set(k, m); const n = Number(m.get(f) ?? 0) + by; m.set(f, String(n)); return n; }
  async hset(k: string, v: Record<string, string>) { this.chk(); const m = this.h.get(k) ?? new Map(); this.h.set(k, m); for (const [a, b] of Object.entries(v)) m.set(a, b); }
  async hget(k: string, f: string) { this.chk(); return this.h.get(k)?.get(f) ?? null; }
  async hgetall(k: string) { this.chk(); const m = this.h.get(k); return m ? Object.fromEntries(m) : null; }
  async sadd(k: string, m: string) { this.chk(); const s = this.s.get(k) ?? new Set(); this.s.set(k, s); s.add(m); }
  async srem(k: string, m: string) { this.chk(); this.s.get(k)?.delete(m); }
  async smembers(k: string) { this.chk(); return [...(this.s.get(k) ?? [])]; }
  async lpush(k: string, v: string) { this.chk(); const l = this.l.get(k) ?? []; this.l.set(k, l); l.unshift(v); }
  async ltrim(k: string, a: number, b: number) { this.chk(); const l = this.l.get(k); if (l) this.l.set(k, l.slice(a, b + 1)); }
  async lrange(k: string, a: number, b: number) { this.chk(); return (this.l.get(k) ?? []).slice(a, b + 1); }
}
