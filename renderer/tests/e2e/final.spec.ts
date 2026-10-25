import { expect, test, type Page } from "@playwright/test";

/**
 * The final look of R5 (ADR 0022): stills of what R5 drew, staged by hand as the report's
 * films are (`scripts/final-report.mjs`), on the scene's own clock (`?film`), so two runs
 * draw the same frame. The creatures' recording; ids 2048 (a large lizard), 2075, 2113,
 * 2184 and 2220 live in it, and (64, 71) is open grass. Regenerate with
 * `npx playwright test --update-snapshots` after a change to the look, and look at them first.
 */

interface Shot {
  query: string;
  /** Put animals where they are to be seen, after the scene has run two seconds. */
  stage?: string;
  /** What they do once there, half a second later. */
  then?: string;
  /** Presses of the view button (map → middle → local), five seconds apart. */
  presses?: number;
  /** Seconds the scene runs on before the still. */
  seconds: number;
  /** The middle of the screen enlarged by this much (what the report's films crop to). */
  crop?: number;
}

const GRASS = "view=local&x=64&y=71&quiet&seed=1";
const put = (id: number, x: number, y: number, heading = 0): string =>
  `window.__pin?.(${id}, ${x}, ${y}, ${heading}); window.__send?.(${id}, ${x}, ${y});`;

const SHOTS: Record<string, Shot> = {
  // The animal followed, with its field-guide card in the corner.
  follow: { query: "seed=2&follow=60&quiet", presses: 2, seconds: 2 },
  // Bushes in pieces, three animals of three sizes among them.
  pieces: {
    query: "view=local&x=92&y=124&quiet&seed=1",
    stage: `[2048, 2184, 2220].forEach((id, k) => window.__pin?.(id, 89.6, 123.3 + k * 0.5, 0));
      [2048, 2184, 2220].forEach((id, k) => window.__send?.(id, 93.6, 123.3 + k * 0.5));`,
    seconds: 3,
    crop: 2,
  },
  eating: {
    query: GRASS,
    stage: `${put(2048, 63.4, 71)} window.__feed?.(2048, "plants");
      ${put(2184, 65.6, 71.3, Math.PI)} window.__feed?.(2184, "meat");`,
    seconds: 2,
    crop: 2,
  },
  hunt: {
    query: GRASS,
    stage: `${put(2184, 66.2, 71.3, 2.8)} ${put(2048, 62.3, 70.8)}`,
    then: "window.__hunt?.(2048, 2184)",
    seconds: 1.5,
    crop: 2,
  },
  egg: {
    query: GRASS,
    stage: put(2048, 63.4, 71),
    then: "window.__birth?.(2048, 2220, true)",
    seconds: 1,
    crop: 2,
  },
  court: {
    query: GRASS,
    stage: `${put(2075, 63.4, 71)} ${put(2113, 64.4, 71.9, 3.6)}
      window.__pin?.(2184, 70, 75, 0); window.__pin?.(2196, 70, 76, 0);`,
    then: "window.__birth?.(2075, 2184, false); window.__birth?.(2075, 2196, false);",
    seconds: 2.5,
    crop: 2,
  },
  sleep: { query: `${GRASS}&show=night`, stage: put(2048, 64, 71), seconds: 4, crop: 2 },
  bask: {
    query: `${GRASS}&show=day`,
    stage: `window.__grant?.(2048, "leaves"); ${put(2048, 64, 71)}`,
    seconds: 4,
    crop: 2,
  },
  venom: {
    query: `${GRASS}&show=day`,
    stage: `window.__grant?.(2048, "venom"); ${put(2184, 66.2, 71.3, 2.8)} ${put(2048, 62.3, 70.8)}`,
    then: "window.__hunt?.(2048, 2184)",
    seconds: 1.5,
    crop: 2,
  },
  wake: {
    query: "view=local&x=183&y=10&quiet&seed=1&show=day",
    stage: `window.__grant?.(2048, "gills"); window.__pin?.(2048, 179, 10, 0); window.__send?.(2048, 187, 10.5);`,
    seconds: 3,
    crop: 2,
  },
  huddle: {
    query: `${GRASS}&show=storm`,
    stage: `${put(2048, 61, 71)} ${put(2184, 67, 71.3, Math.PI)}`,
    then: "window.__send?.(2048, 67, 71); window.__send?.(2184, 61, 71.3);",
    seconds: 2,
    crop: 2,
  },
  leaves: {
    query: "view=local&x=234&y=97&quiet&seed=1&season=autumn:0.9&show=day",
    seconds: 4,
  },
  storm: { query: "view=local&x=52&y=97&quiet&seed=1&show=storm", seconds: 2, crop: 2 },
};

/** Move the scene on `seconds` a frame at a time, waiting for the ground to be painted. */
async function run(page: Page, seconds: number): Promise<void> {
  const frames = Math.round(seconds * 30);
  for (let k = 0; k < frames; k++) {
    await page.evaluate(() => window.__frame?.(1 / 30));
    await page.waitForFunction(() => window.__painting?.() !== true, null, { timeout: 30_000 });
  }
}

for (const [name, shot] of Object.entries(SHOTS)) {
  test(`the final look: ${name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`/?${shot.query}&film`);
    await page.waitForFunction(() => typeof window.__frame === "function", null, {
      timeout: 60_000,
    });
    // A fixed number of frames whatever the machine's speed, each waiting for the painting,
    // so that every run starts from the same moment.
    for (let k = 0; k < 40; k++) {
      await page.waitForFunction(() => window.__painting?.() !== true, null, { timeout: 30_000 });
      await page.evaluate(() => window.__frame?.(1 / 30));
    }
    await page.waitForFunction(() => window.__painting?.() !== true, null, { timeout: 30_000 });
    if (shot.stage !== undefined) {
      await run(page, 2);
      await page.evaluate(shot.stage);
    }
    if (shot.then !== undefined) {
      await run(page, 0.5);
      await page.evaluate(shot.then);
    }
    for (let press = 0; press < (shot.presses ?? 0); press++) {
      await page.evaluate(() => window.__press?.());
      await run(page, 5);
    }
    await run(page, shot.seconds);
    expect(errors).toEqual([]);
    const crop = shot.crop ?? 1;
    const width = 1024 / crop;
    const height = 600 / crop;
    await expect(page).toHaveScreenshot(`${name}.png`, {
      maxDiffPixelRatio: 0.002,
      clip: { x: (1024 - width) / 2, y: (600 - height) / 2, width, height },
    });
  });
}
