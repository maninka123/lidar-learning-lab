import { Rigid, applyR } from './math';

/** What a cloud *is*. Drives the legend/badge colour so users never confuse data kinds. */
export type CloudKind =
  | 'simulated' // synthetic LiDAR measurement from the ray-casting simulator
  | 'measured' // real measured data (uploaded by the user)
  | 'processed' // derived from another cloud by a processing step
  | 'reconstructed' // image-derived reconstruction
  | 'estimated'; // generated / estimated information (e.g. cluster labels)

export interface CloudMeta {
  kind: CloudKind;
  source: string;
  units: 'm';
  description?: string;
  sensor?: string;
  sceneId?: string;
  seed?: number;
  license?: string;
  coordinateFrame?: string;
  labelSource?: 'ground-truth' | 'estimated';
  normalsSource?: 'ground-truth' | 'estimated';
  notes?: string[];
  createdAt?: number;
  [k: string]: unknown;
}

export interface PointCloud {
  id: string;
  name: string;
  count: number;
  positions: Float32Array; // xyz, metres, Z-up
  colors?: Uint8Array; // rgb 0-255 (separate from intensity)
  intensity?: Float32Array; // relative return intensity 0..1
  ranges?: Float32Array; // sensor range (m)
  labels?: Int32Array; // semantic class id
  instances?: Int32Array; // instance id
  normals?: Float32Array; // unit normals
  times?: Float32Array; // seconds
  scanIds?: Uint16Array; // station / sweep id
  tags?: Uint8Array; // 1 = injected outlier (teaching bookkeeping)
  meta: CloudMeta;
}

export type AttrKey = 'colors' | 'intensity' | 'ranges' | 'labels' | 'instances' | 'normals' | 'times' | 'scanIds' | 'tags';
export const ATTR_STRIDE: Record<AttrKey, number> = {
  colors: 3, intensity: 1, ranges: 1, labels: 1, instances: 1, normals: 3, times: 1, scanIds: 1, tags: 1,
};
export const ATTR_KEYS = Object.keys(ATTR_STRIDE) as AttrKey[];

let idCounter = 0;
export const makeId = (prefix = 'cloud') => `${prefix}-${(++idCounter).toString(36)}`;

export function attributesOf(c: PointCloud): string[] {
  return ['xyz', ...ATTR_KEYS.filter((k) => c[k])];
}

export function newCloud(count: number, name: string, meta: Partial<CloudMeta> & Pick<CloudMeta, 'kind' | 'source'>): PointCloud {
  return {
    id: makeId(),
    name,
    count,
    positions: new Float32Array(count * 3),
    meta: { units: 'm', createdAt: Date.now(), ...meta },
  };
}

/** New cloud containing the listed points (all attributes preserved). */
export function selectPoints(c: PointCloud, indices: ArrayLike<number>, name = c.name, metaPatch: Partial<CloudMeta> = {}): PointCloud {
  const n = indices.length;
  const out: PointCloud = {
    id: makeId(),
    name,
    count: n,
    positions: new Float32Array(n * 3),
    meta: { ...c.meta, ...metaPatch },
  };
  for (let i = 0; i < n; i++) {
    const s = indices[i] * 3;
    out.positions[i * 3] = c.positions[s];
    out.positions[i * 3 + 1] = c.positions[s + 1];
    out.positions[i * 3 + 2] = c.positions[s + 2];
  }
  for (const k of ATTR_KEYS) {
    const src = c[k];
    if (!src) continue;
    const st = ATTR_STRIDE[k];
    const dst = new (src.constructor as { new (n: number): Float32Array })(n * st);
    const s2 = src as unknown as ArrayLike<number>;
    for (let i = 0; i < n; i++) for (let j = 0; j < st; j++) dst[i * st + j] = s2[indices[i] * st + j];
    (out as unknown as Record<string, unknown>)[k] = dst;
  }
  return out;
}

export function concatClouds(list: PointCloud[], name: string, metaPatch: Partial<CloudMeta> = {}): PointCloud {
  const total = list.reduce((a, c) => a + c.count, 0);
  const out: PointCloud = {
    id: makeId(),
    name,
    count: total,
    positions: new Float32Array(total * 3),
    meta: { ...(list[0]?.meta ?? { kind: 'processed', source: 'merge', units: 'm' }), ...metaPatch },
  };
  let off = 0;
  for (const c of list) { out.positions.set(c.positions.subarray(0, c.count * 3), off * 3); off += c.count; }
  for (const k of ATTR_KEYS) {
    if (!list.every((c) => c[k])) continue;
    const st = ATTR_STRIDE[k];
    const first = list[0][k]!;
    const dst = new (first.constructor as { new (n: number): typeof first })(total * st);
    let o = 0;
    for (const c of list) { dst.set((c[k] as ArrayLike<number>) as never, o * st); o += c.count; }
    (out as unknown as Record<string, unknown>)[k] = dst;
  }
  return out;
}

export function cloneCloud(c: PointCloud, name = c.name): PointCloud {
  const out: PointCloud = { ...c, id: makeId(), name, positions: c.positions.slice(), meta: { ...c.meta } };
  for (const k of ATTR_KEYS) if (c[k]) (out as unknown as Record<string, unknown>)[k] = (c[k] as Float32Array).slice();
  return out;
}

export function cloudBounds(c: PointCloud): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = c.positions;
  for (let i = 0; i < c.count; i++)
    for (let a = 0; a < 3; a++) {
      const v = p[i * 3 + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  if (c.count === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

export function transformCloud(c: PointCloud, T: Rigid, name = c.name): PointCloud {
  const out = cloneCloud(c, name);
  const p = out.positions;
  for (let i = 0; i < c.count; i++) {
    const r = applyR(T.R, [p[i * 3], p[i * 3 + 1], p[i * 3 + 2]]);
    p[i * 3] = r[0] + T.t[0];
    p[i * 3 + 1] = r[1] + T.t[1];
    p[i * 3 + 2] = r[2] + T.t[2];
  }
  if (out.normals) {
    const nn = out.normals;
    for (let i = 0; i < c.count; i++) {
      const r = applyR(T.R, [nn[i * 3], nn[i * 3 + 1], nn[i * 3 + 2]]);
      nn[i * 3] = r[0]; nn[i * 3 + 1] = r[1]; nn[i * 3 + 2] = r[2];
    }
  }
  return out;
}

export function centroid(c: PointCloud): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < c.count; i++) { x += c.positions[i * 3]; y += c.positions[i * 3 + 1]; z += c.positions[i * 3 + 2]; }
  const n = Math.max(1, c.count);
  return [x / n, y / n, z / n];
}
