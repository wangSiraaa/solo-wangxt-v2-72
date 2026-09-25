<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import ChromatogramPlot from './components/ChromatogramPlot.vue';
import ImportPanel from './components/ImportPanel.vue';
import SmoothingPanel from './components/SmoothingPanel.vue';
import PeakEditor from './components/PeakEditor.vue';
import MethodPanel from './components/MethodPanel.vue';
import VerifyPanel from './components/VerifyPanel.vue';
import {
  canRedo,
  canUndo,
  initStore,
  integration,
  pickTime,
  redo,
  state,
  undo,
} from './store';
import { interpolate } from './lib/integrate';

const defaultBaselineY = computed<[number, number] | null>(() => {
  const c = state.curve;
  const { startTime, endTime } = state.method;
  if (!c || startTime == null || endTime == null || endTime <= startTime) return null;
  return [
    interpolate(c.time, c.response, startTime),
    interpolate(c.time, c.response, endTime),
  ];
});

function onKey(ev: KeyboardEvent): void {
  const tag = (document.activeElement?.tagName ?? '').toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!(ev.ctrlKey || ev.metaKey)) return;
  const key = ev.key.toLowerCase();
  if (key === 'z' && !ev.shiftKey) {
    ev.preventDefault();
    undo();
  } else if (key === 'y' || (key === 'z' && ev.shiftKey)) {
    ev.preventDefault();
    redo();
  }
}

onMounted(() => {
  void initStore();
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <header class="topbar">
    <h1>色谱曲线复核工具</h1>
    <div class="btnbar">
      <button type="button" :disabled="!canUndo" title="Ctrl+Z" @click="undo">
        撤销{{ state.past.length ? ` (${state.past.length})` : '' }}
      </button>
      <button type="button" :disabled="!canRedo" title="Ctrl+Y / Ctrl+Shift+Z" @click="redo">
        重做{{ state.future.length ? ` (${state.future.length})` : '' }}
      </button>
    </div>
    <span class="status">{{ state.status }}</span>
  </header>

  <div class="layout">
    <aside>
      <ImportPanel />
      <SmoothingPanel />
      <MethodPanel />
    </aside>

    <main>
      <template v-if="state.curve">
        <ChromatogramPlot
          :time="state.curve.time"
          :raw="state.curve.response"
          :smoothed="state.smoothed"
          :show-smoothed="state.showSmoothed && state.method.smoothing.enabled"
          :start="state.method.startTime"
          :end="state.method.endTime"
          :baseline-start-y="integration ? integration.baselineStartY : null"
          :baseline-end-y="integration ? integration.baselineEndY : null"
          :default-baseline-y="defaultBaselineY"
          :fit-values="state.baselineFit ? state.baselineFit.values : null"
          :pick-mode="state.pickMode"
          @pick="pickTime"
        />
        <PeakEditor />
      </template>
      <div v-else class="placeholder">
        <p>尚未载入曲线。</p>
        <p class="muted">
          请在左侧导入 CSV 文件，或点击“载入示例曲线”。导入后可手工设置峰起止点与直线基线，
          系统用梯形法计算面积；原始曲线始终显示，支持撤销/重做与重新导入。
        </p>
      </div>

      <VerifyPanel />
    </main>
  </div>
</template>
