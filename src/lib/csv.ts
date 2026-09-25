import type { Point } from '../types'

export interface ParseResult {
  points: Point[]
  warnings: string[]
}

/**
 * 解析两列数值 CSV：第一列时间，第二列响应值。
 * - 自动识别逗号 / 分号 / 制表符 / 空白 分隔
 * - 允许以 #、%、// 开头的注释行，自动跳过单行表头
 * - 时间必须严格递增（若原始数据乱序会报错）
 */
export function parseCSV(text: string): ParseResult {
  const warnings: string[] = []
  const points: Point[] = []
  const lines = text.split(/\r?\n/)
  let skippedHeader = false
  let lineNo = 0

  for (const rawLine of lines) {
    lineNo++
    const line = rawLine.trim()
    if (line === '') continue
    if (line.startsWith('#') || line.startsWith('%') || line.startsWith('//')) continue

    const parts = line.split(/[,;\t]|\s+/).filter((s) => s !== '')
    if (parts.length < 2) {
      throw new Error(`第 ${lineNo} 行无法解析，需要两列数值："${rawLine}"`)
    }
    const t = Number(parts[0].replace(',', '.'))
    const y = Number(parts[1].replace(',', '.'))

    if (!Number.isFinite(t) || !Number.isFinite(y)) {
      if (!skippedHeader) {
        skippedHeader = true
        warnings.push(`已跳过表头行：${line}`)
        continue
      }
      throw new Error(`第 ${lineNo} 行含非数值数据："${rawLine}"`)
    }

    if (points.length > 0 && t <= points[points.length - 1].t) {
      throw new Error(`第 ${lineNo} 行时间 ${t} 未严格递增，请先按时间排序后再导入`)
    }
    points.push({ t, y })
  }

  if (points.length < 2) throw new Error('有效数据点不足 2 个，无法积分')
  return { points, warnings }
}

/** 将曲线序列化为 CSV，便于导出复核（不依赖任何服务端）。 */
export function toCSV(points: Point[]): string {
  return ['time,response', ...points.map((p) => `${p.t},${p.y}`)].join('\n')
}
