import type { BaselineMode, IntegrationResult, Point } from '../types'

/**
 * 线性基线在 t 处的响应。
 * 直线连接 (tStart, y0) 与 (tEnd, y1)。
 */
export function baselineAt(baseline: BaselineMode, t: number, tStart: number, tEnd: number): number {
  if (baseline.type === 'zero') return 0
  if (tEnd === tStart) return baseline.y0
  const r = (t - tStart) / (tEnd - tStart)
  return baseline.y0 + (baseline.y1 - baseline.y0) * r
}

/** 找到时间序列中第一个 t >= target 的下标（points 必须按 t 升序）。 */
export function lowerIndex(points: Point[], target: number): number {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 梯形法积分 —— 面积计算唯一入口。
 *
 * 对区间 [tStart, tEnd] 内的原始采样点做梯形求和：
 *   grossArea     = Σ (yᵢ + yᵢ₊₁)/2 · Δt         （原始信号相对零轴）
 *   baselineArea  = Σ (bᵢ + bᵢ₊₁)/2 · Δt         （基线下方）
 *   netArea       = grossArea − baselineArea      （基线校正后净面积）
 *
 * 注意：起点/终点若落在采样点之间，基线值按直线取值，而原始曲线值也按相邻
 * 采样点线性插值，这样合成峰核对时数值解与解析解才一致。
 */
export function integrate(
  points: Point[],
  tStart: number,
  tEnd: number,
  baseline: BaselineMode
): IntegrationResult | null {
  const n = points.length
  if (n < 2 || !(tEnd > tStart)) return null

  // 区间内实际参与求和的时间点：边界处用插值构造
  const segStart = lowerIndex(points, tStart)
  const segEnd = lowerIndex(points, tEnd)
  if (segStart >= n) return null

  const sampled: { t: number; y: number }[] = []

  // 左边界：tStart 不在采样点上时插值
  const p0 = points[Math.max(0, segStart - 1)]
  const p1 = points[segStart]
  if (p1.t === tStart) {
    sampled.push({ t: tStart, y: p1.y })
  } else if (p0.t < tStart && segStart > 0) {
    const r = (tStart - p0.t) / (p1.t - p0.t)
    sampled.push({ t: tStart, y: p0.y + (p1.y - p0.y) * r })
  } else if (segStart === 0 && p1.t >= tStart) {
    sampled.push({ t: tStart, y: p1.y })
  }

  // 中间完整采样点
  for (let i = segStart; i < Math.min(segEnd, n); i++) {
    if (points[i].t > tStart && points[i].t < tEnd) sampled.push(points[i])
  }

  // 右边界：tEnd 不在采样点上时插值
  if (segEnd < n && points[segEnd].t === tEnd) {
    sampled.push({ t: tEnd, y: points[segEnd].y })
  } else if (segEnd > 0 && segEnd < n) {
    const a = points[segEnd - 1]
    const b = points[segEnd]
    if (a.t < tEnd && b.t > tEnd) {
      const r = (tEnd - a.t) / (b.t - a.t)
      sampled.push({ t: tEnd, y: a.y + (b.y - a.y) * r })
    }
  } else if (segEnd >= n && points[n - 1].t < tEnd) {
    sampled.push({ t: tEnd, y: points[n - 1].y })
  }

  if (sampled.length < 2) return null

  let grossArea = 0
  let baselineArea = 0
  for (let i = 0; i < sampled.length - 1; i++) {
    const a = sampled[i]
    const b = sampled[i + 1]
    const dt = b.t - a.t
    grossArea += ((a.y + b.y) / 2) * dt
    const ba = baselineAt(baseline, a.t, tStart, tEnd)
    const bb = baselineAt(baseline, b.t, tStart, tEnd)
    baselineArea += ((ba + bb) / 2) * dt
  }

  const first = sampled[0]
  const last = sampled[sampled.length - 1]
  return {
    iStart: Math.max(0, segStart - 1),
    iEnd: Math.min(n - 1, segEnd),
    tStart,
    tEnd,
    yAtStart: first.y,
    yAtEnd: last.y,
    bAtStart: baselineAt(baseline, tStart, tStart, tEnd),
    bAtEnd: baselineAt(baseline, tEnd, tStart, tEnd),
    grossArea,
    baselineArea,
    netArea: grossArea - baselineArea
  }
}
