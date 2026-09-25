<script setup lang="ts">
import { computed } from 'vue';
import {
  setSmoothingEnabled,
  setSmoothingPolynomial,
  setSmoothingWindow,
  state,
} from '../store';

const polyOptions = computed(() => {
  const max = Math.min(6, state.method.smoothing.windowSize - 1);
  const opts: number[] = [];
  for (let p = 2; p <= max; p++) opts.push(p);
  return opts;
});
</script>

<template>
  <section class="panel">
    <h2>平滑（可选辅助曲线）</h2>
    <label class="check">
      <input
        type="checkbox"
        :checked="state.method.smoothing.enabled"
        @change="setSmoothingEnabled(($event.target as HTMLInputElement).checked)"
      />
      启用 Savitzky-Golay 平滑（Web Worker 计算）
    </label>

    <template v-if="state.method.smoothing.enabled">
      <label class="field">
        <span>窗口大小：{{ state.method.smoothing.windowSize }}（奇数）</span>
        <input
          type="range"
          min="5"
          max="51"
          step="2"
          :value="state.method.smoothing.windowSize"
          @change="setSmoothingWindow(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <label class="field">
        <span>多项式阶次</span>
        <select
          :value="state.method.smoothing.polynomial"
          @change="setSmoothingPolynomial(Number(($event.target as HTMLSelectElement).value))"
        >
          <option v-for="p in polyOptions" :key="p" :value="p">{{ p }}</option>
        </select>
      </label>
      <label class="check">
        <input type="checkbox" v-model="state.showSmoothed" />
        在图上显示平滑辅助曲线
      </label>
      <p v-if="state.smoothingBusy" class="muted">正在后台计算平滑…</p>
      <p v-if="state.smoothingError" class="error">{{ state.smoothingError }}</p>
    </template>

    <p class="muted">
      平滑曲线仅作视觉辅助；面积计算默认基于原始曲线，原始数据始终显示。
    </p>
  </section>
</template>

<style scoped>
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
}
</style>
