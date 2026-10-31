import { sydneyToEpoch, epochToSydneyInput, fmtSydney, fmtDuration } from './tz.js';

const $ = (id) => document.getElementById(id);
let csrf = '', data = null, skew = 0, timer = 0, poll = 0;

// ---- theme: System / Light / Dark (remembered in this browser)
function setTheme(t) {
  try { localStorage.setItem('ws-admin-theme', t); } catch { /* ignore */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
}
let saved = 'system'; try { saved = localStorage.getItem('ws-admin-theme') || 'system'; } catch { /* ignore */ }
setTheme(saved);
$('themeSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-theme-set]'); if (b) setTheme(b.dataset.themeSet); });

async function api(method, path, body) {
  const r = await fetch('/api/admin/' + path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== 'login' && !path.startsWith('passkey-login')) { showLogin(); throw new Error('Please log in again'); }
  if (!r.ok) throw new Error(j.message || j.error || 'Request failed');
  return j;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'msg ' + (bad ? 'bad' : 'good'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 5000); }
const run = async (f) => { try { await f(); } catch (e) { toast(e.message, true); } };

function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('logout').classList.add('hidden'); clearInterval(timer); clearInterval(poll); }
// ---- Passkeys (WebAuthn): Touch ID, Face ID, Windows Hello, a phone or a security key. Binary fields travel as base64url text.
const b64 = { enc: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0)).buffer };
const hasTouch = async () => !!window.PublicKeyCredential; // the browser offers whatever passkeys it has
const creds = (o) => ({ ...o, challenge: b64.dec(o.challenge), user: o.user && { ...o.user, id: b64.dec(o.user.id) }, excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64.dec(c.id) })), allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64.dec(c.id) })) });
async function touchRegister() {
  const { options, challengeId } = await api('POST', 'passkey-register-options', {});
  const c = await navigator.credentials.create({ publicKey: creds(options) });
  const r = c.response;
  await api('POST', 'passkey-register', { challengeId, label: navigator.platform || 'This device', response: { id: c.id, rawId: b64.enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment, clientExtensionResults: c.getClientExtensionResults(), response: { attestationObject: b64.enc(r.attestationObject), clientDataJSON: b64.enc(r.clientDataJSON), transports: r.getTransports ? r.getTransports() : [] } } });
}
async function touchLogin() {
  const { options, challengeId } = await api('POST', 'passkey-login-options', {});
  const c = await navigator.credentials.get({ publicKey: creds(options) });
  const r = c.response;
  const out = await api('POST', 'passkey-login', { challengeId, response: { id: c.id, rawId: b64.enc(c.rawId), type: c.type, authenticatorAttachment: c.authenticatorAttachment, clientExtensionResults: c.getClientExtensionResults(), response: { authenticatorData: b64.enc(r.authenticatorData), clientDataJSON: b64.enc(r.clientDataJSON), signature: b64.enc(r.signature), userHandle: r.userHandle ? b64.enc(r.userHandle) : undefined } } });
  csrf = out.csrf; await boot();
}
$('touchLogin').addEventListener('click', async () => { const m = $('loginMsg'); m.classList.add('hidden'); try { await touchLogin(); } catch (e) { m.textContent = e.name === 'NotAllowedError' ? 'The passkey prompt was cancelled.' : e.message; m.classList.remove('hidden'); } });
$('touchSetup').addEventListener('click', () => run(async () => { await touchRegister(); toast('Passkey added: next time use Sign in with a passkey'); await boot(); }));


async function boot() {
  const s = await fetch('/api/admin/session', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => ({}));
  const touch = await hasTouch();
  if (!s.authenticated) { showLogin(); $('touchLogin').classList.toggle('hidden', !(touch && s.passkeys)); return; }
  $('touchCard').classList.toggle('hidden', !touch || s.passkeys > 0); // offered until a passkey has been set up
  $('touchText').textContent = 'Sign in faster next time with a passkey: Touch ID, Face ID, Windows Hello or a security key.';
  csrf = s.csrf; $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden');
  await refresh(); clearInterval(timer); clearInterval(poll); timer = setInterval(tick, 1000); poll = setInterval(() => run(refresh), 5000); // live: refreshed every few seconds
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const m = $('loginMsg'); m.classList.add('hidden');
  try { const r = await api('POST', 'login', { username: $('user').value.trim(), password: $('pw').value }); csrf = r.csrf; $('pw').value = ''; await boot(); }
  catch (err) { m.textContent = err.message; m.classList.remove('hidden'); }
});
$('logout').addEventListener('click', () => run(async () => { await api('POST', 'logout'); csrf = ''; showLogin(); }));

async function refresh() { data = await api('GET', 'workshop'); skew = data.now - Date.now(); render(); }
const LABEL = { active: 'Running', scheduled: 'Scheduled', expired: 'Ended', off: 'Off' };
function tick() {
  if (!data) return;
  const now = Date.now() + skew, c = data.config;
  if (data.status === 'active') {
    const left = data.endAt - now; $('countdown').textContent = left > 0 ? fmtDuration(left) : 'Ending…';
    $('barFill').style.width = Math.max(0, Math.min(100, ((now - c.startAt) / (c.endAt - c.startAt)) * 100)) + '%'; if (left <= 0) run(refresh);
  } else if (data.status === 'scheduled') {
    const left = data.startAt - now; $('countdown').textContent = 'Starts in ' + fmtDuration(left); $('barFill').style.width = '0%'; if (left <= 0) run(refresh);
  }
}
const usd = (v) => (v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2));
const tile = (k, v, sub, cls = '') => `<div class="tile ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
function render() {
  const c = data.config, live = data.status === 'active' || data.status === 'scheduled';
  $('statusText').textContent = LABEL[data.status]; $('dot').className = 'dot ' + data.status;
  $('runningView').classList.toggle('hidden', !live); $('idleView').classList.toggle('hidden', live);
  $('window').textContent = live ? `${fmtSydney(c.startAt)} → ${fmtSydney(c.endAt)}` : data.status === 'expired' ? `Ended ${fmtSydney(c.endAt)}` : '';
  $('idleText').textContent = data.status === 'expired' ? 'That workshop has ended. Start another:' : 'Start a workshop:';
  $('limitsCard').classList.toggle('hidden', !live); $('lowerRow').classList.toggle('g2', live); // while idle, the limits are asked for as part of starting
  if (!live) { if (document.activeElement !== $('startPerUser')) $('startPerUser').value = c.maxPerStudent; if (document.activeElement !== $('startTotal')) $('startTotal').value = c.maxTotal; if (document.activeElement !== $('startMax')) $('startMax').value = c.maxStudents || ''; $('startUnl').checked = c.maxStudents === 0; $('startMax').disabled = c.maxStudents === 0; }
  if (live && document.activeElement !== $('endExact')) $('endExact').value = epochToSydneyInput(c.endAt);
  for (const f of $('limitsForm').elements) if (f.name && f.type !== 'checkbox' && document.activeElement !== f) f.value = f.name === 'maxStudents' && !c.maxStudents ? '' : c[f.name];
  $('limUnl').checked = c.maxStudents === 0; $('limitsForm').elements.maxStudents.disabled = c.maxStudents === 0;
  document.querySelectorAll('[data-access]').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.access === 'codes') === c.needCode)));
  $('accessText').textContent = c.needCode ? 'Each user needs a personal code. Generate them below.' : 'No codes: anyone using the lab can use the AI while the workshop runs.';
  $('codesBox').classList.toggle('hidden', !c.needCode);

  const p = data.pricing;
  $('pricingNote').textContent = `${p.model} · ${p.peak ? 'peak' : 'off-peak'} price now · $${p.miss} in · $${p.out} out per 1M tokens`;
  $('liveTiles').innerHTML = [
    tile('Users', `${data.joined}`, `${data.activeNow} active now`),
    tile('AI requests', `${data.requests}`, `${data.requestsRemaining} left of ${c.maxTotal}`),
    tile('Tokens', (data.tokensIn + data.tokensOut).toLocaleString(), `${data.tokensIn.toLocaleString()} in · ${data.tokensOut.toLocaleString()} out`),
    tile('Spend so far', usd(data.spendUsd), 'at DeepSeek’s advertised prices', 'accent'),
  ].join('');

  $('activeNote').textContent = `active = seen in the last ${data.activeWindowMin} min`;
  const place = (r) => [r.city, r.country].filter(Boolean).join(', ') || '—', active = (r) => r.lastSeen > data.now - data.activeWindowMin * 60000;
  $('users').innerHTML = data.perStudent.map((r) => `<tr><td>${esc(r.name ? `${r.name} (${r.label})` : r.label)}${r.revoked ? ' <span class="faint">(blocked)</span>' : active(r) ? ' <span class="chip active">active</span>' : ''}</td><td>${esc(place(r))}</td><td>${r.firstSeen ? fmtSydney(r.firstSeen) : '<span class="faint">not joined</span>'}</td><td>${r.lastSeen ? fmtSydney(r.lastSeen) : '—'}</td><td class="num">${r.requests}</td><td class="num">${(r.tokensIn + r.tokensOut).toLocaleString()}</td><td class="num">${usd(r.costUsd)}</td><td class="num">${r.revoked ? '' : `<button class="btn sm" data-revoke="${esc(r.id)}">${c.needCode ? 'Revoke' : 'Block'}</button>`}</td></tr>`).join('') || `<tr><td colspan="8" class="faint empty">${c.needCode ? 'No codes yet.' : 'Nobody has joined yet.'}</td></tr>`;
  $('privacy').textContent = 'Kept: optional name, approximate city and country (never the IP address), times and usage, only for people who use the workshop AI. Nothing is deleted automatically: use Delete user records when you are done.';
  $('errors').innerHTML = data.errors.map((e) => `<tr><td>${fmtSydney(e.t)}</td><td>${esc(e.kind)}</td><td>${e.status ?? ''}</td><td>${esc(e.code)}</td></tr>`).join('') || '<tr><td colspan="4" class="faint empty">None.</td></tr>';
  tick();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.dur) { dur = Number(b.dataset.dur); document.querySelectorAll('[data-dur]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); }
  if (b.dataset.extend) run(async () => { await api('POST', 'workshop-extend', { minutes: Number(b.dataset.extend) }); toast('End time updated'); await refresh(); });
  if (b.dataset.bump) { const [f, n] = b.dataset.bump.split(':'); if (f === 'maxStudents' && data.config.maxStudents === 0) return toast('Users are already unlimited'); run(async () => { await api('PUT', 'config', { [f]: data.config[f] + Number(n) }); toast('Limit raised'); await refresh(); }); }
  if (b.dataset.access) run(async () => { await api('PUT', 'config', { needCode: b.dataset.access === 'codes' }); await refresh(); });
  if (b.dataset.revoke && confirm('Block this user? They lose access to the workshop AI.')) run(async () => { await api('POST', 'codes-revoke', { id: b.dataset.revoke }); await refresh(); });
});
$('disable').addEventListener('click', () => confirm('Turn the workshop off now? Users lose access immediately.') && run(async () => { await api('POST', 'workshop-disable'); toast('Workshop is off'); await refresh(); }));
$('applyEnd').addEventListener('click', () => run(async () => { await api('POST', 'workshop-end', { endAt: sydneyToEpoch($('endExact').value) }); toast('End time updated'); await refresh(); }));
$('deleteData').addEventListener('click', () => confirm('Delete every user record for this workshop (names, places, usage and any codes)? This cannot be undone.') && run(async () => { await api('POST', 'data-delete'); toast('User records deleted'); await refresh(); }));
$('saveLimits').addEventListener('click', () => run(async () => {
  const v = {}; for (const f of $('limitsForm').elements) if (f.name) v[f.name] = Number(f.value);
  if ($('limUnl').checked) v.maxStudents = 0;
  await api('PUT', 'config', v); toast('Limits saved'); await refresh();
}));

let dur = 180;
$('startUnl').addEventListener('change', () => { $('startMax').disabled = $('startUnl').checked; });
$('limUnl').addEventListener('change', () => { $('limitsForm').elements.maxStudents.disabled = $('limUnl').checked; });
$('startBtn').addEventListener('click', () => run(async () => {
  // the basics first (requests per user, total requests), then switch on
  await api('PUT', 'config', { maxPerStudent: Number($('startPerUser').value), maxTotal: Number($('startTotal').value), maxStudents: $('startUnl').checked ? 0 : Number($('startMax').value) });
  const dates = $('startAt').value && $('endAt').value ? { startAt: sydneyToEpoch($('startAt').value), endAt: sydneyToEpoch($('endAt').value) } : { durationMinutes: dur };
  await api('POST', 'workshop-start', dates); toast(dates.startAt ? 'Workshop scheduled' : 'Workshop started'); await refresh();
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
