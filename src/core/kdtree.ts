/** Static 3D k-d tree over a flat xyz array. Median-split, implicit layout. */
export class KDTree {
  readonly pos: Float32Array;
  readonly n: number;
  private idx: Uint32Array;

  constructor(pos: Float32Array, n = pos.length / 3) {
    this.pos = pos;
    this.n = n;
    this.idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.idx[i] = i;
    this.build(0, n, 0);
  }

  private select(lo: number, hi: number, k: number, ax: number) {
    const idx = this.idx, pos = this.pos;
    let l = lo, r = hi - 1;
    while (l < r) {
      const pivot = pos[idx[(l + r) >> 1] * 3 + ax];
      let i = l, j = r;
      while (i <= j) {
        while (pos[idx[i] * 3 + ax] < pivot) i++;
        while (pos[idx[j] * 3 + ax] > pivot) j--;
        if (i <= j) {
          const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
          i++; j--;
        }
      }
      if (k <= j) r = j;
      else if (k >= i) l = i;
      else break;
    }
  }

  private build(lo: number, hi: number, depth: number) {
    if (hi - lo <= 1) return;
    const mid = (lo + hi) >> 1;
    const ax = depth % 3;
    this.select(lo, hi, mid, ax);
    this.build(lo, mid, depth + 1);
    this.build(mid + 1, hi, depth + 1);
  }

  nearest(x: number, y: number, z: number, maxDist2 = Infinity): { index: number; dist2: number } {
    const best = { index: -1, dist2: maxDist2 };
    this.nn(0, this.n, 0, x, y, z, best);
    return best;
  }

  private nn(lo: number, hi: number, depth: number, x: number, y: number, z: number, best: { index: number; dist2: number }) {
    if (hi <= lo) return;
    const mid = (lo + hi) >> 1;
    const pi = this.idx[mid];
    const p = this.pos;
    const dx = p[pi * 3] - x, dy = p[pi * 3 + 1] - y, dz = p[pi * 3 + 2] - z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best.dist2) { best.dist2 = d2; best.index = pi; }
    const ax = depth % 3;
    const diff = ax === 0 ? -dx : ax === 1 ? -dy : -dz; // query - node
    const nearFirst = diff < 0;
    if (nearFirst) this.nn(lo, mid, depth + 1, x, y, z, best);
    else this.nn(mid + 1, hi, depth + 1, x, y, z, best);
    if (diff * diff < best.dist2) {
      if (nearFirst) this.nn(mid + 1, hi, depth + 1, x, y, z, best);
      else this.nn(lo, mid, depth + 1, x, y, z, best);
    }
  }

  /** k nearest neighbours (includes the query point itself if it is in the set). Sorted ascending. */
  knn(x: number, y: number, z: number, k: number): { idx: number[]; d2: number[] } {
    const idx: number[] = [];
    const d2: number[] = [];
    this.knnRec(0, this.n, 0, x, y, z, k, idx, d2);
    return { idx, d2 };
  }

  private knnRec(lo: number, hi: number, depth: number, x: number, y: number, z: number, k: number, oi: number[], od: number[]) {
    if (hi <= lo) return;
    const mid = (lo + hi) >> 1;
    const pi = this.idx[mid];
    const p = this.pos;
    const dx = p[pi * 3] - x, dy = p[pi * 3 + 1] - y, dz = p[pi * 3 + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (od.length < k || d < od[od.length - 1]) {
      let j = od.length;
      od.push(d); oi.push(pi);
      while (j > 0 && od[j - 1] > d) { od[j] = od[j - 1]; oi[j] = oi[j - 1]; j--; }
      od[j] = d; oi[j] = pi;
      if (od.length > k) { od.pop(); oi.pop(); }
    }
    const ax = depth % 3;
    const diff = ax === 0 ? -dx : ax === 1 ? -dy : -dz;
    const nearFirst = diff < 0;
    if (nearFirst) this.knnRec(lo, mid, depth + 1, x, y, z, k, oi, od);
    else this.knnRec(mid + 1, hi, depth + 1, x, y, z, k, oi, od);
    if (od.length < k || diff * diff < od[od.length - 1]) {
      if (nearFirst) this.knnRec(mid + 1, hi, depth + 1, x, y, z, k, oi, od);
      else this.knnRec(lo, mid, depth + 1, x, y, z, k, oi, od);
    }
  }

  /** All points within radius r. Calls cb(index, dist2). */
  radius(x: number, y: number, z: number, r: number, cb: (i: number, d2: number) => void) {
    this.radRec(0, this.n, 0, x, y, z, r * r, cb);
  }

  private radRec(lo: number, hi: number, depth: number, x: number, y: number, z: number, r2: number, cb: (i: number, d2: number) => void) {
    if (hi <= lo) return;
    const mid = (lo + hi) >> 1;
    const pi = this.idx[mid];
    const p = this.pos;
    const dx = p[pi * 3] - x, dy = p[pi * 3 + 1] - y, dz = p[pi * 3 + 2] - z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d <= r2) cb(pi, d);
    const ax = depth % 3;
    const diff = ax === 0 ? -dx : ax === 1 ? -dy : -dz;
    if (diff < 0 || diff * diff <= r2) this.radRec(lo, mid, depth + 1, x, y, z, r2, cb);
    if (diff >= 0 || diff * diff <= r2) this.radRec(mid + 1, hi, depth + 1, x, y, z, r2, cb);
  }
}
