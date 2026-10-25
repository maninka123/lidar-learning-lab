import { PointCloud } from '../core/pointcloud';
import { KDTree } from '../core/kdtree';

export interface Mesh { positions: Float32Array; indices: Uint32Array }

/** 2.5D height-map mesh: one vertex per grid cell (mean height), two triangles per 2 × 2 block of filled cells. Good for floors, terrain and roofs, wrong for overhangs. */
export function heightMapMesh(c: PointCloud, cell: number, maxJump = 0.35): Mesh {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.count; i++) { x0 = Math.min(x0, c.positions[i * 3]); x1 = Math.max(x1, c.positions[i * 3]); y0 = Math.min(y0, c.positions[i * 3 + 1]); y1 = Math.max(y1, c.positions[i * 3 + 1]); }
  const w = Math.max(2, Math.ceil((x1 - x0) / cell) + 1), h = Math.max(2, Math.ceil((y1 - y0) / cell) + 1);
  const sum = new Float32Array(w * h), cnt = new Uint16Array(w * h);
  for (let i = 0; i < c.count; i++) { const ix = Math.floor((c.positions[i * 3] - x0) / cell), iy = Math.floor((c.positions[i * 3 + 1] - y0) / cell); sum[iy * w + ix] += c.positions[i * 3 + 2]; cnt[iy * w + ix]++; }
  // heights per cell, then fill small holes from their neighbours (twice), so a sparse scan still joins up
  let z = new Float32Array(w * h).fill(NaN);
  for (let k = 0; k < w * h; k++) if (cnt[k]) z[k] = sum[k] / cnt[k];
  for (let pass = 0; pass < 2; pass++) {
    const nz = z.slice();
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      const k = j * w + i; if (!Number.isNaN(z[k])) continue;
      let s = 0, n = 0, lo = Infinity, hi = -Infinity;
      for (const d of [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1]) { const v = z[k + d]; if (!Number.isNaN(v)) { s += v; n++; lo = Math.min(lo, v); hi = Math.max(hi, v); } }
      if (n >= 3 && hi - lo < maxJump) nz[k] = s / n;
    }
    z = nz;
  }
  const vid = new Int32Array(w * h).fill(-1), pos: number[] = [];
  for (let k = 0; k < w * h; k++) if (!Number.isNaN(z[k])) { vid[k] = pos.length / 3; pos.push(x0 + (k % w) * cell, y0 + Math.floor(k / w) * cell, z[k]); }
  const idx: number[] = [];
  const zOf = (v: number) => pos[v * 3 + 2];
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = vid[j * w + i], b = vid[j * w + i + 1], d = vid[(j + 1) * w + i], e = vid[(j + 1) * w + i + 1];
    const ok = (...v: number[]) => v.every((q) => q >= 0) && Math.max(...v.map(zOf)) - Math.min(...v.map(zOf)) < maxJump;
    if (ok(a, b, e)) idx.push(a, b, e);
    if (ok(a, e, d)) idx.push(a, e, d);
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx) };
}

export function meshStats(m: Mesh): { vertices: number; triangles: number; area: number } {
  let area = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t] * 3, b = m.indices[t + 1] * 3, c = m.indices[t + 2] * 3, p = m.positions;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return { vertices: m.positions.length / 3, triangles: m.indices.length / 3, area };
}

/** Wavefront OBJ text for the mesh (opens in Blender, MeshLab, CloudCompare). */
export function toOBJ(m: Mesh, colors?: Uint8Array | null): string {
  const L: string[] = ['# exported from LiDAR Learning Lab'];
  for (let i = 0; i < m.positions.length; i += 3) L.push(`v ${m.positions[i].toFixed(4)} ${m.positions[i + 1].toFixed(4)} ${m.positions[i + 2].toFixed(4)}${colors ? ` ${(colors[i] / 255).toFixed(3)} ${(colors[i + 1] / 255).toFixed(3)} ${(colors[i + 2] / 255).toFixed(3)}` : ''}`);
  for (let t = 0; t < m.indices.length; t += 3) L.push(`f ${m.indices[t] + 1} ${m.indices[t + 1] + 1} ${m.indices[t + 2] + 1}`);
  return L.join('\n') + '\n';
}

/** Simplify by vertex clustering: snap vertices to a coarser grid (`factor` × the cell size), merge them and drop triangles that collapse. */
export function simplifyMesh(m: Mesh, cell: number, factor: number): Mesh {
  if (factor <= 1) return m;
  const g = cell * factor, map = new Map<string, number>(), remap = new Uint32Array(m.positions.length / 3), sum: number[] = [], cnt: number[] = [];
  for (let i = 0; i < remap.length; i++) {
    const x = m.positions[i * 3], y = m.positions[i * 3 + 1], z = m.positions[i * 3 + 2], k = `${Math.floor(x / g)},${Math.floor(y / g)},${Math.floor(z / g)}`;
    let id = map.get(k);
    if (id === undefined) { id = cnt.length; map.set(k, id); sum.push(0, 0, 0); cnt.push(0); }
    sum[id * 3] += x; sum[id * 3 + 1] += y; sum[id * 3 + 2] += z; cnt[id]++; remap[i] = id;
  }
  const positions = new Float32Array(cnt.length * 3); for (let i = 0; i < cnt.length; i++) { positions[i * 3] = sum[i * 3] / cnt[i]; positions[i * 3 + 1] = sum[i * 3 + 1] / cnt[i]; positions[i * 3 + 2] = sum[i * 3 + 2] / cnt[i]; }
  const idx: number[] = [];
  for (let t = 0; t < m.indices.length; t += 3) { const a = remap[m.indices[t]], b = remap[m.indices[t + 1]], c = remap[m.indices[t + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { positions, indices: Uint32Array.from(idx) };
}

/** Give every mesh vertex the colour of the nearest point of the coloured cloud. */
export function colourFromPoints(m: Mesh, c: PointCloud): Uint8Array | null {
  if (!c.colors) return null;
  const tree = new KDTree(c.positions, c.count), out = new Uint8Array(m.positions.length);
  for (let i = 0; i < m.positions.length / 3; i++) { const r = tree.nearest(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], Infinity); if (r.index >= 0) { out[i * 3] = c.colors[r.index * 3]; out[i * 3 + 1] = c.colors[r.index * 3 + 1]; out[i * 3 + 2] = c.colors[r.index * 3 + 2]; } }
  return out;
}
