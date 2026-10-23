/** Frame-time statistics for the benchmarks: the R0 spike's and the scene's (`bench.ts`). */

export interface FrameStats {
  frames: number;
  duration_s: number;
  fps_mean: number;
  /** Frames per second at the median frame time: the acceptance number. */
  fps_median: number;
  /** Frames per second over the slowest 1 % of frames. */
  fps_1pct_low: number;
  frame_ms_median: number;
  frame_ms_p99: number;
  frame_ms_max: number;
}

/** Percentile (0–100) of ascending-sorted values, linearly interpolated. */
export function percentile(sortedAscending: readonly number[], p: number): number {
  const count = sortedAscending.length;
  if (count === 0) return 0;
  const position = (Math.min(Math.max(p, 0), 100) / 100) * (count - 1);
  const low = Math.floor(position);
  const high = Math.min(low + 1, count - 1);
  const a = sortedAscending[low] ?? 0;
  const b = sortedAscending[high] ?? a;
  return a + (b - a) * (position - low);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

function fps(frameMs: number): number {
  return frameMs > 0 ? 1000 / frameMs : 0;
}

/** Summarise the time between consecutive frames, in milliseconds. */
export function summariseFrames(frameMs: readonly number[]): FrameStats {
  const sorted = [...frameMs].sort((a, b) => a - b);
  const slowest = sorted.slice(sorted.length - Math.max(1, Math.ceil(sorted.length * 0.01)));
  let total = 0;
  for (const value of sorted) total += value;
  const median = percentile(sorted, 50);
  return {
    frames: sorted.length,
    duration_s: total / 1000,
    fps_mean: total > 0 ? (sorted.length * 1000) / total : 0,
    fps_median: fps(median),
    fps_1pct_low: sorted.length > 0 ? fps(mean(slowest)) : 0,
    frame_ms_median: median,
    frame_ms_p99: percentile(sorted, 99),
    frame_ms_max: sorted[sorted.length - 1] ?? 0,
  };
}

/** Median of unsorted values (0 for none). */
export function median(values: readonly number[]): number {
  return percentile(
    [...values].sort((a, b) => a - b),
    50,
  );
}
