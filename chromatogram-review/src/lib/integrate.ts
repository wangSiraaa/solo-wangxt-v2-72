import type { PeakIntegration } from '../types';

/** 第一个满足 t[i] >= x 的下标。 */
function lowerBound(t: number[], x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 第一个满足 t[i] > x 的下标。 */
function upperBound(t: number[], x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 在升序时间轴上对 x 做线性插值，界外取端点值。 */
export function interpolate(t: number[], y: number[], x: number): number {
  const n = t.length;
  if (n === 0) return NaN;
  if (x <= t[0]) return y[0];
  if (x >= t[n - 1]) return y[n - 1];
  const i = lowerBound(t, x);
  // t[i-1] < x <= t[i]
  const t0 = t[i - 1];
  const t1 = t[i];
  const w = t1 === t0 ? 0 : (x - t0) / (t1 - t0);
  return y[i - 1] + w * (y[i] - y[i - 1]);
}

/**
 * 梯形法计算 y 在 [t0, t1] 上的面积。
 * 区间端点落在采样点之间时按线性插值补点，t 必须升序。
 */
export function trapezoidArea(t: number[], y: number[], t0: number, t1: number): number {
  const n = t.length;
  if (n < 2 || t1 <= t0) return 0;
  const a = Math.max(t0, t[0]);
  const b = Math.min(t1, t[n - 1]);
  if (b <= a) return 0;
  let area = 0;
  let prevT = a;
  let prevY = interpolate(t, y, a);
  const iEnd = lowerBound(t, b); // 遍历所有 < b 的采样点
  for (let i = lowerBound(t, a); i < iEnd; i++) {
    area += 0.5 * (prevY + y[i]) * (t[i] - prevT);
    prevT = t[i];
    prevY = y[i];
  }
  const yb = interpolate(t, y, b);
  area += 0.5 * (prevY + yb) * (b - prevT);
  return area;
}

/** 区间内采样点个数（含端点）。 */
export function countPoints(t: number[], t0: number, t1: number): number {
  return Math.max(0, upperBound(t, t1) - lowerBound(t, t0));
}

/**
 * 峰面积复核：信号毛面积、直线基线面积、净面积，
 * 以及相对“默认基线（端点连线、零偏移）”的调整前后差异。
 */
export function integratePeak(
  time: number[],
  response: number[],
  startTime: number,
  endTime: number,
  startOffset = 0,
  endOffset = 0,
): PeakIntegration {
  const sigStart = interpolate(time, response, startTime);
  const sigEnd = interpolate(time, response, endTime);
  const b0 = sigStart + startOffset;
  const b1 = sigEnd + endOffset;
  const width = endTime - startTime;
  const grossArea = trapezoidArea(time, response, startTime, endTime);
  const baselineArea = 0.5 * (b0 + b1) * width;
  const defaultBaselineArea = 0.5 * (sigStart + sigEnd) * width;
  const netArea = grossArea - baselineArea;
  const defaultNetArea = grossArea - defaultBaselineArea;
  const slope = width > 0 ? (b1 - b0) / width : 0;
  return {
    grossArea,
    baselineArea,
    netArea,
    defaultBaselineArea,
    defaultNetArea,
    deltaVsDefault: netArea - defaultNetArea,
    baselineStartY: b0,
    baselineEndY: b1,
    slope,
    intercept: b0 - slope * startTime,
    pointCount: countPoints(time, startTime, endTime),
  };
}
