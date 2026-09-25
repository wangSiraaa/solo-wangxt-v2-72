import type { CurveData } from '../types';

/** 高斯峰形。 */
export function gaussian(t: number, amplitude: number, mu: number, sigma: number): number {
  return amplitude * Math.exp(-((t - mu) ** 2) / (2 * sigma * sigma));
}

/** 高斯峰解析面积 A·σ·√(2π)。 */
export function gaussianArea(amplitude: number, sigma: number): number {
  return amplitude * sigma * Math.sqrt(2 * Math.PI);
}

/** erf，Abramowitz-Stegun 7.1.26，绝对误差 < 1.5e-7（核对截断区间用）。 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** 高斯峰落在 [a, b] 内的面积比例。 */
export function fractionWithin(a: number, b: number, mu: number, sigma: number): number {
  return (
    0.5 * (erf((b - mu) / (sigma * Math.SQRT2)) - erf((a - mu) / (sigma * Math.SQRT2)))
  );
}

/** 确定性伪随机数（可重复生成同一条示例曲线）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PeakSpec {
  amplitude: number;
  mu: number;
  sigma: number;
}

/** 可见样例：三个高斯峰 + 漂移弯曲基线 + 小幅确定性噪声。 */
export const SAMPLE_BASELINE = (t: number): number => 30 + 0.08 * t + 2 * Math.sin(t / 9);

export const SAMPLE_PEAKS: PeakSpec[] = [
  { amplitude: 800, mu: 25, sigma: 1.8 },
  { amplitude: 1200, mu: 47, sigma: 2.6 },
  { amplitude: 500, mu: 72, sigma: 1.4 },
];

export const SAMPLE_NOISE_AMPLITUDE = 0.6; // 峰-峰约 0.6

export function makeSampleCurve(): { curve: CurveData; peaks: PeakSpec[] } {
  const dt = 0.1;
  const n = 1001;
  const time = new Array<number>(n);
  const response = new Array<number>(n);
  const rng = mulberry32(20260925);
  for (let i = 0; i < n; i++) {
    const t = i * dt;
    let y = SAMPLE_BASELINE(t);
    for (const p of SAMPLE_PEAKS) y += gaussian(t, p.amplitude, p.mu, p.sigma);
    y += (rng() - 0.5) * SAMPLE_NOISE_AMPLITUDE;
    time[i] = t;
    response[i] = y;
  }
  return {
    curve: {
      id: 'sample-visible',
      name: '示例曲线：三峰 + 漂移基线（含噪声）',
      time,
      response,
      source: 'sample',
      importedAt: Date.now(),
    },
    peaks: SAMPLE_PEAKS,
  };
}

export interface VerificationCase {
  id: string;
  title: string;
  description: string;
  curve: CurveData;
  interval: [number, number];
  /** 已知面积（解析公式 × 区间截断比例；样例为无噪峰分量之和）。 */
  knownArea: number;
  /** 核对用参考基线；() => 0 表示零基线。 */
  referenceBaseline: (t: number) => number;
}

/** 构造纯高斯 / 高斯+线性基线两条合成曲线。 */
function makeGaussianCase(
  id: string,
  title: string,
  description: string,
  amplitude: number,
  mu: number,
  sigma: number,
  baseline: (t: number) => number,
): VerificationCase {
  const interval: [number, number] = [mu - 6 * sigma, mu + 6 * sigma];
  const dt = sigma / 100;
  const start = mu - 8 * sigma;
  const end = mu + 8 * sigma;
  const n = Math.round((end - start) / dt) + 1;
  const time = new Array<number>(n);
  const response = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const t = start + i * dt;
    time[i] = t;
    response[i] = gaussian(t, amplitude, mu, sigma) + baseline(t);
  }
  return {
    id,
    title,
    description,
    curve: {
      id,
      name: title,
      time,
      response,
      source: 'synthetic',
      importedAt: Date.now(),
    },
    interval,
    knownArea: gaussianArea(amplitude, sigma) * fractionWithin(interval[0], interval[1], mu, sigma),
    referenceBaseline: baseline,
  };
}

/**
 * 面积核对用例（全部曲线都可“载入查看”）：
 * A 纯高斯峰；B 高斯峰叠加线性漂移基线；C 可见三峰样例。
 */
export function buildVerificationCases(): VerificationCase[] {
  const cases: VerificationCase[] = [
    makeGaussianCase(
      'verify-a',
      '核对 A：纯高斯峰（已知面积）',
      'A=1000, μ=50, σ=2，区间 μ±6σ，采样步长 σ/100，零基线。',
      1000,
      50,
      2,
      () => 0,
    ),
    makeGaussianCase(
      'verify-b',
      '核对 B：高斯峰 + 线性基线（已知面积）',
      '同一高斯峰叠加基线 y=25+0.3t，检验直线基线扣除。',
      1000,
      50,
      2,
      (t) => 25 + 0.3 * t,
    ),
  ];

  const { curve, peaks } = makeSampleCurve();
  const a = curve.time[0];
  const b = curve.time[curve.time.length - 1];
  let known = 0;
  for (const p of peaks) {
    known += gaussianArea(p.amplitude, p.sigma) * fractionWithin(a, b, p.mu, p.sigma);
  }
  cases.push({
    id: 'verify-c',
    title: '核对 C：可见三峰样例（漂移基线 + 噪声）',
    description:
      '三个高斯峰解析面积之和为已知值，叠加漂移基线与确定性小幅噪声，可载入主视图查看曲线并手工复核。',
    curve,
    interval: [a, b],
    knownArea: known,
    referenceBaseline: SAMPLE_BASELINE,
  });

  return cases;
}
