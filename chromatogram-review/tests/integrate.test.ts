import { describe, expect, it } from 'vitest';
import {
  trapezoidArea,
  integratePeak,
  interpolate,
} from '../src/lib/integrate';

describe('interpolate', () => {
  const t = [0, 1, 2, 3];
  const y = [0, 10, 40, 90];
  it('在已知点取值', () => {
    expect(interpolate(t, y, 1)).toBe(10);
  });
  it('线性插值', () => {
    expect(interpolate(t, y, 1.5)).toBe(25);
  });
  it('界外取端点', () => {
    expect(interpolate(t, y, -5)).toBe(0);
    expect(interpolate(t, y, 5)).toBe(90);
  });
});

describe('trapezoidArea', () => {
  it('线性函数上梯形法精确', () => {
    const t = [0, 1, 2, 3, 4];
    const y = t.map((x) => 2 * x + 3);
    // ∫(2x+3) 0..4 = 28
    expect(trapezoidArea(t, y, 0, 4)).toBeCloseTo(28, 12);
  });

  it('常数函数', () => {
    const t = [0, 0.5, 1, 1.5, 2];
    const y = t.map(() => 7);
    expect(trapezoidArea(t, y, 0, 2)).toBeCloseTo(14, 12);
  });

  it('区间端点落在采样点之间（插值补点）', () => {
    const t = [0, 1, 2, 3, 4];
    const y = t.map((x) => x);
    // 子区间 [0.5, 2.5]：三角形差 = 3.125 - 0.125
    expect(trapezoidArea(t, y, 0.5, 2.5)).toBeCloseTo(3, 12);
  });

  it('非等距采样的线性函数仍精确', () => {
    const t = [0, 0.3, 1.1, 1.2, 4];
    const y = t.map((x) => -1.5 * x + 6);
    expect(trapezoidArea(t, y, 0, 4)).toBeCloseTo(12, 12);
  });

  it('非法区间返回 0', () => {
    const t = [0, 1, 2];
    expect(trapezoidArea(t, [0, 1, 0], 1, 1)).toBe(0);
    expect(trapezoidArea(t, [0, 1, 0], 2, 0)).toBe(0);
  });
});

describe('integratePeak 直线基线', () => {
  const t = [0, 1, 2, 3, 4];
  const y = t.map((x) => 5 * x + 10); // 纯线性信号 = 基线本身

  it('零偏移时净面积为 0（基线就是信号本身）', () => {
    const r = integratePeak(t, y, 0, 4, 0, 0);
    expect(r.netArea).toBeCloseTo(0, 12);
    expect(r.defaultNetArea).toBeCloseTo(0, 12);
    expect(r.deltaVsDefault).toBeCloseTo(0, 12);
    // ∫(5x+10) 0..4 = 80
    expect(r.grossArea).toBeCloseTo(80, 12);
    expect(r.baselineArea).toBeCloseTo(80, 12);
  });

  it('正偏移扣除更多，净面积等比例减小', () => {
    const r = integratePeak(t, y, 0, 4, 1, 3);
    // 基线面积增量 = 平均偏移 2 × 宽 4 = 8
    expect(r.baselineArea).toBeCloseTo(88, 12);
    expect(r.netArea).toBeCloseTo(-8, 12);
    expect(r.deltaVsDefault).toBeCloseTo(-8, 12);
  });

  it('基线斜率与截距', () => {
    const r = integratePeak(t, y, 1, 3, 2, 0);
    // 信号端点 15,25；基线端点 17,25；斜率 (25-17)/2 = 4
    expect(r.slope).toBeCloseTo(4, 12);
    expect(r.baselineStartY).toBeCloseTo(17, 12);
    expect(r.baselineEndY).toBeCloseTo(25, 12);
    // y = 4t + b，过 (1,17) => b = 13
    expect(r.intercept).toBeCloseTo(13, 12);
  });
});
