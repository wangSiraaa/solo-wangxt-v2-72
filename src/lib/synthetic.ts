import { integrate } from './integration'
import type { BaselineMode, Point } from '../types'

/** 高斯峰：A·exp(−(t−μ)²/(2σ²)) */
export function gaussian(t: number, A: number, mu: number, sigma: number): number {
  const z = (t - mu) / sigma
  return A * Math.exp(-0.5 * z * z)
}

export interface GaussianDef {
  A: number
  mu: number
  sigma: number
}

/** 高斯峰在 [mu-kσ, mu+kσ] 区间内的解析面积（误差函数形式）。 */
export function analyticGaussianArea(A: number, sigma: number, k: number): number {
  return A * sigma * Math.SQRT2 * Math.sqrt(Math.PI) * erf(k / Math.SQRT2)
}

/**
 * erf 机器精度实现：
 * - |x| < 1：麦克劳林级数（小 x 时避免 1−erfc 的精度抵消）
 * - |x| ≥ 1：erfc 的收敛连分式（DLMF 7.9.3），Lentz 算法求值
 *   erfc(x) = e^-x²/(√π · (x + 1/(2x + 2/(x + 3/(2x + …)))))
 */
export function erf(x: number): number {
  if (x < 0) return -erf(-x)
  if (x < 1) {
    const x2 = x * x
    let term = x
    let sum = x
    for (let n = 1; n < 100; n++) {
      term *= (-x2 * (2 * n - 1)) / (n * (2 * n + 1))
      sum += term
      if (Math.abs(term) <= 1e-17 * Math.abs(sum)) break
    }
    return (2 / Math.sqrt(Math.PI)) * sum
  }
  const tiny = 1e-300
  let f = x
  let C = f
  let D = 0
  for (let j = 1; j <= 1000; j++) {
    const aJ = j
    const bJ = j % 2 === 1 ? 2 * x : x
    D = bJ + aJ * D
    if (Math.abs(D) < tiny) D = tiny
    C = bJ + aJ / C
    if (Math.abs(C) < tiny) C = tiny
    D = 1 / D
    const delta = C * D
    f *= delta
    if (Math.abs(delta - 1) < 1e-18) break
  }
  const erfc = Math.exp(-x * x) / (Math.sqrt(Math.PI) * f)
  return 1 - erfc
}

function linspace(t0: number, t1: number, n: number): number[] {
  const out: number[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = t0 + ((t1 - t0) * i) / (n - 1)
  return out
}

function buildGrid(mu: number, sigma: number, k: number, n: number) {
  const t0 = mu - k * sigma
  const t1 = mu + k * sigma
  return { t0, t1, ts: linspace(t0, t1, n) }
}

export interface CaseResult {
  key: string
  title: string
  description: string
  points: Point[]
  baseline: BaselineMode
  tStart: number
  tEnd: number
  k: number
  trapezoidArea: number
  analyticArea: number
  grossArea: number
  baselineArea: number
  relativeError: number // (数值 − 解析) / 解析
}

/**
 * 已知面积的合成峰核对：
 * 所有“结论”都是运行时把梯形法结果与解析积分逐项比较得到，
 * 不存在任何固定阈值自动判定——误差由技师阅读判断。
 */
export function runVerificationCases(): CaseResult[] {
  const results: CaseResult[] = []

  // 情形 1：单个高斯峰，零基线，k = 4σ，随 k 的收敛见 convergenceOnK()
  {
    const A = 10
    const mu = 20
    const sigma = 2
    const k = 4
    const n = 801
    const { t0, t1, ts } = buildGrid(mu, sigma, k, n)
    const points: Point[] = ts.map((t) => ({ t, y: gaussian(t, A, mu, sigma) }))
    const baseline: BaselineMode = { type: 'zero', y0: 0, y1: 0 }
    const r = integrate(points, t0, t1, baseline)!
    const analytic = analyticGaussianArea(A, sigma, k)
    results.push(makeCase('single', '单高斯峰（零基线）', 'A=10, μ=20, σ=2，区间 μ±4σ，801 点等距采样', points, baseline, t0, t1, k, r, analytic))
  }

  // 情形 2：两个重叠高斯峰之和，积分区间覆盖两峰，解析面积为两者之和
  {
    const peaks: GaussianDef[] = [
      { A: 8, mu: 18, sigma: 1.5 },
      { A: 5, mu: 23, sigma: 2.2 }
    ]
    const k = 4
    const t0 = peaks[0].mu - k * peaks[0].sigma
    const t1 = peaks[1].mu + k * peaks[1].sigma
    const n = 1201
    const ts = linspace(t0, t1, n)
    const points: Point[] = ts.map((t) => ({
      t,
      y: peaks.reduce((s, p) => s + gaussian(t, p.A, p.mu, p.sigma), 0)
    }))
    const baseline: BaselineMode = { type: 'zero', y0: 0, y1: 0 }
    const r = integrate(points, t0, t1, baseline)!
    const analytic = peaks.reduce((s, p) => s + analyticGaussianArea(p.A, p.sigma, k), 0)
    results.push(makeCase('double', '重叠双峰（零基线）', 'A=(8,5), μ=(18,23), σ=(1.5,2.2)，区间覆盖两峰 μ±4σ', points, baseline, t0, t1, k, r, analytic))
  }

  // 情形 3：高斯峰叠加线性漂移基线 y = c + d·t
  //          零基线模式给出“毛面积”（被基线抬高），
  //          直线基线模式（取真实端点漂移值）给出净面积，解析值仍为高斯解析面积。
  {
    const A = 6
    const mu = 30
    const sigma = 1.8
    const k = 4
    const c = 0.4
    const d = 0.02
    const n = 901
    const { t0, t1, ts } = buildGrid(mu, sigma, k, n)
    const drift = (t: number) => c + d * t
    const points: Point[] = ts.map((t) => ({ t, y: gaussian(t, A, mu, sigma) + drift(t) }))
    const baseline: BaselineMode = { type: 'linear', y0: drift(t0), y1: drift(t1) }
    const r = integrate(points, t0, t1, baseline)!
    const analytic = analyticGaussianArea(A, sigma, k)
    results.push(makeCase('drift', '高斯峰 + 线性漂移（直线基线校正）', 'A=6, μ=30, σ=1.8，基线 y = 0.4 + 0.02·t', points, baseline, t0, t1, k, r, analytic))
  }

  return results
}

function makeCase(
  key: string,
  title: string,
  description: string,
  points: Point[],
  baseline: BaselineMode,
  tStart: number,
  tEnd: number,
  k: number,
  r: NonNullable<ReturnType<typeof integrate>>,
  analytic: number
): CaseResult {
  return {
    key,
    title,
    description,
    points,
    baseline,
    tStart,
    tEnd,
    k,
    trapezoidArea: r.netArea,
    analyticArea: analytic,
    grossArea: r.grossArea,
    baselineArea: r.baselineArea,
    relativeError: (r.netArea - analytic) / analytic
  }
}

/** 单高斯峰在不同截断宽度 k 下的收敛情况：用于直观核对，而非阈值判定。 */
export function convergenceOnK(A = 10, mu = 20, sigma = 2, n = 801): { k: number; area: number; analytic: number; relError: number }[] {
  const rows = []
  for (const k of [3, 3.5, 4, 4.5, 5, 6]) {
    const { t0, t1, ts } = buildGrid(mu, sigma, k, n)
    const points: Point[] = ts.map((t) => ({ t, y: gaussian(t, A, mu, sigma) }))
    const baseline: BaselineMode = { type: 'zero', y0: 0, y1: 0 }
    const r = integrate(points, t0, t1, baseline)!
    const analytic = analyticGaussianArea(A, sigma, k)
    rows.push({ k, area: r.netArea, analytic, relError: (r.netArea - analytic) / analytic })
  }
  return rows
}

/**
 * 一条可见的示例色谱曲线（带噪声与轻微漂移），
 * 导入后直接可查原始曲线、平滑辅助曲线与积分区间。
 */
export function makeSampleCurve(): Point[] {
  const peaks: GaussianDef[] = [
    { A: 1.2, mu: 12, sigma: 0.6 },
    { A: 4.5, mu: 26, sigma: 1.1 },
    { A: 2.6, mu: 38, sigma: 1.6 },
    { A: 6.0, mu: 55, sigma: 1.3 },
    { A: 1.8, mu: 70, sigma: 2.0 }
  ]
  // 确定性的伪随机噪声（线性同余），保证每次重新导入得到同一条样例
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const n = 901
  const ts = linspace(0, 90, n)
  return ts.map((t, i) => {
    const signal = peaks.reduce((s, p) => s + gaussian(t, p.A, p.mu, p.sigma), 0)
    const drift = 0.25 + 0.004 * t
    // 首尾给一点随机噪声，幅度远小于主峰
    const noise = (rand() - 0.5) * 0.04 + Math.sin(i * 0.9) * 0.01
    return { t, y: signal + drift + noise }
  })
}
