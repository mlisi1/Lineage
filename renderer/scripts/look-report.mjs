/**
 * Write a sheet as one self-contained HTML file.
 *
 *   npm run look         builds the pages, then writes ../reports/R0-look-sheet/
 *   npm run creatures    the same for the creature sheet: ../reports/R2-creature-sheet/
 *
 * Serves the built pages, opens look.html in headless Chromium, lets the creatures walk
 * for a fixed time (seeded, in fixed steps: the same pictures every run), and saves the
 * page with every picture as an inline image.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";

/** How long the creatures walk before the pictures are taken. */
const WALK_SECONDS = 8;
/** The loops of the pictures with animals in them. */
const FILM = { seconds: 6, fps: 10 };
/** The sheets: the page, where its report goes, and what the README says it is. */
const SHEETS = {
  look: {
    page: "look.html",
    out: "R0-look-sheet",
    title: "R0 look sheet",
    about: [
      "How the renderer spike draws terrain, plants and creatures: `report.html`, one",
      "self-contained file. A still copy of `renderer/look.html`, which is the same sheet",
      "with the creatures walking (`cd renderer && npm run dev`, then open `/look.html`).",
    ],
    command: "npm run look",
  },
  creatures: {
    page: "creatures.html",
    out: "R2-creature-sheet",
    title: "R2 creature sheet",
    about: [
      "How the renderer draws animals (R2): the phenotype port against the sim, and the",
      "styles to choose between side by side: `report.html`, one self-contained file. A still",
      "copy of `renderer/creatures.html` (`cd renderer && npm run dev`, then `/creatures.html`).",
    ],
    command: "npm run creatures",
  },
};
const sheet = SHEETS[argv[2] ?? "look"];
if (sheet === undefined) throw new Error(`no sheet "${argv[2]}"`);
const OUT = new URL(`../../reports/${sheet.out}/`, import.meta.url);

const server = await preview({ logLevel: "silent" });
const browser = await chromium.launch();
try {
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("the preview server gave no address");
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${address}${sheet.page}?still=${WALK_SECONDS}`);
  page.setDefaultTimeout(600_000);
  await page.waitForFunction(() => window.__lookReady === true, null, { timeout: 120_000 });
  const failure = await page.locator("#failure").textContent();
  if (failure) throw new Error(`${sheet.page} failed: ${failure}`);

  const html = await page.evaluate((film) => window.__lookStandalone(film), FILM);
  const world = await page.locator("#world").textContent();
  const build = await page.locator("#build").textContent();
  const pictures = await page.locator("canvas").count();
  const readme = [
    `# ${sheet.title}`,
    "",
    ...sheet.about,
    "",
    `- World: ${world}`,
    `- Renderer build: \`${build}\``,
    `- ${pictures} pictures, taken after the creatures have walked for ${WALK_SECONDS} s;`,
    `  those with animals in them are loops of ${FILM.seconds} s at ${FILM.fps} frames a second`,
    "  (animated PNG: they play in any browser, without a script)",
    "",
    `Regenerate with \`cd renderer && ${sheet.command}\`; do not edit by hand. It is a view of`,
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
