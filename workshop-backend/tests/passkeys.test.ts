import { describe, it, expect } from 'vitest';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { admin, mk, setup, Ctx } from './helpers';
import { adminHandler } from '../lib/handlers';

/** A tiny software passkey (like Touch ID, Face ID or Windows Hello): enough CBOR and crypto to act as a platform authenticator (ES256, no attestation). */
const cbor = (v: unknown): Buffer => {
  const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
};
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
const b64 = (b: Buffer) => b.toString('base64url');

function authenticator(rpID: string, origin: string) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
  const credId = randomBytes(16);
  const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  let counter = 0;
  const client = (type: string, challenge: string, o = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
  return {
    create(challenge: string, o = origin) {
      const cd = client('webauthn.create', challenge, o), ad = Buffer.concat([sha(rpID), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, credId.length]), credId, cose]);
      const att = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', ad]]));
      return { id: b64(credId), rawId: b64(credId), type: 'public-key', response: { attestationObject: b64(att), clientDataJSON: b64(cd), transports: ['internal'] }, clientExtensionResults: {} };
    },
    get(challenge: string, o = origin, uv = true) {
      counter++;
      const cd = client('webauthn.get', challenge, o), c = Buffer.alloc(4); c.writeUInt32BE(counter);
      const ad = Buffer.concat([sha(rpID), Buffer.from([uv ? 0x05 : 0x01]), c]);
      const sig = createSign('sha256').update(Buffer.concat([ad, sha(cd)])).sign(privateKey);
      return { id: b64(credId), rawId: b64(credId), type: 'public-key', response: { authenticatorData: b64(ad), clientDataJSON: b64(cd), signature: b64(sig) }, clientExtensionResults: {} };
    },
  };
}

const HOST = 'admin.example', ORIGIN = 'https://admin.example';
async function register(ctx: Ctx, a: ReturnType<typeof admin>, dev = authenticator(HOST, ORIGIN)) {
  const o = (await a.call('POST', 'passkey-register-options', {})).body as { options: { challenge: string; rp: { id: string } }; challengeId: string };
  const r = await a.call('POST', 'passkey-register', { challengeId: o.challengeId, response: dev.create(o.options.challenge), label: 'My Mac' });
  return { dev, o, r };
}
const loginOpts = (ctx: Ctx, ip = '2.2.2.2') => adminHandler(ctx.deps)(mk('POST', '/api/admin/passkey-login-options', { body: {}, ip }));
let nextIp = 10; // each try comes from its own address, so the per-address limit does not interfere
const loginWith = (ctx: Ctx, body: unknown, ip = `7.7.7.${nextIp++}`) => adminHandler(ctx.deps)(mk('POST', '/api/admin/passkey-login', { body, ip }));

describe('Passkeys', () => {
  it('can be set up only when signed in, and the sign-in page then offers it', async () => {
    const ctx = setup(); const a = admin(ctx);
    expect((await a.call('POST', 'passkey-register-options', {})).status).toBe(401);
    expect(((await a.call('GET', 'session')).body as { passkeys: boolean }).passkeys).toBe(false);
    expect((await loginOpts(ctx)).status).toBe(404); // none yet
    await a.login(); const { r } = await register(ctx, a);
    expect(r.status).toBe(200); expect((r.body as { passkeys: number }).passkeys).toBe(1);
    expect((await admin(ctx).call('GET', 'session')).body).toMatchObject({ authenticated: false, passkeys: true });
  });

  it('signs in with the registered device and gets the same locked-down session as a password', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login(); const { dev } = await register(ctx, a);
    const o = (await loginOpts(ctx)).body as { options: { challenge: string }; challengeId: string };
    const res = await loginWith(ctx, { challengeId: o.challengeId, response: dev.get(o.options.challenge) });
    expect(res.status).toBe(200); expect(res.cookies?.[0]).toMatch(/HttpOnly; Secure; SameSite=Strict/);
    const b = admin(ctx, '3.3.3.3'); b.cookie = (res.cookies?.[0] ?? '').split(';')[0]; b.csrf = (res.body as { csrf: string }).csrf;
    expect((await b.call('GET', 'workshop')).status).toBe(200);
  });

  it('refuses a replayed challenge, a wrong origin, a missing user-verification check, an unknown device and a forged signature', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login(); const { dev } = await register(ctx, a);
    const fresh = async () => (await loginOpts(ctx)).body as { options: { challenge: string }; challengeId: string };
    let o = await fresh(); const good = dev.get(o.options.challenge);
    expect((await loginWith(ctx, { challengeId: o.challengeId, response: good })).status).toBe(200);
    expect((await loginWith(ctx, { challengeId: o.challengeId, response: good })).status).toBe(401); // replay
    o = await fresh(); expect((await loginWith(ctx, { challengeId: o.challengeId, response: dev.get(o.options.challenge, 'https://evil.example') })).status).toBe(401);
    o = await fresh(); expect((await loginWith(ctx, { challengeId: o.challengeId, response: dev.get(o.options.challenge, ORIGIN, false) })).status).toBe(401); // no user verification
    o = await fresh(); const other = authenticator(HOST, ORIGIN); // a device that was never registered
    expect((await loginWith(ctx, { challengeId: o.challengeId, response: other.get(o.options.challenge) })).status).toBe(401);
    o = await fresh(); const forged = dev.get(o.options.challenge); forged.response.signature = b64(Buffer.alloc(70, 1));
    expect((await loginWith(ctx, { challengeId: o.challengeId, response: forged })).status).toBe(401);
    expect((await loginWith(ctx, { challengeId: 'nope-nope-nope', response: good })).status).toBe(401);
    expect((await loginWith(ctx, {})).status).toBe(401);
  });

  it('a registration made for another site, or with an old challenge, is refused', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login();
    const bad = await register(ctx, a, authenticator('evil.example', 'https://evil.example'));
    expect(bad.r.status).toBe(400);
    const o = (await a.call('POST', 'passkey-register-options', {})).body as { options: { challenge: string }; challengeId: string };
    ctx.clock.t += 6 * 60e3; const dev = authenticator(HOST, ORIGIN);
    expect((await a.call('POST', 'passkey-register', { challengeId: o.challengeId, response: dev.create(o.options.challenge) })).status).toBe(400); // expired
  });

  it('shares the login throttle, so it cannot be guessed at either', async () => {
    const ctx = setup(); const a = admin(ctx); await a.login(); await register(ctx, a);
    const codes: number[] = []; for (let i = 0; i < 8; i++) codes.push((await loginWith(ctx, { challengeId: 'aaaaaaaaaaaa', response: { id: 'x' } }, '4.4.4.4')).status);
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]); expect(codes[5]).toBe(429);
  });
});
