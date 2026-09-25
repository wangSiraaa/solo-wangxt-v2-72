import { computed, reactive } from 'vue';
import type { CurveData, PeakIntegration, PeakMethod, SavedMethod } from './types';
import { integratePeak, interpolate } from './lib/integrate';
import { fitBaselineInWorker, smoothInWorker, type BaselineFitResult } from './lib/workerClient';
import * as db from './lib/db';

const LAST_KEY = 'chromatogram-review:last';
const HISTORY_LIMIT = 200;

export function defaultMethod(): PeakMethod {
  return {
    startTime: null,
    endTime: null,
    baseline: { startOffset: 0, endOffset: 0 },
    smoothing: { enabled: false, windowSize: 11, polynomial: 3 },
  };
}

export interface BaselineFitState extends BaselineFitResult {
  degree: number;
}

interface State {
  curve: CurveData | null;
  method: PeakMethod;
  smoothed: number[] | null;
  smoothingBusy: boolean;
  smoothingError: string | null;
  showSmoothed: boolean;
  baselineFit: BaselineFitState | null;
  baselineFitBusy: boolean;
  pickMode: 'start' | 'end' | null;
  past: PeakMethod[];
  future: PeakMethod[];
  savedCurves: CurveData[];
  savedMethods: SavedMethod[];
  status: string;
}

export const state = reactive<State>({
  curve: null,
  method: defaultMethod(),
  smoothed: null,
  smoothingBusy: false,
  smoothingError: null,
  showSmoothed: true,
  baselineFit: null,
  baselineFitBusy: false,
  pickMode: null,
  past: [],
  future: [],
  savedCurves: [],
  savedMethods: [],
  status: '请导入 CSV 或载入示例曲线',
});

const clone = (m: PeakMethod): PeakMethod => JSON.parse(JSON.stringify(m)) as PeakMethod;

export const canUndo = computed(() => state.past.length > 0);
export const canRedo = computed(() => state.future.length > 0);

/** 所有方法编辑都经过 commit，从而获得撤销/重做能力。 */
function commit(mutate: () => void): void {
  state.past.push(clone(state.method));
  if (state.past.length > HISTORY_LIMIT) state.past.shift();
  state.future = [];
  mutate();
  persistLast();
}

export function undo(): void {
  const prev = state.past.pop();
  if (!prev) return;
  state.future.push(clone(state.method));
  state.method = prev;
  afterHistoryJump('已撤销');
}

export function redo(): void {
  const next = state.future.pop();
  if (!next) return;
  state.past.push(clone(state.method));
  state.method = next;
  afterHistoryJump('已重做');
}

function afterHistoryJump(msg: string): void {
  state.baselineFit = null;
  state.status = msg;
  persistLast();
  void refreshSmoothing();
}

// ---------- 曲线导入 ----------

export async function importCurve(
  curve: CurveData,
  opts: { interval?: [number, number] } = {},
): Promise<void> {
  state.curve = curve;
  state.method = defaultMethod();
  if (opts.interval) {
    state.method.startTime = opts.interval[0];
    state.method.endTime = opts.interval[1];
  }
  state.past = [];
  state.future = [];
  state.smoothed = null;
  state.smoothingError = null;
  state.baselineFit = null;
  state.pickMode = null;
  state.status = `已导入「${curve.name}」（${curve.time.length} 点），可重新计算`;
  persistLast();
  await db.putCurve(curve);
  await refreshSavedCurves();
}

// ---------- 峰区间与基线编辑 ----------

function clampToCurve(t: number): number {
  const c = state.curve;
  if (!c) return t;
  return Math.min(Math.max(t, c.time[0]), c.time[c.time.length - 1]);
}

export function setStartTime(t: number): void {
  const v = clampToCurve(t);
  commit(() => {
    const m = state.method;
    m.startTime = v;
    if (m.endTime != null && m.endTime < v) {
      m.startTime = m.endTime;
      m.endTime = v;
    }
  });
}

export function setEndTime(t: number): void {
  const v = clampToCurve(t);
  commit(() => {
    const m = state.method;
    m.endTime = v;
    if (m.startTime != null && m.startTime > v) {
      m.endTime = m.startTime;
      m.startTime = v;
    }
  });
}

export function setFullRange(): void {
  const c = state.curve;
  if (!c) return;
  commit(() => {
    state.method.startTime = c.time[0];
    state.method.endTime = c.time[c.time.length - 1];
  });
}

export function swapBounds(): void {
  commit(() => {
    const m = state.method;
    if (m.startTime != null && m.endTime != null) {
      [m.startTime, m.endTime] = [m.endTime, m.startTime];
    }
  });
}

export function setBaselineOffset(which: 'start' | 'end', value: number): void {
  if (!Number.isFinite(value)) return;
  commit(() => {
    state.method.baseline[which === 'start' ? 'startOffset' : 'endOffset'] = value;
  });
}

export function resetBaselineOffsets(): void {
  commit(() => {
    state.method.baseline.startOffset = 0;
    state.method.baseline.endOffset = 0;
  });
}

/** 图上拾取：起点模式点一下、终点模式再点一下。 */
export function pickTime(t: number): void {
  if (state.pickMode === 'start') {
    setStartTime(t);
    state.pickMode = 'end';
    state.status = '已设置起点，请在图上点击峰终点';
  } else if (state.pickMode === 'end') {
    setEndTime(t);
    state.pickMode = null;
    state.status = '已设置终点';
  }
}

// ---------- 平滑（Worker） ----------

let smoothToken = 0;
let smoothTimer: ReturnType<typeof setTimeout> | null = null;

export async function refreshSmoothing(): Promise<void> {
  const c = state.curve;
  const s = state.method.smoothing;
  if (!c || !s.enabled) {
    state.smoothed = null;
    state.smoothingBusy = false;
    return;
  }
  if (c.response.length < s.windowSize) {
    state.smoothed = null;
    state.smoothingError = `数据点（${c.response.length}）少于平滑窗口（${s.windowSize}）`;
    return;
  }
  const token = ++smoothToken;
  state.smoothingBusy = true;
  state.smoothingError = null;
  try {
    const h = (c.time[c.time.length - 1] - c.time[0]) / (c.time.length - 1);
    const out = await smoothInWorker(c.response, h, s.windowSize, s.polynomial);
    if (token === smoothToken) state.smoothed = out;
  } catch (err) {
    if (token === smoothToken) {
      state.smoothingError = err instanceof Error ? err.message : String(err);
      state.smoothed = null;
    }
  } finally {
    if (token === smoothToken) state.smoothingBusy = false;
  }
}

/** 滑杆连续变化时防抖触发 Worker 重算。 */
export function scheduleSmoothing(): void {
  if (smoothTimer) clearTimeout(smoothTimer);
  smoothTimer = setTimeout(() => {
    smoothTimer = null;
    void refreshSmoothing();
  }, 150);
}

export function setSmoothingEnabled(enabled: boolean): void {
  commit(() => {
    state.method.smoothing.enabled = enabled;
  });
  scheduleSmoothing();
}

export function setSmoothingWindow(windowSize: number): void {
  let w = Math.round(windowSize);
  if (w % 2 === 0) w += 1;
  w = Math.max(5, Math.min(101, w));
  commit(() => {
    const s = state.method.smoothing;
    s.windowSize = w;
    if (s.polynomial >= w) s.polynomial = w - 1;
  });
  scheduleSmoothing();
}

export function setSmoothingPolynomial(polynomial: number): void {
  commit(() => {
    const s = state.method.smoothing;
    s.polynomial = Math.max(1, Math.min(s.windowSize - 1, Math.round(polynomial)));
  });
  scheduleSmoothing();
}

// ---------- 基线拟合建议（Worker） ----------

export async function requestBaselineFit(degree = 1): Promise<void> {
  const c = state.curve;
  if (!c) return;
  const t = c.time;
  const tMin = t[0];
  const tMax = t[t.length - 1];
  const { startTime, endTime } = state.method;
  let ranges: Array<[number, number]>;
  if (startTime != null && endTime != null && endTime > startTime) {
    ranges = [
      [tMin, startTime],
      [endTime, tMax],
    ];
  } else {
    const span = tMax - tMin;
    ranges = [
      [tMin, tMin + span * 0.1],
      [tMax - span * 0.1, tMax],
    ];
  }
  ranges = ranges.filter(([a, b]) => b - a > 0);
  if (ranges.length === 0) {
    state.status = '峰区间覆盖全段，无法选取基线锚点区间';
    return;
  }
  state.baselineFitBusy = true;
  try {
    const fit = await fitBaselineInWorker(t, c.response, ranges, degree);
    state.baselineFit = { ...fit, degree };
    state.status = `已拟合 ${degree} 阶基线（峰外区间），可“采用拟合基线”`;
  } catch (err) {
    state.status = `基线拟合失败：${err instanceof Error ? err.message : String(err)}`;
  } finally {
    state.baselineFitBusy = false;
  }
}

function evalFit(fit: BaselineFitState, x: number): number {
  let p = 1;
  let v = 0;
  const xc = x - fit.center;
  for (const k of fit.coefficients) {
    v += k * p;
    p *= xc;
  }
  return v;
}

/** 把拟合基线换算为端点偏移，套用到当前直线基线上。 */
export function applyBaselineFit(): void {
  const c = state.curve;
  const fit = state.baselineFit;
  if (!c || !fit) return;
  const { startTime, endTime } = state.method;
  if (startTime == null || endTime == null || endTime <= startTime) return;
  const sig0 = interpolate(c.time, c.response, startTime);
  const sig1 = interpolate(c.time, c.response, endTime);
  const off0 = evalFit(fit, startTime) - sig0;
  const off1 = evalFit(fit, endTime) - sig1;
  commit(() => {
    state.method.baseline.startOffset = off0;
    state.method.baseline.endOffset = off1;
  });
  state.status = '已采用拟合基线（转换为端点偏移）';
}

// ---------- 积分结果 ----------

export const integration = computed<PeakIntegration | null>(() => {
  const c = state.curve;
  const { startTime, endTime } = state.method;
  if (!c || startTime == null || endTime == null || endTime <= startTime) return null;
  return integratePeak(
    c.time,
    c.response,
    startTime,
    endTime,
    state.method.baseline.startOffset,
    state.method.baseline.endOffset,
  );
});

/** 同一区间/基线下，平滑辅助曲线的净面积（仅供参考）。 */
export const smoothedIntegration = computed<PeakIntegration | null>(() => {
  const c = state.curve;
  const { startTime, endTime } = state.method;
  if (!c || !state.smoothed || !state.showSmoothed) return null;
  if (startTime == null || endTime == null || endTime <= startTime) return null;
  return integratePeak(
    c.time,
    state.smoothed,
    startTime,
    endTime,
    state.method.baseline.startOffset,
    state.method.baseline.endOffset,
  );
});

// ---------- IndexedDB：曲线与方法 ----------

export async function refreshSavedCurves(): Promise<void> {
  state.savedCurves = await db.listCurves();
}

export async function refreshSavedMethods(): Promise<void> {
  state.savedMethods = await db.listMethods();
}

export async function loadSavedCurve(id: string): Promise<void> {
  const curve = await db.getCurve(id);
  if (curve) await importCurve(curve);
  else state.status = '未找到该曲线（可能已删除）';
}

export async function deleteSavedCurve(id: string): Promise<void> {
  await db.removeCurve(id);
  await refreshSavedCurves();
}

export async function saveMethodAs(name: string): Promise<void> {
  if (!state.curve || !name.trim()) return;
  const saved: SavedMethod = {
    id: crypto.randomUUID(),
    name: name.trim(),
    curveId: state.curve.id,
    savedAt: Date.now(),
    method: clone(state.method),
  };
  await db.putMethod(saved);
  await refreshSavedMethods();
  state.status = `方法「${saved.name}」已保存`;
}

export async function applySavedMethod(id: string): Promise<void> {
  const saved = state.savedMethods.find((m) => m.id === id);
  if (!saved) return;
  if (!state.curve || state.curve.id !== saved.curveId) {
    const curve = await db.getCurve(saved.curveId);
    if (!curve) {
      state.status = '该方法对应的曲线已不存在';
      return;
    }
    await importCurve(curve);
  }
  commit(() => {
    state.method = clone(saved.method);
  });
  state.baselineFit = null;
  void refreshSmoothing();
  state.status = `已应用方法「${saved.name}」`;
}

export async function deleteSavedMethod(id: string): Promise<void> {
  await db.removeMethod(id);
  await refreshSavedMethods();
}

// ---------- 会话恢复 ----------

function persistLast(): void {
  try {
    if (typeof localStorage === 'undefined' || !state.curve) return;
    localStorage.setItem(
      LAST_KEY,
      JSON.stringify({ curveId: state.curve.id, method: state.method }),
    );
  } catch {
    /* 存储不可用时静默忽略 */
  }
}

export async function initStore(): Promise<void> {
  await Promise.all([refreshSavedCurves(), refreshSavedMethods()]);
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return;
    const last = JSON.parse(raw) as { curveId: string; method: PeakMethod };
    const curve = await db.getCurve(last.curveId);
    if (curve) {
      state.curve = curve;
      state.method = { ...defaultMethod(), ...last.method };
      state.status = `已恢复上次会话「${curve.name}」`;
      void refreshSmoothing();
    }
  } catch {
    /* 会话损坏时忽略 */
  }
}
