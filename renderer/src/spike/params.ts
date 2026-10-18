/** Options of the spike page, read from its URL. */

export type Backend = "webgl" | "canvas";

export interface SpikeParams {
  /** Seconds measured per scenario, after the warm-up. */
  measureS: number;
  warmupS: number;
  /** Scenario names to run; null runs them all. */
  only: string[] | null;
  /** Run this one scenario forever instead of benchmarking. */
  demo: string | null;
  /** Where to POST the results (the device runner listens here); null: nowhere. */
  postUrl: string | null;
  backend: Backend;
  seed: number;
  hud: boolean;
  /** Free text copied into the results, e.g. the browser-flag profile in use. */
  label: string;
}

export const DEFAULTS: SpikeParams = {
  measureS: 10,
  warmupS: 2,
  only: null,
  demo: null,
  postUrl: null,
  backend: "webgl",
  seed: 2026,
  hud: true,
  label: "",
};

function numberIn(text: string | null, fallback: number, low: number, high: number): number {
  if (text === null || text.trim() === "") return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? Math.min(Math.max(value, low), high) : fallback;
}

/** Parse a query string such as `?seconds=5&only=floor,spec-2x&post=/results`. */
export function parseParams(search: string): SpikeParams {
  const query = new URLSearchParams(search);
  const only = query.get("only");
  const names = only === null ? [] : only.split(",").map((name) => name.trim());
  return {
    measureS: numberIn(query.get("seconds"), DEFAULTS.measureS, 0.2, 120),
    warmupS: numberIn(query.get("warmup"), DEFAULTS.warmupS, 0, 30),
    only: names.some((name) => name !== "") ? names.filter((name) => name !== "") : null,
    demo: query.get("demo") || null,
    postUrl: query.get("post") || null,
    backend: query.get("backend") === "canvas" ? "canvas" : "webgl",
    seed: Math.round(numberIn(query.get("seed"), DEFAULTS.seed, 0, 2 ** 31)),
    hud: query.get("hud") !== "0",
    label: query.get("label") ?? "",
  };
}
