// Local test server: in-memory store, so nothing persists. Serves the admin page and the three API groups.
// Run:  ADMIN_PASSWORD=your-password npm run dev     then open http://127.0.0.1:8787/admin
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../lib/auth';
import { MemoryStore } from '../lib/store';
import { adminHandler, publicHandler, studentHandler } from '../lib/handlers';
import { send, toReq } from '../lib/vercel';
import { readEnv } from '../lib/env';

for (const f of ['.env.local', '.env']) if (existsSync(f)) for (const l of readFileSync(f, 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
const env = readEnv({ ...process.env, ALLOW_LOCALHOST: '1', FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5173', ADMIN_USERNAME: process.env.ADMIN_USERNAME ?? 'admin', ADMIN_PASSWORD_HASH: hashPassword(process.env.ADMIN_PASSWORD ?? 'workshop-admin-1'), ADMIN_AUTH_SECRET: randomBytes(32).toString('base64url'), UPSTASH_REDIS_REST_URL: 'memory', UPSTASH_REDIS_REST_TOKEN: 'memory' });
const deps = { env, store: new MemoryStore(), now: () => Date.now(), fetch: (...a: Parameters<typeof fetch>) => fetch(...a) };
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
createServer(async (rq, rs) => {
  const path = new URL(rq.url ?? '/', 'http://x').pathname;
  const h = path.startsWith('/api/admin') ? adminHandler : path.startsWith('/api/student') ? studentHandler : path.startsWith('/api/public') ? publicHandler : null;
  if (h) { const out = await h(deps)(await toReq(rq)); out.cookies = out.cookies?.map((c) => c.replace('; Secure', '')); return send(rs, out); }
  const file = join('public', path === '/admin' ? '/admin/index.html' : path);
  if (existsSync(file) && !file.includes('..')) { rs.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'text/plain' }); return rs.end(readFileSync(file)); }
  rs.writeHead(404).end('not found');
}).listen(8787, '127.0.0.1', () => console.log('Workshop backend (memory store) on http://127.0.0.1:8787/admin  user: ' + (process.env.ADMIN_USERNAME ?? 'admin') + '  password: ' + (process.env.ADMIN_PASSWORD ?? 'workshop-admin-1')));
