import { randomBytes } from 'node:crypto';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { Deps } from './env';
import type { Req } from './http';

/**
 * Passkeys for the admin dashboard: Touch ID or Face ID on Apple devices, Windows Hello, Android, or a security key. The password
 * still works; after signing in once you can add a passkey, and from then on "Sign in with a passkey" replaces typing it.
 * Only public keys are stored.
 */
const KEY = 'admin:passkeys';
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64url');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

interface Stored { publicKey: string; counter: number; transports?: string[]; label: string; createdAt: number }

/** Where this page is served from: the passkey is bound to this site name. */
export function relyingParty(req: Req): { rpID: string; origin: string } {
  const host = (req.headers['host'] ?? '').toLowerCase();
  const name = host.replace(/:\d+$/, '');
  const local = name === 'localhost' || name === '127.0.0.1';
  return { rpID: name === '127.0.0.1' ? 'localhost' : name, origin: `${local ? 'http' : 'https'}://${host}` };
}

async function list(deps: Deps): Promise<Record<string, Stored>> {
  const raw = (await deps.store.hgetall(KEY)) ?? {};
  const out: Record<string, Stored> = {};
  for (const [id, v] of Object.entries(raw)) { try { out[id] = JSON.parse(v) as Stored; } catch { /* skip */ } }
  return out;
}
export const passkeyCount = async (deps: Deps) => Object.keys(await list(deps)).length;

async function saveChallenge(deps: Deps, challenge: string, kind: 'register' | 'login'): Promise<string> {
  const id = randomBytes(16).toString('base64url');
  await deps.store.set(`wa:chal:${id}`, JSON.stringify({ challenge, kind, exp: deps.now() + 5 * 60e3 }), 300);
  return id;
}
/** A challenge can be used once and only for what it was made for. */
async function takeChallenge(deps: Deps, id: unknown, kind: 'register' | 'login'): Promise<string | null> {
  if (typeof id !== 'string' || !/^[\w-]{10,40}$/.test(id)) return null;
  const raw = await deps.store.get(`wa:chal:${id}`);
  await deps.store.del(`wa:chal:${id}`);
  if (!raw) return null;
  try { const c = JSON.parse(raw) as { challenge: string; kind: string; exp: number }; return c.kind === kind && deps.now() < c.exp ? c.challenge : null; } catch { return null; }
}

export async function registrationOptions(req: Req, deps: Deps) {
  const { rpID } = relyingParty(req), existing = await list(deps);
  const options = await generateRegistrationOptions({
    rpName: 'LiDAR Lab workshop admin', rpID, userName: deps.env.adminUser, userDisplayName: deps.env.adminUser, userID: new TextEncoder().encode('workshop-admin'),
    attestationType: 'none', excludeCredentials: Object.entries(existing).map(([id, v]) => ({ id, transports: v.transports as never })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, // any passkey the browser offers: this device, a phone, or a security key
  });
  return { options, challengeId: await saveChallenge(deps, options.challenge, 'register') };
}

export async function registerPasskey(req: Req, deps: Deps, body: { challengeId?: unknown; response?: unknown; label?: unknown }): Promise<boolean> {
  const challenge = await takeChallenge(deps, body.challengeId, 'register');
  if (!challenge || !body.response) return false;
  const { rpID, origin } = relyingParty(req);
  try {
    const v = await verifyRegistrationResponse({ response: body.response as never, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
    if (!v.verified || !v.registrationInfo) return false;
    const c = v.registrationInfo.credential;
    const rec: Stored = { publicKey: b64(c.publicKey), counter: c.counter, transports: c.transports, label: String(body.label ?? 'This device').slice(0, 40), createdAt: deps.now() };
    await deps.store.hset(KEY, { [c.id]: JSON.stringify(rec) });
    return true;
  } catch { return false; }
}

export async function loginOptions(req: Req, deps: Deps) {
  if (!(await passkeyCount(deps))) return null;
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' }); // no list: the browser offers the passkeys it holds for this site
  return { options, challengeId: await saveChallenge(deps, options.challenge, 'login') };
}

export async function verifyLogin(req: Req, deps: Deps, body: { challengeId?: unknown; response?: { id?: unknown } }): Promise<boolean> {
  const challenge = await takeChallenge(deps, body.challengeId, 'login');
  const id = body.response?.id;
  if (!challenge || typeof id !== 'string') return false;
  const stored = (await list(deps))[id];
  if (!stored) return false;
  const { rpID, origin } = relyingParty(req);
  try {
    const v = await verifyAuthenticationResponse({
      response: body.response as never, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id, publicKey: unb64(stored.publicKey), counter: stored.counter, transports: stored.transports as never },
    });
    if (!v.verified) return false;
    await deps.store.hset(KEY, { [id]: JSON.stringify({ ...stored, counter: v.authenticationInfo.newCounter }) });
    return true;
  } catch { return false; }
}
