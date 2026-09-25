<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getPlotly } from '../lib/plotly';
import { interpolate } from '../lib/integrate';

const Plotly = getPlotly();

const props = defineProps<{
  time: number[];
  raw: number[];
  smoothed: number[] | null;
  showSmoothed: boolean;
  start: number | null;
  end: number | null;
  baselineStartY: number | null;
  baselineEndY: number | null;
  /** 默认基线（端点信号值），用于与当前基线对比。 */
  defaultBaselineY: [number, number] | null;
  /** Worker 拟合的基线建议（全段取值）。 */
  fitValues: number[] | null;
  pickMode: 'start' | 'end' | null;
}>();

const emit = defineEmits<{ (e: 'pick', t: number): void }>();

const el = ref<HTMLDivElement | null>(null);

function buildSegment(a: number, b: number): { xs: number[]; ys: number[] } {
  const { time, raw } = props;
  const xs: number[] = [a];
  const ys: number[] = [interpolate(time, raw, a)];
  for (let i = 0; i < time.length; i++) {
    if (time[i] > a && time[i] < b) {
      xs.push(time[i]);
      ys.push(raw[i]);
    }
  }
  xs.push(b);
  ys.push(interpolate(time, raw, b));
  return { xs, ys };
}

function buildTraces(): unknown[] {
  const traces: unknown[] = [
    {
      x: props.time,
      y: props.raw,
      mode: 'lines',
      type: 'scatter',
      name: '原始曲线',
      line: { color: '#1f6feb', width: 1.4 },
    },
  ];

  if (props.showSmoothed && props.smoothed) {
    traces.push({
      x: props.time,
      y: props.smoothed,
      mode: 'lines',
      type: 'scatter',
      name: '平滑辅助曲线',
      line: { color: '#e8890c', width: 1.4, dash: 'dash' },
    });
  }

  if (props.fitValues) {
    traces.push({
      x: props.time,
      y: props.fitValues,
      mode: 'lines',
      type: 'scatter',
      name: '拟合基线建议',
      line: { color: '#1a7f37', width: 1.2, dash: 'dot' },
    });
  }

  const { start, end } = props;
  if (start != null && end != null && end > start) {
    if (props.defaultBaselineY) {
      traces.push({
        x: [start, end],
        y: props.defaultBaselineY,
        mode: 'lines',
        type: 'scatter',
        name: '默认基线（端点连线）',
        line: { color: '#8b949e', width: 1, dash: 'dot' },
        hoverinfo: 'skip',
      });
    }
    if (props.baselineStartY != null && props.baselineEndY != null) {
      const { xs, ys } = buildSegment(start, end);
      const b0 = props.baselineStartY;
      const b1 = props.baselineEndY;
      const baseY = xs.map((x) => b0 + ((b1 - b0) * (x - start)) / (end - start));
      traces.push({
        x: xs,
        y: baseY,
        mode: 'lines',
        type: 'scatter',
        name: '当前基线',
        line: { color: '#c93c37', width: 2 },
        hoverinfo: 'skip',
      });
      traces.push({
        x: xs,
        y: ys,
        mode: 'lines',
        type: 'scatter',
        name: '积分区间',
        line: { width: 0 },
        fill: 'tonexty',
        fillcolor: 'rgba(31, 111, 235, 0.15)',
        hoverinfo: 'skip',
      });
      traces.push({
        x: [start, end],
        y: [b0, b1],
        mode: 'markers',
        type: 'scatter',
        name: '基线锚点',
        showlegend: false,
        marker: { color: '#c93c37', size: 8, symbol: 'square' },
        hoverinfo: 'skip',
      });
    }
  }
  return traces;
}

function buildLayout(): Record<string, unknown> {
  const shapes: unknown[] = [];
  const annotations: unknown[] = [];
  const { start, end } = props;
  if (start != null) {
    shapes.push({
      type: 'line',
      x0: start,
      x1: start,
      yref: 'paper',
      y0: 0,
      y1: 1,
      line: { color: '#1a7f37', width: 1.5, dash: 'dash' },
    });
    annotations.push({
      x: start,
      y: 1,
      yref: 'paper',
      text: '起点',
      showarrow: false,
      yanchor: 'bottom',
      font: { color: '#1a7f37', size: 11 },
    });
  }
  if (end != null) {
    shapes.push({
      type: 'line',
      x0: end,
      x1: end,
      yref: 'paper',
      y0: 0,
      y1: 1,
      line: { color: '#c93c37', width: 1.5, dash: 'dash' },
    });
    annotations.push({
      x: end,
      y: 1,
      yref: 'paper',
      text: '终点',
      showarrow: false,
      yanchor: 'bottom',
      font: { color: '#c93c37', size: 11 },
    });
  }
  return {
    uirevision: 'chromatogram',
    margin: { l: 70, r: 20, t: 34, b: 50 },
    xaxis: { title: { text: '时间' } },
    yaxis: { title: { text: '响应' } },
    showlegend: true,
    legend: { orientation: 'h', y: 1.14 },
    hovermode: 'x unified',
    shapes,
    annotations,
  };
}

const CONFIG = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  modeBarButtonsToRemove: ['select2d', 'lasso2d'],
};

let clickBound = false;

async function render(): Promise<void> {
  if (!el.value) return;
  await Plotly.react(el.value, buildTraces(), buildLayout(), CONFIG);
  if (!clickBound && el.value) {
    clickBound = true;
    (el.value as unknown as { on: (ev: string, cb: (e: unknown) => void) => void }).on(
      'plotly_click',
      (e: unknown) => {
        if (!props.pickMode) return;
        const pts = (e as { points?: Array<{ x: number }> }).points;
        const x = pts && pts[0] ? pts[0].x : undefined;
        if (typeof x === 'number') emit('pick', x);
      },
    );
  }
}

onMounted(render);
onBeforeUnmount(() => {
  if (el.value) Plotly.purge(el.value);
});

watch(
  () => [
    props.raw,
    props.smoothed,
    props.showSmoothed,
    props.start,
    props.end,
    props.baselineStartY,
    props.baselineEndY,
    props.defaultBaselineY,
    props.fitValues,
    props.pickMode,
  ],
  () => {
    void render();
  },
);
</script>

<template>
  <div class="plot-wrap" :class="{ picking: pickMode }">
    <div ref="el" class="plot"></div>
    <div v-if="pickMode" class="pick-hint">
      正在拾取{{ pickMode === 'start' ? '起点' : '终点' }}：请在图上点击对应位置
    </div>
  </div>
</template>

<style scoped>
.plot-wrap {
  position: relative;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
}
.plot-wrap.picking {
  cursor: crosshair;
  outline: 2px solid var(--accent);
}
.plot {
  width: 100%;
  height: 460px;
}
.pick-hint {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(31, 111, 235, 0.92);
  color: #fff;
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 10px;
  pointer-events: none;
}
</style>
