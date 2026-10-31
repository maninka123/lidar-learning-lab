import { makeRng, Rng } from '../core/rng';
import { adamStep, backward, BuiltModel, DataKind, forward, sigmoid, softmax, Task, zeroGrad } from './nn';
import { augment, CLASS_NAMES, SEG_NAMES, Sample, splitOf } from './data';

export interface Pred { cls: number; box: [number, number, number, number]; seg: Uint8Array }
export const nClasses = (kind: DataKind, task: Task) => (task === 'seg' ? SEG_NAMES[kind].length : CLASS_NAMES[kind].length);
export const iou = (a: number[], b: number[]) => {
  const ix = Math.max(0, Math.min(a[0] + a[2] / 2, b[0] + b[2] / 2) - Math.max(a[0] - a[2] / 2, b[0] - b[2] / 2)), iy = Math.max(0, Math.min(a[1] + a[3] / 2, b[1] + b[3] / 2) - Math.max(a[1] - a[3] / 2, b[1] - b[3] / 2));
  const inter = ix * iy, u = a[2] * a[3] + b[2] * b[3] - inter; return u > 0 ? inter / u : 0;
};
const LAMBDA_BOX = 4;

/** Loss and the gradient to send back into the model for one example. */
export function lossAndGrad(task: Task, K: number, out: Float32Array, s: Sample, segW: number[]): { loss: number; d: Float32Array } {
  const d = new Float32Array(out.length), p = new Float32Array(K);
  if (task === 'seg') {
    const P = s.seg.length; let loss = 0;
    for (let i = 0; i < P; i++) { softmax(out, i * K, K, p, 0); const y = s.seg[i], w = segW[y]; loss -= (w * Math.log(Math.max(p[y], 1e-9))) / P; for (let k = 0; k < K; k++) d[i * K + k] = (w * (p[k] - (k === y ? 1 : 0))) / P; }
    return { loss, d };
  }
  softmax(out, 0, K, p); let loss = -Math.log(Math.max(p[s.cls], 1e-9));
  for (let k = 0; k < K; k++) d[k] = p[k] - (k === s.cls ? 1 : 0);
  if (task === 'det') for (let i = 0; i < 4; i++) { const b = sigmoid(out[K + i]), e = b - s.box[i]; loss += LAMBDA_BOX * e * e; d[K + i] = LAMBDA_BOX * 2 * e * b * (1 - b); }
  return { loss, d };
}

export function decode(task: Task, K: number, out: Float32Array, n: number): Pred {
  const seg = new Uint8Array(task === 'seg' ? n : 0); let cls = 0; const box: [number, number, number, number] = [0, 0, 0, 0];
  if (task === 'seg') for (let i = 0; i < n; i++) { let b = 0; for (let k = 1; k < K; k++) if (out[i * K + k] > out[i * K + b]) b = k; seg[i] = b; }
  else { for (let k = 1; k < K; k++) if (out[k] > out[cls]) cls = k; if (task === 'det') for (let i = 0; i < 4; i++) box[i] = sigmoid(out[K + i]); }
  return { cls, box, seg };
}

export interface Score { value: number; text: string; extra: string }
export const METRIC_NAME: Record<Task, string> = { cls: 'accuracy', det: 'found (right class, box overlap ≥ 50 %)', seg: 'mean IoU' };
export function score(task: Task, kind: DataKind, preds: Pred[], samples: Sample[]): Score {
  if (task === 'cls') { const a = preds.filter((p, i) => p.cls === samples[i].cls).length / samples.length; return { value: a, text: `${(a * 100).toFixed(0)} %`, extra: `${preds.filter((p, i) => p.cls === samples[i].cls).length} of ${samples.length} right` }; }
  if (task === 'det') {
    const ious = preds.map((p, i) => iou(p.box, samples[i].box)), found = preds.filter((p, i) => p.cls === samples[i].cls && ious[i] >= 0.5).length / samples.length;
    const mi = ious.reduce((a, b) => a + b, 0) / ious.length; return { value: found, text: `${(found * 100).toFixed(0)} %`, extra: `box overlap (IoU) ${mi.toFixed(2)}` };
  }
  const K = SEG_NAMES[kind].length, inter = new Array(K).fill(0), uni = new Array(K).fill(0); let ok = 0, tot = 0;
  preds.forEach((p, i) => { const g = samples[i].seg; for (let j = 0; j < g.length; j++) { const a = p.seg[j], b = g[j]; tot++; if (a === b) { ok++; inter[a]++; } uni[a]++; if (b !== a) uni[b]++; else { /* counted once */ } } });
  const ious = inter.map((v, k) => (uni[k] > 0 ? v / (uni[k]) : NaN)).filter((v) => !Number.isNaN(v)), m = ious.reduce((a, b) => a + b, 0) / Math.max(1, ious.length);
  return { value: m, text: m.toFixed(2), extra: `${((ok / tot) * 100).toFixed(0)} % of ${kind === 'image' ? 'pixels' : 'points'} right` };
}

export interface HistoryPoint { epoch: number; trainLoss: number; testLoss: number; train: number; test: number }
export interface EvalResult { loss: number; score: Score; preds: Pred[] }

/** Trains one model on the ten-example data set (seven to learn from, three held back). */
export class Trainer {
  readonly train: Sample[]; readonly test: Sample[]; readonly K: number; readonly segW: number[];
  history: HistoryPoint[] = []; epochs = 0; private t = 0; private rng: Rng;
  constructor(public model: BuiltModel, public task: Task, public kind: DataKind, seed = 5) {
    const sp = splitOf(kind); this.train = sp.train; this.test = sp.test; this.K = nClasses(kind, task); this.rng = makeRng(seed);
    const counts = new Array(SEG_NAMES[kind].length).fill(0); let tot = 0; this.train.forEach((s) => s.seg.forEach((v) => { counts[v]++; tot++; }));
    this.segW = counts.map((c) => (c ? Math.min(6, Math.max(0.5, tot / (counts.length * c))) : 1));
  }
  evaluate(samples: Sample[]): EvalResult {
    let loss = 0; const preds = samples.map((s) => { const out = forward(this.model, s.input); loss += lossAndGrad(this.task, this.K, out, s, this.segW).loss; return decode(this.task, this.K, out, s.seg.length); });
    return { loss: loss / samples.length, score: score(this.task, this.kind, preds, samples), preds };
  }
  /** One pass over the training examples (each one possibly changed a little), then measure everything. */
  epoch(lr: number, aug: boolean, batch = 2): HistoryPoint {
    const order = this.train.map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = this.rng.int(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    for (let b = 0; b < order.length; b += batch) {
      zeroGrad(this.model); const ids = order.slice(b, b + batch);
      for (const id of ids) { const s = aug ? augment(this.train[id], this.rng) : this.train[id]; const out = forward(this.model, s.input); backward(this.model, lossAndGrad(this.task, this.K, out, s, this.segW).d); }
      adamStep(this.model, lr, ids.length, ++this.t);
    }
    this.epochs++;
    const tr = this.evaluate(this.train), te = this.evaluate(this.test);
    const h = { epoch: this.epochs, trainLoss: tr.loss, testLoss: te.loss, train: tr.score.value, test: te.score.value }; this.history.push(h); return h;
  }
}
