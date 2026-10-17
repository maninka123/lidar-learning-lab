import { PointCloud, selectPoints, transformCloud, ATTR_KEYS, ATTR_STRIDE, makeId, cloneCloud } from '../core/pointcloud';
import { KDTree } from '../core/kdtree';
import { makeRng } from '../core/rng';
import { Rigid, Vec3, jacobiEigen } from '../core/math';
import { cloudBounds } from '../core/pointcloud';

const derived = (c: PointCloud, patch: Partial<PointCloud['meta']> = {}) => ({ ...patch, kind: 'processed' as const, source: `Processed from "${c.name}"` });

export function cropBox(c: PointCloud, min: Vec3, max: Vec3, invert = false): PointCloud {
  const keep: number[] = [];
  const p = c.positions;
  for (let i = 0; i < c.count; i++) {
    const inside = p[i * 3] >= min[0] && p[i * 3] <= max[0] && p[i * 3 + 1] >= min[1] && p[i * 3 + 1] <= max[1] && p[i * 3 + 2] >= min[2] && p[i * 3 + 2] <= max[2];
    if (inside !== invert) keep.push(i);
  }
  return selectPoints(c, keep, `${c.name} (cropped)`, derived(c));
}

/** Voxel grid downsampling: one point per occupied voxel (centroid; attributes averaged, labels from first point). */
export function voxelDownsample(c: PointCloud, size: number): PointCloud {
  if (size <= 0 || c.count === 0) return cloneCloud(c);
  const b = cloudBounds(c);
  const nx = Math.ceil((b.max[0] - b.min[0]) / size) + 1, ny = Math.ceil((b.max[1] - b.min[1]) / size) + 1;
  const map = new Map<number, number>();
  const order: number[] = [];
  const groups: number[][] = [];
  const p = c.positions;
  for (let i = 0; i < c.count; i++) {
    const ix = Math.floor((p[i * 3] - b.min[0]) / size), iy = Math.floor((p[i * 3 + 1] - b.min[1]) / size), iz = Math.floor((p[i * 3 + 2] - b.min[2]) / size);
    const key = (iz * ny + iy) * nx + ix;
    let g = map.get(key);
    if (g === undefined) { g = groups.length; map.set(key, g); groups.push([]); order.push(i); }
    groups[g].push(i);
  }
  const first = Int32Array.from(order);
  const out = selectPoints(c, first, `${c.name} (voxel ${size} m)`, derived(c));
  const avg = (key: 'colors' | 'intensity' | 'ranges' | 'times' | 'normals') => {
    const src = c[key] as ArrayLike<number> | undefined;
    const dst = out[key] as unknown as { [i: number]: number } | undefined;
    if (!src || !dst) return;
    const st = ATTR_STRIDE[key];
    groups.forEach((g, gi) => {
      for (let j = 0; j < st; j++) {
        let s = 0;
        for (const i of g) s += src[i * st + j];
        dst[gi * st + j] = s / g.length;
      }
    });
  };
  groups.forEach((g, gi) => {
    let x = 0, y = 0, z = 0;
    for (const i of g) { x += p[i * 3]; y += p[i * 3 + 1]; z += p[i * 3 + 2]; }
    out.positions[gi * 3] = x / g.length; out.positions[gi * 3 + 1] = y / g.length; out.positions[gi * 3 + 2] = z / g.length;
  });
  (['colors', 'intensity', 'ranges', 'times', 'normals'] as const).forEach(avg);
  if (out.normals) {
    const n = out.normals;
    for (let i = 0; i < out.count; i++) {
      const l = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
      n[i * 3] /= l; n[i * 3 + 1] /= l; n[i * 3 + 2] /= l;
    }
  }
  if (out.tags) groups.forEach((g, gi) => { out.tags![gi] = g.some((i) => c.tags![i]) ? 1 : 0; });
  return out;
}

export function randomDownsample(c: PointCloud, ratio: number, seed: number): PointCloud {
  const rng = makeRng(seed);
  const keep: number[] = [];
  for (let i = 0; i < c.count; i++) if (rng.next() < ratio) keep.push(i);
  return selectPoints(c, keep, `${c.name} (random ${Math.round(ratio * 100)}%)`, derived(c));
}

export function gaussianNoise(c: PointCloud, sigma: number, seed: number): PointCloud {
  const rng = makeRng(seed);
  const out = cloneCloud(c, `${c.name} (noise σ=${sigma} m)`);
  out.meta = { ...out.meta, ...derived(c) };
  for (let i = 0; i < out.positions.length; i++) out.positions[i] += sigma * rng.gauss();
  return out;
}

export function addOutliers(c: PointCloud, fraction: number, seed: number): PointCloud {
  const rng = makeRng(seed);
  const m = Math.round(c.count * fraction);
  const b = cloudBounds(c);
  const maxSpan = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const total = c.count + m;
  const out: PointCloud = { id: makeId(), name: `${c.name} (+${m} outliers)`, count: total, positions: new Float32Array(total * 3), meta: { ...c.meta, ...derived(c) } };
  out.positions.set(c.positions.subarray(0, c.count * 3));
  for (const k of ATTR_KEYS) if (c[k]) {
    const a = c[k]!;
    const dst = new (a.constructor as { new (n: number): Float32Array })(total * ATTR_STRIDE[k]);
    dst.set(a as unknown as ArrayLike<number>);
    (out as unknown as Record<string, unknown>)[k] = dst;
  }
  if (!out.tags) out.tags = new Uint8Array(total);
  for (let j = 0; j < m; j++) {
    const i = c.count + j;
    for (let a = 0; a < 3; a++) {
      const span = b.max[a] - b.min[a];
      const pad = Math.max(0.25 * span, 0.2 * maxSpan);
      out.positions[i * 3 + a] = b.min[a] - pad + rng.next() * (span + 2 * pad);
    }
    out.tags[i] = 1;
    if (out.colors) { const g = rng.int(256); out.colors[i * 3] = g; out.colors[i * 3 + 1] = g; out.colors[i * 3 + 2] = g; }
    if (out.intensity) out.intensity[i] = rng.next();
    if (out.normals) out.normals[i * 3 + 2] = 1;
  }
  return out;
}

export function dropout(c: PointCloud, p: number, seed: number): PointCloud {
  const rng = makeRng(seed);
  const keep: number[] = [];
  for (let i = 0; i < c.count; i++) if (rng.next() >= p) keep.push(i);
  return selectPoints(c, keep, `${c.name} (dropout ${Math.round(p * 100)}%)`, derived(c));
}

export function statisticalOutlierRemoval(c: PointCloud, k: number, stdRatio: number): PointCloud {
  const n = c.count;
  if (n <= k) return cloneCloud(c);
  const tree = new KDTree(c.positions, n);
  const md = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = tree.knn(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2], k + 1);
    let s = 0;
    for (let j = 1; j < r.d2.length; j++) s += Math.sqrt(r.d2[j]);
    md[i] = s / Math.max(1, r.d2.length - 1);
  }
  let mean = 0;
  for (let i = 0; i < n; i++) mean += md[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (md[i] - mean) ** 2;
  const thr = mean + stdRatio * Math.sqrt(v / n);
  const keep: number[] = [];
  for (let i = 0; i < n; i++) if (md[i] <= thr) keep.push(i);
  return selectPoints(c, keep, `${c.name} (SOR k=${k})`, derived(c));
}

export function radiusOutlierRemoval(c: PointCloud, radius: number, minNeighbors: number): PointCloud {
  const tree = new KDTree(c.positions, c.count);
  const keep: number[] = [];
  for (let i = 0; i < c.count; i++) {
    let cnt = 0;
    tree.radius(c.positions[i * 3], c.positions[i * 3 + 1], c.positions[i * 3 + 2], radius, () => { cnt++; });
    if (cnt - 1 >= minNeighbors) keep.push(i);
  }
  return selectPoints(c, keep, `${c.name} (ROR r=${radius})`, derived(c));
}

/** PCA normals from k nearest neighbours; sign chosen to face `viewpoint`. */
export function estimateNormals(c: PointCloud, k: number, viewpoint?: Vec3): PointCloud {
  const out = cloneCloud(c, `${c.name} (normals)`);
  out.meta = { ...out.meta, ...derived(c), normalsSource: 'estimated' };
  const n = c.count;
  const nrm = new Float32Array(n * 3);
  const tree = new KDTree(c.positions, n);
  let vp = viewpoint;
  if (!vp) {
    vp = [0, 0, 0];
    for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) vp[a] += c.positions[i * 3 + a] / n;
  }
  const p = c.positions;
  for (let i = 0; i < n; i++) {
    const r = tree.knn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], k);
    const m = r.idx.length;
    if (m < 3) { nrm[i * 3 + 2] = 1; continue; }
    let mx = 0, my = 0, mz = 0;
    for (const j of r.idx) { mx += p[j * 3]; my += p[j * 3 + 1]; mz += p[j * 3 + 2]; }
    mx /= m; my /= m; mz /= m;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
    for (const j of r.idx) {
      const a = p[j * 3] - mx, b = p[j * 3 + 1] - my, d = p[j * 3 + 2] - mz;
      xx += a * a; xy += a * b; xz += a * d; yy += b * b; yz += b * d; zz += d * d;
    }
    const { values, vectors } = jacobiEigen([xx, xy, xz, xy, yy, yz, xz, yz, zz], 3);
    let mi = 0;
    for (let e = 1; e < 3; e++) if (values[e] < values[mi]) mi = e;
    let nx = vectors[mi], ny = vectors[3 + mi], nz = vectors[6 + mi];
    const vx = vp[0] - p[i * 3], vy = vp[1] - p[i * 3 + 1], vz = vp[2] - p[i * 3 + 2];
    if (nx * vx + ny * vy + nz * vz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nrm[i * 3] = nx; nrm[i * 3 + 1] = ny; nrm[i * 3 + 2] = nz;
  }
  out.normals = nrm;
  return out;
}

export const rigidTransform = (c: PointCloud, T: Rigid) => transformCloud(c, T, `${c.name} (transformed)`);
