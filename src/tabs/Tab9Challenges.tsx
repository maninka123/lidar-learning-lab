import { useLab } from '../state/store';
import { TopBar } from '../ui/shared';
import { Btn, Callout } from '../ui/controls';
import { Check, Circle, Download } from '../ui/icons';
import { CHALLENGES, summary } from '../exercises/defs';
import { makePdf } from '../exercises/pdf';
import { downloadBlob } from '../io/load';

const AGENDA: [string, string][] = [
  ['0–8 min', 'Fundamentals: sensor presets, FOV, resolution (Challenge 1)'],
  ['8–16 min', 'Point cloud explorer: intensity vs RGB, measuring, export (Challenges 2–3)'],
  ['16–26 min', 'TLS vs MLS and SLAM / registration (Challenges 4–5)'],
  ['26–38 min', 'Processing, clustering and segmentation (Challenges 6–7)'],
  ['38–50 min', 'Image-to-3D comparison and scene graphs (Challenges 8–9)'],
  ['50–60 min', 'Wrap-up: download your summary, discuss limitations'],
];

export default function Tab9() {
  const s = useLab();
  const results = CHALLENGES.map((c) => ({ c, r: c.check(s) }));
  const done = results.filter((x) => x.r.done).length;

  const downloadJson = () => downloadBlob(new Blob([JSON.stringify(summary(s), null, 2)], { type: 'application/json' }), 'lidar-lab-summary.json');
  const downloadPdf = () => {
    const sm = summary(s);
    const lines = [`Generated: ${sm.generated}`, `Scene: ${sm.scene}`, `Completed: ${done} of ${CHALLENGES.length}`, '', ...sm.challenges.flatMap((c) => [`${c.done ? '[x]' : '[ ]'} Challenge ${c.id}: ${c.title}`, `      ${c.detail}`, ''])];
    downloadBlob(makePdf('LiDAR Learning Lab - exercise summary', lines), 'lidar-lab-summary.pdf');
  };

  return (
    <>
      <TopBar title="Challenges & Workshop Exercises" />
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem 3rem' }} data-testid="challenges-page">
        <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gap: '1.1rem' }}>
          <div className="glass card" style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h2 style={{ flex: 1 }}>{done} of {CHALLENGES.length} challenges complete</h2>
              <Btn icon={<Download size={16} />} onClick={downloadJson} testId="download-json">Summary (JSON)</Btn>
              <Btn icon={<Download size={16} />} onClick={downloadPdf} testId="download-pdf">Summary (PDF)</Btn>
            </div>
            <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={CHALLENGES.length}><i style={{ width: `${(done / CHALLENGES.length) * 100}%` }} /></div>
            <p className="hint">Results are checked automatically from what you actually did in the lab (point counts, exports, ICP error, cleaning quality, segmentation matches…). Nothing is sent anywhere.</p>
          </div>
          {results.map(({ c, r }) => (
            <div key={c.id} className="glass card" style={{ display: 'grid', gap: 8 }} data-testid={`challenge-${c.id}`}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {r.done ? <Check size={22} color="var(--green)" /> : <Circle size={22} color="var(--text3)" />}
                <h3 style={{ flex: 1 }}>Challenge {c.id} · {c.title}</h3>
                <Btn sm onClick={() => s.setTab(c.tab)}>Open tab {c.tab + 1}</Btn>
              </div>
              <p>{c.goal}</p>
              <div className={`callout ${r.done ? 'good' : ''}`}><b>{r.done ? 'Complete' : 'Not yet'}</b>{r.detail}</div>
              <details><summary style={{ cursor: 'pointer', color: 'var(--text2)' }}>Steps and learning outcome</summary>
                <ol style={{ paddingLeft: '1.2rem' }}>{c.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
                <Callout kind="edu" title="Outcome">{c.outcome}</Callout>
              </details>
            </div>
          ))}
          <div className="glass card">
            <h3 style={{ marginBottom: 8 }}>Suggested 60-minute flow</h3>
            <table className="table"><tbody>{AGENDA.map(([t, d]) => <tr key={t}><td style={{ whiteSpace: 'nowrap', width: 110 }}><b>{t}</b></td><td>{d}</td></tr>)}</tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}
