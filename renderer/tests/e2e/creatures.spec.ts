import { expect, test } from "@playwright/test";

test("the creature sheet checks the phenotype and draws both styles", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/creatures.html?still=2");
  await page.waitForFunction(() => window.__lookReady === true, null, { timeout: 60_000 });
  expect(errors).toEqual([]);
  await expect(page.locator("#failure")).toBeHidden();

  // The port against the sim: fifteen specimens, and nothing beyond float rounding.
  await expect(page.locator("#phenotype tr")).toHaveCount(16);
  const worst = Number(await page.locator("#phenotype-worst").textContent());
  expect(worst).toBeLessThan(1e-5);

  // Every comparison has one picture per style.
  for (const id of ["local-meadow", "local-shore", "mid"]) {
    await expect(page.locator(`#${id} canvas`)).toHaveCount(2);
  }
  await expect(page.locator("#ticks canvas")).toHaveCount(1);
  for (const look of ["hue", "murk", "glass"]) {
    await expect(page.locator(`#underwater-${look} canvas`)).toHaveCount(32);
  }
  await expect(page.locator("#underwater-scene canvas")).toHaveCount(3);
  await expect(page.locator("#specimens .specimen")).toHaveCount(15);
  await expect(page.locator("#specimens canvas")).toHaveCount(60);
  await expect(page.locator("#patterns canvas")).toHaveCount(24);
  await expect(page.locator("#sweeps figure.tile")).toHaveCount(50);

  // The two styles draw the same animal differently.
  const [lit, cosy] = await page
    .locator("#local-meadow canvas")
    .evaluateAll((canvases) => canvases.map((c) => (c as HTMLCanvasElement).toDataURL()));
  expect(lit).not.toEqual(cosy);
});
