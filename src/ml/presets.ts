import type { DataKind, LayerSpec, LayerType, Task } from './nn';

let n = 0;
export const spec = (type: LayerType, size?: number): LayerSpec => ({ id: `L${++n}`, type, size });
export const INPUT_SHAPE: Record<DataKind, number[]> = { image: [16, 16, 1], points: [256, 3] };

/** A model that works, to start from. Images and point clouds get the same plan, block for block. The last layer is added automatically. */
export function starter(task: Task, kind: DataKind): LayerSpec[] {
  if (task === 'seg') return [spec('conv', 16), spec('relu'), spec('pool'), spec('conv', 24), spec('relu'), spec('upsample'), spec('conv', 16), spec('relu')];
  return [spec('conv', 16), spec('relu'), spec('pool'), spec('conv', 16), spec('relu'), spec('pool'), spec('conv', 16), spec('relu'), spec(kind === 'image' ? 'flatten' : 'globalmax'), spec('dense', 16), spec('relu')];
}
