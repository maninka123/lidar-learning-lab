import { KDTree } from '../core/kdtree';
import type { PointCloud } from '../core/pointcloud';
import { referenceOf } from './grade';
import { zoneAt, type Factory } from './factory';

export interface MeasuredCoverage { overall: number; critical: number; overlap: number; density: number; zones: Record<string, number>; /** measured points per square metre of each zone's surface (up to 3 m high) */ zoneDensity: Record<string, number>; /** the same two measures for each scanner on its own, in the order of the clouds: the share of each zone it reaches, and the points per m² it gives that zone */ perScanner: { coverage: Record<string, number>; density: Record<string, number> }[]; positions: Float32Array; colours: Uint8Array }
/** Samples are reached only when measured returns are within 15 cm. Multiple independent scanner views are tracked separately. */
export function measuredCoverage(f: Factory, clouds: PointCloud[]): MeasuredCoverage {
  const samples = referenceOf(f, 12000).samples, trees = clouds.map((c) => (c.count ? new KDTree(c.positions, c.count) : null)); // one per scanner, in order
  let total = 0, seen = 0, criticalTotal = 0, criticalSeen = 0, overlap = 0;
  const pos: number[] = [], rgb: number[] = [], zones: Record<string, { all: number; seen: number }> = {}, by: Record<string, number>[] = clouds.map(() => ({}));
  for (let i = 0; i < samples.count; i++) {
    const x = samples.pos[i * 3], y = samples.pos[i * 3 + 1], z = samples.pos[i * 3 + 2]; if (z > 3) continue;
    const area = samples.area[i], zone = zoneAt(x, y), critical = ['production', 'inspection', 'loading'].includes(zone);
    const hits = trees.map((tree) => !!tree && tree.nearest(x, y, z, 0.15 ** 2).index >= 0), n = hits.reduce((a, h) => a + Number(h), 0);
    total += area; if (n) seen += area; if (n > 1) overlap += area;
    if (critical) { criticalTotal += area; if (n) criticalSeen += area; }
    zones[zone] ??= { all: 0, seen: 0 }; zones[zone].all += area; if (n) zones[zone].seen += area;
    hits.forEach((h, k) => { if (h) { by[k][zone] = (by[k][zone] ?? 0) + area; } });
    pos.push(x, y, z); rgb.push(...(n === 0 ? [230, 57, 70] : n === 1 ? [235, 184, 40] : n === 2 ? [40, 170, 90] : [29, 120, 220]));
  }
  const pts: Record<string, number> = {};
  for (const c of clouds) for (let i = 0; i < c.count; i++) { if (c.positions[i * 3 + 2] > 3) continue; const zn = zoneAt(c.positions[i * 3], c.positions[i * 3 + 1]); pts[zn] = (pts[zn] ?? 0) + 1; }
  const ptsBy = clouds.map((c) => { const m: Record<string, number> = {}; for (let i = 0; i < c.count; i++) { if (c.positions[i * 3 + 2] > 3) continue; const zn = zoneAt(c.positions[i * 3], c.positions[i * 3 + 1]); m[zn] = (m[zn] ?? 0) + 1; } return m; });
  const perScanner = clouds.map((_, k) => ({ coverage: Object.fromEntries(Object.entries(zones).map(([z, v]) => [z, v.all ? (by[k][z] ?? 0) / v.all : 0])), density: Object.fromEntries(Object.entries(zones).map(([z, v]) => [z, v.all ? (ptsBy[k][z] ?? 0) / v.all : 0])) }));
  const zoneDensity = Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, v.all ? (pts[k] ?? 0) / v.all : 0]));
  return { overall: total ? seen / total : 0, critical: criticalTotal ? criticalSeen / criticalTotal : 0, overlap: total ? overlap / total : 0, density: seen ? clouds.reduce((a, c) => a + c.count, 0) / seen : 0, zoneDensity, perScanner, zones: Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, v.all ? v.seen / v.all : 0])), positions: Float32Array.from(pos), colours: Uint8Array.from(rgb) };
}
