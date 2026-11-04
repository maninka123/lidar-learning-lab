import { currentPass, readyForFinal, type MissionProgress } from './missions';
import type { RunResult, FinalResult } from './runner';
import { TwinDesign, ChallengeSettings, lidarItem, cameraItem, RES_TIERS, TaskKey, TASK_KEYS } from './catalogue';
import { BLOCKS, Block } from './pipeline';
import type { AttemptSummary } from './store';
import { clientId } from '../apps/workshop';

/** What is sent to the instructor: who the student says they are, the score, and a short account of what they built.
 *  It contains numbers and names of equipment and blocks only: never point clouds, never the hidden reference. */
export interface SubmitForm { name: string; index: string; consent: boolean; team: string }
export interface SubmitContext { practice: RunResult | null; final: FinalResult | null; design: TwinDesign; pipeline: Block[]; settings: ChallengeSettings; attempts: AttemptSummary[]; startedAt: number; progress?: MissionProgress }

const pc = (v: number) => Math.round(v * 100) / 100;
export function buildSubmission(form: SubmitForm, c: SubmitContext, kind: 'practice' | 'final') {
  const grade = kind === 'final' ? c.final?.grade : c.practice?.grade, run = kind === 'final' ? c.final?.runs[0] : c.practice;
  if (!grade || !run || (kind === 'final' && c.progress && !readyForFinal(c.progress))) return null;
  const tasks: Record<string, number> = {}, points: Record<string, number> = {};
  for (const k of TASK_KEYS) { const t = grade.perTask.find((x) => x.key === (k as TaskKey)); tasks[k] = t?.score ?? 0; points[k] = t?.points ?? 0; }
  const T = run.tasks;
  const metrics: Record<string, string | number> = {
    'surface covered': pc(T.twin.coverage), 'objects found': `${T.detect.tp}/${T.detect.refs}`, 'precision': pc(T.detect.precision), 'recall': pc(T.detect.recall),
    'label colours right': `${T.colour.correct}/${T.colour.total}`, 'changes right': `${T.change.kindOk}/${T.change.truth}`, 'changes reported': T.change.found,
    ...(run.registration ? { 'registration RMSE (cm)': Math.round(run.registration.rmse * 1000) / 10, 'registration overlap': pc(run.registration.overlap) } : {}),
    'floating points removed': pc(T.quality.outlierRemoval), 'small-object points kept': pc(T.quality.smallRetention), 'zones judged right': pc(T.safety.accuracy),
  };
  return {
    name: form.name, index: form.index, consent: form.consent, team: form.team, kind,
    ...(c.progress ? { missions: c.progress.results.map((r, i) => ({ number: i + 1, status: r?.stale ? 'stale' : r?.level ?? 'not-attempted', score: r?.score ?? 0, attempts: c.progress!.attempts[i] ?? 0, completed: currentPass(r) })) } : {}),
    total: grade.total, tasks, points, cost: run.cost.total, budget: c.settings.budget,
    attempts: { practice: c.attempts.filter((a) => a.kind === 'practice').length, final: c.attempts.filter((a) => a.kind === 'final').length }, startedAt: c.startedAt,
    equipment: { lidars: c.design.lidars.map((u) => `${lidarItem(u.item).name} · ${RES_TIERS[u.res].label.split(' ')[0].toLowerCase()}`), cameras: c.design.cameras.map((u) => cameraItem(u.item).name + (u.kit ? ' + low-light kit' : '') + (u.cal.done ? ' (calibrated)' : ' (not calibrated)')), lights: c.design.lights.length, platform: c.design.platform },
    pipeline: c.pipeline.filter((b) => !b.bypass).map((b) => BLOCKS[b.kind].name),
    device: clientId(), // a random id this browser keeps, so one computer sending under several names can be seen
    metrics, client: { tz: (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })(), lang: typeof navigator !== 'undefined' ? navigator.language : '' },
  };
}
export const validIndex = (s: string) => /^[A-Za-z0-9._\/\- ]{3,24}$/.test(s.trim());
