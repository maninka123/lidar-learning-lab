import { TASK_NAMES, type TaskKey } from '../catalogue';
import type { Grade } from '../grade';

const MEANING: Record<TaskKey, string> = {
  completion: 'You finished every mission. This is the largest part, so everyone who reaches the end scores well.',
  twin: 'How much of the factory your LiDARs measured, and how close the points are to the real surfaces.',
  detect: 'How many of the objects in the factory you found.',
  colour: 'Whether the camera read the right colour on each label.',
  change: 'Whether you found what moved, appeared or disappeared between Time A and Time B.',
  quality: 'How much noise you removed while keeping the real points.',
  safety: 'Whether the safety zones that were affected were flagged.',
  budget: 'A reward for doing it with less money and less scanning. It is scaled by how well everything else went.',
};
const COLOUR: Record<TaskKey, string> = { completion: '#30d158', twin: '#3b82f6', detect: '#8b5cf6', colour: '#ec4899', change: '#f59e0b', quality: '#14b8a6', safety: '#ef4444', budget: '#64748b' };

/** The final score as a sum of parts: one bar of all the points, then each part with what it measures, how well it went and how many points it gave. */
export function ScoreBreakdown({ grade }: { grade: Grade }) {
  const on = grade.perTask.filter((t) => t.enabled);
  return <div className="score-breakdown" data-testid="score-breakdown">
    <div className="score-stack" role="img" aria-label="Points from each part of the score">{on.map((t) => <i key={t.key} title={`${TASK_NAMES[t.key]}: ${t.points.toFixed(1)} points`} style={{ width: `${t.points}%`, background: COLOUR[t.key] }} />)}<i className="rest" style={{ width: `${Math.max(0, 100 - grade.total)}%` }} /></div>
    <p className="score-how">How the score is made: each part is scored 0–100%, then counted by its weight. The points add up to the total.</p>
    <ul className="score-rows">{on.map((t) => <li key={t.key}>
      <div className="score-row-head"><span className="dot" style={{ background: COLOUR[t.key] }} /><b>{TASK_NAMES[t.key]}</b><em>{t.points.toFixed(1)} <small>/ {((100 * t.weight) / on.reduce((a, x) => a + x.weight, 0)).toFixed(0)}</small></em></div>
      <div className="score-bar"><i style={{ width: `${Math.round(t.score * 100)}%`, background: COLOUR[t.key] }} /></div>
      <small>{Math.round(t.score * 100)}% · {MEANING[t.key]}</small>
    </li>)}</ul>
  </div>;
}
