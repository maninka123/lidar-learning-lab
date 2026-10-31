import { describe, it, expect } from 'vitest';
import { buildModel, forward, backward, zeroGrad, LayerSpec, Task, DataKind } from '../src/ml/nn';
import { dataset, splitOf, augment, TEST_IDX, IMG, PTS } from '../src/ml/data';
import { Trainer, lossAndGrad, nClasses } from '../src/ml/train';
import { INPUT_SHAPE, spec, starter } from '../src/ml/presets';
import { makeRng } from '../src/core/rng';

describe('layers: backpropagation matches finite differences', () => {
  const cases: [string, DataKind, Task, LayerSpec[]][] = [
    ['image cls (conv, pool, flatten, dense, tanh)', 'image', 'cls', [spec('conv', 3), spec('tanh'), spec('pool'), spec('flatten'), spec('dense', 5), spec('relu')]],
    ['image seg (conv, pool, upsample)', 'image', 'seg', [spec('conv', 3), spec('tanh'), spec('pool'), spec('upsample'), spec('conv', 2)]],
    ['points cls (dense, global max)', 'points', 'cls', [spec('dense', 6), spec('tanh'), spec('globalmax'), spec('dense', 4)]],
    ['points det (dense, context, global max)', 'points', 'det', [spec('dense', 5), spec('tanh'), spec('context'), spec('dense', 4), spec('tanh'), spec('globalmax')]],
    ['points seg (dense, context)', 'points', 'seg', [spec('dense', 5), spec('tanh'), spec('context'), spec('dense', 4)]],
  ];
  for (const [name, kind, task, specs] of cases) it(name, () => {
    const r = buildModel(INPUT_SHAPE[kind], specs, task, kind, nClasses(kind, task), 3); expect(r.error).toBeUndefined();
    const m = r.model!, s = dataset(kind)[1], K = nClasses(kind, task), segW = [1, 1.3, 0.8, 1.1];
    const loss = () => lossAndGrad(task, K, forward(m, s.input), s, segW).loss;
    zeroGrad(m); backward(m, lossAndGrad(task, K, forward(m, s.input), s, segW).d);
    const rng = makeRng(9); let checked = 0;
    for (const l of m.layers) for (const p of l.params) for (let t = 0; t < 4; t++) {
      const i = rng.int(p.w.length), g = p.g[i], keep = p.w[i], h = 1e-3;
      p.w[i] = keep + h; const a = loss(); p.w[i] = keep - h; const b = loss(); p.w[i] = keep;
      const num = (a - b) / (2 * h); expect(Math.abs(num - g)).toBeLessThan(2e-3 + 0.02 * Math.abs(num)); checked++;
    }
    expect(checked).toBeGreaterThan(4);
  });
});

describe('model building explains mistakes', () => {
  it('dense on an image needs Flatten', () => { const r = buildModel([16, 16, 1], [spec('dense', 4)], 'cls', 'image', 3); expect(r.error).toMatch(/Flatten/); expect(r.errorAt).toBe(0); });
  it('classification must end with a flat list', () => { expect(buildModel([16, 16, 1], [spec('conv', 4)], 'cls', 'image', 3).error).toMatch(/Flatten/); expect(buildModel([256, 3], [spec('dense', 4)], 'det', 'points', 3).error).toMatch(/Global max/); });
  it('segmentation must give a full-size image back', () => { expect(buildModel([16, 16, 1], [spec('conv', 4), spec('pool')], 'seg', 'image', 4).error).toMatch(/Upsample/); expect(buildModel([256, 3], [spec('dense', 4), spec('globalmax')], 'seg', 'points', 4).error).toMatch(/Add context/); });
  it('points cannot use Conv', () => { expect(buildModel([256, 3], [spec('conv', 4)], 'cls', 'points', 3).error).toMatch(/images/); });
  it('an empty model is fine: only the output layer is trained', () => { expect(buildModel([256, 3], [spec('globalmax')], 'cls', 'points', 3).model).toBeDefined(); });
});

describe('the two data sets of ten', () => {
  for (const kind of ['image', 'points'] as const) it(`${kind}: ten examples, answers agree with each other`, () => {
    const d = dataset(kind); expect(d).toHaveLength(10);
    expect(new Set(d.map((s) => s.cls)).size).toBe(3);
    const sp = splitOf(kind); expect(sp.test).toHaveLength(3); expect(sp.train).toHaveLength(7); expect(new Set(sp.test.map((s) => s.cls)).size).toBe(3);
    for (const s of d) {
      expect(s.seg.length).toBe(kind === 'image' ? IMG * IMG : PTS);
      const objects = Array.from(s.seg).filter((v) => v > 0); expect(objects.length).toBeGreaterThan(20);
      expect(new Set(objects)).toEqual(new Set([s.cls + 1]));
      const [cx, cy, w, h] = s.box; expect(cx - w / 2).toBeGreaterThanOrEqual(-0.01); expect(cx + w / 2).toBeLessThanOrEqual(1.01); expect(cy - h / 2).toBeGreaterThanOrEqual(-0.01); expect(cy + h / 2).toBeLessThanOrEqual(1.01);
    }
  });
  it('image boxes contain every object pixel; point boxes contain every object point', () => {
    for (const s of dataset('image')) for (let i = 0; i < s.seg.length; i++) if (s.seg[i]) { const x = ((i % IMG) + 0.5) / IMG, y = (Math.floor(i / IMG) + 0.5) / IMG; expect(Math.abs(x - s.box[0])).toBeLessThanOrEqual(s.box[2] / 2 + 1e-6); expect(Math.abs(y - s.box[1])).toBeLessThanOrEqual(s.box[3] / 2 + 1e-6); }
    for (const s of dataset('points')) for (let i = 0; i < PTS; i++) if (s.seg[i]) { expect(Math.abs(s.input[i * 3] - s.box[0])).toBeLessThanOrEqual(s.box[2] / 2 + 0.01); expect(Math.abs(s.input[i * 3 + 1] - s.box[1])).toBeLessThanOrEqual(s.box[3] / 2 + 0.01); }
  });
  it('augmenting moves the answers along with the input', () => {
    const r = makeRng(3);
    for (const kind of ['image', 'points'] as const) for (const s of splitOf(kind).train) for (let k = 0; k < 6; k++) {
      const a = augment(s, r), K = a.seg;
      if (kind === 'image') { let x0 = IMG, x1 = 0; for (let i = 0; i < K.length; i++) if (K[i]) { x0 = Math.min(x0, i % IMG); x1 = Math.max(x1, (i % IMG) + 1); } expect(Math.abs((x0 + x1) / 2 / IMG - a.box[0])).toBeLessThan(0.07); }
      else { let sx = 0, c = 0; for (let i = 0; i < PTS; i++) if (K[i]) { sx += a.input[i * 3]; c++; } expect(Math.abs(sx / c - a.box[0])).toBeLessThan(0.25); }
      expect(a.cls).toBe(s.cls);
    }
    expect(TEST_IDX).toHaveLength(3);
  });
});

describe('the starter models learn', () => {
  const run = (kind: DataKind, task: Task, epochs: number) => {
    const b = buildModel(INPUT_SHAPE[kind], starter(task, kind), task, kind, nClasses(kind, task), 11); expect(b.error).toBeUndefined();
    const t = new Trainer(b.model!, task, kind), first = t.evaluate(t.train);
    const t0 = performance.now(); for (let e = 0; e < epochs; e++) t.epoch(0.01, true);
    const ms = (performance.now() - t0) / epochs, h = t.history[t.history.length - 1];
    console.log(`${kind} ${task}: loss ${first.loss.toFixed(2)} → ${h.trainLoss.toFixed(2)}, train ${h.train.toFixed(2)}, test ${h.test.toFixed(2)}, ${ms.toFixed(0)} ms/epoch`);
    return { first, h, ms };
  };
  for (const kind of ['image', 'points'] as const) for (const task of ['cls', 'det', 'seg'] as const) it(`${kind} ${task}`, () => {
    const { first, h } = run(kind, task, kind === 'image' ? 60 : 60);
    expect(h.trainLoss).toBeLessThan(first.loss * 0.7);
  }, 120000);
});
