import { PointCloud } from '../core/pointcloud';
import { Rigid, rigidFromEuler, D2R, Vec3 } from '../core/math';
import * as ops from './ops';

export type OpSpec =
  | { type: 'crop'; min: Vec3; max: Vec3; invert?: boolean }
  | { type: 'voxel'; size: number }
  | { type: 'random'; ratio: number }
  | { type: 'noise'; sigma: number }
  | { type: 'outliers'; fraction: number }
  | { type: 'dropout'; p: number }
  | { type: 'sor'; k: number; std: number }
  | { type: 'ror'; radius: number; minN: number }
  | { type: 'normals'; k: number }
  | { type: 'rigid'; tx: number; ty: number; tz: number; yaw: number; pitch: number; roll: number };

export type OpType = OpSpec['type'];

export const OP_LABEL: Record<OpType, string> = {
  crop: 'Crop box', voxel: 'Voxel downsample', random: 'Random downsample', noise: 'Gaussian noise', outliers: 'Inject outliers',
  dropout: 'Random dropout', sor: 'Statistical outlier removal', ror: 'Radius outlier removal', normals: 'Estimate normals', rigid: 'Rigid transform',
};

export function defaultOp(type: OpType): OpSpec {
  switch (type) {
    case 'crop': return { type, min: [-3, -2, 0], max: [3, 2, 2.5] };
    case 'voxel': return { type, size: 0.1 };
    case 'random': return { type, ratio: 0.5 };
    case 'noise': return { type, sigma: 0.02 };
    case 'outliers': return { type, fraction: 0.03 };
    case 'dropout': return { type, p: 0.2 };
    case 'sor': return { type, k: 16, std: 1.5 };
    case 'ror': return { type, radius: 0.25, minN: 4 };
    case 'normals': return { type, k: 16 };
    case 'rigid': return { type, tx: 0.3, ty: 0, tz: 0, yaw: 10, pitch: 0, roll: 0 };
  }
}

export function applyOp(c: PointCloud, op: OpSpec, seed: number): PointCloud {
  switch (op.type) {
    case 'crop': return ops.cropBox(c, op.min, op.max, op.invert);
    case 'voxel': return ops.voxelDownsample(c, op.size);
    case 'random': return ops.randomDownsample(c, op.ratio, seed);
    case 'noise': return ops.gaussianNoise(c, op.sigma, seed);
    case 'outliers': return ops.addOutliers(c, op.fraction, seed);
    case 'dropout': return ops.dropout(c, op.p, seed);
    case 'sor': return ops.statisticalOutlierRemoval(c, op.k, op.std);
    case 'ror': return ops.radiusOutlierRemoval(c, op.radius, op.minN);
    case 'normals': return ops.estimateNormals(c, op.k);
    case 'rigid': {
      const T: Rigid = rigidFromEuler(op.tx, op.ty, op.tz, op.yaw * D2R, op.pitch * D2R, op.roll * D2R);
      return ops.rigidTransform(c, T);
    }
  }
}

export interface StepResult { op: OpSpec; cloud: PointCloud; before: number; after: number; ms: number; injectedRemoved?: number; originalLost?: number }

export interface PipelineResult { steps: StepResult[]; final: PointCloud; totalMs: number }

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Runs the steps on an immutable original. The original is never modified. */
export function runPipeline(original: PointCloud, steps: OpSpec[], seed: number): PipelineResult {
  let cur = original;
  const res: StepResult[] = [];
  const t0 = now();
  steps.forEach((op, i) => {
    const s = now();
    const next = applyOp(cur, op, seed + i * 7919);
    const r: StepResult = { op, cloud: next, before: cur.count, after: next.count, ms: now() - s };
    if (cur.tags && next.tags && (op.type === 'sor' || op.type === 'ror')) {
      let inj0 = 0, inj1 = 0;
      for (let k = 0; k < cur.count; k++) inj0 += cur.tags[k];
      for (let k = 0; k < next.count; k++) inj1 += next.tags[k];
      r.injectedRemoved = inj0 - inj1;
      r.originalLost = cur.count - inj0 - (next.count - inj1);
    }
    res.push(r);
    cur = next;
  });
  return { steps: res, final: cur, totalMs: now() - t0 };
}
