import { PointCloud } from '../core/pointcloud';
import { detectPlanes, PlaneKind } from '../apps/planes';
import { dbscan, euclideanClustering } from './clustering';

export type ClusterAlgo = 'euclidean' | 'dbscan' | 'none';
export interface SegParams {
  planeConfidence: number; // RANSAC: how sure to be of finding each plane (0.9 .. 0.999)
  planeMinPct: number; // smallest plane, % of all points
  planeMax: number; // most planes to take out (0 = none)
  algo: ClusterAlgo;
  eps: number; // DBSCAN eps
  minPts: number; // DBSCAN minPts
  radius: number; // Euclidean cluster tolerance
  minCluster: number;
  seed: number;
}

export interface SegResult {
  /** per-point id: planes 0..P-1, clusters P.., −1 unassigned/noise */
  display: Int32Array;
  planes: { kind: PlaneKind; normal: [number, number, number]; d: number; count: number; rmse: number }[];
  clusters: { id: number; count: number; centroid: [number, number, number]; min: [number, number, number]; max: [number, number, number]; indices: Int32Array }[];
  noise: number;
  ms: number;
  nonPlanar: number;
}

/** `fromPlanes`: reuse the planes of an earlier plane-detection run and only do the clustering stage. */
export function segment(cloud: PointCloud, p: SegParams, fromPlanes?: SegResult): SegResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = cloud.count;
  const display = new Int32Array(n).fill(-1);
  const remaining = new Uint8Array(n).fill(1);
  const planes: SegResult['planes'] = [];
  if (fromPlanes) { planes.push(...fromPlanes.planes); for (let i = 0; i < n; i++) if (fromPlanes.display[i] >= 0 && fromPlanes.display[i] < planes.length) { display[i] = fromPlanes.display[i]; remaining[i] = 0; } }

  const candidates = () => { const a: number[] = []; for (let i = 0; i < n; i++) if (remaining[i]) a.push(i); return Int32Array.from(a); };

  // 1) RANSAC plane detection (the settings that matter are measured from the data); planes are taken out before clustering
  if (!fromPlanes && p.planeMax > 0) {
    const run = detectPlanes(cloud.positions, n, null, { mode: 'adaptive', threshold: 0.02, iterations: 100, confidence: p.planeConfidence, minFraction: p.planeMinPct / 100, maxPlanes: p.planeMax, seed: p.seed });
    // only the room itself (floor, ceiling, walls) is taken out: table tops and other flat things are objects
    run.planes.filter((pl) => pl.kind === 'floor' || pl.kind === 'ceiling' || pl.kind === 'wall').forEach((pl) => {
      for (const i of pl.inliers) { display[i] = planes.length; remaining[i] = 0; }
      planes.push({ kind: pl.kind, normal: pl.normal, d: pl.d, count: pl.inliers.length, rmse: pl.sigma });
    });
  }

  const rest = candidates();
  const clusters: SegResult['clusters'] = [];
  let noise = 0;
  if (p.algo !== 'none' && rest.length > 0) {
    const sub = new Float32Array(rest.length * 3);
    for (let i = 0; i < rest.length; i++) {
      sub[i * 3] = cloud.positions[rest[i] * 3]; sub[i * 3 + 1] = cloud.positions[rest[i] * 3 + 1]; sub[i * 3 + 2] = cloud.positions[rest[i] * 3 + 2];
    }
    const res = p.algo === 'dbscan' ? dbscan(sub, rest.length, p.eps, p.minPts) : euclideanClustering(sub, rest.length, p.radius, p.minCluster);
    const buckets: number[][] = Array.from({ length: res.clusters }, () => []);
    for (let i = 0; i < rest.length; i++) if (res.labels[i] >= 0) buckets[res.labels[i]].push(rest[i]);
    let id = 0;
    for (const b of buckets) {
      if (b.length < (p.algo === 'dbscan' ? p.minCluster : 1)) continue; // drop tiny clusters
      const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      let cx = 0, cy = 0, cz = 0;
      for (const i of b) {
        display[i] = planes.length + id;
        for (let a = 0; a < 3; a++) { const v = cloud.positions[i * 3 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
        cx += cloud.positions[i * 3]; cy += cloud.positions[i * 3 + 1]; cz += cloud.positions[i * 3 + 2];
      }
      clusters.push({ id: planes.length + id, count: b.length, centroid: [cx / b.length, cy / b.length, cz / b.length], min, max, indices: Int32Array.from(b) });
      id++;
    }
    noise = rest.length - clusters.reduce((a, c) => a + c.count, 0);
  } else noise = rest.length;
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { display, planes, clusters, noise, ms: t1 - t0, nonPlanar: rest.length };
}

/** Compare clusters against ground-truth instance ids (only valid for simulated, labelled data). */
export function evaluateAgainstGT(cloud: PointCloud, res: SegResult, ignoreInstances: Set<number>) {
  if (!cloud.instances) return null;
  const gtCounts = new Map<number, number>();
  for (let i = 0; i < cloud.count; i++) { const g = cloud.instances[i]; if (!ignoreInstances.has(g)) gtCounts.set(g, (gtCounts.get(g) ?? 0) + 1); }
  const matches: { gt: number; cluster: number; iou: number; purity: number }[] = [];
  const split = new Map<number, number>(); // gt -> #clusters with >=10% of the gt points
  const merged = new Map<number, number>(); // cluster -> #gt with >=10% of the cluster points
  for (const c of res.clusters) {
    const inCluster = new Map<number, number>();
    for (const i of c.indices) { const g = cloud.instances[i]; inCluster.set(g, (inCluster.get(g) ?? 0) + 1); }
    let bestG = -1, bestN = 0, nObj = 0;
    for (const [g, k] of inCluster) {
      if (ignoreInstances.has(g)) continue;
      if (k > bestN) { bestN = k; bestG = g; }
      if (k >= 0.1 * c.count) nObj++;
      if (k >= 0.1 * (gtCounts.get(g) ?? 1)) split.set(g, (split.get(g) ?? 0) + 1);
    }
    merged.set(c.id, nObj);
    if (bestG >= 0) {
      const gt = gtCounts.get(bestG) ?? 1;
      matches.push({ gt: bestG, cluster: c.id, iou: bestN / (c.count + gt - bestN), purity: bestN / c.count });
    }
  }
  const best = new Map<number, { gt: number; cluster: number; iou: number; purity: number }>();
  for (const m of matches) { const b = best.get(m.gt); if (!b || m.iou > b.iou) best.set(m.gt, m); }
  const overSegmented = [...split.values()].filter((v) => v > 1).length;
  const underSegmented = [...merged.values()].filter((v) => v > 1).length;
  const recovered = [...best.values()].filter((m) => m.iou >= 0.5 && m.purity >= 0.7);
  return { gtObjects: gtCounts.size, recovered, overSegmented, underSegmented, matches: [...best.values()] };
}
