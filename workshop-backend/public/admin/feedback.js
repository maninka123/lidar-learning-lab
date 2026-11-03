// Feedback & Insights: what students said on the Thank You page. Charts are plain HTML/SVG (the page allows no external scripts).
const $ = (id) => document.getElementById(id);
const TOPICS = ['LiDAR technology and 3D scanning', 'Point cloud processing, registration and mapping', 'LiDAR applications, sensor fusion and AI'];
const SHORT = ['LiDAR & 3D scanning', 'Processing & mapping', 'Applications & AI'];
const PAGE = 25;
let ctx, sum = null, list = { items: [], total: 0, page: 1, pages: 1 }, modules = [], picked = new Set(), shown = null;
const q = { page: 1, q: '', module: '', helpful: '', from: '', to: '', sort: 'new' };

const fx = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d));
const sgn = (v) => (v === null || v === undefined ? '—' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2));
const pc = (v) => `${Math.round(v)} %`;

// ---------- small chart pieces (HTML/SVG strings; every text value is escaped)
function groupedBars() {
  const W = 640, H = 250, L = 34, B = 44, T = 14, ph = H - B - T, pw = W - L - 8, gw = pw / 3, bw = Math.min(46, gw / 3.2), y = (v) => T + ph - (v / 5) * ph;
  const grid = [0, 1, 2, 3, 4, 5].map((v) => `<line x1="${L}" x2="${W - 8}" y1="${y(v)}" y2="${y(v)}" class="gridline"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="axis">${v}</text>`).join('');
  const bars = sum.topics.map((t, i) => {
    const cx = L + gw * i + gw / 2, vals = [[t.meanBefore, 'before', cx - bw - 3], [t.meanAfter, 'after', cx + 3]];
    return vals.map(([v, k, x]) => (v === null ? '' : `<rect x="${x}" y="${y(v)}" width="${bw}" height="${T + ph - y(v)}" rx="5" class="bar-${k}"><title>${k === 'before' ? 'Before' : 'After'}: ${v} / 5</title></rect><text x="${x + bw / 2}" y="${y(v) - 5}" text-anchor="middle" class="val">${fx(v)}</text>`)).join('')
      + `<text x="${cx}" y="${H - 22}" text-anchor="middle" class="axis">${ctx.esc(SHORT[i])}</text><text x="${cx}" y="${H - 8}" text-anchor="middle" class="axis faintsvg">n = ${t.n}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Average self-rated understanding before and after, for each of the three areas">${grid}${bars}</svg>`;
}
const hbar = (label, n, pct, max, cls = '') => `<div class="hb"><span class="hb-l" title="${ctx.esc(label)}">${ctx.esc(label)}</span><span class="hb-t"><i class="${cls}" style="width:${max ? Math.max(2, (n / max) * 100) : 0}%"></i></span><span class="hb-n">${n}${pct === null ? '' : ` · ${pc(pct)}`}</span></div>`;
const hist = (d, cls) => { const m = Math.max(1, ...d); return `<div class="hist">${d.map((n, i) => `<div title="${i + 1}: ${n} response${n === 1 ? '' : 's'}"><i class="${cls}" style="height:${Math.max(n ? 6 : 1, (n / m) * 100)}%"></i><b>${n || ''}</b><span>${i + 1}</span></div>`).join('')}</div>`; };
const stacked = (up, same, down) => `<div class="stk" title="Improved ${pc(up)} · No change ${pc(same)} · Decreased ${pc(down)}"><i class="up" style="width:${up}%"></i><i class="same" style="width:${same}%"></i><i class="down" style="width:${down}%"></i></div>`;

// ---------- the overview and analytics
function renderSummary() {
  const s = sum, empty = !s || s.total === 0;
  $('fbEmpty').classList.toggle('hidden', !empty); $('fbBody').classList.toggle('hidden', empty);
  const tile = (k, v, sub, cls = '') => `<div class="tile ${cls}"><span>${ctx.esc(k)}</span><b>${ctx.esc(v)}</b>${sub ? `<small>${ctx.esc(sub)}</small>` : ''}</div>`;
  $('fbTiles').innerHTML = !s ? '' : [
    tile('Responses', String(s.total), s.withText ? `${s.withText} with a comment` : 'none with a comment'),
    tile('Simulations helpful', empty ? '—' : `${fx(s.helpful.mean)} / 5`, `${s.helpful.n} response${s.helpful.n === 1 ? '' : 's'} · ${s.helpful.top2Pct}% rated 4 or 5`),
    tile('Before (average)', empty ? '—' : `${fx(s.overall.meanBefore)} / 5`, `${s.total} response${s.total === 1 ? '' : 's'}`),
    tile('After (average)', empty ? '—' : `${fx(s.overall.meanAfter)} / 5`, `${s.total} response${s.total === 1 ? '' : 's'}`),
    tile('Average change', empty ? '—' : `${sgn(s.overall.meanChange)} points`, 'self-reported improvement', 'accent'),
  ].join('');
  if (empty) return;
  $('fbChart').innerHTML = groupedBars();
  const o = s.overall;
  $('fbTable').innerHTML = [...s.topics.map((t, i) => ({ name: TOPICS[i], t })), { name: 'Overall (all three areas)', t: { n: s.total, meanBefore: o.meanBefore, meanAfter: o.meanAfter, meanChange: o.meanChange, improvedPct: o.improvedPct, samePct: o.samePct, decreasedPct: o.decreasedPct }, all: true }]
    .map(({ name, t, all }) => `<tr${all ? ' class="total"' : ''}><td>${ctx.esc(name)}</td><td class="num">${t.n}</td><td class="num">${fx(t.meanBefore, 2)}</td><td class="num">${fx(t.meanAfter, 2)}</td><td class="num"><b>${sgn(t.meanChange)}</b></td><td class="num">${t.improvedPct}%</td><td class="num">${t.samePct}%</td><td class="num">${t.decreasedPct}%</td><td style="min-width:110px">${stacked(t.improvedPct, t.samePct, t.decreasedPct)}</td></tr>`).join('');
  $('fbDist').innerHTML = s.topics.map((t, i) => `<div class="dist"><b>${ctx.esc(TOPICS[i])}</b><div class="pairhist"><div><small>Before</small>${hist(t.distBefore, 'bar-before')}</div><div><small>After</small>${hist(t.distAfter, 'bar-after')}</div></div></div>`).join('');
  $('fbHelp').innerHTML = `<div class="row" style="gap:18px"><div class="tile" style="min-width:150px"><span>Average</span><b>${fx(s.helpful.mean)} / 5</b><small>${s.helpful.n} responses</small></div><div class="tile" style="min-width:150px"><span>Rated 4 or 5</span><b>${s.helpful.top2Pct}%</b></div></div>${hist(s.helpful.dist, 'bar-after')}`;
  const mx = Math.max(1, ...s.modules.map((m) => m.count));
  $('fbModules').innerHTML = s.modules.map((m) => hbar(m.label, m.count, m.pct, mx, m.retired ? 'retired' : '')).join('');
  const dm = Math.max(1, ...s.trend.map((d) => d.count));
  $('fbTrend').innerHTML = `<div class="trend">${s.trend.slice(-30).map((d) => `<div title="${ctx.esc(d.day)}: ${d.count}"><i style="height:${Math.max(6, (d.count / dm) * 100)}%"></i><b>${d.count}</b><span>${ctx.esc(d.day.slice(5))}</span></div>`).join('')}</div>`;
  $('fbChange').innerHTML = `${stacked(o.improvedPct, o.samePct, o.decreasedPct)}<div class="legend"><span><i class="up"></i>Improved ${o.improved} (${o.improvedPct}%)</span><span><i class="same"></i>No change ${o.same} (${o.samePct}%)</span><span><i class="down"></i>Decreased ${o.decreased} (${o.decreasedPct}%)</span></div>`;
  $('fbWords').innerHTML = s.keywords.length ? s.keywords.map((k) => `<span class="chip">${ctx.esc(k.word)} <b>${k.count}</b></span>`).join(' ') : '<span class="faint">Not enough comments yet (a word needs to appear in at least two).</span>';
  $('fbNote').textContent = s.note;
}

// ---------- the records
const filterQuery = () => {
  const o = new URLSearchParams(); for (const k of ['q', 'module', 'helpful', 'sort']) if (q[k]) o.set(k, q[k]);
  if (q.from) o.set('from', String(ctx.sydneyToEpoch(q.from + 'T00:00'))); if (q.to) o.set('to', String(ctx.sydneyToEpoch(q.to + 'T23:59') + 59999));
  return o;
};
const qs = () => { const o = filterQuery(); o.set('page', String(q.page)); o.set('pageSize', String(PAGE)); return o.toString(); };
function renderList() {
  const { esc } = ctx, items = list.items;
  $('fbMod').innerHTML = '<option value="">All modules</option>' + modules.map((m) => `<option value="${esc(m.id)}"${q.module === m.id ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  $('fbRows').innerHTML = items.length ? items.map((r) => `<tr data-id="${esc(r.id)}"><td><input type="checkbox" data-pick="${esc(r.id)}" ${picked.has(r.id) ? 'checked' : ''} aria-label="Select this response"></td><td>${esc(ctx.fmtSydney(r.at))}</td><td class="num">${fx(r.avgBefore, 1)}</td><td class="num">${fx(r.avgAfter, 1)}</td><td class="num"><b>${sgn(r.change)}</b></td><td class="num">${r.helpful}</td><td>${esc(r.moduleLabel)}</td><td class="trunc">${r.text ? esc(r.text.length > 90 ? r.text.slice(0, 90) + '…' : r.text) : '<span class="faint">—</span>'}</td><td class="nowrap"><button class="btn sm" data-fbopen="${esc(r.id)}">View</button> <button class="btn sm danger" data-del="${esc(r.id)}" aria-label="Delete this response">Delete</button></td></tr>`).join('') : `<tr><td colspan="9" class="faint">${sum && sum.total ? 'No responses match these filters.' : 'No responses yet.'}</td></tr>`;
  $('fbPager').innerHTML = `<span class="faint">${list.total} response${list.total === 1 ? '' : 's'}${q.q || q.module || q.helpful || q.from || q.to ? ' match' : ''} · page ${list.page} of ${list.pages}</span><button class="btn sm" id="fbPrev" ${list.page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" id="fbNext" ${list.page >= list.pages ? 'disabled' : ''}>Next</button>`;
  $('fbBulk').classList.toggle('hidden', picked.size === 0); $('fbBulkN').textContent = `${picked.size} selected`;
  $('fbAll').checked = items.length > 0 && items.every((r) => picked.has(r.id));
  $('fbExportF').textContent = `Export filtered (${list.total})`;
}
export async function loadFeedback() {
  const [s, l] = await Promise.all([ctx.api('GET', 'feedback-summary'), ctx.api('GET', 'feedback?' + qs())]);
  sum = s; list = l; modules = l.modules || []; if (l.retention) $('fbRetention').textContent = l.retention;
  const keep = new Set(l.items.map((r) => r.id)); for (const id of [...picked]) if (!keep.has(id) && l.total === 0) picked.delete(id);
  renderSummary(); renderList();
}
const reloadList = async () => { list = await ctx.api('GET', 'feedback?' + qs()); modules = list.modules || modules; renderList(); };

// ---------- dialogs: one confirmation (optionally typed) and one detail view
function confirmBox({ title, body, ok, typed }) {
  return new Promise((resolve) => {
    const d = $('fbConfirm'); $('fbcTitle').textContent = title; $('fbcBody').innerHTML = body; const t = $('fbcType'); t.value = ''; t.classList.toggle('hidden', !typed); $('fbcTypeHelp').classList.toggle('hidden', !typed);
    const go = $('fbcOk'); go.textContent = ok; go.disabled = !!typed; let done = false;
    const finish = (v) => { if (done) return; done = true; go.onclick = null; $('fbcCancel').onclick = null; t.oninput = null; d.onclose = null; if (d.open) d.close(); resolve(v); };
    t.oninput = () => { go.disabled = t.value !== 'DELETE'; }; go.onclick = () => finish(true); $('fbcCancel').onclick = () => finish(false); d.onclose = () => finish(false);
    d.showModal();
  });
}
function openDetail(id) {
  const r = list.items.find((x) => x.id === id); if (!r) return; shown = id; const { esc } = ctx;
  $('fbdBody').innerHTML = `<div class="faint">Sent ${esc(ctx.fmtSydney(r.at))}${r.version ? ' · app ' + esc(r.version) : ''}</div>
    <table class="mini"><thead><tr><th>Area</th><th class="num">Before</th><th class="num">After</th><th class="num">Change</th></tr></thead><tbody>${TOPICS.map((t, i) => `<tr><td>${esc(t)}</td><td class="num">${r.before[i]}</td><td class="num">${r.after[i]}</td><td class="num"><b>${r.changes[i] > 0 ? '+' : r.changes[i] < 0 ? '−' : ''}${Math.abs(r.changes[i])}</b></td></tr>`).join('')}</tbody></table>
    <div class="row" style="gap:16px"><span><b>Simulations helpful:</b> ${r.helpful} / 5</span><span><b>Most useful:</b> ${esc(r.moduleLabel)}</span></div>
    <div><b>Suggestions</b><div class="quote">${r.text ? esc(r.text) : '<span class="faint">None given.</span>'}</div></div>`;
  $('fbDetail').showModal();
}
async function deleteIds(ids, what) {
  const ok = await confirmBox({ title: ids.length === 1 ? 'Delete this response?' : `Delete ${ids.length} responses?`, body: what, ok: ids.length === 1 ? 'Delete response' : `Delete ${ids.length} responses` });
  if (!ok) return;
  await ctx.api('POST', 'feedback-delete', { ids }); ids.forEach((i) => picked.delete(i)); ctx.toast(ids.length === 1 ? 'Response deleted.' : `${ids.length} responses deleted.`); if ($('fbDetail').open) $('fbDetail').close();
  if (list.items.length === ids.length && q.page > 1) q.page -= 1; await loadFeedback();
}
function download(name, text) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

export function initFeedback(c) {
  ctx = c;
  const filt = () => { q.q = $('fbSearch').value.trim(); q.module = $('fbMod').value; q.helpful = $('fbHelpF').value; q.from = $('fbFrom').value; q.to = $('fbTo').value; q.sort = $('fbSort').value; q.page = 1; c.run(reloadList); };
  let t = 0; $('fbSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(filt, 250); });
  ['fbMod', 'fbHelpF', 'fbFrom', 'fbTo', 'fbSort'].forEach((id) => $(id).addEventListener('change', filt));
  $('fbReset').addEventListener('click', () => { for (const id of ['fbSearch', 'fbMod', 'fbHelpF', 'fbFrom', 'fbTo']) $(id).value = ''; $('fbSort').value = 'new'; filt(); });
  $('fbRefresh').addEventListener('click', () => c.run(loadFeedback));
  $('fbView').addEventListener('click', (e) => {
    const v = e.target.closest('[data-fbopen]'), d = e.target.closest('[data-del]'), p = e.target.closest('[data-pick]');
    if (v) openDetail(v.dataset.fbopen);
    if (d) { const r = list.items.find((x) => x.id === d.dataset.del); if (r) c.run(() => deleteIds([r.id], `<p>Sent <b>${c.esc(c.fmtSydney(r.at))}</b>, most useful: <b>${c.esc(r.moduleLabel)}</b>, simulations ${r.helpful}/5.</p><p class="faint">It is removed from the store, the charts and every future export. This cannot be undone.</p>`)); }
    if (p) { if (p.checked) picked.add(p.dataset.pick); else picked.delete(p.dataset.pick); renderList(); }
    if (e.target.id === 'fbPrev' && q.page > 1) { q.page -= 1; c.run(reloadList); }
    if (e.target.id === 'fbNext' && q.page < list.pages) { q.page += 1; c.run(reloadList); }
  });
  $('fbAll').addEventListener('change', (e) => { for (const r of list.items) { if (e.target.checked) picked.add(r.id); else picked.delete(r.id); } renderList(); });
  $('fbBulkClear').addEventListener('click', () => { picked.clear(); renderList(); });
  $('fbBulkDel').addEventListener('click', () => c.run(() => deleteIds([...picked], `<p>${picked.size} selected response${picked.size === 1 ? '' : 's'} will be deleted for good.</p><p class="faint">They are removed from the store, the charts and every future export.</p>`)));
  $('fbdDel').addEventListener('click', () => { if (shown) c.run(() => deleteIds([shown], '<p>Delete the response you are viewing?</p><p class="faint">This cannot be undone.</p>')); });
  $('fbdClose').addEventListener('click', () => $('fbDetail').close());
  $('fbExportF').addEventListener('click', () => c.run(async () => { const r = await c.api('GET', 'feedback-export?' + filterQuery().toString()); download('feedback_filtered.csv', r.csv); }));
  $('fbExportA').addEventListener('click', () => c.run(async () => { const r = await c.api('GET', 'feedback-export'); download('feedback_all.csv', r.csv); }));
  $('fbClearAll').addEventListener('click', () => c.run(async () => {
    if (!sum || !sum.total) { c.toast('There is nothing to delete.', true); return; }
    if (await confirmBox({ title: 'Delete ALL feedback?', body: `<p>This removes all <b>${sum.total}</b> responses for good.</p><p class="faint">Type DELETE to confirm.</p>`, ok: 'Delete everything', typed: true })) { await c.api('POST', 'feedback-clear', { confirm: 'DELETE' }); picked.clear(); c.toast('All feedback deleted.'); q.page = 1; await loadFeedback(); }
  }));
}
