import { SceneDef, objectAABB } from '../scenes/geometry';
import { className } from '../scenes/classes';
import { Vec3, dist } from '../core/math';
import type { SegResult } from '../segmentation/segment';

export interface GraphNode {
  id: string;
  label: string;
  classId: number;
  position: Vec3; // AABB centre, world metres
  dimensions: Vec3; // AABB size
  bbox: { min: Vec3; max: Vec3 };
  structural: boolean;
  source: 'ground-truth annotation' | 'rule-based estimate (from clusters)';
  confidence: number | null; // null = not applicable (ground truth)
  instanceId?: number;
  classLabel?: string; // class name when it is not one of the built-in scene classes
}
export type RelType = 'near' | 'above' | 'below' | 'inside' | 'left_of' | 'right_of' | 'intersects' | 'blocks_path';
export interface GraphEdge { from: string; to: string; type: RelType; value?: number; note?: string }
export interface SceneGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  scanner: { pos: Vec3; yaw: number };
  corridor?: { start: [number, number]; end: [number, number]; width: number; height: number };
  nearThreshold: number;
}

export const REL_LABEL: Record<RelType, string> = {
  near: 'near', above: 'above', below: 'below', inside: 'inside', left_of: 'left of', right_of: 'right of', intersects: 'intersects', blocks_path: 'blocks path',
};

export function nodesFromScene(scene: SceneDef): GraphNode[] {
  return scene.objects.filter((o) => o.scannable).map((o) => {
    const b = objectAABB(o);
    return {
      id: o.id, label: o.name, classId: o.classId,
      position: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] as Vec3,
      dimensions: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as Vec3,
      bbox: b, structural: !!o.structural, source: 'ground-truth annotation' as const, confidence: null, instanceId: o.instanceId,
    };
  });
}

/** Very small rule-based labeller: classes guessed from bounding-box size only. Deliberately simple, deliberately imperfect. */
export function guessClass(dim: Vec3, zMin: number): { classId: number; confidence: number } {
  const [x, y, z] = dim;
  const foot = Math.max(x, y), small = Math.min(x, y);
  if (z > 2.2 && foot < 1) return { classId: 8, confidence: 0.5 };
  if (z >= 0.55 && z <= 1.1 && foot <= 0.65 && small <= 0.65) return { classId: 5, confidence: 0.55 };
  if (z >= 0.6 && z <= 0.9 && foot >= 1.0 && small >= 0.5) return { classId: 4, confidence: 0.6 };
  if (Math.max(x, y, z) < 1.1 && zMin < 0.2) return { classId: 6, confidence: 0.5 };
  if (foot > 3) return { classId: 15, confidence: 0.4 };
  return { classId: 20, confidence: 0.3 };
}

export function nodesFromSegmentation(seg: SegResult): GraphNode[] {
  return seg.clusters.map((c, i) => {
    const dim: Vec3 = [c.max[0] - c.min[0], c.max[1] - c.min[1], c.max[2] - c.min[2]];
    const g = guessClass(dim, c.min[2]);
    return {
      id: `cluster-${i + 1}`, label: `${className(g.classId)} (estimated)`, classId: g.classId, position: [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2] as Vec3,
      dimensions: dim, bbox: { min: c.min, max: c.max }, structural: false, source: 'rule-based estimate (from clusters)' as const, confidence: g.confidence,
    };
  });
}

const overlap1 = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

export function aabbGap(a: GraphNode, b: GraphNode): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(0, Math.max(a.bbox.min[k] - b.bbox.max[k], b.bbox.min[k] - a.bbox.max[k]));
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Gap from the scanner position to the node's bounding box surface (0 if inside). */
export function scannerGap(pos: Vec3, n: GraphNode): number {
  let s = 0;
  for (let k = 0; k < 3; k++) {
    const d = Math.max(0, n.bbox.min[k] - pos[k], pos[k] - n.bbox.max[k]);
    s += d * d;
  }
  return Math.sqrt(s);
}

export function corridorBlocks(n: GraphNode, c: NonNullable<SceneGraph['corridor']>): boolean {
  const dx = c.end[0] - c.start[0], dy = c.end[1] - c.start[1];
  const L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
  for (const x of [n.bbox.min[0], n.bbox.max[0]]) for (const y of [n.bbox.min[1], n.bbox.max[1]]) {
    const along = (x - c.start[0]) * ux + (y - c.start[1]) * uy, across = -(x - c.start[0]) * uy + (y - c.start[1]) * ux;
    lo = Math.min(lo, along); hi = Math.max(hi, along); wlo = Math.min(wlo, across); whi = Math.max(whi, across);
  }
  return overlap1(lo, hi, 0, L) > 0.02 && overlap1(wlo, whi, -c.width / 2, c.width / 2) > 0.02 && n.bbox.min[2] < c.height && n.bbox.max[2] > 0.05;
}

export function buildGraph(nodes: GraphNode[], scanner: { pos: Vec3; yaw: number }, corridor: SceneGraph['corridor'], nearThreshold = 0.5): SceneGraph {
  const edges: GraphEdge[] = [];
  const objs = nodes.filter((n) => !n.structural);
  const left: Vec3 = [-Math.sin(scanner.yaw), Math.cos(scanner.yaw), 0];
  const tol = 0.05;
  const room = nodes.filter((n) => n.structural);
  // inside the room volume (union bbox of structural nodes)
  if (room.length) {
    const rmin: Vec3 = [Infinity, Infinity, Infinity], rmax: Vec3 = [-Infinity, -Infinity, -Infinity];
    room.forEach((r) => { for (let k = 0; k < 3; k++) { rmin[k] = Math.min(rmin[k], r.bbox.min[k]); rmax[k] = Math.max(rmax[k], r.bbox.max[k]); } });
    const roomNode: GraphNode = { id: 'scene', label: 'Scene volume', classId: 0, position: [0, 0, 0], dimensions: [0, 0, 0], bbox: { min: rmin, max: rmax }, structural: true, source: 'ground-truth annotation', confidence: null };
    for (const o of objs) if ([0, 1, 2].every((k) => o.bbox.min[k] >= rmin[k] - 1e-6 && o.bbox.max[k] <= rmax[k] + 1e-6)) edges.push({ from: o.id, to: roomNode.id, type: 'inside' });
  }
  for (let i = 0; i < objs.length; i++) for (let j = 0; j < objs.length; j++) {
    if (i === j) continue;
    const a = objs[i], b = objs[j];
    const gap = aabbGap(a, b);
    const xy = overlap1(a.bbox.min[0], a.bbox.max[0], b.bbox.min[0], b.bbox.max[0]) > 0 && overlap1(a.bbox.min[1], a.bbox.max[1], b.bbox.min[1], b.bbox.max[1]) > 0;
    if (i < j) {
      if (gap <= nearThreshold) edges.push({ from: a.id, to: b.id, type: 'near', value: gap });
      const ov = [0, 1, 2].every((k) => overlap1(a.bbox.min[k], a.bbox.max[k], b.bbox.min[k], b.bbox.max[k]) > 0.005);
      if (ov) edges.push({ from: a.id, to: b.id, type: 'intersects', value: gap, note: 'bounding boxes overlap (conservative: AABB)' });
    }
    if (xy && a.bbox.min[2] >= b.bbox.max[2] - tol) {
      edges.push({ from: a.id, to: b.id, type: 'above', value: a.bbox.min[2] - b.bbox.max[2] });
      edges.push({ from: b.id, to: a.id, type: 'below', value: a.bbox.min[2] - b.bbox.max[2] });
    }
    const contained = [0, 1, 2].every((k) => a.bbox.min[k] >= b.bbox.min[k] - 0.01 && a.bbox.max[k] <= b.bbox.max[k] + 0.01);
    if (contained && (a.dimensions[0] < b.dimensions[0] || a.dimensions[1] < b.dimensions[1] || a.dimensions[2] < b.dimensions[2])) edges.push({ from: a.id, to: b.id, type: 'inside' });
    // left / right relative to the scanner heading, only for objects that do not overlap laterally
    const dl = (a.position[0] - b.position[0]) * left[0] + (a.position[1] - b.position[1]) * left[1];
    if (i < j && !xy && Math.abs(dl) > 0.3 && gap < 3) {
      if (dl > 0) { edges.push({ from: a.id, to: b.id, type: 'left_of', value: dl }); edges.push({ from: b.id, to: a.id, type: 'right_of', value: dl }); }
      else { edges.push({ from: b.id, to: a.id, type: 'left_of', value: -dl }); edges.push({ from: a.id, to: b.id, type: 'right_of', value: -dl }); }
    }
  }
  if (corridor) for (const o of objs) if (corridorBlocks(o, corridor)) edges.push({ from: o.id, to: 'corridor', type: 'blocks_path' });
  return { nodes, edges, scanner, corridor, nearThreshold };
}

export const centreDistance = (a: GraphNode, b: GraphNode) => dist(a.position, b.position);
