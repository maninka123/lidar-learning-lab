import { PointCloud } from '../core/pointcloud';

export interface Mesh { positions: Float32Array; indices: Uint32Array }

/** 2.5D height-map mesh: one vertex per grid cell (mean height), two triangles per 2 × 2 block of filled cells. Good for floors, terrain and roofs, wrong for overhangs. */
export function heightMapMesh(c: PointCloud, cell: number, maxJump = 0.35): Mesh {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < c.count; i++) { x0 = Math.min(x0, c.positions[i * 3]); x1 = Math.max(x1, c.positions[i * 3]); y0 = Math.min(y0, c.positions[i * 3 + 1]); y1 = Math.max(y1, c.positions[i * 3 + 1]); }
  const w = Math.max(2, Math.ceil((x1 - x0) / cell) + 1), h = Math.max(2, Math.ceil((y1 - y0) / cell) + 1);
  const sum = new Float32Array(w * h), cnt = new Uint16Array(w * h);
  for (let i = 0; i < c.count; i++) { const ix = Math.floor((c.positions[i * 3] - x0) / cell), iy = Math.floor((c.positions[i * 3 + 1] - y0) / cell); sum[iy * w + ix] += c.positions[i * 3 + 2]; cnt[iy * w + ix]++; }
  const vid = new Int32Array(w * h).fill(-1), pos: number[] = [];
  for (let k = 0; k < w * h; k++) if (cnt[k]) { vid[k] = pos.length / 3; pos.push(x0 + (k % w) * cell, y0 + Math.floor(k / w) * cell, sum[k] / cnt[k]); }
  const idx: number[] = [];
  const z = (v: number) => pos[v * 3 + 2];
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = vid[j * w + i], b = vid[j * w + i + 1], d = vid[(j + 1) * w + i], e = vid[(j + 1) * w + i + 1];
    const ok = (...v: number[]) => v.every((q) => q >= 0) && Math.max(...v.map(z)) - Math.min(...v.map(z)) < maxJump;
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
export function toOBJ(m: Mesh): string {
  const L: string[] = ['# exported from LiDAR Learning Lab'];
  for (let i = 0; i < m.positions.length; i += 3) L.push(`v ${m.positions[i].toFixed(4)} ${m.positions[i + 1].toFixed(4)} ${m.positions[i + 2].toFixed(4)}`);
  for (let t = 0; t < m.indices.length; t += 3) L.push(`f ${m.indices[t] + 1} ${m.indices[t + 1] + 1} ${m.indices[t + 2] + 1}`);
  return L.join('\n') + '\n';
}
