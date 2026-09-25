/** 数值显示：有效数字为主，避免长串浮点噪声。 */
export function fmt(x: number | null | undefined, sig = 6): string {
  if (x == null || !Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const ax = Math.abs(x);
  if (ax >= 1e7 || ax < 1e-4) return x.toExponential(3);
  return String(parseFloat(x.toPrecision(sig)));
}

/** 相对差百分比：常见量级用定点，极小量级用科学计数。 */
export function fmtPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  const p = x * 100;
  if (p === 0) return '0 %';
  const ap = Math.abs(p);
  if (ap >= 0.1) return `${parseFloat(p.toPrecision(3))} %`;
  return `${p.toExponential(2)} %`;
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}
