import { describe, expect, it } from 'vitest';
import {
  buildVerificationCases,
  fractionWithin,
  gaussian,
  gaussianArea,
  makeSampleCurve,
  mulberry32,
} from '../src/lib/synthetic';
import { integratePeak, trapezoidArea } from '../src/lib/integrate';

describe('解析公式自检', () => {
  it('fractionWithin 在 ±6σ 内约 1，在半区间约 0.5', () => {
    // erf 为近似式（|ε|<1.5e-7），断言精度 accordingly
    expect(fractionWithin(50 - 6 * 2, 50 + 6 * 2, 50, 2)).toBeCloseTo(1, 5);
    expect(fractionWithin(-Infinity, 50, 50, 2)).toBeCloseTo(0.5, 5);
  });

  it('已知面积用例数值合理（A=1000, σ=2 → 5013.2565）', () => {
    expect(gaussianArea(1000, 2)).toBeCloseTo(5013.2565493, 4);
  });

  it('随机数生成器确定性可重复', () => {
    const a = mulberry32(42);
    const seq1 = [a(), a(), a()];
    const b = mulberry32(42);
    expect([b(), b(), b()]).toEqual(seq1);
  });
});

describe('合成峰面积核对（与应用内核对面板相同的计算）', () => {
  for (const kase of buildVerificationCases()) {
    it(`${kase.id}: 梯形积分与已知解析面积一致`, () => {
      const { time, response } = kase.curve;
      const [t0, t1] = kase.interval;
      const base = time.map(kase.referenceBaseline);
      const net =
        trapezoidArea(time, response, t0, t1) - trapezoidArea(time, base, t0, t1);
      const rel = (net - kase.knownArea) / kase.knownArea;
      // 用例 A/B：无噪、密采样、零/线性基线，梯形离散误差应极小
      if (kase.id === 'verify-a' || kase.id === 'verify-b') {
        expect(Math.abs(rel)).toBeLessThan(1e-6);
      } else {
        // 用例 C：含小幅噪声，只做数量级合理性检查，不设“通过”阈值结论
        expect(Math.abs(rel)).toBeLessThan(0.02);
      }
    });
  }

  it('A：零偏移端点连线净面积 ≈ 已知面积（残差为端点尾部锚定）', () => {
    const kase = buildVerificationCases()[0];
    const r = integratePeak(kase.curve.time, kase.curve.response, ...kase.interval, 0, 0);
    expect(Math.abs((r.netArea - kase.knownArea) / kase.knownArea)).toBeLessThan(1e-6);
  });

  it('B：端点连线精确扣除线性基线（梯形对线性函数精确）', () => {
    const kase = buildVerificationCases()[1];
    const r = integratePeak(kase.curve.time, kase.curve.response, ...kase.interval, 0, 0);
    expect(Math.abs((r.netArea - kase.knownArea) / kase.knownArea)).toBeLessThan(1e-6);
  });
});

describe('可见样例曲线', () => {
  const { curve, peaks } = makeSampleCurve();
  it('采样数与时间范围', () => {
    expect(curve.time.length).toBe(1001);
    expect(curve.time[0]).toBe(0);
    expect(curve.time[curve.time.length - 1]).toBe(100);
  });

  it('峰位处响应明显高于基线（曲线确实“可见”）', () => {
    for (const p of peaks) {
      const idx = Math.round(p.mu * 10);
      const baselineLevel = 30 + 0.08 * p.mu + 2 * Math.sin(p.mu / 9);
      expect(curve.response[idx]).toBeGreaterThan(baselineLevel + p.amplitude * 0.9);
    }
  });

  it('单峰密采样梯形积分逼近解析面积（端点连线基线场景）', () => {
    // 独立构造无基线单峰，直接核对 trapezoid + 端点连线
    const dt = 0.002;
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i <= 10000; i++) {
      const x = i * dt;
      t.push(x);
      y.push(gaussian(x, 400, 10, 0.5));
    }
    const known = gaussianArea(400, 0.5);
    const r = integratePeak(t, y, 10 - 6 * 0.5, 10 + 6 * 0.5, 0, 0);
    expect(Math.abs((r.netArea - known) / known)).toBeLessThan(1e-7);
  });
});
