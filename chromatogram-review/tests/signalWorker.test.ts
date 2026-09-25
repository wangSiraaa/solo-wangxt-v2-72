import { describe, expect, it } from 'vitest';
import savitzkyGolay from 'ml-savitzky-golay';
import { Matrix, solve } from 'ml-matrix';

/**
 * 不依赖 DOM/Worker，直接验证 signalWorker 中使用的算法与参数：
 * Savitzky-Golay 对阶次 ≤ polynomial 的多项式应保持不变。
 */
describe('Worker 平滑参数（ml-savitzky-golay）', () => {
  it('pad=pre 输出等长', () => {
    const y = Array.from({ length: 101 }, (_, i) => i * i);
    const out = savitzkyGolay(y, 1, {
      windowSize: 11,
      polynomial: 3,
      derivative: 0,
      pad: 'pre',
      padValue: 'replicate',
    });
    expect(out.length).toBe(y.length);
  });

  it('三次多项式经平滑后内部保持不变', () => {
    const h = 0.5;
    const t = Array.from({ length: 201 }, (_, i) => (i - 100) * h);
    const y = t.map((x) => 2 * x * x * x - 3 * x * x + 5 * x - 7);
    const out = savitzkyGolay(y, h, {
      windowSize: 11,
      polynomial: 3,
      derivative: 0,
      pad: 'pre',
      padValue: 'replicate',
    });
    // 边界外（pad 段）不保证，内部窗口应几乎完全恢复
    for (let i = 10; i < y.length - 10; i++) {
      expect(Math.abs(out[i] - y[i])).toBeLessThan(1e-8 * Math.max(1, Math.abs(y[i])));
    }
  });

  it('对含噪信号的平滑误差小于原始噪声', () => {
    const n = 301;
    const t = Array.from({ length: n }, (_, i) => i * 0.1);
    const truth = t.map((x) => Math.sin(x));
    const y = t.map((x, i) => Math.sin(x) + ((((i * 37) % 13) - 6) / 60));
    const out = savitzkyGolay(y, 0.1, {
      windowSize: 9,
      polynomial: 3,
      derivative: 0,
      pad: 'pre',
      padValue: 'replicate',
    });
    const errRaw = y.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0);
    const errSmooth = out.reduce((s, v, i) => s + (v - truth[i]) ** 2, 0);
    expect(errSmooth).toBeLessThan(errRaw);
  });
});

describe('Worker 基线拟合（ml-matrix 最小二乘）', () => {
  it('线性数据精确恢复斜率与截距（中心化模型）', () => {
    const x = Array.from({ length: 21 }, (_, i) => i - 10);
    const y = x.map((v) => 1.5 * v + 4); // 中心化后截距即 4（中心为 0）
    const A = Matrix.from1DArray(
      x.length,
      2,
      x.flatMap((v) => [1, v]),
    );
    const At = A.transpose();
    const coef = solve(At.mmul(A), At.mmul(Matrix.columnVector(y))).getColumn(0);
    expect(coef[0]).toBeCloseTo(4, 10);
    expect(coef[1]).toBeCloseTo(1.5, 10);
  });
});
