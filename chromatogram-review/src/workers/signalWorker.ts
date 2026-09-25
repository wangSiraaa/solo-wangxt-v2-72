/**
 * 信号处理 Worker：
 *  - smooth:   Savitzky-Golay 平滑（ml-savitzky-golay）
 *  - baseline: 在指定区间内做最小二乘多项式拟合（ml-matrix），作为简单基线建议
 */
import savitzkyGolay from 'ml-savitzky-golay';
import { Matrix, solve } from 'ml-matrix';

const ctx: any = self;

interface SmoothMsg {
  type: 'smooth';
  id: number;
  y: number[];
  h: number;
  windowSize: number;
  polynomial: number;
}

interface BaselineMsg {
  type: 'baseline';
  id: number;
  x: number[];
  y: number[];
  ranges: Array<[number, number]>;
  degree: number;
}

type RequestMsg = SmoothMsg | BaselineMsg;

function handleSmooth(msg: SmoothMsg): number[] {
  const out = savitzkyGolay(msg.y, msg.h, {
    windowSize: msg.windowSize,
    polynomial: msg.polynomial,
    derivative: 0,
    pad: 'pre',
    padValue: 'replicate',
  });
  if (out.length !== msg.y.length) {
    throw new Error(`平滑输出长度异常（${out.length} != ${msg.y.length}）`);
  }
  return out;
}

function handleBaseline(msg: BaselineMsg): {
  coefficients: number[];
  center: number;
  values: number[];
} {
  const { x, y, ranges, degree } = msg;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    for (const [a, b] of ranges) {
      if (xi >= a && xi <= b) {
        xs.push(xi);
        ys.push(y[i]);
        break;
      }
    }
  }
  if (xs.length < degree + 1) {
    throw new Error(`基线锚点不足（${xs.length} 个，至少需要 ${degree + 1} 个）`);
  }

  // 中心化后构造范德蒙矩阵，用法方程求解最小二乘。
  const center = xs.reduce((s, v) => s + v, 0) / xs.length;
  const m = xs.length;
  const n = degree + 1;
  const A = new Matrix(m, n);
  for (let i = 0; i < m; i++) {
    let p = 1;
    const xc = xs[i] - center;
    for (let j = 0; j < n; j++) {
      A.set(i, j, p);
      p *= xc;
    }
  }
  const At = A.transpose();
  const coefficients = solve(At.mmul(A), At.mmul(Matrix.columnVector(ys))).getColumn(0);

  const values = new Array<number>(x.length);
  for (let i = 0; i < x.length; i++) {
    let p = 1;
    let v = 0;
    const xc = x[i] - center;
    for (let j = 0; j < n; j++) {
      v += coefficients[j] * p;
      p *= xc;
    }
    values[i] = v;
  }
  return { coefficients, center, values };
}

ctx.onmessage = (ev: MessageEvent<RequestMsg>) => {
  const msg = ev.data;
  try {
    const data = msg.type === 'smooth' ? handleSmooth(msg) : handleBaseline(msg);
    ctx.postMessage({ type: msg.type, id: msg.id, ok: true, data });
  } catch (err) {
    ctx.postMessage({
      type: msg.type,
      id: msg.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
