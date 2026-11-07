import { useState } from 'react';
import { Btn } from '../../ui/controls';
import { MISSIONS, currentPass, currentMissionMetrics, fmtMetric, type MissionProgress } from '../missions';

// Keep saved feedback concise too, without requiring another survey.
const compactFeedback = (text: string) => text
  .replace(/^Whole-factory measured coverage: /, 'Factory coverage: ')
  .replace(/%; multi-sensor overlap: (\d+)%; (\d+) measured points per observed square metre\./, '% · overlap: $1% · $2 pts/m².')
  .replace(/^Unobserved critical surface: (\d+)%\..*$/, 'Blind spots: $1%. Move scanners to cover red areas.');

export function MissionMap({ progress, busy, onSelect }: { progress: MissionProgress; busy: boolean; onSelect: (i: number) => void }) {
  return <nav className="mission-map" aria-label="Engineering missions">{MISSIONS.map((m, i) => <button key={m.title} disabled={i > progress.unlocked || busy} aria-current={i === progress.current ? 'step' : undefined} title={`${i + 1}. ${m.title}${i > progress.unlocked ? ' — locked' : ''}`} onClick={() => onSelect(i)} data-testid={`twin-mission-${i + 1}`}><span>{i > progress.unlocked ? '🔒' : currentPass(progress.results[i]) ? '✓' : i + 1}</span><small>{m.title}</small></button>)}</nav>;
}
export function MissionBrief({ mission, progress, cost, budget, hasLidar, finalDone = true, onContinue, onReference }: { mission: number; progress: MissionProgress; cost: number; budget: number; hasLidar: boolean; /** the last task has a result only once the final evaluation has been run in this session */ finalDone?: boolean; onContinue: () => void; onReference: () => void }) {
  const m = MISSIONS[mission], r = hasLidar && (mission < 6 || finalDone) ? progress.results[mission] : null;
  const [hints, setHints] = useState(0);
  return <section className="mission-brief" data-testid="mission-brief">
    <div className="mission-eyebrow">Engineering mission {mission + 1} / 7</div><h2>{m.title}</h2><p>{m.scenario}</p><p className="mission-objective"><b>Your objective</b> {m.objective}</p>
    {!hasLidar && <p className="hint" data-testid="mission-not-tested">Not tested. Add a LiDAR to begin.</p>}
    {r && mission === 5 && currentPass(r) && mission + 1 <= progress.unlocked && <Btn variant="good" onClick={onContinue} testId="mission-continue">Continue to Mission {mission + 2} →</Btn>}
    {r && mission !== 5 && <div className={`mission-result ${r.stale ? 'stale' : r.level}`} role="status" data-testid="mission-result"><b>{r.stale ? 'Revalidation required' : mission === 6 ? (r.level === 'needs-improvement' ? 'Not commissioned yet' : 'Commissioned') : r.level === 'needs-improvement' ? 'Needs improvement' : r.level === 'excellent' ? 'Excellent' : 'Mission passed'}</b>
      {mission < 6 && currentMissionMetrics(r, cost, budget).filter((v) => v.unit !== 'credits').map((v) => <div className="mission-metric" key={v.label}><span>{v.label}</span><strong>{fmtMetric(v.value, v.unit)}<small>{v.info ? 'for information' : `target ${v.lower ? '≤' : '≥'} ${fmtMetric(v.target, v.unit)}`}</small></strong></div>)}
      {r.stale && <p className="hint">Rerun to update results.</p>}
      {mission < 6 && r.feedback.filter((f) => !/^Too few points in the /.test(f)).map((f) => <p key={f} className="hint">{compactFeedback(f)}</p>)}
      {currentPass(r) && mission < 6 && mission + 1 <= progress.unlocked && <Btn variant="good" onClick={onContinue} testId="mission-continue">Continue to Mission {mission + 2} →</Btn>}
    </div>}
    {currentPass(r) && mission < 6 && mission + 1 > progress.unlocked && <p className="hint">Revalidate earlier missions to unlock the next one.</p>}
    <div className="btn-row"><Btn sm onClick={() => setHints((v) => Math.min(3, v + 1))} disabled={hints === 3}>Hint {Math.min(3, hints + 1)}</Btn>{mission < 6 && <Btn sm onClick={onReference}>Review learning module ↗</Btn>}</div>
    {m.hints.slice(0, hints).map((h, i) => <p className="hint" key={h}><b>{i + 1}.</b> {h}</p>)}
  </section>;
}
