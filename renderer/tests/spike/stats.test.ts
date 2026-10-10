import { describe, expect, it } from "vitest";
import { mulberry32 } from "../../src/spike/rng";
import { median, percentile, summariseFrames } from "../../src/spike/stats";

describe("mulberry32", () => {
  it("gives the same numbers for the same seed, in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const values = Array.from({ length: 1000 }, () => a());
    expect(values).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it("differs between seeds", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe("percentile", () => {
  it("interpolates between sorted values", () => {
    expect(percentile([10, 20, 30, 40], 0)).toBe(10);
    expect(percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(percentile([10, 20, 30, 40], 100)).toBe(40);
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 99)).toBe(5);
  });

  it("median sorts first", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBe(0);
  });
});

describe("summariseFrames", () => {
  it("reports a steady 60 fps", () => {
    const stats = summariseFrames(Array.from({ length: 600 }, () => 1000 / 60));
    expect(stats.frames).toBe(600);
    expect(stats.duration_s).toBeCloseTo(10);
    expect(stats.fps_median).toBeCloseTo(60);
    expect(stats.fps_mean).toBeCloseTo(60);
    expect(stats.fps_1pct_low).toBeCloseTo(60);
    expect(stats.frame_ms_max).toBeCloseTo(1000 / 60);
  });

  it("shows hitches in the 1% low but not in the median", () => {
    // 990 smooth frames and 10 that take 100 ms.
    const frames = [
      ...Array.from({ length: 990 }, () => 16),
      ...Array.from({ length: 10 }, () => 100),
    ];
    const stats = summariseFrames(frames);
    expect(stats.fps_median).toBeCloseTo(62.5);
    expect(stats.fps_1pct_low).toBeCloseTo(10);
    expect(stats.frame_ms_p99).toBeGreaterThan(16);
    expect(stats.frame_ms_max).toBe(100);
    expect(stats.fps_mean).toBeLessThan(stats.fps_median);
  });

  it("is all zeros without frames", () => {
    const stats = summariseFrames([]);
    expect(stats.frames).toBe(0);
    expect(stats.fps_median).toBe(0);
    expect(stats.fps_1pct_low).toBe(0);
  });
});
