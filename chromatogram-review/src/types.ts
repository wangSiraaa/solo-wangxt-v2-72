/** 一条色谱曲线（原始数据，导入后不可变）。 */
export interface CurveData {
  id: string;
  name: string;
  time: number[];
  response: number[];
  source: 'csv' | 'sample' | 'synthetic';
  importedAt: number;
}

/** Savitzky-Golay 平滑参数（仅用于辅助曲线显示）。 */
export interface SmoothingOptions {
  enabled: boolean;
  windowSize: number; // 奇数，>= 5
  polynomial: number; // < windowSize
}

/** 直线基线：在峰起止点处相对信号值的纵向偏移。 */
export interface BaselineConfig {
  startOffset: number;
  endOffset: number;
}

/** 可编辑、可撤销/重做的“方法”状态。 */
export interface PeakMethod {
  startTime: number | null;
  endTime: number | null;
  baseline: BaselineConfig;
  smoothing: SmoothingOptions;
}

/** 保存到 IndexedDB 的方法。 */
export interface SavedMethod {
  id: string;
  name: string;
  curveId: string;
  savedAt: number;
  method: PeakMethod;
}

/** 梯形法 + 直线基线的积分结果。 */
export interface PeakIntegration {
  /** 信号曲线下面积（毛面积）。 */
  grossArea: number;
  /** 当前基线下方面积。 */
  baselineArea: number;
  /** 净面积 = 毛面积 - 当前基线面积。 */
  netArea: number;
  /** 默认基线（端点连线、零偏移）下方面积。 */
  defaultBaselineArea: number;
  /** 调整前净面积（默认基线）。 */
  defaultNetArea: number;
  /** 调整后 - 调整前。 */
  deltaVsDefault: number;
  baselineStartY: number;
  baselineEndY: number;
  slope: number;
  intercept: number;
  pointCount: number;
}
