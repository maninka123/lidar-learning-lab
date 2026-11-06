import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const adminJs = readFileSync('public/admin/admin.js', 'utf8');
const csvText = new Function(`${adminJs.match(/const csvText = .*$/m)![0]}; return csvText;`)() as (v: unknown) => string;

describe('admin dashboard hardening', () => {
  it('exported CSV cells cannot run as spreadsheet formulas', () => {
    for (const bad of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) expect(csvText(bad).startsWith('"\'')).toBe(true);
    expect(csvText('Ada Lovelace')).toBe('"Ada Lovelace"');
    expect(csvText(-3.5)).toBe('"-3.5"'); // real numbers stay numbers
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText(null)).toBe('""');
  });
  it('admin pages are served with the protective headers', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
    const h = Object.fromEntries(cfg.headers.find((x) => x.source.startsWith('/admin'))!.headers.map((x) => [x.key, x.value]));
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(h['Content-Security-Policy']).toContain("script-src 'self'");
    expect(h['Content-Security-Policy']).not.toContain("script-src 'self' 'unsafe");
  });
});
