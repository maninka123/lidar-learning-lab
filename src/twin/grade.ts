import { KDTree } from '../core/kdtree';
import type { PointCloud } from '../core/pointcloud';
import { sampleSurfaces } from '../scenes/surface';
import type { Vec3 } from '../core/math';
import { rotationAngle, rigidCompose, rigidInverse } from '../core/math';
import type { Rigid } from '../core/math';
import { Factory, Target, ChangeTruth, SAFETY_ZONES, TWIN_CLASSES, LabelColour, distToSurface } from './factory';
import type { DetObject, ChangeFound, SafetyFound } from './pipeline';
import type { Truth } from './acquire';
import { ChallengeSettings, TASK_KEYS, TaskKey } from './catalogue';

/** Deterministic grading against the hidden reference. Every task score is a bounded, explicit function of a measured quantity:
 *  `lin(x, bad, good)` is 0 at `bad`, 1 at `good`, linear in between. Nothing here looks at which tools were bought or which blocks were used. */

export const lin = (x: number, bad: number, good: number) => Math.min(1, Math.max(0, (x - bad) / (good - bad)));
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (tp: number, fp: number, fn: number) => { const p = tp + fp ? tp / (tp + fp) : 0, r = tp + fn ? tp / (tp + fn) : 0; return { p, r, f1: p + r ? (2 * p * r) / (p + r) : 0 }; };

// ----------------------------------------------------------------------------- one-to-one assignment
/** Hungarian algorithm (minimum cost, rows ≤ columns after transposing). Returns, for each row, the assigned column or -1. */
export function assign(cost: number[][]): number[] {
  const n0 = cost.length, m0 = n0 ? cost[0].length : 0;
  if (!n0 || !m0) return new Array(n0).fill(-1);
  const tr = n0 > m0, C = tr ? cost[0].map((_, j) => cost.map((r) => r[j])) : cost, n = C.length, m = C[0].length;
  const u = new Array(n + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0; const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
    do {
      used[j0] = true; const i0 = p[j0]; let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) { const cur = C[i0 - 1][j - 1] - u[i0] - v[j]; if (cur < minv[j]) { minv[j] = cur; way[j] = j0; } if (minv[j] < delta) { delta = minv[j]; j1 = j; } }
      for (let j = 0; j <= m; j++) if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const res = new Array(n0).fill(-1);
  if (!tr) for (let j = 1; j <= m; j++) { if (p[j]) res[p[j] - 1] = j - 1; }
  else { const colToRow = new Array(m).fill(-1); for (let j = 1; j <= m; j++) if (p[j]) colToRow[j - 1] = p[j] - 1; colToRow.forEach((row, col) => { if (row >= 0) res[col] = row; }); }
  return res;
}

// ----------------------------------------------------------------------------- objects
export const iou3 = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) => {
  let inter = 1; for (let k = 0; k < 3; k++) { const o = Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]); if (o <= 0) return 0; inter *= o; }
  const va = (a.max[0] - a.min[0]) * (a.max[1] - a.min[1]) * (a.max[2] - a.min[2]), vb = (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]);
  return inter / (va + vb - inter);
};
const dist3 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const MATCH_IOU = 0.2, SMALL_MATCH_DIST = 0.25;

export interface ObjMatch { ref: number; pred: number; iou: number; centreErr: number }
/** Match predicted objects to reference objects one-to-one. Big objects match by 3D IoU; small ones (a box of a few centimetres cannot overlap well) by centre distance. */
export function matchObjects(refs: Target[], preds: DetObject[]): { pairs: ObjMatch[]; missed: number[]; spurious: number[] } {
  const score = refs.map((r) => preds.map((p) => { const i = iou3(r, p), d = dist3(r.centre, p.centre); return r.small ? (d <= SMALL_MATCH_DIST ? Math.max(i, MATCH_IOU + 0.1 * (1 - d / SMALL_MATCH_DIST)) : 0) : i; }));
  const a = assign(score.map((row) => row.map((s) => 1 - s))), pairs: ObjMatch[] = [];
  a.forEach((j, i) => { if (j >= 0 && score[i][j] >= MATCH_IOU) pairs.push({ ref: i, pred: j, iou: iou3(refs[i], preds[j]), centreErr: dist3(refs[i].centre, preds[j].centre) }); });
  const mr = new Set(pairs.map((x) => x.ref)), mp = new Set(pairs.map((x) => x.pred));
  return { pairs, missed: refs.map((_, i) => i).filter((i) => !mr.has(i)), spurious: preds.map((_, i) => i).filter((i) => !mp.has(i)) };
}

export interface DetectionScore { score: number; precision: number; recall: number; f1: number; classAcc: number; correctRecall: number; meanIoU: number; medianCentreErr: number; smallRecall: number; refs: number; preds: number; tp: number; byClass: Record<string, { ref: number; found: number }>; match: ReturnType<typeof matchObjects> }
export function scoreDetection(refs: Target[], preds: DetObject[]): DetectionScore {
  const m = matchObjects(refs, preds), tp = m.pairs.length, fp = m.spurious.length, fn = m.missed.length, q = f1(tp, fp, fn);
  const right = m.pairs.filter((x) => preds[x.pred].cls === refs[x.ref].cls).length;
  const classAcc = tp ? right / tp : 0, correctRecall = refs.length ? right / refs.length : 0;
  const meanIoU = tp ? mean(m.pairs.map((x) => x.iou)) : 0, med = tp ? median(m.pairs.map((x) => x.centreErr)) : 1;
  const smalls = refs.map((r, i) => (r.small ? i : -1)).filter((i) => i >= 0), smallFound = m.pairs.filter((x) => refs[x.ref].small).length;
  const byClass: DetectionScore['byClass'] = {}; for (const c of TWIN_CLASSES) byClass[c] = { ref: 0, found: 0 };
  refs.forEach((r) => byClass[r.cls].ref++); m.pairs.forEach((x) => { if (preds[x.pred].cls === refs[x.ref].cls) byClass[refs[x.ref].cls].found++; });
  const score = 0.5 * q.f1 + 0.2 * correctRecall + 0.15 * lin(med, 0.4, 0.05) + 0.15 * lin(meanIoU, 0.1, 0.6);
  return { score, precision: q.p, recall: q.r, f1: q.f1, classAcc, correctRecall, meanIoU, medianCentreErr: med, smallRecall: smalls.length ? smallFound / smalls.length : 0, refs: refs.length, preds: preds.length, tp, byClass, match: m };
}

// ----------------------------------------------------------------------------- colour-coded labels
const COLOURS: LabelColour[] = ['red', 'green', 'yellow'];
export interface ColourScore { score: number; accuracy: number; macroF1: number; correct: number; total: number; unknown: number; confusion: Record<string, Record<string, number>>; rows: { id: string; truth: LabelColour; got: string }[] }
export function scoreColour(refs: Target[], preds: DetObject[], match: ReturnType<typeof matchObjects>): ColourScore {
  const cont = refs.map((r, i) => ({ r, i })).filter((x) => x.r.cls === 'container' && x.r.label !== 'none');
  const byRef = new Map(match.pairs.map((p) => [p.ref, p.pred])), confusion: ColourScore['confusion'] = {}; for (const c of COLOURS) confusion[c] = { red: 0, green: 0, yellow: 0, unknown: 0 };
  let correct = 0, unknown = 0; const rows: ColourScore['rows'] = [];
  for (const { r, i } of cont) {
    const j = byRef.get(i), got = j === undefined ? 'unknown' : preds[j].colour ?? 'unknown';
    if (got === 'unknown') unknown++; if (got === r.label) correct++;
    confusion[r.label as string][got === 'red' || got === 'green' || got === 'yellow' ? got : 'unknown']++; rows.push({ id: r.id, truth: r.label, got });
  }
  const per = COLOURS.map((c) => {
    const tp = confusion[c][c], rowSum = confusion[c].red + confusion[c].green + confusion[c].yellow + confusion[c].unknown;
    const fp = COLOURS.reduce((a2, d) => a2 + (d === c ? 0 : confusion[d][c]), 0);
    return f1(tp, fp, rowSum - tp).f1;
  });
  const accuracy = cont.length ? correct / cont.length : 0, macroF1 = mean(per);
  return { score: 0.5 * accuracy + 0.5 * macroF1, accuracy, macroF1, correct, total: cont.length, unknown, confusion, rows };
}

// ----------------------------------------------------------------------------- change detection
export interface ChangeScore { score: number; precision: number; recall: number; f1: number; locF1: number; meanLocErr: number; tp: number; fp: number; fn: number; truth: number; found: number; kindOk: number; rows: { truth: string; got: string }[] }
export function scoreChange(truth: ChangeTruth[], found: ChangeFound[]): ChangeScore {
  const maxD = (t: ChangeTruth) => (t.cls === 'small' ? 0.7 : 1.2);
  const cost = truth.map((t) => found.map((f) => { const d = Math.hypot(t.centre[0] - f.centre[0], t.centre[1] - f.centre[1]); return d <= maxD(t) ? d : 99; }));
  const a = assign(cost), locPairs: [number, number][] = [];
  a.forEach((j, i) => { if (j >= 0 && cost[i][j] < 99) locPairs.push([i, j]); });
  const kindOk = locPairs.filter(([i, j]) => truth[i].kind === found[j].kind).length, locErr = locPairs.map(([i, j]) => cost[i][j]);
  const q = f1(kindOk, found.length - kindOk, truth.length - kindOk), ql = f1(locPairs.length, found.length - locPairs.length, truth.length - locPairs.length);
  const rows = truth.map((t, i) => { const p = locPairs.find((x) => x[0] === i); return { truth: `${t.kind} ${t.id}`, got: p ? found[p[1]].kind : 'missed' }; });
  return { score: 0.6 * q.f1 + 0.2 * ql.f1 + 0.2 * (locErr.length ? lin(mean(locErr), 1.0, 0.1) : 0), precision: q.p, recall: q.r, f1: q.f1, locF1: ql.f1, meanLocErr: mean(locErr), tp: kindOk, fp: found.length - kindOk, fn: truth.length - kindOk, truth: truth.length, found: found.length, kindOk, rows };
}

// ----------------------------------------------------------------------------- safety zones
export interface SafetyTruth { zone: string; violated: boolean; clearance: number }
export function safetyTruth(targets: Target[]): SafetyTruth[] {
  return SAFETY_ZONES.map((z) => {
    let clear = Infinity;
    for (const o of targets) { if (o.max[2] < z.zMin) continue; clear = Math.min(clear, Math.hypot(Math.max(z.min[0] - o.max[0], o.min[0] - z.max[0], 0), Math.max(z.min[1] - o.max[1], o.min[1] - z.max[1], 0))); }
    return { zone: z.id, violated: clear <= 0, clearance: Number.isFinite(clear) ? clear : 99 };
  });
}
export interface SafetyScore { score: number; accuracy: number; missed: number; falseAlarms: number; clearanceErr: number; rows: { zone: string; truth: string; got: string; err: number }[] }
export function scoreSafety(truth: SafetyTruth[], got: SafetyFound[] | undefined): SafetyScore {
  if (!got) return { score: 0, accuracy: 0, missed: truth.filter((t) => t.violated).length, falseAlarms: 0, clearanceErr: NaN, rows: truth.map((t) => ({ zone: t.zone, truth: t.violated ? 'violated' : 'clear', got: 'not checked', err: NaN })) };
  let ok = 0, missed = 0, fa = 0; const errs: number[] = [], rows: SafetyScore['rows'] = [];
  for (const t of truth) {
    const g = got.find((x) => x.zone === t.zone), pv = g?.violated ?? false;
    if (pv === t.violated) ok++; else if (t.violated) missed++; else fa++;
    const e = g ? Math.min(2, Math.abs(Math.min(2, g.clearance) - Math.min(2, t.clearance))) : 2; errs.push(e);
    rows.push({ zone: t.zone, truth: t.violated ? 'violated' : `clear (${t.clearance.toFixed(1)} m)`, got: g ? (pv ? 'violated' : `clear (${g.clearance.toFixed(1)} m)`) : 'not checked', err: e });
  }
  const acc = ok / truth.length, ce = mean(errs);
  return { score: 0.6 * acc + 0.4 * lin(ce, 1.0, 0.1), accuracy: acc, missed, falseAlarms: fa, clearanceErr: ce, rows };
}

// ----------------------------------------------------------------------------- digital twin and data quality
export interface TwinScore { /** reference surface points (z ≤ 3 m) that the twin does not cover, thinned for display */ missing?: Float32Array; score: number; coverage: number; medianErr: number; junk: number; poseErrCm: number; poseErrDeg: number; points: number; covScore: number; accScore: number; alignScore: number }
const refCache = new Map<string, { samples: ReturnType<typeof sampleSurfaces>; tree: KDTree }>();
/** The reference surface of a factory: evenly spread samples on every scannable face that a sensor inside the building could see. Built once per scenario. */
export function referenceOf(f: Factory, count = 30000) {
  const key = `${f.seed}:${f.epoch}:${count}`; let r = refCache.get(key);
  if (!r) { const samples = sampleSurfaces(f.scene, count); r = { samples, tree: new KDTree(samples.pos, samples.count) }; if (refCache.size > 8) refCache.clear(); refCache.set(key, r); }
  return r;
}
export const TWIN_RADIUS = 0.15, TWIN_MAX_Z = 3.0;

/** How consistent are the scans with each other? Every pose is compared with the truth relative to the first scan, because nothing in the data can fix where the first scan sits in the building. */
export function poseError(est: Rigid[] | undefined, truth: Rigid[]): { cm: number; deg: number } {
  if (!est || est.length !== truth.length || !est.length) return { cm: NaN, deg: NaN };
  if (est.length === 1) return { cm: 0, deg: 0 };
  const e0 = rigidInverse(est[0]), t0 = rigidInverse(truth[0]), c: number[] = [], d: number[] = [];
  for (let k = 1; k < est.length; k++) {
    const re = rigidCompose(e0, est[k]), rt = rigidCompose(t0, truth[k]);
    c.push(100 * Math.hypot(re.t[0] - rt.t[0], re.t[1] - rt.t[1], re.t[2] - rt.t[2]));
    const Rt = rt.R, R = re.R, Rrel = [0, 1, 2].flatMap((r) => [0, 1, 2].map((cc) => R[r * 3] * Rt[cc * 3] + R[r * 3 + 1] * Rt[cc * 3 + 1] + R[r * 3 + 2] * Rt[cc * 3 + 2]));
    d.push((rotationAngle(Rrel) * 180) / Math.PI);
  }
  return { cm: mean(c), deg: mean(d) };
}

export function scoreTwin(twin: PointCloud | undefined, f: Factory, poses: { est?: Rigid[]; truth: Rigid[] }): TwinScore {
  const ref = referenceOf(f), pe = poseError(poses.est, poses.truth);
  const empty: TwinScore = { score: 0, coverage: 0, medianErr: NaN, junk: 1, poseErrCm: pe.cm, poseErrDeg: pe.deg, points: 0, covScore: 0, accScore: 0, alignScore: 0 };
  if (!twin || twin.count < 10) return empty;
  const tree = new KDTree(twin.positions, twin.count), r2 = TWIN_RADIUS * TWIN_RADIUS;
  let tot = 0, cov = 0; const miss: number[] = [];
  for (let i = 0; i < ref.samples.count; i++) { if (ref.samples.pos[i * 3 + 2] > TWIN_MAX_Z) continue; const a = ref.samples.area[i]; tot += a; if (tree.nearest(ref.samples.pos[i * 3], ref.samples.pos[i * 3 + 1], ref.samples.pos[i * 3 + 2], r2).index >= 0) cov += a; else miss.push(ref.samples.pos[i * 3], ref.samples.pos[i * 3 + 1], ref.samples.pos[i * 3 + 2]); }
  const every = Math.max(1, Math.floor(miss.length / 3 / 8000)), missing: number[] = []; for (let i = 0; i < miss.length / 3; i += every) missing.push(miss[i * 3], miss[i * 3 + 1], miss[i * 3 + 2]);
  const step = Math.max(1, Math.floor(twin.count / 20000)), d: number[] = []; let junk = 0, n = 0;
  for (let i = 0; i < twin.count; i += step) { const e = distToSurface(f.scene, twin.positions[i * 3], twin.positions[i * 3 + 1], twin.positions[i * 3 + 2], 0.5); n++; if (e >= 0.3) { junk++; continue; } d.push(e); }
  const med = median(d), junkShare = n ? junk / n : 1, coverage = tot ? cov / tot : 0;
  const covScore = lin(coverage, 0.25, 0.92), accScore = (Number.isFinite(med) ? lin(med, 0.12, 0.02) : 0) * (1 - junkShare), alignScore = Number.isFinite(pe.cm) ? lin(pe.cm, 20, 2) : 0.5;
  return { missing: Float32Array.from(missing), score: 0.55 * covScore + 0.25 * accScore + 0.2 * alignScore, coverage, medianErr: med, junk: junkShare, poseErrCm: pe.cm, poseErrDeg: pe.deg, points: twin.count, covScore, accScore, alignScore };
}

export interface QualityScore { score: number; outlierRemoval: number; retention: number; smallRetention: number; rawOutliers: number; keptOutliers: number }
/** Did the cleaning remove the floating points and keep the real ones, small objects included? Uses provenance: every surviving point knows which measured point it came from. */
export function scoreQuality(raw: { positions: Float32Array; prov: Int32Array; n: number }, truth: Truth, twin: PointCloud | undefined, smallInstances: Set<number>): QualityScore {
  let rawOut = 0; for (let i = 0; i < raw.n; i++) rawOut += truth.outlier[raw.prov[i]];
  if (!twin || twin.count < 10) return { score: 0, outlierRemoval: 0, retention: 0, smallRetention: 0, rawOutliers: rawOut, keptOutliers: rawOut };
  let kept = 0; if (twin.instances) for (let i = 0; i < twin.count; i++) kept += truth.outlier[twin.instances[i]];
  const outlierRemoval = rawOut > 20 ? Math.max(0, 1 - kept / rawOut) : 1;
  const tree = new KDTree(twin.positions, twin.count), r2 = 0.12 * 0.12, step = Math.max(1, Math.floor(raw.n / 20000));
  let g = 0, gk = 0, s = 0, sk = 0;
  for (let i = 0; i < raw.n; i += step) {
    const pv = raw.prov[i]; if (truth.outlier[pv] || raw.positions[i * 3 + 2] > TWIN_MAX_Z || raw.positions[i * 3 + 2] < -0.15) continue;
    const hit = tree.nearest(raw.positions[i * 3], raw.positions[i * 3 + 1], raw.positions[i * 3 + 2], r2).index >= 0;
    g++; if (hit) gk++;
    if (smallInstances.has(truth.obj[pv])) { s++; if (hit) sk++; }
  }
  const retention = g ? gk / g : 0, smallRetention = s ? sk / s : 0;
  return { score: 0.4 * outlierRemoval + 0.35 * lin(retention, 0.5, 0.95) + 0.25 * lin(smallRetention, 0.3, 0.9), outlierRemoval, retention, smallRetention, rawOutliers: rawOut, keptOutliers: kept };
}

// ----------------------------------------------------------------------------- the grade
export type TaskScores = Partial<Record<TaskKey, number>>;
export interface Grade { total: number; perTask: { key: TaskKey; weight: number; score: number; points: number; enabled: boolean }[]; efficiency: { perf: number; used: number; effort: number } }

/** Weighted total out of 100. Disabled tasks drop out and the rest are rescaled. Budget and efficiency are scaled by how well the system performed, so doing nothing cheaply earns nothing. */
export function combine(scores: TaskScores, s: ChallengeSettings, costTotal: number, rays: number): Grade {
  const core = TASK_KEYS.filter((k) => k !== 'budget' && s.enabled[k]);
  const wSum = core.reduce((a, k) => a + s.weights[k], 0), perf = wSum ? core.reduce((a, k) => a + s.weights[k] * (scores[k] ?? 0), 0) / wSum : 0;
  const used = s.budget > 0 ? Math.min(1, costTotal / s.budget) : 1, effort = lin(rays, 5e5, 5e6);
  const budget = Math.max(0, perf * (1 - 0.5 * used - 0.1 * effort));
  const all: TaskScores = { ...scores, budget };
  const on = TASK_KEYS.filter((k) => s.enabled[k]), W = on.reduce((a, k) => a + s.weights[k], 0) || 1;
  const perTask = TASK_KEYS.map((k) => ({ key: k, weight: s.weights[k], score: all[k] ?? 0, enabled: s.enabled[k], points: s.enabled[k] ? (100 * s.weights[k] * (all[k] ?? 0)) / W : 0 }));
  return { total: perTask.reduce((a, t) => a + t.points, 0), perTask, efficiency: { perf, used, effort } };
}
