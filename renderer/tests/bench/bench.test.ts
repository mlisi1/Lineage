import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Ticker } from "pixi.js";
import {
  ACCEPTANCE,
  ATMOSPHERE,
  SCENARIOS,
  coastWeights,
  crowdWeights,
  densest,
  fuelWeights,
  planOf,
  selectScenarios,
} from "../../src/benchplan";
import { capFrames } from "../../src/framecap";
import { summariseFrames } from "../../src/framestats";
import { isMessage } from "../../src/stream";
import type { CreaturesMessage, Message } from "../../src/protocol";
import { LAND_PALETTE } from "../../src/terrain/palette";
import type { Land } from "../../src/terrain/land";
import { world } from "../spike/worlds";

describe("the benchmark's scenarios (benchplan)", () => {
  it("are the nine of ADR 0022: the four judged views, then the atmosphere's five costs", () => {
    expect(SCENARIOS.map((scenario) => scenario.name)).toEqual([
      "map",
      "middle",
      "middle-crowd",
      "local",
      "night",
      "rain",
      "fire",
      "apocalypse",
      "shore",
    ]);
    expect(ACCEPTANCE).toEqual(["map", "middle", "middle-crowd", "local"]);
    expect([...ACCEPTANCE, ...ATMOSPHERE]).toEqual(SCENARIOS.map((scenario) => scenario.name));
  });

  it("each either presses the view button or pins the camera, and waits for its view", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.presses === undefined, scenario.name).toBe(scenario.pin !== undefined);
      if (scenario.pin !== undefined) expect(scenario.pin.view).toBe(scenario.view);
      if (scenario.presses !== undefined) {
        expect(["map", "middle", "local"][scenario.presses]).toBe(scenario.view);
      }
      expect(scenario.about.length).toBeGreaterThan(10);
    }
  });

  it("selects scenarios by name or by set, in table order", () => {
    expect(selectScenarios(null)).toHaveLength(9);
    expect(selectScenarios(["acceptance"]).map((scenario) => scenario.name)).toEqual(ACCEPTANCE);
    expect(selectScenarios(["atmosphere"]).map((scenario) => scenario.name)).toEqual(ATMOSPHERE);
    expect(selectScenarios(["shore", "map"]).map((scenario) => scenario.name)).toEqual([
      "map",
      "shore",
    ]);
    expect(() => selectScenarios(["map", "moon"])).toThrow(/moon/);
  });
});

describe("where the scenarios look", () => {
  it("finds the window with the most weight, the first in reading order on a tie", () => {
    const weights = new Float64Array(10 * 6);
    weights[3 * 10 + 7] = 5;
    weights[4 * 10 + 8] = 1;
    expect(densest(weights, 10, 6, { width: 2, height: 2 })).toEqual({ x: 8, y: 4 });
    // A view larger than the world is the world.
    expect(densest(weights, 10, 6, { width: 40, height: 40 })).toEqual({ x: 5, y: 3 });
    // No weight anywhere: the first window.
    expect(densest(new Float64Array(60), 10, 6, { width: 2, height: 2 })).toEqual({ x: 1, y: 1 });
  });

  it("weighs fuel, coast and crowds cell by cell", () => {
    const land: Land = {
      ...world(["~~gs.c", "~~bb..", "~~~~~~"], 200),
      ...LAND_PALETTE,
    };
    const fuel = [...fuelWeights(land)];
    // Grass, scrub and pines burn; a broadleaf wood, bare ground and the sea do not.
    expect(fuel.slice(0, 6)).toEqual([0, 0, 1, 1, 0, 1]);
    expect(fuel.slice(6, 12)).toEqual([0, 0, 0, 0, 0, 0]);
    const coast = [...coastWeights(land)];
    // Land with the sea beside it (not at a corner only).
    expect(coast.slice(0, 6)).toEqual([0, 0, 1, 0, 0, 0]);
    expect(coast.slice(6, 12)).toEqual([0, 0, 1, 1, 1, 1]);
    const creatures = {
      type: "creatures",
      positions: [
        [2.5, 0.5],
        [2.7, 0.2],
        [9, 9],
      ],
    } as unknown as CreaturesMessage;
    const crowd = [...crowdWeights([creatures], 6, 3)];
    expect(crowd[2]).toBe(2);
    expect(crowd.reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it("plans the committed recording the same way every time", () => {
    const recording = JSON.parse(readFileSync("public/stream/life.json", "utf8")) as {
      messages: unknown[];
    };
    const messages: Message[] = recording.messages.filter(isMessage);
    const views = {
      map: { width: 256, height: 150 },
      middle: { width: 64, height: 37.5 },
      local: { width: 16, height: 9.375 },
    };
    const plan = planOf(messages, 120_000, views);
    expect(planOf(messages, 120_000, views)).toEqual(plan);
    const [width, height] = plan.world.cells;
    for (const place of [plan.crowd, plan.fuel, plan.fire, plan.shore]) {
      expect(place.x).toBeGreaterThanOrEqual(0);
      expect(place.x).toBeLessThanOrEqual(width);
      expect(place.y).toBeGreaterThanOrEqual(0);
      expect(place.y).toBeLessThanOrEqual(height);
    }
    // The fire starts in the fuel window.
    expect(Math.abs(plan.fire.x - plan.fuel.x)).toBeLessThanOrEqual(views.middle.width / 2);
    expect(plan.genomes.length).toBeGreaterThan(0);
    expect(() => planOf([], 0, views)).toThrow(/no land/);
  });
});

describe("the frame cap (capFrames)", () => {
  /** A stand-in for the browser's refresh: the callbacks of the next one. */
  let pending: ((now: number) => void)[] = [];
  const refresh = (now: number): void => {
    const due = pending;
    pending = [];
    for (const callback of due) callback(now);
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    pending = [];
  });

  function tickerStub(): Ticker & { times: number[]; stopped: boolean } {
    const stub = {
      autoStart: true,
      times: [] as number[],
      stopped: false,
      stop() {
        stub.stopped = true;
      },
      update(now: number) {
        stub.times.push(now);
      },
    };
    return stub as unknown as Ticker & { times: number[]; stopped: boolean };
  }

  it("draws every other refresh of a 60 Hz screen at 30 fps, despite jitter", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
      pending.push(callback);
      return pending.length;
    });
    const ticker = tickerStub();
    expect(capFrames(ticker, 30)).toBe(30);
    expect(ticker.stopped).toBe(true);
    expect(ticker.autoStart).toBe(false);
    let now = 0;
    for (let k = 0; k < 600; k++) {
      // Refreshes come a fraction of a millisecond early or late.
      now += 1000 / 60 + (k % 3 === 0 ? -0.6 : 0.3);
      refresh(now);
    }
    expect(ticker.times.length).toBeGreaterThanOrEqual(299);
    expect(ticker.times.length).toBeLessThanOrEqual(301);
    const gaps = ticker.times.slice(1).map((time, k) => time - (ticker.times[k] ?? 0));
    const stats = summariseFrames(gaps);
    expect(stats.fps_median).toBeCloseTo(30, 0);
    expect(stats.fps_1pct_low).toBeGreaterThan(29);
  });

  it("lets every frame of a screen no faster than the cap through", () => {
    vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
      pending.push(callback);
      return pending.length;
    });
    const ticker = tickerStub();
    capFrames(ticker, 30);
    for (let k = 1; k <= 100; k++) refresh(k * (1000 / 30));
    expect(ticker.times).toHaveLength(100);
  });

  it("leaves the ticker alone without a cap", () => {
    const ticker = tickerStub();
    for (const fps of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(capFrames(ticker, fps)).toBe(0);
    }
    expect(ticker.stopped).toBe(false);
    expect(ticker.autoStart).toBe(true);
  });
});
