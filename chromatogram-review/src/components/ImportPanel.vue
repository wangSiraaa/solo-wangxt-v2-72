<script setup lang="ts">
import { ref } from 'vue';
import { buildCurve, parseCsvText, type ParsedTable } from '../lib/csv';
import { makeSampleCurve } from '../lib/synthetic';
import { deleteSavedCurve, importCurve, loadSavedCurve, state } from '../store';
import { fmtTime } from '../lib/format';

const error = ref('');
const fileName = ref('');
const parsed = ref<ParsedTable | null>(null);
const timeCol = ref(0);
const respCol = ref(1);
const busy = ref(false);

async function onFile(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const file = input.files && input.files[0];
  input.value = ''; // 允许重复选择同一文件（重新导入）
  if (!file) return;
  error.value = '';
  busy.value = true;
  try {
    const text = await file.text();
    const table = parseCsvText(text);
    parsed.value = table;
    fileName.value = file.name;
    timeCol.value = table.timeCol;
    respCol.value = table.responseCol;
    doImport();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    parsed.value = null;
  } finally {
    busy.value = false;
  }
}

function doImport(): void {
  const table = parsed.value;
  if (!table) return;
  try {
    const { time, response, skippedRows } = buildCurve(table, timeCol.value, respCol.value);
    void importCurve({
      id: crypto.randomUUID(),
      name: fileName.value || '未命名 CSV',
      time,
      response,
      source: 'csv',
      importedAt: Date.now(),
    });
    error.value = skippedRows > 0 ? `已跳过 ${skippedRows} 个无效/重复数据行` : '';
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function loadSample(): void {
  const { curve } = makeSampleCurve();
  void importCurve(curve, {
    interval: [curve.time[0], curve.time[curve.time.length - 1]],
  });
}
</script>

<template>
  <section class="panel">
    <h2>数据导入</h2>
    <label class="btnbar">
      <input type="file" accept=".csv,.txt,.tsv" style="display: none" @change="onFile" />
      <span class="button-like primary">{{ busy ? '解析中…' : '导入 CSV 文件' }}</span>
      <button type="button" @click="loadSample">载入示例曲线</button>
    </label>
    <p class="muted">
      支持逗号/分号/制表符/空白分隔，自动识别表头与时间、响应列。原始数据保存在本机
      IndexedDB，不会上传。
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="parsed && parsed.columns.length > 2">
      <div class="row">
        <label class="field">
          <span>时间列</span>
          <select v-model.number="timeCol">
            <option v-for="(n, i) in parsed.columnNames" :key="i" :value="i">{{ n }}</option>
          </select>
        </label>
        <label class="field">
          <span>响应列</span>
          <select v-model.number="respCol">
            <option v-for="(n, i) in parsed.columnNames" :key="i" :value="i">{{ n }}</option>
          </select>
        </label>
      </div>
      <button type="button" @click="doImport">按所选列重新导入</button>
    </template>

    <template v-if="state.savedCurves.length">
      <h3 class="sub">已保存曲线（IndexedDB）</h3>
      <ul class="list">
        <li v-for="c in state.savedCurves" :key="c.id">
          <div class="list-main">
            <span class="list-title" :title="c.name">{{ c.name }}</span>
            <span class="muted">{{ c.time.length }} 点 · {{ fmtTime(c.importedAt) }}</span>
          </div>
          <div class="list-actions">
            <button type="button" @click="loadSavedCurve(c.id)">载入</button>
            <button type="button" @click="deleteSavedCurve(c.id)">删除</button>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped>
.sub {
  font-size: 12px;
  color: var(--muted);
  margin: 12px 0 6px;
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 180px;
  overflow: auto;
}
.list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
  border-bottom: 1px solid #edf0f3;
}
.list-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.list-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.list-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.list-actions button {
  padding: 2px 8px;
  font-size: 12px;
}
</style>
