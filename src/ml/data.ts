import { makeRng, Rng } from '../core/rng';
import type { DataKind } from './nn';

/** One labelled example. The same example carries the answer for all three tasks:
 *  cls = what it is, box = where it is (cx, cy, w, h in 0..1), seg = a label for every pixel / point. */
export interface Sample { kind: DataKind; name: string; shape: number[]; input: Float32Array; cls: number; box: number[]; seg: Uint8Array }
/** A box is the centre followed by the size: images (cx, cy, w, h); point clouds (cx, cy, cz, w, d, h), all between 0 and 1. */
export const BOX_DIM: Record<DataKind, number> = { image: 4, points: 6 };

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
  const ox = r.range(2.8, 7.2), oy = r.range(2.8, 7.2); let fx = 0, fy = 0, fz = 0;
  const nObj = PTS - 150;
  if (cls === 0) { // a building: a box, points on its top and four walls
    const a = r.range(1.6, 2.6), b = r.range(1.6, 2.6), h = r.range(1.2, 2.2); fx = a; fy = b; fz = h;
    for (let k = 0; k < nObj; k++) { const f = r.next(); let p: [number, number, number]; if (f < 0.3) p = [ox + r.range(-a / 2, a / 2), oy + r.range(-b / 2, b / 2), h]; else if (f < 0.65) p = [ox + (r.next() < 0.5 ? -a / 2 : a / 2), oy + r.range(-b / 2, b / 2), r.range(0, h)]; else p = [ox + r.range(-a / 2, a / 2), oy + (r.next() < 0.5 ? -b / 2 : b / 2), r.range(0, h)]; pts.push({ p, l: 1 }); }
  } else if (cls === 1) { // a pole: tall and thin
    const rad = r.range(0.15, 0.25), h = r.range(2.6, 3.2); fx = fy = 2 * rad; fz = h;
    for (let k = 0; k < nObj; k++) { const t = r.range(0, 2 * Math.PI); pts.push({ p: [ox + Math.cos(t) * rad, oy + Math.sin(t) * rad, r.range(0, h)], l: 2 }); }
  } else { // a bush: a low dome
    const rad = r.range(1.1, 1.6); fx = fy = 2 * rad; fz = rad * 0.6;
    for (let k = 0; k < nObj; k++) { const t = r.range(0, 2 * Math.PI), u = Math.acos(r.range(0.05, 1)); pts.push({ p: [ox + Math.sin(u) * Math.cos(t) * rad, oy + Math.sin(u) * Math.sin(t) * rad, Math.cos(u) * rad * 0.6], l: 3 }); }
  }
  for (let k = pts.length - 1; k > 0; k--) { const j = r.int(k + 1); [pts[k], pts[j]] = [pts[j], pts[k]]; } // the order of the points must not give anything away
  const input = new Float32Array(PTS * 3), seg = new Uint8Array(PTS);
  pts.forEach((q, k) => { input[k * 3] = q.p[0] / SZ; input[k * 3 + 1] = q.p[1] / SZ; input[k * 3 + 2] = q.p[2] / ZH; seg[k] = q.l; });
  return { kind: 'points', name: `Cloud ${i + 1}`, shape: [PTS, 3], input, cls, box: [ox / SZ, oy / SZ, fz / ZH / 2, fx / SZ, fy / SZ, fz / ZH], seg };
}

const cache: Partial<Record<DataKind, Sample[]>> = {};
/** Ten examples per kind, made the same way every time. */
export function dataset(kind: DataKind): Sample[] { return (cache[kind] ??= Array.from({ length: 10 }, (_, i) => (kind === 'image' ? imageSample(i) : pointSample(i)))); }
export const splitOf = (kind: DataKind) => { const all = dataset(kind); return { train: all.filter((_, i) => !TEST_IDX.includes(i)), test: TEST_IDX.map((i) => all[i]) }; };

/** A slightly different copy of a training example (mirrored, moved, noisier), with its answers moved along. Only used for training. */
export function augment(s: Sample, r: Rng): Sample {
  const flip = r.next() < 0.5;
  if (s.kind === 'image') {
    // zoom in or out, move the object (anywhere it still fits) and mirror it; mask and box follow
    const [cx0, cy, w, h] = s.box as [number, number, number, number], bg = s.input[0], gain = r.range(0.85, 1.15);
    const cx = flip ? 1 - cx0 : cx0; // the picture is mirrored first, then zoomed and moved
    const scale = r.range(0.8, 1.3), w2 = w * scale, h2 = h * scale, M = 0.01;
    const pick = (c: number, half: number) => { const lo = Math.max(half + M, c - 0.3), hi = Math.min(1 - half - M, c + 0.3); return lo < hi ? r.range(lo, hi) : Math.min(1 - half, Math.max(half, c)); };
    const ncx = pick(cx, w2 / 2), ncy = pick(cy, h2 / 2);
    const input = new Float32Array(IMG * IMG), seg = new Uint8Array(IMG * IMG);
    for (let y = 0; y < IMG; y++) for (let x = 0; x < IMG; x++) {
      const ux = (x + 0.5) / IMG, uy = (y + 0.5) / IMG;
      let sx = cx + (ux - ncx) / scale; const sy = cy + (uy - ncy) / scale; if (flip) sx = 1 - sx;
      const px = Math.floor(sx * IMG), py = Math.floor(sy * IMG), ok = px >= 0 && px < IMG && py >= 0 && py < IMG;
      input[y * IMG + x] = Math.min(1, Math.max(0, (ok ? s.input[py * IMG + px] : bg) * gain + r.gauss() * 0.03)); seg[y * IMG + x] = ok ? s.seg[py * IMG + px] : 0;
    }
    return { ...s, input, seg, box: [ncx, ncy, w2, h2] };
  }
  const dx = r.range(-0.08, 0.08), dy = r.range(-0.08, 0.08), input = new Float32Array(s.input.length);
  for (let k = 0; k < PTS; k++) { const x = s.input[k * 3] + dx; input[k * 3] = (flip ? 1 - x : x) + r.gauss() * 0.004; input[k * 3 + 1] = s.input[k * 3 + 1] + dy + r.gauss() * 0.004; input[k * 3 + 2] = s.input[k * 3 + 2] + r.gauss() * 0.004; }
  return { ...s, input, box: [flip ? 1 - (s.box[0] + dx) : s.box[0] + dx, s.box[1] + dy, ...s.box.slice(2)] };
}
