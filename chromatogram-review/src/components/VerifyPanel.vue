<script setup lang="ts">
import { ref } from 'vue';
import { buildVerificationCases, type VerificationCase } from '../lib/synthetic';
import { integratePeak, trapezoidArea } from '../lib/integrate';
import { importCurve } from '../store';
import { fmt, fmtPct, fmtTime } from '../lib/format';

interface VerifyRow {
  kase: VerificationCase;
  refNet: number;
  refDiff: number;
  refRel: number;
  anchoredNet: number;
  anchoredDiff: number;
  anchoredRel: number;
}

const rows = ref<VerifyRow[]>([]);
const ranAt = ref<number | null>(null);

function run(): void {
  rows.value = buildVerificationCases().map((kase) => {
    const { time, response } = kase.curve;
    const [t0, t1] = kase.interval;
    const gross = trapezoidArea(time, response, t0, t1);
    const baseArea = trapezoidArea(time, time.map(kase.referenceBaseline), t0, t1);
    const refNet = gross - baseArea;
    // 模拟手工工作流：端点连线（零偏移）直线基线
    const anchoredNet = integratePeak(time, response, t0, t1, 0, 0).netArea;
    return {
      kase,
      refNet,
      refDiff: refNet - kase.knownArea,
      refRel: (refNet - kase.knownArea) / kase.knownArea,
      anchoredNet,
      anchoredDiff: anchoredNet - kase.knownArea,
      anchoredRel: (anchoredNet - kase.knownArea) / kase.knownArea,
    };
  });
  ranAt.value = Date.now();
}

function loadCase(kase: VerificationCase): void {
  void importCurve(kase.curve, { interval: kase.interval });
}
</script>

<template>
  <section class="panel">
    <h2>面积核对（已知面积合成峰 + 可见样例）</h2>
    <p class="muted">
      用解析面积已知的高斯峰与一条可见样例曲线核对梯形法实现。表中列出全部数值，
      请人工判断相对差的数量级是否合理——本工具不给出通过/失败的自动结论。
      “参考基线”列扣除真实基线，检验积分本身；“端点连线”列模拟手工零偏移基线工作流，
      其差异还包含基线模型误差（如样例 C 的弯曲基线）。
    </p>
    <div class="btnbar">
      <button type="button" class="primary" @click="run">运行核对</button>
      <span v-if="ranAt" class="muted">上次运行：{{ fmtTime(ranAt) }}</span>
    </div>

    <div v-if="rows.length" class="table-scroll">
      <table class="results verify">
        <thead>
          <tr>
            <th>用例</th>
            <th>已知面积</th>
            <th>净面积（参考基线）</th>
            <th>差值</th>
            <th>相对差</th>
            <th>净面积（端点连线）</th>
            <th>相对差</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.kase.id">
            <td :title="r.kase.description">{{ r.kase.title }}</td>
            <td>{{ fmt(r.kase.knownArea) }}</td>
            <td>{{ fmt(r.refNet) }}</td>
            <td>{{ fmt(r.refDiff) }}</td>
            <td>{{ fmtPct(r.refRel) }}</td>
            <td>{{ fmt(r.anchoredNet) }}</td>
            <td>{{ fmtPct(r.anchoredRel) }}</td>
            <td>
              <button type="button" @click="loadCase(r.kase)">载入查看</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        参考：A/B 为无噪合成峰，相对差通常在 1e-6 量级以下（梯形离散 + 区间截断已按 erf
        修正）；C 含噪声与弯曲基线，“参考基线”列反映噪声涨落，“端点连线”列还包含直线
        基线对弯曲基线的模型误差。点击“载入查看”可在主视图中看到对应曲线并手工调整复核。
      </p>
    </div>
  </section>
</template>

<style scoped>
.table-scroll {
  overflow-x: auto;
  margin-top: 8px;
}
.verify th {
  color: var(--muted);
  font-weight: 500;
  white-space: nowrap;
}
.verify td {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
