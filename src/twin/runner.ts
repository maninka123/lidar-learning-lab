import { buildFactory, Target, ChangeTruth } from './factory';
import { acquireSurvey } from './acquire';
import { makeSampler, CalibratedCamera } from './camera';
import { runPipeline, Block, BLOCKS, StepInfo, DetObject, ChangeFound, SafetyFound } from './pipeline';
import { TwinDesign, ChallengeSettings, costOf, CostReport, HW_SEED, TASK_KEYS, TaskKey } from './catalogue';
import { scoreTwin, scoreDetection, scoreColour, scoreChange, scoreSafety, safetyTruth, scoreQuality, combine, Grade, TaskScores, TwinScore, DetectionScore, ColourScore, ChangeScore, SafetyScore, QualityScore, SafetyTruth } from './grade';
import { selectPoints, PointCloud } from '../core/pointcloud';

/** One complete evaluation of a team's system on one scenario: acquire → calibrate-and-colour → process → grade.
 *  It is a pure function of (design, pipeline, settings, seed), so the same input always gives the same grade. */

export interface RunConfig { design: TwinDesign; pipeline: Block[]; settings: ChallengeSettings }
export const PRACTICE_SEED = 11;
export const FINAL_SEEDS = [101, 202];

export interface RunResult {
  seed: number; ok: boolean; error?: string; cost: CostReport; grade: Grade;
  tasks: { twin: TwinScore; detect: DetectionScore; colour: ColourScore; change: ChangeScore; quality: QualityScore; safety: SafetyScore };
  steps: StepInfo[]; twinPreview?: PointCloud; objects: DetObject[]; refs: Target[]; found: { changes: ChangeFound[]; safety?: SafetyFound[] }; truth: { changes: ChangeTruth[]; safety: SafetyTruth[] };
  stats: { rays: number; raysA: number; points: number; acquireMs: number; pipelineMs: number };
}

const thin = (c: PointCloud | undefined, max: number): PointCloud | undefined => { if (!c) return c; if (c.count <= max) return c; const s = Math.ceil(c.count / max), ids: number[] = []; for (let i = 0; i < c.count; i += s) ids.push(i); return selectPoints(c, ids, c.name); };
export const needsSurveyB = (blocks: Block[]) => blocks.some((b) => !b.bypass && (BLOCKS[b.kind].needsB || b.kind === 'safety'));

export function runScenario(cfg: RunConfig, seed: number): RunResult {
  const cost = costOf(cfg.design, cfg.settings), fA = buildFactory(seed, 'A'), fB = buildFactory(seed, 'B');
  const zero = { twin: scoreTwin(undefined, fA, { truth: [] }), detect: scoreDetection(fA.targets, []), colour: scoreColour(fA.targets, [], { pairs: [], missed: [], spurious: [] }), change: scoreChange(fB.changes, []), quality: scoreQuality({ positions: new Float32Array(0), prov: new Int32Array(0), n: 0 }, { obj: new Int32Array(0), cls: new Int32Array(0), outlier: new Uint8Array(0) }, undefined, new Set()), safety: scoreSafety(safetyTruth(fB.targets), undefined) };
  const base: Omit<RunResult, 'ok' | 'error'> = { seed, cost, grade: combine({}, cfg.settings, cost.total, 0), tasks: zero, steps: [], objects: [], refs: fA.targets, found: { changes: [] }, truth: { changes: fB.changes, safety: safetyTruth(fB.targets) }, stats: { rays: 0, raysA: 0, points: 0, acquireMs: 0, pipelineMs: 0 } };
  if (!cost.ok) return { ...base, ok: false, error: cost.errors.join(' ') };

  const t0 = Date.now();
  const A = acquireSurvey(fA, cfg.design, seed), B = needsSurveyB(cfg.pipeline) ? acquireSurvey(fB, cfg.design, seed) : undefined;
  const cams: CalibratedCamera[] = cfg.design.cameras.map((c, i) => ({ unit: c, image: makeSampler(fA, c, HW_SEED, i, cfg.design.lights), e: c.cal.est, fov: c.cal.fov }));
  const t1 = Date.now();
  const out = runPipeline(cfg.pipeline, { A: A.visible, B: B?.visible, camerasA: cams }, seed);
  const t2 = Date.now();

  const smallIds = new Set(fA.targets.filter((t) => t.small).map((t) => t.instanceId));
  const rawN = A.visible.scans.reduce((a, s) => a + s.cloud.count, 0), pos = new Float32Array(rawN * 3), prov = new Int32Array(rawN);
  let o = 0; for (const s of A.visible.scans) { pos.set(s.cloud.positions, o * 3); prov.set(s.cloud.instances!, o); o += s.cloud.count; }

  const preds = out.A.objects ?? [];
  const detect = scoreDetection(fA.targets, preds), colour = scoreColour(fA.targets, preds, detect.match);
  const tasks = {
    twin: scoreTwin(out.A.twin, fA, { est: out.A.scanPoses, truth: A.hidden.truePoses }), detect, colour,
    change: scoreChange(fB.changes, out.changes ?? []), quality: scoreQuality({ positions: pos, prov, n: rawN }, A.hidden.truth, out.A.twin, smallIds), safety: scoreSafety(safetyTruth(fB.targets), out.safety),
  };
  const scores: TaskScores = { twin: tasks.twin.score, detect: detect.score, colour: colour.score, change: tasks.change.score, quality: tasks.quality.score, safety: tasks.safety.score };
  const grade = combine(scores, cfg.settings, cost.total, A.visible.stats.rays);
  return {
    ...base, ok: true, grade, tasks, steps: out.steps.map((s) => ({ ...s, preview: thin(s.preview, 20000) })), twinPreview: thin(out.A.twin, 40000),
    objects: preds.map((p) => ({ ...p, idx: new Int32Array(0) })), found: { changes: out.changes ?? [], safety: out.safety },
    stats: { rays: A.visible.stats.rays + (B?.visible.stats.rays ?? 0), raysA: A.visible.stats.rays, points: rawN, acquireMs: t1 - t0, pipelineMs: t2 - t1 },
  };
}

export interface FinalResult { runs: RunResult[]; grade: Grade; scores: TaskScores; cost: CostReport }
/** The final evaluation: the frozen configuration on separate deterministic scenario variants; task scores are averaged. */
export function runFinal(cfg: RunConfig, seeds: number[] = FINAL_SEEDS): FinalResult {
  const runs = seeds.map((s) => runScenario(cfg, s)), cost = runs[0].cost;
  const pick = (r: RunResult): TaskScores => ({ twin: r.tasks.twin.score, detect: r.tasks.detect.score, colour: r.tasks.colour.score, change: r.tasks.change.score, quality: r.tasks.quality.score, safety: r.tasks.safety.score });
  const scores: TaskScores = {}; for (const k of TASK_KEYS) if (k !== 'budget') scores[k as TaskKey] = runs.reduce((a, r) => a + (pick(r)[k as TaskKey] ?? 0), 0) / runs.length;
  const rays = runs.reduce((a, r) => a + r.stats.raysA, 0) / runs.length;
  return { runs, scores, cost, grade: combine(scores, cfg.settings, cost.total, rays) };
}
