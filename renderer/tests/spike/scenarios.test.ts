import { describe, expect, it } from "vitest";
import { judge, type Results, type ScenarioResult } from "../../src/spike/bench";
import { DEFAULTS, parseParams } from "../../src/spike/params";
import {
  ACCEPTANCE_SCENARIOS,
  CROWD_CREATURES,
  SCENARIOS,
  SPEC_CREATURES,
  TARGET_FPS,
  selectScenarios,
} from "../../src/spike/scenarios";

describe("scenarios", () => {
  it("have unique names and whole-pixel art scales", () => {
    const names = SCENARIOS.map((scenario) => scenario.name);
    expect(new Set(names).size).toBe(names.length);
    for (const scenario of SCENARIOS) {
      expect([1, 2, 4]).toContain(scenario.artScale);
      expect(1024 % scenario.artScale).toBe(0);
      expect(600 % scenario.artScale).toBe(0);
      expect(scenario.about.length).toBeGreaterThan(10);
    }
  });

  it("include the R0 scene as first written, measured but not judged", () => {
    const acceptance = SCENARIOS.find((scenario) => scenario.name === "spec-1x");
    // R0: 50 creatures, a terrain bitmap, plant sprites and a full-screen tint at 1024×600.
    expect(acceptance).toMatchObject({
      artScale: 1,
      shot: "wide",
      plants: "sprites",
      creatures: SPEC_CREATURES,
      tint: true,
    });
    expect(SPEC_CREATURES).toBe(50);
    expect(TARGET_FPS).toBe(30);
    expect(ACCEPTANCE_SCENARIOS).not.toContain("spec-1x");
  });

  it("judge R0 on the three views, the middle one also crowded (ADR 0010)", () => {
    expect(ACCEPTANCE_SCENARIOS).toEqual(["map-view", "mid-view", "mid-crowd", "local-view"]);
    const judged = SCENARIOS.filter((scenario) => ACCEPTANCE_SCENARIOS.includes(scenario.name));
    expect(judged).toHaveLength(ACCEPTANCE_SCENARIOS.length);
    for (const scenario of judged) expect(scenario.plants).toBe("painted");
  });

  it("tell what the R0 scene costs with nothing moving, and with the plants apart", () => {
    const acceptance = SCENARIOS.find((scenario) => scenario.name === "spec-1x");
    const still = SCENARIOS.find((scenario) => scenario.name === "spec-still");
    const apart = SCENARIOS.find((scenario) => scenario.name === "spec-apart");
    expect(acceptance?.plantsApart).toBeUndefined();
    // Each differs from spec-1x in one thing only.
    expect(still).toEqual({ ...acceptance, name: "spec-still", creatures: 0, about: still?.about });
    expect(apart).toEqual({
      ...acceptance,
      name: "spec-apart",
      plantsApart: true,
      about: apart?.about,
    });
  });

  it("cover every art scale, both shots and a full population", () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.artScale))).toEqual(new Set([1, 2, 4]));
    expect(new Set(SCENARIOS.map((scenario) => scenario.shot))).toEqual(
      new Set(["wide", "close", "follow"]),
    );
    expect(Math.max(...SCENARIOS.map((scenario) => scenario.creatures))).toBe(CROWD_CREATURES);
    expect(SCENARIOS[0]?.name).toBe("floor");
  });

  it("measure the three views of the look chosen since", () => {
    const view = (name: string): (typeof SCENARIOS)[number] | undefined =>
      SCENARIOS.find((scenario) => scenario.name === name);
    // Art pixels of 2: the whole island, a region, and one creature from close by.
    expect(view("map-view")).toMatchObject({ artScale: 2, shot: "wide", plants: "painted" });
    expect(view("mid-view")).toMatchObject({
      artScale: 2,
      shot: "close",
      plants: "painted",
      creatures: SPEC_CREATURES,
    });
    expect(view("mid-crowd")?.creatures).toBe(CROWD_CREATURES);
    expect(view("local-view")).toMatchObject({ artScale: 2, shot: "follow", plants: "painted" });
  });

  it("can be selected by name, in table order", () => {
    expect(selectScenarios(null)).toHaveLength(SCENARIOS.length);
    expect(selectScenarios(["spec-2x", "floor"]).map((scenario) => scenario.name)).toEqual([
      "floor",
      "spec-2x",
    ]);
    expect(() => selectScenarios(["nope"])).toThrow("unknown scenario: nope");
  });
});

describe("parseParams", () => {
  it("has defaults", () => {
    expect(parseParams("")).toEqual(DEFAULTS);
  });

  it("reads and clamps the query", () => {
    const params = parseParams(
      "?seconds=3.5&warmup=0&only=floor,%20spec-1x&post=/results&backend=canvas&hud=0&label=gpu",
    );
    expect(params).toMatchObject({
      measureS: 3.5,
      warmupS: 0,
      only: ["floor", "spec-1x"],
      postUrl: "/results",
      backend: "canvas",
      hud: false,
      label: "gpu",
    });
    expect(parseParams("?seconds=9999").measureS).toBe(120);
    expect(parseParams("?seconds=abc").measureS).toBe(DEFAULTS.measureS);
    expect(parseParams("?only=").only).toBeNull();
    expect(parseParams("?demo=close-2x").demo).toBe("close-2x");
    expect(parseParams("?backend=webgpu").backend).toBe("webgl");
  });
});

describe("judge", () => {
  /** Results in which `rates` gives the median frame rate of the scenarios that ran. */
  const results = (rates: Record<string, number>): Results => ({
    tool: "lineage-renderer-spike",
    version: 1,
    build_commit: "test",
    label: "",
    started_at: "",
    user_agent: "",
    hardware_concurrency: 1,
    device_memory_gb: 0,
    screen: { width: 1024, height: 600, device_pixel_ratio: 1 },
    viewport: { width: 1024, height: 600 },
    gpu: null,
    world: { cells: [256, 150], plant_cells: 0, description: "" },
    settings: { warmup_s: 0, measure_s: 1, backend: "webgl", seed: 1 },
    scenarios: Object.entries(rates).map(
      ([name, fps]) => ({ name, frames: 100, fps_median: fps }) as ScenarioResult,
    ),
    acceptance: {
      scenarios: [...ACCEPTANCE_SCENARIOS],
      target_fps: TARGET_FPS,
      fps_median: null,
      pass: null,
    },
    error: null,
  });
  const views = (fps: number): Record<string, number> =>
    Object.fromEntries(ACCEPTANCE_SCENARIOS.map((name) => [name, fps]));

  it("passes when every view reaches the target and fails on the slowest", () => {
    const fast = results({ ...views(60), "mid-crowd": 30 });
    judge(fast);
    expect(fast.acceptance).toMatchObject({ fps_median: 30, pass: true });
    const slow = results({ ...views(60), "local-view": 29.9 });
    judge(slow);
    expect(slow.acceptance).toMatchObject({ fps_median: 29.9, pass: false });
  });

  it("does not judge spec-1x", () => {
    const hung = results({ ...views(60), "spec-1x": 1.8 });
    judge(hung);
    expect(hung.acceptance).toMatchObject({ fps_median: 60, pass: true });
  });

  it("gives no verdict unless all of them ran", () => {
    const none = results({});
    judge(none);
    expect(none.acceptance).toMatchObject({ fps_median: null, pass: null });
    const some = results({ "mid-view": 60 });
    judge(some);
    expect(some.acceptance).toMatchObject({ fps_median: null, pass: null });
  });
});
