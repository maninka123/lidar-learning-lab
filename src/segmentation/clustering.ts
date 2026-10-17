import { KDTree } from '../core/kdtree';

/** DBSCAN. Returns labels (−1 = noise) and cluster count. */
export function dbscan(pos: Float32Array, n: number, eps: number, minPts: number): { labels: Int32Array; clusters: number } {
  const labels = new Int32Array(n).fill(-2); // -2 unvisited, -1 noise
  const tree = new KDTree(pos, n);
  let cluster = 0;
  const nbrs = (i: number): number[] => {
    const out: number[] = [];
    tree.radius(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], eps, (j) => out.push(j));
    return out;
  };
  for (let i = 0; i < n; i++) {
    if (labels[i] !== -2) continue;
    const nb = nbrs(i);
    if (nb.length < minPts) { labels[i] = -1; continue; }
    labels[i] = cluster;
    const queue = nb.slice();
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (labels[j] === -1) labels[j] = cluster;
      if (labels[j] !== -2) continue;
      labels[j] = cluster;
      const nb2 = nbrs(j);
      if (nb2.length >= minPts) for (const k of nb2) if (labels[k] === -2 || labels[k] === -1) queue.push(k);
    }
    cluster++;
  }
  return { labels, clusters: cluster };
}

/** Euclidean clustering (connected components under a distance threshold) with min / max cluster size. */
export function euclideanClustering(pos: Float32Array, n: number, radius: number, minSize: number, maxSize = Infinity): { labels: Int32Array; clusters: number } {
  const labels = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const tree = new KDTree(pos, n);
  let cluster = 0;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const comp: number[] = [i];
    seen[i] = 1;
    for (let q = 0; q < comp.length; q++) {
      const j = comp[q];
      tree.radius(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], radius, (k) => { if (!seen[k]) { seen[k] = 1; comp.push(k); } });
    }
    if (comp.length >= minSize && comp.length <= maxSize) {
      for (const j of comp) labels[j] = cluster;
      cluster++;
    }
  }
  return { labels, clusters: cluster };
}
