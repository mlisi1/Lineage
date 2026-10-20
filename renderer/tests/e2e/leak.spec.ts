import { expect, test } from "@playwright/test";
import type { ClockMessage } from "../../src/protocol";

/**
 * The scene runs for years: every sim-day it lays its plants out again and repaints its
 * grounds, and what the day before used must go. Fifteen days in the local view (pieces
 * painted round the camera, plant layers rebuilt, fades) must leave as many textures
 * alive on the GPU as one day does.
 */
test("a day's plants and grounds are let go when the next day comes", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?recording=autumn&every=0&still&quiet&view=local&x=60&y=60");
  const settled = (): Promise<unknown> =>
    page.waitForFunction(() => window.__sceneSettled?.() === true, null, { timeout: 60_000 });
  await settled();
  const nextDay = async (day: number): Promise<number> => {
    await page.evaluate((day) => {
      const base: ClockMessage = {
        type: "clock",
        protocol: 1,
        t_ms: 86_400_000 * (600 + day),
        date: "2027-10-01",
        season: "autumn",
        season_progress: Math.min(0.1 + day / 91, 0.99),
        day_of_year: 274 + day,
        days_in_year: 365,
      };
      window.__receive?.(base);
    }, day);
    // Let it notice the day, lay it out and paint it.
    await page
      .waitForFunction(() => window.__sceneSettled?.() === false, null, { timeout: 5_000 })
      .catch(() => {});
    await settled();
    return page.evaluate(() => window.__textures?.() ?? -1);
  };
  const counts: number[] = [];
  for (let day = 1; day <= 15; day++) counts.push(await nextDay(day));
  expect(errors).toEqual([]);
  console.log(`textures day by day: ${counts.join(" ")}`);
  expect(counts[0]).toBeGreaterThan(0);
  // As many after fifteen days as after the first few (a texture or two either way, as
  // the turn brings a season's drawings in or takes them away).
  const early = Math.max(...counts.slice(0, 5));
  expect(Math.max(...counts.slice(-5))).toBeLessThanOrEqual(early + 4);
});
