import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/** A guard: no API key may ever sit in a file that gets committed. Keys live in .env.local, which git ignores. */
const SKIP = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report']);
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.env.local')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (/\.(ts|tsx|js|mjs|json|md|html|yml|yaml|css)$/.test(e.name) || e.name.startsWith('.env')) out.push(p);
  }
  return out;
}
describe('secrets', () => {
  it('no API key is written into the project files', () => {
    const bad = walk('.').filter((f) => /\bsk-[A-Za-z0-9]{20,}\b/.test(fs.readFileSync(f, 'utf8')) || /AIza[0-9A-Za-z_-]{30,}/.test(fs.readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('.env.local is ignored by git', () => {
    expect(fs.readFileSync('.gitignore', 'utf8')).toMatch(/^\.env\.\*/m);
  });
});
