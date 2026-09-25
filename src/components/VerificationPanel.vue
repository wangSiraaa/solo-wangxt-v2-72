<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import Plotly from 'plotly.js-dist-min'
import {
  runVerificationCases,
  convergenceOnK,
  makeSampleCurve,
  type CaseResult
} from '../lib/synthetic'
import { fmtArea, fmtPct } from '../lib/format'
import type { Point } from '../types'

const emit = defineEmits<{
  (e: 'load-points', payload: { name: string; points: Point[]; tStart: number; tEnd: number; y0: number; y1: number; linear: boolean }): void
}>()

const cases = ref<CaseResult[] | null>(null)
const convergence = ref<ReturnType<typeof convergenceOnK> | null>(null)
const samplePoints = ref<Point[]>(makeSampleCurve())
const selectedKey = ref<string>('single')
const miniEl = ref<HTMLDivElement | null>(null)
const sampleEl = ref<HTMLDivElement | null>(null)

function run() {
  cases.value = runVerificationCases()
  convergence.value = convergenceOnK()
  renderCaseChart()
}

function renderCaseChart() {
  if (!miniEl.value || !cases.value) return
  const c = cases.value.find((x) => x.key === selectedKey.value) ?? cases.value[0]
  Plotly.react(
    miniEl.value,
    [
      {
        x: c.points.map((p) => p.t),
        y: c.points.map((p) => p.y),
        type: 'scattergl',
        mode: 'lines',
        name: c.title,
        line: { color: '#1d4ed8', width: 1.5 },
        fill: 'tozeroy',
        fillcolor: 'rgba(29,78,216,0.08)',
        hovertemplate: 't=%{x:.4f}<br>y=%{y:.4f}<extra></extra>'
      },
      {
        x: [c.tStart, c.tEnd],
        y: [c.baseline.type === 'linear' ? c.baseline.y0 : 0, c.baseline.type === 'linear' ? c.baseline.y1 : 0],
        type: 'scattergl',
        mode: 'lines',
        name: '所用基线',
        line: { color: '#dc2626', width: 2 }
      }
    ],
    {
      title: { text: `合成峰：${c.title}（面积核对用）`, font: { size: 13 } },
      margin: { l: 56, r: 16, t: 40, b: 44 },
      xaxis: { title: 't', gridcolor: '#eee' },
      yaxis: { title: 'y', gridcolor: '#eee' },
      legend: { orientation: 'h', y: -0.22 },
      height: 300
    },
    { responsive: true, displaylogo: false }
  )
}

function selectCase(key: string) {
  selectedKey.value = key
  renderCaseChart()
}

function loadCase(c: CaseResult) {
  emit('load-points', {
    name: `合成峰-${c.key}`,
    points: c.points,
    tStart: c.tStart,
    tEnd: c.tEnd,
    y0: c.baseline.type === 'linear' ? c.baseline.y0 : 0,
    y1: c.baseline.type === 'linear' ? c.baseline.y1 : 0,
    linear: c.baseline.type === 'linear'
  })
}

function loadSample() {
  emit('load-points', {
    name: '可见样例曲线',
    points: samplePoints.value,
    tStart: 50,
    tEnd: 60,
    y0: 0.45,
    y1: 0.49,
    linear: true
  })
}

function renderSample() {
  if (!sampleEl.value) return
  Plotly.react(
    sampleEl.value,
    [
      {
        x: samplePoints.value.map((p) => p.t),
        y: samplePoints.value.map((p) => p.y),
        type: 'scattergl',
        mode: 'lines',
        line: { color: '#047857', width: 1.2 },
        hovertemplate: 't=%{x:.3f}<br>y=%{y:.4f}<extra></extra>'
      }
    ],
    {
      title: { text: '可见样例：5 个高斯峰 + 漂移 + 噪声（面积未知，供手工复核）', font: { size: 13 } },
      margin: { l: 56, r: 16, t: 40, b: 44 },
      xaxis: { title: '时间', gridcolor: '#eee' },
      yaxis: { title: '响应', gridcolor: '#eee' },
      height: 260
    },
    { responsive: true, displaylogo: false }
  )
}

onMounted(async () => {
  cases.value = runVerificationCases()
  convergence.value = convergenceOnK()
  await nextTick()
  renderCaseChart()
  renderSample()
})

onBeforeUnmount(() => {
  if (miniEl.value) Plotly.purge(miniEl.value)
  if (sampleEl.value) Plotly.purge(sampleEl.value)
})
</script>

<template>
  <section class="panel verify">
    <h2>面积核对（合成已知面积峰 + 可见曲线样例）</h2>
    <p class="note">
      下列数值均为<span class="strong">运行时计算</span>：梯形法结果对照高斯峰的解析积分
      A·σ·√(2π)·erf(k/√2)，相对误差由技师阅读判断，<span class="strong">程序不做任何固定阈值的“合格/不合格”自动结论</span>。
    </p>
    <div class="actions">
      <button class="primary" @click="run">运行 / 重新核对</button>
      <button @click="loadSample" :disabled="samplePoints.length === 0">载入可见样例曲线到复核区</button>
    </div>

    <div v-if="cases" class="results">
      <table>
        <thead>
          <tr>
            <th>合成峰</th>
            <th>梯形法面积</th>
            <th>解析面积</th>
            <th>相对差异</th>
            <th>基线下方</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in cases" :key="c.key" :class="{ active: c.key === selectedKey }">
            <td>
              <button class="link" @click="selectCase(c.key)">{{ c.title }}</button>
              <div class="sub">{{ c.description }}</div>
            </td>
            <td class="num">{{ fmtArea(c.trapezoidArea) }}</td>
            <td class="num">{{ fmtArea(c.analyticArea) }}</td>
            <td class="num" :class="c.relativeError >= 0 ? 'pos' : 'neg'">{{ fmtPct(c.relativeError, 5) }}</td>
            <td class="num">{{ fmtArea(c.baselineArea) }}</td>
            <td><button @click="loadCase(c)">载入复核区</button></td>
          </tr>
        </tbody>
      </table>

      <div ref="miniEl" class="mini-chart"></div>

      <h3>截断宽度 k 的收敛情况（单高斯峰，801 点）</h3>
      <table v-if="convergence" class="conv">
        <thead>
          <tr><th>区间 μ±kσ</th><th>k</th><th>梯形面积</th><th>对应解析面积</th><th>相对差异</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in convergence" :key="r.k">
            <td>μ±{{ r.k }}σ</td>
            <td>{{ r.k }}</td>
            <td class="num">{{ fmtArea(r.area) }}</td>
            <td class="num">{{ fmtArea(r.analytic) }}</td>
            <td class="num" :class="r.relError >= 0 ? 'pos' : 'neg'">{{ fmtPct(r.relError, 5) }}</td>
          </tr>
        </tbody>
      </table>
      <p class="note small">
        可见随 k 增大梯形结果收敛到解析值，差异来自区间截断与离散梯形误差；这是数值核对，不是阈值判定。
      </p>

      <div ref="sampleEl" class="mini-chart"></div>
    </div>
  </section>
</template>

<style scoped>
.verify {
  margin-top: 16px;
}
.note {
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
}
.note.small {
  font-size: 12px;
}
.strong {
  font-weight: 700;
  color: #b91c1c;
}
.actions {
  display: flex;
  gap: 10px;
  margin: 10px 0;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 8px 0;
}
th,
td {
  border: 1px solid #e2e8f0;
  padding: 6px 9px;
  text-align: left;
  vertical-align: top;
}
th {
  background: #f1f5f9;
}
tr.active {
  background: #eff6ff;
}
td.num {
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.pos {
  color: #b45309;
}
.neg {
  color: #1d4ed8;
}
.sub {
  color: #64748b;
  font-size: 11px;
  margin-top: 2px;
}
.link {
  background: none;
  border: none;
  padding: 0;
  color: #1d4ed8;
  cursor: pointer;
  font: inherit;
  text-decoration: underline;
}
.mini-chart {
  width: 100%;
  margin: 10px 0;
}
h3 {
  font-size: 14px;
  margin: 14px 0 6px;
}
</style>
