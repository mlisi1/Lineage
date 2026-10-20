import { expect, test, type Page } from "@playwright/test";

/**
 * The atmosphere (R4): the light of each time of day, the glow pass, the weather of
 * events and the end of a world, as snapshots of fixed states. The light and events are
 * asked for (`?show=`, `atmosphere/demo.ts`) over the autumn recording's last day; with
 * `?still` the atmosphere moves only when the test moves it (`__advance`), so every
 * picture is the same every time. Regenerate with `npx playwright test --update-snapshots`
 * after a change to the look, and look at them first.
 */

async function open(page: Page, query: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/?recording=autumn&every=0&still&quiet&seed=7&${query}`);
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  return errors;
}

/** Move the atmosphere on by `seconds`, and wait for a frame to draw it. */
async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate((s) => window.__advance?.(s), seconds);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const SHOTS: Record<string, { query: string; advance?: number }> = {
  // The light of each time of day, on the map.
  "light-day": { query: "view=map&show=day" },
  "light-dusk": { query: "view=map&show=dusk" },
  "light-dawn": { query: "view=map&show=dawn" },
  "light-night": { query: "view=map&show=night" },
  "light-moon": { query: "view=map&show=moon" },
  // The weather of events, in the middle view.
  "fire-night": { query: "view=middle&x=120&y=60&show=night,fire", advance: 1.3 },
  "fire-local": { query: "view=local&x=120&y=60&show=night,fire", advance: 1.3 },
  rain: { query: "view=middle&x=120&y=60&show=day,rain", advance: 1 },
  volcano: { query: "view=middle&x=120&y=60&show=day,volcano", advance: 3 },
  meteor: { query: "view=middle&x=120&y=60&show=day,meteor", advance: 0.8 },
  ark: { query: "view=middle&x=120&y=60&show=dusk,ark", advance: 2 },
  seed: { query: "view=middle&x=120&y=60&show=night,seed", advance: 2 },
  // The end of a world: the fire, the flood, and the land rising again.
  "end-fire": { query: "view=map&show=day,end", advance: 45 },
  "end-flood": { query: "view=map&show=day,end", advance: 85 },
  "end-rise": { query: "view=map&show=day,end", advance: 170 },
};

for (const [name, shot] of Object.entries(SHOTS)) {
  test(`the atmosphere: ${name}`, async ({ page }) => {
    const errors = await open(page, shot.query);
    if (shot.advance !== undefined) await advance(page, shot.advance);
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.002 });
  });
}

test("the light comes from the stream: the office recording ends in the dark", async ({ page }) => {
  // All of it at once: the last sky is midnight after two weeks of office hours.
  await page.goto("/?recording=office&every=0&still&quiet&view=map");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const state = await page.evaluate(() => window.__atmosphere?.());
  // Dark: night, or the moonlight floor of a long absence (it is 0.15 there).
  expect(state?.light).toBeLessThanOrEqual(0.15 + 1e-6);
  // Moonlit blue: more blue than red.
  const tint = state?.tint ?? 0;
  expect(tint & 0xff).toBeGreaterThan(tint >> 16);
});

test("an animal with the glow gene shines at night, not by day", async ({ page }) => {
  await page.goto("/?recording=office&every=0&still&quiet&seed=7&view=local&x=120&y=60&show=night");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const glowing = await page.evaluate(() => {
    // The fixture's world has no glowing animal: one is sent as the stream would.
    const genome = Array.from({ length: 32 }, () => 0.5);
    window.__receive?.({
      type: "creatures",
      protocol: 1,
      t_ms: 0,
      ids: [900001],
      positions: [[120, 60]],
      species: [1],
      born: [{ id: 900001, genome, slots: 128 }],
      torpid: [],
    });
    return true;
  });
  expect(glowing).toBe(true);
  await advance(page, 0.1);
  const night = await page.evaluate(() => window.__atmosphere?.().lights ?? 0);
  expect(night).toBeGreaterThan(0);
  await expect(page).toHaveScreenshot("glow-night.png", { maxDiffPixelRatio: 0.002 });
  await page.evaluate(() =>
    window.__receive?.({
      type: "sky",
      protocol: 1,
      t_ms: 1,
      light: 1,
      present: true,
      raining: false,
      burning: [],
    }),
  );
  await advance(page, 0.1);
  expect(await page.evaluate(() => window.__atmosphere?.().lights ?? -1)).toBe(0);
});

test("a world ends on the map, the button waits, and the next world rises", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A sim-day in under five seconds: the herd starves at the start of the second.
  await page.goto("/?recording=end&speed=20000&seed=3");
  await page.waitForFunction(() => typeof window.__atmosphere?.().act === "string", null, {
    timeout: 60_000,
  });
  expect(await page.evaluate(() => window.__camera?.().view)).toBe("map");
  // The world's last lines are told as it ends.
  await page.waitForFunction(() => window.__captions?.().text !== null, null, { timeout: 10_000 });
  expect(await page.evaluate(() => window.__captions?.().text)).toContain("last creature");
  // The button does nothing while the world ends.
  await page.evaluate(() => window.__press?.());
  await advance(page, 1);
  expect(await page.evaluate(() => window.__camera?.().view)).toBe("map");
  await advance(page, 124);
  expect(await page.evaluate(() => window.__atmosphere?.().act)).toBe("dark");
  await advance(page, 60);
  expect(await page.evaluate(() => window.__atmosphere?.().act)).toBeNull();
  // And then it works again.
  await page.evaluate(() => window.__press?.());
  await page.waitForFunction(() => window.__camera?.().view === "middle", null, {
    timeout: 10_000,
  });
  expect(errors).toEqual([]);
});
