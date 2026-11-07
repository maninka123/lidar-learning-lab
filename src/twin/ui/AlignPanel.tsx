import type { ReactNode } from 'react';
import { Btn, Seg } from '../../ui/controls';
import { ALIGN_MAX_CM, ALIGN_MAX_DEG } from '../missions';

export interface AlignRow { k: number; name: string; before: { cm: number; deg: number }; after: { cm: number; deg: number }; overlap: number; accepted: boolean }

const withinTarget = (r: AlignRow) => r.accepted && r.after.cm <= ALIGN_MAX_CM && r.after.deg <= ALIGN_MAX_DEG && r.overlap >= .2;
const metric = (n: number, digits = 2) => Number.isFinite(n) ? n.toFixed(digits) : '—';

/** One active scan, an explicit review, then the next scan. The 3D view follows the selection. */
export function AlignPanel({ names, rows, active, preview, busy, hasSurvey, onSelect, onPreview, onAlign, onReset, onAcquire, settings }: {
  names: string[]; rows: AlignRow[]; active: number; preview: 'before' | 'after'; busy: boolean; hasSurvey: boolean;
  onSelect: (k: number) => void; onPreview: (value: 'before' | 'after') => void; onAlign: (k: number) => void;
  onReset: () => void; onAcquire: () => void; settings: ReactNode;
}) {
  if (!hasSurvey || names.length === 0) return <section className="align align-empty" data-testid="align-panel"><h3>Start with a scan</h3><p className="hint">Record the measurements from your mounted LiDARs, then align them here.</p><Btn variant="primary" block onClick={onAcquire} disabled={busy} testId="align-go-acquire">Go to Acquire</Btn></section>;
  if (names.length < 2) return <section className="align align-empty" data-testid="align-panel"><h3>One scanner — no alignment needed</h3><p className="hint">There are no other scans to match. Evaluate the mission to check this scanner’s surface accuracy.</p></section>;
  const row = rows[active - 1], total = names.length - 1, all = rows.length === total;
  const mean = (f: (r: AlignRow) => number) => rows.reduce((sum, r) => sum + f(r), 0) / Math.max(1, rows.length);
  const cm = mean((r) => r.after.cm), deg = mean((r) => r.after.deg), overlap = mean((r) => r.overlap);
  const ok = all && rows.every((r) => r.accepted) && cm <= ALIGN_MAX_CM && deg <= ALIGN_MAX_DEG && overlap >= .2;
  return (
    <section className="align" aria-label="Align scans one at a time" data-testid="align-panel">
      <div className="align-heading"><h3>Align one scan at a time</h3><span>{rows.length} / {total} tested</span></div>
      <p className="hint">{names[0]} anchors the map. Match each next scan to the reference and the scans already aligned.</p>
      <div className="align-progress" role="progressbar" aria-label="Scans tested" aria-valuemin={0} aria-valuemax={total} aria-valuenow={rows.length}><span style={{ width: `${100 * rows.length / total}%` }} /></div>
      <div className="align-focus" data-testid={`align-row-${active}`} aria-busy={busy}>
        <div className="align-heading"><span className="align-step">Scan {active + 1} of {names.length}</span><span className="align-status">{row ? withinTarget(row) ? 'Within target' : 'Needs review' : 'Ready to align'}</span></div>
        <h4>{names[active]}</h4>
        <p className="align-colours"><span><i className="align-dot reference" /> Reference + earlier scans</span><span><i className="align-dot current" /> This scan</span></p>
        {row && <Seg<'before' | 'after'> label="Alignment preview" value={preview} onChange={onPreview} options={[{ value: 'before', label: 'Before alignment' }, { value: 'after', label: 'After alignment' }]} />}
        <Btn variant="primary" block onClick={() => onAlign(active)} busy={busy} testId={row ? `align-redo-${active}` : `align-scan-${active}`}>{row ? 'Align this scan again' : `Align scan ${active + 1}`}</Btn>
        <div className="align-navigation"><Btn sm disabled={busy || active <= 1} onClick={() => onSelect(active - 1)}>Previous scan</Btn>{active < total ? <Btn sm disabled={busy || !row} onClick={() => onSelect(active + 1)} testId="align-next">Next scan →</Btn> : <span className="hint">{row ? 'Last scan reviewed' : 'Last scan'}</span>}</div>
        {row && <div className="align-result" role="status" data-testid={`align-result-${active}`}>
          <div className="align-heading"><b>{withinTarget(row) ? 'Within the scan targets' : 'Check this alignment'}</b><span>Before → After</span></div>
          <dl>
            <div><dt>Position error <small>≤ {ALIGN_MAX_CM} cm</small></dt><dd>{metric(row.before.cm, 1)} → <b>{metric(row.after.cm)} cm</b></dd></div>
            <div><dt>Angle error <small>≤ {ALIGN_MAX_DEG}°</small></dt><dd>{metric(row.before.deg)} → <b>{metric(row.after.deg)}°</b></dd></div>
            <div><dt>Overlap <small>≥ 20%</small></dt><dd><b>{metric(row.overlap * 100, 0)}%</b></dd></div>
          </dl>
          {!withinTarget(row) && <p className="hint">{!row.accepted ? 'The correction was rejected. Check the starting position and match distance in Alignment settings.' : row.overlap < .2 ? 'Too few shared surfaces. Improve the sensors’ overlapping views in mission 1, then acquire again.' : 'Try point-to-plane, a finer thinning size, or more iterations in Alignment settings.'}</p>}
        </div>}
      </div>
      {all && <div className={`align-summary ${ok ? 'ok' : ''}`} role="status" data-testid="align-summary"><b>{ok ? 'Ready to evaluate' : 'All scans tested — review the result'}</b><p>Mean error: {metric(cm)} cm · {metric(deg)}° · {metric(overlap * 100, 0)}% overlap.</p><p className="hint">{ok ? 'Evaluate the mission below to check the complete map.' : 'Review a scan below or tune the settings and try again. The mission check evaluates the complete map.'}</p></div>}
      <details className="align-settings" data-testid="align-settings"><summary>Settings for {names[active]}</summary><p className="hint">Only for this scan. Scans already aligned keep theirs; the next scan starts from these.</p><fieldset disabled={busy}>{settings}</fieldset></details>
      <details className="align-history"><summary>Scan sequence · {names.length} scans</summary><div className="align-list"><div className="align-reference"><b>{names[0]}</b><span>Reference</span></div>{names.slice(1).map((name, i) => {
        const k = i + 1, result = rows[i];
        return <button type="button" key={k} aria-current={active === k ? 'step' : undefined} disabled={busy || k > rows.length + 1} onClick={() => onSelect(k)}><span>{name}</span><small>{result ? withinTarget(result) ? 'Within target' : 'Review' : k === rows.length + 1 ? 'Up next' : 'Waiting'}</small></button>;
      })}</div></details>
      {rows.length > 0 && <Btn sm disabled={busy} onClick={onReset} testId="align-reset">Restart alignment</Btn>}
    </section>
  );
}
