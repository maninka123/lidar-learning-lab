import type { RunResult } from './runner';
import { TASK_NAMES, TaskKey } from './catalogue';

/** Plain-language feedback taken from the measured numbers of a run. Nothing here is generic: every sentence quotes what happened. */
const pct = (v: number) => `${Math.round(v * 100)} %`;
export function feedbackFor(r: RunResult): Record<TaskKey, string[]> {
  const T = r.tasks, out: Record<TaskKey, string[]> = { twin: [], detect: [], colour: [], change: [], quality: [], safety: [], budget: [] };
  const tw = T.twin; out.twin.push(`${pct(tw.coverage)} of the surface below 3 m is covered by your cloud (target 92 %). Median distance to the true surface: ${(tw.medianErr * 100).toFixed(1)} cm.`);
  if (r.registration) out.twin.push(`Registration: scans meet to ${(r.registration.rmse * 100).toFixed(1)} cm RMSE with ${pct(r.registration.overlap)} overlap${r.registration.rmse > 0.05 ? '. Try a smaller match distance or more iterations.' : '.'}`);
  if (Number.isFinite(tw.poseErrCm)) out.twin.push(`Scans agree with each other to ${tw.poseErrCm.toFixed(1)} cm and ${tw.poseErrDeg.toFixed(2)}°.`);
  if (tw.junk > 0.02) out.twin.push(`${pct(tw.junk)} of the points float more than 30 cm from any surface: filter them out.`);
  if (tw.coverage < 0.6) out.twin.push('Large areas are missing: add a scanner where the red dots are, or use a denser sensor.');
  const d = T.detect; out.detect.push(`Found ${d.tp} of ${d.refs} objects (recall ${pct(d.recall)}, precision ${pct(d.precision)}). Right class for ${pct(d.classAcc)} of those found.`);
  if (d.smallRecall < 0.5) out.detect.push(`Small objects: ${pct(d.smallRecall)} found. They need enough points on them: finer resolution, a closer scanner, and a small voxel size.`);
  const miss = Object.entries(d.byClass).filter(([, v]) => v.ref > 0 && v.found / v.ref < 0.4).map(([k]) => k); if (miss.length) out.detect.push(`Mostly missed or misnamed: ${miss.join(', ')}.`);
  if (d.preds > d.refs * 1.3) out.detect.push(`${d.preds} objects reported for ${d.refs} real ones: noise or split objects. Try a larger link distance or stronger filtering.`);
  const c = T.colour; out.colour.push(c.total ? `Read ${c.correct} of ${c.total} label colours correctly; ${c.unknown} had no reading.` : 'No colour-coded objects.');
  if (c.unknown > c.total / 2) out.colour.push('Most labels had no colour reading: they need a camera that sees them, a good calibration, enough LiDAR points on the label and enough light (the low-light zone is dark).');
  const ch = T.change; out.change.push(`Reported ${ch.found} changes for ${ch.truth} real ones: ${ch.kindOk} with the right kind and place (precision ${pct(ch.precision)}, recall ${pct(ch.recall)}).`);
  if (ch.fp > ch.truth) out.change.push('Many false changes: raise the change threshold, align the two surveys, or require more points per change.');
  const q = T.quality; out.quality.push(`Removed ${pct(q.outlierRemoval)} of the floating points, kept ${pct(q.retention)} of the real ones and ${pct(q.smallRetention)} of the points on small objects.`);
  if (q.smallRetention < 0.6) out.quality.push('Your filtering is wiping out small objects. A smaller voxel size or a gentler outlier filter keeps them.');
  const s = T.safety; out.safety.push(`${Math.round(s.accuracy * 100)} % of zones judged correctly; ${s.missed} violations missed, ${s.falseAlarms} false alarms; clearance error ${Number.isFinite(s.clearanceErr) ? (s.clearanceErr * 100).toFixed(0) + ' cm' : 'n/a'}. Educational check only.`);
  const g = r.grade.efficiency; out.budget.push(`Spent ${pct(g.used)} of the budget. Overall performance ${pct(g.perf)}. Spending less for the same performance scores higher.`);
  return out;
}

export function reportMarkdown(team: string, members: string[], r: RunResult | null, finalGrade: { total: number; perTask: { key: TaskKey; points: number; weight: number }[] } | null, costTotal: number, budget: number): string {
  const L = [`# Industrial Digital Twin Challenge: results`, '', `Team: ${team || '(no name)'}${members.length ? ` · ${members.join(', ')}` : ''}`, `Equipment cost: ${costTotal} of ${budget} credits`, ''];
  const tbl = (g: { total: number; perTask: { key: TaskKey; points: number; weight: number }[] }) => [`| Task | Points | Out of |`, `|---|---|---|`, ...g.perTask.map((t) => `| ${TASK_NAMES[t.key]} | ${t.points.toFixed(1)} | ${t.weight} |`), `| **Total** | **${g.total.toFixed(1)}** | 100 |`, ''];
  if (finalGrade) L.push('## Final evaluation', ...tbl(finalGrade));
  if (r) { L.push(`## Practice run (scenario ${r.seed})`, ...tbl(r.grade)); const fb = feedbackFor(r); for (const k of Object.keys(fb) as TaskKey[]) { L.push(`### ${TASK_NAMES[k]}`, ...fb[k].map((x) => `- ${x}`), ''); } }
  L.push('_Simulation only: sensor models are simplified. The safety check is educational, not a certified system._');
  return L.join('\n');
}
