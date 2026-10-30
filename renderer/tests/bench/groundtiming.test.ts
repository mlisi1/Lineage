import { describe, expect, it } from "vitest";
import { groundTiming, scenarioParams, settingsOf } from "../../src/bench";
import { SCENARIOS, type Plan } from "../../src/benchplan";
import type { PieceTiming } from "../../src/terrain/painter";

const piece = (totalMs: number, compileMs = 0): PieceTiming => ({
  totalMs,
  gpuUploadMs: 1,
  gpuDrawMs: 10,
  gpuUnpackMs: 2,
  compileMs,
  cacheGetMs: 4,
  cachePutMs: 2,
  steps: { colour: 3, shore: 9 },
  queueMs: 5,
  runMs: totalMs + 3,
  pixels: 65_536,
});

describe("the ground's paintings timed in the benchmark (R5, the optimization plan)", () => {
  it("gives the median and the slowest of each part, the CPU's being what is left", () => {
    const timing = groundTiming([piece(40, 300), piece(30), piece(50)]);
    expect(timing?.pieces).toBe(3);
    expect(timing?.median.total).toBe(40);
    expect(timing?.max.total).toBe(50);
    expect(timing?.median.gpu_draw).toBe(10);
    // What is left of the worker's time once its 13 ms on the GPU are taken off (the
    // shader's making is not in the painting's time).
    expect(timing?.median.cpu).toBe(27);
    expect(timing?.compile_ms).toEqual([300]);
  });

  it("is nothing when nothing was painted", () => {
    expect(groundTiming([])).toBeNull();
  });
});

describe("the page's options from the benchmark's address", () => {
  it("passes on who paints the ground, and leaves it out when not asked", () => {
    const scenario = SCENARIOS.find((each) => each.name === "map");
    if (scenario === undefined) throw new Error("no map scenario");
    // The map is not pinned: no place of the plan is read.
    const plan = {} as Plan;
    const asked = settingsOf(new URLSearchParams("bench=1&painter=cpu&cap=30"));
    expect(scenarioParams(scenario, plan, asked).get("painter")).toBe("cpu");
    const plain = settingsOf(new URLSearchParams("bench=1&cap=30"));
    expect(scenarioParams(scenario, plan, plain).has("painter")).toBe(false);
  });
});
