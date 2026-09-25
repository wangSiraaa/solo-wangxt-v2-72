/** 数值/面积显示工具：统一精度，避免科学计数法噪音。 */

export function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  if (Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-4)) return v.toExponential(4)
  return v.toFixed(digits)
}

export function fmtArea(v: number | null | undefined): string {
  return fmtNum(v, 6)
}

export function fmtPct(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(v * 100).toFixed(digits)}%`
}

export function fmtSigned(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : ''}${fmtNum(v, digits)}`
}
