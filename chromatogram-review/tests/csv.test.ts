import { describe, expect, it } from 'vitest';
import { buildCurve, parseCsvText } from '../src/lib/csv';

describe('parseCsvText', () => {
  it('解析带表头的逗号 CSV 并识别时间/响应列', () => {
    const csv = 'time,response\n0,1\n1,2\n2,5';
    const table = parseCsvText(csv);
    expect(table.rowCount).toBe(3);
    expect(table.columns.length).toBe(2);
    expect(table.timeCol).toBe(0);
    expect(table.responseCol).toBe(1);
    expect(table.headers).toEqual(['time', 'response']);
  });

  it('无表头两列数据', () => {
    const table = parseCsvText('0 10\n1 20\n2 30');
    expect(table.headers).toBeNull();
    expect(table.columns[0]).toEqual([0, 1, 2]);
    expect(table.columns[1]).toEqual([10, 20, 30]);
  });

  it('制表符与中文表头', () => {
    const table = parseCsvText('时间\t响应\n0\t1\n1\t4');
    expect(table.timeCol).toBe(0);
    expect(table.responseCol).toBe(1);
  });

  it('忽略非数值文本列', () => {
    const csv = 'label,time,signal\na,0,1\nb,1,4';
    const table = parseCsvText(csv);
    expect(table.columns.length).toBe(2);
    expect(table.columnNames).toEqual(['time', 'signal']);
  });

  it('BOM 不影响表头识别', () => {
    const table = parseCsvText('﻿time,response\n0,1\n1,2');
    expect(table.timeCol).toBe(0);
  });

  it('少于两列数值时报错', () => {
    expect(() => parseCsvText('x\n1\n2')).toThrow();
  });
});

describe('buildCurve', () => {
  it('按时间排序并去重', () => {
    const table = parseCsvText('time,response\n2,20\n0,0\n1,10\n1,99');
    const { time, response, skippedRows } = buildCurve(table, 0, 1);
    expect(time).toEqual([0, 1, 2]);
    expect(response).toEqual([0, 10, 20]);
    expect(skippedRows).toBe(1);
  });
});
