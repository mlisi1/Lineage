import { expect, test, type Page } from "@playwright/test";

/**
 * The documentary camera (R3) in the page: the view button, the animal followed, and a
 * caption's scroll. The scroll's layout is a snapshot over a still view of the land.
 */

async function camera(page: Page) {
  return page.evaluate(() => window.__camera?.());
}

/** Press the view button and wait until the dip is over. */
async function press(page: Page): Promise<void> {
  await page.evaluate(() => window.__press?.());
  await page.waitForFunction(() => window.__camera?.().dipping === true);
  await page.waitForFunction(() => window.__camera?.().dipping === false, null, {
    timeout: 20_000,
  });
}

test("the view button steps map → middle → local → map, following an animal up close", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?seed=5");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  expect((await camera(page))?.view).toBe("map");

  await press(page);
  const middle = await camera(page);
  expect(middle?.view).toBe("middle");
  await page.waitForTimeout(2000);
  const drifted = await camera(page);
  // It drifts.
  expect(drifted?.centre).not.toEqual(middle?.centre);

  await press(page);
  const local = await camera(page);
  expect(local?.view).toBe("local");
  expect(local?.subject).not.toBeNull();
  expect(local?.motion).toBe("follow");

  await press(page);
  expect((await camera(page))?.view).toBe("map");
  expect(errors).toEqual([]);
});

test("in the local view a click goes on to another animal, a double click to the map", async ({
  page,
}) => {
  await page.goto("/?seed=5");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  const stage = page.getByTestId("stage");
  // A click is the button elsewhere: map, middle, local.
  for (const view of ["middle", "local"]) {
    await stage.click();
    await page.waitForFunction((wanted) => window.__camera?.().view === wanted, view);
    await page.waitForFunction(() => window.__camera?.().dipping === false, null, {
      timeout: 20_000,
    });
  }
  const first = (await camera(page))?.subject;
  await stage.click();
  await page.waitForFunction((was) => window.__camera?.().subject !== was, first);
  expect((await camera(page))?.view).toBe("local");
  await page.waitForFunction(() => window.__camera?.().dipping === false, null, {
    timeout: 20_000,
  });
  await stage.dblclick();
  await page.waitForFunction(() => window.__camera?.().view === "map", null, { timeout: 20_000 });
});

test("the scroll: a notable entry unrolls at the foot of the screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Quiet: the recording's own entries are not shown, only the one handed over here.
  await page.goto("/?recording=autumn&every=0&still&quiet&view=middle&x=60&y=60");
  await page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  await page.evaluate(() =>
    window.__receive?.({
      type: "chronicle",
      protocol: 1,
      notable_importance: 3,
      major_importance: 4,
      entries: [
        {
          number: 1000,
          t_ms: 0,
          kind: "crash",
          importance: 3,
          text: "Hard times for the Malesha: only 92 are left of 198.",
          species: 1,
          x: -1,
          y: -1,
        },
      ],
    }),
  );
  await page.waitForFunction(() => window.__captions?.().phase === "open");
  expect((await page.evaluate(() => window.__captions?.()))?.text).toContain("Malesha");
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("scroll.png", { maxDiffPixelRatio: 0.002 });
});
