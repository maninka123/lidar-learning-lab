/**
 * DeepSeek's advertised prices (USD per 1M tokens) for the model the lab uses. Source: https://api-docs.deepseek.com/quick_start/pricing/
 * (checked 31 Oct 2026). Off-peak is half the peak price. Peak: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday
 * (the page also excludes Chinese public holidays, which are not modelled here, so the estimate can be slightly high on those days).
 * `deepseek-v4-flash` is an alias of `deepseek-flash` and is billed at the Flash price.
 */
export const PRICING_CHECKED = '2026-10-31';
export const PRICING_URL = 'https://api-docs.deepseek.com/quick_start/pricing/';
export const RATES = { hit: { off: 0.003, peak: 0.006 }, miss: { off: 0.15, peak: 0.3 }, out: { off: 0.6, peak: 1.2 } } as const;

export function isPeak(ms: number): boolean {
  const d = new Date(ms), day = d.getUTCDay(), h = d.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
export const ratesAt = (ms: number) => { const k = isPeak(ms) ? 'peak' : 'off'; return { peak: k === 'peak', hit: RATES.hit[k], miss: RATES.miss[k], out: RATES.out[k] }; };

/** Cost of one request in nano-dollars (an integer, so it can be added up exactly in the database). */
export function costNano(u: { prompt: number; hit: number; out: number }, ms: number): number {
  const r = ratesAt(ms), hit = Math.min(u.hit, u.prompt), miss = Math.max(0, u.prompt - hit);
  return Math.round(hit * r.hit * 1e3 + miss * r.miss * 1e3 + u.out * r.out * 1e3); // tokens x $/1M x 1e9 / 1e6 = tokens x $/1M x 1e3
}
