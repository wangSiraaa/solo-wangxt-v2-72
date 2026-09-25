<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlotChart from './components/PlotChart.vue'
import VerificationPanel from './components/VerificationPanel.vue'
import { parseCSV } from './lib/csv'
import { integrate } from './lib/integration'
import { CalcClient } from './lib/workerClient'
import { useHistory } from './composables/useHistory'
import { deleteCurve, getLastOpenId, listCurves, saveCurve } from './lib/db'
import { fmtArea, fmtNum, fmtPct } from './lib/format'
import type { IntegrationResult, PeakState, Point, StoredCurve } from './types'

const client = new CalcClient()

const defaultState = (points: Point[]): PeakState => {
  const n = points.length
  const i0 = Math.floor(n * 0.25)
  const i1 = Math.floor(n * 0.75)
  return {
    tStart: points[i0].t,
    tEnd: points[i1].t,
    baseline: { type: 'linear', y0: points[i0].y, y1: points[i1].y },
    smoothing: { enabled: false, windowSize: 11, polynomial: 2 }
  }
}

// ---- 当前曲线与会话 ----
const curveId = ref<string>('')
const curveName = ref<string>('')
const points = ref<Point[]>([])
const pointCount = computed(() => points.value.length)
const tMin = computed(() => points.value[0]?.t ?? 0)
const tMax = computed(() => points.value[points.value.length - 1]?.t ?? 0)
const dt = computed(() => {
  const p = points.value
  if (p.length < 2) return 1
  const diffs = p.slice(1, Math.min(21, p.length)).map((q, i) => q.t - p[i].t)
  return diffs.reduce((a, b) => a + b, 0) / diffs.length
})

const history = useHistory<PeakState>({
  tStart: 0,
  tEnd: 1,
  baseline: { type: 'linear', y0: 0, y1: 0 },
  smoothing: { enabled: false, windowSize: 11, polynomial: 2 }
})
const state = history.present
const pickMode = ref<'none' | 'start' | 'end'>('none')
const smoothed = ref<number[] | null>(null)
const busySmooth = ref(false)
const edgePoints = ref(25)
const busyBaseline = ref(false)

const message = ref<{ kind: 'info' | 'error'; text: string } | null>(null)
let messageTimer: ReturnType<typeof setTimeout> | null = null
function notify(text: string, kind: 'info' | 'error' = 'info') {
  message.value = { kind, text }
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => (message.value = null), 6000)
}

// ---- 面积（始终基于原始数据；平滑曲线只用于观察）----
const result = computed<IntegrationResult | null>(() => {
  if (points.value.length < 2) return null
  return integrate(points.value, state.value.tStart, state.value.tEnd, state.value.baseline)
})

const previousResult = computed<IntegrationResult | null>(() => {
  const prev = history.previous.value
  if (!prev || points.value.length < 2) return null
  return integrate(points.value, prev.tStart, prev.tEnd, prev.baseline)
})

const diffRows = computed(() => {
  const cur = result.value
  const prev = previousResult.value
  if (!cur) return []
  const row = (label: string, curVal: number, prevVal: number | null, fmt: (v: number) => string = fmtArea) => ({
    label,
    cur: fmt(curVal),
    prev: prevVal === null ? '—' : fmt(prevVal),
    delta:
      prevVal === null
        ? '—'
        : `${curVal - prevVal >= 0 ? '+' : ''}${fmt(curVal - prevVal)}`,
    rel: prevVal === null || prevVal === 0 ? '—' : fmtPct((curVal - prevVal) / Math.abs(prevVal), 3)
  })
  const rows = [
    row('起点时间', cur.tStart, prev?.tStart ?? null, (v) => fmtNum(v, 4)),
    row('终点时间', cur.tEnd, prev?.tEnd ?? null, (v) => fmtNum(v, 4)),
    row('起点基线响应', cur.bAtStart, prev?.bAtStart ?? null, (v) => fmtNum(v, 4)),
    row('终点基线响应', cur.bAtEnd, prev?.bAtEnd ?? null, (v) => fmtNum(v, 4)),
    row('原始毛面积（相对零轴）', cur.grossArea, prev?.grossArea ?? null),
    row('基线下方面积', cur.baselineArea, prev?.baselineArea ?? null),
    row('净面积（当前结果）', cur.netArea, prev?.netArea ?? null)
  ]
  return rows
})

// ---- 编辑提交（每次修改进入撤销栈）----
function mutate(fn: (s: PeakState) => void) {
  const before = structuredClone(state.value)
  const next = structuredClone(state.value)
  fn(next)
  history.commit(before, next)
}

function setStart(v: number) {
  mutate((s) => {
    s.tStart = clampStart(v, s.tEnd)
  })
  pickMode.value = 'none'
}
function setEnd(v: number) {
  mutate((s) => {
    s.tEnd = clampEnd(v, s.tStart)
  })
  pickMode.value = 'none'
}
function clampStart(v: number, tEnd: number) {
  return Math.min(Math.max(v, tMin.value), tEnd - Math.min(dt.value, 1e-9) / 10)
}
function clampEnd(v: number, tStart: number) {
  return Math.max(Math.min(v, tMax.value), tStart + Math.min(dt.value, 1e-9) / 10)
}

function setBaselineType(type: 'zero' | 'linear') {
  mutate((s) => (s.baseline.type = type))
}
function setY0(v: number) {
  mutate((s) => (s.baseline.y0 = v))
}
function setY1(v: number) {
  mutate((s) => (s.baseline.y1 = v))
}

function onPick(t: number) {
  if (pickMode.value === 'start') setStart(t)
  else if (pickMode.value === 'end') setEnd(t)
}

/** 把基线端点吸附到当前起止点处的原始曲线上（直线基线常用起点）。 */
function snapStartToCurve() {
  const r = result.value
  if (r) setY0(r.yAtStart)
}
function snapEndToCurve() {
  const r = result.value
  if (r) setY1(r.yAtEnd)
}

/** Worker：用区间两端边缘点做最小二乘基线估算，只填入手工字段，技师可再改。 */
async function autoEstimateBaseline() {
  if (!result.value) return
  busyBaseline.value = true
  try {
    const inside = points.value.filter((p) => p.t >= state.value.tStart && p.t <= state.value.tEnd)
    const { y0, y1 } = await client.estimateBaseline(inside, edgePoints.value)
    mutate((s) => {
      s.baseline.type = 'linear'
      s.baseline.y0 = y0
      s.baseline.y1 = y1
    })
    notify(`边缘最小二乘基线估算完成（每端 ${edgePoints.value} 点），仍可手工修改`)
  } catch (e) {
    notify((e as Error).message, 'error')
  } finally {
    busyBaseline.value = false
  }
}

// ---- 平滑（Worker，可选；仅辅助显示）----
let smoothTimer: ReturnType<typeof setTimeout> | null = null
watch(
  () => [points.value, state.value.smoothing.enabled, state.value.smoothing.windowSize, state.value.smoothing.polynomial] as const,
  ([pts, enabled]) => {
    if (smoothTimer) clearTimeout(smoothTimer)
    if (!enabled || pts.length < 5) {
      smoothed.value = null
      return
    }
    smoothTimer = setTimeout(async () => {
      busySmooth.value = true
      try {
        smoothed.value = await client.smooth(
          pts.map((p) => p.y),
          dt.value,
          state.value.smoothing.windowSize,
          state.value.smoothing.polynomial
        )
      } catch (e) {
        notify(`平滑失败：${(e as Error).message}`, 'error')
        smoothed.value = null
      } finally {
        busySmooth.value = false
      }
    }, 120)
  },
  { immediate: true }
)

function toggleSmoothing(v: boolean) {
  mutate((s) => (s.smoothing.enabled = v))
}
function setWindow(v: number) {
  mutate((s) => (s.smoothing.windowSize = Math.max(3, Math.min(v % 2 === 0 ? v + 1 : v, points.value.length))))
}
function setPoly(v: number) {
  mutate((s) => (s.smoothing.polynomial = Math.max(1, v)))
}

// ---- 导入 / 重新导入 ----
const fileInput = ref<HTMLInputElement | null>(null)

function triggerImport() {
  fileInput.value?.click()
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    loadPoints(file.name.replace(/\.csv$/i, ''), parseCSV(text).points)
  } catch (err) {
    notify(`导入失败：${(err as Error).message}`, 'error')
  }
}

function loadPoints(name: string, pts: Point[], preset?: { tStart: number; tEnd: number; y0: number; y1: number; linear: boolean }) {
  if (pts.length < 2) {
    notify('数据点不足，无法导入', 'error')
    return
  }
  points.value = pts
  curveId.value = ''
  curveName.value = name
  const init = defaultState(pts)
  if (preset) {
    init.tStart = Math.max(pts[0].t, Math.min(preset.tStart, pts[pts.length - 1].t))
    init.tEnd = Math.max(init.tStart + dt.value, Math.min(preset.tEnd, pts[pts.length - 1].t))
    init.baseline = { type: preset.linear ? 'linear' : 'zero', y0: preset.y0, y1: preset.y1 }
  }
  history.reset(init)
  pickMode.value = 'none'
  notify(`已载入「${name}」：${pts.length} 点。原始数据保留在本会话，可随时重新导入并重复计算。`)
}

function onVerificationLoad(payload: { name: string; points: Point[]; tStart: number; tEnd: number; y0: number; y1: number; linear: boolean }) {
  loadPoints(payload.name, payload.points, payload)
}

// ---- IndexedDB：保存方法与原始曲线 ----
const saved = ref<StoredCurve[]>([])
const saving = ref(false)

async function refreshSaved() {
  saved.value = await listCurves()
}

async function saveMethod() {
  if (points.value.length === 0) return
  saving.value = true
  try {
    const id = curveId.value || cryptoRandomId()
    await saveCurve(id, curveName.value, points.value, structuredClone(state.value))
    curveId.value = id
    await refreshSaved()
    notify(`方法与原始曲线已保存到本地 IndexedDB（${saved.value.length} 条记录）`)
  } catch (e) {
    notify(`保存失败：${(e as Error).message}`, 'error')
  } finally {
    saving.value = false
  }
}

async function openSaved(row: StoredCurve) {
  points.value = row.points
  curveId.value = row.id
  curveName.value = row.name
  history.reset(structuredClone(row.state))
  pickMode.value = 'none'
  notify(`已打开本地保存的「${row.name}」（${row.points.length} 点）`)
}

async function removeSaved(row: StoredCurve) {
  if (!window.confirm(`确认删除本地记录「${row.name}」？此操作不可撤销。`)) return
  await deleteCurve(row.id)
  if (curveId.value === row.id) curveId.value = ''
  await refreshSaved()
}

function cryptoRandomId(): string {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ---- 快捷键 ----
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    history.undo()
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault()
    history.redo()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    await refreshSaved()
    const lastId = await getLastOpenId()
    if (lastId) {
      const row = saved.value.find((r) => r.id === lastId)
      if (row) {
        points.value = row.points
        curveId.value = row.id
        curveName.value = row.name
        history.reset(structuredClone(row.state))
      }
    }
  } catch (e) {
    notify(`读取本地存储失败：${(e as Error).message}`, 'error')
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  client.dispose()
})

// 模板中需要的引用
const tStartNum = computed({
  get: () => state.value.tStart,
  set: (v: number) => setStart(v)
})
const tEndNum = computed({ get: () => state.value.tEnd, set: (v: number) => setEnd(v) })
const y0Num = computed({ get: () => state.value.baseline.y0, set: (v: number) => setY0(v) })
const y1Num = computed({ get: () => state.value.baseline.y1, set: (v: number) => setY1(v) })
const winNum = computed({ get: () => state.value.smoothing.windowSize, set: (v: number) => setWindow(v) })
const polyNum = computed({ get: () => state.value.smoothing.polynomial, set: (v: number) => setPoly(v) })

const rawCSV = computed(() => points.value.map((p) => `${p.t},${p.y}`).join('\n'))
function downloadCSV() {
  const blob = new Blob([`time,response\n${rawCSV.value}`], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${curveName.value || 'curve'}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="app">
    <header>
      <h1>本地色谱曲线复核工具</h1>
      <p class="subtitle">
        Vue 3 + TypeScript · Plotly.js 绘图 · ml-savitzky-golay / ml-matrix（Web Worker） · IndexedDB 本地保存 · 无服务端
      </p>
    </header>

    <div v-if="message" class="message" :class="message.kind">{{ message.text }}</div>

    <section class="panel toolbar">
      <button class="primary" @click="triggerImport">导入 CSV（时间, 响应值）</button>
      <input ref="fileInput" type="file" accept=".csv,text/csv,text/plain" hidden @change="onFile" />
      <button :disabled="points.length === 0" @click="downloadCSV">导出当前原始数据 CSV</button>
      <button class="primary" :disabled="points.length === 0 || saving" @click="saveMethod">
        {{ saving ? '保存中…' : '保存方法 + 原始曲线' }}
      </button>
      <div class="hist">
        <button :disabled="!history.canUndo.value" @click="history.undo()" title="Ctrl+Z">↶ 撤销</button>
        <button :disabled="!history.canRedo.value" @click="history.redo()" title="Ctrl+Shift+Z">↷ 重做</button>
      </div>
      <div v-if="curveName" class="session">
        当前：<b>{{ curveName }}</b>（{{ pointCount }} 点，t ∈ [{{ fmtNum(tMin, 3) }}, {{ fmtNum(tMax, 3) }}]，平均步长
        {{ fmtNum(dt, 5) }}）<span v-if="curveId" class="saved-tag">已存本地</span>
      </div>
    </section>

    <div v-if="saved.length" class="panel saved">
      <h2>本地保存的曲线与方法（IndexedDB）</h2>
      <ul>
        <li v-for="row in saved" :key="row.id">
          <button class="link" @click="openSaved(row)">{{ row.name }}</button>
          <span class="meta">
            {{ row.points.length }} 点 · 区间 [{{ fmtNum(row.state.tStart, 3) }}, {{ fmtNum(row.state.tEnd, 3) }}] ·
            {{ row.state.baseline.type === 'zero' ? '零基线' : '直线基线' }} ·
            {{ new Date(row.savedAt).toLocaleString() }}
          </span>
          <button class="danger" @click="removeSaved(row)">删除</button>
        </li>
      </ul>
    </div>

    <div class="main-grid">
      <aside class="panel controls">
        <h2>积分区间（手工设置）</h2>
        <label>
          起点时间
          <div class="row">
            <input v-model.number="tStartNum" type="number" step="any" :disabled="!points.length" />
            <button :class="{ active: pickMode === 'start' }" @click="pickMode = pickMode === 'start' ? 'none' : 'start'">图上拾取</button>
          </div>
        </label>
        <label>
          终点时间
          <div class="row">
            <input v-model.number="tEndNum" type="number" step="any" :disabled="!points.length" />
            <button :class="{ active: pickMode === 'end' }" @click="pickMode = pickMode === 'end' ? 'none' : 'end'">图上拾取</button>
          </div>
        </label>

        <h2>直线基线（手工设置）</h2>
        <div class="seg">
          <button :class="{ active: state.baseline.type === 'linear' }" @click="setBaselineType('linear')">直线基线</button>
          <button :class="{ active: state.baseline.type === 'zero' }" @click="setBaselineType('zero')">零基线</button>
        </div>
        <template v-if="state.baseline.type === 'linear'">
          <label>
            起点基线响应 y₀（t = {{ fmtNum(state.tStart, 3) }}）
            <div class="row">
              <input v-model.number="y0Num" type="number" step="any" />
              <button @click="snapStartToCurve">贴曲线</button>
            </div>
          </label>
          <label>
            终点基线响应 y₁（t = {{ fmtNum(state.tEnd, 3) }}）
            <div class="row">
              <input v-model.number="y1Num" type="number" step="any" />
              <button @click="snapEndToCurve">贴曲线</button>
            </div>
          </label>
          <div class="row baseline-helper">
            <label class="inline">
              边缘点数
              <input v-model.number="edgePoints" type="number" min="2" step="1" style="width: 70px" />
            </label>
            <button :disabled="busyBaseline || !result" @click="autoEstimateBaseline">
              {{ busyBaseline ? '计算中…' : 'Worker 最小二乘估算（可再改）' }}
            </button>
          </div>
        </template>

        <h2>平滑辅助曲线（可选项）</h2>
        <label class="check">
          <input :checked="state.smoothing.enabled" type="checkbox" @change="toggleSmoothing(($event.target as HTMLInputElement).checked)" />
          显示 Savitzky–Golay 平滑曲线
          <span v-if="busySmooth" class="spin">计算中…</span>
        </label>
        <label>
          窗口大小（奇数）
          <input v-model.number="winNum" type="number" min="3" step="2" :disabled="!state.smoothing.enabled" />
        </label>
        <label>
          多项式阶数
          <input v-model.number="polyNum" type="number" min="1" step="1" :disabled="!state.smoothing.enabled" />
        </label>
        <p class="hint">平滑曲线（橙色虚线）仅供观察峰形，<b>不参与</b>面积计算；面积始终对蓝色原始曲线积分。</p>
      </aside>

      <main class="panel chart-panel">
        <PlotChart
          v-if="points.length"
          :curve-id="curveId || curveName"
          :points="points"
          :smoothed="smoothed"
          :show-smoothed="state.smoothing.enabled"
          :t-start="state.tStart"
          :t-end="state.tEnd"
          :baseline="state.baseline"
          :pick-mode="pickMode"
          @pick="onPick"
        />
        <div v-else class="empty">
          尚未导入数据。可：<br />
          1）点击左上角「导入 CSV」；<br />
          2）在下方<span class="strong">面积核对</span>面板把已知面积合成峰或可见样例曲线载入复核区。
        </div>

        <section v-if="result" class="results">
          <h2>梯形法面积（基于原始数据）</h2>
          <div class="cards">
            <div class="card">
              <div class="k">毛面积（相对零轴）</div>
              <div class="v">{{ fmtArea(result.grossArea) }}</div>
            </div>
            <div class="card">
              <div class="k">基线下方面积</div>
              <div class="v">{{ fmtArea(result.baselineArea) }}</div>
            </div>
            <div class="card highlight">
              <div class="k">净面积（基线校正后）</div>
              <div class="v">{{ fmtArea(result.netArea) }}</div>
            </div>
          </div>
          <p class="hint">
            区间 [{{ fmtNum(result.tStart, 5) }}, {{ fmtNum(result.tEnd, 5) }}]，区间采样点起止响应：
            {{ fmtNum(result.yAtStart, 5) }} / {{ fmtNum(result.yAtEnd, 5) }}；
            基线端点：{{ fmtNum(result.bAtStart, 5) }} / {{ fmtNum(result.bAtEnd, 5) }}
            <span v-if="state.baseline.type === 'zero'">（零基线模式，净面积＝毛面积）</span>
          </p>

          <h3>当前基线 与 调整前后差异</h3>
          <table>
            <thead>
              <tr><th>项目</th><th>当前</th><th>调整前</th><th>差值 Δ</th><th>相对变化</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in diffRows" :key="r.label">
                <td>{{ r.label }}</td>
                <td class="num">{{ r.cur }}</td>
                <td class="num">{{ r.prev }}</td>
                <td class="num" :class="{ changed: r.delta !== '—' && r.delta !== '+0.000000' && r.delta !== '+0.0000' }">{{ r.delta }}</td>
                <td class="num">{{ r.rel }}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">“调整前”为撤销栈中最近一次提交时的设置；无历史（刚导入 / 重做到底）时显示 “—”。</p>
        </section>
      </main>
    </div>

    <VerificationPanel @load-points="onVerificationLoad" />

    <footer>
      全部计算与存储均在本机浏览器完成；原始数据不会被修改，重新导入后可对同一条曲线重复计算。
    </footer>
  </div>
</template>

<style>
:root {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  color: #0f172a;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f1f5f9;
}
button {
  cursor: pointer;
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
}
button:hover:not(:disabled) {
  border-color: #1d4ed8;
  color: #1d4ed8;
}
button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.primary {
  background: #1d4ed8;
  color: #fff;
  border-color: #1d4ed8;
}
button.primary:hover:not(:disabled) {
  background: #1e40af;
  color: #fff;
}
button.active {
  background: #fef3c7;
  border-color: #f59e0b;
  color: #92400e;
}
button.danger {
  color: #b91c1c;
  border-color: #fecaca;
}
input[type='number'] {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
</style>

<style scoped>
.app {
  max-width: 1400px;
  margin: 0 auto;
  padding: 16px 20px 40px;
}
header h1 {
  margin: 8px 0 2px;
  font-size: 22px;
}
.subtitle {
  margin: 0 0 12px;
  color: #64748b;
  font-size: 12px;
}
.panel {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 14px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hist {
  display: flex;
  gap: 6px;
  margin-left: auto;
}
.session {
  width: 100%;
  font-size: 12px;
  color: #475569;
}
.saved-tag {
  margin-left: 6px;
  background: #dcfce7;
  color: #166534;
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
}
.saved h2 {
  font-size: 14px;
  margin: 0 0 8px;
}
.saved ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.saved li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.saved .meta {
  color: #64748b;
  font-size: 12px;
  flex: 1;
}
.saved .link {
  border: none;
  color: #1d4ed8;
  text-decoration: underline;
  padding: 0;
  background: none;
}
.main-grid {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 14px;
  align-items: start;
}
.controls h2 {
  font-size: 14px;
  margin: 14px 0 8px;
}
.controls h2:first-child {
  margin-top: 0;
}
.controls label {
  display: block;
  font-size: 12px;
  color: #334155;
  margin-bottom: 10px;
}
.controls input {
  margin-top: 4px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.row input {
  flex: 1;
}
.row button {
  white-space: nowrap;
}
.seg {
  display: flex;
  gap: 6px;
  margin-bottom: 10px;
}
.seg button {
  flex: 1;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
}
.check input {
  width: auto;
  margin: 0;
}
.inline {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}
.baseline-helper {
  margin: 4px 0 12px;
}
.hint {
  font-size: 11px;
  color: #64748b;
  line-height: 1.6;
}
.spin {
  color: #b45309;
}
.chart-panel {
  min-width: 0;
}
.empty {
  height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #64748b;
  line-height: 2;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
}
.strong {
  font-weight: 700;
  color: #b91c1c;
}
.results {
  margin-top: 14px;
}
.results h2 {
  font-size: 15px;
  margin: 4px 0 10px;
}
.results h3 {
  font-size: 13px;
  margin: 16px 0 6px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 12px;
  background: #f8fafc;
}
.card .k {
  font-size: 12px;
  color: #64748b;
}
.card .v {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
}
.card.highlight {
  background: #ecfdf5;
  border-color: #6ee7b7;
}
.card.highlight .v {
  color: #047857;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th,
td {
  border: 1px solid #e2e8f0;
  padding: 5px 8px;
}
th {
  background: #f1f5f9;
  text-align: left;
}
td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
td.changed {
  color: #b45309;
  font-weight: 600;
}
.message {
  padding: 8px 14px;
  border-radius: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.message.info {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  color: #1e40af;
}
.message.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}
footer {
  text-align: center;
  color: #94a3b8;
  font-size: 12px;
  margin-top: 18px;
}
@media (max-width: 980px) {
  .main-grid {
    grid-template-columns: 1fr;
  }
}
</style>
