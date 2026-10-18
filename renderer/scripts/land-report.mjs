/**
 * Write the land sheet as one self-contained HTML file.
 *
 *   npm run land     builds the pages, then writes ../reports/R1-land-sheet/
 *
 * Serves the built pages, opens land.html in headless Chromium, waits for every picture
 * and saves the page with each one as an inline image. Nothing moves on the sheet, so
 * the pictures are the same every run.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

const OUT = new URL("../../reports/R1-land-sheet/", import.meta.url);

const server = await preview({ logLevel: "silent" });
const browser = await chromium.launch();
try {
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("the preview server gave no address");
  const page = await browser.newPage({ viewport: { width: 2200, height: 1200 } });
  page.setDefaultTimeout(600_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${address}land.html`);
  // Wait for the sheet, and give up at once if the page fails before it can say so.
  let check;
  try {
    await Promise.race([
      page.waitForFunction(() => window.__landReady === true, null, { timeout: 600_000 }),
      new Promise((_, reject) => {
        check = globalThis.setInterval(() => {
          if (errors.length > 0) reject(new Error(`land.html: ${errors.join("; ")}`));
        }, 200);
      }),
    ]);
  } finally {
    globalThis.clearInterval(check);
  }
  const failure = await page.locator("#failure").textContent();
  if (failure) throw new Error(`land.html failed: ${failure}`);

  const html = await page.evaluate(() => window.__landStandalone());
  const world = await page.locator("#world").textContent();
  const build = await page.locator("#build").textContent();
  const pictures = await page.locator("canvas").count();
  const readme = [
    "# R1 land sheet",
    "",
    "How R1 draws the ground and the plants, in each look side by side (`maps`, the R0",
    "look, and `cosy`, the proposal after Stardew Valley): `report.html`, one",
    "self-contained file. A still copy of `renderer/land.html`",
    "(`cd renderer && npm run dev`, then open `/land.html`).",
    "",
    `- World: ${world}`,
    `- Renderer build: \`${build}\``,
    `- ${pictures} pictures`,
    "",
    "Regenerate with `cd renderer && npm run land`; do not edit by hand. It is a view of",
    "the look, not a measurement: nothing here is an acceptance criterion.",
    "",
  ].join("\n");
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL("report.html", OUT), html);
  await writeFile(new URL("README.md", OUT), readme);
  console.log(
    `wrote ${fileURLToPath(OUT)} (${pictures} pictures, ${(html.length / 1e6).toFixed(1)} MB)`,
  );
} finally {
  await browser.close();
  await server.close();
}
