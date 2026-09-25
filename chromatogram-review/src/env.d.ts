/// <reference types="vite/client" />

declare module 'ml-savitzky-golay' {
  export interface SavitzkyGolayOptions {
    windowSize?: number;
    derivative?: number;
    polynomial?: number;
    pad?: 'none' | 'pre' | 'post';
    padValue?: 'replicate' | 'circular' | 'symmetric' | number;
  }
  export default function savitzkyGolay(
    data: number[] | Float64Array,
    h: number,
    options?: SavitzkyGolayOptions,
  ): number[];
}
