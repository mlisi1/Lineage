/** Show the benchmark's results on the page and hand them to whoever is listening. */
import type { Results, ScenarioResult } from "./bench";
import type { GpuInfo } from "./scene";

function cell(text: string, tag: "td" | "th" = "td"): HTMLElement {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function row(result: ScenarioResult): HTMLTableRowElement {
  const line = document.createElement("tr");
  line.append(
    cell(result.name),
    cell(`${result.internal[0]}×${result.internal[1]}`),
    cell(String(result.plant_sprites + result.creature_sprites)),
    cell(result.fps_median.toFixed(1)),
    cell(result.fps_1pct_low.toFixed(1)),
    cell(result.js_ms_median.toFixed(2)),
    cell(result.stalled ? "stalled" : result.about),
  );
  return line;
}

/** One line saying what actually drew the page: the fact R0 most needs from a device. */
export function drawnBy(gpu: GpuInfo | null, asked: string): string {
  if (gpu === null) {
    return "nothing: the scene never started";
  }
  if (gpu.api === "canvas") {
    return `2D canvas, on the CPU${asked === "canvas" ? "" : " (WebGL was not available)"}`;
  }
  const driver = gpu.unmasked_renderer || gpu.renderer || "unknown driver";
  return `${gpu.api === "webgl" ? "WebGL" : gpu.api} on ${driver}${gpu.software ? " (software, on the CPU)" : ""}`;
}

/** Fill the results panel: a verdict line, the environment, and one row per scenario. */
export function showResults(panel: HTMLElement, results: Results): void {
  panel.replaceChildren();
  const title = document.createElement("h1");
  title.textContent = "Lineage renderer spike (R0)";
  const verdict = document.createElement("p");
  verdict.dataset["testid"] = "verdict";
  const { acceptance } = results;
  if (results.error !== null) {
    verdict.textContent = `Failed: ${results.error}`;
  } else if (acceptance.fps_median === null) {
    verdict.textContent = `${acceptance.scenario} was not run, so there is no verdict.`;
  } else {
    verdict.textContent =
      `${acceptance.scenario}: ${acceptance.fps_median.toFixed(1)} fps median, ` +
      `target ${acceptance.target_fps}: ${acceptance.pass === true ? "PASS" : "FAIL"}`;
  }
  const environment = document.createElement("p");
  environment.dataset["testid"] = "drawn-by";
  environment.textContent =
    `Drawn by ${drawnBy(results.gpu, results.settings.backend)} · ` +
    `build ${results.build_commit}`;

  const table = document.createElement("table");
  const head = document.createElement("tr");
  for (const label of [
    "scenario",
    "drawn at",
    "sprites",
    "fps median",
    "1% low",
    "script ms",
    "",
  ]) {
    head.append(cell(label, "th"));
  }
  table.append(head, ...results.scenarios.map(row));

  const download = document.createElement("a");
  download.textContent = "Download results (JSON)";
  download.download = "spike-results.json";
  download.href = URL.createObjectURL(
    new Blob([JSON.stringify(results, null, 2)], { type: "application/json" }),
  );
  panel.append(title, verdict, environment, table, download);
  panel.style.display = "block";
}

/** POST the results to the device runner. Failure is reported, not thrown. */
export async function postResults(url: string, results: Results): Promise<string | null> {
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
