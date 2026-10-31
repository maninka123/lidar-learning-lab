import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Deps } from './env';
import { realDeps } from './env';
import { MAX_BODY, Req, Res } from './http';

/** Read the request body with a hard size limit, and parse it as JSON when it is JSON. */
export async function toReq(r: IncomingMessage): Promise<Req> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(r.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v; else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
  const path = new URL(r.url ?? '/', 'http://x').pathname;
  let tooLarge = false, body: unknown = null;
  if (r.method === 'POST' || r.method === 'PUT') {
    const chunks: Buffer[] = []; let size = 0;
    for await (const ch of r) {
      size += (ch as Buffer).length;
      if (size > MAX_BODY) { tooLarge = true; break; }
      chunks.push(ch as Buffer);
    }
    if (!tooLarge && chunks.length && (headers['content-type'] ?? '').includes('json')) { try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; } }
  }
  return { method: r.method ?? 'GET', path, headers, ip: r.socket?.remoteAddress ?? 'unknown', body, tooLarge };
}

export function send(s: ServerResponse, out: Res) {
  const h: Record<string, string | string[]> = { ...(out.headers ?? {}) };
  if (out.cookies?.length) h['Set-Cookie'] = out.cookies;
  if (out.body !== undefined) h['Content-Type'] = 'application/json; charset=utf-8';
  s.writeHead(out.status, h);
  s.end(out.body === undefined ? undefined : JSON.stringify(out.body));
}

export const vercelHandler = (make: (d: Deps) => (r: Req) => Promise<Res>) => async (r: IncomingMessage, s: ServerResponse) => {
  send(s, await make(realDeps())(await toReq(r)));
};
