/// <reference lib="webworker" />
import savitzkyGolay from 'ml-savitzky-golay'
import { Matrix, solve } from 'ml-matrix'
import type { WorkerRequest, WorkerResponse } from '../types'

/**
 * Web Worker：耗时的数值计算不阻塞绘图与交互。
 * 1. 可选平滑：Savitzky–Golay 滤波（仅作为辅助曲线，绝不参与面积计算）
 * 2. 简单基线计算：对区间两端各取 edgePoints 个点做一元线性回归，
 *    用 ml-matrix 最小二乘求解，再外推到积分起止点。
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data
  let res: WorkerResponse
  try {
    if (msg.kind === 'smooth') {
      res = {
        id: msg.id,
        ok: true,
        kind: 'smooth',
        smoothed: smooth(msg.y, msg.h, msg.windowSize, msg.polynomial)
      }
    } else {
      const [y0, y1] = estimateBaseline(msg.points, msg.edgePoints)
      res = { id: msg.id, ok: true, kind: 'baseline', y0, y1 }
    }
  } catch (err) {
    res = { id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  ctx.postMessage(res)
}

function smooth(y: number[], h: number, windowSize: number, polynomial: number): number[] {
  // windowSize 必须为大于 polynomial 的奇数；保持与原始序列等长（端部复制填充）
  let w = Math.max(3, Math.floor(windowSize))
  if (w % 2 === 0) w += 1
  const p = Math.min(polynomial, w - 1)
  return Array.from(
    savitzkyGolay(y, h, {
      windowSize: w,
      polynomial: p,
      derivative: 0,
      pad: 'post',
      padValue: 'replicate'
    })
  )
}

/** 一元线性回归 y = a + b·t，使用 ml-matrix 正规方程 (XᵀX)c = Xᵀy。 */
function linfit(points: { t: number; y: number }[]): { a: number; b: number } {
  const m = points.length
  const A = Matrix.zeros(m, 2)
  const b = Matrix.zeros(m, 1)
  for (let i = 0; i < m; i++) {
    A.set(i, 0, 1)
    A.set(i, 1, points[i].t)
    b.set(i, 0, points[i].y)
  }
  const At = A.transpose()
  const XtX = At.mmul(A)
  const Xty = At.mmul(b)
  const coef = solve(XtX, Xty)
  return { a: coef.get(0, 0), b: coef.get(1, 0) }
}

function estimateBaseline(points: { t: number; y: number }[], edgePoints: number): [number, number] {
  // 两端各取一段“基线区”（技师可在界面调整每端点数），联合拟合一条直线
  const k = Math.max(2, Math.min(edgePoints, Math.floor(points.length / 2)))
  const left = points.slice(0, k)
  const right = points.slice(points.length - k)
  const { a, b: slope } = linfit([...left, ...right])
  const t0 = points[0].t
  const t1 = points[points.length - 1].t
  return [a + slope * t0, a + slope * t1]
}
