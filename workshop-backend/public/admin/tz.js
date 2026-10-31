// Australia/Sydney helpers (daylight saving aware). The server only ever stores UTC epoch milliseconds.
const TZ = 'Australia/Sydney';
const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function parts(ms) { const o = {}; for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value; if (o.hour === '24') o.hour = '00'; return o; }
export function offsetMs(ms) { const p = parts(ms); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; }
/** "2026-11-05T09:30" typed as Sydney time -> UTC epoch ms */
export function sydneyToEpoch(s) {
  const [d, t] = s.split('T'), [y, mo, da] = d.split('-').map(Number), [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, da, h, mi);
  let ms = guess - offsetMs(guess); ms = guess - offsetMs(ms);
  return ms;
}
export function epochToSydneyInput(ms) { const p = parts(ms); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
export function fmtSydney(ms) { return ms ? new Intl.DateTimeFormat('en-AU', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms)) : '—'; }
export function fmtDuration(ms) {
  if (ms <= 0) return '0m';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m ${String(sec).padStart(2, '0')}s` : `${m}m ${String(sec).padStart(2, '0')}s`;
}
