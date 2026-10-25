import { PointCloud, cloneCloud, newCloud } from '../core/pointcloud';
import { KDTree } from '../core/kdtree';
import { euclideanClustering } from '../segmentation/clustering';
import { rigidFromEuler, applyR, D2R, Vec3, Rigid } from '../core/math';
import { makeRng } from '../core/rng';
import { CLASSROOM_CLASSES } from './classroom';

export type ChangeKind = 'moved' | 'removed' | 'added';
export interface TruthEvent { kind: 'removed' | 'added'; label: string; center: Vec3 }
export interface Epoch2 { cloud: PointCloud; truth: TruthEvent[]; misreg: Rigid | null }
export interface ChangeSpec { move: boolean; remove: boolean; add: boolean; misregister: boolean }

const centroid = (c: PointCloud, ids: number[]): Vec3 => { let x = 0, y = 0, z = 0; for (const i of ids) { x += c.positions[i * 3]; y += c.positions[i * 3 + 1]; z += c.positions[i * 3 + 2]; } const m = ids.length || 1; return [x / m, y / m, z / m]; };

/** Scan 2 = scan 1 after a few edits: one object removed, one moved, one new box, plus optional registration error and a little noise. */
export function makeEpoch2(c1: PointCloud, spec: ChangeSpec, seed: number): Epoch2 {
  const rng = makeRng(seed);
  const lab = c1.labels!;
  // find the furniture objects (labels 3-6) by clustering
  const furn: number[] = []; for (let i = 0; i < c1.count; i++) if (lab[i] >= 3) furn.push(i);
  const fp = new Float32Array(furn.length * 3); furn.forEach((j, k) => fp.set(c1.positions.subarray(j * 3, j * 3 + 3), k * 3));
  const cl = euclideanClustering(fp, furn.length, 0.06, 150);
  const groups: number[][] = Array.from({ length: cl.clusters }, () => []);
  cl.labels.forEach((g, k) => { if (g >= 0) groups[g].push(furn[k]); });
  groups.sort((a, b) => b.length - a.length);
  const objs = groups.slice(0, 6);
  const drop = new Set<number>(), shift = new Map<number, Vec3>(), truth: TruthEvent[] = [];
  const name = (g: number[]) => CLASSROOM_CLASSES[lab[g[0]]]?.name ?? 'Object';
  if (spec.remove && objs[0]) { for (const i of objs[0]) drop.add(i); truth.push({ kind: 'removed', label: name(objs[0]), center: centroid(c1, objs[0]) }); }
  if (spec.move && objs[2]) {
    const d: Vec3 = [0.9, 0.5, 0];
    for (const i of objs[2]) shift.set(i, d);
    const c0 = centroid(c1, objs[2]);
    truth.push({ kind: 'removed', label: `${name(objs[2])} (old place)`, center: c0 }, { kind: 'added', label: `${name(objs[2])} (new place)`, center: [c0[0] + d[0], c0[1] + d[1], c0[2]] });
  }
  const pos: number[] = [], col: number[] = [], labs: number[] = [];
  for (let i = 0; i < c1.count; i++) {
    if (drop.has(i)) continue;
    const s = shift.get(i);
    pos.push(c1.positions[i * 3] + (s?.[0] ?? 0), c1.positions[i * 3 + 1] + (s?.[1] ?? 0), c1.positions[i * 3 + 2] + (s?.[2] ?? 0));
    col.push(c1.colors![i * 3], c1.colors![i * 3 + 1], c1.colors![i * 3 + 2]); labs.push(lab[i]);
  }
  if (spec.add) {
    // a new box on the free floor spot farthest from everything else
    const solid: number[] = []; for (let i = 0; i < c1.count; i += 7) if (lab[i] >= 2 && !drop.has(i)) solid.push(i);
    const sp = new Float32Array(solid.length * 3); solid.forEach((j, k) => sp.set(c1.positions.subarray(j * 3, j * 3 + 3), k * 3));
    const tree = new KDTree(sp, solid.length);
    let bestP: Vec3 = [0, 0, 0], bestD = -1;
    for (let t = 0; t < 300; t++) {
      const i = rng.int(c1.count); if (lab[i] !== 1) continue;
      const x = c1.positions[i * 3], y = c1.positions[i * 3 + 1]; const r = tree.nearest(x, y, 0.4, Infinity);
      if (r.index >= 0 && r.dist2 > bestD) { bestD = r.dist2; bestP = [x, y, 0]; }
    }
    const s = 0.5, h = 0.6, step = 0.02;
    const face = (f: (u: number, v: number) => Vec3, ru: number, rv: number) => { for (let u = 0; u <= ru; u += step) for (let v = 0; v <= rv; v += step) { const p = f(u, v); pos.push(bestP[0] + p[0], bestP[1] + p[1], p[2]); col.push(220, 60, 60); labs.push(6); } };
    face((u, v) => [u - s / 2, v - s / 2, h], s, s);
    face((u, v) => [u - s / 2, -s / 2, v], s, h); face((u, v) => [u - s / 2, s / 2, v], s, h);
    face((u, v) => [-s / 2, u - s / 2, v], s, h); face((u, v) => [s / 2, u - s / 2, v], s, h);
    truth.push({ kind: 'added', label: 'New box', center: [bestP[0], bestP[1], h / 2] });
  }
  const out = newCloud(pos.length / 3, 'Scan 2 (later)', { kind: 'measured', source: 'classroom scan with simulated changes' });
  out.positions = Float32Array.from(pos); out.colors = Uint8Array.from(col); out.labels = Int32Array.from(labs);
  const noise = 0.004;
  for (let i = 0; i < out.positions.length; i++) out.positions[i] += noise * rng.gauss();
  let misreg: Rigid | null = null;
  if (spec.misregister) {
    misreg = rigidFromEuler(0.12, -0.08, 0.02, 2 * D2R, 0.3 * D2R, 0);
    for (let i = 0; i < out.count; i++) { const q = applyR(misreg.R, [out.positions[i * 3], out.positions[i * 3 + 1], out.positions[i * 3 + 2]]); out.positions[i * 3] = q[0] + misreg.t[0]; out.positions[i * 3 + 1] = q[1] + misreg.t[1]; out.positions[i * 3 + 2] = q[2] + misreg.t[2]; }
  }
  return { cloud: out, truth, misreg };
}

/** Distance from every point of `a` to the nearest point of `b`. */
export function cloudToCloud(a: PointCloud, b: PointCloud): Float32Array {
  const tree = new KDTree(b.positions, b.count), d = new Float32Array(a.count);
  for (let i = 0; i < a.count; i++) d[i] = Math.sqrt(tree.nearest(a.positions[i * 3], a.positions[i * 3 + 1], a.positions[i * 3 + 2], Infinity).dist2);
  return d;
}

export interface ChangeRegion { kind: 'removed' | 'added'; points: number; center: Vec3; size: Vec3; label: string; matched: string | null }
export interface ChangeResult { dOld: Float32Array; dNew: Float32Array; removed: Uint8Array; added: Uint8Array; regions: ChangeRegion[]; recall: number; falseRegions: number }

/** Points with no counterpart (farther than `thr`) are changes; group them into regions and compare with what was really changed. */
export function detectChanges(c1: PointCloud, c2: PointCloud, thr: number, minPts: number, truth: TruthEvent[], dists?: { dOld: Float32Array; dNew: Float32Array }): ChangeResult {
  const dOld = dists?.dOld ?? cloudToCloud(c1, c2), dNew = dists?.dNew ?? cloudToCloud(c2, c1);
  const removed = new Uint8Array(c1.count), added = new Uint8Array(c2.count);
  for (let i = 0; i < c1.count; i++) removed[i] = dOld[i] > thr ? 1 : 0;
  for (let i = 0; i < c2.count; i++) added[i] = dNew[i] > thr ? 1 : 0;
  const regions: ChangeRegion[] = [];
  const group = (c: PointCloud, mask: Uint8Array, kind: 'removed' | 'added') => {
    const ids: number[] = []; for (let i = 0; i < c.count; i++) if (mask[i]) ids.push(i);
    const p = new Float32Array(ids.length * 3); ids.forEach((j, k) => p.set(c.positions.subarray(j * 3, j * 3 + 3), k * 3));
    const cl = euclideanClustering(p, ids.length, Math.max(0.06, thr * 2), minPts);
    const gs: number[][] = Array.from({ length: cl.clusters }, () => []); cl.labels.forEach((g, k) => { if (g >= 0) gs[g].push(ids[k]); });
    for (const g of gs) {
      const mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const i of g) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], c.positions[i * 3 + a]); mx[a] = Math.max(mx[a], c.positions[i * 3 + a]); }
      const cnt = new Map<number, number>(); for (const i of g) cnt.set(c.labels![i], (cnt.get(c.labels![i]) ?? 0) + 1);
      let bl = 0, bc = 0; cnt.forEach((v, k) => { if (v > bc) { bc = v; bl = k; } });
      regions.push({ kind, points: g.length, center: centroid(c, g), size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], label: CLASSROOM_CLASSES[bl]?.name ?? 'Object', matched: null });
    }
  };
  group(c1, removed, 'removed'); group(c2, added, 'added');
  let hit = 0;
  for (const t of truth) {
    const r = regions.find((q) => q.kind === t.kind && Math.hypot(q.center[0] - t.center[0], q.center[1] - t.center[1], q.center[2] - t.center[2]) < 0.6 && !q.matched);
    if (r) { r.matched = t.label; hit++; }
  }
  return { dOld, dNew, removed, added, regions: regions.sort((a, b) => b.points - a.points), recall: truth.length ? hit / truth.length : 1, falseRegions: regions.filter((r) => !r.matched).length };
}

export { cloneCloud };
