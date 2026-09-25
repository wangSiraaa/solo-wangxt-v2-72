<script setup lang="ts">
import { computed } from 'vue';
import {
  applyBaselineFit,
  integration,
  requestBaselineFit,
  resetBaselineOffsets,
  setBaselineOffset,
  setEndTime,
  setFullRange,
  setStartTime,
  smoothedIntegration,
  state,
  swapBounds,
} from '../store';
import { fmt, fmtPct } from '../lib/format';

const timeStep = computed(() => {
  const c = state.curve;
  if (!c || c.time.length < 2) return 0.01;
  const dt = (c.time[c.time.length - 1] - c.time[0]) / (c.time.length - 1);
  return Number(dt.toPrecision(3)) || 0.01;
});

const fitEquation = computed(() => {
  const fit = state.baselineFit;
  if (!fit) return '';
  const terms = fit.coefficients.map((c, j) => {
    const coef = fmt(c, 4);
    if (j === 0) return coef;
    return `${coef}·(t−${fmt(fit.center, 4)})^${j}`;
  });
  return `y = ${terms.join(' + ')}`;
});

function onStartInput(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(v)) setStartTime(v);
}

function onEndInput(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(v)) setEndTime(v);
}

function onOffset(which: 'start' | 'end', ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  if (Number.isFinite(v)) setBaselineOffset(which, v);
}

function togglePick(mode: 'start' | 'end'): void {
  state.pickMode = state.pickMode === mode ? null : mode;
}

function copyResults(): void {
  const r = integration.value;
  const c = state.curve;
  if (!r || !c) return;
  const lines = [
    `曲线: ${c.name}`,
    `积分区间: ${state.method.startTime} ~ ${state.method.endTime}`,
    `信号毛面积: ${r.grossArea}`,
    `当前基线面积: ${r.baselineArea}`,
    `净面积(当前基线): ${r.netArea}`,
    `净面积(默认基线/调整前): ${r.defaultNetArea}`,
    `差值(调整后-调整前): ${r.deltaVsDefault}`,
    `基线方程: y = ${r.slope} * t + ${r.intercept}`,
  ];
  void navigator.clipboard?.writeText(lines.join('\n'));
  state.status = '结果已复制到剪贴板';
}
</script>

<template>
  <section class="panel">
    <h2>峰区间与基线</h2>

    <div class="row">
      <label class="field">
        <span>起点时间</span>
        <input
          type="number"
          :step="timeStep"
          :value="state.method.startTime ?? ''"
          placeholder="未设置"
          @change="onStartInput"
        />
      </label>
      <label class="field">
        <span>终点时间</span>
        <input
          type="number"
          :step="timeStep"
          :value="state.method.endTime ?? ''"
          placeholder="未设置"
          @change="onEndInput"
        />
      </label>
    </div>
    <div class="btnbar">
      <button
        type="button"
        :class="{ active: state.pickMode === 'start' }"
        @click="togglePick('start')"
      >
        图上拾取起点
      </button>
      <button
        type="button"
        :class="{ active: state.pickMode === 'end' }"
        @click="togglePick('end')"
      >
        图上拾取终点
      </button>
      <button type="button" @click="setFullRange">设为全范围</button>
      <button type="button" @click="swapBounds">交换起终点</button>
    </div>

    <h3 class="sub">直线基线（端点偏移）</h3>
    <div class="row">
      <label class="field">
        <span>起点偏移</span>
        <input
          type="number"
          step="0.1"
          :value="state.method.baseline.startOffset"
          @change="onOffset('start', $event)"
        />
      </label>
      <label class="field">
        <span>终点偏移</span>
        <input
          type="number"
          step="0.1"
          :value="state.method.baseline.endOffset"
          @change="onOffset('end', $event)"
        />
      </label>
    </div>
    <div class="btnbar">
      <button type="button" @click="resetBaselineOffsets">偏移归零</button>
      <button
        type="button"
        :disabled="state.baselineFitBusy"
        @click="requestBaselineFit(1)"
      >
        {{ state.baselineFitBusy ? '拟合中…' : '拟合基线（Worker）' }}
      </button>
      <button
        type="button"
        :disabled="!state.baselineFit || !integration"
        @click="applyBaselineFit"
      >
        采用拟合基线
      </button>
    </div>
    <p v-if="state.baselineFit" class="muted">拟合结果：{{ fitEquation }}</p>

    <template v-if="integration">
      <h3 class="sub">积分结果（梯形法）</h3>
      <table class="results">
        <tbody>
          <tr>
            <td>信号毛面积</td>
            <td>{{ fmt(integration.grossArea) }}</td>
          </tr>
          <tr>
            <td>当前基线面积</td>
            <td>{{ fmt(integration.baselineArea) }}</td>
          </tr>
          <tr class="highlight">
            <td>净面积（当前基线）</td>
            <td>{{ fmt(integration.netArea) }}</td>
          </tr>
          <tr>
            <td>净面积（默认基线 · 调整前）</td>
            <td>{{ fmt(integration.defaultNetArea) }}</td>
          </tr>
          <tr class="highlight">
            <td>差值（调整后 − 调整前）</td>
            <td>
              {{ fmt(integration.deltaVsDefault) }}（{{
                fmtPct(
                  integration.defaultNetArea !== 0
                    ? integration.deltaVsDefault / integration.defaultNetArea
                    : NaN,
                )
              }}）
            </td>
          </tr>
          <tr>
            <td>基线方程</td>
            <td class="eq">y = {{ fmt(integration.slope) }}·t + {{ fmt(integration.intercept) }}</td>
          </tr>
          <tr>
            <td>基线端点值</td>
            <td>
              {{ fmt(integration.baselineStartY) }} → {{ fmt(integration.baselineEndY) }}
            </td>
          </tr>
          <tr>
            <td>区间内采样点</td>
            <td>{{ integration.pointCount }}</td>
          </tr>
          <tr v-if="smoothedIntegration">
            <td>平滑曲线净面积（参考）</td>
            <td>{{ fmt(smoothedIntegration.netArea) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="btnbar" style="margin-top: 8px">
        <button type="button" @click="copyResults">复制结果</button>
      </div>
    </template>
    <p v-else class="muted">设置峰起点与终点后，此处显示梯形法积分结果。</p>
  </section>
</template>

<style scoped>
.sub {
  font-size: 12px;
  color: var(--muted);
  margin: 14px 0 6px;
}
.highlight td {
  font-weight: 600;
  background: #f0f6ff;
}
.eq {
  font-family: ui-monospace, Consolas, monospace;
  font-size: 12px;
}
</style>
