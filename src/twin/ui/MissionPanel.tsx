import { useState } from 'react';
import { Btn } from '../../ui/controls';
import { MISSIONS, currentPass, fmtMetric, type MissionProgress } from '../missions';

export function MissionMap({ progress, busy, onSelect }: { progress: MissionProgress; busy: boolean; onSelect: (i: number) => void }) {
  return <nav className="mission-map" aria-label="Engineering missions">{MISSIONS.map((m, i) => <button key={m.title} disabled={i > progress.unlocked || busy} aria-current={i === progress.current ? 'step' : undefined} title={`${i + 1}. ${m.title}${i > progress.unlocked ? ' — locked' : ''}`} onClick={() => onSelect(i)} data-testid={`twin-mission-${i + 1}`}><span>{i > progress.unlocked ? '🔒' : currentPass(progress.results[i]) ? '✓' : i + 1}</span><small>{m.title}</small></button>)}</nav>;
}
export function MissionBrief({ mission, progress, onContinue, onReference }: { mission: number; progress: MissionProgress; onContinue: () => void; onReference: () => void }) {
  const m = MISSIONS[mission], r = progress.results[mission];
  const [hints, setHints] = useState(0);
  return <section className="mission-brief" data-testid="mission-brief">
    <div className="mission-eyebrow">Engineering mission {mission + 1} / 7</div><h2>{m.title}</h2><p>{m.scenario}</p><p className="mission-objective"><b>Your objective</b> {m.objective}</p>
    {r && <div className={`mission-result ${r.stale ? 'stale' : r.level}`} role="status" data-testid="mission-result"><b>{r.stale ? 'Revalidation required' : r.level === 'needs-improvement' ? 'Needs improvement' : r.level === 'excellent' ? 'Excellent' : 'Mission passed'}</b>
      {r.metrics.map((v) => <div className="mission-metric" key={v.label}><span>{v.label}</span><strong>{fmtMetric(v.value, v.unit)}<small>target {v.lower ? '≤' : '≥'} {fmtMetric(v.target, v.unit)}</small></strong></div>)}
      {r.feedback.map((f) => <p key={f} className="hint">{f}</p>)}
      {currentPass(r) && mission < 6 && mission + 1 <= progress.unlocked && <Btn variant="good" onClick={onContinue} testId="mission-continue">Continue to Mission {mission + 2} →</Btn>}
    </div>}
    {currentPass(r) && mission < 6 && mission + 1 > progress.unlocked && <p className="hint">Revalidate earlier missions to unlock the next one.</p>}
    <div className="btn-row"><Btn sm onClick={() => setHints((v) => Math.min(3, v + 1))} disabled={hints === 3}>Hint {Math.min(3, hints + 1)}</Btn>{mission < 6 && <Btn sm onClick={onReference}>Review learning module ↗</Btn>}</div>
    {m.hints.slice(0, hints).map((h, i) => <p className="hint" key={h}><b>{i + 1}.</b> {h}</p>)}
  </section>;
}
