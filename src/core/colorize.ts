import { PointCloud } from './pointcloud';
import { classColor } from '../scenes/classes';

export type ColorMode =
  | 'xyz' | 'height' | 'range' | 'intensity' | 'rgb' | 'semantic' | 'normal' | 'scan' | 'cluster' | 'flat';

export const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  xyz: 'XYZ position', height: 'Height (Z)', range: 'Range', intensity: 'Intensity', rgb: 'RGB',
  semantic: 'Semantic class', normal: 'Normals', scan: 'Scan / station', cluster: 'Cluster / instance', flat: 'Single colour',
};

type Stop = [number, number, number];
const TURBO: Stop[] = [[48, 18, 59], [70, 107, 227], [40, 187, 236], [49, 242, 153], [163, 253, 60], [237, 207, 58], [251, 126, 33], [210, 49, 5], [122, 4, 2]];
const VIRIDIS: Stop[] = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];

function ramp(stops: Stop[], t: number): Stop {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
export const turbo = (t: number) => ramp(TURBO, t);
export const viridis = (t: number) => ramp(VIRIDIS, t);

/** Distinct colour for cluster/instance index (golden-angle hue). */
export function distinctColor(i: number): Stop {
  if (i < 0) return [110, 110, 118];
  const h = ((i * 137.508) % 360) / 360;
  const s = 0.65 + 0.25 * ((i * 7) % 3) / 2;
  const l = 0.55;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export interface ColorOpts {
  flat?: [number, number, number];
  clusterLabels?: Int32Array | null;
  heightRange?: [number, number];
  rangeFixed?: [number, number];
  boundsMin?: [number, number, number];
  boundsMax?: [number, number, number];
}

export function availableModes(c: PointCloud, hasCluster = false): ColorMode[] {
  const m: ColorMode[] = ['xyz', 'height'];
  if (c.ranges) m.push('range');
  if (c.intensity) m.push('intensity');
  if (c.colors) m.push('rgb');
  if (c.labels) m.push('semantic');
  if (c.normals) m.push('normal');
  if (c.scanIds) m.push('scan');
  if (hasCluster || c.instances) m.push('cluster');
  m.push('flat');
  return m;
}

/** Returns per-point RGB in 0..1 (Float32Array n*3). Falls back gracefully when an attribute is missing. */
export function colorize(c: PointCloud, mode: ColorMode, o: ColorOpts = {}): Float32Array {
  const n = c.count;
  const out = new Float32Array(n * 3);
  const p = c.positions;
  const put = (i: number, rgb: Stop) => { out[i * 3] = rgb[0] / 255; out[i * 3 + 1] = rgb[1] / 255; out[i * 3 + 2] = rgb[2] / 255; };

  let eff = mode;
  if (eff === 'range' && !c.ranges) eff = 'height';
  if (eff === 'intensity' && !c.intensity) eff = 'height';
  if (eff === 'rgb' && !c.colors) eff = 'height';
  if (eff === 'semantic' && !c.labels) eff = 'height';
  if (eff === 'normal' && !c.normals) eff = 'height';
  if (eff === 'scan' && !c.scanIds) eff = 'height';
  if (eff === 'cluster' && !o.clusterLabels && !c.instances) eff = 'height';

  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  if (eff === 'xyz' || eff === 'height' || eff === 'range') {
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const v = p[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  }
  switch (eff) {
    case 'xyz':
      for (let i = 0; i < n; i++)
        put(i, [0, 1, 2].map((a) => 255 * (0.15 + 0.85 * (p[i * 3 + a] - min[a]) / ((max[a] - min[a]) || 1))) as Stop);
      break;
    case 'height': {
      const [lo, hi] = o.heightRange ?? [min[2], max[2]];
      for (let i = 0; i < n; i++) put(i, turbo((p[i * 3 + 2] - lo) / ((hi - lo) || 1)));
      break;
    }
    case 'range': {
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < n; i++) { const r = c.ranges![i]; if (r < lo) lo = r; if (r > hi) hi = r; }
      if (o.rangeFixed) { lo = o.rangeFixed[0]; hi = o.rangeFixed[1]; }
      for (let i = 0; i < n; i++) put(i, turbo((c.ranges![i] - lo) / ((hi - lo) || 1)));
      break;
    }
    case 'intensity':
      for (let i = 0; i < n; i++) put(i, viridis(c.intensity![i]));
      break;
    case 'rgb':
      for (let i = 0; i < n; i++) put(i, [c.colors![i * 3], c.colors![i * 3 + 1], c.colors![i * 3 + 2]]);
      break;
    case 'semantic':
      for (let i = 0; i < n; i++) put(i, classColor(c.labels![i]));
      break;
    case 'normal':
      for (let i = 0; i < n; i++) put(i, [(c.normals![i * 3] * 0.5 + 0.5) * 255, (c.normals![i * 3 + 1] * 0.5 + 0.5) * 255, (c.normals![i * 3 + 2] * 0.5 + 0.5) * 255]);
      break;
    case 'scan':
      for (let i = 0; i < n; i++) put(i, distinctColor(c.scanIds![i]));
      break;
    case 'cluster': {
      const L = o.clusterLabels ?? c.instances!;
      for (let i = 0; i < n; i++) put(i, distinctColor(L[i]));
      break;
    }
    default: {
      const f = o.flat ?? [10, 132, 255];
      for (let i = 0; i < n; i++) put(i, f);
    }
  }
  return out;
}
