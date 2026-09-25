/** 主线程侧 Worker 客户端：按 id 配对请求与响应。 */

export interface BaselineFitResult {
  /** 升幂系数，自变量为 (x - center)。 */
  coefficients: number[];
  center: number;
  /** 拟合曲线在全部采样点上的取值。 */
  values: number[];
}

let worker: Worker | null = null;
let seq = 1;
const pending = new Map<
  number,
  { resolve: (v: never) => void; reject: (e: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/signalWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { id: number; ok: boolean; data?: unknown; error?: string };
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.data as never);
      else entry.reject(new Error(msg.error ?? 'Worker 计算失败'));
    };
    worker.onerror = (ev) => {
      const err = new Error(ev.message || 'Worker 运行错误');
      for (const entry of pending.values()) entry.reject(err);
      pending.clear();
    };
  }
  return worker;
}

function call<T>(payload: Record<string, unknown>): Promise<T> {
  const id = seq++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: never) => void, reject });
    getWorker().postMessage({ ...payload, id });
  });
}

export function smoothInWorker(
  y: number[],
  h: number,
  windowSize: number,
  polynomial: number,
): Promise<number[]> {
  return call<number[]>({ type: 'smooth', y, h, windowSize, polynomial });
}

export function fitBaselineInWorker(
  x: number[],
  y: number[],
  ranges: Array<[number, number]>,
  degree: number,
): Promise<BaselineFitResult> {
  return call<BaselineFitResult>({ type: 'baseline', x, y, ranges, degree });
}
