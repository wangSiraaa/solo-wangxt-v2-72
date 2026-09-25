// 核心类型定义

export interface Point {
  t: number
  y: number
}

export interface BaselineMode {
  type: 'zero' | 'linear'
  y0: number // 起点（t = tStart）基线响应
  y1: number // 终点（t = tEnd）基线响应
}

export interface SmoothingOptions {
  enabled: boolean
  windowSize: number
  polynomial: number
}

export interface PeakState {
  tStart: number
  tEnd: number
  baseline: BaselineMode
  smoothing: SmoothingOptions
}

export interface Curve {
  name: string
  points: Point[]
}

export interface StoredCurve {
  id: string
  name: string
  points: Point[]
  state: PeakState
  savedAt: number
}

// 梯形法积分结果（全部基于原始数据）
export interface IntegrationResult {
  iStart: number
  iEnd: number
  tStart: number
  tEnd: number
  yAtStart: number
  yAtEnd: number
  bAtStart: number
  bAtEnd: number
  grossArea: number // 原始曲线相对零轴面积
  baselineArea: number // 基线下方面积
  netArea: number // 净面积 = grossArea - baselineArea（直线基线时）
}

// Web Worker 通信协议
export type WorkerRequest =
  | {
      id: number
      kind: 'smooth'
      y: number[]
      h: number
      windowSize: number
      polynomial: number
    }
  | {
      id: number
      kind: 'baseline'
      points: Point[]
      edgePoints: number
    }

export type WorkerResponse =
  | { id: number; ok: true; kind: 'smooth'; smoothed: number[] }
  | { id: number; ok: true; kind: 'baseline'; y0: number; y1: number }
  | { id: number; ok: false; error: string }
