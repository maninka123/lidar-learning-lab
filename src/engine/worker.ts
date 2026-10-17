/// <reference lib="webworker" />
import { tasks, TaskName } from './tasks';

function collectTransfer(obj: unknown, out: Set<ArrayBuffer>, depth = 0) {
  if (!obj || depth > 6) return;
  if (ArrayBuffer.isView(obj)) { if (obj.buffer instanceof ArrayBuffer) out.add(obj.buffer); return; }
  if (Array.isArray(obj)) { for (const v of obj) collectTransfer(v, out, depth + 1); return; }
  if (typeof obj === 'object') for (const v of Object.values(obj as Record<string, unknown>)) collectTransfer(v, out, depth + 1);
}

self.onmessage = (e: MessageEvent<{ id: number; type: TaskName; payload: unknown }>) => {
  const { id, type, payload } = e.data;
  try {
    const result = (tasks[type] as (p: unknown) => unknown)(payload);
    const tr = new Set<ArrayBuffer>();
    collectTransfer(result, tr);
    (self as unknown as Worker).postMessage({ id, ok: true, result }, [...tr]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
