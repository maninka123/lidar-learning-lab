import { Btn } from '../../ui/controls';
import { Play } from '../../ui/icons';

/** What the last test measured against each requirement (undefined = not tested yet, or out of date). */
export interface CoverageReadout { coverage?: { value: number; target: number }; density: { zone: string; value?: number; target: number; /** the colour of this area's box in the 3D view */ color?: string }[] }

/** What each LiDAR does for each critical area, from the last measured test. */
export interface LidarBreakdown {
  areas: { id: string; name: string; color: string }[];
  rows: { label: string; sub: string; color: string; cells: Record<string, { coverage: number; density: number }> }[];
  total: Record<string, { coverage: number; density: number }>;
}

interface MissionCheckProps {
  target: string;
  /** the two requirements of the first mission, shown side by side */
  readout?: CoverageReadout;
  /** the per-LiDAR detail shown under the two panels (undefined until a test has been run) */
  breakdown?: LidarBreakdown;
  /** the first mission's check: coverage and density */
  coverage?: boolean;
  busy: boolean;
  disabled: boolean;
  disabledReason?: string;
  onEvaluate: () => void;
  /** the first mission recalculates by itself: show that, and keep only a small Recalculate button */
  auto?: boolean; calculating?: boolean; fresh?: boolean;
}

const mark = (value: number | undefined, target: number) => (value === undefined ? '' : value >= target ? ' ok' : ' short');
const num = (v: number | undefined, unit = '') => (v === undefined ? '—' : `${Math.round(v)}${unit}`);

export function MissionCheck({ target, readout, breakdown, coverage, busy, disabled, disabledReason, onEvaluate, auto, calculating, fresh }: MissionCheckProps) {
  return (
    <section className="mission-check" aria-label={coverage ? 'Coverage check' : 'Mission check'}>
      <div className="mission-check-heading">
        <h3>{coverage ? 'Coverage check' : 'Mission check'}</h3>
      </div>
      {readout
        ? <div className="mission-reqs" data-testid="mission-requirements">
            <div className={`mission-req${mark(readout.coverage?.value, readout.coverage?.target ?? 70)}`} data-testid="req-coverage">
              <span className="mission-req-name">Coverage</span>
              <strong>{num(readout.coverage?.value, ' %')}</strong>
              <small>of the critical areas, needs ≥ {readout.coverage?.target ?? 70} %</small>
            </div>
            <div className="mission-req" data-testid="req-density">
              <span className="mission-req-name">Point density <small>pts/m²</small></span>
              <ul>{readout.density.map((d) => <li key={d.zone} className={mark(d.value, d.target).trim()}><span><i className="req-dot" style={{ background: d.color }} />{d.zone}</span><b>{num(d.value)}</b><small>≥ {d.target}</small></li>)}</ul>
            </div>
          </div>
        : <p className="mission-check-target" data-testid="mission-targets">{target.replace(/^Pass:\s*/, '')}</p>}
      {readout && <details className="mission-detail" data-testid="mission-breakdown">
        <summary>Each LiDAR, area by area</summary>
        {breakdown
          ? <>
              <table className="mission-detail-table">
                <thead><tr><th />{breakdown.areas.map((a) => <th key={a.id}><i className="req-dot" style={{ background: a.color }} />{a.name}</th>)}</tr></thead>
                <tbody>
                  {breakdown.rows.map((r) => <tr key={r.label}>
                    <th scope="row"><i className="req-dot" style={{ background: r.color }} />{r.label}<small>{r.sub}</small></th>
                    {breakdown.areas.map((a) => <td key={a.id}><b>{Math.round(100 * (r.cells[a.id]?.coverage ?? 0))} %</b><small>{Math.round(r.cells[a.id]?.density ?? 0)} pts/m²</small></td>)}
                  </tr>)}
                  <tr className="mission-detail-total"><th scope="row">All together</th>{breakdown.areas.map((a) => <td key={a.id}><b>{Math.round(100 * (breakdown.total[a.id]?.coverage ?? 0))} %</b><small>{Math.round(breakdown.total[a.id]?.density ?? 0)} pts/m²</small></td>)}</tr>
                </tbody>
              </table>
              <p className="mission-check-help">Big number: how much of the area this LiDAR sees. Small number: the points per m² it adds there. Together can be less than the sum, because LiDARs overlap.</p>
            </>
          : <p className="mission-check-help">Run the test to see what each LiDAR contributes to each area.</p>}
      </details>}
      {auto
        ? <div className={`mission-auto${calculating ? ' working' : ''}`} role="status" aria-live="polite" data-testid="mission-auto-status">
            <span className="mission-auto-text">{calculating ? <><i className="mission-spinner" aria-hidden="true" />Calculating coverage and density…</> : disabled && disabledReason ? disabledReason : fresh ? '✓ Up to date. It recalculates as you change things.' : 'Waiting for your changes…'}</span>
            <Btn sm onClick={onEvaluate} disabled={disabled || calculating} busy={busy} testId="mission-evaluate" title="Recalculate now">Recalculate</Btn>
          </div>
        : <>      <Btn variant="primary" icon={<Play size={14} />} onClick={onEvaluate} busy={busy} disabled={disabled} testId="mission-evaluate">
        {coverage ? 'Test coverage and density' : 'Evaluate mission'}
      </Btn>
          {disabled && !busy && disabledReason && <p className="mission-check-help">{disabledReason}</p>}
        </>}
    </section>
  );
}
