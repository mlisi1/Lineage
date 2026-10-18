import { expect, test } from "@playwright/test";

/**
 * The scene from the committed recording (`public/stream/recording.json`, its last day:
 * 28 September, the autumn turn half done), in each view at fixed places: snapshots of
 * fixed states. Regenerate with `npx playwright test --update-snapshots` after a change
 * to the look, and look at them first.
 */
const SHOTS = {
  map: "view=map",
  "middle-wood": "view=middle&x=60&y=60",
  "middle-shore": "view=middle&x=40&y=40",
  "local-meadow": "view=local&x=60&y=60",
  "local-shore": "view=local&x=26&y=47",
} as const;

for (const [name, query] of Object.entries(SHOTS)) {
  test(`the scene: ${name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?every=0&${query}`);
    await page.waitForFunction(() => window.__sceneSettled?.() === true, null, {
      timeout: 60_000,
    });
    expect(errors).toEqual([]);
    await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.002 });
  });
}

test("the scene plays the recording day by day and fades each day in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?every=150&view=middle&x=60&y=60");
  // While days come in, the scene is never settled for long; once they stop, it settles.
  await page.waitForFunction(() => window.__sceneSettled?.() === false, null, { timeout: 20_000 });
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  expect(errors).toEqual([]);
});
