/**
 * The showcase's frame meter (R5): the frames drawn each second for the counter in the
 * corner, and every frame's interval, by the act it fell in, handed on every few seconds
 * to whoever runs the showcase (`tools/showcase.py`, which prints them on Ctrl+C).
 */

/** Seconds between two readings of the counter. */
const COUNT_EVERY_S = 1;
/** Seconds between two reports of the frames drawn. */
const REPORT_EVERY_S = 5;

/** What the meter hands on: the intervals between frames, in ms, by act. */
export interface FrameReport {
  tool: "lineage-showcase";
  /** Seconds since the showcase began, at this report. */
  t: number;
  loop: number;
  /** The frames of this report: [act index, interval ms], in the order drawn. */
  frames: [number, number][];
  /** The page's memory, if the browser says (MB). */
  heap_mb: number | null;
}

export class FrameMeter {
  private last: number | null = null;
  private countFrom: number | null = null;
  private counted = 0;
  private reportFrom: number | null = null;
  private frames: [number, number][] = [];

  /**
   * `count` is told the frames drawn in the last second; `report` takes what is handed on.
   */
  constructor(
    private readonly count: (fps: number) => void,
    private readonly report: ((report: FrameReport) => void) | null,
  ) {}

  /** A frame drawn at `nowMs` (the page's clock), in act `act` of loop `loop`, `timeS` in. */
  frame(nowMs: number, act: number, loop: number, timeS: number): void {
    if (this.last !== null) this.frames.push([act, Math.round((nowMs - this.last) * 10) / 10]);
    this.last = nowMs;
    this.reportFrom ??= nowMs;
    // Frames after the first: so many in the time since it.
    if (this.countFrom === null) this.countFrom = nowMs;
    else this.counted += 1;
    if (nowMs - this.countFrom >= COUNT_EVERY_S * 1000) {
      this.count((1000 * this.counted) / (nowMs - this.countFrom));
      this.countFrom = nowMs;
      this.counted = 0;
    }
    if (this.report !== null && nowMs - this.reportFrom >= REPORT_EVERY_S * 1000) {
      const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      this.report({
        tool: "lineage-showcase",
        t: Math.round(timeS * 10) / 10,
        loop,
        frames: this.frames,
        heap_mb: memory === undefined ? null : Math.round(memory.usedJSHeapSize / 1e5) / 10,
      });
      this.frames = [];
      this.reportFrom = nowMs;
    }
  }
}
