<script setup lang="ts">
import { ref } from 'vue';
import {
  applySavedMethod,
  deleteSavedMethod,
  saveMethodAs,
  state,
} from '../store';
import { fmtTime } from '../lib/format';

const name = ref('');

function save(): void {
  if (!name.value.trim()) return;
  void saveMethodAs(name.value);
  name.value = '';
}
</script>

<template>
  <section class="panel">
    <h2>方法管理</h2>
    <div class="row">
      <input
        v-model="name"
        type="text"
        placeholder="方法名称"
        :disabled="!state.curve"
        @keyup.enter="save"
      />
      <button type="button" style="flex: 0 0 auto" :disabled="!state.curve || !name.trim()" @click="save">
        保存方法
      </button>
    </div>
    <p class="muted">方法包含峰区间、基线偏移与平滑参数，随曲线一起存于 IndexedDB。</p>

    <ul v-if="state.savedMethods.length" class="list">
      <li v-for="m in state.savedMethods" :key="m.id">
        <div class="list-main">
          <span class="list-title" :title="m.name">{{ m.name }}</span>
          <span class="muted">{{ fmtTime(m.savedAt) }}</span>
        </div>
        <div class="list-actions">
          <button type="button" @click="applySavedMethod(m.id)">应用</button>
          <button type="button" @click="deleteSavedMethod(m.id)">删除</button>
        </div>
      </li>
    </ul>
    <p v-else class="muted">暂无已保存方法。</p>
  </section>
</template>

<style scoped>
.list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  max-height: 160px;
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
