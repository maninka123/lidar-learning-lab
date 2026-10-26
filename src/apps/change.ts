import { PointCloud, newCloud } from '../core/pointcloud';
import { KDTree } from '../core/kdtree';
import { euclideanClustering } from '../segmentation/clustering';
import { Vec3 } from '../core/math';
import { makeRng } from '../core/rng';
import { CLASSROOM_CLASSES } from './classroom';

export interface TruthEvent { kind: 'removed' | 'added'; label: string; center: Vec3 }
export interface Epoch { name: string; note: string; cloud: PointCloud; /** what was done to the room since the previous epoch */ truth: TruthEvent[] }

const centroid = (c: PointCloud, ids: number[]): Vec3 => { let x = 0, y = 0, z = 0; for (const i of ids) { x += c.positions[i * 3]; y += c.positions[i * 3 + 1]; z += c.positions[i * 3 + 2]; } const m = ids.length || 1; return [x / m, y / m, z / m]; };

/**
 * Five visits to the same classroom. Visit 1 is the scan itself; every later visit is the room after one more
 * everyday change (furniture moved, taken away, a box left behind). All visits share one frame, as scans taken from a
 * fixed scanner position would.
 */
export function makeSeries(c1: PointCloud, seed = 11): Epoch[] {
  const rng = makeRng(seed), lab = c1.labels!;
  const furn: number[] = []; for (let i = 0; i < c1.count; i++) if (lab[i] >= 3) furn.push(i);
  const fp = new Float32Array(furn.length * 3); furn.forEach((j, k) => fp.set(c1.positions.subarray(j * 3, j * 3 + 3), k * 3));
  const cl = euclideanClustering(fp, furn.length, 0.06, 150);
  const groups: number[][] = Array.from({ length: cl.clusters }, () => []);
  cl.labels.forEach((g, k) => { if (g >= 0) groups[g].push(furn[k]); });
  groups.sort((a, b) => b.length - a.length);
  const objs = groups.slice(0, 6), name = (g: number[]) => CLASSROOM_CLASSES[lab[g[0]]]?.name ?? 'Object';

  // box position: the free floor spot farthest from everything else
  const solid: number[] = []; for (let i = 0; i < c1.count; i += 7) if (lab[i] >= 2) solid.push(i);
  const sp = new Float32Array(solid.length * 3); solid.forEach((j, k) => sp.set(c1.positions.subarray(j * 3, j * 3 + 3), k * 3));
  const tree = new KDTree(sp, solid.length);
  let boxP: Vec3 = [0, 0, 0], bestD = -1;
  for (let t = 0; t < 400; t++) {
    const i = rng.int(c1.count); if (lab[i] !== 1) continue;
    const x = c1.positions[i * 3], y = c1.positions[i * 3 + 1], r = tree.nearest(x, y, 0.4, Infinity);
    if (r.index >= 0 && r.dist2 > bestD) { bestD = r.dist2; boxP = [x, y, 0]; }
  }
  const box: number[][] = [], bs = 0.5, bh = 0.6, step = 0.025;
  const face = (f: (u: number, v: number) => Vec3, ru: number, rv: number) => { for (let u = 0; u <= ru; u += step) for (let v = 0; v <= rv; v += step) box.push(f(u, v)); };
  face((u, v) => [u - bs / 2, v - bs / 2, bh], bs, bs);
  face((u, v) => [u - bs / 2, -bs / 2, v], bs, bh); face((u, v) => [u - bs / 2, bs / 2, v], bs, bh);
  face((u, v) => [-bs / 2, u - bs / 2, v], bs, bh); face((u, v) => [bs / 2, u - bs / 2, v], bs, bh);

  const gone = new Set<number>(), shift = new Map<number, Vec3>();
  let boxOn = false;
  const moveObj = (g: number[], d: Vec3) => { for (const i of g) shift.set(i, d); };
  const steps: { name: string; note: string; apply: () => TruthEvent[] }[] = [
    { name: 'Visit 1', note: 'The room as first scanned.', apply: () => [] },
    { name: 'Visit 2', note: 'A piece of furniture is pushed aside.', apply: () => {
      const g = objs[2], c0 = centroid(c1, g), d: Vec3 = [0.9, 0.5, 0]; moveObj(g, d);
      return [{ kind: 'removed', label: `${name(g)} (old place)`, center: c0 }, { kind: 'added', label: `${name(g)} (new place)`, center: [c0[0] + d[0], c0[1] + d[1], c0[2]] }];
    } },
    { name: 'Visit 3', note: 'The biggest piece of furniture is taken away.', apply: () => { const g = objs[0]; for (const i of g) gone.add(i); return [{ kind: 'removed', label: name(g), center: centroid(c1, g) }]; } },
    { name: 'Visit 4', note: 'A box is left on the floor.', apply: () => { boxOn = true; return [{ kind: 'added', label: 'New box', center: [boxP[0], boxP[1], bh / 2] }]; } },
    { name: 'Visit 5', note: 'Another piece moves and a small one goes.', apply: () => {
      const g = objs[3], c0 = centroid(c1, g), d: Vec3 = [-0.6, 0.7, 0]; moveObj(g, d);
      const h = objs[4]; for (const i of h) gone.add(i);
      return [{ kind: 'removed', label: `${name(g)} (old place)`, center: c0 }, { kind: 'added', label: `${name(g)} (new place)`, center: [c0[0] + d[0], c0[1] + d[1], c0[2]] }, { kind: 'removed', label: name(h), center: centroid(c1, h) }];
    } },
  ];
  return steps.map((st, k) => {
    const truth = st.apply();
    const pos: number[] = [], col: number[] = [], labs: number[] = [];
    for (let i = 0; i < c1.count; i++) {
      if (gone.has(i)) continue;
      const d = shift.get(i);
      pos.push(c1.positions[i * 3] + (d?.[0] ?? 0), c1.positions[i * 3 + 1] + (d?.[1] ?? 0), c1.positions[i * 3 + 2] + (d?.[2] ?? 0));
      col.push(c1.colors![i * 3], c1.colors![i * 3 + 1], c1.colors![i * 3 + 2]); labs.push(lab[i]);
    }
    if (boxOn) for (const p of box) { pos.push(boxP[0] + p[0], boxP[1] + p[1], p[2]); col.push(200, 120, 60); labs.push(6); }
    const out = newCloud(pos.length / 3, st.name, { kind: 'measured', source: 'classroom scan, later visit' });
    out.positions = Float32Array.from(pos); out.colors = Uint8Array.from(col); out.labels = Int32Array.from(labs);
    const r = makeRng(seed + 100 + k);
    for (let i = 0; i < out.positions.length; i++) out.positions[i] += 0.004 * r.gauss();
    return { name: st.name, note: st.note, cloud: out, truth };
  });
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

