/**
 * Write the R5 report (the final rendering pass) as one self-contained HTML file.
 *
 *   npm run final   builds the renderer as it is and as it was when R5 began, films the
 *                   same places in both, then writes ../reports/R5-final/
 *
 * 1. "Before" is the renderer at `R5_REPORT_BEFORE` (default: the commit R5 branched from),
 *    checked out in a temporary worktree; "after" is this checkout. Each is built and
 *    served on its own, with its own recordings.
 * 2. Both are filmed in headless Chromium at the screen's own size, 1024×600: stills at the
 *    same places with the same camera seeds, and films that follow an animal (the view
 *    button pressed twice, as on the desk). Stills and posters go inline at the art
 *    pixels' size; films are VP9 beside the report (`films/`, small: committed).
 * 3. The species' colours are read from the page as drawn (`window.__colours`).
 *
 * Films are caught frame by frame on the scene's own clock (`?film`), so two runs draw the
 * same frames.
 */
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";
import { decodePng, pngIndexed as png, shrink } from "./apng.mjs";

const OUT = new URL("../../reports/R5-final/", import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERER = fileURLToPath(new URL("../", import.meta.url));
const FILMS = fileURLToPath(new URL("films/", OUT));
/** The commit R5 branched from: the scene before any of R5. */
const BEFORE = env.R5_REPORT_BEFORE ?? "80e4a4c";
/** The desk's screen (CLAUDE.md §2). */
const WIDTH = 1024;
const HEIGHT = 600;
const FPS = 30;

/** Stills: the same place in both, as `?query` has it (cells for `x`, `y`). */
const STILLS = {
  map: "view=map&quiet",
  middle: "view=middle&x=170&y=40&quiet",
  summit: "view=middle&quiet",
  grass: "view=local&seed=3&quiet",
  coast: "view=local&x=60&y=40&quiet",
  winter: "view=middle&recording=winter&every=0&quiet",
  shore: "view=local&x=244&y=110&quiet",
};
/** Films: following an animal from the camera's seed, for `seconds` after two presses. */
const FOLLOWS = {
  follow9: { query: "seed=9&follow=60&quiet", seconds: 6 },
  follow4: { query: "seed=4&follow=60&quiet", seconds: 6 },
  // A lizard followed close: its legs and how its body bends as it turns.
  follow2: { query: "seed=2&follow=60&quiet", seconds: 8 },
  // Pinned (no presses): land animals swimming out off the north coast at the start.
  water: { query: "view=local&x=183&y=11&quiet", seconds: 8, presses: 0 },
  // Deaths in the creatures' recording, at the place each animal was last seen: the
  // scene is run on to a little before (a sim-hour is two seconds of film at its speed).
  starved: { query: "view=local&x=162&y=15&quiet", seconds: 10, presses: 0, crop: 2, advance: 12 },
  drowned: { query: "view=local&x=190&y=14&quiet", seconds: 10, presses: 0, crop: 2, advance: 16 },
  oldAge: { query: "view=local&x=217&y=97&quiet", seconds: 10, presses: 0, crop: 2, advance: 120 },
  killed: { query: "view=local&x=66&y=105&quiet", seconds: 10, presses: 0, crop: 2, advance: 540 },
  // Animals of five sizes living among bushes, from the largest to the smallest, the
  // middle of the screen enlarged twice (the camera keeps the animal followed there).
  bush2: { query: "seed=2&follow=60&quiet", seconds: 12, crop: 2 },
  bush21: { query: "seed=21&follow=60&quiet", seconds: 12, crop: 2 },
  bush10: { query: "seed=10&follow=60&quiet", seconds: 12, crop: 2 },
  bush32: { query: "seed=32&follow=60&quiet", seconds: 12, crop: 2 },
  bush15: { query: "seed=15&follow=60&quiet", seconds: 12, crop: 2 },
};
/** Seconds the scene moves on a frame while it is run on to a film's start. */
const ADVANCE_STEP_S = 0.25;
/** Where the name card stands (R5), in art pixels of a still: the top-left corner. */
const CARD_CORNER = [0, 0, 200, 44];
/** Close-ups, in art pixels of a still (512×300): x, y, wide, tall. */
const ZOOMS = {
  map: [320, 40, 110, 80],
  grass: [190, 15, 200, 150],
  coast: [300, 75, 100, 65],
};

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/** Where the young of the creatures' recording stand thickest at its start (cells). */
function youngPlace() {
  const recording = JSON.parse(
    readFileSync(new URL("../public/stream/life.json", import.meta.url), "utf8"),
  );
  const first = recording.messages.find((m) => m.type === "creatures" && (m.young ?? []).length);
  if (first === undefined) return null;
  const at = new Map(first.ids.map((id, i) => [id, first.positions[i]]));
  const young = first.young.map(([id]) => at.get(id)).filter(Boolean);
  let best = null;
  let most = 0;
  for (const [x, y] of young) {
    const near = young.filter(([u, v]) => (u - x) ** 2 + (v - y) ** 2 < 36).length;
    if (near > most) [best, most] = [[Math.round(x), Math.round(y)], near];
  }
  return best;
}

/** Open the scene at `query` in film mode and step it until its ground is painted. */
async function open(page, address, query) {
  await page.goto(`${address}?${query}&film`);
  await page.waitForFunction(() => typeof window.__frame === "function", null, {
    timeout: 120_000,
  });
  for (let tries = 0; tries < 2000; tries++) {
    const settled = await page.evaluate(() => {
      window.__frame?.(window.__painting?.() === false ? 1 / 30 : 0);
      return window.__sceneSettled?.() === true;
    });
    if (settled) return;
    await page.waitForTimeout(25);
  }
  throw new Error(`the scene never settled: ${query}`);
}

/** Move the scene on one frame, wait for any painting, and screenshot the whole screen. */
async function frame(page, seconds = 1 / FPS) {
  await page.evaluate((s) => window.__frame?.(s), seconds);
  for (let tries = 0; tries < 400; tries++) {
    if (!(await page.evaluate(() => window.__painting?.() === true))) break;
    await page.waitForTimeout(10);
  }
  return page.screenshot({ type: "png" });
}

/** Run the scene on `seconds`, a frame at a time, without filming it. */
async function skip(page, seconds) {
  for (let done = 0; done < seconds; done += 1) {
    await page.evaluate(
      ([frames, step]) => {
        for (let k = 0; k < frames; k++) window.__frame?.(step);
      },
      [FPS, 1 / FPS],
    );
    for (let tries = 0; tries < 400; tries++) {
      if (!(await page.evaluate(() => window.__painting?.() === true))) break;
      await page.waitForTimeout(10);
    }
  }
}

/** A still a few seconds in, at the art pixels' size. */
async function still(page, address, query) {
  await open(page, address, query);
  await skip(page, 2);
  return shrink(decodePng(await frame(page, 0)), 2);
}

/** Press the view button twice (map → middle → local) and film `seconds` of the follow. */
async function follow(page, address, name, { query, seconds, presses = 2, crop = 1, advance = 0 }) {
  await open(page, address, query);
  // Run the scene on to just before what the film is for, a quarter of a second a frame.
  for (let done = 0; done < advance; done += ADVANCE_STEP_S * 40) {
    await page.evaluate((step) => {
      for (let k = 0; k < 40; k++) window.__frame?.(step);
    }, ADVANCE_STEP_S);
    for (let tries = 0; tries < 400; tries++) {
      if (!(await page.evaluate(() => window.__painting?.() === true))) break;
      await page.waitForTimeout(10);
    }
  }
  for (let press = 0; press < presses; press++) {
    await page.evaluate(() => window.__press?.());
    await skip(page, 5);
  }
  mkdirSync(FILMS, { recursive: true });
  const file = `${name}.webm`;
  const encoder = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png",
     "-i", "-", ...cropTo(crop), "-c:v", "libvpx-vp9", "-pix_fmt", "yuv444p", "-crf", "16", "-b:v", "0",
     "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", join(FILMS, file)],
    { stdio: ["pipe", "ignore", "inherit"] },
  ); // prettier-ignore
  const done = new Promise((resolve, reject) => {
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  const frames = Math.round(seconds * FPS);
  let poster = null;
  let corner = null;
  for (let k = 0; k < frames; k++) {
    const shot = await frame(page);
    if (k === Math.floor(frames / 2)) {
      const whole = shrink(decodePng(shot), 2);
      corner = cropBox(whole, CARD_CORNER);
      // A cropped film's poster is the same middle of the screen.
      const [wide, tall] = [whole.width / crop, whole.height / crop];
      poster =
        crop > 1
          ? cropBox(whole, [(whole.width - wide) / 2, (whole.height - tall) / 2, wide, tall])
          : whole;
    }
    if (!encoder.stdin.write(shot))
      await new Promise((resolve) => encoder.stdin.once("drain", resolve));
  }
  encoder.stdin.end();
  await done;
  // The name card of the animal followed, where the page has one (R5), and its corner.
  const card = await page.evaluate(() => window.__card?.() ?? null);
  return { file, poster, frames, seconds, bytes: statSync(join(FILMS, file)).size, card, corner };
}

/** ffmpeg's filter for the middle `1 / crop` of the screen enlarged `crop` times, or none. */
function cropTo(crop) {
  if (crop <= 1) return [];
  return ["-vf", `crop=iw/${crop}:ih/${crop},scale=iw*${crop}:ih*${crop}:flags=neighbor`];
}

/** The box (x, y, wide, tall) of an image at the art pixels' size. */
function cropBox(image, [x0, y0, wide, tall]) {
  const rgb = Buffer.alloc(wide * tall * 3);
  for (let y = 0; y < tall; y++) {
    const from = ((y0 + y) * image.width + x0) * 3;
    image.rgb.copy(rgb, y * wide * 3, from, from + wide * 3);
  }
  return { width: wide, height: tall, rgb };
}

/** Build the renderer at `root` and serve it; its address and the server. */
async function serve(root, port) {
  await build({ root, logLevel: "silent" });
  const server = await preview({ root, logLevel: "silent", preview: { port, strictPort: false } });
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error(`no address for ${root}`);
  return { server, address };
}

// The renderer before R5, in a worktree of its own with this one's packages.
const beforeDir = mkdtempSync(join(tmpdir(), "lineage-r5-before-"));
git("worktree", "add", "--detach", beforeDir, BEFORE);
symlinkSync(join(RENDERER, "node_modules"), join(beforeDir, "renderer", "node_modules"));
rmSync(FILMS, { recursive: true, force: true });

const shots = { before: {}, after: {} };
const films = { before: {}, after: {} };
let colours = [];
const youngAt = youngPlace();
const browser = await chromium.launch();
const servers = [];
try {
  const sides = {
    before: await serve(join(beforeDir, "renderer"), 4311),
    after: await serve(RENDERER, 4312),
  };
  servers.push(sides.before.server, sides.after.server);
  for (const [side, { address }] of Object.entries(sides)) {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
      deviceScaleFactor: 1,
    });
    page.setDefaultTimeout(600_000);
    const stills = { ...STILLS };
    if (youngAt !== null) stills.young = `view=local&x=${youngAt[0]}&y=${youngAt[1]}&quiet`;
    for (const [name, query] of Object.entries(stills)) {
      shots[side][name] = await still(page, address, query);
      console.log(`${side}: ${name}`);
    }
    for (const [name, spec] of Object.entries(FOLLOWS)) {
      films[side][name] = await follow(page, address, `${name}-${side}`, spec);
      console.log(`${side}: ${name}`);
      if (side === "after" && name === "follow4") {
        colours = (await page.evaluate(() => window.__colours?.() ?? [])).sort(
          (a, b) => b.members - a.members,
        );
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
  for (const server of servers) await new Promise((resolve) => server.httpServer.close(resolve));
  git("worktree", "remove", "--force", beforeDir);
}

const uri = (image) => `data:image/png;base64,${Buffer.from(png(image)).toString("base64")}`;
const hex = (rgb) => `#${rgb.toString(16).padStart(6, "0")}`;
const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

/**
 * A still before and after, one over the other: the before left of the cut, the after
 * right of it, where the reader drags; `cut` (%) is where it starts, on what changed.
 */
function compare(name, caption, cut = 50) {
  const before = shots.before[name];
  const after = shots.after[name];
  if (before === undefined || after === undefined) return "";
  return `<figure>
<div class="compare" style="--cut:${cut}%"><img src="${uri(before)}" alt="${escape(caption)}, before"><img class="after" src="${uri(after)}" alt="${escape(caption)}, after"><span class="bar"></span><span class="tag l">Before</span><span class="tag r">After</span><input type="range" min="0" max="100" value="${cut}" aria-label="Compare before and after: ${escape(caption)}" id="cmp-${name}"></div>
<figcaption>${caption} <span class="meta">1024×600, shown at the art pixels' 512×300</span></figcaption>
</figure>`;
}

/** Close-ups of a still, before and after, side by side. */
function zoom(name, caption) {
  const box = ZOOMS[name];
  return `<div class="pair zoom">${["before", "after"]
    .map(
      (side) =>
        `<figure><img src="${uri(cropBox(shots[side][name], box))}" alt="${escape(caption)}, ${side}" width="${box[2]}" height="${box[3]}"><figcaption>${side === "before" ? "Before" : "After"}, close-up</figcaption></figure>`,
    )
    .join("")}</div>`;
}

/** A film before and after, side by side. */
function filmPair(name, captions) {
  return `<div class="pair">${["before", "after"]
    .map((side, k) => {
      const film = films[side][name];
      return `<figure><video src="films/${film.file}" poster="${uri(film.poster)}" autoplay loop muted playsinline controls aria-label="${escape(captions[k])}"></video><figcaption>${captions[k]} <span class="meta">${film.frames} frames at ${FPS} fps, ${(film.bytes / 1e6).toFixed(1)} MB, <code>films/${film.file}</code></span></figcaption></figure>`;
    })
    .join("")}</div>`;
}

const colourRows = colours
  .map(
    (row) =>
      `<tr><td>${escape(row.name || `#${row.id}`)}</td><td class="num">${row.members}</td><td><span class="swatch" style="background:${hex(row.body)}"></span><code>${hex(row.body)}</code></td><td><span class="swatch" style="background:${hex(row.mark)}"></span><code>${hex(row.mark)}</code></td></tr>`,
  )
  .join("\n");

const commit = git("rev-parse", "--short", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const before = git("rev-parse", "--short", BEFORE);
const date = git("log", "-1", "--format=%cs");
const youngShot =
  shots.after.young === undefined
    ? ""
    : compare(
        "young",
        `Where the young stand thickest at the recording's start, cell (${youngAt?.join(", ")}).`,
      );

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R5 — Final rendering pass</title>
<style>
/* One reading column: each change is a note, then before/after at full width. */
:root {
  --bg: #eef1ec; --panel: #ffffff; --ink: #1c2622; --muted: #56645d; --rule: #cfd8d1;
  --sea: #24529c; --leaf: #4f8a2b; --chip: #e1e9e2;
  --body: "Source Sans 3", "Segoe UI", system-ui, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #131a17; --panel: #1b2420; --ink: #e3ebe5; --muted: #9aaba2; --rule: #2e3a35;
    --sea: #8fb4ec; --leaf: #9fd36f; --chip: #24302b; color-scheme: dark; }
}
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.55 var(--body); }
main { max-width: 1100px; margin: 0 auto; padding: 40px max(16px, 3vw) 80px; display: grid; gap: 52px; }
header { display: grid; gap: 12px; }
.eyebrow, .label, th { font: 500 12px/1.2 var(--mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
h1, h2 { margin: 0; text-wrap: balance; }
h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.1; color: var(--sea); }
h2 { font-size: clamp(22px, 3vw, 28px); line-height: 1.2; }
p { margin: 0; max-width: 70ch; }
.lede { font-size: 19px; color: var(--muted); }
code { font: 14px var(--mono); background: var(--chip); padding: 1px 5px; border-radius: 3px; }
.meta { font: 12px var(--mono); color: var(--muted); }
nav ul { display: flex; flex-wrap: wrap; gap: 8px; padding: 0; margin: 0; list-style: none; }
nav a { font-weight: 600; color: var(--ink); text-decoration: none; background: var(--chip); padding: 3px 10px; border-radius: 3px; }
nav a:hover, nav a:focus-visible { background: var(--sea); color: var(--bg); }
section { display: grid; gap: 18px; }
.head { display: flex; align-items: baseline; gap: 14px; }
.n { font: 700 28px/1 var(--mono); color: var(--leaf); }
.notes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px 32px; }
.notes > div { display: grid; gap: 6px; min-width: 0; }
.ask { border-left: 3px solid var(--sea); padding-left: 14px; }
figure { margin: 0; display: grid; gap: 8px; min-width: 0; }
figcaption { font-size: 14px; color: var(--muted); }
.compare { position: relative; width: 100%; aspect-ratio: 1024 / 600; overflow: hidden; background: #24529c; cursor: ew-resize; user-select: none; }
.compare img { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; pointer-events: none; }
.compare .after { clip-path: inset(0 0 0 var(--cut, 50%)); }
.compare .bar { position: absolute; top: 0; bottom: 0; left: var(--cut, 50%); width: 2px; background: #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.35); pointer-events: none; }
.compare .tag { position: absolute; top: 10px; font: 500 12px/1 var(--mono); text-transform: uppercase; background: rgba(16,8,28,.72); color: #fff; padding: 5px 7px; pointer-events: none; }
.compare .tag.l { left: 10px; } .compare .tag.r { right: 10px; }
.compare input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; margin: 0; cursor: ew-resize; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pair video, .pair img { width: 100%; height: auto; display: block; image-rendering: pixelated; background: #24529c; }
@media (max-width: 640px) { .pair { grid-template-columns: 1fr; } }
.tablewrap { overflow-x: auto; }
table { border-collapse: collapse; font-size: 15px; }
th, td { text-align: left; padding: 6px 16px 6px 0; border-bottom: 1px solid var(--rule); }
td.num { font-variant-numeric: tabular-nums; text-align: right; }
.swatch { display: inline-block; width: 1.1em; height: 1.1em; vertical-align: -0.2em; margin-right: 6px; border: 1px solid rgba(0,0,0,.35); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 0; width: 100%; }
ul.open { margin: 0; padding-left: 20px; display: grid; gap: 4px; max-width: 72ch; }
</style>
</head>
<body>
<main>
<header>
<span class="eyebrow">Lineage · R5 final rendering pass</span>
<h1>R5 — Final rendering pass</h1>
<p class="lede">What R5 has changed in the scene so far, against the scene as it was when R5 began. Same places, same recordings, same camera seeds. Each still shows the scene before R5 left of the line and after it right of the line; drag the line to compare. Films play side by side.</p>
<p class="meta">branch ${escape(branch)} at ${commit} · before ${before} · ${date} · 1024×600 · films ${FPS} fps on the scene's own clock</p>
<nav><ul>
<li><a href="#follow">1 Animal followed</a></li><li><a href="#colours">2 Colours</a></li><li><a href="#dots">3 Map dots</a></li><li><a href="#ground">4 Ground</a></li><li><a href="#grass">5 Grass</a></li><li><a href="#snow">6 Snow</a></li><li><a href="#young">7 Young</a></li><li><a href="#shore">Plants on water</a></li><li><a href="#water">Animals in water</a></li><li><a href="#bodies">Legs and bodies</a></li><li><a href="#bushes">Trees and bushes</a></li><li><a href="#card">Name card</a></li><li><a href="#deaths">Deaths</a></li><li><a href="#open">Open</a></li>
</ul></nav>
</header>

<section id="follow">
<div class="head"><span class="n">1</span><h2>The animal followed shows through the grass</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>A small animal in the local view vanished under the grass tufts drawn in front of it; only trees and bushes went see-through.</p></div>
<div><span class="label">Now</span><p>Grass and the small things in front of the animal followed go see-through too, a little less than trees (40 % against 30 % opacity). Pebbles are left alone. By the owner's choice there is no minimum size.</p><p>Round 2, after the owner saw a tuft pop as an animal walked through it: "in front" is now judged by the same rows the animal is drawn in (its lowest point), not by the bottom of its box, so no tuft covers it whole any more; and plants ease to see-through and back over a quarter of a second instead of in one frame.</p></div>
</div>
${filmPair("follow9", ["Before", "After"])}
</section>
<hr>

<section id="colours">
<div class="head"><span class="n">2</span><h2>Colours straight from the genes</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Colour was each animal's own HUE at one saturation and lightness. Sister species differ by a few hundredths in every gene: in the creatures' recording eight of ten species have HUE between 0.92 and 0.97, so nearly every animal was red or magenta.</p></div>
<div><span class="label">Now</span><p>Six genes set two colours (<code>src/creatures/colours.ts</code>), each read by its species' rank among the species alive, spread evenly over its range. The order is still the genes': the redder species stays further round the wheel. Each animal moves a little from its species by its own genes. Read again when a species appears or dies out, when every animal is redrawn.</p><p>Round 2 (the owner: "avoid olive"): body hues keep off the ground's yellow-greens (0.11–0.42 of the wheel), markings that fall there go to its nearer edge, and saturation starts at 0.5 instead of 0.32.</p></div>
</div>
<div class="tablewrap"><table>
<thead><tr><th>Colour</th><th>Hue</th><th>Saturation</th><th>Lightness</th></tr></thead>
<tbody>
<tr><td>Body</td><td><code>HUE</code></td><td><code>AQUATIC</code> (water ones vivid)</td><td><code>SIZE</code> (small light, big deep)</td></tr>
<tr><td>Markings</td><td><code>SOCIAL</code> (how far from the body's hue)</td><td><code>DIET</code> (hunters vivid)</td><td><code>EXPLORATION</code> (bold pale, shy dark)</td></tr>
</tbody></table></div>
<div class="tablewrap"><table>
<thead><tr><th>Species</th><th>Alive</th><th>Body</th><th>Markings</th></tr></thead>
<tbody>
${colourRows}
</tbody></table></div>
<p class="meta">The species of the creatures' recording as drawn, read from the page (<code>window.__colours</code>). PATTERN still picks the shape of the markings; the warning-colour rare gene still overrides.</p>
${compare("middle", "Middle view over the herd in the north-east, cell (170, 40).")}
${filmPair("follow4", ["Local view before", "Local view after: species apart, and the young (7)"])}
</section>
<hr>

<section id="dots">
<div class="head"><span class="n">3</span><h2>Round dots on the map</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Every animal was a square grown with its mass; the heaviest were big blocks.</p></div>
<div><span class="label">Now</span><p>Round dots of whole pixels with a dark edge, in three sizes by mass, in the body's colour (<code>src/creatures/markers.ts</code>). Swimmers get a ring round a dark middle, and the young the smallest dot.</p></div>
</div>
${compare("map", "The whole island.")}
${zoom("map", "The herd in the north-east")}
</section>
<hr>

<section id="ground">
<div class="head"><span class="n">4</span><h2>A calmer ground</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>The middle view painted each cell's cover alone: a busy patchwork. In the local view, borders between kinds followed the blend's straight steps, and grass met bare soil with a hard edge while other borders were dithered.</p></div>
<div><span class="label">Now</span><p>The middle view reads cover over the cells around each one, as the local view did, so it lies in patches. Borders wander with noise. Growth beside bare ground has a lip lit from the upper left: one pixel darker on its lower edge, one lighter on its upper.</p></div>
</div>
${compare("coast", "Local view at cell (60, 40).")}
${zoom("coast", "A patch of grass on bare soil")}
</section>
<hr>

<section id="grass">
<div class="head"><span class="n">5</span><h2>Grass as a texture of small tufts</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Three drawings of one symmetric fan, three quarters of a cell across, a dark outline round every blade, one to four to a cell: each read as a shrub standing on the grass.</p></div>
<div><span class="label">Now</span><p>Round 3, after references: grass in pixel art is a texture of small tufts, not things standing on it. A tuft is now about a third of a cell (12×8 art pixels), unoutlined: three to five spikes fanning out in a V from a narrow foot, darkest at the foot and brightest at the tips. Three shapes (a W, a fuller clump of two, spikes bent by the wind), each also mirrored; three to six to a cell by biomass, in clumps that cross cell borders, with gaps where the grass is thin.</p><p>Round 4, the owner: several sizes and some random change in colour. Nine drawings from 0.6 to 1.45 times the size, a large tuft growing wider (more spikes) rather than taller; each tuft takes one of five tints at random: none, warmer, cooler, darker, warmer and darker.</p></div>
</div>
${compare("grass", "Local view over upland grassland.")}
${zoom("grass", "Tufts")}
<p class="meta">References: the grass of <em>The Legend of Zelda: The Minish Cap</em> as discussed in <a href="https://itch.io/t/2758242/pixel-tutorial-zelda-style-mockup-part-1-grass">imonk, "Zelda style mockup, part 1: grass"</a>; <a href="https://itch.io/t/2197445/pixel-tutorial-grass-patches">"Pixel tutorial: grass patches"</a>; <a href="https://slynyrd.com/blog/2019/8/27/pixelblog-20-top-down-tiles">Slynyrd, Pixelblog 20: top-down tiles</a>.</p>
</section>
<hr>

<section id="snow">
<div class="head"><span class="n">6</span><h2>Snow only where the simulation has it</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>The renderer kept a snow line of its own, so a bare summit wore a white cap in August among green grass.</p></div>
<div><span class="label">Now</span><p>Bare heights are rock. Snow lies where the simulation puts it, by season and height. The fixed line stays only for a land without the simulation's snow (the R0 fixture).</p></div>
</div>
${compare("summit", "The island's middle in August: drag to the right to see the old snow cap.", 72)}
${compare("winter", "Winter: the simulation's snow, unchanged.")}
</section>
<hr>

<section id="young">
<div class="head"><span class="n">7</span><h2>The young</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Age was not on the wire: a newborn appeared at full size.</p></div>
<div><span class="label">Now</span><p><code>creatures</code> messages carry <code>young</code>: each young animal's id and how far grown it is, in sixteenths (from <code>Population.maturity</code>; additive, no schema bump). A newborn is drawn at half length with a head 35 % larger for its body, and is redrawn at each sixteenth until it comes of age. About 80 of the ~200 animals in the recording are young at any time.</p></div>
</div>
${youngShot}
</section>
<hr>

<section id="shore">
<div class="head"><span class="n">·</span><h2>Nothing stands on the water</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>A plant was allowed by its cell's height, while the ground paints the coast between cells and the swash runs up the beach at high tide: near the shore a plant could stand in the sea (reeds most of all; since round 3 grass clumps spill into the next cell too).</p></div>
<div><span class="label">Now</span><p>A plant's foot must be on the land as painted (heights between cells, as animals already read them) and as far from the waterline as the swash reaches in that view (10 art pixels up close). Its shadow goes with it.</p></div>
</div>
${compare("shore", "The east coast up close, cell (244, 110): reeds in the sea at the top right before.", 70)}
</section>
<hr>

<section id="water">
<div class="head"><span class="n">·</span><h2>Land animals in the water</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>The simulation lets a land animal into the sea, where it pays for every hour and drowns when its energy runs out (M11 makes the shallow shelf free). The renderer drew it as if on land: walking on the water.</p></div>
<div><span class="label">Now</span><p>The renderer shows the simulation's place, never moving an animal out, and draws the effort (the owner: struggling more than on land unless partly aquatic), <code>1 − AQUATIC / 0.6</code>. In the shallows (no deeper than 0.03, M11's wading depth) its legs are under the water, it slows by up to 45 % and ripples spread from it. Out of its depth its legs are gone from sight, its body is sunk but for its head, it slows by up to 70 %, bobs, and the ripples come faster and wider (<code>src/creatures/wading.ts</code>).</p></div>
</div>
${filmPair("water", ["Before: the north coast, cell (183, 11)", "After: swimming out sunk to the head, ripples round it"])}
</section>
<hr>

<section id="bodies">
<div class="head"><span class="n">·</span><h2>Legs in turn, and no body folding through itself</h2></div>
<div class="notes">
<div><span class="label">Legs</span><p>A foot stepped when its rest point was far enough away, so a short-legged or slow body moved all its feet on the same frame. Now a legged body goes through a gait cycle for every 1.5 lengths of its shortest leg it walks. Each foot is in the air for 40 % of it and stands still for the rest. A pair's two feet are half a cycle apart and diagonal feet swing together: alternating with one pair, a trot with two, tripods with three. A foot never slides once down, and a body that stops brings its feet back under it.</p></div>
<div><span class="label">Bodies</span><p>The chain followed the head with no limit, so a sharp turn folded it back over itself. Now each kind bends only so far from head to tail (worms and snakes into a U, beasts a little, beetles and crabs hardly), the head turns at most 0.6 rad from the body, long bodies walk a turn as an arc, short stiff ones turn on the spot, and looking about turns the head only. Over 10 simulated minutes per kind, joints folded onto each other in 16–26 % of frames before and none after.</p></div>
</div>
${filmPair("follow2", ["Before: a lizard followed", "After: its feet in turn, its body in arcs"])}
</section>
<hr>

<section id="bushes">
<div class="head"><span class="n">·</span><h2>Animals keep clear of trees and bushes</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Between the simulation's ticks an animal strolled anywhere that was land, so it walked through bushes and stood on trunks, and seemed to walk over the vegetation.</p></div>
<div><span class="label">Now</span><p>Each tree and bush leaves a footprint (a tree's trunk and roots, a bush's lower puffs). Strolls pick clear goals and stop before a plant; the walk to where the simulation has the animal steers round them; a place the simulation puts inside a bush is drawn beside it, without changing the simulation's data. Grass and flowers are still walked through. In the middle view at (64, 64), 1–3 of about 14 animals were in a footprint at any moment before, and almost always none after.</p></div>
<div><span class="label">Depth</span><p>Round 2 (the owner: parts of the creatures still seemed above the bushes), after how top-down games sort: by the base of each thing, a sprite that spans depths split so that each piece sorts by its own. A body was drawn whole in the row of its lowest joint, so an animal walking up the screen had its head over a bush that stood in front of it. Now a body a tree or bush stands across is drawn in two, the part behind under the plant and the rest in front. The fade in front of the animal followed is lighter (bushes 60 %, grass 50 %), so a bush in front still reads as in front.</p></div>
</div>
<p class="meta">Five animals of different sizes followed among bushes, 12 s each, the middle of the screen enlarged twice: before left, after right.</p>
${filmPair("bush2", ["Before: Shepisu, the largest (SIZE 0.97)", "After"])}
${filmPair("bush21", ["Before: Maleha (SIZE 0.51)", "After"])}
${filmPair("bush10", ["Before: Malehe (SIZE 0.45)", "After"])}
${filmPair("bush32", ["Before: Malera, small (SIZE 0.24)", "After"])}
${filmPair("bush15", ["Before: Devuga, the smallest, many-legged (SIZE 0.12)", "After"])}
</section>
<hr>

<section id="card">
<div class="head"><span class="n">·</span><h2>The name card of the animal followed</h2></div>
<div class="notes">
<div><span class="label">The owner's choice</span><p>While the local view follows an animal: its species' name, its traits in words where words do well, pixel icons where they don't, always on, in a corner of the screen. The phone's follow-a-creature (S3) shows the same card.</p></div>
<div><span class="label">Now</span><p>R3's parchment, smaller, top-left (the chronicle's scroll unrolls at the foot). The name beside a swatch of the animal's own colours; at most three words for size (by mass: small, mid-sized, large), build (armoured, finned, swift, sluggish, legless, two-, six-, eight-legged, long- or short-legged) and diet (grazer, omnivore, hunter: the sim's own classes); icons for water-loving and each rare gene (fangs, warning sign, up arrow for giant, hourglass, frog, snowflake, leaf, sparkle for glow). It unrolls when the camera settles on the animal and rolls up when it leaves (<code>src/card.ts</code>, <code>window.__card()</code>).</p></div>
</div>
<div class="pair zoom">${["follow2", "follow4", "follow9", "bush21", "bush10", "bush32", "bush15"]
  .map((name) => films.after[name])
  .filter((film) => film !== undefined && film.card?.name !== undefined && film.corner !== null)
  .map(
    (film) =>
      `<figure><img src="${uri(film.corner)}" alt="Name card" width="${CARD_CORNER[2]}" height="${CARD_CORNER[3]}"><figcaption>${escape(film.card.name)}: “${escape(film.card.traits)}”${(film.card.icons ?? []).length > 0 ? `, icons: ${escape(film.card.icons.join(", "))}` : ""}</figcaption></figure>`,
  )
  .join("")}</div>
<p class="meta">Cropped from the films above, the top-left corner at the art pixels' size. The recordings have few rare-gene carriers, so few icons show here.</p>
</section>
<hr>

<section id="deaths">
<div class="head"><span class="n">8·9</span><h2>Deaths by cause, bones, and landings from the sea</h2></div>
<div class="notes">
<div><span class="label">Was</span><p>Every death was the same fade where the animal last stood (but for the fire's ash), and animals that landed from the sea faded in like births.</p></div>
<div><span class="label">Now</span><p>The sim tells who died of what (<code>CreaturesDied</code>, an output only: no saved state changes) and the wire carries <code>died</code> and <code>landed</code> on the creatures message. The body stops, turns toward its cause's colour, and comes apart in steps, legs first, tail to head (no see-through filter any more). The starved lie still and pale; the old the same, slower; a kill goes under a scuffle of dust; the drowned sink blue with bubbles and rings; the burnt char under R4's ash; a blast takes them at once. Pixel bones lie where the body lay, charred for the burnt, none for the drowned or the blasted, as the sim leaves carrion; they stay half a sim-day and fade over the other half. An animal that lands from the sea is there at once under a splash of drops and rings, in a wet patch that dries (<code>src/creatures/remains.ts</code>).</p></div>
</div>
${filmPair("starved", ["Before: a starved animal, cell (162, 15)", "After: it pales, comes apart, leaves bones"])}
${filmPair("drowned", ["Before: a land animal out at sea, cell (190, 14)", "After: it sinks blue, with bubbles"])}
${filmPair("oldAge", ["Before: an old animal, cell (217, 97)", "After: it lies down and goes, slower"])}
${filmPair("killed", ["Before: one killed by a hunter, cell (66, 105)", "After: dust, then bones"])}
<p class="meta">Each film is a fixed view on where the animal was last seen, enlarged twice; deaths come in the stream's creatures messages, every two sim-hours. No landing from the sea happens in the committed recordings (no founders, strangers or ark in them); the splash was checked on a staged ark stream.</p>
</section>
<hr>

<section id="open">
<div class="head"><h2>Open</h2></div>
<p>The rest of the R5 checklist (<code>docs/milestones.md</code>, "R5 checklist"):</p>
<ul class="open">

<li>Plants popping in over animals at row lines</li>

<li>Chronicle places and species</li>
<li>The scroll and dip at night, the tide's water line, the demo code behind a flag</li>
<li>The scene off the spike, a benchmark mode, per-frame costs, the board run on the 7" screen at a 30 fps cap</li>
<li>Tests, once the owner calls the look final</li>
</ul>
</section>
</main>
<script>
for (const box of document.querySelectorAll(".compare")) {
  const range = box.querySelector("input");
  const set = () => box.style.setProperty("--cut", range.value + "%");
  range.addEventListener("input", set);
  set();
}
</script>
</body>
</html>
`;

const readme = [
  "# R5 — Final rendering pass",
  "",
  "The scene as R5 leaves it against the scene when R5 began, filmed from the real",
  "renderer at 1024×600: stills at the same places (drag to compare) and films following",
  "an animal. `report.html` is one self-contained file but for its films, in `films/`",
  "(VP9, a few MB, committed with it).",
  "",
  `- Branch \`${branch}\` at \`${commit}\`; before: \`${before}\``,
  "- Rounds 1–4 (the owner's checklist items 1–7): grass see-through round the animal",
  "  followed, no tuft popping over it; colours from six genes ranked among species, no",
  "  olive; round map dots; a calmer ground; grass as small unoutlined tufts after",
  "  references, nine sizes, random tints; snow only from the simulation; the young drawn",
  "  small; plants off the water; land animals wade or struggle in the sea; legs step in",
  "  turn; no body folds through itself; animals keep clear of trees and bushes.",
  "  The name card of the animal followed; deaths by cause with bones, landings with a",
  "  splash. Decisions: ADR 0022",
  "- Tests wait until the owner calls the look final; the device benchmark comes later",
  "",
  "Regenerate with `cd renderer && npm run final` (`R5_REPORT_BEFORE=<commit>` to compare",
  "with another); do not edit by hand. R5 has no statistical criterion.",
  "",
].join("\n");
await mkdir(OUT, { recursive: true });
await writeFile(new URL("report.html", OUT), html);
await writeFile(new URL("README.md", OUT), readme);
console.log(`wrote ${fileURLToPath(OUT)} (${(html.length / 1e6).toFixed(1)} MB)`);
