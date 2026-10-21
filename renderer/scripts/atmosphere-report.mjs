/**
 * Write the R4 report (the atmosphere) as one self-contained HTML file.
 *
 *   npm run atmosphere   records the report's streams, builds the pages, then writes
 *                        ../reports/R4-atmosphere/
 *
 * 1. Records a short real stream for each event (`tools/stream.py --stage`, from the v9
 *    fixture two weeks on): a thunderstorm's fire, each rain, a volcano, a quake and each
 *    god power, into `public/stream/report/` (not committed).
 * 2. Reads from each where its event happened (the strike's cell, the ark's landing, the
 *    sown cells), and films the built scene there in headless Chromium at the art pixels'
 *    own size, in all three views: the map (one pixel a cell), the middle view and the
 *    local view; time-lapses where it is slow (a fire spreading); stills of what is left.
 * 3. Writes the page: films as animated PNGs (`apng.mjs`: lossless up to 256 colours a
 *    film, a median cut beyond), a chart of the light and rain over the office fortnight,
 *    the wire, and the atmosphere's unit tests, run for it.
 *
 * Films are caught in wall time, so two runs differ in when a frame was caught, not in
 * what the scene draws.
 */
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { build, preview } from "vite";
import { decodePng, pngIndexed as png, shrink } from "./apng.mjs";

const OUT = new URL("../../reports/R4-atmosphere/", import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERER = fileURLToPath(new URL("../", import.meta.url));
const STREAMS = fileURLToPath(new URL("../public/stream/report/", import.meta.url));
/** The desk's screen (CLAUDE.md §2): films are taken at its own size. */
const WIDTH = 1024;
const HEIGHT = 600;
const SAVE = "sim/tests/fixtures/saves/v9.lzma";

/** Each scenario's stream: the owner's schedule, and what is staged (day 1, at `hour`, 02:00 unless said). */
const SCENARIOS = {
  day: { schedule: "office", stage: null },
  fire: { schedule: "office", stage: "fire" },
  shower: { schedule: "always", stage: "shower", hour: 0.25 },
  thunder: { schedule: "always", stage: "thunder", hour: 0.25 },
  storm: { schedule: "always", stage: "storm", hour: 0.25 },
  soaking: { schedule: "always", stage: "rain", hour: 0.25 },
  cloud: { schedule: "always", stage: "cloud", hour: 0.25 },
  volcano: { schedule: "always", stage: "volcano" },
  quake: { schedule: "always", stage: "quake" },
  meteor: { schedule: "always", stage: "meteor" },
  // A month, so that what the seed power sowed has grown large enough to be seen.
  seed: { schedule: "always", stage: "seed", days: 30 },
  ark: { schedule: "always", stage: "ark" },
};
/** Sim-seconds a wall second while an event is filmed: 02:00 comes 4 s after the start. */
const EVENT_SPEED = 1800;
/** While rain falls: a staged spell (4 sim-hours) lasts 48 s, time to catch its bolts. */
const RAIN_SPEED = 300;
/** And while a fire spreads (a sim-day in 12 s). */
const SPREAD_SPEED = 7200;
/** A day at the desk: a sim-day in a minute. */
const DAY_SPEED = 1440;

const env_ = { ...env };
delete env_.PYTHONPATH;

function recordStreams() {
  mkdirSync(STREAMS, { recursive: true });
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const args = [
      "run", "python", "-m", "tools.stream", SAVE,
      "--out", join(STREAMS, `${name}.json`),
      "--skip-days", "14", "--days", String(scenario.days ?? 2), "--land-every", "1",
      "--creatures", "--creatures-every", "3600", "--sky-every", "600",
      "--schedule", scenario.schedule,
    ]; // prettier-ignore
    if (scenario.stage !== null) args.push("--stage", `1:${scenario.hour ?? 2}:${scenario.stage}`);
    execFileSync("uv", args, { cwd: ROOT, env: env_, stdio: ["ignore", "ignore", "inherit"] });
    console.log(`recorded ${name}`);
  }
}

/** A recording's messages, and what is read from them. */
function loadStream(path) {
  const messages = JSON.parse(readFileSync(path, "utf8")).messages;
  const lands = messages.filter((m) => m.type === "land");
  const events = messages.filter((m) => m.type === "events").flatMap((m) => m.events);
  return { messages, lands, events, size: readFileSync(path).length };
}

function gridOf(grid, cells) {
  const bytes = Buffer.from(grid.data, "base64");
  if (grid.encoding === "u8") return Array.from(bytes, (v) => v / grid.scale);
  return Array.from(
    { length: cells },
    (_, i) => (bytes[2 * i] | (bytes[2 * i + 1] << 8)) / grid.scale,
  );
}

/** The land cell nearest the island's middle (cells). */
function middleOfLand(land) {
  const cells = land.width * land.height;
  const heights = gridOf(land.heights, cells);
  let best = [land.width / 2, land.height / 2];
  let bestD = Infinity;
  for (let i = 0; i < cells; i++) {
    if (heights[i] <= land.sea_level + 0.01) continue;
    const x = (i % land.width) + 0.5;
    const y = Math.floor(i / land.width) + 0.5;
    const d = (x - land.width / 2) ** 2 + (y - land.height / 2) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [x, y];
    }
  }
  return best;
}

/** Where the cells that `pick` chooses in `grid` are thickest, within boxes of 9 cells. */
function densest(land, values) {
  let best = middleOfLand(land);
  let bestCount = 0;
  for (let y = 4; y < land.height - 4; y += 2) {
    for (let x = 4; x < land.width - 4; x += 2) {
      let count = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) count += values[(y + dy) * land.width + x + dx] ?? 0;
      if (count > bestCount) {
        bestCount = count;
        best = [x + 0.5, y + 0.5];
      }
    }
  }
  return best;
}

/** Where each scenario's event happened (cells), read from its stream. */
function placeOf(name, stream) {
  const first = stream.lands[0];
  const kinds = {
    fire: "fire_started",
    volcano: "volcano",
    quake: "earthquake",
    meteor: "crater",
    ark: "creatures_arrived",
  };
  const kind = kinds[name];
  const event = stream.events.find((e) => e.kind === kind && e.x !== undefined);
  if (event !== undefined) return [Math.round(event.x) + 0.5, Math.round(event.y) + 0.5];
  if (name === "seed") {
    // Where most of the seed power's seeds took: cells bare before and growing after.
    const cells = first.width * first.height;
    const before = gridOf(first.biomass, cells);
    const after = gridOf(stream.lands[stream.lands.length - 1].biomass, cells);
    return densest(
      first,
      before.map((b, i) => (b === 0 && after[i] > 0 ? 1 : 0)),
    );
  }
  return middleOfLand(first);
}

/** Where algae grow thickest, on the last land of `stream`. */
/** The land cell by the sea nearest (x, y), so that a close view has a coast in sight. */
function coastNear(land, [x, y]) {
  const cells = land.width * land.height;
  const heights = gridOf(land.heights, cells);
  const wet = (i) => heights[i] <= land.sea_level;
  let best = [x, y];
  let bestD = Infinity;
  for (let i = 0; i < cells; i++) {
    const cx = i % land.width;
    if (wet(i) || cx === 0 || cx === land.width - 1) continue;
    if (!(wet(i - 1) || wet(i + 1) || wet(i - land.width) || wet(i + land.width))) continue;
    const d = (cx + 0.5 - x) ** 2 + (Math.floor(i / land.width) + 0.5 - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = [cx + 0.5, Math.floor(i / land.width) + 0.5];
    }
  }
  return best;
}

function algaePlace(stream) {
  const land = stream.lands[stream.lands.length - 1];
  return densest(land, gridOf(land.algae, land.width * land.height));
}

const views = (query, [x, y]) => ({
  map: `${query}&view=map`,
  middle: `${query}&view=middle&x=${x}&y=${y}`,
  local: `${query}&view=local&x=${x}&y=${y}`,
});

/** Frames a second the films are taken and played at: the renderer's own on the board. */
const FPS = 30;
const FILMS = fileURLToPath(new URL("films/", OUT));
const REUSE = Boolean(env.R4_REPORT_REUSE_FILMS);
/**
 * While the look is tuned: `R4_REPORT_ONLY=fire,algae,…` films only those scenes (names as
 * the films', e.g. `strike`, `algae`, `lights`, `end`); the others are left out of the page.
 */
const ONLY = env.R4_REPORT_ONLY ? new Set(env.R4_REPORT_ONLY.split(",")) : null;
const wanted = (name) => ONLY === null || ONLY.has(name);
const SKIPPED = "<p><em>Not filmed in this partial run (<code>R4_REPORT_ONLY</code>).</em></p>";

/** Open the scene at `query` in film mode, and step it until its ground is painted. */
async function open(page, address, query) {
  await page.goto(`${address}?${query}&film`);
  await page.waitForFunction(() => typeof window.__frame === "function", null, {
    timeout: 120_000,
  });
  for (let tries = 0; tries < 2000; tries++) {
    // Still, while the ground is painted; once the painter is idle, a frame at a time, so
    // that a painting that came over another (a show's changed land) can finish its fade.
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

/** Run the scene on `seconds` without filming it. */
async function skip(page, seconds) {
  await page.evaluate(
    ([frames, step]) => {
      for (let k = 0; k < frames; k++) window.__frame?.(step);
    },
    [Math.round(seconds * FPS), 1 / FPS],
  );
}

/**
 * Film `seconds` of the scene at `FPS` into films/`name`.webm (VP9, 4:4:4 so that pixel
 * edges stay hard, nearly lossless), each frame stepping it on `speedUp` times a frame's
 * time (1: real time; more for a time-lapse). Returns the film's file and a poster: its
 * middle frame at the art pixels' size (half the screen's).
 */
async function film(page, name, seconds, speedUp = 1, keepAt = []) {
  mkdirSync(FILMS, { recursive: true });
  const file = `${name}.webm`;
  const frames = Math.round(seconds * FPS);
  // With R4_REPORT_REUSE_FILMS, a film already made is kept (its poster and stills beside it).
  if (REUSE && existsSync(join(FILMS, file)) && existsSync(join(FILMS, `${name}.poster.png`))) {
    const kept = keepAt.map((at, k) => ({
      at,
      poster: readFileSync(join(FILMS, `${name}.kept-${k}.png`)),
    }));
    const bytes = statSync(join(FILMS, file)).size;
    return {
      file,
      poster: readFileSync(join(FILMS, `${name}.poster.png`)),
      frames,
      seconds,
      bytes,
      kept,
    };
  }
  const encoder = spawn(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png",
     "-i", "-", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv444p", "-crf", "16", "-b:v", "0",
     "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", join(FILMS, file)],
    { stdio: ["pipe", "ignore", "inherit"] },
  ); // prettier-ignore
  const done = new Promise((resolve, reject) => {
    encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`))));
  });
  let poster = null;
  const kept = [];
  for (let k = 0; k < frames; k++) {
    const shot = await frame(page, speedUp / FPS);
    if (k === Math.floor(frames / 2)) poster = shrink(decodePng(shot), 2);
    for (const at of keepAt) {
      if (k === Math.round(at * FPS)) kept.push({ at, poster: png(shrink(decodePng(shot), 2)) });
    }
    if (!encoder.stdin.write(shot))
      await new Promise((resolve) => encoder.stdin.once("drain", resolve));
  }
  encoder.stdin.end();
  await done;
  const bytes = statSync(join(FILMS, file)).size;
  const posterPng = png(poster);
  writeFileSync(join(FILMS, `${name}.poster.png`), posterPng);
  kept.forEach((k, n) => writeFileSync(join(FILMS, `${name}.kept-${n}.png`), k.poster));
  return { file, poster: posterPng, frames, seconds, bytes, kept };
}

/**
 * A still of the scene after it has run a few seconds (what came all at once has played
 * out: a flash, a meteor's fall), saved to films/`name`.png, with its poster.
 */
async function still(page, name) {
  mkdirSync(FILMS, { recursive: true });
  if (REUSE && existsSync(join(FILMS, `${name}.png`))) {
    return {
      file: `${name}.png`,
      poster: png(shrink(decodePng(readFileSync(join(FILMS, `${name}.png`))), 2)),
    };
  }
  await skip(page, 10);
  const shot = await frame(page, 0);
  writeFileSync(join(FILMS, `${name}.png`), shot);
  return { file: `${name}.png`, poster: png(shrink(decodePng(shot), 2)) };
}

const uri = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
const escape = (text) =>
  String(text).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

/** The atmosphere's unit tests, run now. */
function unitTests() {
  const folder = mkdtempSync(join(tmpdir(), "lineage-r4-"));
  const file = join(folder, "tests.json");
  try {
    execFileSync(
      "npx",
      ["vitest", "run", "tests/atmosphere", "--reporter=json", `--outputFile.json=${file}`],
      { cwd: RENDERER, stdio: "ignore" },
    );
  } catch {
    // Failing tests are reported on the page (their count), not a reason to stop.
  }
  const result = JSON.parse(readFileSync(file, "utf8"));
  rmSync(folder, { recursive: true, force: true });
  return {
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    names: result.testResults.flatMap((file) =>
      file.assertionResults.map((test) => [...test.ancestorTitles, test.title].join(" › ")),
    ),
  };
}

/** Every test of the renderer, listed (not run). */
function listed() {
  const units = execFileSync("npx", ["vitest", "list"], { cwd: RENDERER, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.trim().length > 0).length;
  const browser = execFileSync("npx", ["playwright", "test", "--list"], {
    cwd: RENDERER,
    encoding: "utf8",
  });
  const total = Number(/Total: (\d+) test/.exec(browser)?.[1] ?? 0);
  const atmosphere = browser
    .split("\n")
    .filter((line) => line.includes("atmosphere.spec.ts"))
    .map((line) => line.replace(/^.*atmosphere\.spec\.ts:\d+:\d+ › /, "").trim());
  return { units, browser: total, atmosphere };
}

/** The light and rain of a stream's skies, for the chart. */
function skyPoints(stream) {
  const sky = stream.messages.filter((m) => m.type === "sky");
  const t0 = sky[0]?.t_ms ?? 0;
  return sky.map((m) => ({
    d: (m.t_ms - t0) / 86_400_000,
    light: m.light,
    present: m.present,
    rain: m.rain,
  }));
}

const RAIN_TOKENS = {
  rain: "--rain",
  thunder: "--thunder",
  storm: "--storm",
  soaking: "--soaking",
};

/** The light over a stream's days, the owner at the desk, and the rain by kind: an SVG to scale. */
function lightChart(points, firstDate) {
  const W = 960;
  const H = 300;
  const left = 96;
  const right = 16;
  const top = 16;
  const bottom = 56;
  const days = Math.ceil(points[points.length - 1]?.d ?? 1);
  const x = (d) => left + ((W - left - right) * d) / days;
  const y = (v) => top + (H - top - bottom) * (1 - v);
  const spans = (test) => {
    const out = [];
    let start = null;
    points.forEach((p, i) => {
      if (test(p) && start === null) start = p.d;
      const next = points[i + 1];
      if (start !== null && (!next || !test(next))) {
        out.push([start, next ? next.d : p.d]);
        start = null;
      }
    });
    return out;
  };
  const present = spans((p) => p.present)
    .map(
      ([a, b]) =>
        `<rect x="${x(a).toFixed(1)}" y="${top}" width="${Math.max(x(b) - x(a), 1).toFixed(1)}" height="${H - top - bottom}" fill="var(--desk)"/>`,
    )
    .join("");
  const rain = Object.entries(RAIN_TOKENS)
    .flatMap(([kind, token]) =>
      spans((p) => p.rain === kind).map(
        ([a, b]) =>
          `<rect x="${x(a).toFixed(1)}" y="${H - bottom + 6}" width="${Math.max(x(b) - x(a), 2).toFixed(1)}" height="8" rx="2" fill="var(${token})"><title>${kind}</title></rect>`,
      ),
    )
    .join("");
  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.light).toFixed(1)}`)
    .join("");
  const start = new Date(`${firstDate}T00:00:00Z`);
  const ticks = Array.from({ length: days + 1 }, (_, d) => {
    const date = new Date(start.getTime() + d * 86_400_000);
    const label =
      d % 2 === 0 && d < days ? `${date.toUTCString().slice(0, 3)} ${date.getUTCDate()}` : "";
    return `<line x1="${x(d)}" x2="${x(d)}" y1="${top}" y2="${H - bottom}" stroke="var(--grid)"/>${label ? `<text x="${x(d) + 3}" y="${H - bottom + 34}" class="tick">${label}</text>` : ""}`;
  }).join("");
  const levels = [
    [1, "1 day"],
    [0.5, "0.5"],
    [0.15, "0.15 moon"],
    [0.05, "0.05 night"],
  ]
    .map(
      ([v, label]) =>
        `<line x1="${left}" x2="${W - right}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${left - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${label}</text>`,
    )
    .join("");
  const data = JSON.stringify(
    points
      .filter((_, i) => i % 3 === 0)
      .map((p) => [Number(p.d.toFixed(4)), p.light, p.present ? 1 : 0, p.rain]),
  );
  return `<div class="chart" data-start="${start.getTime()}" data-days="${days}" data-left="${left}" data-right="${right}" data-width="${W}">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The sim's light and rain over the office fortnight, every ten sim-minutes">
<rect x="0" y="0" width="${W}" height="${H}" fill="var(--panel)"/>
${present}${ticks}${levels}${rain}
<path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
<line class="cross" x1="0" x2="0" y1="${top}" y2="${H - bottom}" stroke="var(--fg)" stroke-width="1" visibility="hidden"/>
</svg><div class="tip" hidden></div><script type="application/json">${data}</script></div>`;
}

const CHART_SCRIPT = `
for (const chart of document.querySelectorAll(".chart")) {
  const svg = chart.querySelector("svg");
  const tip = chart.querySelector(".tip");
  const cross = chart.querySelector(".cross");
  const data = JSON.parse(chart.querySelector("script").textContent);
  const start = Number(chart.dataset.start), days = Number(chart.dataset.days);
  const left = Number(chart.dataset.left), right = Number(chart.dataset.right), width = Number(chart.dataset.width);
  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const vx = ((event.clientX - box.left) / box.width) * width;
    const d = ((vx - left) / (width - left - right)) * days;
    let best = data[0];
    for (const p of data) if (Math.abs(p[0] - d) < Math.abs(best[0] - d)) best = p;
    const px = left + ((width - left - right) * best[0]) / days;
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    const when = new Date(start + best[0] * 86400000);
    tip.hidden = false;
    tip.textContent = when.toUTCString().slice(0, 22) + " UTC · light " + best[1].toFixed(2) + (best[2] ? " · at the desk" : " · away") + (best[3] !== "none" ? " · " + best[3] : "");
    tip.style.left = Math.min(Math.max((px / width) * box.width - 90, 0), box.width - 220) + "px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}`;

/** A film (or still) of the report: its poster inline, the video beside the report. */
function figure(item, title, text) {
  if (item == null) return SKIPPED;
  const meta =
    item.frames === undefined
      ? `still, 1024×600 (<code>films/${item.file}</code>)`
      : `${item.frames} frames at ${FPS} fps, ${item.seconds.toFixed(1)} s, 1024×600, ${(item.bytes / 1e6).toFixed(1)} MB`;
  const poster = uri(item.poster);
  const media =
    item.frames === undefined
      ? `<a href="films/${item.file}"><img src="${poster}" width="512" height="300" alt="${escape(title)}"></a>`
      : `<video src="films/${item.file}" poster="${poster}" width="1024" height="600" autoplay loop muted playsinline controls aria-label="${escape(title)}"></video>`;
  return `<figure class="film">${media}
<figcaption><strong>${escape(title)}</strong> ${text} <span class="meta">${meta}</span></figcaption>
</figure>`;
}

/** The three views of one thing, one below the other, each at the screen's own size. */
function threeViews(items, title, texts) {
  if (items == null) return SKIPPED;
  return `<div class="views">${["map", "middle", "local"]
    .map((view) =>
      items[view] === undefined
        ? ""
        : figure(
            items[view],
            `${title}: ${view === "local" ? "up close" : view === "middle" ? "middle view" : "map"}`,
            texts[view] ?? "",
          ),
    )
    .join("")}</div>`;
}

const swatch = (rgb) => {
  const hex = `#${rgb
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  return `<span class="swatch" style="background:${hex}"></span><code>${hex}</code>`;
};

/** The light's colours, as `src/atmosphere/light.ts` has them (read from it, not copied). */
function lightValues() {
  const source = readFileSync(new URL("../src/atmosphere/light.ts", import.meta.url), "utf8");
  const rgb = (text) => text.split(",").map((value) => Number(value.trim()));
  const named = (name) => {
    const found = new RegExp(`export const ${name}: Rgb = \\[([^\\]]+)\\]`).exec(source);
    if (found === null) throw new Error(`light.ts: no ${name}`);
    return rgb(found[1]);
  };
  const seasons = /SEASON_DAY[^{]*\{([^}]+)\}/.exec(source)?.[1] ?? "";
  const SEASON_DAY = Object.fromEntries(
    [...seasons.matchAll(/(\w+): \[([^\]]+)\]/g)].map((m) => [m[1], rgb(m[2])]),
  );
  return { NIGHT: named("NIGHT"), DUSK: named("DUSK"), DAWN: named("DAWN"), SEASON_DAY };
}

// --- 1. the streams -----------------------------------------------------------------------
if (!env.R4_REPORT_REUSE_STREAMS || !existsSync(join(STREAMS, "ark.json"))) recordStreams();
const streams = Object.fromEntries(
  Object.keys(SCENARIOS).map((name) => [name, loadStream(join(STREAMS, `${name}.json`))]),
);
const places = Object.fromEntries(
  Object.keys(SCENARIOS).map((name) => [name, placeOf(name, streams[name])]),
);
// The coast by the thickest algae: the sea, the waves and a shore in every view.
const algae = coastNear(streams.day.lands[streams.day.lands.length - 1], algaePlace(streams.day));
// The rains are filmed on that coast, where they meet the water as well as the land.
for (const rain of ["shower", "thunder", "storm", "soaking", "cloud"]) places[rain] = algae;

// --- 2. the films ---------------------------------------------------------------------------
/** Wall seconds from a stream's start (played at `speed`) to its first event of `kind`, or to its first sky of `rain`. */
function dueOf(stream, speed, test) {
  const first = stream.messages.find((m) => typeof m.t_ms === "number")?.t_ms ?? 0;
  for (const message of stream.messages) {
    if (message.type === "events" && message.events.some((e) => test(e))) {
      return (message.events.find((e) => test(e)).t_ms - first) / 1000 / speed;
    }
    if (message.type === "sky" && test({ kind: `rain:${message.rain}` })) {
      return (message.t_ms - first) / 1000 / speed;
    }
  }
  throw new Error("the stream has no such event");
}

if (!REUSE) rmSync(FILMS, { recursive: true, force: true });
await build({ root: RENDERER, logLevel: "silent" });
const server = await preview({ root: RENDERER, logLevel: "silent" });
const browser = await chromium.launch();
const errors = [];
const shots = {};
try {
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("the preview server gave no address");
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(600_000);
  page.on("pageerror", (error) => errors.push(error.message));
  /** Run `take` in the three views of `place`, the query given to each. */
  const each = async (name, query, place, take) => {
    if (!wanted(name)) return;
    shots[name] = {};
    for (const [view, q] of Object.entries(views(query, place))) {
      await open(page, address, q);
      shots[name][view] = await take(`${name}-${view}`);
      console.log(`filmed ${name} ${view}`);
    }
  };
  /** A stream's event, from a second before it, for `seconds`. */
  const event =
    (stream, speed, test, seconds, speedUp = 1) =>
    async (name) => {
      await skip(page, Math.max(dueOf(streams[stream], speed, test) - 1, 0));
      return film(page, name, seconds, speedUp);
    };
  const kind = (k) => (e) => e.kind === k;
  const fileOf = (stream, speed) => `file=report/${stream}.json&speed=${speed}&quiet&seed=7`;
  const settledAt = `every=0&quiet&seed=7&show=day`;

  // The light: the stills of each time of day, and a day at the desk.
  shots.lights = {};
  for (const light of wanted("lights") ? ["day", "dawn", "dusk", "night", "moon"] : []) {
    await open(page, address, `file=report/day.json&every=0&quiet&seed=7&view=map&show=${light}`);
    shots.lights[light] = await still(page, `light-${light}`);
  }
  // A sim-day in a minute (the owner, round 4), at the screen's frame rate.
  await each("day", fileOf("day", DAY_SPEED), places.day, (name) => film(page, name, 60));
  // Glow: the fixture has no glowing animal; two are sent as the stream would.
  await each(
    "glow",
    "file=report/day.json&every=0&quiet&seed=7&show=night",
    places.day,
    async (name) => {
      const [x, y] = places.day;
      await page.evaluate(([x, y]) => {
      window.__receive?.({
        type: "creatures", protocol: 1, t_ms: 0, ids: [900001, 900002],
        positions: [[x, y], [x + 1.5, y + 1]], species: [1, 1],
        born: [
          { id: 900001, genome: Array.from({ length: 32 }, () => 0.5), slots: 128 },
          { id: 900002, genome: Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? 0.8 : 0.4)), slots: 128 },
        ],
        torpid: [],
      });
    }, [x, y]); // prettier-ignore
      return film(page, name, 8);
    },
  );
  // The rains: each from a second before it begins (it sets in over 3 s).
  const rains = {
    shower: ["rain", 6],
    thunder: ["thunder", 14],
    storm: ["storm", 8],
    soaking: ["soaking", 6],
    cloud: ["cloud", 8],
  };
  for (const [name, [rain, seconds]] of Object.entries(rains)) {
    await each(name, fileOf(name, RAIN_SPEED), places[name],
      event(name, RAIN_SPEED, (e) => e.kind === `rain:${rain}`, seconds)); // prettier-ignore
  }
  // Snow: the winter recording, where snow lies on the high ground, with rain asked for: it
  // falls as snow where it is cold and as rain where it is not.
  await each("snow", "recording=winter&every=0&quiet&seed=7&show=day,rain", [140.5, 60.5],
    (name) => film(page, name, 8)); // prettier-ignore
  // A thunderstorm's lightning sets a fire; it spreads; what it leaves.
  await each("strike", fileOf("fire", EVENT_SPEED), places.fire,
    event("fire", EVENT_SPEED, kind("fire_started"), 5)); // prettier-ignore
  await each("spread", fileOf("fire", EVENT_SPEED), places.fire,
    event("fire", EVENT_SPEED, kind("fire_started"), 14, SPREAD_SPEED / EVENT_SPEED)); // prettier-ignore
  // A larger fire, made up on the land (?show=): the sim's own are often small.
  await each("bigfire", "file=report/day.json&every=0&quiet&seed=7&show=night,fire", places.fire,
    (name) => film(page, name, 6)); // prettier-ignore
  await each("burnt", `file=report/fire.json&${settledAt}`, places.fire, (name) =>
    still(page, name),
  );
  // The terrain's events and what they leave.
  await each("volcano", fileOf("volcano", EVENT_SPEED), places.volcano,
    event("volcano", EVENT_SPEED, kind("volcano"), 9)); // prettier-ignore
  await each("cone", `file=report/volcano.json&${settledAt}`, places.volcano, (name) =>
    still(page, name),
  );
  await each("quake", fileOf("quake", EVENT_SPEED), places.quake,
    event("quake", EVENT_SPEED, kind("earthquake"), 6)); // prettier-ignore
  await each("meteor", fileOf("meteor", EVENT_SPEED), places.meteor,
    event("meteor", EVENT_SPEED, kind("god_power"), 9)); // prettier-ignore
  await each("crater", `file=report/meteor.json&${settledAt}`, places.meteor, (name) =>
    still(page, name),
  );
  // The god powers that give.
  await each("seed", fileOf("seed", EVENT_SPEED), places.seed,
    event("seed", EVENT_SPEED, kind("god_power"), 14)); // prettier-ignore
  await each("beforeSeed", `file=report/seed.json&speed=1&quiet&seed=7&show=day`, places.seed,
    (name) => still(page, name)); // prettier-ignore
  await each("seeded", `file=report/seed.json&${settledAt}`, places.seed, (name) =>
    still(page, name),
  );
  await each("seededBurnt", "file=report/day.json&every=0&quiet&seed=7&show=day,burnt,seed",
    places.fire, (name) => film(page, name, 12)); // prettier-ignore
  await each("ark", fileOf("ark", EVENT_SPEED), places.ark,
    event("ark", EVENT_SPEED, kind("god_power"), 12)); // prettier-ignore
  // Algae, and the tide on the shore: long enough for the tide to turn.
  await each("algae", "file=report/day.json&every=0&quiet&seed=7&show=day", algae, (name) =>
    film(page, name, 30),
  );
  // The end of a world: the committed recording, on the map, all three minutes of it.
  if (wanted("end")) {
    await open(page, address, "recording=end&speed=1800&quiet&seed=3");
    await skip(
      page,
      Math.max(
        dueOf(
          loadStream(fileURLToPath(new URL("../public/stream/end.json", import.meta.url))),
          1800,
          kind("world_ended"),
        ) - 1,
        0,
      ),
    );
    // The acts' moments, a second in from the start of the film.
    shots.end = await film(page, "end", 184, 1, [16, 51, 96, 131, 166]);
  }
} finally {
  await browser.close();
  await server.close();
}
if (errors.length > 0) throw new Error(`the scene failed: ${errors.join("; ")}`);

// --- 3. the page ----------------------------------------------------------------------------
const office = loadStream(new URL("../public/stream/office.json", import.meta.url));
const officePoints = skyPoints(office);
const officeFirst = office.messages.find((m) => m.type === "clock").date;
const rainCounts = {};
let lastRain = "none";
for (const p of officePoints) {
  if (p.rain !== "none" && p.rain !== lastRain) rainCounts[p.rain] = (rainCounts[p.rain] ?? 0) + 1;
  lastRain = p.rain;
}
const units = unitTests();
const tests = listed();
const commit = git("rev-parse", "--short", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const log = git("log", "--format=%h %s", "main..HEAD").split("\n").filter(Boolean);
const { NIGHT, DUSK, DAWN, SEASON_DAY } = lightValues();
const at = (name) => `cell (${places[name].map((v) => Math.floor(v)).join(", ")})`;
const endMoments = [
  ["omen", 15],
  ["fire", 50],
  ["flood", 95],
  ["dark", 130],
  ["rise", 165],
];
const sizes = Object.entries(streams)
  .map(([name, s]) => `${name} ${(s.size / 1e6).toFixed(1)} MB`)
  .join(", ");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R4 Atmosphere Report</title>
<style>
/* Layout: a reading column of prose and tables; each effect a row of three views (map, middle, up close), pixelated on a night-blue mat. */
:root {
  --bg: #eef1f6; --fg: #182033; --muted: #56607a; --panel: #ffffff; --line: #d3d9e4;
  --accent: #b4475e; --mat: #1d2440; --desk: rgba(232, 176, 92, 0.22); --grid: #e2e6ee; --pass: #2f7d4f;
  --rain: #7fa6d6; --thunder: #4f7fb8; --storm: #2c3f86; --soaking: #4aa3a0;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #11151f; --fg: #e3e7f0; --muted: #98a1b8; --panel: #191f2c; --line: #2c3446;
  --accent: #f08aa0; --mat: #0a0d16; --desk: rgba(232, 176, 92, 0.16); --grid: #262d3c; --pass: #6cc493;
  --rain: #9ebfe6; --thunder: #7aa7dc; --storm: #8d9eea; --soaking: #6cc7c3;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #11151f; --fg: #e3e7f0; --muted: #98a1b8; --panel: #191f2c; --line: #2c3446;
  --accent: #f08aa0; --mat: #0a0d16; --desk: rgba(232, 176, 92, 0.16); --grid: #262d3c; --pass: #6cc493;
  --rain: #9ebfe6; --thunder: #7aa7dc; --storm: #8d9eea; --soaking: #6cc7c3;
  color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 var(--body); }
main { max-width: 1088px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
main > p, section > p, section > ul { max-width: 72ch; margin: 0; }
section { display: grid; gap: 16px; }
h1 { font-size: 2.1rem; line-height: 1.15; margin: 0; text-wrap: balance; }
h2 { font-size: 1.45rem; margin: 12px 0 0; padding-top: 18px; border-top: 1px solid var(--line); text-wrap: balance; }
h3 { font-size: 1.1rem; margin: 6px 0 0; }
.eyebrow { font: 600 0.78rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0; }
.meta { color: var(--muted); font-size: 0.85rem; }
code { font-family: var(--mono); font-size: 0.86em; overflow-wrap: anywhere; }
dl.header { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; font-size: 0.92rem; }
dl.header dt { color: var(--muted); }
dl.header dd { margin: 0; min-width: 0; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase; }
td:first-child code { white-space: nowrap; }
.pass { color: var(--pass); font-weight: 700; }
.views { display: grid; grid-template-columns: minmax(0, 1fr); gap: 22px; }
figure.film { margin: 0; display: grid; gap: 6px; min-width: 0; }
figure.film img, figure.film video, .stills img { display: block; width: 100%; height: auto; max-width: 1024px; image-rendering: pixelated; background: var(--mat); border-radius: 4px; }
figcaption { font-size: 0.88rem; }
figcaption strong { display: block; }
.stills { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
.stills figure { margin: 0; display: grid; gap: 4px; font-size: 0.85rem; }
.swatch { display: inline-block; width: 1.1em; height: 1.1em; border-radius: 3px; vertical-align: -0.2em; border: 1px solid var(--line); margin-right: 6px; }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; border-radius: 4px; }
.chart .tick { font: 12px var(--mono); fill: var(--muted); }
.tip { position: absolute; top: 4px; background: var(--fg); color: var(--bg); font: 12px var(--mono); padding: 4px 8px; border-radius: 3px; pointer-events: none; white-space: nowrap; }
.key { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.85rem; color: var(--muted); }
.key span::before { content: ""; display: inline-block; width: 14px; height: 10px; margin-right: 6px; border-radius: 2px; background: var(--k); }
pre { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 12px; overflow-x: auto; font: 12.5px/1.45 var(--mono); }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 16px; }
.two > * { min-width: 0; }
blockquote { margin: 0; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--panel); }
nav ol { margin: 0; padding-left: 1.2em; columns: 2; font-size: 0.92rem; }
</style>
</head>
<body>
<main>
<header style="display:grid;gap:14px">
<p class="eyebrow">Lineage · milestone report</p>
<h1>R4 — Atmosphere</h1>
<p>The light of the owner's presence, what glows in the dark, the island's own weather and the weather of its events, what those events leave on the land, and the end of a world. Every effect is filmed from the real renderer in all three views (map, middle view, up close) at the desk screen's own size, 1024×600, and at 30 frames a second, the board's target. The scene is stepped one frame at a time on its own clock, so no frame is dropped however busy the PC is. The apocalypse is the exception to the three views: it is shown on the map only, since it holds the camera there. The events are the sim's own, recorded with <code>tools/stream.py --stage</code> from the v9 fixture two weeks on, so what each leaves is what the sim does.</p>
<p><strong>Where the films are.</strong> They are VP9 WebM videos (4:4:4 colour, so pixel edges stay hard) in <code>films/</code> beside this page. That folder is not committed: it is about 150 MB, and <code>npm run atmosphere</code> writes it again. Without it, each film shows its poster, a still from its middle.</p>
<dl class="header">
<dt>Milestone</dt><dd>R4 (CLAUDE.md §8), decisions in ADR 0021</dd>
<dt>Branch</dt><dd><code>${escape(branch)}</code> at <code>${commit}</code>, ${log.length} commits on <code>main</code> (with M11's algae, cherry-picked)</dd>
<dt>Status</dt><dd>Second round after the owner's comments (2026-10-20); not merged. Device measurements are R5's.</dd>
<dt>Streams</dt><dd>${escape(sizes)} (recorded for this report, not committed)</dd>
<dt>Written</dt><dd>${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by <code>cd renderer &amp;&amp; npm run atmosphere</code></dd>
</dl>
<nav><ol>
<li><a href="#asked">What was asked</a></li><li><a href="#sim">The sim: weather and fire</a></li>
<li><a href="#light">The light</a></li><li><a href="#glow">Glow</a></li>
<li><a href="#rain">Rain, thunder, storms</a></li><li><a href="#fire">Fire</a></li>
<li><a href="#volcano">Volcano</a></li><li><a href="#quake">Earthquake</a></li>
<li><a href="#meteor">Meteor</a></li><li><a href="#seed">Seed</a></li>
<li><a href="#ark">Ark</a></li><li><a href="#sea">Algae and waves</a></li>
<li><a href="#end">The end of a world</a></li><li><a href="#wire">On the wire</a></li>
<li><a href="#tests">Tests</a></li><li><a href="#later">Left for later</a></li>
</ol></nav>
</header>

<section id="asked">
<h2>What was asked, and what was built</h2>
<div class="table"><table>
<thead><tr><th>Asked</th><th>By</th><th>As built</th></tr></thead>
<tbody>
<tr><td>Day/night tint from presence, glow pass, seasons</td><td>§8 R4</td><td>Moonlit-blue nights, rose dusks, lilac dawns, eased between the sim's 10-minute light steps; day graded by the season; additive glow over the tint</td></tr>
<tr><td>Weather of events, apocalypse sequence</td><td>§8 R4</td><td>Rain, thunder, storms, fire, volcano, quake, meteor, seed, ark; the three-minute end of a world on the map</td></tr>
<tr><td>Waves on every coast, the map too</td><td>owner, R3 demo</td><td>The map painted with the surf bands; the sea brings them in</td></tr>
<tr><td>Fire up close with real flame sprites; burnt trees left behind</td><td>owner, round 2</td><td>Flames in four frames (one to a cell in the middle view, three larger up close), embers and smoke; charred tree skeletons and charcoal ground where the sim's scorch is fresh</td></tr>
<tr><td>Fire kills the creatures in it</td><td>owner, round 2</td><td>In the sim: an hour in a burning cell kills (<code>[fauna] fire_damage_per_hour</code>); death cause <code>BURNT</code>; on the screen a puff of ash where one dies in the fire</td></tr>
<tr><td>Thunder: a fire-starting strike only while it rains; visual-only thunder in rain; the storm bigger</td><td>owner, round 2</td><td>The island's own weather in the sim (rain, rain with thunder, thunderstorms); lightning strikes only in a thunderstorm; three sizes of lightning on the screen</td></tr>
<tr><td>Rain that meets the water up close</td><td>owner, round 2</td><td>Rings spreading on the water, splashes on the land, in the middle and local views</td></tr>
<tr><td>A volcano to be seen</td><td>owner, round 2</td><td>The sim raises its cone; the scene draws it (basalt cone, gullies, a mouth of lava, rivulets) and keeps it 30 sim-days; a meteor's crater likewise</td></tr>
<tr><td>What the giving powers actually do</td><td>owner, round 2</td><td>Seed: motes over the bare land in sight, then the sprouts the sim sowed; ark: its light where the newcomers land, and them</td></tr>
<tr><td>Algae drawn as their own plant</td><td>owner via M11</td><td>Olive fronds in clumps on the shallows, as thick as their biomass (M11's <code>Flora.algae</code> on the wire)</td></tr>
<tr><td>Every effect in all three views, in full</td><td>owner, round 2</td><td>This report</td></tr>
<tr><td>Every view at its own resolution and frame rate; crater and volcano less plain, a bare ring round them</td><td>owner, round 3</td><td>Films at 1024×600 and 30 fps beside the report; a terraced cone and lava; the sim bares 1.4 radii round both for 120 days</td></tr>
<tr><td>Night and day over about a minute</td><td>owner, round 4</td><td>The day film is a sim-day in 60 s</td></tr>
<tr><td>Glow: small on the map, the animal visible in the middle and local views, a slow pulse</td><td>owner, round 4</td><td>A light just round the map's square; a ring of light round the body, its heart clear, wider up close; all breathing over 3.5 s</td></tr>
<tr><td>Rain that is in the world: drops in perspective, slanted by wind, parallax, a grey sky; the storm's rain following its wind</td><td>owner, round 4</td><td>Drops sized to the view (a pixel on the map), three layers at different speeds and sizes, leaning with the wind; cloud greys the light; in a storm, gusts swing the wind and all three layers with it</td></tr>
<tr><td>Fire up close: bigger, more detailed flames, each with its own glow and sparks; the fire carried by the plants; a heavier burn that tracks where it went</td><td>owner, round 4</td><td>Two six-frame flames to a cell, each with a halo and embers; the made-up fire spreads cell to cell through fuel, the most flammable first, as the sim's does; the scorch drawn cell by cell, charcoal with drifts of ash and a ragged edge</td></tr>
<tr><td>Lava that flows, a cone that blends in</td><td>owner, round 4</td><td>Lava in eight looped frames, crust drifting in the pool and down the rivers; a skirt of ash and scree round the cone's foot</td></tr>
<tr><td>A crater that looks like one (with references), not bugged</td><td>owner, round 4</td><td>Drawn from a lit height field, after simple lunar craters: scalloped raised rim, the near wall in shadow, slumped floor, pale ejecta with boulders, rays downrange</td></tr>
<tr><td>The ark larger up close; the newcomers spawning; the seed's plants growing</td><td>owner, round 4</td><td>The ark's light scaled to each view; each newcomer comes into being under a thread of light; sprouts break the soil and grow leaf by leaf on every cell the seed sowed</td></tr>
<tr><td>Tides: water rising and falling, not every coast at once</td><td>owner, round 4</td><td>The swash runs up the beach in three steps and drains, on a tide that rises and falls; each stretch of coast on its own clock</td></tr>
<tr><td>Waves coordinated, not snappy; none glitching on the map</td><td>owner, round 5</td><td>One wave front sweeps across the sea and along the coasts at 5 cells a second; a wave every 5 s, its crest, foam and swash in turn, the swash rising and draining smoothly and running further up the beach; the map keeps its surf, without a swash</td></tr>
<tr><td>Waves quicker, more noticeable</td><td>owner, round 5</td><td>A wave every 5 s (was 8), the front a third faster, the tide turning in a minute, each step of the swash half as long again</td></tr>
<tr><td>Glow fainter in the middle and local views</td><td>owner, round 5</td><td>Pulse from 12 % to 30 % in the middle view, 6 % to 16 % up close (30 % to 70 % on the map)</td></tr>
<tr><td>Rain: faster and bigger on the map, bigger in the middle view, a colour that shows; random strength; a fiercer storm; a grey that blocks the sun; a cloudy weather</td><td>owner, round 5</td><td>Pale blue streaks drawn over the light, 3 to 6 pixels, falling twice as fast; each spell's own strength, swelling within it; a storm half as heavy again, leaning and gusting harder; the world graded toward grey under any cloud (half under an overcast sky, most in a storm); overcast spells in the sim, seen only</td></tr>
<tr><td>Thunder at random times</td><td>owner, round 5</td><td>Bolts fall by chance in short windows, with lulls and bursts</td></tr>
<tr><td>Fire up close more detailed, in the ground, sorted with the trees; flames on what burns</td><td>owner, round 5</td><td>A 15 × 24 six-frame flame after pixel-art references (a steady base, swaying tongues, a lick that pinches off, deep red rim to white-gold heart); a bed of glowing embers under each burning cell; flames sorted among the plants' rows; a burning tree or bush burns in its crown</td></tr>
<tr><td>Fire up close slower and see-through, its small flames back</td><td>owner, round 5</td><td>The big flames flicker at about 4 frames a second and are 72 % opaque, so what stands behind them shows; three small flames lick round them in every burning cell; at night a fainter added light keeps them bright</td></tr>
<tr><td>Lava welling outward; trees in front of a cone and a crater's thrown earth; the crater only after the meteor</td><td>owner, round 5</td><td>The pool's crust drifts outward from the middle; scree, crater and embers lie under the plants, the cone stands among them; the land of a crater waits until the meteor strikes</td></tr>
<tr><td>The seed's growth seen; the ark's foot blended</td><td>owner, round 5</td><td>Sprouts on burnt ground, made up; the ark's beam fades into a pool of light on the ground</td></tr>
<tr><td>Nothing popping in or out, nothing in the wrong place</td><td>owner, round 6</td><td>Every film checked frame by frame: flames, cones, craters, sprouts, plants, the dead and the born fade; cones rise; craters leave out the sea; views stay inside the world; the next world comes in the black</td></tr>
<tr><td>Rocks and creatures drawn over a volcano; what a cone or crater lands on</td><td>owner, round 6</td><td>In the sim, creatures under a new cone or crater die (<code>[fauna] blast_kill_reach</code>); no plant, stone or boulder is drawn on a cone or crater or its bare ring; the cone covers its place; a pixel-art dust cloud hides the change</td></tr>
<tr><td>Snow falling; rain seeming to rise in a storm</td><td>owner, round 6</td><td>Precipitation falls as snow where snow lies (cold), as rain elsewhere; a raindrop's streak is at least as long as it falls in a frame, so the eye no longer takes it for the drop above it</td></tr>
<tr><td>Black squares among winter plants up close (a bug since R1)</td><td>found in round 6</td><td>The plants' drawings are packed into textures of at most 2048 × 2048: the winter close view's one sheet was 1024 × 10801, past what the GPU takes</td></tr>
<tr><td>Tides, after references</td><td>owner, round 6</td><td>A shader draws the waves from each pixel's distance to the shore: lines roll in and break white, the swash runs up the sand with a foam edge, drains, and leaves wet sand that dries</td></tr>
<tr><td>Rain and snow falling mixed</td><td>owner, round 7</td><td>A view's whole fall is one kind: snow when at least half its land has snow lying, rain otherwise, cross-fading if that changes during a spell</td></tr>
<tr><td>The water away from the coast should move</td><td>owner, round 7</td><td>The open sea's swell: faint crests across the screen, broken into dashes that come and go, drift down the sea; on the map, fainter in the middle view, none up close</td></tr>
<tr><td>The meteor too small in the middle view</td><td>owner, round 7</td><td>Its streak is drawn 1.8 times larger there and falls from further up</td></tr>
<tr><td>A dust cloud's dither jumping in one frame</td><td>found in round 7</td><td>Each cloud is painted once and stretched as it swells, instead of painted anew at each size</td></tr>
</tbody></table></div>
</section>

<section id="sim">
<h2>The sim: the island's own weather, and fire that burns animals</h2>
<p>The owner chose these in round 2 and they were built in R4 (schema v12, ADR 0021). M11's algae took v11; this branch carries it.</p>
<ul>
<li><strong>Weather</strong> (<code>weather.py</code>, a new subsystem ticked hourly before the fire). Rain spells begin at random, at 5, 3, 6 and 5 a month in spring, summer, autumn and winter, and last 2 to 30 hours. Of the spells, 30 % carry thunder (seen only) and 12 % are thunderstorms, lasting 1 to 6 hours.</li>
<li><strong>Lightning only in a thunderstorm.</strong> <code>[flora] fire_strikes_per_storm_hour = 1.6</code> strikes per storm-hour at full dryness. That gives the same expected strikes a year (about 10.7 on the default calendar) as the old 30 ignitions a year. Fires start only while it rains, and any rain slows a fire as wet land does. The rain power is a soaking rain that puts fires out and never strikes.</li>
<li><strong>Fire burns animals</strong>: <code>[fauna] fire_damage_per_hour = 1.0</code> of an animal's capacity, so an hour in a burning land cell kills it. Swimmers are safe, and the burnt leave no carrion.</li>
</ul>
<p>The office fortnight below (<code>office.json</code>) holds ${
  Object.entries(rainCounts)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ") || "no"
} spells.</p>
<div class="key"><span style="--k:var(--accent)">the light (0–1)</span><span style="--k:var(--desk)">owner at the desk</span><span style="--k:var(--rain)">rain</span><span style="--k:var(--thunder)">thunder</span><span style="--k:var(--storm)">thunderstorm</span><span style="--k:var(--soaking)">the rain power</span></div>
${lightChart(officePoints, officeFirst)}
</section>

<section id="light">
<h2>The light</h2>
<p>A tint multiplied over the land, plants and animals. Night is moonlit blue, dusk (the owner away) is rose, dawn (the owner back) is lilac, and the day is graded by the season. Each of the sim's 10-minute steps is eased in over the time before the next.</p>
<div class="stills">${["day", "dawn", "dusk", "night", "moon"]
  .filter((n) => shots.lights[n] !== undefined)
  .map(
    (n) =>
      `<figure><img src="${uri(shots.lights[n].poster)}" width="256" height="150" alt="The map at ${n}"><figcaption><strong>${n}</strong></figcaption></figure>`,
  )
  .join("")}</div>
${threeViews(shots.day, "A day at the desk", { map: "The office stream from midnight, a sim-day in a minute: night, the owner arriving (dawn), day, leaving (dusk), night.", middle: "", local: "" })}
<div class="table"><table><thead><tr><th>Light</th><th>Multiplier</th></tr></thead><tbody>
<tr><td>Night</td><td>${swatch(NIGHT)}</td></tr><tr><td>Dusk</td><td>${swatch(DUSK)}</td></tr><tr><td>Dawn</td><td>${swatch(DAWN)}</td></tr>
${Object.entries(SEASON_DAY)
  .map(([s, rgb]) => `<tr><td>Day, ${s}</td><td>${swatch(rgb)}</td></tr>`)
  .join("")}
</tbody></table></div>
</section>

<section id="glow">
<h2>Glow</h2>
<p>Light added over the tint, breathing slowly (3.5 s), faint enough closer in that the animal is clearly seen through it (from 12 % to 30 % in the middle view, 6 % to 16 % up close). Here, two animals with the glow gene at night, sent to the scene as the stream would send them (the fixture's world has none). On the map, a small light just round each animal's square. In the middle and local views, a ring of light round the body whose heart is clear, so that the animal itself is seen; up close the ring is wider.</p>
${threeViews(shots.glow, "Glowing animals at night", {})}
</section>

<section id="rain">
<h2>Rain, thunder and thunderstorms</h2>
<p>Each is a staged spell of the sim's own weather. Cloud blocks the sun while it rains: the world's colours are graded toward grey and cooled (a colour-matrix filter), the light dims, and a faint grey haze lies over it; a storm greys and darkens most. The drops are pale blue streaks drawn over the light, so that they show on any ground, sized to the view (3 pixels on the map, 5 in the middle view, 6 up close), in three layers at different sizes and speeds, leaning with the wind. Each spell falls with its own strength, swelling and easing within it. Rings spread where drops hit the water, and drops splash on the land, in the middle view and up close. With thunder, a thin bolt at random times and a faint flash: it starts nothing. A thunderstorm is bigger: a darker sky, half as much rain again, faster and leaning harder, gusts that swing the wind and every layer of rain with it, forked bolts in bursts and lulls, and brighter flashes. The rain power's soaking rain is steadier and leans least.</p>
<h3>Rain</h3>${threeViews(shots.shower, "Rain", {})}
<h3>Rain with thunder</h3>${threeViews(shots.thunder, "Thunder", {})}
<h3>A thunderstorm</h3>${threeViews(shots.storm, "Thunderstorm", {})}
<h3>The rain power</h3>${threeViews(shots.soaking, "Soaking rain", {})}
<h3>Snow</h3>
<p>Where it is cold enough for snow to lie (the sim's lying snow, from the season and the height of the land), what falls is snow: white flakes drifting down slowly in three layers, swaying, a pixel on the map and larger closer in. A view's whole fall is one kind (round 7): snow when at least half the land in sight has snow lying, rain otherwise, the two cross-fading if that changes during a spell. Here, the winter recording with a spell of rain asked for, over its snowy high ground.</p>${threeViews(shots.snow, "Snow", {})}
<h3>An overcast sky</h3>
<p>Between rains the sky clouds over now and then (8 spells a month, 3 to 36 hours): the day greys a little less than under rain, and nothing falls. It is only seen: plants and animals live under the same light, and fire is not slowed.</p>${threeViews(shots.cloud, "Overcast", {})}
</section>

<section id="fire">
<h2>Fire</h2>
<p>A thunderstorm at 02:00 on the office schedule (night), its lightning striking ${at("fire")}: the biggest bolt, thick and forked, with the brightest flash. Flames then rise from every burning cell under a wide glow, with embers and smoke. Up close each cell has two large six-frame flames, flickering slowly (about 4 frames a second) and see-through (72 %), so what stands behind them shows, with three small flames licking round them; the large ones are drawn after pixel-art fire references: a steady base on its fuel, a body that sways more the higher it is, tongues licking up in turn and a lick pinching off at the top, a deep red rim around a white-gold heart. Each has its own glow and sparks, and stands in a bed of glowing embers. The flames are sorted among the plants: a tree in front covers the fire behind it, and a burning tree or bush burns in its crown too. An animal that dies in the fire leaves a puff of ash. Then the fire spreads, at a sim-day in 12 s. Two sim-days later the burnt land is charcoal ground, drawn cell by cell where the fire went, with drifts of ash, a ragged edge and the skeletons of the trees that stood.</p>
<h3>The strike</h3>${threeViews(shots.strike, "Lightning sets the land alight", {})}
<h3>The fire spreading (time-lapse)</h3>${threeViews(shots.spread, "The fire spreads", {})}
<h3>A larger fire, made up</h3>
<p>The sim's fires are often small, as this one is (it burnt 4 cells in 18 hours); how far they spread is M11's to tune. To show the fire's look at a larger scale, here are 24 cells set alight on demand (<code>?show=night,fire</code>), with the thunderstorm and the strike that come with it. They are chosen as the sim's fire spreads: from cell to neighbouring cell, only where plants carry it, the most flammable fuel first. Only the land is the sim's.</p>${threeViews(shots.bigfire, "A larger fire (made up)", {})}
<h3>What it leaves</h3>${threeViews(shots.burnt, "The burnt wood, two days on", { map: "", middle: "", local: "Charred trees and scorched ground; stumps, logs and snags (R1) between them." })}
</section>

<section id="volcano">
<h2>Volcano</h2>
<p>Staged at ${at("volcano")} with the terrain's own <code>apply_volcano</code>. The cone rises out of the ground over 2.5 s under a cloud of dust that hides the plants going; creatures standing where it rises die, and no plant, stone or boulder is drawn on it or its bare ring. The sim raises a cone in the heights and bares the land round it (1.4 times its radius, for 120 days, so no plant stands on it). The ground's gentle shading hardly shows a cone from above, so the scene draws it, after how top-down pixel-art games draw mountains (<em>Zelda: A Link to the Past</em>, the <em>Pokémon</em> GBA overworlds, <em>Stardew Valley</em>): stacked basalt ledges with lit, grainy tops and cliff faces toward the viewer, boulders, and a mouth whose back wall shows. Round its foot a skirt of ash and scree thins into the ground. While it erupts, its lava is a layer of its own, a crusted pool and rivers meandering down the ledges, and it flows: eight looped frames of crust welling up in the middle of the pool and drifting outward to its rim, and down the rivers, the heat swelling and ebbing. The scree lies under the plants and the cone stands among them, so trees in front of it are drawn over it. Above it rise an ash column and embers. The cone stays drawn for 30 sim-days.</p>
${threeViews(shots.volcano, "The eruption", {})}
${threeViews(shots.cone, "The cone, two days on", {})}
</section>

<section id="quake">
<h2>Earthquake</h2>
<p>Staged at ${at("quake")} (<code>apply_earthquake</code>): the picture jolts for 4 s, dying away, and dust rises over the fault.</p>
${threeViews(shots.quake, "An earthquake", {})}
</section>

<section id="meteor">
<h2>Meteor</h2>
<p>The meteor god power, pressed at 02:00; the sim aimed it at ${at("meteor")}. A streak from high up, a flash as it strikes, a glow and dust; every animal within twice its radius is killed. A cloud of dust rises over the place and hides the plants going. The bowl it digs shows only once the meteor has struck (the land the stream sends with it waits until then), and the sim bares the land round it. Its thrown earth lies under the plants. It is drawn from a height field lit from the upper left, after how simple craters look from above (a bowl with a raised rim of thrown-out earth and uplifted rock, a rumpled ejecta blanket that thins outward, rays thrown away from the impact's direction, walls that slump): a rim scalloped where it slumped, the near wall in its shadow, the far wall lit, a slumped lobe on the floor, pale ejecta with boulders thinning into clods, and rays downrange of the meteor, none uprange.</p>
${threeViews(shots.meteor, "The meteor", {})}
${threeViews(shots.crater, "The crater, two days on", {})}
</section>

<section id="seed">
<h2>Seed</h2>
<p>The seed god power sows 400 seeds of random genomes on bare land across the whole island; the sim does not aim it. On the screen, golden motes drift down onto the bare cells in sight. In the land the sim sends with the power, every cell it sowed sprouts: each sprout breaks the soil with a glint of gold and grows leaf by leaf over three seconds, and stays until the cell's plants are big enough to be drawn. The films are at ${at("seed")}, where most seeds took.</p>
${threeViews(shots.seed, "The seed power", {})}
${threeViews(shots.beforeSeed, "Before the seed power", {})}
${threeViews(shots.seeded, "The seeded land, a month on", {})}
<h3>Seeded on burnt ground, made up</h3>
<p>The island in this save has little bare land, so the sim's seeds took on a few scattered cells. Here, made up on the land (<code>?show=day,burnt,seed</code>), the seed falls on ground a fire has just bared: every bare cell in reach sprouts, as the sim sows them, and the sprouts grow leaf by leaf.</p>
${threeViews(shots.seededBurnt, "Seeds on burnt ground (made up)", {})}
</section>

<section id="ark">
<h2>Ark</h2>
<p>The ark god power brings 12 plant eaters, landing on a vegetated spot. The light comes down where the stream says they landed (<code>creatures_arrived</code>, at ${at("ark")}), as wide as the place they land on in every view, fading at its foot into a pool of light on the ground. Each newcomer comes into being there: a thread of light comes down onto it, flares, and leaves sparks rising while it fades in, in steps, over 2.5 s.</p>
${threeViews(shots.ark, "The ark", {})}
</section>

<section id="sea">
<h2>Algae, waves and the tide</h2>
<p>M11's algae on the shallow sea, two weeks after the save: olive fronds in clumps, as thick as their biomass. The waves are drawn by a shader from each pixel's distance to the shore, after how top-down pixel water is drawn (ADR 0021): lines of lighter water form out at sea, faint and broken, and roll in, wider and brighter, breaking white at the shore; then the swash runs up the sand with a white edge while it rises, drains back more slowly, and leaves a darker stripe of wet sand that dries as the next wave comes. A wave every 5 s, on a front sweeping along the coast at 5 cells a second; the tide, turning over a minute, sets how far the swash runs. The map has the breaking lines without a swash. Out past the waves the open sea has its swell (round 7): faint crests lying across the screen, bent by a wide noise and broken into short dashes that come and go, drift down the sea, a crest every 6 s; on the map, fainter in the middle view, and none up close, where the water away from the shore is calm. The films are on the coast by the thickest algae, 30 s.</p>
${threeViews(shots.algae, "Algae and the tide", {})}
</section>

<section id="end">
<h2>The end of a world</h2>
<p>From <code>end.json</code>, where the herd starves on day 2 and the sim ends the world. The film is the whole three-minute sequence at the screen's own frame rate. It plays on the map only, since it holds the camera there.</p>
${figure(shots.end, "World 1 ends and world 2 rises", "The whole sequence, as it plays on the screen.")}
<div class="stills">${(shots.end?.kept ?? [])
  .map(
    (m, k) =>
      `<figure><img src="${uri(m.poster)}" width="512" height="300" alt="${endMoments[k][0]}"><figcaption><strong>${endMoments[k][0]}</strong> about ${endMoments[k][1]} s in</figcaption></figure>`,
  )
  .join("")}</div>
</section>

<section id="wire">
<h2>On the wire</h2>
<p><code>sky</code>: <code>light</code>, <code>present</code>, <code>rain</code> (none, rain, thunder, storm, soaking) and <code>burning</code>, at every presence tick. <code>events</code>: <code>fire_started</code>, <code>fire_ended</code>, <code>volcano</code>, <code>earthquake</code>, <code>crater</code>, <code>god_power</code>, <code>creatures_arrived</code>, <code>world_ended</code> and <code>world_began</code>. <code>land</code> adds <code>scorch</code> and <code>algae</code>, and the stream sends it again right after an event that changes the land. All of it is additive: <code>protocol</code> stays 1.</p>
<pre>${escape(JSON.stringify(streams.fire.events.slice(0, 4), null, 1))}</pre>
</section>

<section id="tests">
<h2>Tests</h2>
<p>Renderer: ${tests.units} unit and ${tests.browser} browser tests listed. The atmosphere's unit tests were run for this report: <span class="pass">${units.passed} passed</span>, ${units.failed} failed. Python: weather (spell rates by season, kinds and lengths, the fire told each hour, state), lightning only in storms, rain slowing a fire, fire killing animals, a new cone or crater killing the animals on it, events staged outside a step seen as the step's own (<code>World.witness</code>), the v11 to v12 migration and fixture, the stream's staging and lands after events.</p>
<div class="two">
<div><h3>Browser (<code>tests/e2e/atmosphere.spec.ts</code>)</h3><ul>${tests.atmosphere.map((t) => `<li>${escape(t)}</li>`).join("")}</ul></div>
<div><h3>Unit (<code>tests/atmosphere/</code>)</h3><ul>${units.names.map((t) => `<li>${escape(t)}</li>`).join("")}</ul></div>
</div>
</section>

<section>
<h2>Commits</h2>
<pre>${escape(log.join("\n"))}</pre>
</section>

<section id="later">
<h2>Left for later</h2>
<ul>
<li><strong>R5</strong> measures all of this on the board. During a fire, up to a few hundred flames and halos are drawn; rain draws 180 drops and up to 80 ripples. R5 also tunes the look, the cone among it.</li>
<li><strong>Sanity checks</strong>: the ark lands only on land now (a fix in this round), and the seed sows only bare land; a milestone checking such rules across the sim was proposed to the owner.</li>
<li>A volcano's cone and a meteor's crater are drawn for 30 sim-days from their event. A renderer that connects later sees only the land's own shading, because the wire carries no "volcano" fact.</li>
<li><strong>M11</strong> re-checks fire frequency, mortality and chronicle numbers once R4 is in <code>main</code>.</li>
</ul>
</section>
</main>
<script>${CHART_SCRIPT}</script>
</body>
</html>
`;
const readme = [
  "# R4 — Atmosphere",
  "",
  "Every effect of the atmosphere filmed from the real renderer in the three views (the",
  "apocalypse on the map), from streams recorded for it with `tools/stream.py --stage`:",
  "`report.html`, one self-contained file (animated PNGs; open it in a browser).",
  "Decisions: ADR 0021.",
  "",
  `- Branch \`${branch}\` at \`${commit}\``,
  `- Atmosphere unit tests run for the report: ${units.passed} passed, ${units.failed} failed;`,
  `  renderer ${tests.units} unit and ${tests.browser} browser tests listed`,
  "- Films are caught in wall time; the streams are recorded afresh each run",
  "",
  "Regenerate with `cd renderer && npm run atmosphere` (`R4_REPORT_REUSE_STREAMS=1` keeps",
  "the streams already recorded); do not edit by hand. R4 has no statistical criterion.",
  "",
].join("\n");
await mkdir(OUT, { recursive: true });
await writeFile(new URL("report.html", OUT), html);
await writeFile(new URL("README.md", OUT), readme);
console.log(`wrote ${fileURLToPath(OUT)} (${(html.length / 1e6).toFixed(1)} MB)`);
