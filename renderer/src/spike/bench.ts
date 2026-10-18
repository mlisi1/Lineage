/** The benchmark: run each scenario for a fixed time and time every frame. */
import type { SpikeParams } from "./params";
import type { Applied, GpuInfo, SpikeScene } from "./scene";
import { ACCEPTANCE_SCENARIOS, TARGET_FPS, type Scenario } from "./scenarios";
import { median, percentile, summariseFrames, type FrameStats } from "./stats";

declare const __BUILD_COMMIT__: string;

/** Frames longer than this advance the animation by this much only. */
const MAX_STEP_MS = 100;
/** No frame for this long means the page is hidden or the GPU hung: stop waiting. */
const STALL_MS = 5000;

export interface ScenarioResult extends FrameStats, Applied {
  name: string;
  about: string;
  art_scale: number;
  shot: string;
  plants: string;
  creatures: number;
  tint: boolean;
  /** Milliseconds of script per frame (animation and draw calls), median and 99th percentile. */
  js_ms_median: number;
  js_ms_p99: number;
  /** JavaScript heap in use after the scenario, in MB (0 where the browser hides it). */
  js_heap_mb: number;
  /** Wall-clock window of the measurement, so the device runner can match its samples. */
  started_epoch_ms: number;
  ended_epoch_ms: number;
  /** True when frames stopped arriving and the measurement was cut short. */
  stalled: boolean;
}

export interface Results {
  tool: "lineage-renderer-spike";
  version: 1;
  build_commit: string;
  label: string;
  started_at: string;
  user_agent: string;
  hardware_concurrency: number;
  device_memory_gb: number;
  screen: { width: number; height: number; device_pixel_ratio: number };
  viewport: { width: number; height: number };
  gpu: GpuInfo | null;
  world: { cells: [number, number]; plant_cells: number; description: string };
  settings: { warmup_s: number; measure_s: number; backend: string; seed: number };
  scenarios: ScenarioResult[];
  acceptance: {
    scenarios: string[];
    target_fps: number;
    /** The lowest median frame rate among them. */
    fps_median: number | null;
    pass: boolean | null;
  };
  error: string | null;
}

interface Timings {
  frameMs: number[];
  jsMs: number[];
  startedEpochMs: number;
  endedEpochMs: number;
  stalled: boolean;
}

/** Drive the scene from requestAnimationFrame for warm-up + measurement. */
function measure(scene: SpikeScene, warmupS: number, measureS: number): Promise<Timings> {
  return new Promise((resolve) => {
    const timings: Timings = {
      frameMs: [],
      jsMs: [],
      startedEpochMs: 0,
      endedEpochMs: 0,
      stalled: false,
    };
    const begun = performance.now();
    let last = -1;
    let done = false;
    let watchdog = 0;
    const finish = (stalled: boolean): void => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      timings.stalled = stalled;
      timings.endedEpochMs = Date.now();
      if (timings.startedEpochMs === 0) timings.startedEpochMs = timings.endedEpochMs;
      resolve(timings);
    };
    const tick = (now: number): void => {
      if (done) return;
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => finish(true), STALL_MS);
      const elapsedS = (performance.now() - begun) / 1000;
      const frameMs = last < 0 ? 1000 / 60 : now - last;
      last = now;
      const scriptStart = performance.now();
      scene.frame(Math.min(frameMs, MAX_STEP_MS) / 1000);
      const scriptMs = performance.now() - scriptStart;
      if (elapsedS >= warmupS) {
        if (timings.startedEpochMs === 0) {
          timings.startedEpochMs = Date.now();
        } else {
          timings.frameMs.push(frameMs);
          timings.jsMs.push(scriptMs);
        }
      }
      if (elapsedS >= warmupS + measureS) {
        finish(false);
        return;
      }
      requestAnimationFrame(tick);
    };
    watchdog = window.setTimeout(() => finish(true), STALL_MS);
    requestAnimationFrame(tick);
  });
}

function heapMb(): number {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize === undefined ? 0 : memory.usedJSHeapSize / (1024 * 1024);
}

export async function runScenario(
  scene: SpikeScene,
  scenario: Scenario,
  params: SpikeParams,
): Promise<ScenarioResult> {
  const applied = scene.apply(scenario);
  const timings = await measure(scene, params.warmupS, params.measureS);
  const scripts = [...timings.jsMs].sort((a, b) => a - b);
  return {
    name: scenario.name,
    about: scenario.about,
    art_scale: scenario.artScale,
    shot: scenario.shot,
    plants: scenario.plants,
    creatures: scenario.creatures,
    tint: scenario.tint,
    ...applied,
    ...summariseFrames(timings.frameMs),
    js_ms_median: median(scripts),
    js_ms_p99: percentile(scripts, 99),
    js_heap_mb: heapMb(),
    started_epoch_ms: timings.startedEpochMs,
    ended_epoch_ms: timings.endedEpochMs,
    stalled: timings.stalled,
  };
}

/** The part of the results known before any scenario runs. */
export function describeRun(
  params: SpikeParams,
  gpu: GpuInfo | null,
  world: Results["world"],
): Results {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    tool: "lineage-renderer-spike",
    version: 1,
    build_commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown",
    label: params.label,
    started_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency,
    device_memory_gb: nav.deviceMemory ?? 0,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      device_pixel_ratio: window.devicePixelRatio,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gpu,
    world,
    settings: {
      warmup_s: params.warmupS,
      measure_s: params.measureS,
      backend: params.backend,
      seed: params.seed,
    },
    scenarios: [],
    acceptance: {
      scenarios: [...ACCEPTANCE_SCENARIOS],
      target_fps: TARGET_FPS,
      fps_median: null,
      pass: null,
    },
    error: null,
  };
}

/** Fill in the acceptance verdict from the scenarios that ran: all of them, or none. */
export function judge(results: Results): void {
  const rates: number[] = [];
  for (const name of ACCEPTANCE_SCENARIOS) {
    const measured = results.scenarios.find((scenario) => scenario.name === name);
    if (measured === undefined || measured.frames === 0) return;
    rates.push(measured.fps_median);
  }
  const lowest = Math.min(...rates);
  results.acceptance.fps_median = lowest;
  results.acceptance.pass = lowest >= TARGET_FPS;
}
