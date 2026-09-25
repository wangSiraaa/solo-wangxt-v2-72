/**
 * 极简 CSV/TSV 解析：支持逗号、分号、制表符与空白分隔，
 * 自动识别表头与时间/响应列。
 */

export interface ParsedTable {
  headers: string[] | null;
  /** 各列显示名（有表头用表头，否则用“第 N 列”）。 */
  columnNames: string[];
  /** 仅包含“全部数据行均为数值”的列。 */
  columns: number[][];
  /** columns 中作为时间列的索引。 */
  timeCol: number;
  /** columns 中作为响应列的索引。 */
  responseCol: number;
  rowCount: number;
}

function detectDelimiter(line: string): string | RegExp {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const d of candidates) {
    const c = line.split(d).length - 1;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  if (bestCount === 0 && /\s/.test(line)) return /\s+/;
  return best;
}

function splitLine(line: string, delimiter: string | RegExp): string[] {
  if (delimiter instanceof RegExp) return line.trim().split(delimiter);
  return line.split(delimiter).map((cell) => {
    const s = cell.trim().replace(/^["']|["']$/g, '');
    return s;
  });
}

function toNumber(s: string): number {
  if (s === '' || s == null) return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

const TIME_HEADER = /^(time|retention(\s*time)?|t|min|minutes?|时间|保留时间|洗脱时间)/i;
const RESP_HEADER = /(response|signal|intensity|absorbance|abundance|area|height|mau|mv|uv|响应|信号|强度|峰高|吸光)/i;

export function parseCsvText(text: string): ParsedTable {
  const cleaned = text.replace(/^\uFEFF/, '');
  const lines = cleaned
    .split(/\r\n|\r|\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error('文件至少需要表头/数据共两行非空内容');
  }

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((l) => splitLine(l, delimiter));
  const width = Math.max(...rows.map((r) => r.length));

  const firstNumeric = rows[0].map((c) => toNumber(c));
  const hasHeader = firstNumeric.some((v) => Number.isNaN(v));
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const headers = hasHeader ? rows[0] : null;

  // 数值列：该列每个数据行都能解析为数值。
  const numericColFlags = new Array<boolean>(width).fill(true);
  for (const row of dataRows) {
    for (let j = 0; j < width; j++) {
      if (Number.isNaN(toNumber(row[j] ?? ''))) numericColFlags[j] = false;
    }
  }
  const numericIndex: number[] = [];
  for (let j = 0; j < width; j++) if (numericColFlags[j]) numericIndex.push(j);

  if (numericIndex.length < 2) {
    throw new Error(`至少需要两列数值数据（找到 ${numericIndex.length} 列）`);
  }

  const columns = numericIndex.map((src) =>
    dataRows.map((row) => toNumber(row[src] ?? '')),
  );

  let timeCol = 0;
  let responseCol = Math.min(1, numericIndex.length - 1);
  if (headers) {
    const ti = numericIndex.findIndex((src) => TIME_HEADER.test(headers[src]?.trim() ?? ''));
    const ri = numericIndex.findIndex((src) => RESP_HEADER.test(headers[src]?.trim() ?? ''));
    if (ti >= 0) timeCol = ti;
    if (ri >= 0) responseCol = ri;
    if (ri === ti && ri >= 0) responseCol = ti === 0 ? 1 : 0;
  }

  return {
    headers,
    columnNames: numericIndex.map((src) =>
      headers && headers[src] ? headers[src].trim() : `第 ${src + 1} 列`,
    ),
    columns,
    timeCol,
    responseCol,
    rowCount: dataRows.length,
  };
}

/** 由选定的两列构造曲线：排序、去重、校验。 */
export function buildCurve(
  table: ParsedTable,
  timeCol: number,
  responseCol: number,
): { time: number[]; response: number[]; skippedRows: number } {
  if (timeCol === responseCol) throw new Error('时间列与响应列不能相同');
  const tSrc = table.columns[timeCol];
  const ySrc = table.columns[responseCol];
  if (!tSrc || !ySrc) throw new Error('列选择无效');

  let skippedRows = 0;
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < tSrc.length; i++) {
    if (Number.isFinite(tSrc[i]) && Number.isFinite(ySrc[i])) {
      pairs.push([tSrc[i], ySrc[i]]);
    } else {
      skippedRows++;
    }
  }
  if (pairs.length < 3) throw new Error(`有效数据点不足（${pairs.length} 个，至少需要 3 个）`);

  pairs.sort((a, b) => a[0] - b[0]);
  const time: number[] = [];
  const response: number[] = [];
  for (const [t, y] of pairs) {
    if (time.length > 0 && t === time[time.length - 1]) {
      skippedRows++;
      continue; // 相同时间点保留第一个
    }
    time.push(t);
    response.push(y);
  }
  if (time.length < 3) throw new Error('排序去重后数据点不足');
  if (time[time.length - 1] - time[0] <= 0) throw new Error('时间跨度必须为正');
  return { time, response, skippedRows };
}
