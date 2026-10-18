import { expect, test } from "@playwright/test";

/**
 * The fifteen specimen genomes as the renderer draws them (R2): each portrait in the
 * chosen style, before anyone has moved, compared with its baseline. A change of look
 * shows up here; update the baselines (`npx playwright test --update-snapshots`) only
 * when the change is meant, and say so in the commit.
 */
test("the fifteen specimens look as they did", async ({ page }) => {
  await page.goto("/creatures.html?still=0");
  await page.waitForFunction(() => window.__lookReady === true, null, { timeout: 60_000 });
  const rows = page.locator("#specimens .specimen");
  await expect(rows).toHaveCount(15);
  for (let index = 0; index < 15; index++) {
    const row = rows.nth(index);
    const name = (await row.locator("figcaption b").first().textContent()) ?? `${index}`;
    // Patch lit, patch cosy, portrait lit, portrait cosy.
    // Pixel art: every pixel exactly (the default tolerance lets a whole tint through).
    await expect(row.locator("canvas").nth(3)).toHaveScreenshot(`specimen-${name}.png`, {
      threshold: 0,
      maxDiffPixels: 0,
    });
  }
});
