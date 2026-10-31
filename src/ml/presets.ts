import type { DataKind, LayerSpec, LayerType, Task } from './nn';

let n = 0;
export const spec = (type: LayerType, size?: number): LayerSpec => ({ id: `L${++n}`, type, size });
export const INPUT_SHAPE: Record<DataKind, number[]> = { image: [16, 16, 1], points: [256, 3] };

/** A model that works, to start from. The last layer is added automatically. */
export function starter(task: Task, kind: DataKind): LayerSpec[] {
  if (kind === 'image') {
    if (task === 'seg') return [spec('conv', 8), spec('relu'), spec('pool'), spec('conv', 12), spec('relu'), spec('upsample'), spec('conv', 8), spec('relu')];
    return [spec('conv', 8), spec('relu'), spec('pool'), spec('conv', 8), spec('relu'), spec('pool'), spec('flatten'), spec('dense', 16), spec('relu')];
  }
  if (task === 'seg') return [spec('dense', 24), spec('relu'), spec('dense', 32), spec('relu'), spec('context'), spec('dense', 24), spec('relu')];
  return [spec('dense', 24), spec('relu'), spec('dense', 32), spec('relu'), spec('globalmax'), spec('dense', 16), spec('relu')];
}
