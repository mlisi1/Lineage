/**
 * The scene's benchmark (R5): the R0 spike's role taken over by the real page.
 *
 *   index.html?bench                          every scenario (`benchplan.ts`), then the results
 *   ?bench&seconds=8&warmup=2                 measured, and discarded first, per scenario
 *   ?bench&only=acceptance|atmosphere|map,…   a set, or the scenarios named
 *   ?bench&post=/results                      also POST the results (the device runner listens)
 *   ?bench&cap=30                             the page capped at 30 fps, as the kiosk is (`framecap.ts`)
 *   ?bench&seed=2026&label=gpu                the scene's random draws; a label copied into the results
 *
 * There is no server yet, so the scene plays the committed creatures' recording
 * (`public/stream/life.json`), at the speed it plays when looked at, and what it lacks
 * (night, rain, a big fire, a world's end) is made up as `?show=` makes it up.
 *
 * Each scenario runs on a page of its own: the first load reads the recording and finds
 * where each scenario looks (`Plan`), then the page loads itself once per scenario with
 * the scene's own options for it (the view pinned, or the button pressed; `show`), keeping
 * the results so far in the tab's session storage. So every scenario starts from a fresh
 * scene, deterministic for a seed, and is measured on real frames from the browser
 * (never `?film`'s stepped ones). After the last the page shows the results and POSTs
 * them, in the shape `tools/kiosk_bench.py` reads from the R0 spike, with more numbers.
 */
import { PROBE, summariseProbe, type ProbeSummary, type ProbedFrame } from "./frameprobe";
import {
  UPDATE_PRIORITY,
  ViewContainer,
  type Application,
  type Container,
  type WebGLRenderer,
} from "pixi.js";
import {
  ACCEPTANCE,
  FLOOD_AT_S,
  bigFire,
  planOf,
  selectScenarios,
  type BenchScenario,
  type Plan,
  type ViewCells,
} from "./benchplan";
import type { Subject } from "./director";
import { median, percentile, summariseFrames, type FrameStats } from "./framestats";
import { gpuInfo, type GpuInfo } from "./gpu";
import type { ViewName } from "./landscape";
import type { CreaturesMessage, Message } from "./protocol";
import { isMessage } from "./stream";
import type { CellRect, Land } from "./terrain/land";

declare const __BUILD_COMMIT__: string;

declare global {
  interface Window {
    /** Set when the benchmark has finished (an end-to-end check waits for it). */
    __benchResults?: BenchResults;
  }
}

/** Where the recording the scenarios play lies (`main.ts` names it `life`). */
const RECORDING_URL = "stream/life.json";
/** Sim-seconds a wall second: the speed the scene plays the creatures' recording at. */
export const BENCH_SPEED = 1800;
/** The seed of the scene's random draws when none is given. */
const DEFAULT_SEED = 2026;
/** Seconds measured and discarded per scenario when not told. */
const DEFAULT_MEASURE_S = 8;
const DEFAULT_WARMUP_S = 2;
/** Seconds a scenario's page may take to load and paint its first land: counted into the plan's horizon. */
const LOAD_ALLOWANCE_S = 5;
/** Seconds to wait for the first land to be painted, and then for the view asked for. */
const READY_TIMEOUT_S = 60;
const VIEW_TIMEOUT_S = 15;
/** Seconds the day's turn waits for the next day: a sim-day is 48 s at `BENCH_SPEED`. */
const DAY_DUE_TIMEOUT_S = 90;
/** No frame for this long means the page is hidden or the GPU hung: stop waiting. */
const STALL_MS = 5000;
/** The frame rate the scenarios are judged against (ADR 0010), the kiosk's cap (ADR 0022). */
export const TARGET_FPS = 30;
/**
 * A scene holding the cap reads 30 fps give or take the display's timing: the median of
 * frames drawn every other refresh of a 60 Hz screen is 30.0 ± a few hundredths.
 */
const TARGET_SLACK_FPS = 0.5;
/** A frame's budget at the target, in milliseconds. */
const BUDGET_MS = 1000 / TARGET_FPS;
/**
 * A frame counts as over budget when it came this much later than the budget: the
 * refreshes jitter by a fraction of a millisecond, a missed slot by a whole refresh.
 */
const LATE_SLACK_MS = 2;
/** Our hooks run first and last of the ticker's listeners: before the scene moves, after it is drawn. */
const FIRST = UPDATE_PRIORITY.INTERACTION + 1;
const LAST = UPDATE_PRIORITY.UTILITY - 1;
/** Where the run's state waits between the scenarios' pages. */
const STORE_PREFIX = "lineage-bench:";

/** What the scene hands the benchmark: what it does, and what it can be asked. */
export interface BenchHooks {
  app: Application;
  /** Screen pixels per art pixel. */
  artScale: number;
  /** Press the view button. */
  press(): void;
  /** A message, as if the stream had sent it. */
  receive(message: Message): void;
  /** Move the atmosphere on by this many seconds at the next frame. */
  advance(seconds: number): void;
  /** Whether the view shows the latest land, fully painted. */
  settled(): boolean;
  /** Hold the sim-day as it is drawn, or let it turn (`Landscape.holdDay`). */
  holdDay(held: boolean): void;
  /** Whether a new day or land is waiting to be laid out. */
  dayDue(): boolean;
  /** What the camera shows. */
  camera(): { view: ViewName; dipping: boolean };
  /** The cells in sight. */
  sight(): CellRect;
  land(): Land | null;
  animals(): readonly Subject[];
  /** The sim time of the latest message. */
  simMs(): number;
  /** The animals as the stream last sent them. */
  creatures(): CreaturesMessage | null;
  /** The atmosphere's state and how many of its sprites are shown. */
  atmosphere(): Record<string, unknown>;
  /** Textures alive on the GPU. */
  textures(): number;
  /** The land (ground and plants) and the animals' layers, for counting their sprites. */
  layers: { land: Container; creatures: readonly Container[] };
}

/** The benchmark's settings, from the page's address. */
interface Settings {
  measureS: number;
  warmupS: number;
  only: string[] | null;
  postUrl: string | null;
  seed: number;
  /** Frames a second the page is capped at; 0 for none. */
  capFps: number;
  label: string;
}

export interface BenchScenarioResult extends FrameStats {
  name: string;
  about: string;
  view: ViewName;
  /** The R0 spike's names for what was drawn, so the runner's tables read both. */
  shot: ViewName;
  art_scale: number;
  plants: "painted";
  tint: boolean;
  recording: string;
  show: string;
  /** Pinned to a place, or filmed by the director after this many presses. */
  pinned: boolean;
  presses: number;
  /** Animals alive, and in sight, at the end of the measurement. */
  creatures: number;
  animals_in_sight: number;
  /** The canvas the scene is drawn into, before it is stretched to the screen. */
  internal: [number, number];
  /** Sprites shown (meshes and graphics too) at the end: the land's, the animals', all. */
  plant_sprites: number;
  creature_sprites: number;
  sprites: number;
  /** WebGL draw calls a frame: median and most. */
  draws_median: number;
  draws_max: number;
  /** Textures alive on the GPU at the end. */
  textures: number;
  /** A frame's budget at 30 fps, and the share of frames that came later than it (%). */
  frame_budget_ms: number;
  over_budget_pct: number;
  /** What the page's own work leaves of the budget: median and 99th percentile (ms). */
  headroom_ms_median: number;
  headroom_ms_p99: number;
  /** Milliseconds of script a frame (moving the scene and handing it to the GPU). */
  js_ms_median: number;
  js_ms_p99: number;
  /** Where the frames' time went, phase by phase, and what the late ones held (`frameprobe.ts`). */
  probe: ProbeSummary;
  /** JavaScript heap in use after the scenario, in MB (0 where the browser hides it). */
  js_heap_mb: number;
  /** The atmosphere's state and sprite counts at the end. */
  atmosphere: Record<string, unknown>;
  /** Seconds from the page's start to the warm-up's (loading, the first land painted, presses). */
  /**
   * The sim-day while it was measured: held as it was, turned in the window (a day's
   * turn), or "not due" if no new day came in time for the turn.
   */
  day: "held" | "turned" | "not due";
  ready_s: number;
  /** Whether the land, and the view measured, were painted when the warm-up began (false: it
   * timed out waiting). */
  settled: boolean;
  /** Wall-clock window of the measurement, so the device runner can match its samples. */
  started_epoch_ms: number;
  ended_epoch_ms: number;
  /** True when frames stopped arriving and the measurement was cut short. */
  stalled: boolean;
}

export interface BenchResults {
  tool: "lineage-renderer-bench";
  version: 1;
  page: "scene";
  build_commit: string;
  /** The build: "production" for `npm run build`, "kiosk" for the desk's. */
  build_mode: string;
  label: string;
  started_at: string;
  user_agent: string;
  hardware_concurrency: number;
  device_memory_gb: number;
  screen: { width: number; height: number; device_pixel_ratio: number };
  viewport: { width: number; height: number };
  gpu: GpuInfo | null;
  world: { cells: [number, number]; plant_cells: number; description: string };
  settings: {
    warmup_s: number;
    measure_s: number;
    backend: string;
    seed: number;
    cap_fps: number;
    recording: string;
    speed: number;
  };
  plan: Plan | null;
  scenarios: BenchScenarioResult[];
  acceptance: {
    scenarios: string[];
    target_fps: number;
    /** Below the target by no more than this still holds it (the display's timing). */
    slack_fps: number;
    /** The lowest median frame rate among them, and the most frames over budget (%). */
    fps_median: number | null;
    over_budget_pct: number | null;
    pass: boolean | null;
  };
  error: string | null;
}

/** The run between the scenarios' pages. */
interface Stored {
  names: string[];
  plan: Plan;
  results: BenchResults;
}

function numberIn(text: string | null, fallback: number, low: number, high: number): number {
  if (text === null || text.trim() === "") return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? Math.min(Math.max(value, low), high) : fallback;
}

function settingsOf(query: URLSearchParams): Settings {
  const names = (query.get("only") ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
  return {
    measureS: numberIn(query.get("seconds"), DEFAULT_MEASURE_S, 0.2, 120),
    warmupS: numberIn(query.get("warmup"), DEFAULT_WARMUP_S, 0, 60),
    only: names.length > 0 ? names : null,
    postUrl: query.get("post") || null,
    seed: Math.round(numberIn(query.get("seed"), DEFAULT_SEED, 0, 2 ** 31)),
    capFps: numberIn(query.get("cap"), 0, 0, 240),
    label: query.get("label") ?? "",
  };
}

function describe(settings: Settings): BenchResults {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    tool: "lineage-renderer-bench",
    version: 1,
    page: "scene",
    build_commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown",
    build_mode: import.meta.env.MODE,
    label: settings.label,
    started_at: new Date().toISOString(),
    user_agent: navigator.userAgent,
    hardware_concurrency: navigator.hardwareConcurrency,
    device_memory_gb: nav.deviceMemory ?? 0,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      device_pixel_ratio: window.devicePixelRatio,
    },
    // Read again as each scenario is measured (`runScenario`).
    viewport: { width: window.innerWidth, height: window.innerHeight },
    gpu: null,
    world: { cells: [0, 0], plant_cells: 0, description: "" },
    settings: {
      warmup_s: settings.warmupS,
      measure_s: settings.measureS,
      backend: "webgl",
      seed: settings.seed,
      cap_fps: settings.capFps,
      recording: RECORDING_URL,
      speed: BENCH_SPEED,
    },
    plan: null,
    scenarios: [],
    acceptance: {
      scenarios: [...ACCEPTANCE],
      target_fps: TARGET_FPS,
      slack_fps: TARGET_SLACK_FPS,
      fps_median: null,
      over_budget_pct: null,
      pass: null,
    },
    error: null,
  };
}

/** Fill in the verdict from the scenarios judged: all of them, or none. */
export function judge(results: BenchResults): void {
  const measured = ACCEPTANCE.map((name) => results.scenarios.find((s) => s.name === name));
  if (measured.some((scenario) => scenario === undefined || scenario.frames === 0)) return;
  const judged = measured.filter((scenario) => scenario !== undefined);
  const lowest = Math.min(...judged.map((scenario) => scenario.fps_median));
  results.acceptance.fps_median = lowest;
  results.acceptance.over_budget_pct = Math.max(...judged.map((s) => s.over_budget_pct));
  results.acceptance.pass = lowest >= TARGET_FPS - TARGET_SLACK_FPS;
}

function storeKey(run: string): string {
  return STORE_PREFIX + run;
}

/** Session storage can be missing or refused (a private window): the run then fails, said so. */
function load(run: string): Stored | null {
  try {
    const text = window.sessionStorage.getItem(storeKey(run));
    return text === null ? null : (JSON.parse(text) as Stored);
  } catch {
    return null;
  }
}

function save(run: string, stored: Stored): boolean {
  try {
    window.sessionStorage.setItem(storeKey(run), JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

function forget(run: string): void {
  try {
    window.sessionStorage.removeItem(storeKey(run));
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** This page's address with `run` and `step` set: the next scenario's page. */
function stepUrl(run: string, step: number): string {
  const url = new URL(window.location.href);
  url.searchParams.set("run", run);
  url.searchParams.set("step", String(step));
  return url.toString();
}

/** A promise that never settles: the page is going elsewhere. */
function leaving(): Promise<never> {
  return new Promise<never>(() => undefined);
}

/** Wait for the next animation frame. */
function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** Wait until `ready` says so or `timeoutS` passes; true if it said so. */
async function until(ready: () => boolean, timeoutS: number): Promise<boolean> {
  const begun = performance.now();
  while (!ready()) {
    if (performance.now() - begun > timeoutS * 1000) return false;
    await frame();
  }
  return true;
}

function heapMb(): number {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  return memory?.usedJSHeapSize === undefined ? 0 : memory.usedJSHeapSize / (1024 * 1024);
}

/** Sprites, meshes and graphics shown under `root`. */
function drawables(root: Container): number {
  if (!root.visible || !root.renderable) return 0;
  let count = root instanceof ViewContainer ? 1 : 0;
  for (const child of root.children) count += drawables(child);
  return count;
}

/** Count WebGL draw calls by wrapping the context's draw functions; returns the counter. */
function countDraws(app: Application): { draws: number } {
  const counter = { draws: 0 };
  const gl = (app.renderer as Partial<WebGLRenderer>).gl as
    (WebGL2RenderingContext & Record<string, unknown>) | undefined;
  if (gl === undefined) return counter;
  for (const name of [
    "drawArrays",
    "drawElements",
    "drawArraysInstanced",
    "drawElementsInstanced",
  ] as const) {
    const original = gl[name] as ((...args: unknown[]) => void) | undefined;
    if (typeof original !== "function") continue;
    gl[name] = (...args: unknown[]): void => {
      counter.draws += 1;
      original.apply(gl, args);
    };
  }
  return counter;
}

interface Timings {
  frameMs: number[];
  /** What the frame probe saw of each frame measured (`frameprobe.ts`). */
  probed: ProbedFrame[];
  jsMs: number[];
  draws: number[];
  startedEpochMs: number;
  endedEpochMs: number;
  stalled: boolean;
}

/**
 * Time every frame the ticker draws for warm-up + measurement: the time since the frame
 * before (what the screen shows), and the script from the first listener to after the
 * draw (what the page itself spends).
 */
function measure(app: Application, warmupS: number, measureS: number): Promise<Timings> {
  const ticker = app.ticker;
  const counter = countDraws(app);
  return new Promise((resolve) => {
    const timings: Timings = {
      frameMs: [],
      probed: [],
      jsMs: [],
      draws: [],
      startedEpochMs: 0,
      endedEpochMs: 0,
      stalled: false,
    };
    const begun = performance.now();
    let scriptStart = 0;
    let measuring = false;
    let done = false;
    let watchdog = 0;
    const finish = (stalled: boolean): void => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      ticker.remove(first);
      ticker.remove(last);
      timings.stalled = stalled;
      timings.endedEpochMs = Date.now();
      if (timings.startedEpochMs === 0) timings.startedEpochMs = timings.endedEpochMs;
      resolve(timings);
    };
    const first = (): void => {
      window.clearTimeout(watchdog);
      watchdog = window.setTimeout(() => finish(true), STALL_MS);
      scriptStart = performance.now();
      counter.draws = 0;
      if (measuring) timings.frameMs.push(ticker.elapsedMS);
    };
    const last = (): void => {
      const now = performance.now();
      PROBE.leave();
      const probed = PROBE.next();
      if (measuring) {
        timings.jsMs.push(now - scriptStart);
        timings.draws.push(counter.draws);
        timings.probed.push(probed);
      }
      const elapsedS = (now - begun) / 1000;
      if (!measuring && elapsedS >= warmupS) {
        // The next frame is the first measured: its time since this one is a whole frame.
        measuring = true;
        timings.startedEpochMs = Date.now();
      } else if (measuring && elapsedS >= warmupS + measureS) {
        finish(false);
      }
    };
    ticker.add(first, undefined, FIRST);
    ticker.add(last, undefined, LAST);
    watchdog = window.setTimeout(() => finish(true), STALL_MS);
  });
}

/** One line per scenario, on the page, once the run is over. */
function showResults(results: BenchResults): void {
  const panel = document.createElement("pre");
  panel.dataset["testid"] = "bench-results";
  Object.assign(panel.style, {
    position: "absolute",
    inset: "0",
    margin: "0",
    padding: "16px",
    overflow: "auto",
    background: "rgba(16, 8, 28, 0.92)",
    color: "#f4ecd8",
    font: "13px/1.4 monospace",
    zIndex: "10",
  });
  const lines = [`Lineage scene benchmark (R5) · build ${results.build_commit}`];
  if (results.error !== null) lines.push(`Failed: ${results.error}`);
  const gpu = results.gpu;
  lines.push(
    `Drawn by ${gpu === null ? "nothing" : `${gpu.api} on ${gpu.unmasked_renderer || gpu.renderer}`}`,
  );
  lines.push(
    `cap ${results.settings.cap_fps || "none"} · ${results.settings.measure_s} s after ${results.settings.warmup_s} s`,
    "",
    "scenario        fps med  1% low  over %  js ms  headroom  draws  sprites",
  );
  for (const s of results.scenarios) {
    lines.push(
      `${s.name.padEnd(15)} ${s.fps_median.toFixed(1).padStart(7)} ${s.fps_1pct_low.toFixed(1).padStart(7)}` +
        ` ${s.over_budget_pct.toFixed(1).padStart(7)} ${s.js_ms_median.toFixed(2).padStart(6)}` +
        ` ${s.headroom_ms_median.toFixed(1).padStart(9)} ${String(s.draws_median).padStart(6)}` +
        ` ${String(s.sprites).padStart(8)}${s.stalled ? "  stalled" : ""}`,
    );
  }
  const { acceptance } = results;
  if (acceptance.pass !== null && acceptance.fps_median !== null) {
    lines.push(
      "",
      `${acceptance.scenarios.join(", ")}: ${acceptance.fps_median.toFixed(1)} fps median at the lowest,` +
        ` target ${acceptance.target_fps}: ${acceptance.pass ? "PASS" : "FAIL"}`,
    );
  }
  panel.textContent = lines.join("\n");
  document.body.appendChild(panel);
}

/** POST the results to the device runner. Failure is reported, not thrown. */
async function postResults(url: string, results: BenchResults): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(results),
    });
    return response.ok ? null : `POST ${url} answered ${response.status}`;
  } catch (error) {
    return `POST ${url} failed: ${String(error)}`;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * The benchmark on this page, if its address asks for one. The scene asks it for the
 * options to start with (`params`), then hands it its hooks (`attach`).
 */
export class Bench {
  private constructor(
    /** The scene's options for this scenario, in place of the page's address. */
    readonly params: URLSearchParams,
    private readonly run: string,
    private readonly step: number,
    private readonly stored: Stored,
    private readonly scenario: BenchScenario,
    private readonly settings: Settings,
  ) {}

  /**
   * The benchmark asked for by `search` (null for none). The first page of a run plans it
   * and goes on to the first scenario's page, so its promise never settles; a scenario's
   * page gets its benchmark. `views` are the views' sizes in cells.
   */
  static async start(
    search: string,
    views: Readonly<Record<ViewName, ViewCells>>,
  ): Promise<Bench | null> {
    const query = new URLSearchParams(search);
    if (!query.has("bench")) return null;
    const settings = settingsOf(query);
    const run = query.get("run");
    if (run === null) return Bench.plan(settings, views);
    const step = Number(query.get("step") ?? 0);
    const stored = load(run);
    const scenario = selectScenarios(stored?.names ?? []).find(
      (each) => each.name === stored?.names[step],
    );
    if (stored === null || scenario === undefined) {
      const results = stored?.results ?? describe(settings);
      results.error ??= "the run's state was lost between pages (session storage)";
      await Bench.finish(run, settings, results);
      return leaving();
    }
    return new Bench(
      Bench.paramsFor(scenario, stored.plan, settings),
      run,
      step,
      stored,
      scenario,
      settings,
    );
  }

  /** Read the recording, find the scenarios' places, and go to the first scenario. */
  private static async plan(
    settings: Settings,
    views: Readonly<Record<ViewName, ViewCells>>,
  ): Promise<never> {
    const run = String(Date.now());
    const results = describe(settings);
    try {
      const names = selectScenarios(settings.only).map((scenario) => scenario.name);
      const response = await fetch(RECORDING_URL);
      if (!response.ok) throw new Error(`${RECORDING_URL}: HTTP ${response.status}`);
      const document = (await response.json()) as { messages?: unknown };
      if (!Array.isArray(document.messages)) throw new Error(`${RECORDING_URL}: no messages`);
      const messages = document.messages.filter(isMessage);
      const horizonMs =
        (LOAD_ALLOWANCE_S + settings.warmupS + settings.measureS) * 1000 * BENCH_SPEED;
      const plan = planOf(messages, horizonMs, views);
      results.plan = plan;
      results.world = {
        cells: plan.world.cells,
        plant_cells: 0,
        description: plan.world.description,
      };
      if (names.length === 0) throw new Error("no scenario to run");
      if (!save(run, { names, plan, results })) {
        throw new Error("session storage is unavailable: the run cannot go from page to page");
      }
      window.location.replace(stepUrl(run, 0));
    } catch (error) {
      results.error = errorText(error);
      await Bench.finish(run, settings, results);
    }
    return leaving();
  }

  /** The scene's options for `scenario`: the recording, the seed, the cap, its view and show. */
  private static paramsFor(
    scenario: BenchScenario,
    plan: Plan,
    settings: Settings,
  ): URLSearchParams {
    const params = new URLSearchParams({
      recording: scenario.recording,
      speed: String(BENCH_SPEED),
      seed: String(settings.seed),
    });
    if (settings.capFps > 0) params.set("cap", String(settings.capFps));
    if (scenario.show !== undefined) params.set("show", scenario.show);
    if (scenario.pin !== undefined) {
      const place = plan[scenario.pin.at];
      params.set("view", scenario.pin.view);
      params.set("x", place.x.toFixed(2));
      params.set("y", place.y.toFixed(2));
    }
    return params;
  }

  /** The run is over: show the results, POST them, and forget the run. */
  private static async finish(
    run: string,
    settings: Settings,
    results: BenchResults,
  ): Promise<void> {
    judge(results);
    showResults(results);
    forget(run);
    window.__benchResults = results;
    if (settings.postUrl !== null) {
      const failure = await postResults(settings.postUrl, results);
      if (failure !== null) console.warn(failure);
    }
  }

  /** The scene is built: run this page's scenario on it, then go on to the next. */
  attach(hooks: BenchHooks): void {
    PROBE.enabled = true;
    void this.runScenario(hooks).catch(async (error: unknown) => {
      this.stored.results.error = `${this.scenario.name}: ${errorText(error)}`;
      await Bench.finish(this.run, this.settings, this.stored.results);
    });
  }

  private async runScenario(hooks: BenchHooks): Promise<void> {
    const { scenario, settings, stored } = this;
    stored.results.gpu = gpuInfo(hooks.app.renderer);
    // The first land painted, and the animals come, before anything is asked of the scene.
    const settled = await until(
      () => hooks.settled() && hooks.land() !== null && hooks.animals().length > 0,
      READY_TIMEOUT_S,
    );
    this.stage(hooks);
    for (let press = 0; press < (scenario.presses ?? 0); press++) {
      await until(() => !hooks.camera().dipping, VIEW_TIMEOUT_S);
      hooks.press();
      await frame();
    }
    await until(() => {
      const camera = hooks.camera();
      return camera.view === scenario.view && !camera.dipping;
    }, VIEW_TIMEOUT_S);
    // The view measured painted too, not only the first one: on the board the local view's
    // ground comes in pieces over several seconds, and a view measured before it would be
    // measured with bare ground.
    const viewSettled = await until(() => hooks.settled(), READY_TIMEOUT_S);
    // The day held while it is measured, as on the desk where it turns once a day; or, for
    // a day's turn, held until the next day is due and let go as the measuring begins.
    hooks.holdDay(true);
    let turned = false;
    if (scenario.dayTurn === true) {
      turned = await until(() => hooks.dayDue(), DAY_DUE_TIMEOUT_S);
      hooks.holdDay(false);
    }
    // The page's size as it is measured, the smallest of the run's (R5: read when the run
    // began, before the kiosk's window had gone full screen, it said 992 x 558).
    const { viewport } = stored.results;
    viewport.width = Math.min(viewport.width, window.innerWidth);
    viewport.height = Math.min(viewport.height, window.innerHeight);
    if (stored.results.scenarios.length === 0) {
      viewport.width = window.innerWidth;
      viewport.height = window.innerHeight;
    }
    const readyS = performance.now() / 1000;
    const timings = await measure(hooks.app, settings.warmupS, settings.measureS);
    const day = scenario.dayTurn !== true ? "held" : turned ? "turned" : "not due";
    stored.results.scenarios.push(
      this.resultOf(hooks, timings, readyS, settled && viewSettled, day),
    );
    const next = this.step + 1;
    if (next < stored.names.length && save(this.run, stored)) {
      window.location.replace(stepUrl(this.run, next));
      return;
    }
    if (next < stored.names.length) {
      stored.results.error = "session storage refused the results: the run stopped early";
    }
    await Bench.finish(this.run, settings, stored.results);
  }

  /** What the scenario does itself, once the scene is ready. */
  private stage(hooks: BenchHooks): void {
    const land = hooks.land();
    if (this.scenario.stage === "fire" && land !== null) {
      // A thunderstorm's lightning lit it, as fires start on the island.
      const { fire } = this.stored.plan;
      const tMs = hooks.simMs();
      hooks.receive({
        type: "sky",
        protocol: 1,
        t_ms: tMs,
        light: 1,
        present: true,
        rain: "storm",
        burning: bigFire(land, this.stored.plan),
      });
      hooks.receive({
        type: "events",
        protocol: 1,
        events: [{ kind: "fire_started", t_ms: tMs, x: fire.x, y: fire.y }],
      });
    }
    if (this.scenario.stage === "flood") {
      // The world ends as the stream says it (its last creature died), and the sequence is
      // moved on into its flood at the next frame.
      hooks.receive({
        type: "events",
        protocol: 1,
        events: [
          { kind: "world_ended", t_ms: hooks.simMs(), world: 1, seed: 0, cause: "last_creature" },
        ],
      });
      hooks.advance(FLOOD_AT_S);
    }
    const last = hooks.creatures();
    const { glowBit, genomes } = this.stored.plan;
    if (this.scenario.stage === "glow" && last !== null && glowBit > 0) {
      // Every animal's genome sent again with the glow gene: the scene draws only the
      // spots, as for any carrier, on whatever comes into sight.
      const alive = new Set(last.ids);
      const born = genomes
        .filter(({ id }) => alive.has(id))
        .map(({ id, genome, slots }) => ({ id, genome, slots: slots | glowBit }));
      hooks.receive({ ...last, born });
    }
  }

  private resultOf(
    hooks: BenchHooks,
    timings: Timings,
    readyS: number,
    settled: boolean,
    day: BenchScenarioResult["day"],
  ): BenchScenarioResult {
    const { scenario } = this;
    const scripts = [...timings.jsMs].sort((a, b) => a - b);
    const draws = [...timings.draws].sort((a, b) => a - b);
    const frames = summariseFrames(timings.frameMs);
    const late = timings.frameMs.filter((ms) => ms > BUDGET_MS + LATE_SLACK_MS).length;
    const cells = hooks.sight();
    const animals = hooks.animals();
    const inSight = animals.filter(
      (a) => a.x >= cells.x0 && a.x < cells.x1 && a.y >= cells.y0 && a.y < cells.y1,
    ).length;
    const renderer = hooks.app.renderer;
    const landSprites = drawables(hooks.layers.land);
    const creatureSprites = hooks.layers.creatures.reduce(
      (sum, layer) => sum + drawables(layer),
      0,
    );
    const jsMedian = median(scripts);
    const jsP99 = percentile(scripts, 99);
    return {
      name: scenario.name,
      about: scenario.about,
      view: scenario.view,
      shot: scenario.view,
      art_scale: hooks.artScale,
      plants: "painted",
      tint: true,
      recording: RECORDING_URL,
      show: scenario.show ?? "",
      pinned: scenario.pin !== undefined,
      presses: scenario.presses ?? 0,
      creatures: animals.length,
      animals_in_sight: inSight,
      internal: [renderer.width, renderer.height],
      plant_sprites: landSprites,
      creature_sprites: creatureSprites,
      sprites: drawables(hooks.app.stage),
      draws_median: median(draws),
      draws_max: draws[draws.length - 1] ?? 0,
      textures: hooks.textures(),
      ...frames,
      frame_budget_ms: BUDGET_MS,
      over_budget_pct: frames.frames > 0 ? (100 * late) / frames.frames : 0,
      headroom_ms_median: BUDGET_MS - jsMedian,
      headroom_ms_p99: BUDGET_MS - jsP99,
      js_ms_median: jsMedian,
      js_ms_p99: jsP99,
      js_heap_mb: heapMb(),
      probe: summariseProbe(
        timings.frameMs.map((frameMs, k) => ({
          frameMs,
          probed: timings.probed[k] ?? PROBE.next(),
        })),
        BUDGET_MS + LATE_SLACK_MS,
      ),
      atmosphere: hooks.atmosphere(),
      ready_s: readyS,
      settled,
      day,
      started_epoch_ms: timings.startedEpochMs,
      ended_epoch_ms: timings.endedEpochMs,
      stalled: timings.stalled,
    };
  }
}
