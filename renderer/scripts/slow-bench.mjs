/**
 * The scene's benchmark on a PC with the page's CPU slowed to about the board's (R5, the
 * optimization plan): headless Chromium, the CPU throttled on every scenario's page (the
 * benchmark loads a page per scenario, and a throttle does not outlive a navigation).
 * At 20 times, the crowded middle view's script takes what it takes on the board.
 *
 *   npx vite --port 5391 &
 *   node scripts/slow-bench.mjs <scenarios> [throttle=20] [port=5391] [more query]
 *
 * Prints, per scenario: frame rate, frames late, the script's median and 99th percentile,
 * the longest frame, how long the view took to be ready, the frame probe's phases, and the
 * ground's paintings (their median times and each painting step's).
 */
import process from "node:process";
import { chromium } from "@playwright/test";

const [only, throttle = "20", port = "5391", extra = ""] = process.argv.slice(2);
if (only === undefined) {
  console.error("usage: node scripts/slow-bench.mjs <scenarios> [throttle] [port] [query]");
  process.exit(2);
}
const browser = await chromium.launch({
  args: ["--no-sandbox", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
const cdp = await page.context().newCDPSession(page);
const slow = () =>
  cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) }).catch(() => {});
page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) void slow();
});
page.on("load", () => void slow());
await page.goto(`http://localhost:${port}/index.html?bench&only=${only}&cap=30&seconds=20${extra}`);
await page.waitForFunction(() => window.__benchResults !== undefined, null, {
  timeout: 3_600_000,
  polling: 2000,
});
const results = await page.evaluate(() => window.__benchResults);
for (const s of results.scenarios) {
  const phases = Object.entries(s.probe?.phases_ms_median ?? {})
    .filter(([, ms]) => ms >= 0.5)
    .map(([phase, ms]) => `${phase} ${ms}`)
    .join(", ");
  console.log(
    `${s.name.padEnd(13)} fps ${s.fps_median.toFixed(1)} late ${s.over_budget_pct.toFixed(1)}%` +
      ` js ${s.js_ms_median.toFixed(1)}/${s.js_ms_p99.toFixed(1)} max ${s.frame_ms_max.toFixed(0)}` +
      ` ready ${s.ready_s.toFixed(1)}s | ${phases}`,
  );
  const ground = s.ground_timing;
  if (ground) {
    console.log(`   ground ${ground.pieces} pieces, median ${JSON.stringify(ground.median)}`);
    console.log(`   steps ${JSON.stringify(ground.steps_median)} compile ${ground.compile_ms}`);
  }
}
await browser.close();
