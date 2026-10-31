import { Store, upstashStore } from './store';

export interface Env {
  deepseekKey: string;
  adminHash: string;
  authSecret: string;
  origins: string[];
  allowLocalhost: boolean;
  redisUrl: string;
  redisToken: string;
}

export function readEnv(e: Record<string, string | undefined> = process.env): Env {
  return {
    deepseekKey: e.DEEPSEEK_API_KEY ?? '',
    adminHash: e.ADMIN_PASSWORD_HASH ?? '',
    authSecret: e.ADMIN_AUTH_SECRET ?? '',
    origins: (e.FRONTEND_ORIGIN ?? '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    allowLocalhost: e.ALLOW_LOCALHOST === '1',
    redisUrl: e.UPSTASH_REDIS_REST_URL ?? e.KV_REST_API_URL ?? '',
    redisToken: e.UPSTASH_REDIS_REST_TOKEN ?? e.KV_REST_API_TOKEN ?? '',
  };
}

/** Names of required settings that are missing (never their values). */
export const missingEnv = (env: Env): string[] => [
  !env.deepseekKey && 'DEEPSEEK_API_KEY', !env.adminHash && 'ADMIN_PASSWORD_HASH', env.authSecret.length < 32 && 'ADMIN_AUTH_SECRET (32+ characters)',
  !env.origins.length && 'FRONTEND_ORIGIN', !env.redisUrl && 'UPSTASH_REDIS_REST_URL', !env.redisToken && 'UPSTASH_REDIS_REST_TOKEN',
].filter(Boolean) as string[];

export interface Deps { store: Store; env: Env; now: () => number; fetch: typeof fetch }

let cached: Deps | null = null;
export function realDeps(): Deps {
  if (cached) return cached;
  const env = readEnv();
  cached = { env, store: upstashStore(env.redisUrl || 'https://invalid.invalid', env.redisToken || 'x'), now: () => Date.now(), fetch: (...a) => fetch(...a) };
  return cached;
}
