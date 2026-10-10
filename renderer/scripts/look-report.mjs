/**
 * Write the look sheet as one self-contained HTML file.
 *
 *   npm run look     builds the pages, then writes ../reports/R0-look-sheet/
 *
 * Serves the built pages, opens look.html in headless Chromium, lets the creatures walk
 * for a fixed time (seeded, in fixed steps: the same pictures every run), and saves the
 * page with every picture as an inline image.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

/** How long the creatures walk before the pictures are taken. */
const WALK_SECONDS = 8;
const OUT = new URL("../../reports/R0-look-sheet/", import.meta.url);

const server = await preview({ logLevel: "silent" });
const browser = await chromium.launch();
try {
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("the preview server gave no address");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${address}look.html?still=${WALK_SECONDS}`);
  await page.waitForFunction(() => window.__lookReady === true, null, { timeout: 120_000 });
  const failure = await page.locator("#failure").textContent();
  if (failure) throw new Error(`look.html failed: ${failure}`);

  const html = await page.evaluate(() => window.__lookStandalone());
  const world = await page.locator("#world").textContent();
  const build = await page.locator("#build").textContent();
  const pictures = await page.locator("canvas").count();
  const readme = [
    "# R0 look sheet",
    "",
    "How the renderer spike draws terrain, plants and creatures: `report.html`, one",
    "self-contained file. A still copy of `renderer/look.html`, which is the same sheet",
    "with the creatures walking (`cd renderer && npm run dev`, then open `/look.html`).",
    "",
    `- World: ${world}`,
    `- Renderer build: \`${build}\``,
    `- ${pictures} pictures, taken after the creatures have walked for ${WALK_SECONDS} s`,
    "",
    "Regenerate with `cd renderer && npm run look`; do not edit by hand. It is a view of",
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
