import type { TwinSave } from './store';
import type { RunResult, FinalResult } from './runner';
import { MISSIONS } from './missions';
import { lidarItem, cameraItem } from './catalogue';
import { reportMarkdown } from './feedback';
export function engineeringReport(save: TwinSave, practice: RunResult | null, final: FinalResult | null): string {
  const cost = final?.cost.total ?? practice?.cost.total ?? 0;
  const lines = [reportMarkdown(save.team, save.members, practice, final?.grade ?? null, cost, save.settings.budget), '', '## Engineering mission record', '', '| Mission | Current status | Score | Attempts |', '|---|---|---:|---:|', ...MISSIONS.map((m, i) => { const r = save.progress.results[i]; return `| ${i + 1}. ${m.title} | ${r?.stale ? 'Requires revalidation' : r?.level ?? 'Not attempted'} | ${r?.score.toFixed(1) ?? '—'} | ${save.progress.attempts[i]} |`; }), '', '## Installed equipment', ''];
  for (const l of save.design.lidars) lines.push(`- ${lidarItem(l.item).name}; ${l.res}; position (${l.x.toFixed(2)}, ${l.y.toFixed(2)}, ${l.z.toFixed(2)}) m; yaw ${l.yaw.toFixed(3)}, pitch ${l.pitch.toFixed(3)} rad.`);
  for (const c of save.design.cameras) lines.push(`- ${cameraItem(c.item).name}; position (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)}) m; calibrated against ${c.pairedLidarId === 'all' ? 'the combined point cloud (all LiDARs)' : c.pairedLidarId === null ? 'no scanner (not connected)' : c.pairedLidarId ?? 'the nearest scanner (legacy/default)'}; calibration ${c.cal.done ? 'saved' : 'not marked saved'}.`);
  for (const [i, r] of (final?.runs ?? []).entries()) {
    lines.push('', `## Final scenario ${i + 1} (seed ${r.seed})`, `Score: ${r.grade.total.toFixed(1)} / 100`, `Coverage: ${((r.coverage?.critical ?? 0) * 100).toFixed(1)}% critical; ${(r.tasks.twin.coverage * 100).toFixed(1)}% factory.`, `Registration RMSE: ${((r.registration?.rmse ?? NaN) * 100).toFixed(1)} cm.`, `Noise removed ${(r.tasks.quality.outlierRemoval * 100).toFixed(1)}%; valid monitoring-height points kept ${(r.tasks.quality.retention * 100).toFixed(1)}%; small-object points kept ${(r.tasks.quality.smallRetention * 100).toFixed(1)}%.`, `Objects found ${(r.tasks.detect.recall * 100).toFixed(1)}% (${r.tasks.detect.tp} of ${r.tasks.detect.refs}); camera marker error ${(r.calibration?.maxRms ?? NaN).toFixed(1)} px; ${r.found.changes.length} changes found; ${(r.found.safety ?? []).filter((z) => z.violated).length} safety zones affected.`);
    lines.push(`Critical inspection bay: ${((r.inspection?.calibratedCoverage ?? 0) * 100).toFixed(1)}% covered by a calibrated camera–LiDAR pair.`);
  }
  lines.push('', 'Client-side educational evaluation; grades are not tamper-proof. Exported configuration contains the complete equipment and pipeline settings.');
  return lines.join('\n');
}
