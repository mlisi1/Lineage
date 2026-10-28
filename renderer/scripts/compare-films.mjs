/**
 * Film the same scenes from two servings of the page and compare them frame by frame
 * (R5, the plan for optimizing the renderer): a change claimed to leave the pixels as they
 * are must leave every frame byte for byte the same. Every scene has a fixed seed: without
 * one the page seeds itself from the clock and no two films match.
 *
 *   node scripts/compare-films.mjs http://localhost:5392 http://localhost:5391 [frames=90] [scene,...]
 *
 * Serve the commit before the change on one port (a `git worktree` of it, `npx vite
 * --port 5392`) and the change on the other. Prints, per scene, how many frames match, and
 * writes the first differing frame of each scene, before and after, to `compare-films/` in
 * the system's temporary folder. Exits 1 if any frame differs.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { chromium } from "@playwright/test";

/** Scenes that move: wind, fire, animals, the scroll, the card, the map. */
const SCENES = {
  "fire-middle": "view=middle&x=120&y=60&show=night,fire&seed=7",
  "fire-local": "view=local&x=120&y=60&show=night,fire&seed=7",
  pieces: "view=local&x=92&y=124&quiet&seed=1",
  follow: "seed=2&follow=60&quiet",
  captions: "view=middle&x=64&y=71&seed=1",
  map: "view=map&seed=1",
  rain: "view=middle&x=64&y=71&seed=3&show=storm",
  snow: "view=local&x=64&y=71&seed=1&season=winter:0.5",
};
/** Frames run before filming, each waiting for the ground: the start is the same moment. */
const LEAD_FRAMES = 40;

const [, , before, after, framesArg = "90", only = ""] = process.argv;
if (before === undefined || after === undefined) {
  console.error("usage: node scripts/compare-films.mjs <url before> <url after> [frames] [scenes]");
  process.exit(2);
}
const frames = Number(framesArg);
const wanted = only === "" ? Object.keys(SCENES) : only.split(",");
const out = path.join(os.tmpdir(), "compare-films");
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});

/** The frames of `query` served from `base`: their hashes, and a way to get one's picture. */
async function film(base, name, query) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
  await page.goto(`${base}/index.html?${query}&film`);
  await page.waitForFunction(() => typeof window.__frame === "function", null, {
    timeout: 120_000,
  });
  const settle = () =>
    page.waitForFunction(() => window.__painting?.() !== true, null, { timeout: 60_000 });
  const step = async () => {
    await settle();
    await page.evaluate(() => window.__frame?.(1 / 30));
  };
  for (let k = 0; k < LEAD_FRAMES; k++) await step();
  // Following an animal: the view button twice, then a few seconds for the card.
  if (name === "follow") {
    for (let press = 0; press < 2; press++) {
      await page.evaluate(() => window.__press?.());
      for (let k = 0; k < 150; k++) await step();
    }
  }
  const shots = [];
  for (let k = 0; k < frames; k++) {
    await step();
    await settle();
    shots.push(await page.screenshot({ type: "png" }));
  }
  await page.close();
  return shots;
}

let differing = 0;
for (const name of wanted) {
  const query = SCENES[name];
  if (query === undefined) throw new Error(`no scene ${name}`);
  const [a, b] = await Promise.all([film(before, name, query), film(after, name, query)]);
  const hash = (png) => crypto.createHash("sha1").update(png).digest("hex");
  let same = 0;
  let first = -1;
  for (let k = 0; k < frames; k++) {
    if (hash(a[k]) === hash(b[k])) same += 1;
    else if (first < 0) first = k;
  }
  if (first >= 0) {
    differing += 1;
    fs.writeFileSync(path.join(out, `${name}-${first}-before.png`), a[first]);
    fs.writeFileSync(path.join(out, `${name}-${first}-after.png`), b[first]);
  }
  console.log(
    `${name.padEnd(12)} ${same}/${frames} frames the same${first >= 0 ? `, first differs at ${first} (${out})` : ""}`,
  );
}
await browser.close();
process.exit(differing > 0 ? 1 : 0);
