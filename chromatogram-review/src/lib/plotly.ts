/**
 * Plotly 通过 index.html 中的 <script src="./vendor/plotly.min.js"> 全局加载，
 * 避免打包器解析 4.5MB 的预构建文件（低内存环境下会 OOM）。
 * 升级方式：npm run vendor:plotly（从 node_modules 复制新版本）。
 */
export interface PlotlyStatic {
  react(
    el: HTMLElement,
    traces: unknown[],
    layout: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<unknown>;
  purge(el: HTMLElement): void;
}

export function getPlotly(): PlotlyStatic {
  const p = (window as unknown as { Plotly?: PlotlyStatic }).Plotly;
  if (!p) {
    throw new Error('Plotly 未加载：请确认 public/vendor/plotly.min.js 存在');
  }
  return p;
}
