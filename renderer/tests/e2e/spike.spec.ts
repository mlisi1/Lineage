import { expect, test } from "@playwright/test";
import type { Results } from "../../src/spike/bench";

test("the spike benchmark runs scenarios and reports results", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/spike.html?seconds=0.5&warmup=0.2&only=floor,spec-2x,map-1x,close-2x");
  const handle = await page.waitForFunction(() => window.__spikeResults, null, { timeout: 30_000 });
  const results = (await handle.jsonValue()) as Results;

  expect(errors).toEqual([]);
  expect(results.error).toBeNull();
  expect(results.tool).toBe("lineage-renderer-spike");
  expect(results.gpu?.api).toBe("webgl");
  expect(`${results.gpu?.renderer}${results.gpu?.unmasked_renderer}`).not.toBe("");
  expect(results.world.cells).toEqual([256, 150]);
  expect(results.world.plant_cells).toBeGreaterThan(5000);

  expect(results.scenarios.map((scenario) => scenario.name)).toEqual([
    "floor",
    "spec-2x",
    "map-1x",
    "close-2x",
  ]);
  const [floor, spec, map, close] = results.scenarios;
  for (const scenario of results.scenarios) {
    expect(scenario.stalled).toBe(false);
    expect(scenario.frames).toBeGreaterThan(3);
    expect(scenario.fps_median).toBeGreaterThan(1);
    expect(scenario.fps_1pct_low).toBeLessThanOrEqual(scenario.fps_median + 1e-6);
    expect(scenario.ended_epoch_ms).toBeGreaterThan(scenario.started_epoch_ms);
  }
  expect(floor).toMatchObject({ internal: [1024, 600], plant_sprites: 0, creature_sprites: 0 });
  expect(spec?.internal).toEqual([512, 300]);
  expect(spec?.plant_sprites).toBe(results.world.plant_cells); // the wide shot draws them all
  expect(spec?.creature_sprites).toBeGreaterThan(50 * 6);
  expect(map?.plant_sprites).toBe(0); // plants come from the map bitmap
  // The close-up skips the chunks that are off screen.
  expect(close?.plant_sprites).toBeGreaterThan(0);
  expect(close?.plant_sprites).toBeLessThan(results.world.plant_cells / 4);
  // The views R0 is judged on were not among those run: no verdict.
  expect(results.acceptance).toMatchObject({ fps_median: null, pass: null });

  await expect(page.getByTestId("verdict")).toContainText("were not all run");
  await expect(page.getByTestId("drawn-by")).toContainText("Drawn by WebGL on ");
  await expect(page.locator("#results tr")).toHaveCount(5);
});

test("the canvas backend draws the scene and says so", async ({ page }) => {
  await page.goto("/spike.html?backend=canvas&seconds=0.4&warmup=0.2&only=floor,map-1x");
  const handle = await page.waitForFunction(() => window.__spikeResults, null, { timeout: 30_000 });
  const results = (await handle.jsonValue()) as Results;
  expect(results.error).toBeNull();
  expect(results.gpu).toMatchObject({ api: "canvas", software: true });
  expect(results.scenarios.map((scenario) => scenario.frames > 3)).toEqual([true, true]);
  await expect(page.getByTestId("drawn-by")).toContainText("Drawn by 2D canvas, on the CPU ·");
});

test("the three views of the chosen look run as scenarios", async ({ page }) => {
  await page.goto("/spike.html?seconds=0.5&warmup=0.2&only=map-view,mid-view,local-view");
  const handle = await page.waitForFunction(() => window.__spikeResults, null, { timeout: 30_000 });
  const results = (await handle.jsonValue()) as Results;
  expect(results.error).toBeNull();
  const [map, mid, local] = results.scenarios;
  for (const scenario of results.scenarios) {
    expect(scenario.stalled).toBe(false);
    expect(scenario.frames).toBeGreaterThan(3);
    // Art pixels of 2 screen pixels, and ground painted for the view.
    expect(scenario.internal).toEqual([512, 300]);
    expect(scenario.ground_paint_ms).toBeGreaterThan(0);
  }
  // On the map every creature is a dot of two squares and nothing grows as a sprite.
  expect(map).toMatchObject({ name: "map-view", plant_sprites: 0, creature_sprites: 2 * 216 });
  // In the middle view only some plants stand, far fewer than a sprite per cell would be.
  expect(mid?.name).toBe("mid-view");
  expect(mid?.plant_sprites).toBeGreaterThan(50);
  expect(mid?.plant_sprites).toBeLessThan(results.world.plant_cells / 8);
  expect(mid?.creature_sprites).toBeGreaterThan(50 * 15);
  // From close a creature has more to it: edges and feet on its legs, glints in its eyes.
  expect(local?.name).toBe("local-view");
  expect(local?.creature_sprites).toBeGreaterThan(mid?.creature_sprites ?? Infinity);
});

test("the spike gives a verdict when the views it is judged on run", async ({ page }) => {
  await page.goto("/spike.html?seconds=0.5&warmup=0.2&only=map-view,mid-view,mid-crowd,local-view");
  const handle = await page.waitForFunction(() => window.__spikeResults, null, { timeout: 30_000 });
  const results = (await handle.jsonValue()) as Results;
  expect(results.error).toBeNull();
  expect(results.acceptance.fps_median).toBeGreaterThan(0);
  expect(typeof results.acceptance.pass).toBe("boolean");
  await expect(page.getByTestId("verdict")).toContainText(/PASS|FAIL/);
});

test("demo mode keeps one scenario running at its internal resolution", async ({ page }) => {
  await page.goto("/spike.html?demo=close-2x");
  const canvas = page.getByTestId("spike-stage");
  await expect(canvas).toBeVisible();
  await expect(page.locator("#hud")).toContainText("close-2x");
  // Drawn at 512×300, shown over the whole 1024×600 viewport with hard pixels.
  expect(await canvas.evaluate((node: HTMLCanvasElement) => [node.width, node.height])).toEqual([
    512, 300,
  ]);
  const box = await canvas.boundingBox();
  expect([box?.width, box?.height]).toEqual([1024, 600]);
  expect(await canvas.evaluate((node) => getComputedStyle(node).imageRendering)).toBe("pixelated");
});

test("an unknown scenario is reported, not left hanging", async ({ page }) => {
  await page.goto("/spike.html?only=nope");
  const handle = await page.waitForFunction(() => window.__spikeResults, null, { timeout: 30_000 });
  const results = (await handle.jsonValue()) as Results;
  expect(results.error).toContain("unknown scenario: nope");
  await expect(page.getByTestId("verdict")).toContainText("Failed");
});
