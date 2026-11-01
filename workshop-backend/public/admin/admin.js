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

function showLogin() { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); $('logout').classList.add('hidden'); clearInterval(timer); clearInterval(poll); mon = null; }
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
  const blob = new Blob(['label,code\n' + issued.map((c) => `"${c.label.replace(/"/g, '""')}",${c.code}`).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'workshop-codes.csv'; a.click(); URL.revokeObjectURL(a.href);
});
boot();
