/**
 * R0 renderer spike: a representative Lineage scene in PixiJS and a benchmark of it.
 *
 *   spike.html                       run every scenario, show the results
 *   spike.html?seconds=5&only=a,b    shorter, or only some scenarios
 *   spike.html?demo=close-2x         run one scenario forever, to look at it
 *   spike.html?post=/results         also POST the results (the device runner listens)
 *
 * See docs/design/renderer.md for what is measured and why.
 */
import { describeRun, judge, runScenario, type Results } from "./bench";
import { parseFixture } from "./fixture";
import { parseParams } from "./params";
import { postResults, showResults } from "./report";
import { SpikeScene } from "./scene";
import { SCENARIOS, selectScenarios } from "./scenarios";

declare global {
  interface Window {
    /** Set when the benchmark has finished (the end-to-end test waits for it). */
    __spikeResults?: Results;
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`spike.html has no #${id}`);
  return found;
}

/** Run one scenario forever, showing the frame rate once a second. */
function demo(scene: SpikeScene, name: string, hud: HTMLElement): void {
  const scenario = SCENARIOS.find((candidate) => candidate.name === name);
  if (scenario === undefined) throw new Error(`unknown scenario: ${name}`);
  scene.apply(scenario);
  let last = -1;
  let frames = 0;
  let since = performance.now();
  const tick = (now: number): void => {
    scene.frame(last < 0 ? 0 : Math.min(now - last, 100) / 1000);
    last = now;
    frames += 1;
    if (now - since >= 1000) {
      hud.textContent = `${scenario.name} · ${((frames * 1000) / (now - since)).toFixed(0)} fps`;
      frames = 0;
      since = now;
    }
    requestAnimationFrame(tick);
  };
  hud.textContent = scenario.name;
  requestAnimationFrame(tick);
}

async function main(): Promise<void> {
  const params = parseParams(window.location.search);
  const hud = element("hud");
  hud.style.display = params.hud ? "block" : "none";
  hud.textContent = "loading…";

  let results = describeRun(params, null, { cells: [0, 0], plant_cells: 0, description: "" });
  try {
    const response = await fetch("spike/world.json");
    if (!response.ok) throw new Error(`spike/world.json: HTTP ${response.status}`);
    const fixture = parseFixture(await response.json());
    const scene = await SpikeScene.create(
      element("stage"),
      fixture,
      "spike",
      params.backend,
      params.seed,
    );
    if (params.demo !== null) {
      demo(scene, params.demo, hud);
      return;
    }
    const scenarios = selectScenarios(params.only);
    results = describeRun(params, scene.gpu(), {
      cells: [fixture.width, fixture.height],
      plant_cells: scene.plantCells,
      description: fixture.description,
    });
    for (const [index, scenario] of scenarios.entries()) {
      hud.textContent = `${index + 1}/${scenarios.length} ${scenario.name}`;
      results.scenarios.push(await runScenario(scene, scenario, params));
    }
    judge(results);
  } catch (error) {
    results.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }

  hud.style.display = "none";
  showResults(element("results"), results);
  if (params.postUrl !== null) {
    const failure = await postResults(params.postUrl, results);
    if (failure !== null) element("results").append(failure);
  }
  window.__spikeResults = results;
}

void main();
