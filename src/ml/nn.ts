import { makeRng, Rng } from '../core/rng';

/** A very small neural-network library (plain TypeScript, one sample at a time) so the lab can train models in the browser. */
export type LayerType = 'conv' | 'pool' | 'upsample' | 'flatten' | 'dense' | 'relu' | 'tanh' | 'globalmax' | 'context';
export interface LayerSpec { id: string; type: LayerType; size?: number } // size: filters (conv) or units (dense)

export const LAYER_INFO: Record<LayerType, { name: string; hint: string }> = {
  conv: { name: 'Conv 3×3', hint: 'Slides small filters over the image to find edges and shapes.' },
  pool: { name: 'Max pool', hint: 'Halves the image: keeps the strongest value in every 2×2 block.' },
  upsample: { name: 'Upsample', hint: 'Doubles the image size again, so the output can be a full-size mask.' },
  flatten: { name: 'Flatten', hint: 'Turns the feature maps into one long list of numbers.' },
  dense: { name: 'Dense', hint: 'Every output looks at every input. On points it is applied to each point (a shared MLP).' },
  relu: { name: 'ReLU', hint: 'Keeps positive values, zeroes the rest. Lets the model learn curves.' },
  tanh: { name: 'Tanh', hint: 'Squashes values between −1 and 1.' },
  globalmax: { name: 'Global max', hint: 'Keeps the strongest value of each feature over all points: one summary for the whole cloud.' },
  context: { name: 'Add context', hint: 'Gives every point the whole-cloud summary next to its own features.' },
};

export interface Param { w: Float32Array; g: Float32Array; m: Float32Array; v: Float32Array }
const mkParam = (n: number): Param => ({ w: new Float32Array(n), g: new Float32Array(n), m: new Float32Array(n), v: new Float32Array(n) });
const prod = (s: number[]) => s.reduce((a, b) => a * b, 1);

export interface Layer { type: LayerType; params: Param[]; inShape: number[]; outShape: number[]; forward(x: Float32Array): Float32Array; backward(d: Float32Array): Float32Array }

/** Shape rules. Returns the output shape or an error that explains in plain words what to change. */
export function outShapeOf(type: LayerType, size: number, s: number[]): { shape?: number[]; error?: string } {
  const spatial = s.length === 3, points = s.length === 2, flat = s.length === 1;
  switch (type) {
    case 'conv': return spatial ? { shape: [s[0], s[1], size] } : { error: 'Conv works on images only.' };
    case 'pool': return spatial ? (s[0] % 2 === 0 && s[1] % 2 === 0 && s[0] >= 2 ? { shape: [s[0] / 2, s[1] / 2, s[2]] } : { error: 'The image is too small to pool again.' }) : { error: 'Max pool works on images only.' };
    case 'upsample': return spatial ? { shape: [s[0] * 2, s[1] * 2, s[2]] } : { error: 'Upsample works on images only.' };
    case 'flatten': return flat ? { shape: s } : { shape: [prod(s)] };
    case 'dense': return spatial ? { error: 'Dense needs a flat list: put Flatten before it.' } : { shape: [...s.slice(0, -1), size] };
    case 'relu': case 'tanh': return { shape: s };
    case 'globalmax': return points ? { shape: [s[1]] } : { error: 'Global max works on point features only.' };
    case 'context': return points ? { shape: [s[0], s[1] * 2] } : { error: 'Add context works on point features only.' };
  }
}

export function makeLayer(type: LayerType, size: number, inShape: number[], rng: Rng, head = false): Layer {
  const { shape: outShape, error } = head ? { shape: [...inShape.slice(0, -1), size], error: undefined } : outShapeOf(type, size, inShape); // the output layer may sit on every pixel / point
  if (!outShape) throw new Error(error);
  const base = { type, inShape, outShape };
  switch (type) {
    case 'dense': {
      const I = inShape[inShape.length - 1], O = size, rows = prod(inShape) / I, W = mkParam(O * I), B = mkParam(O);
      const sd = Math.sqrt(2 / I); for (let i = 0; i < W.w.length; i++) W.w[i] = rng.gauss() * sd;
      let x: Float32Array = new Float32Array(0);
      return { ...base, params: [W, B],
        forward(inp) { x = inp; const y = new Float32Array(rows * O); for (let r = 0; r < rows; r++) for (let o = 0; o < O; o++) { let a = B.w[o]; const wo = o * I, xr = r * I; for (let i = 0; i < I; i++) a += W.w[wo + i] * inp[xr + i]; y[r * O + o] = a; } return y; },
        backward(d) { const dx = new Float32Array(rows * I); for (let r = 0; r < rows; r++) for (let o = 0; o < O; o++) { const g = d[r * O + o]; if (g === 0) continue; B.g[o] += g; const wo = o * I, xr = r * I; for (let i = 0; i < I; i++) { W.g[wo + i] += g * x[xr + i]; dx[xr + i] += g * W.w[wo + i]; } } return dx; } };
    }
    case 'conv': {
      const [H, Wd, C] = inShape, F = size, W = mkParam(F * 9 * C), B = mkParam(F), sd = Math.sqrt(2 / (9 * C));
      for (let i = 0; i < W.w.length; i++) W.w[i] = rng.gauss() * sd;
      let x: Float32Array = new Float32Array(0);
      return { ...base, params: [W, B],
        forward(inp) {
          x = inp; const y = new Float32Array(H * Wd * F);
          for (let r = 0; r < H; r++) for (let c = 0; c < Wd; c++) for (let f = 0; f < F; f++) {
            let a = B.w[f];
            for (let ky = 0; ky < 3; ky++) { const rr = r + ky - 1; if (rr < 0 || rr >= H) continue; for (let kx = 0; kx < 3; kx++) { const cc = c + kx - 1; if (cc < 0 || cc >= Wd) continue; const wi = ((f * 3 + ky) * 3 + kx) * C, xi = (rr * Wd + cc) * C; for (let k = 0; k < C; k++) a += W.w[wi + k] * inp[xi + k]; } }
            y[(r * Wd + c) * F + f] = a;
          }
          return y;
        },
        backward(d) {
          const dx = new Float32Array(H * Wd * C);
          for (let r = 0; r < H; r++) for (let c = 0; c < Wd; c++) for (let f = 0; f < F; f++) {
            const g = d[(r * Wd + c) * F + f]; if (g === 0) continue; B.g[f] += g;
            for (let ky = 0; ky < 3; ky++) { const rr = r + ky - 1; if (rr < 0 || rr >= H) continue; for (let kx = 0; kx < 3; kx++) { const cc = c + kx - 1; if (cc < 0 || cc >= Wd) continue; const wi = ((f * 3 + ky) * 3 + kx) * C, xi = (rr * Wd + cc) * C; for (let k = 0; k < C; k++) { W.g[wi + k] += g * x[xi + k]; dx[xi + k] += g * W.w[wi + k]; } } }
          }
          return dx;
        } };
    }
    case 'pool': {
      const [H, Wd, C] = inShape; let arg = new Int32Array(0);
      return { ...base, params: [],
        forward(inp) { const h = H / 2, w = Wd / 2, y = new Float32Array(h * w * C); arg = new Int32Array(h * w * C); for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) for (let k = 0; k < C; k++) { let best = -Infinity, bi = 0; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { const i = ((2 * r + a) * Wd + 2 * c + b) * C + k; if (inp[i] > best) { best = inp[i]; bi = i; } } y[(r * w + c) * C + k] = best; arg[(r * w + c) * C + k] = bi; } return y; },
        backward(d) { const dx = new Float32Array(H * Wd * C); for (let i = 0; i < d.length; i++) dx[arg[i]] += d[i]; return dx; } };
    }
    case 'upsample': {
      const [H, Wd, C] = inShape;
      return { ...base, params: [],
        forward(inp) { const y = new Float32Array(4 * H * Wd * C), W2 = 2 * Wd; for (let r = 0; r < 2 * H; r++) for (let c = 0; c < W2; c++) for (let k = 0; k < C; k++) y[(r * W2 + c) * C + k] = inp[((r >> 1) * Wd + (c >> 1)) * C + k]; return y; },
        backward(d) { const dx = new Float32Array(H * Wd * C), W2 = 2 * Wd; for (let r = 0; r < 2 * H; r++) for (let c = 0; c < W2; c++) for (let k = 0; k < C; k++) dx[((r >> 1) * Wd + (c >> 1)) * C + k] += d[(r * W2 + c) * C + k]; return dx; } };
    }
    case 'flatten': return { ...base, params: [], forward: (x) => x, backward: (d) => d };
    case 'relu': { let x: Float32Array = new Float32Array(0); return { ...base, params: [], forward(inp) { x = inp; return inp.map((v) => (v > 0 ? v : 0)); }, backward(d) { return d.map((g, i) => (x[i] > 0 ? g : 0)); } }; }
    case 'tanh': { let y: Float32Array = new Float32Array(0); return { ...base, params: [], forward(inp) { y = inp.map(Math.tanh); return y; }, backward(d) { return d.map((g, i) => g * (1 - y[i] * y[i])); } }; }
    case 'globalmax': {
      const [N, C] = inShape; let arg = new Int32Array(C);
      return { ...base, params: [],
        forward(inp) { const y = new Float32Array(C).fill(-Infinity); arg = new Int32Array(C); for (let n = 0; n < N; n++) for (let c = 0; c < C; c++) if (inp[n * C + c] > y[c]) { y[c] = inp[n * C + c]; arg[c] = n; } return y; },
        backward(d) { const dx = new Float32Array(N * C); for (let c = 0; c < C; c++) dx[arg[c] * C + c] += d[c]; return dx; } };
    }
    case 'context': {
      const [N, C] = inShape; let arg = new Int32Array(C);
      return { ...base, params: [],
        forward(inp) { const g = new Float32Array(C).fill(-Infinity); arg = new Int32Array(C); for (let n = 0; n < N; n++) for (let c = 0; c < C; c++) if (inp[n * C + c] > g[c]) { g[c] = inp[n * C + c]; arg[c] = n; } const y = new Float32Array(N * 2 * C); for (let n = 0; n < N; n++) for (let c = 0; c < C; c++) { y[n * 2 * C + c] = inp[n * C + c]; y[n * 2 * C + C + c] = g[c]; } return y; },
        backward(d) { const dx = new Float32Array(N * C); for (let n = 0; n < N; n++) for (let c = 0; c < C; c++) { dx[n * C + c] += d[n * 2 * C + c]; dx[arg[c] * C + c] += d[n * 2 * C + C + c]; } return dx; } };
    }
  }
}

export type Task = 'cls' | 'det' | 'seg';
export type DataKind = 'image' | 'points';
/** What the last (automatic) layer has to produce, given what the user built. */
export function headFor(task: Task, kind: DataKind, shape: number[], K: number, input: number[]): { type: 'dense'; size: number } | { error: string } {
  if (task === 'seg') {
    const ok = kind === 'image' ? shape.length === 3 && shape[0] === input[0] && shape[1] === input[1] : shape.length === 2 && shape[0] === input[0];
    return ok ? { type: 'dense', size: K } : { error: kind === 'image' ? `The output must be a full ${input[0]}×${input[1]} image again. Undo each Max pool with an Upsample.` : 'Every point needs its own features: put Add context (not Global max) at the end of the point layers.' };
  }
  if (shape.length !== 1) return { error: kind === 'image' ? 'End the model with Flatten (and Dense) so it can give one answer for the whole image.' : 'End the model with Global max so it can give one answer for the whole cloud.' };
  return { type: 'dense', size: task === 'cls' ? K : K + 4 };
}

export interface BuiltModel { layers: Layer[]; shapes: number[][]; paramCount: number; outShape: number[] }
export interface BuildResult { model?: BuiltModel; error?: string; errorAt?: number; shapes: number[][] }
/** Checks the user's stack layer by layer (so the error can point at the guilty block) and adds the output layer. */
export function buildModel(input: number[], specs: LayerSpec[], task: Task, kind: DataKind, K: number, seed = 1): BuildResult {
  const rng = makeRng(seed), layers: Layer[] = [], shapes: number[][] = [input];
  let s = input;
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i], size = sp.size ?? 8, o = outShapeOf(sp.type, size, s);
    if (!o.shape) return { error: o.error, errorAt: i, shapes };
    layers.push(makeLayer(sp.type, size, s, rng)); s = o.shape; shapes.push(s);
  }
  const h = headFor(task, kind, s, K, input);
  if ('error' in h) return { error: h.error, errorAt: specs.length - 1, shapes };
  layers.push(makeLayer('dense', h.size, s, rng, true)); s = [...s.slice(0, -1), h.size]; shapes.push(s);
  return { model: { layers, shapes, outShape: s, paramCount: layers.reduce((a, l) => a + l.params.reduce((b, p) => b + p.w.length, 0), 0) }, shapes };
}

export const forward = (m: BuiltModel, x: Float32Array) => m.layers.reduce((a, l) => l.forward(a), x);
export const backward = (m: BuiltModel, d: Float32Array) => { for (let i = m.layers.length - 1; i >= 0; i--) d = m.layers[i].backward(d); return d; };
export const zeroGrad = (m: BuiltModel) => m.layers.forEach((l) => l.params.forEach((p) => p.g.fill(0)));
/** One Adam step on the gradients collected since zeroGrad (divided by the number of samples). */
export function adamStep(m: BuiltModel, lr: number, count: number, t: number) {
  const b1 = 0.9, b2 = 0.999, c1 = 1 - b1 ** t, c2 = 1 - b2 ** t;
  for (const l of m.layers) for (const p of l.params) for (let i = 0; i < p.w.length; i++) {
    const g = p.g[i] / count; p.m[i] = b1 * p.m[i] + (1 - b1) * g; p.v[i] = b2 * p.v[i] + (1 - b2) * g * g;
    p.w[i] -= (lr * (p.m[i] / c1)) / (Math.sqrt(p.v[i] / c2) + 1e-8);
  }
}

export function softmax(z: ArrayLike<number>, off: number, K: number, out: Float32Array, o2 = off) {
  let mx = -Infinity; for (let k = 0; k < K; k++) mx = Math.max(mx, z[off + k]);
  let s = 0; for (let k = 0; k < K; k++) { const e = Math.exp(z[off + k] - mx); out[o2 + k] = e; s += e; }
  for (let k = 0; k < K; k++) out[o2 + k] /= s;
}
export const sigmoid = (u: number) => 1 / (1 + Math.exp(-u));
