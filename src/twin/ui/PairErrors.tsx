import { ALIGN_MAX_CM, ALIGN_MAX_DEG } from '../missions';

export interface PairRow { name: string; cm: number; deg: number; overlap: number; accepted: boolean }

const ok = (r: PairRow) => r.accepted && r.cm <= ALIGN_MAX_CM && r.deg <= ALIGN_MAX_DEG && r.overlap >= 0.2;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');

/** After the evaluation: how far each scan is from where it really is, so the pair that goes wrong is easy to find,
 *  and how the average the mission is judged on builds up as the scans are added one after another. */
export function PairErrors({ reference, rows }: { reference: string; rows: PairRow[] }) {
  if (!rows.length) return null;
  const top = Math.max(ALIGN_MAX_CM * 2.2, ...rows.map((r) => (Number.isFinite(r.cm) ? r.cm : 0)) , 0) * 1.08;
  const worst = rows.reduce((w, r, i) => { const s = Math.max(r.cm / ALIGN_MAX_CM, r.deg / ALIGN_MAX_DEG) + (r.accepted && r.overlap >= 0.2 ? 0 : 5); return s > w.s ? { s, i } : w; }, { s: -1, i: -1 });
  const bad = rows.some((r) => !ok(r));
  let sum = 0;
  const running = rows.map((r, i) => { sum += r.cm; return { name: r.name, mean: sum / (i + 1) }; });
  return (
    <section className="pair-errors" aria-label="Error of each scan" data-testid="pair-errors">
      <div className="pair-head"><h3>Where the error comes from</h3><span>Each scan against {reference}</span></div>
      <ul className="pair-list">
        {rows.map((r, i) => {
          const good = ok(r);
          return (
            <li key={r.name} className={good ? 'good' : 'bad'} data-testid={`pair-row-${i + 1}`}>
              <span className="pair-name">{r.name}{!good && i === worst.i && <b className="pair-fix">Fix first</b>}</span>
              <span className="pair-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, (100 * (Number.isFinite(r.cm) ? r.cm : top)) / top)}%` }} /><u style={{ left: `${(100 * ALIGN_MAX_CM) / top}%` }} /></span>
              <span className="pair-nums"><b>{f(r.cm)} cm</b> · {f(r.deg)}°</span>
              <span className="pair-marks">
                <em className={r.cm <= ALIGN_MAX_CM ? 'ok' : 'no'} title={`Position, needs ≤ ${ALIGN_MAX_CM} cm`}>{r.cm <= ALIGN_MAX_CM ? '✓' : '✗'} position</em>
                <em className={r.deg <= ALIGN_MAX_DEG ? 'ok' : 'no'} title={`Angle, needs ≤ ${ALIGN_MAX_DEG}°`}>{r.deg <= ALIGN_MAX_DEG ? '✓' : '✗'} angle</em>
                <em className={r.overlap >= 0.2 && r.accepted ? 'ok' : 'no'} title="Needs at least 20% overlap and an accepted correction">{r.overlap >= 0.2 && r.accepted ? '✓' : '✗'} overlap {Math.round(r.overlap * 100)}%</em>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="pair-running" data-testid="pair-running">
        <span className="pair-running-title">The average the mission uses, as scans are added</span>
        <ol>{running.map((r, i) => <li key={r.name} className={r.mean <= ALIGN_MAX_CM ? 'ok' : 'no'}><small>+ {r.name}</small><b>{f(r.mean)} cm</b>{i === running.length - 1 && <span> final</span>}</li>)}</ol>
      </div>
      <p className="pair-note">{bad ? 'The bar is the scan\'s position error and the line marks the 2 cm limit. Align the flagged scan again, in Align scans, with its own settings.' : 'Every scan is within the limits.'}</p>
    </section>
  );
}
