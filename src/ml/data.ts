import { makeRng, Rng } from '../core/rng';
import type { DataKind } from './nn';

/** One labelled example. The same example carries the answer for all three tasks:
 *  cls = what it is, box = where it is (cx, cy, w, h in 0..1), seg = a label for every pixel / point. */
export interface Sample { kind: DataKind; name: string; shape: number[]; input: Float32Array; cls: number; box: [number, number, number, number]; seg: Uint8Array }

export const IMG = 16, PTS = 256;
export const CLASS_NAMES: Record<DataKind, string[]> = { image: ['circle', 'square', 'triangle'], points: ['building', 'pole', 'bush'] };
export const SEG_NAMES: Record<DataKind, string[]> = { image: ['background', 'circle', 'square', 'triangle'], points: ['ground', 'building', 'pole', 'bush'] };
export const SEG_COLORS = ['#c7c7cc', '#0a84ff', '#ff9f0a', '#30d158'];
/** Fixed split: three examples (one of each class) are held back to test the model on things it never trained on. */
export const TEST_IDX = [3, 4, 8];
const ORDER = [0, 1, 2, 0, 1, 2, 0, 1, 2, 0];

function imageSample(i: number): Sample {
  const r = makeRng(1000 + i * 17), cls = ORDER[i];
  const px = new Float32Array(IMG * IMG), seg = new Uint8Array(IMG * IMG);
  const size = r.range(3, 4.8), cx = r.range(size + 1, IMG - size - 1), cy = r.range(size + 1, IMG - size - 1), bright = r.range(0.75, 1), bg = r.range(0.05, 0.15);
  let x0 = IMG, x1 = 0, y0 = IMG, y1 = 0;
  for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    const inside = cls === 0 ? Math.hypot(dx, dy) <= size : cls === 1 ? Math.abs(dx) <= size * 0.85 && Math.abs(dy) <= size * 0.85 : dy >= -size && dy <= size && Math.abs(dx) <= ((dy + size) / (2 * size)) * size;
    px[y * IMG + x] = Math.min(1, Math.max(0, (inside ? bright : bg) + r.gauss() * 0.05));
    if (inside) { seg[y * IMG + x] = cls + 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1); }
  }
  return { kind: 'image', name: `Image ${i + 1}`, shape: [IMG, IMG, 1], input: px, cls, box: [((x0 + x1) / 2) / IMG, ((y0 + y1) / 2) / IMG, (x1 - x0) / IMG, (y1 - y0) / IMG], seg };
}

function pointSample(i: number): Sample {
  const r = makeRng(2000 + i * 31), cls = ORDER[i], SZ = 10, ZH = 3.2;
  const pts: { p: [number, number, number]; l: number }[] = [];
  for (let k = 0; k < 150; k++) pts.push({ p: [r.range(0, SZ), r.range(0, SZ), Math.abs(r.gauss()) * 0.03], l: 0 });
  const ox = r.range(2.8, 7.2), oy = r.range(2.8, 7.2); let fx = 0, fy = 0;
  const nObj = PTS - 150;
  if (cls === 0) { // a building: a box, points on its top and four walls
    const a = r.range(1.6, 2.6), b = r.range(1.6, 2.6), h = r.range(1.2, 2.2); fx = a; fy = b;
    for (let k = 0; k < nObj; k++) { const f = r.next(); let p: [number, number, number]; if (f < 0.3) p = [ox + r.range(-a / 2, a / 2), oy + r.range(-b / 2, b / 2), h]; else if (f < 0.65) p = [ox + (r.next() < 0.5 ? -a / 2 : a / 2), oy + r.range(-b / 2, b / 2), r.range(0, h)]; else p = [ox + r.range(-a / 2, a / 2), oy + (r.next() < 0.5 ? -b / 2 : b / 2), r.range(0, h)]; pts.push({ p, l: 1 }); }
  } else if (cls === 1) { // a pole: tall and thin
    const rad = r.range(0.15, 0.25), h = r.range(2.6, 3.2); fx = fy = 2 * rad;
    for (let k = 0; k < nObj; k++) { const t = r.range(0, 2 * Math.PI); pts.push({ p: [ox + Math.cos(t) * rad, oy + Math.sin(t) * rad, r.range(0, h)], l: 2 }); }
  } else { // a bush: a low dome
    const rad = r.range(1.1, 1.6); fx = fy = 2 * rad;
    for (let k = 0; k < nObj; k++) { const t = r.range(0, 2 * Math.PI), u = Math.acos(r.range(0.05, 1)); pts.push({ p: [ox + Math.sin(u) * Math.cos(t) * rad, oy + Math.sin(u) * Math.sin(t) * rad, Math.cos(u) * rad * 0.6], l: 3 }); }
  }
  for (let k = pts.length - 1; k > 0; k--) { const j = r.int(k + 1); [pts[k], pts[j]] = [pts[j], pts[k]]; } // the order of the points must not give anything away
  const input = new Float32Array(PTS * 3), seg = new Uint8Array(PTS);
  pts.forEach((q, k) => { input[k * 3] = q.p[0] / SZ; input[k * 3 + 1] = q.p[1] / SZ; input[k * 3 + 2] = q.p[2] / ZH; seg[k] = q.l; });
  return { kind: 'points', name: `Cloud ${i + 1}`, shape: [PTS, 3], input, cls, box: [ox / SZ, oy / SZ, fx / SZ, fy / SZ], seg };
}

const cache: Partial<Record<DataKind, Sample[]>> = {};
/** Ten examples per kind, made the same way every time. */
export function dataset(kind: DataKind): Sample[] { return (cache[kind] ??= Array.from({ length: 10 }, (_, i) => (kind === 'image' ? imageSample(i) : pointSample(i)))); }
export const splitOf = (kind: DataKind) => { const all = dataset(kind); return { train: all.filter((_, i) => !TEST_IDX.includes(i)), test: TEST_IDX.map((i) => all[i]) }; };

/** A slightly different copy of a training example (mirrored, moved, noisier), with its answers moved along. Only used for training. */
export function augment(s: Sample, r: Rng): Sample {
  const flip = r.next() < 0.5;
  if (s.kind === 'image') {
    const [cx, cy, w, h] = s.box, x0 = Math.round((cx - w / 2) * IMG), x1 = Math.round((cx + w / 2) * IMG), y0 = Math.round((cy - h / 2) * IMG), y1 = Math.round((cy + h / 2) * IMG);
    const dx = Math.round(r.range(Math.max(-2, -x0), Math.min(2, IMG - x1))), dy = Math.round(r.range(Math.max(-2, -y0), Math.min(2, IMG - y1)));
    const input = new Float32Array(IMG * IMG), seg = new Uint8Array(IMG * IMG), bg = s.input[0], gain = r.range(0.9, 1.1);
    for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
      const sx0 = x - dx, sx = flip ? IMG - 1 - sx0 : sx0, sy = y - dy, ok = sx >= 0 && sx < IMG && sy >= 0 && sy < IMG && sx0 >= 0 && sx0 < IMG;
      input[y * IMG + x] = Math.min(1, Math.max(0, (ok ? s.input[sy * IMG + sx] : bg) * gain + r.gauss() * 0.03)); seg[y * IMG + x] = ok ? s.seg[sy * IMG + sx] : 0;
    }
    return { ...s, input, seg, box: [flip ? 1 - cx + dx / IMG : cx + dx / IMG, cy + dy / IMG, w, h] };
  }
  const dx = r.range(-0.08, 0.08), dy = r.range(-0.08, 0.08), input = new Float32Array(s.input.length);
  for (let k = 0; k < PTS; k++) { const x = s.input[k * 3] + dx; input[k * 3] = (flip ? 1 - x : x) + r.gauss() * 0.004; input[k * 3 + 1] = s.input[k * 3 + 1] + dy + r.gauss() * 0.004; input[k * 3 + 2] = s.input[k * 3 + 2] + r.gauss() * 0.004; }
  return { ...s, input, box: [flip ? 1 - (s.box[0] + dx) : s.box[0] + dx, s.box[1] + dy, s.box[2], s.box[3]] };
}
