import { KDTree } from '../core/kdtree';
import type { PointCloud } from '../core/pointcloud';
import { referenceOf } from './grade';
import { zoneAt, type Factory } from './factory';

export interface MeasuredCoverage { overall: number; critical: number; overlap: number; density: number; zones: Record<string, number>; positions: Float32Array; colours: Uint8Array }
/** Samples are reached only when measured returns are within 15 cm. Multiple independent scanner views are tracked separately. */
export function measuredCoverage(f: Factory, clouds: PointCloud[]): MeasuredCoverage {
  const samples = referenceOf(f, 12000).samples, trees = clouds.filter((c) => c.count).map((c) => new KDTree(c.positions, c.count));
  let total = 0, seen = 0, criticalTotal = 0, criticalSeen = 0, overlap = 0;
  const pos: number[] = [], rgb: number[] = [], zones: Record<string, { all: number; seen: number }> = {};
  for (let i = 0; i < samples.count; i++) {
    const x = samples.pos[i * 3], y = samples.pos[i * 3 + 1], z = samples.pos[i * 3 + 2]; if (z > 3) continue;
    const area = samples.area[i], zone = zoneAt(x, y), critical = ['production', 'inspection', 'loading'].includes(zone);
    const n = trees.reduce((a, tree) => a + Number(tree.nearest(x, y, z, 0.15 ** 2).index >= 0), 0);
    total += area; if (n) seen += area; if (n > 1) overlap += area;
    if (critical) { criticalTotal += area; if (n) criticalSeen += area; }
    zones[zone] ??= { all: 0, seen: 0 }; zones[zone].all += area; if (n) zones[zone].seen += area;
    pos.push(x, y, z); rgb.push(...(n === 0 ? [230, 57, 70] : n === 1 ? [235, 184, 40] : n === 2 ? [40, 170, 90] : [29, 120, 220]));
  }
  return { overall: total ? seen / total : 0, critical: criticalTotal ? criticalSeen / criticalTotal : 0, overlap: total ? overlap / total : 0, density: seen ? clouds.reduce((a, c) => a + c.count, 0) / seen : 0, zones: Object.fromEntries(Object.entries(zones).map(([k, v]) => [k, v.all ? v.seen / v.all : 0])), positions: Float32Array.from(pos), colours: Uint8Array.from(rgb) };
}
