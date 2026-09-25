import type { Point, WorkerResponse } from '../types'
import CalcWorker from '../workers/calc.worker.ts?worker'

type SmoothReq = { kind: 'smooth'; y: number[]; h: number; windowSize: number; polynomial: number }
type BaselineReq = { kind: 'baseline'; points: Point[]; edgePoints: number }
type RequestWithoutId = SmoothReq | BaselineReq

/**
 * Web Worker 的 Promise 化封装。
 * 主线程只发送请求并按 id 取回结果，平滑与基线估算均在后台线程完成。
 */
export class CalcClient {
  private worker: Worker | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }>()

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new CalcWorker()
      this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
        const msg = ev.data
        const p = this.pending.get(msg.id)
        if (!p) return
        this.pending.delete(msg.id)
        if (msg.ok) p.resolve(msg)
        else p.reject(new Error(msg.error))
      }
      this.worker.onerror = (e) => {
        const err = new Error(e.message)
        this.pending.forEach((p) => p.reject(err))
        this.pending.clear()
      }
    }
    return this.worker
  }

  private call<T extends WorkerResponse>(req: RequestWithoutId): Promise<T> {
    const id = this.nextId++
    const w = this.ensure()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: WorkerResponse) => void, reject })
      w.postMessage({ ...req, id })
    })
  }

  smooth(y: number[], h: number, windowSize: number, polynomial: number): Promise<number[]> {
    return this
      .call<Extract<WorkerResponse, { kind: 'smooth' }>>({ kind: 'smooth', y, h, windowSize, polynomial })
      .then((r) => r.smoothed)
  }

  estimateBaseline(points: Point[], edgePoints: number): Promise<{ y0: number; y1: number }> {
    return this
      .call<Extract<WorkerResponse, { kind: 'baseline' }>>({ kind: 'baseline', points, edgePoints })
      .then((r) => ({ y0: r.y0, y1: r.y1 }))
  }

  dispose(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
  }
}
