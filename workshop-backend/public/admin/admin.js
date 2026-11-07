import { sydneyToEpoch, epochToSydneyInput, fmtSydney, fmtDuration } from './tz.js';
import { initFeedback, loadFeedback } from './feedback.js';

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
/** A CSV cell. Text that starts with = + - @ (or a tab or return) would run as a formula in Excel or Sheets, so it gets a leading apostrophe. Numbers are left alone. */
const csvText = (v) => { const t = String(v ?? ''); return '"' + ((typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) ? "'" + t : t).replace(/"/g, '""') + '"'; };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(text, bad) { const t = $('toast'); t.textContent = text; t.className = 'msg ' + (bad ? 'bad' : 'good'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.add('hidden'), 5000); }
const run = async (f) => { try { await f(); } catch (e) { toast(e.message, true); } };

function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('viewBar').classList.add('hidden'); $('chView').classList.add('hidden'); $('fbView').classList.add('hidden'); $('logout').classList.add('hidden'); clearInterval(timer); clearInterval(poll); mon = null; }
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
  csrf = s.csrf; $('login').classList.add('hidden'); $('app').classList.remove('hidden'); $('logout').classList.remove('hidden'); $('viewBar').classList.remove('hidden');
  await refresh(); refreshLive(); clearInterval(timer); clearInterval(poll); timer = setInterval(tick, 1000); poll = setInterval(() => { run(refresh); if (!document.hidden) refreshLive(); }, 5000); // live: refreshed every few seconds
}
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); const m = $('loginMsg'); m.classList.add('hidden');
  try { const r = await api('POST', 'login', { username: $('user').value.trim(), password: $('pw').value }); csrf = r.csrf; $('pw').value = ''; await boot(); }
  catch (err) { m.textContent = err.message; m.classList.remove('hidden'); }
});
$('logout').addEventListener('click', () => run(async () => { await api('POST', 'logout'); csrf = ''; showLogin(); }));

let mon = null, monAt = 0, monErr = '';
async function refresh() { data = await api('GET', 'workshop'); skew = data.now - Date.now(); render(); }
// the live monitor reads counters kept by the server: nobody using the lab has to do anything for it to fill in
async function refreshLive() {
  try { mon = await api('GET', 'live'); monAt = Date.now(); monErr = ''; } catch (e) { monErr = e.message; }
  renderMonitor(); renderTiles();
}
const LED = (cls) => `<span class="led ${cls}"></span>`;
const REASON = { rate_limit: 'a user asked too fast', address_rate: 'one network asked too fast', address_quota: 'a network used its share', student_quota: 'a user used all theirs', total_quota: 'workshop limit reached', token_budget: 'usage budget reached', revoked: 'blocked user' };
function meter(label, used, max, text) {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0, cls = pct > 90 ? 'bad' : pct > 70 ? 'warn' : '';
  return `<div class="meter"><div class="row"><span>${esc(label)}</span><span class="mono">${esc(text)}</span></div><div class="bar"><i class="${cls}" style="width:${pct}%"></i></div></div>`;
}
function chart(ser) {
  const W = 320, H = 92, n = ser.length, bw = W / n, mx = Math.max(4, ...ser.map((m) => m.req)), y = (v) => (v / mx) * (H - 14);
  const bars = ser.map((m, i) => { let yy = H; const seg = (v, col) => { if (!v) return ''; const hh = y(v); yy -= hh; return `<rect x="${(i * bw + 1).toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${hh.toFixed(1)}" rx="1.5" fill="${col}"/>`; }; return seg(m.ok, 'var(--accent)') + seg(m.denied, 'var(--orange)') + seg(m.fail, 'var(--red)'); }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Requests in each of the last 30 minutes"><line x1="0" x2="${W}" y1="${H - 0.5}" y2="${H - 0.5}" stroke="var(--sep)"/>${bars}<text x="2" y="9" font-size="11" fill="var(--text3)">${mx} / min</text></svg>`;
}
function renderMonitor() {
  const el = $('monitor'); if (!el) return;
  if (!mon) { el.innerHTML = `<section class="card"><div class="livehead"><span class="pulse stale"></span><h2>Live monitor</h2></div><p class="faint">${monErr ? esc(monErr) : 'Loading…'}</p></section>`; return; }
  const m = mon, stale = Date.now() - monAt > 15000 || !!monErr, t = m.totals30, cap = m.capacity, bal = m.balance, running = m.status === 'active';
  const ms = m.avgMs ? `${Math.round(m.avgMs)} ms` : '—';
  const reasons = Object.entries(t.reasons).sort((a, b) => b[1] - a[1]);
  const errRows = m.errors.map((e) => `<tr><td>${fmtSydney(e.t).split(',').pop().trim()}</td><td>${esc(e.kind)}</td><td>${e.status ?? ''}</td></tr>`).join('');
  const cur = bal.currency === 'CNY' ? '¥' : '$';
  el.innerHTML = `
  <section class="card">
    <div class="livehead"><span class="pulse ${monErr ? 'bad' : stale ? 'stale' : ''}"></span><h2>Live monitor</h2><span class="faint" style="margin-left:auto">${monErr ? 'connection lost' : stale ? 'paused' : 'updates every 5 s'}</span></div>
    <div class="pair">
      <div class="tile hero-tile"><span>Using the AI now</span><b>${m.usersNow}</b><small>of ${m.usersJoined} joined · seen in the last ${m.activeWindowMin} min</small></div>
      <div class="tile"><span>Requests / min</span><b>${m.rpmNow}</b><small>last full minute: ${m.rpm}</small></div>
    </div>
    ${running ? '' : `<p class="faint">AI access is ${esc(LABEL[m.status] || m.status).toLowerCase()}, so users cannot use the shared AI right now (the rest of the lab still works).</p>`}
    <div class="chartbox">${chart(m.series)}<div class="legend"><span><i style="background:var(--accent)"></i>answered ${t.ok}</span><span><i style="background:var(--orange)"></i>held back ${t.denied}</span><span><i style="background:var(--red)"></i>failed ${t.fail}</span><span>last 30 min</span></div></div>
    <div class="pair"><div class="tile"><span>Answer time</span><b style="font-size:1.4rem">${ms}</b><small>average, last 5 min</small></div><div class="tile"><span>Problems, 30 min</span><b style="font-size:1.4rem;color:${t.fail || t.denied ? 'var(--orange)' : 'var(--green)'}">${t.fail + t.denied}</b><small>${t.req ? Math.round(((t.fail + t.denied) / t.req) * 100) : 0} % of requests</small></div></div>
  </section>
  <section class="card">
    <h3>Health</h3>
    <div class="lights">
      <div class="light">${LED(m.health.store.ok ? 'ok' : 'bad')}<span>Database</span><small>${m.health.store.ms} ms</small></div>
      <div class="light">${LED(m.health.deepseek.ok ? 'ok' : 'bad')}<span>DeepSeek</span><small>${esc(m.health.deepseek.detail || '')}${m.health.deepseek.ok ? ` · ${m.balance.ms} ms` : ''}</small></div>
      <div class="light">${LED(running ? 'ok' : m.status === 'scheduled' ? 'warn' : 'bad')}<span>AI access for users</span><small>${esc(LABEL[m.status] || m.status)}</small></div>
      <div class="light">${LED(!m.site ? 'warn' : m.site.throttled ? 'bad' : m.site.ok ? 'ok' : 'bad')}<span>Student website</span><small>${m.site.throttled ? 'slowing visitors down (HTTP ' + m.site.status + ')' : m.site.ok ? 'GitHub Pages · ' + m.site.ms + ' ms' : esc(m.site.error || 'not reachable')}</small></div>
      <div class="light">${LED(!m.github.ok ? 'warn' : m.github.pages === 'operational' && m.github.overall === 'none' ? 'ok' : m.github.pages === 'operational' ? 'warn' : 'bad')}<span>GitHub status</span><small>${!m.github.ok ? esc('could not read it (' + m.github.error + ')') : m.github.incident ? esc(m.github.incident) : 'Pages ' + esc(m.github.pages.replace(/_/g, ' '))}</small></div>
      <div class="light">${LED(t.fail === 0 ? 'ok' : t.fail < 3 ? 'warn' : 'bad')}<span>AI failures</span><small>${t.fail} in 30 min</small></div>
    </div>
  </section>
  <section class="card">
    <h3>Capacity left</h3>
    ${bal.ok && m.left ? `<div class="credit"><span>DeepSeek credit</span><b>${cur}${bal.total.toFixed(2)}</b><span>≈ ${big(m.left.requests)} more requests at about ${usdTiny(m.left.perRequestUsd)} each</span></div>` : `<p class="faint">DeepSeek credit unknown${bal.error ? ' (' + esc(bal.error) + ')' : ''}.</p>`}
    ${meter('Requests', cap.requests, cap.maxTotal, `${cap.requests} / ${cap.maxTotal}`)}
    ${meter('Users', m.usersJoined, m.maxStudents, m.maxStudents ? `${m.usersJoined} / ${m.maxStudents}` : `${m.usersJoined} (no limit)`)}
    <p class="faint">Per user: ${cap.perUserLimit} requests, ${cap.rpmPerUser} a minute. Per network: ${cap.rpmPerAddress} a minute.</p>
  </section>
  <section class="card">
    <h3>Held back and failed</h3>
    ${reasons.length ? `<table class="mini"><tbody>${reasons.map(([r, n]) => `<tr><td>${esc(REASON[r] || r)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>` : '<p class="faint">Nothing was held back in the last 30 minutes.</p>'}
    ${t.fail ? `<p class="faint">${t.fail} request${t.fail === 1 ? '' : 's'} could not be answered by DeepSeek. Those were not counted against anyone.</p>` : ''}
    ${errRows ? `<table class="mini"><thead><tr><th>Time</th><th>Kind</th><th>Status</th></tr></thead><tbody>${errRows}</tbody></table>` : ''}
  </section>`;
}
const LABEL = { active: 'On', scheduled: 'Scheduled', expired: 'Ended', off: 'Off' };
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
function renderTiles() {
  if (!data) return; const c = data.config, l = mon?.left, bal = mon?.balance;
  $('liveTiles').innerHTML = [
    tile('Users', `${data.joined}`, `${data.activeNow} active now`),
    tile('AI requests', `${data.requests}`, `${data.requestsRemaining} left of ${c.maxTotal}`),
    tile('Tokens', (data.tokensIn + data.tokensOut).toLocaleString(), `${data.tokensIn.toLocaleString()} in · ${data.tokensOut.toLocaleString()} out`),
    tile('Spend so far', usdTiny(data.spendUsd), 'at DeepSeek’s advertised prices', 'accent'),
    tile('DeepSeek balance', bal ? (bal.ok ? `${bal.currency === 'CNY' ? '¥' : '$'}${bal.total.toFixed(2)}` : 'unknown') : '…', bal ? (bal.ok ? 'credit left on the account' : `could not read it (${bal.error})`) : 'checking', bal?.ok ? 'accent' : ''),
    tile('Requests left to pay for', l ? `≈ ${big(l.requests)}` : bal ? '—' : '…', l ? `about ${usdTiny(l.perRequestUsd)} each · ${l.basis === 'measured' ? 'from real requests' : 'a typical request'}${l.approxCurrency ? ' · yuan converted roughly' : ''}` : 'needs the balance'),
  ].join('');
}
const usd = (v) => (v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(2));
/** a very small price per request, with enough digits to mean something: $0.000031 */
const usdTiny = (v) => (v >= 0.01 ? usd(v) : v <= 0 ? '$0' : '$' + v.toFixed(Math.min(7, Math.max(4, 1 - Math.floor(Math.log10(v)) + 1))));
const big = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + ' M' : n >= 1e4 ? Math.round(n / 1e3) + ' k' : n.toLocaleString());
const tile = (k, v, sub, cls = '') => `<div class="tile ${cls}"><span>${esc(k)}</span><b>${esc(v)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
function render() {
  const c = data.config, live = data.status === 'active' || data.status === 'scheduled';
  $('statusText').textContent = LABEL[data.status]; $('dot').className = 'dot ' + data.status;
  $('runningView').classList.toggle('hidden', !live); $('idleView').classList.toggle('hidden', live);
  $('window').textContent = live ? `${fmtSydney(c.startAt)} → ${fmtSydney(c.endAt)}` : data.status === 'expired' ? `Ended ${fmtSydney(c.endAt)}` : '';
  $('idleText').textContent = data.status === 'expired' ? 'AI access has ended. Turn it on again:' : 'Turn on AI access:';
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
  renderTiles();

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
$('disable').addEventListener('click', () => confirm('Turn AI access off now? Users lose the shared AI immediately (the rest of the lab keeps working).') && run(async () => { await api('POST', 'workshop-disable'); toast('AI access is off'); await refresh(); }));
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
  await api('POST', 'workshop-start', dates); toast(dates.startAt ? 'AI access scheduled' : 'AI access is on'); await refresh();
}));

let issued = [];
$('makeCodes').addEventListener('click', () => run(async () => {
  const r = await api('POST', 'codes', { count: Number($('codeCount').value), prefix: $('codePrefix').value });
  issued = r.codes; $('newCodes').classList.remove('hidden');
  $('newCodesBody').innerHTML = issued.map((c) => `<tr><td>${esc(c.label)}</td><td class="mono">${esc(c.code)}</td></tr>`).join(''); await refresh();
}));
$('copyCodes').addEventListener('click', () => run(async () => { await navigator.clipboard.writeText(issued.map((c) => `${c.label}\t${c.code}`).join('\n')); toast('Copied'); }));
$('csvCodes').addEventListener('click', () => {
  const blob = new Blob(['label,code\n' + issued.map((c) => `${csvText(c.label)},${c.code}`).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workshop-codes.csv'; a.click(); URL.revokeObjectURL(a.href);
});
boot();

// ---- Challenge scores: what students sent from the Industrial Digital Twin Challenge
let ch = { subs: [], labels: {}, accept: { accepting: false, until: null }, settings: null }, chUnit = 'unlimited';
const TASK_NAMES = { completion: 'Completing all the missions', twin: 'Digital twin', detect: 'Object detection', colour: 'Colour labels read', change: 'Changes found', quality: 'Noise handling', safety: 'Safety zones flagged', budget: 'Budget and efficiency' };
const DEFAULT_SET = { budgetVersion: 4, budget: 1600, priceScale: 1, maxSubmissions: 0, weights: { completion: 60, twin: 10, detect: 10, colour: 4, change: 4, quality: 8, safety: 2, budget: 2 }, enabled: { completion: true, twin: true, detect: true, colour: true, change: true, quality: true, safety: true, budget: true } };
const TASK_SHORT = { completion: 'Finished', twin: 'Twin', detect: 'Objects', colour: 'Colour', change: 'Change', quality: 'Noise', safety: 'Safety', budget: 'Budget' };
const openRows = new Set();
function setView(v) {
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('app').style.display = v === 'workshop' ? '' : 'none';
  $('chView').classList.toggle('hidden', v !== 'challenge');
  $('fbView').classList.toggle('hidden', v !== 'feedback');
  if (v === 'challenge') run(loadChallenge);
  if (v === 'feedback') run(loadFeedback);
}
$('viewBar').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
async function loadChallenge() { const r = await api('GET', 'challenge'); ch = { subs: r.submissions || [], labels: r.labels || {}, accept: r.accept || { accepting: false, until: null }, settings: r.settings || DEFAULT_SET }; skew = r.now - Date.now(); renderChallenge(); if (!document.activeElement || !$('chSettings').contains(document.activeElement)) renderSettings(ch.settings); }
const netName = (s) => ch.labels[s.net] || ('network ' + s.net.slice(0, 6));
const place = (s) => [s.geo && s.geo.city, s.geo && s.geo.country].filter(Boolean).join(', ') || 'unknown place';
/** index numbers seen per IP address and per browser id: more than one means one computer sent for several people */
function sharing() {
  const byIp = new Map(), byDev = new Map();
  for (const s of ch.subs) { const k = s.index.toLowerCase(); if (s.ip) { if (!byIp.has(s.ip)) byIp.set(s.ip, new Set()); byIp.get(s.ip).add(k); } if (s.device) { if (!byDev.has(s.device)) byDev.set(s.device, new Set()); byDev.get(s.device).add(k); } }
  const ip = (s) => (s.ip && byIp.get(s.ip) ? byIp.get(s.ip).size : 1), dev = (s) => (s.device && byDev.get(s.device) ? byDev.get(s.device).size : 1);
  return { ip, dev, n: (s) => Math.max(ip(s), dev(s)) };
}
function visibleSubs() {
  const q = $('chSearch').value.trim().toLowerCase(), kind = $('chKind').value, mode = $('chMode').value;
  const sh = sharing(), shared = $('chShare').value === 'shared';
  let list = ch.subs.filter((s) => (!kind || s.kind === kind) && (!q || s.name.toLowerCase().includes(q) || s.index.toLowerCase().includes(q)) && (!shared || sh.n(s) > 1));
  if (mode === 'latest') { const best = new Map(); for (const s of list) { const k = s.index.toLowerCase(), b = best.get(k); if (!b || s.total > b.total || (s.total === b.total && s.at > b.at)) best.set(k, s); } list = [...best.values()].sort((a, b) => b.at - a.at); }
  return list;
}
function renderSettings(s) {
  const f = $('chSetForm'); f.budget.value = s.budget * 5; f.priceScale.value = s.priceScale; f.maxSubmissions.value = s.maxSubmissions;
  $('chTasks').innerHTML = Object.keys(TASK_NAMES).map((k) => `<tr><td>${esc(TASK_NAMES[k])}</td><td><input type="checkbox" data-en="${k}" ${s.enabled[k] ? 'checked' : ''} aria-label="${esc(TASK_NAMES[k])} counts"></td><td class="num"><input type="number" data-w="${k}" min="0" max="100" value="${s.weights[k]}" style="width:70px" aria-label="${esc(TASK_NAMES[k])} weight"></td><td class="num" data-share="${k}">—</td></tr>`).join('');
  updateShares();
}
function readSettings() {
  const f = $('chSetForm'), weights = {}, enabled = {};
  document.querySelectorAll('[data-w]').forEach((i) => { weights[i.dataset.w] = Number(i.value); });
  document.querySelectorAll('[data-en]').forEach((i) => { enabled[i.dataset.en] = i.checked; });
  return { budgetVersion: 4, budget: Number(f.budget.value) / 5, priceScale: Number(f.priceScale.value), maxSubmissions: Number(f.maxSubmissions.value), weights, enabled };
}
function updateShares() {
  const s = readSettings(), total = Object.keys(TASK_NAMES).reduce((a, k) => a + (s.enabled[k] ? s.weights[k] || 0 : 0), 0);
  document.querySelectorAll('[data-share]').forEach((c) => { const k = c.dataset.share; c.textContent = s.enabled[k] && total ? ((100 * (s.weights[k] || 0)) / total).toFixed(0) + ' %' : '—'; });
  $('chSetNote').textContent = 'Points are rescaled to 100 over the tasks that count';
}
$('chSettings').addEventListener('input', updateShares);
$('chSetSave').addEventListener('click', () => run(async () => { const r = await api('POST', 'challenge-settings', readSettings()); ch.settings = r.settings; renderSettings(r.settings); $('chSetMsg').textContent = 'Saved ' + fmtSydney(Date.now()); toast('Challenge settings saved'); }));
$('chSetReset').addEventListener('click', () => { renderSettings(DEFAULT_SET); $('chSetMsg').textContent = 'Defaults loaded: press Save to keep them'; });
function renderAccept() {
  const a = ch.accept, on = !!a.accepting, left = a.until ? a.until - (Date.now() + skew) : null;
  $('chDot').className = 'dot ' + (on ? 'active' : 'off'); $('chStatus').textContent = on ? 'Accepting scores' : 'Not accepting';
  document.querySelectorAll('#chMode button').forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.mode === 'on') === on)));
  $('chOpenView').classList.toggle('hidden', !on); $('chClosedView').classList.toggle('hidden', on);
  $('chCountdown').textContent = !on ? '' : left === null ? 'Open until you stop it' : 'Closes in ' + fmtDuration(left) + ' (' + fmtSydney(a.until) + ')';
}
setInterval(() => { if ($('chView').classList.contains('hidden')) return; if (ch.accept.accepting && ch.accept.until && ch.accept.until - (Date.now() + skew) <= 0) ch.accept.accepting = false; renderAccept(); }, 1000);
$('chDur').addEventListener('click', (e) => {
  const b = e.target.closest('[data-unit]'); if (!b) return; chUnit = b.dataset.unit;
  document.querySelectorAll('#chDur button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('chLenBox').classList.toggle('hidden', chUnit === 'unlimited');
  if (chUnit !== 'unlimited') { $('chLenLabel').textContent = 'Open for (' + chUnit + ')'; $('chLen').value = chUnit === 'hours' ? 3 : 1; }
});
const startAccepting = () => run(async () => { const n = Number($('chLen').value), mins = chUnit === 'hours' ? n * 60 : chUnit === 'days' ? n * 1440 : null; if (mins !== null && !(n >= 1)) throw new Error('Enter how many ' + chUnit + '.'); await api('POST', 'challenge-start', mins === null ? {} : { durationMinutes: Math.round(mins) }); await loadChallenge(); toast(chUnit === 'unlimited' ? 'Now accepting scores until you stop it' : 'Now accepting scores'); });
const stopAccepting = () => { if (confirm('Stop accepting scores? Students can still use the challenge and see their grade, but sending will be refused until you start it again.')) run(async () => { await api('POST', 'challenge-stop', {}); await loadChallenge(); toast('Stopped: no more scores are accepted'); }); };
$('chMode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (!b) return; const on = !!ch.accept.accepting; if (b.dataset.mode === 'on' && !on) startAccepting(); else if (b.dataset.mode === 'off' && on) stopAccepting(); });
function renderChallenge() {
  renderAccept();
  const all = ch.subs, students = new Set(all.map((s) => s.index.toLowerCase())), sh = sharing();
  const bestBy = new Map(); for (const s of all) { const k = s.index.toLowerCase(); if (!bestBy.has(k) || s.total > bestBy.get(k)) bestBy.set(k, s.total); }
  const bests = [...bestBy.values()], avg = bests.length ? bests.reduce((a, b) => a + b, 0) / bests.length : 0;
  $('chTiles').innerHTML = [['Records', all.length], ['Students', students.size], ['Average best score', avg.toFixed(1)], ['Top score', bests.length ? Math.max(...bests).toFixed(1) : '—']].map(([k, v]) => `<div class="tile"><span class="faint">${esc(k)}</span><b class="big" style="font-size:1.6rem">${esc(String(v))}</b></div>`).join('');
  $('chNote').textContent = all.length ? 'Latest ' + fmtSydney(all[0].at) : 'Nothing received yet';
  const list = visibleSubs();
  $('chRows').innerHTML = list.length ? list.map((s) => {
    const chips = Object.keys(TASK_SHORT).map((k) => `<span class="chip" title="${esc(TASK_SHORT[k])}">${esc(TASK_SHORT[k])} ${Math.round((s.tasks[k] || 0) * 100)}</span>`).join(' ');
    const mins = s.startedAt ? Math.max(0, Math.round((s.at - s.startedAt) / 60000)) : null;
    const det = openRows.has(s.id) ? `<tr><td colspan="9"><div class="stack" style="gap:6px;font-size:.85rem">
      <div><b>Team:</b> ${esc(s.team || '—')} · <b>Equipment:</b> ${esc(s.equipment.lidars.join('; ') || 'no LiDAR')}${s.equipment.cameras.length ? ' · cameras: ' + esc(s.equipment.cameras.join('; ')) : ''}${s.equipment.lights ? ' · ' + s.equipment.lights + ' lamp(s)' : ''}${s.equipment.platform ? ' · mobile platform' : ''}</div>
      ${(s.flags || []).length ? '<div><b>Check this score:</b> ' + esc(s.flags.join(' ')) + ' <span class="faint">(grading runs in the browser, so this only spots numbers that contradict each other)</span></div>' : ''}
      <div><b>Pipeline:</b> ${esc(s.pipeline.join(' → ') || '—')}</div>
      ${s.missions ? '<div><b>Missions:</b> ' + s.missions.map((m) => 'M' + m.number + ': ' + esc(m.status) + ' (' + Number(m.score).toFixed(0) + '%, ' + Number(m.attempts) + ' attempts)').join(' · ') + '</div>' : ''}
      <div><b>Key results:</b> ${esc(Object.entries(s.metrics).map(([k, v]) => k + ' ' + v).join(' · ') || '—')}</div>
      <div><b>Points:</b> ${esc(Object.keys(TASK_SHORT).map((k) => TASK_SHORT[k] + ' ' + (s.points[k] ?? 0)).join(' · '))} · <b>Budget used:</b> ${s.cost} / ${s.budget} credits</div>
      <div class="faint">Started ${s.startedAt ? esc(fmtSydney(s.startedAt)) : '—'}${mins !== null ? ' (about ' + mins + ' min before sending)' : ''} · time zone ${esc(s.client.tz || '—')} · language ${esc(s.client.lang || '—')} · from ${esc(s.origin || '—')}</div></div></td></tr>` : '';
    return `<tr class="${sh.n(s) > 1 ? 'shared' : ''}"><td>${esc(fmtSydney(s.at))}</td><td>${esc(s.name)}${(s.flags || []).length ? ` <span class="chip warn" title="${esc(s.flags.join(' '))}">check</span>` : ''}</td><td class="mono">${esc(s.index)}</td><td>${esc(place(s))}<br><span class="faint">${esc(netName(s))}</span> <button class="btn sm" data-label="${esc(s.net)}" title="Name this network (for example Campus Wi-Fi or Home)">Name</button><br><span class="mono faint">${esc(s.ip || 'no IP')}</span>${sh.n(s) > 1 ? ` <span class="chip bad" title="This computer sent scores under ${sh.n(s)} different index numbers">shared · ${sh.n(s)} index numbers</span>` : ''}</td><td class="num"><b>${s.total.toFixed(1)}</b><br><span class="faint">${esc(s.kind)}</span></td><td>${chips}</td><td class="num">${s.cost}</td><td class="num">${s.attempts.practice}+${s.attempts.final}</td><td><button class="btn sm" data-open="${esc(s.id)}">${openRows.has(s.id) ? 'Hide' : 'Details'}</button> <button class="btn sm danger" data-del="${esc(s.id)}" title="Delete this record">✕</button></td></tr>${det}`;
  }).join('') : '<tr><td colspan="9" class="faint">No scores to show.</td></tr>';
}
['chSearch', 'chMode', 'chKind', 'chShare'].forEach((id) => $(id).addEventListener('input', renderChallenge));
$('chRefresh').addEventListener('click', () => run(loadChallenge));
$('chView').addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]'), d = e.target.closest('[data-del]'), l = e.target.closest('[data-label]');
  if (o) { const id = o.dataset.open; if (openRows.has(id)) openRows.delete(id); else openRows.add(id); renderChallenge(); }
  if (d && confirm('Delete this score record?')) run(async () => { await api('POST', 'challenge-delete', { id: d.dataset.del }); await loadChallenge(); });
  if (l) { const cur = ch.labels[l.dataset.label] || ''; const v = prompt('Name for this network (for example Campus Wi-Fi or Home). Leave empty to remove the label.', cur); if (v !== null) run(async () => { await api('POST', 'challenge-label', { tag: l.dataset.label, label: v }); await loadChallenge(); }); }
});
$('chClear').addEventListener('click', () => { if (confirm('Delete ALL challenge score records? This cannot be undone.')) run(async () => { await api('POST', 'challenge-clear', {}); await loadChallenge(); }); });
$('chCsv').addEventListener('click', () => {
  const q = csvText;
  const head = ['sent (Sydney)', 'name', 'index', 'place', 'network', 'ip address', 'browser id', 'index numbers on this computer', 'kind', 'score', ...Object.values(TASK_SHORT).map((n) => n + ' (0-1)'), 'cost', 'budget', 'practice runs', 'final runs', 'equipment', 'pipeline', 'missions', 'checks'];
  const sh = sharing(), rows = visibleSubs().map((s) => [fmtSydney(s.at), s.name, s.index, place(s), netName(s), s.ip || '', s.device || '', sh.n(s), s.kind, s.total, ...Object.keys(TASK_SHORT).map((k) => s.tasks[k] ?? 0), s.cost, s.budget, s.attempts.practice, s.attempts.final, [...s.equipment.lidars, ...s.equipment.cameras].join('; '), s.pipeline.join(' > '), (s.missions || []).map((m) => 'M' + m.number + ':' + m.status + ':' + m.score + ':' + m.attempts).join('; '), (s.flags || []).join(' ')]);
  const csv = [head, ...rows].map((r) => r.map(q).join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'challenge_scores.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

initFeedback({ api, esc, run, toast, fmtSydney, sydneyToEpoch });
