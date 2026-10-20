/**
 * Write the R4 report (the atmosphere) as one self-contained HTML file.
 *
 *   npm run atmosphere   builds the pages, then writes ../reports/R4-atmosphere/
 *
 * Serves the built scene, opens it in headless Chromium at the art pixels' own size
 * (512×300: one screen pixel an art pixel) and films it: the committed recordings played
 * as they are (`office`, `end`), and each event made up on demand (`?show=`). The films
 * are animated PNGs (`apng.mjs`), lossless, looping, playing without a script. They are
 * taken in wall time, so two runs differ in when a frame was caught, not in what the
 * scene draws. The chart and the tables are read from the committed recordings; the unit
 * tests of `tests/atmosphere/` are run while the report is written.
 */
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { preview } from "vite";
import { Apng, decodePng, png, shrink } from "./apng.mjs";

const OUT = new URL("../../reports/R4-atmosphere/", import.meta.url);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RENDERER = fileURLToPath(new URL("../", import.meta.url));
const WIDTH = 512;
const HEIGHT = 300;
/** The middle of the screen, a quarter of it: where events made up on demand happen. */
const MIDDLE = { x: 128, y: 75, width: 256, height: 150 };
const SHOW = "recording=autumn&every=0&quiet&seed=7";

/** A glowing animal, sent as the stream would (the fixture's world has none). */
async function glowingAnimal(page) {
  await page.evaluate(() =>
    window.__receive?.({
      type: "creatures",
      protocol: 1,
      t_ms: 0,
      ids: [900001, 900002],
      positions: [
        [120, 60],
        [121.5, 61],
      ],
      species: [1, 1],
      born: [
        { id: 900001, genome: Array.from({ length: 32 }, () => 0.5), slots: 128 },
        {
          id: 900002,
          genome: Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? 0.8 : 0.4)),
          slots: 128,
        },
      ],
      torpid: [],
    }),
  );
}

/**
 * The films: where the page goes, what is filmed (`clip`, or the whole map at one pixel
 * a cell with `half`), how many frames how far apart, and for the end of a world how far
 * its sequence is moved on between frames (a time-lapse).
 */
const FILMS = {
  day: {
    query: "recording=office&speed=7200&quiet&seed=7&view=map",
    half: true,
    frames: 40,
    everyMs: 200,
  },
  glow: {
    query: "recording=office&every=0&quiet&seed=7&view=local&x=120&y=60&show=night",
    setup: glowingAnimal,
    clip: MIDDLE,
    frames: 40,
    everyMs: 80,
  },
  "fire-middle": {
    query: `${SHOW}&view=middle&x=120&y=60&show=night,fire`,
    clip: MIDDLE,
    frames: 26,
    everyMs: 80,
  },
  "fire-local": {
    query: `${SHOW}&view=local&x=120&y=60&show=night,fire`,
    clip: MIDDLE,
    frames: 26,
    everyMs: 80,
  },
  rain: {
    query: `${SHOW}&view=middle&x=120&y=60&show=day,rain`,
    clip: MIDDLE,
    frames: 20,
    everyMs: 60,
  },
  volcano: {
    query: `${SHOW}&view=middle&x=120&y=60&show=day,volcano`,
    clip: MIDDLE,
    frames: 36,
    everyMs: 120,
  },
  "volcano-night": {
    query: `${SHOW}&view=middle&x=120&y=60&show=night,volcano`,
    clip: MIDDLE,
    frames: 28,
    everyMs: 120,
  },
  quake: {
    query: `${SHOW}&view=middle&x=120&y=60&show=day,quake`,
    clip: MIDDLE,
    frames: 30,
    everyMs: 80,
  },
  meteor: {
    query: `${SHOW}&view=middle&x=120&y=60&show=dusk,meteor`,
    clip: MIDDLE,
    frames: 44,
    everyMs: 80,
  },
  seed: {
    query: `${SHOW}&view=middle&x=120&y=60&show=night,seed`,
    clip: MIDDLE,
    frames: 36,
    everyMs: 120,
  },
  ark: {
    query: `${SHOW}&view=middle&x=120&y=60&show=dusk,ark`,
    clip: MIDDLE,
    frames: 36,
    everyMs: 120,
  },
  waves: {
    query: "recording=autumn&every=0&quiet&seed=7&view=map",
    clip: { x: 0, y: 150, width: 200, height: 130 },
    frames: 40,
    everyMs: 70,
  },
  end: {
    query: "recording=end&speed=20000&quiet&seed=3",
    waitFor: () => typeof window.__atmosphere?.().act === "string",
    half: true,
    frames: 72,
    everyMs: 30,
    advanceS: 2.5,
    delayMs: 110,
  },
};

/** Moments of the end of a world shown as stills (act, seconds into the sequence). */
const MOMENTS = [
  ["omen", 15],
  ["fire", 50],
  ["flood", 95],
  ["dark", 130],
  ["rise", 165],
];

/** The light of each time of day, on the map (stills). */
const STILLS = ["day", "dawn", "dusk", "night", "moon"];

async function settle(page, address, query, waitFor) {
  await page.goto(`${address}?${query}`);
  await page.waitForFunction(waitFor ?? (() => window.__sceneSettled?.() === true), null, {
    timeout: 120_000,
  });
}

async function shoot(page, film) {
  const shot = await page.screenshot({
    clip: film.clip ?? { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  const image = decodePng(shot);
  return film.half ? shrink(image, 2) : image;
}

async function makeFilm(page, address, film) {
  await settle(page, address, film.query, film.waitFor);
  if (film.setup !== undefined) await film.setup(page);
  const pictures = [];
  for (let frame = 0; frame < film.frames; frame++) {
    if (film.advanceS !== undefined)
      await page.evaluate((s) => window.__advance?.(s), film.advanceS);
    await page.waitForTimeout(film.everyMs);
    const at = Date.now();
    pictures.push({ at, image: await shoot(page, film) });
  }
  const { width, height } = pictures[0].image;
  const apng = new Apng(width, height);
  pictures.forEach(({ at, image }, index) => {
    const next = pictures[index + 1]?.at ?? at + film.everyMs + 40;
    apng.add(image.rgb, film.delayMs ?? next - at);
  });
  const seconds =
    pictures.reduce(
      (sum, _, i) =>
        sum +
        (film.delayMs ??
          (pictures[i + 1]?.at ?? pictures[i].at + film.everyMs + 40) - pictures[i].at),
      0,
    ) / 1000;
  return { bytes: apng.bytes(), width, height, frames: pictures.length, seconds, pictures };
}

/** The light's colours, as \`src/atmosphere/light.ts\` has them (read from it, not copied). */
async function lightValues() {
  const source = await readFile(new URL("../src/atmosphere/light.ts", import.meta.url), "utf8");
  const rgb = (text) => text.split(",").map((value) => Number(value.trim()));
  const named = (name) => {
    const found = new RegExp(`export const ${name}: Rgb = \\[([^\\]]+)\\]`).exec(source);
    if (found === null) throw new Error(`light.ts: no ${name}`);
    return rgb(found[1]);
  };
  const seasons = /SEASON_DAY[^{]*\{([^}]+)\}/.exec(source)?.[1] ?? "";
  const SEASON_DAY = Object.fromEntries(
    [...seasons.matchAll(/(\w+): \[([^\]]+)\]/g)].map((match) => [match[1], rgb(match[2])]),
  );
  return {
    NIGHT: named("NIGHT"),
    DUSK: named("DUSK"),
    DAWN: named("DAWN"),
    RAIN_GREY: named("RAIN_GREY"),
    SEASON_DAY,
  };
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
  const file = fileURLToPath(
    new URL("../node_modules/.cache-atmosphere-tests.json", import.meta.url),
  );
  execFileSync(
    "npx",
    ["vitest", "run", "tests/atmosphere", "--reporter=json", `--outputFile=${file}`],
    {
      cwd: RENDERER,
      stdio: "ignore",
    },
  );
  const result = JSON.parse(readFileSync(file, "utf8"));
  return {
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    names: result.testResults.flatMap((file) =>
      file.assertionResults.map((test) => ({
        file: file.name.replace(`${RENDERER}`, ""),
        name: [...test.ancestorTitles, test.title].join(" › "),
        status: test.status,
      })),
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

/** The sky of a recording: time (days from its start), light, presence, rain. */
async function skies(name) {
  const document = JSON.parse(
    await readFile(new URL(`../public/stream/${name}.json`, import.meta.url), "utf8"),
  );
  const messages = document.messages;
  const counts = {};
  const bytes = {};
  for (const message of messages) {
    counts[message.type] = (counts[message.type] ?? 0) + 1;
    bytes[message.type] = (bytes[message.type] ?? 0) + JSON.stringify(message).length;
  }
  const clocks = messages.filter((m) => m.type === "clock");
  const first = clocks[0];
  const sky = messages.filter((m) => m.type === "sky");
  const t0 = sky[0]?.t_ms ?? 0;
  return {
    messages,
    counts,
    bytes,
    first,
    last: clocks[clocks.length - 1],
    points: sky.map((m) => ({
      d: (m.t_ms - t0) / 86_400_000,
      light: m.light,
      present: m.present,
      rain: m.raining,
    })),
    events: messages.filter((m) => m.type === "events").flatMap((m) => m.events),
    entries: messages.filter((m) => m.type === "chronicle").flatMap((m) => m.entries),
    size: JSON.stringify(document).length,
  };
}

/** The light over the office fortnight, as an SVG drawn to scale. */
function lightChart(record) {
  const W = 960;
  const H = 300;
  const left = 96;
  const right = 16;
  const top = 16;
  const bottom = 44;
  const days = Math.ceil(record.points[record.points.length - 1]?.d ?? 14);
  const x = (d) => left + ((W - left - right) * d) / days;
  const y = (v) => top + (H - top - bottom) * (1 - v);
  const bands = (key) => {
    const out = [];
    let start = null;
    record.points.forEach((p, i) => {
      if (p[key] && start === null) start = p.d;
      const next = record.points[i + 1];
      if (start !== null && (!next || !next[key])) {
        out.push([start, next ? next.d : p.d]);
        start = null;
      }
    });
    return out;
  };
  const present = bands("present")
    .map(
      ([a, b]) =>
        `<rect x="${x(a).toFixed(1)}" y="${top}" width="${Math.max(x(b) - x(a), 1).toFixed(1)}" height="${H - top - bottom}" fill="var(--desk)"/>`,
    )
    .join("");
  const rain = bands("rain")
    .map(
      ([a, b]) =>
        `<rect x="${x(a).toFixed(1)}" y="${H - bottom + 6}" width="${(x(b) - x(a)).toFixed(1)}" height="6" rx="2" fill="var(--rain)"/>`,
    )
    .join("");
  const line = record.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.d).toFixed(1)},${y(p.light).toFixed(1)}`)
    .join("");
  const start = new Date(`${record.first.date}T00:00:00Z`);
  const ticks = Array.from({ length: days + 1 }, (_, d) => {
    const date = new Date(start.getTime() + d * 86_400_000);
    const label =
      d % 2 === 0 && d < days ? `${date.toUTCString().slice(0, 3)} ${date.getUTCDate()}` : "";
    return `<line x1="${x(d)}" x2="${x(d)}" y1="${top}" y2="${H - bottom}" stroke="var(--grid)"/>${label ? `<text x="${x(d) + 3}" y="${H - bottom + 28}" class="tick">${label}</text>` : ""}`;
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
    record.points
      .filter((_, i) => i % 3 === 0)
      .map((p) => [Number(p.d.toFixed(4)), p.light, p.present ? 1 : 0, p.rain ? 1 : 0]),
  );
  return `<div class="chart" data-start="${start.getTime()}" data-days="${days}" data-left="${left}" data-right="${right}" data-width="${W}">
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="The sim's light over the office fortnight, sampled every ten sim-minutes">
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
    tip.textContent = when.toUTCString().slice(0, 22) + " UTC · light " + best[1].toFixed(2) + (best[2] ? " · at the desk" : " · away") + (best[3] ? " · rain" : "");
    tip.style.left = Math.min(Math.max((px / width) * box.width - 90, 0), box.width - 200) + "px";
  });
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}`;

function filmFigure(name, film, title, text, query, wide = false) {
  return `<figure class="film${wide ? " wide" : ""}">
<img src="${uri(film.bytes)}" width="${film.width}" height="${film.height}" alt="${escape(title)}" style="aspect-ratio:${film.width}/${film.height}">
<figcaption><strong>${escape(title)}</strong> ${text} <span class="meta">${film.frames} frames, ${film.seconds.toFixed(1)} s loop · <code>/?${escape(query)}</code></span></figcaption>
</figure>`;
}

const swatch = (rgb) => {
  const hex = `#${rgb
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
  return `<span class="swatch" style="background:${hex}"></span><code>${hex}</code> <span class="meta">[${rgb.join(", ")}]</span>`;
};

const server = await preview({ logLevel: "silent" });
const browser = await chromium.launch();
const errors = [];
try {
  const address = server.resolvedUrls?.local[0];
  if (address === undefined) throw new Error("the preview server gave no address");
  const page = await browser.newPage({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(600_000);
  page.on("pageerror", (error) => errors.push(error.message));

  const films = {};
  for (const [name, film] of Object.entries(FILMS)) {
    films[name] = await makeFilm(page, address, film);
    console.log(
      `filmed ${name}: ${films[name].frames} frames, ${(films[name].bytes.length / 1e3).toFixed(0)} kB`,
    );
  }
  const stills = {};
  for (const name of STILLS) {
    await settle(
      page,
      address,
      `recording=autumn&every=0&still&quiet&seed=7&view=map&show=${name}`,
    );
    await page.waitForTimeout(100);
    stills[name] = png(await shoot(page, { half: true }));
  }
  if (errors.length > 0) throw new Error(`the scene failed: ${errors.join("; ")}`);

  const office = await skies("office");
  const end = await skies("end");
  const units = unitTests();
  const tests = listed();
  const commit = git("rev-parse", "--short", "HEAD");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const log = git("log", "--format=%h %s", "main..HEAD").split("\n").filter(Boolean);
  const changed = git("diff", "--stat", "main..HEAD").split("\n").pop();
  const { NIGHT, DUSK, DAWN, SEASON_DAY, RAIN_GREY } = await lightValues();

  const ACTS = [
    ["omen", 20, "the sky reddens whatever the hour; ash starts to fall across the screen"],
    [
      "fire",
      40,
      "40 lava vents open on high land, each with lava running from it and ash rising; a quake jolts the picture every 6 s",
    ],
    [
      "flood",
      60,
      "a risen sea, one pixel to the cell in the sea's depth bands with foam at its edge, covers the land from the lowland up; vents under it go out; the last peak goes under",
    ],
    [
      "dark",
      20,
      "nothing but black; the next world's land and animals, held since the end, are laid out behind it",
    ],
    [
      "rise",
      40,
      "the light comes back and the sea falls away from the new continent, peaks first; the next world's first chronicle lines are let through",
    ],
  ];
  const ended = end.entries.filter((e) =>
    ["last_creature", "world_end", "world_begin"].includes(e.kind),
  );
  const sampleSky =
    office.messages.find((m) => m.type === "sky" && m.raining) ??
    office.messages.find((m) => m.type === "sky");
  const sampleEvents = end.messages.find((m) => m.type === "events");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>R4 Atmosphere Report</title>
<style>
/* Layout: one reading column of prose and tables; films break out wider, pixelated, on a night-blue mat. */
:root {
  --bg: #eef1f6; --fg: #182033; --muted: #56607a; --panel: #ffffff; --line: #d3d9e4;
  --accent: #b4475e; --mat: #1d2440; --desk: rgba(232, 176, 92, 0.22); --rain: #4f7fb8; --grid: #e2e6ee;
  --pass: #2f7d4f;
  --body: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #11151f; --fg: #e3e7f0; --muted: #98a1b8; --panel: #191f2c; --line: #2c3446;
  --accent: #f08aa0; --mat: #0a0d16; --desk: rgba(232, 176, 92, 0.16); --rain: #7aa7dc; --grid: #262d3c; --pass: #6cc493;
  color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #11151f; --fg: #e3e7f0; --muted: #98a1b8; --panel: #191f2c; --line: #2c3446;
  --accent: #f08aa0; --mat: #0a0d16; --desk: rgba(232, 176, 92, 0.16); --rain: #7aa7dc; --grid: #262d3c; --pass: #6cc493;
  color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.55 var(--body); }
main { max-width: 1120px; margin: 0 auto; padding-block: 32px 64px; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); display: grid; gap: 28px; }
main > p, main > ul, main > ol, section > p, section > ul { max-width: 70ch; margin: 0; }
section { display: grid; gap: 16px; }
h1 { font-size: 2.1rem; line-height: 1.15; margin: 0; text-wrap: balance; }
h2 { font-size: 1.45rem; margin: 12px 0 0; padding-top: 18px; border-top: 1px solid var(--line); text-wrap: balance; }
h3 { font-size: 1.1rem; margin: 4px 0 0; }
.eyebrow { font: 600 0.78rem/1 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); margin: 0; }
.meta, figcaption .meta { color: var(--muted); font-size: 0.85rem; }
code { font-family: var(--mono); font-size: 0.86em; overflow-wrap: anywhere; }
dl.header { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; font-size: 0.92rem; }
dl.header dt { color: var(--muted); }
dl.header dd { margin: 0; min-width: 0; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 0.92rem; font-variant-numeric: tabular-nums; }
th, td { text-align: left; vertical-align: top; padding: 7px 10px; border-bottom: 1px solid var(--line); }
th { color: var(--muted); font-weight: 600; font-size: 0.8rem; letter-spacing: 0.04em; text-transform: uppercase; }
.pass { color: var(--pass); font-weight: 700; }
td:first-child code { white-space: nowrap; }
.films { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 20px; }
figure.film { margin: 0; display: grid; gap: 8px; min-width: 0; }
figure.film img, .stills img { display: block; width: 100%; height: auto; max-width: 100%; image-rendering: pixelated; background: var(--mat); border-radius: 4px; }
figure.film.wide img { max-width: 1024px; }
figcaption { font-size: 0.92rem; color: var(--fg); }
figcaption strong { display: block; }
.stills { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: 12px; }
.stills figure { margin: 0; display: grid; gap: 4px; font-size: 0.85rem; }
.swatch { display: inline-block; width: 1.1em; height: 1.1em; border-radius: 3px; vertical-align: -0.2em; border: 1px solid var(--line); margin-right: 6px; }
.chart { position: relative; }
.chart svg { display: block; width: 100%; height: auto; border-radius: 4px; }
.chart .tick { font: 12px var(--mono); fill: var(--muted); }
.tip { position: absolute; top: 4px; background: var(--fg); color: var(--bg); font: 12px var(--mono); padding: 4px 8px; border-radius: 3px; pointer-events: none; white-space: nowrap; }
.key { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.85rem; color: var(--muted); }
.key span::before { content: ""; display: inline-block; width: 14px; height: 10px; margin-right: 6px; border-radius: 2px; background: var(--k); vertical-align: 0; }
pre { margin: 0; background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 12px; overflow-x: auto; font: 12.5px/1.45 var(--mono); }
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 380px), 1fr)); gap: 16px; }
.two > * { min-width: 0; }
blockquote { margin: 0; padding: 8px 14px; border-left: 3px solid var(--accent); background: var(--panel); }
@media (prefers-reduced-motion: reduce) { figure.film img { animation: none; } }
</style>
</head>
<body>
<main>
<header style="display:grid;gap:14px">
<p class="eyebrow">Lineage · milestone report</p>
<h1>R4 — Atmosphere</h1>
<p>The light of the owner's presence over the island, what glows in the dark, the weather of the island's events, and the end of a world, drawn in the scene from the state stream. Waves now break on every coast in every view, the map's too. Everything below is filmed from the real renderer at its art pixels' own size (one image pixel per art pixel; the map films at one pixel per cell). The films loop and play in any browser.</p>
<dl class="header">
<dt>Milestone</dt><dd>R4 (CLAUDE.md §8), decisions in ADR 0021</dd>
<dt>Branch</dt><dd><code>${escape(branch)}</code> at <code>${commit}</code>, ${log.length} commits on <code>main</code> (${escape(changed)})</dd>
<dt>Status</dt><dd>Built 2026-10-20 and tested on the PC; not merged, waiting for the owner. Device measurements are R5's.</dd>
<dt>Recordings</dt><dd><code>office.json</code>: ${office.first.date} to ${office.last.date}, ${office.counts.sky} skies; <code>end.json</code>: ${end.first.date}, a world's end and the next (from the v9 fixture save)</dd>
<dt>Written</dt><dd>${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC by <code>cd renderer &amp;&amp; npm run atmosphere</code></dd>
</dl>
</header>

<section>
<h2>What was asked, and what was built</h2>
<div class="table"><table>
<thead><tr><th>Deliverable</th><th>As built</th><th>Where it is shown</th></tr></thead>
<tbody>
<tr><td>Day/night tint from presence</td><td>Moonlit-blue nights, rose dusks (owner away), lilac dawns (owner back), eased between the sim's 10-minute light steps</td><td><a href="#light">The light</a></td></tr>
<tr><td>Glow pass</td><td>Additive halos over the tint: animals with the glow gene, fires, lava, sparks, beams; as strong as it is dark</td><td><a href="#glow">Glow</a></td></tr>
<tr><td>Seasons</td><td>The day's light graded by the season, turning to the next season's over each season's second half (plants and snow were R1's)</td><td><a href="#light">The light</a></td></tr>
<tr><td>Weather of events</td><td>Rain, fire smoke and flames, volcano lava and ash, quake shake and dust, meteor streak, flash and dust, seed and ark light, lightning flash</td><td><a href="#weather">Weather</a></td></tr>
<tr><td>Apocalypse sequence</td><td>Three minutes on the map: omen, fire, flood, dark, rise; the button waits; the next world is held back until the dark</td><td><a href="#end">The end of a world</a></td></tr>
<tr><td>Waves on every coast, the map too (owner, R3 demo)</td><td>The map is painted with the three surf bands and the sea brings them in</td><td><a href="#waves">Waves</a></td></tr>
<tr><td>Tests: snapshots per lighting state</td><td>${tests.atmosphere.length} browser tests of the atmosphere, 15 of them snapshots; atmosphere unit tests run for this report: <span class="pass">${units.passed} passed</span>, ${units.failed} failed</td><td><a href="#tests">Tests</a></td></tr>
</tbody></table></div>
</section>

<section>
<h2>The owner's choices</h2>
<p>Asked before any code was written (2026-10-20), as the R4 brief required.</p>
<div class="table"><table>
<thead><tr><th>Question</th><th>Answer</th></tr></thead>
<tbody>
<tr><td>How dark is a night?</td><td>Moonlit blue: land, sea and animals still read, glowing things stand out</td></tr>
<tr><td>Does the tint follow the light step by step, or ease?</td><td>It eases between the 10-minute steps</td></tr>
<tr><td>What does the apocalypse show, and for how long?</td><td>The dramatic one, about three minutes: red sky, volcanoes and ash, quakes, the sea swallowing the land, darkness, the new continent rising</td></tr>
<tr><td>Which events get weather?</td><td>All of them: rain, fire, volcano, quake, meteor and crater, seed and ark</td></tr>
</tbody></table></div>
</section>

<section id="light">
<h2>The light</h2>
<p>One sprite multiplied over the land, its plants and animals. The scroll and the dip between views are page elements and keep their own colours. Below, the map in each light, then a sim-day of the office recording played at 7 200 sim-seconds a second (a day in 12 s): night, the owner arriving at about 9:00 (a half-hour dawn), day, leaving at about 18:00 (a 1.5-hour dusk), night again.</p>
<div class="stills">
${STILLS.map((name) => `<figure><img src="${uri(stills[name])}" width="256" height="150" alt="The map at ${name}"><figcaption><strong>${name}</strong> <code>?show=${name}</code></figcaption></figure>`).join("")}
</div>
${filmFigure("day", films.day, "A day at the desk, on the map", "The office recording from midnight. The light eases from step to step; nothing jumps.", FILMS.day.query, true)}
<h3>The colours</h3>
<div class="table"><table>
<thead><tr><th>Light</th><th>Multiplier</th><th>When</th></tr></thead>
<tbody>
<tr><td>Night</td><td>${swatch(NIGHT)}</td><td>The sim's light at 0.05 (<code>night_light</code>); the moonlight floor 0.15 is a little brighter on the same way to day</td></tr>
<tr><td>Dusk</td><td>${swatch(DUSK)}</td><td>Most coloured 35 % of the way from night to day, while the owner is away</td></tr>
<tr><td>Dawn</td><td>${swatch(DAWN)}</td><td>The same, while the owner is at the desk</td></tr>
${Object.entries(SEASON_DAY)
  .map(
    ([season, rgb]) =>
      `<tr><td>Day, ${season}</td><td>${swatch(rgb)}</td><td>In the middle of ${season}; turning to the next over its second half</td></tr>`,
  )
  .join("")}
<tr><td>Rain</td><td>${swatch(RAIN_GREY)}</td><td>Multiplied in while the rain power's rain falls, set in and cleared over 3 s</td></tr>
</tbody></table></div>
<h3>The light the scene is given</h3>
<p>The <code>sky</code> messages of <code>office.json</code>, one every ten sim-minutes: the owner's office schedule from the fast-forward (<code>tools.schedules</code>), weekdays at the desk from about 9:00 to 18:00, weekends away (the Long Night). Wherever the owner has been away 72 hours or more the light rests on the moonlight floor of 0.15. The god-power button was pressed on days 2, 6 and 13. Day 2 was refused (cooling down since the save), and days 6 and 13 brought rain. Hover for the values.</p>
<div class="key"><span style="--k:var(--accent)">the light (0–1)</span><span style="--k:var(--desk)">owner at the desk</span><span style="--k:var(--rain)">the rain power's rain</span></div>
${lightChart(office)}
</section>

<section id="glow">
<h2>Glow</h2>
<p>Halos in five steps of a 48-texel disc, added over the tint so they show through the night. They are never drawn more than three times the disc's size, so each step stays a few art pixels wide. An animal with the glow gene shines at every other joint of its back as strongly as it is dark, and not at all by day. The fixture's world has no glow carrier, so two are sent as the stream would send them (the browser test does the same).</p>
<div class="films">
${filmFigure("glow", films.glow, "Two glowing animals at night, local view", "Their spots light the ground round them; the halos breathe slowly.", FILMS.glow.query + " + two animals with the glow gene")}
${filmFigure("fire-middle", films["fire-middle"], "A fire at night, middle view", "A wide glow over the whole fire, then for each burning cell a flicker off its middle and flames licking up; smoke drifts with the wind.", FILMS["fire-middle"].query)}
</div>
</section>

<section id="weather">
<h2>Weather of events</h2>
<p>Every effect here comes from an <code>events</code> or <code>sky</code> message. Smoke, ash, dust, flames and rain are slots that go round cycles of their own. Where a slot is depends only on its number and the time, as with the sea's glints, so nothing is kept from frame to frame. Short things last wall seconds so that they read at any speed. A volcano lasts 12 sim-hours, and at least 30 wall seconds. In these films the events are made up on demand on the land in sight (<code>?show=</code>); the scene draws them exactly as it would draw the stream's.</p>
<div class="films">
${filmFigure("fire-local", films["fire-local"], "Fire, local view", "Close up, more flames to a cell.", FILMS["fire-local"].query)}
${filmFigure("rain", films.rain, "Rain", "While the rain god power's rain falls (5 sim-days); the day greys.", FILMS.rain.query)}
${filmFigure("volcano", films.volcano, "A volcano erupting by day", "Lava glow at the cone, lava running down its sides, a dark ash column drifting with the wind, embers.", FILMS.volcano.query)}
${filmFigure("volcano-night", films["volcano-night"], "The same at night", "The lava's glow carries the picture.", FILMS["volcano-night"].query)}
${filmFigure("quake", films.quake, "An earthquake", "The picture jolts for 4 s, dying away, and dust rises over the fault.", FILMS.quake.query)}
${filmFigure("meteor", films.meteor, "A meteor (the meteor god power)", "A streak from high up, a flash over the screen as it strikes, a glow and dust where it digs its crater.", FILMS.meteor.query)}
${filmFigure("seed", films.seed, "The seed god power", "Golden motes fall onto the place and a soft light gathers there for 8 s.", FILMS.seed.query)}
${filmFigure("ark", films.ark, "The ark god power", "A beam of pale light from above and motes where the newcomers land.", FILMS.ark.query)}
</div>
<p class="meta">Not drawn: falling snow (snow lies where the sim has it, R1) and lightning bolts (a fire's start flashes the screen). The camera does not go to events; only a world's end takes it.</p>
</section>

<section id="waves">
<h2>Waves on the map</h2>
<p>An owner's note from the R3 demo. The map is now painted with the three surf bands of the closer views, a line far out, one nearer and the foam at the shore, and the sea shows them in turn as a crest comes in (3.6 s a swell).</p>
${filmFigure("waves", films.waves, "A coast on the map, at its own size", "The west of the autumn recording's island.", FILMS.waves.query)}
</section>

<section id="end">
<h2>The end of a world</h2>
<p>From <code>end.json</code>: the v9 world played for a day under the office schedule, then starved (<code>tools/stream.py --famine-day 2</code>). The sim ended the world its own way: the last creature's death, the archive, the next seed, a new continent of bare rock. The film is a time-lapse: the 180-second sequence is moved on 2.5 s a frame and shown at about 9 frames a second, so it plays in about 8 s. On the screen it plays in real time, on the map whatever view was showing. The view button waits.</p>
${filmFigure("end", films.end, "World 1 ends and world 2 rises (time-lapse)", "Red sky and ash, lava vents and quakes, the sea rising over the land, the dark, the new continent rising from the sea at night (the office schedule says nobody is at the desk).", FILMS.end.query + " + __advance", true)}
<div class="stills">
${MOMENTS.map(([act, t]) => {
  const picture =
    films.end.pictures[
      Math.min(Math.round(t / FILMS.end.advanceS) - 1, films.end.pictures.length - 1)
    ];
  return `<figure><img src="${uri(png(picture.image))}" width="${picture.image.width}" height="${picture.image.height}" alt="The end of a world: ${act}"><figcaption><strong>${act}</strong> about ${t} s in</figcaption></figure>`;
}).join("")}
</div>
<div class="table"><table>
<thead><tr><th>Act</th><th>Seconds</th><th>What it shows</th></tr></thead>
<tbody>${ACTS.map(([act, s, what]) => `<tr><td>${act}</td><td>${s}</td><td>${what}</td></tr>`).join("")}</tbody></table></div>
<h3>What the scroll tells</h3>
<p>The chronicle's own lines, as the sim wrote them. The world's last lines come before its <code>world_ended</code> on the wire, so they are told as the sequence begins. The next world's are held until the rise.</p>
${ended.map((e) => `<blockquote><span class="meta">${escape(e.kind)}, importance ${e.importance}</span><br>${escape(e.text)}</blockquote>`).join("")}
</section>

<section id="wire">
<h2>On the wire</h2>
<p>Two new messages, both additive, so <code>protocol</code> stays 1 (<code>schema.json</code>, <code>encode.py</code>). The sim gained one read-only property, <code>Presence.raining</code>, with no persisted field and no schema bump.</p>
<div class="two">
<div><h3><code>sky</code></h3><p class="meta">On connect and at every presence tick (10 sim-minutes).</p><pre>${escape(JSON.stringify(sampleSky, null, 1))}</pre></div>
<div><h3><code>events</code></h3><p class="meta">What the scene shows of a step's outputs; after <code>world_ended</code> every message is of the next world.</p><pre>${escape(JSON.stringify(sampleEvents, null, 1))}</pre></div>
</div>
<p>Kinds: <code>fire_started</code>, <code>fire_ended</code>, <code>volcano</code>, <code>earthquake</code>, <code>crater</code>, <code>god_power</code>, <code>world_ended</code>, <code>world_began</code>. <code>chronicle</code> messages are now built from a step's outputs, so a world's last lines and the next world's first both travel.</p>
<h3>The recordings</h3>
<div class="table"><table>
<thead><tr><th>Recording</th><th>Span</th><th>Messages by type</th><th>Size</th><th>Made with</th></tr></thead>
<tbody>
${[
  [
    "office",
    office,
    "--days 14 --land-every 7 --creatures --creatures-every 7200 --sky-every 600 --schedule office --press-days 2,6,13",
  ],
  [
    "end",
    end,
    "--days 3 --land-every 3 --creatures --creatures-every 7200 --sky-every 600 --schedule office --famine-day 2",
  ],
]
  .map(
    ([name, r, args]) =>
      `<tr><td><code>${name}.json</code></td><td>${r.first.date} → ${r.last.date}</td><td>${Object.entries(
        r.counts,
      )
        .map(([t, n]) => `${t} ${n}`)
        .join(
          ", ",
        )}</td><td>${(r.size / 1e6).toFixed(2)} MB</td><td><code>tools.stream v9.lzma ${args}</code></td></tr>`,
  )
  .join("")}
</tbody></table></div>
<p class="meta">Events in the office fortnight: ${office.events.map((e) => `${e.kind}${e.power ? ` (${e.power})` : ""}`).join(", ") || "none"}. No fire or volcano happened in those two weeks, so they are filmed on demand.</p>
</section>

<section id="tests">
<h2>Tests</h2>
<p>Renderer: ${tests.units} unit tests and ${tests.browser} browser tests in all, listed while this report was written (255 and 25 before R4). The atmosphere's unit tests were also run: <span class="pass">${units.passed} passed</span>, ${units.failed} failed. Python: protocol tests for <code>sky</code> and <code>events</code>, stream tests for the office schedule, the button and a famine's world end, and a presence test of <code>raining</code>. The fast suite passed at the R4 build (660 passed, 1 skipped).</p>
<div class="two">
<div><h3>Browser (<code>tests/e2e/atmosphere.spec.ts</code>)</h3><ul>${tests.atmosphere.map((t) => `<li>${escape(t)}</li>`).join("")}</ul></div>
<div><h3>Unit (<code>tests/atmosphere/</code>)</h3><ul>${units.names.map((t) => `<li>${escape(t.name)}</li>`).join("")}</ul></div>
</div>
<p>The R1 scene and R3 scroll baselines were regenerated for the map's surf and the season's grade; each was already within its tolerance.</p>
</section>

<section>
<h2>Commits</h2>
<pre>${escape(log.join("\n"))}</pre>
</section>

<section>
<h2>Left for later</h2>
<ul>
<li><strong>R5</strong> measures all of it on the board. Per frame that is one multiplied sprite, up to a few hundred additive halos in a big fire and 180 raindrops; during an apocalypse, a world-sized texture is also repainted ten times a second. R5 keeps <code>Director.toMap</code>, which the apocalypse uses.</li>
<li><strong>S1</strong> sends <code>sky</code> at every presence tick, and <code>chronicle</code> and <code>events</code> from each step's outputs in the order <code>tools/stream.py</code> uses.</li>
<li>Events off the screen go unseen; only a world's end moves the camera.</li>
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
    "The light of the owner's presence, the glow pass, the weather of events, the end of a",
    "world and waves on the map, filmed from the real renderer: `report.html`, one",
    "self-contained file (animated PNGs; open it in a browser). Decisions: ADR 0021.",
    "",
    `- Branch \`${branch}\` at \`${commit}\`; recordings \`office.json\`, \`end.json\` (v9 fixture)`,
    `- Atmosphere unit tests run for the report: ${units.passed} passed, ${units.failed} failed;`,
    `  renderer ${tests.units} unit and ${tests.browser} browser tests listed`,
    `- ${Object.keys(films).length} films and ${STILLS.length} stills; the films are caught in wall time`,
    "",
    "Regenerate with `cd renderer && npm run atmosphere`; do not edit by hand. R4 has no",
    "statistical criterion: this is a view of what was built, measured on the PC; the",
    "board's numbers are R5's.",
    "",
  ].join("\n");
  await mkdir(OUT, { recursive: true });
  await writeFile(new URL("report.html", OUT), html);
  await writeFile(new URL("README.md", OUT), readme);
  console.log(`wrote ${fileURLToPath(OUT)} (${(html.length / 1e6).toFixed(1)} MB)`);
} finally {
  await browser.close();
  await server.close();
}
