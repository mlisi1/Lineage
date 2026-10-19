import { expect, test } from "@playwright/test";

/**
 * The fifteen specimen genomes as the renderer draws them (R2): each portrait in the
 * chosen style, before anyone has moved, compared with its baseline. A change of look
 * shows up here; update the baselines (`npx playwright test --update-snapshots`) only
 * when the change is meant, and say so in the commit.
 *
 * The pixels compared are the canvas's own, read from it, not a screenshot of the page:
 * a screenshot crops wherever the page's layout puts the canvas, and moved by a pixel
 * whenever a section above it changed height.
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
    const png = await row
      .locator("canvas")
      .nth(3)
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL("image/png"));
    const pixels = Buffer.from(png.slice(png.indexOf(",") + 1), "base64");
    // Pixel art: every pixel exactly.
    expect(pixels).toMatchSnapshot(`specimen-${name}.png`, { threshold: 0, maxDiffPixels: 0 });
  }
});
