import { runVerificationCases, convergenceOnK, makeSampleCurve, analyticGaussianArea, gaussian } from '../src/lib/synthetic'
import { integrate } from '../src/lib/integration'
import { parseCSV, toCSV } from '../src/lib/csv'
import type { BaselineMode, Point } from '../src/types'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
  if (!cond) failures++
}

console.log('===== 1) 已知面积合成峰核对（运行时计算，非阈值判定）=====')
const cases = runVerificationCases()
for (const c of cases) {
  console.log(`\n[${c.key}] ${c.title}`)
  console.log(`  梯形法净面积 = ${c.trapezoidArea.toFixed(8)}`)
  console.log(`  解析面积     = ${c.analyticArea.toFixed(8)}`)
  console.log(`  相对差异     = ${(c.relativeError * 100).toExponential(3)} %`)
  console.log(`  基线下方     = ${c.baselineArea.toFixed(6)}`)
}

// 单高斯 k=4：梯形法在 801 点下相对误差应极小（截断误差约 erf 尾部 + 离散误差）
const single = cases[0]
check('单高斯峰数值面积与解析面积差异 < 0.1%', Math.abs(single.relativeError) < 1e-3,
  `rel=${single.relativeError.toExponential(3)}`)
// 梯形误差符号由峰顶(凹)/尾部(凸)共同决定，不预判符号；改为核对网格加密下二阶收敛
{
  const A = 10, mu = 20, sigma = 2, k = 4
  const t0 = mu - k * sigma, t1 = mu + k * sigma
  const exact = analyticGaussianArea(A, sigma, k)
  const err = (n: number) => {
    const pts: Point[] = Array.from({ length: n }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / (n - 1)
      return { t, y: gaussian(t, A, mu, sigma) }
    })
    return Math.abs(integrate(pts, t0, t1, { type: 'zero', y0: 0, y1: 0 })!.netArea - exact)
  }
  const [e101, e401, e1601] = [err(101), err(401), err(1601)]
  console.log(`  网格加密误差: n=101 ${e101.toExponential(3)}, n=401 ${e401.toExponential(3)}, n=1601 ${e1601.toExponential(3)}`)
  console.log(`  误差阶比: ${(e101 / e401).toFixed(2)}（应≈16）, ${(e401 / e1601).toFixed(2)}（应≈16，h 减半误差降 4 倍，跨两级=16）`)
  check('梯形法表现出 O(h²) 二阶收敛（每级加密误差降 ~16 倍）', e101 / e401 > 12 && e401 / e1601 > 12)
}

const drift = cases[2]
check('漂移峰直线基线校正后净面积 ≈ 高斯解析面积', Math.abs(drift.relativeError) < 1e-3,
  `rel=${drift.relativeError.toExponential(3)}`)
// 若不做基线校正（零基线），毛面积应明显偏大（包含漂移梯形面积）
const rawGross = integrate(drift.points, drift.tStart, drift.tEnd, { type: 'zero', y0: 0, y1: 0 } as BaselineMode)!
check('同一漂移峰用零基线时毛面积明显大于净面积（演示基线影响）', rawGross.netArea > drift.trapezoidArea + 1,
  `gross=${rawGross.netArea.toFixed(4)} vs net=${drift.trapezoidArea.toFixed(4)}`)

console.log('\n===== 2) 截断宽度 k 收敛核对（固定 801 点，k 同时改变区间与网格，故只看总体趋势）=====')
for (const r of convergenceOnK()) {
  console.log(`k=${r.k}  梯形=${r.area.toFixed(8)}  解析=${r.analytic.toFixed(8)}  相对差异=${(r.relError * 100).toExponential(3)}%`)
}
const conv = convergenceOnK()
// k→∞ 时解析值趋于全高斯面积；梯形值也应趋于同一极限
const full = analyticGaussianArea(10, 2, 100)
check('k=6 时梯形面积已贴近全高斯解析极限', Math.abs(conv.find(r => r.k === 6)!.area - full) < 1e-7,
  `area=${conv.find(r => r.k === 6)!.area.toFixed(8)} full=${full.toFixed(8)}`)

console.log('\n===== 3) 区间端点不落在采样点上（插值核对）=====')
// 取一个峰的完整采样，故意把起止点设到采样点之间，核对仍与解析值吻合
{
  const A = 3, mu = 10, sigma = 0.8, k = 5
  const t0 = mu - k * sigma, t1 = mu + k * sigma
  const n = 501
  const pts: Point[] = Array.from({ length: n }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / (n - 1)
    return { t, y: gaussian(t, A, mu, sigma) }
  })
  // 偏移半个步长
  const h = (t1 - t0) / (n - 1)
  const r = integrate(pts, t0 + h * 0.5, t1 - h * 0.5, { type: 'zero', y0: 0, y1: 0 })!
  const exact = A * sigma * Math.SQRT2 * Math.sqrt(Math.PI) // 全高斯
  console.log(`偏移端点净面积=${r.netArea.toFixed(8)}  全高斯解析=${exact.toFixed(8)}  差=${(r.netArea - exact).toExponential(3)}`)
  check('偏移采样点端点的积分与全高斯解析面积差异 < 1e-3', Math.abs(r.netArea - exact) < 1e-3)
}

console.log('\n===== 4) 手工直线基线：构造基线上下对称面积核对净面积 =====')
{
  // y(t) = 1 + 2t 在 [0,10] 上，直线基线 y0=1,y1=21 时净面积应为 0；
  // 毛面积 = 梯形 (1+21)/2*10 = 110；基线下方面积同为 110
  const pts: Point[] = Array.from({ length: 101 }, (_, i) => ({ t: i / 10, y: 1 + 2 * (i / 10) }))
  const r = integrate(pts, 0, 10, { type: 'linear', y0: 1, y1: 21 })!
  check('曲线与基线重合时净面积≈0', Math.abs(r.netArea) < 1e-10, `net=${r.netArea}`)
  check('毛面积=110', Math.abs(r.grossArea - 110) < 1e-9)
  check('基线下方面积=110', Math.abs(r.baselineArea - 110) < 1e-9)
}

console.log('\n===== 5) CSV 解析 / 表头跳过 / 错误检测 =====')
{
  const csv = 'time,response\n0,1\n1,2\n2,3\n# comment\n3;4\n4\t5'
  const r = parseCSV(csv)
  check('表头+注释+多分隔符解析出 5 个点', r.points.length === 5)
  check('y 值正确', r.points[4].y === 5)
  let threw = false
  try { parseCSV('0,1\n0,2') } catch { threw = true }
  check('时间非递增时报错', threw)
  threw = false
  try { parseCSV('a,b') } catch { threw = true }
  check('仅表头无数据时报错', threw)
  check('导出 CSV 往返一致', parseCSV(toCSV(r.points)).points.length === 5)
}

console.log('\n===== 6) 可见样例曲线 =====')
{
  const s = makeSampleCurve()
  check('样例 901 点、t 单调、首尾时间为 0 / 90',
    s.length === 901 && s[0].t === 0 && s[s.length - 1].t === 90 &&
    s.every((p, i) => i === 0 || p.t > s[i - 1].t))
  const r = integrate(s, 50, 60, { type: 'linear', y0: 0.45, y1: 0.49 })!
  check('样例主峰区间净面积 > 0 且为有限值', Number.isFinite(r.netArea) && r.netArea > 0, `net=${r.netArea.toFixed(4)}`)
  // 确定性：两次生成应完全一致（重新导入可重复计算）
  const s2 = makeSampleCurve()
  check('样例确定性可复现（重新导入重复计算）', s.every((p, i) => p.y === s2[i].y))
}

console.log(`\n${failures === 0 ? '全部核对通过 ✔' : `有 ${failures} 项未通过 �’`}`)
process.exit(failures === 0 ? 0 : 1)
