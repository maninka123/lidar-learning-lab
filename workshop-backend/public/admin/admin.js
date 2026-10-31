import { sydneyToEpoch, epochToSydneyInput, fmtSydney, fmtDuration } from './tz.js';

const $ = (id) => document.getElementById(id);
let csrf = '', data = null, skew = 0, timer = 0;

async function api(method, path, body) {
  const r = await fetch('/api/admin/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login') { showLogin(); throw new Error('Please log in again'); }
  if (!r.ok) throw new Error(j.message || j.error || 'Request failed');
  return j;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'msg ' + (bad ? 'bad' : 'good'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 5000); }
const run = async (f) => { try { await f(); } catch (e) { toast(e.message, true); } };

function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('logout').classList.add('hidden'); clearInterval(timer); }
async function boot() {
  const s = await fetch('/api/admin/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
  if (!s.authenticated) return showLogin();
  csrf = s.csrf; $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden');
  await refresh(); clearInterval(timer); timer = setInterval(tick, 1000); setInterval(() => run(refresh), 15000);
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const m = $('loginMsg'); m.classList.add('hidden');
  try { const r = await api('POST', 'login', { password: $('pw').value }); csrf = r.csrf; $('pw').value = ''; await boot(); }
  catch (err) { m.textContent = err.message; m.classList.remove('hidden'); }
});
$('logout').addEventListener('click', () => run(async () => { await api('POST', 'logout'); csrf = ''; showLogin(); }));

async function refresh() {
  data = await api('GET', 'workshop'); skew = data.now - Date.now(); render();
}
const LABEL = { active: 'Active', scheduled: 'Scheduled', expired: 'Expired', off: 'Off' };
function tick() {
  if (!data) return;
  const now = Date.now() + skew;
  if (data.status === 'active') { const left = data.endAt - now; $('countdown').textContent = left > 0 ? fmtDuration(left) : 'Ending…'; if (left <= 0) run(refresh); }
  else if (data.status === 'scheduled') { const left = data.startAt - now; $('countdown').textContent = 'Starts in ' + fmtDuration(left); if (left <= 0) run(refresh); }
  else $('countdown').textContent = data.status === 'expired' ? 'Ended' : 'Off';
}
function render() {
  const c = data.config;
  $('pill').textContent = LABEL[data.status]; $('pill').className = 'pill ' + data.status;
  $('window').textContent = data.status === 'off' && !data.startAt ? 'No workshop has been set up yet.' : `${fmtSydney(c.startAt)} to ${fmtSydney(c.endAt)}${c.enabled ? '' : ' (switched off)'}`;
  const live = data.status === 'active' || data.status === 'scheduled';
  $('disable').disabled = !live; document.querySelectorAll('[data-extend]').forEach((b) => (b.disabled = !live)); $('applyEnd').disabled = !live;
  if (live && document.activeElement !== $('endExact')) $('endExact').value = epochToSydneyInput(c.endAt);
  for (const f of $('limitsForm').elements) if (f.name && document.activeElement !== f) f.value = c[f.name];
  const usd = data.estimatedSpendUsd, money = (v) => (v === null ? '—' : '$' + v.toFixed(4));
  $('studentTiles').innerHTML = [['Joined', `${data.joined} / ${data.codes}`], [`Active now (${data.activeWindowMin} min)`, data.activeNow], ['AI requests', data.requests], ['Est. cost', money(usd)]]
    .map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  $('tiles').innerHTML = [
    ['Requests left', data.requestsRemaining], ['Tokens in', data.tokensIn.toLocaleString()], ['Tokens out', data.tokensOut.toLocaleString()],
    ['Tokens left', data.tokensRemaining === null ? 'no budget' : data.tokensRemaining.toLocaleString()],
  ].map(([k, v]) => `<div class="tile"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
  const place = (r) => [r.city, r.country].filter(Boolean).join(', ') || '—';
  const active = (r) => r.lastSeen > data.now - data.activeWindowMin * 60000;
  $('students').innerHTML = data.perStudent.map((r) => `<tr><td>${esc(r.name ? `${r.name} (${r.label})` : r.label)}${r.revoked ? ' <span class="muted">(revoked)</span>' : active(r) ? ' <span class="pill active">active</span>' : ''}</td><td>${esc(place(r))}</td><td>${r.firstSeen ? fmtSydney(r.firstSeen) : '<span class="muted">not joined</span>'}</td><td>${r.lastSeen ? fmtSydney(r.lastSeen) : '—'}</td><td>${r.requests} <span class="muted">(${r.remaining} left)</span></td><td>${(r.tokensIn + r.tokensOut).toLocaleString()}</td><td>${money(r.costUsd)}</td><td>${r.revoked ? '' : `<button class="danger" data-revoke="${esc(r.id)}">Revoke</button>`}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No codes yet.</td></tr>';
  $('privacy').textContent = `What is kept: an optional name, approximate city and country (from the connection, never the IP address), join and last-activity times, and AI usage. Only people who enter a workshop code are recorded. Deleted ${data.retentionDays} days after the workshop ends.`;
  $('errors').innerHTML = data.errors.map((e) => `<tr><td>${fmtSydney(e.t)}</td><td>${esc(e.kind)}</td><td>${e.status ?? ''}</td><td>${esc(e.code)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None.</td></tr>';
  tick();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.start) run(async () => { await api('POST', 'workshop-start', { durationMinutes: Number(b.dataset.start) }); toast('Workshop started'); await refresh(); });
  if (b.dataset.extend) run(async () => { await api('POST', 'workshop-extend', { minutes: Number(b.dataset.extend) }); toast('End time updated'); await refresh(); });
  if (b.dataset.revoke && confirm('Revoke this code?')) run(async () => { await api('POST', 'codes-revoke', { id: b.dataset.revoke }); await refresh(); });
});
$('disable').addEventListener('click', () => confirm('Turn the workshop off now? Every code stops working immediately.') && run(async () => { await api('POST', 'workshop-disable'); toast('Workshop is off'); await refresh(); }));
$('applyEnd').addEventListener('click', () => run(async () => { await api('POST', 'workshop-end', { endAt: sydneyToEpoch($('endExact').value) }); toast('End time updated'); await refresh(); }));
$('schedule').addEventListener('click', () => run(async () => {
  if (!$('startAt').value || !$('endAt').value) throw new Error('Choose a start and an end');
  await api('POST', 'workshop-start', { startAt: sydneyToEpoch($('startAt').value), endAt: sydneyToEpoch($('endAt').value) }); toast('Workshop scheduled'); await refresh();
}));
$('deleteData').addEventListener('click', () => confirm('Delete every student record for this workshop (codes, names, places, usage)? This cannot be undone.') && run(async () => { await api('POST', 'data-delete'); toast('Student records deleted'); await refresh(); }));
$('saveLimits').addEventListener('click', () => run(async () => {
  const v = {}; for (const f of $('limitsForm').elements) if (f.name) v[f.name] = Number(f.value);
  await api('PUT', 'config', v); toast('Limits saved'); await refresh();
}));

let issued = [];
$('makeCodes').addEventListener('click', () => run(async () => {
  const r = await api('POST', 'codes', { count: Number($('codeCount').value), prefix: $('codePrefix').value });
  issued = r.codes; $('newCodes').classList.remove('hidden');
  $('newCodesBody').innerHTML = issued.map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${esc(c.code)}</td></tr>`).join(''); await refresh();
}));
$('copyCodes').addEventListener('click', () => run(async () => { await navigator.clipboard.writeText(issued.map((c) => `${c.label}\t${c.code}`).join('\n')); toast('Copied'); }));
$('csvCodes').addEventListener('click', () => {
  const blob = new Blob(['label,code\n' + issued.map((c) => `"${c.label.replace(/"/g, '""')}",${c.code}`).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workshop-codes.csv'; a.click(); URL.revokeObjectURL(a.href);
});
boot();
