<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Plotly from 'plotly.js-dist-min'
import type { BaselineMode, Point } from '../types'
import { baselineAt } from '../lib/integration'

const props = defineProps<{
  curveId: string
  points: Point[]
  smoothed: number[] | null
  showSmoothed: boolean
  tStart: number
  tEnd: number
  baseline: BaselineMode
  pickMode: 'none' | 'start' | 'end'
}>()

const emit = defineEmits<{
  (e: 'pick', t: number): void
}>()

const el = ref<HTMLDivElement | null>(null)
let ro: ResizeObserver | null = null

interface DataTrace {
  x: number[]
  y: number[]
  [key: string]: unknown
}

function buildTraces(): DataTrace[] {
  const traces: DataTrace[] = [
    {
      x: props.points.map((p) => p.t),
      y: props.points.map((p) => p.y),
      type: 'scattergl',
      mode: 'lines',
      name: '原始曲线',
      line: { color: '#1d4ed8', width: 1.5 },
      hovertemplate: '时间 %{x:.4f}<br>原始响应 %{y:.4f}<extra></extra>'
    }
  ]

  if (props.showSmoothed && props.smoothed) {
    traces.push({
      x: props.points.map((p) => p.t),
      y: props.smoothed,
      type: 'scattergl',
      mode: 'lines',
      name: 'SG 平滑（仅辅助）',
      line: { color: '#f59e0b', width: 1.5, dash: 'dash' },
      hovertemplate: '时间 %{x:.4f}<br>平滑响应 %{y:.4f}<extra></extra>'
    })
  }

  // 积分区间内：基线轨迹 + 原始曲线轨迹，两者之间填充表示净面积
  if (props.tEnd > props.tStart) {
    const inPts = props.points.filter((p) => p.t >= props.tStart && p.t <= props.tEnd)
    if (inPts.length >= 2) {
      const xs = inPts.map((p) => p.t)
      const bys = xs.map((t) => baselineAt(props.baseline, t, props.tStart, props.tEnd))
      traces.push({
        x: xs,
        y: bys,
        type: 'scattergl',
        mode: 'lines',
        name: '当前基线',
        line: { color: '#dc2626', width: 2 },
        hoverinfo: 'skip',
        showlegend: true
      })
      traces.push({
        x: xs,
        y: inPts.map((p) => p.y),
        type: 'scattergl',
        mode: 'lines',
        name: '净面积区域',
        fill: 'tonexty',
        fillcolor: 'rgba(22, 163, 74, 0.18)',
        line: { width: 0, color: 'rgba(22,163,74,0)' },
        hoverinfo: 'skip',
        showlegend: true
      })
      // 起止点锚点
      traces.push({
        x: [props.tStart, props.tEnd],
        y: [
          baselineAt(props.baseline, props.tStart, props.tStart, props.tEnd),
          baselineAt(props.baseline, props.tEnd, props.tStart, props.tEnd)
        ],
        type: 'scattergl',
        mode: 'markers',
        name: '基线端点',
        marker: { color: '#dc2626', size: 9, symbol: 'diamond' },
        hovertemplate: '基线端点 %{x:.4f}, %{y:.4f}<extra></extra>'
      })
    }
  }

  return traces
}

function buildLayout() {
  return {
    title: { text: '色谱曲线复核（原始数据始终保留）', font: { size: 15 } },
    xaxis: { title: '时间', zeroline: false, showgrid: true, gridcolor: '#e5e7eb' },
    yaxis: { title: '响应值', zeroline: false, showgrid: true, gridcolor: '#e5e7eb' },
    margin: { l: 64, r: 24, t: 48, b: 52 },
    legend: { orientation: 'h', y: -0.18 },
    hovermode: 'closest',
    plot_bgcolor: '#fafafa',
    paper_bgcolor: '#ffffff',
    shapes: buildShapes(),
    annotations: [
      props.pickMode !== 'none'
        ? {
            text: props.pickMode === 'start' ? '点击曲线设置【起点】，完成后在左侧关闭拾取' : '点击曲线设置【终点】，完成后在左侧关闭拾取',
            xref: 'paper',
            yref: 'paper',
            x: 0.5,
            y: 1.07,
            showarrow: false,
            font: { color: '#b45309', size: 12 },
            bgcolor: '#fef3c7',
            bordercolor: '#f59e0b',
            borderwidth: 1,
            borderpad: 4
          }
        : {}
    ],
    uirevision: props.curveId
  }
}

function buildShapes() {
  const shapes: Record<string, unknown>[] = []
  if (props.tEnd > props.tStart) {
    for (const t of [props.tStart, props.tEnd]) {
      shapes.push({
        type: 'line',
        xref: 'x',
        yref: 'paper',
        x0: t,
        x1: t,
        y0: 0,
        y1: 1,
        line: { color: '#7c3aed', width: 1.5, dash: 'dash' }
      })
    }
  }
  return shapes
}

function render() {
  if (!el.value || props.points.length === 0) return
  Plotly.react(
    el.value,
    buildTraces(),
    buildLayout(),
    {
      responsive: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines']
    }
  )
}

onMounted(() => {
  render()
  ;(el.value as unknown as { on: (ev: string, cb: (d: { points?: { x: number }[] }) => void) => void }).on(
    'plotly_click',
    (eventData) => {
      if (props.pickMode !== 'none') {
        const x = eventData.points?.[0]?.x
        if (typeof x === 'number') emit('pick', x)
      }
    }
  )
  if (el.value && 'ResizeObserver' in window) {
    ro = new ResizeObserver(() => el.value && Plotly.Plots.resize(el.value))
    ro.observe(el.value)
  }
})

watch(
  () => [
    props.points,
    props.smoothed,
    props.showSmoothed,
    props.tStart,
    props.tEnd,
    props.baseline,
    props.pickMode,
    props.curveId
  ],
  render,
  { deep: true }
)

onBeforeUnmount(() => {
  ro?.disconnect()
  if (el.value) Plotly.purge(el.value)
})
</script>

<template>
  <div ref="el" class="chart" :class="{ picking: pickMode !== 'none' }"></div>
</template>

<style scoped>
.chart {
  width: 100%;
  height: 520px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
}
.chart.picking {
  cursor: crosshair;
  border-color: #f59e0b;
}
</style>
