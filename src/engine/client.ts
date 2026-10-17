import { tasks, TaskName } from './tasks';

type Payload<T extends TaskName> = Parameters<(typeof tasks)[T]>[0];
type Result<T extends TaskName> = ReturnType<(typeof tasks)[T]>;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let workerBroken = false;

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result); else p.reject(new Error(e.data.error));
      };
      worker.onerror = () => {
        workerBroken = true;
        pending.forEach((p) => p.reject(new Error('Worker crashed')));
        pending.clear();
      };
    } catch { workerBroken = true; return null; }
  }
  return worker;
}

/** Runs a heavy task in a Web Worker (falls back to the main thread if workers are unavailable). */
export async function runTask<T extends TaskName>(type: T, payload: Payload<T>): Promise<Awaited<Result<T>>> {
  const w = getWorker();
  if (!w) return (tasks[type] as (p: unknown) => unknown)(payload) as Awaited<Result<T>>;
  const id = ++seq;
  try {
    return await new Promise<Awaited<Result<T>>>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, type, payload });
    });
  } catch (e) {
    if (workerBroken) return (tasks[type] as (p: unknown) => unknown)(payload) as Awaited<Result<T>>;
    throw e;
  }
}
