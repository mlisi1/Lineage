/**
 * The look sheet: how the renderer draws the two views of the world, and the proposals
 * to choose between for each part of them.
 *
 *   look.html             live: creatures walk, pictures on screen keep updating
 *   look.html?still=8     let the creatures walk for 8 s, then draw every picture once
 *
 * `npm run look` turns the still page into a self-contained report. The words are in
 * look.html; this file fills in the pictures.
 */
import { DESIGN_HEIGHT, DESIGN_WIDTH } from "../scene";
import { ApngWriter, dataUri } from "./apng";
import { PATTERNS, bodyPlan, kindOf, patternOf } from "./body";
import type { CellRect } from "./camera";
import type { Point } from "./chain";
import type { CreatureLayer } from "./creatures";
import { parseFixture, type Cast, type CreatureSeed, type WorldFixture } from "./fixture";
import { MAP_TILE, MID_TILE, paintGround } from "./ground";
import { heightAt, type Passable } from "./habitat";
import { LIGHT_ORDER } from "./light";
import { hexToRgb, type Form, type Stage as Age } from "./pixelart";
import {
  FLOWER,
  FLOWER_COLOURS,
  PLANT_SCALES,
  STONE,
  colourArt,
  drawFlower,
  drawStanding,
  drawStone,
  type PlantArt,
  type PlantScale,
} from "./plantart";
import { standingPlants } from "./plants";
import {
  GROUND,
  LOCAL_PIXELS,
  LOCAL_ZOOMS,
  MAP_GROUND,
  MID_BODY,
  PLANTS,
  localBody,
} from "./proposal";
import { mulberry32, type Random } from "./rng";
import { findSite, forest, meadow, shore } from "./sites";
import { Stage, type Picture } from "./stage";

/** Replaced by Vite with the commit the page was built from. */
declare const __BUILD_COMMIT__: string;

declare global {
  interface Window {
    /** Set once every picture has been drawn (the report script waits for it). */
    __lookReady?: boolean;
    /**
     * The page as one self-contained HTML document, pictures as inline images. With
     * `film`, the pictures with animals in them are loops of that many seconds at that
     * many frames a second, which play without a script.
     */
    __lookStandalone?: (film?: { seconds: number; fps: number }) => Promise<string>;
  }
}

/** Screen pixels per art pixel: settled when the painted ground was chosen. */
const ART = 2;
/** A view: what the screen holds, in art pixels. */
const VIEW = { width: DESIGN_WIDTH / ART, height: DESIGN_HEIGHT / ART };
/** Portraits: an animal on its patch of ground, and smaller ones on one flat colour. */
const SPECIMEN = { width: 112, height: 88, enlarged: 2 };
/** Bare heights (rock, snow) make a poor meadow: land this far above the sea is passed over. */
const MEADOW_BELOW = 0.2;
const SWATCH = { width: 80, height: 64, enlarged: 2 };
/** The zoom of the smaller portraits: the nearest of the local view's, to fit the largest animal. */
const SWATCH_PIXELS = LOCAL_ZOOMS[0];
/** How far from the middle of its picture the animal a local picture is about may go, in cells. */
const SUBJECT_PEN = { x: 2.2, y: 1.3 };
const COMPANY_PEN = { x: 5, y: 3 };
const SPECIMEN_PEN = { x: 0.8, y: 0.55 };
/** Members of the world's own herd that join the specimens in the middle view's staged shot. */
const HERD_IN_STAGED_SHOT = 10;
/** Cells kept clear of a region's edge when placing creatures in it. */
const PLACING_MARGIN = 3;
const PLACING_TRIES = 300;
/** Cells painted beyond a picture's edge, so that the shore's outline has what to meet. */
const PAINT_MARGIN = 1;
/** Longest step of the animation, so a stalled tab does not teleport anybody. */
const MAX_STEP_S = 0.1;
const STILL_STEP_S = 1 / 30;
const SHEET_ENLARGED = 2;

/** What each swept gene does to the body, in the sheet's words. */
const SWEEP_NOTES: Readonly<Record<string, readonly [string, string]>> = {
  size: ["Size", "Mass from 0.25 to 16; length grows with its cube root."],
  limbs: [
    "Limbs",
    "The number of leg pairs picks the family: none a worm or snake, one a hopper, two a beast or lizard, three an insect, four a spider or crab.",
  ],
  speed: ["Speed", "Slimmer and longer in the leg; at 0.55 a stocky beast becomes a lizard."],
  armour: ["Armour", "Plates along the back, then from 0.55 a single shell: a tortoise."],
  sense: ["Sense", "Bigger eyes; ears on a beast."],
  aquatic: [
    "Aquatic",
    "Fins from 0.3 and a newt's flat tail from 0.5; from 0.6 the animal lives in the water.",
  ],
  jaw: ["Jaw", "Tusks, longer with the gene (pincers on insects, claws on crabs)."],
  diet: ["Diet", "A hunter gets a pointed snout, and ivory in place of dark tusks."],
  hue: ["Hue", "Body colour, once round the colour wheel."],
  pattern: ["Pattern", "Five of the twelve markings; all of them are in the rows above."],
};

/** The animals the local view's pictures are about, by specimen name, and their company. */
const LOCAL_SCENES = {
  meadow: { subject: "giant", company: ["grazer", "mouse", "random-3"] },
  wood: { subject: "hunter", company: ["tank", "random-4"] },
  shore: { subject: "random-2", company: ["frog", "eel", "all-one", "random-1"] },
} as const;

interface Drawn {
  picture: Picture;
  context: CanvasRenderingContext2D;
  /** On screen now; pictures out of sight are not redrawn. */
  seen: boolean;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`look.html has no #${id}`);
  return found;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

/** Size a canvas for a picture drawn at `width` × `height` and shown `enlarged` times. */
function size(canvas: HTMLCanvasElement, width: number, height: number, enlarged: number): void {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * enlarged}px`;
  canvas.style.height = `${height * enlarged}px`;
}

/** "#rrggbb" → 0xRRGGBB. */
function packed(colour: string): number {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
}

const centreOf = (rect: CellRect): [number, number] => [
  (rect.x0 + rect.x1) / 2,
  (rect.y0 + rect.y1) / 2,
];
const middle = (rect: CellRect): Point => ({
  x: (rect.x0 + rect.x1) / 2,
  y: (rect.y0 + rect.y1) / 2,
});

/** The whole cells within `margin` of a view of `width` × `height` cells around `centre`. */
function around(
  centre: Point,
  width: number,
  height: number,
  margin: number,
  fixture: WorldFixture,
): CellRect {
  return {
    x0: Math.max(Math.floor(centre.x - width / 2) - margin, 0),
    y0: Math.max(Math.floor(centre.y - height / 2) - margin, 0),
    x1: Math.min(Math.ceil(centre.x + width / 2) + margin, fixture.width),
    y1: Math.min(Math.ceil(centre.y + height / 2) + margin, fixture.height),
  };
}

/** Copies of `seeds` placed at random in `region`, each where its body can live. */
function scatter(
  seeds: readonly CreatureSeed[],
  region: CellRect,
  passable: Passable,
  random: Random,
): CreatureSeed[] {
  const width = region.x1 - region.x0 - 2 * PLACING_MARGIN;
  const height = region.y1 - region.y0 - 2 * PLACING_MARGIN;
  return seeds.map((seed) => {
    const swims = bodyPlan(seed).swims;
    // Should nothing fit (no water in sight for a swimmer), the layer moves it to the nearest.
    let spot = middle(region);
    for (let attempt = 0; attempt < PLACING_TRIES; attempt++) {
      const x = region.x0 + PLACING_MARGIN + random() * width;
      const y = region.y0 + PLACING_MARGIN + random() * height;
      if (passable(x, y, swims)) {
        spot = { x, y };
        break;
      }
    }
    return { ...seed, x: spot.x, y: spot.y };
  });
}

/** "lizard · herbivore · mass 0.9 · spots" */
function describe(seed: CreatureSeed, fixture: WorldFixture): string {
  const diet =
    seed.diet <= fixture.herbivoreMaxDiet
      ? "herbivore"
      : seed.diet >= fixture.predatorMinDiet
        ? "predator"
        : "omnivore";
  const mass = seed.mass >= 10 ? seed.mass.toFixed(0) : seed.mass.toFixed(1);
  return `${kindOf(seed)} · ${diet} · mass ${mass} · ${patternOf(seed.pattern).pattern}`;
}

/** A rectangle of cells `x` and `y` either side of `centre`. */
const pen = (centre: Point, reach: { x: number; y: number }): CellRect => ({
  x0: centre.x - reach.x,
  y0: centre.y - reach.y,
  x1: centre.x + reach.x,
  y1: centre.y + reach.y,
});

/** What stands in the local view, side by side on the colour of the ground. */
function plantStrip(host: HTMLElement, scale: PlantScale, fixture: WorldFixture): void {
  const detail = LOCAL_PIXELS / MID_TILE;
  const kinds: readonly (readonly [Form, Age])[] = [
    ["BROADLEAF", "mature"],
    ["BROADLEAF", "young"],
    ["CONIFER", "mature"],
    ["CONIFER", "young"],
    ["SHRUB", "mature"],
    ["SHRUB", "young"],
    ["GRASS", "mature"],
    ["GRASS", "young"],
  ];
  const sized = (size: readonly [number, number]): [number, number] => [
    Math.round(size[0] * detail),
    Math.round(size[1] * detail),
  ];
  const arts: { art: PlantArt; pixels: ReturnType<typeof colourArt> }[] = [];
  for (const [form, age] of kinds) {
    const variants = form === "SHRUB" && age === "mature" ? [0, 1] : [0];
    for (const variant of variants) {
      const art = drawStanding(form, age, variant, scale, detail);
      arts.push({ art, pixels: colourArt(art, fixture.palette[form] ?? ["", "", ""]) });
    }
  }
  FLOWER_COLOURS.forEach((accent, variant) => {
    const art = drawFlower(sized(FLOWER), mulberry32(31 + variant));
    arts.push({ art, pixels: colourArt(art, fixture.palette["GRASS"] ?? ["", "", ""], accent) });
  });
  for (let variant = 0; variant < 2; variant++) {
    const art = drawStone(sized(STONE), mulberry32(41 + variant));
    arts.push({ art, pixels: colourArt(art, fixture.relief.highRock) });
  }
  const canvas = create("canvas");
  const wide = arts.reduce((sum, { art }) => sum + art.width + 2, 4);
  const tall = Math.max(...arts.map(({ art }) => art.height)) + 2;
  size(canvas, wide, tall, SHEET_ENLARGED);
  canvas.setAttribute("aria-label", "What stands in the local view");
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.fillStyle = fixture.palette["GRASS"]?.[1] ?? "#8fbf4f";
  context.fillRect(0, 0, wide, tall);
  let left = 3;
  for (const { art, pixels } of arts) {
    // Through a canvas of its own, so that the shadow darkens the ground instead of replacing it.
    const stamp = create("canvas");
    stamp.width = pixels.width;
    stamp.height = pixels.height;
    stamp
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    context.drawImage(stamp, left, tall - 1 - art.height);
    left += art.width + 2;
  }
  host.append(canvas);
}

async function main(): Promise<void> {
  const still = new URLSearchParams(window.location.search).get("still");
  const response = await fetch("spike/world.json");
  if (!response.ok) throw new Error(`spike/world.json: HTTP ${response.status}`);
  const fixture = parseFixture(await response.json());
  const stage = await Stage.create(fixture, "spike", VIEW.width, VIEW.height);
  const { passable } = stage;
  const random = mulberry32(2026);
  const island: CellRect = { x0: 0, y0: 0, x1: fixture.width, y1: fixture.height };
  const cast = (name: string): Cast => {
    const found = fixture.casts.find((candidate) => candidate.name === name);
    if (found === undefined) throw new Error(`the fixture has no cast "${name}"`);
    return found;
  };
  const specimens = cast("specimens");
  const specimen = (name: string): CreatureSeed => {
    const found = specimens.creatures[specimens.members.indexOf(name)];
    if (found === undefined) throw new Error(`no specimen "${name}"`);
    return found;
  };
  const large = PLANT_SCALES.find((scale) => scale.name === PLANTS);
  if (large === undefined) throw new Error(`no plant scale "${PLANTS}"`);

  element("world").textContent = fixture.description;
  element("build").textContent =
    typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";
  element("drawn-with").textContent = stage.api === "webgl" ? "WebGL" : stage.api;

  const drawn: Drawn[] = [];
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const found = drawn.find((candidate) => candidate.context.canvas === entry.target);
      if (found !== undefined) found.seen = entry.isIntersecting;
    }
  });
  const show = (canvas: HTMLCanvasElement, picture: Picture, enlarged: number): void => {
    size(canvas, picture.width, picture.height, enlarged);
    // A still page's pictures are read back, frame after frame, to be saved.
    const context = canvas.getContext("2d", { willReadFrequently: still !== null });
    if (context === null) throw new Error("no 2D canvas");
    drawn.push({ picture, context, seen: true });
    watcher.observe(canvas);
  };
  /** A picture the page already has a place for: `<canvas data-picture="name">`. */
  const place = (name: string, picture: Picture, enlarged = ART): void => {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-picture="${name}"]`);
    if (canvas === null) throw new Error(`look.html has no picture "${name}"`);
    show(canvas, picture, enlarged);
  };
  const tile = (name: string, note: string, picture: Picture, enlarged: number): HTMLElement => {
    const figure = create("figure", "tile");
    const canvas = create("canvas");
    canvas.setAttribute("aria-label", note === "" ? name : `${name}: ${note}`);
    const caption = create("figcaption");
    caption.append(create("b", "", name), create("span", "", note));
    figure.append(canvas, caption);
    show(canvas, picture, enlarged);
    return figure;
  };
  const base = {
    ...VIEW,
    plants: null,
    light: "day",
    cast: null,
    markers: false,
    follow: null,
    only: null,
    subject: null,
  } as const;
  /** Paint the ground a picture of `width` × `height` art pixels round `centre` needs. */
  const paint = (name: string, centre: Point, pixels: number, width: number, height: number) => {
    const cells = around(centre, width / pixels, height / pixels, PAINT_MARGIN, fixture);
    stage.addGround(
      name,
      paintGround(fixture, { tile: pixels, style: GROUND, grain: true, cells }),
      pixels,
      cells,
    );
  };

  // 1. The map view: the whole world, two art pixels to the cell, animals as dots.
  stage.addGround(
    "map",
    paintGround(fixture, { tile: MAP_TILE, style: MAP_GROUND, grain: false }),
    MAP_TILE,
  );
  const herd = stage.cast(fixture.creatures, 1, MID_BODY);
  place("map", {
    ...base,
    zoom: MAP_TILE,
    ground: "map",
    cast: herd,
    markers: true,
    centre: middle(island),
  });

  // 2. The middle view: eight art pixels to the cell, the large plants, small animals.
  stage.addGround(
    "mid",
    paintGround(fixture, { tile: MID_TILE, style: GROUND, grain: true }),
    MID_TILE,
  );
  stage.addPlants("mid", standingPlants(fixture, large, MID_TILE));
  const midCells = [VIEW.width / MID_TILE, Math.ceil(VIEW.height / MID_TILE)] as const;
  const midShore = middle(findSite(fixture, ...midCells, shore));
  const midWood = middle(findSite(fixture, ...midCells, forest));
  const troupe = stage.cast(
    scatter(
      [...specimens.creatures, ...fixture.creatures.slice(0, HERD_IN_STAGED_SHOT)],
      around(midShore, midCells[0], midCells[1], 0, fixture),
      passable,
      random,
    ),
    4,
    MID_BODY,
  );
  const mid = { ...base, zoom: MID_TILE, ground: "mid", plants: "mid" };
  place("mid-shore", { ...mid, cast: troupe, centre: midShore });
  place("mid-wood", { ...mid, cast: herd, centre: midWood });

  // 3. The local view: one animal from close by, on ground and among plants drawn for it.
  const localCells = [VIEW.width / LOCAL_PIXELS, Math.ceil(VIEW.height / LOCAL_PIXELS)] as const;
  const localSites = {
    // Low ground: up where bare land turns to rock and snow a meadow is not at its best.
    meadow: middle(
      findSite(fixture, ...localCells, (shares, window) => {
        const high = heightAt(fixture, ...centreOf(window)) - fixture.seaLevel > MEADOW_BELOW;
        return meadow(shares) - (high ? 1 : 0) - 2 * (shares["BARE"] ?? 0);
      }),
    ),
    wood: middle(findSite(fixture, ...localCells, forest)),
    shore: middle(findSite(fixture, ...localCells, shore)),
  };
  for (const pixels of LOCAL_ZOOMS) {
    stage.addPlants(`local-${pixels}`, standingPlants(fixture, large, pixels, true));
  }
  /** The players of a local picture: the animal it is about, kept near the middle, and company. */
  const players = (scene: keyof typeof LOCAL_SCENES): CreatureSeed[] => {
    const centre = localSites[scene];
    const { subject, company } = LOCAL_SCENES[scene];
    const [first] = scatter([specimen(subject)], pen(centre, SUBJECT_PEN), passable, random);
    const others = scatter(company.map(specimen), pen(centre, COMPANY_PEN), passable, random);
    return [
      ...(first === undefined ? [] : [{ ...first, pen: pen(centre, SUBJECT_PEN) }]),
      ...others.map((seed) => ({ ...seed, pen: pen(centre, COMPANY_PEN) })),
    ];
  };
  const local = (scene: keyof typeof LOCAL_SCENES, pixels: number, name: string): Picture => {
    const centre = localSites[scene];
    paint(name, centre, pixels, VIEW.width, VIEW.height);
    return {
      ...base,
      zoom: pixels,
      ground: name,
      plants: `local-${pixels}`,
      cast: stage.cast(seeds[scene], 5, localBody(pixels)),
      subject: 0,
      centre,
    };
  };
  const seeds = { meadow: players("meadow"), wood: players("wood"), shore: players("shore") };
  for (const pixels of LOCAL_ZOOMS)
    place(`local-${pixels}`, local("meadow", pixels, `meadow-${pixels}`));
  place("local-wood", local("wood", LOCAL_PIXELS, "wood"));
  const shoreline = local("shore", LOCAL_PIXELS, "shore");
  place("local-shore", shoreline);
  for (const light of LIGHT_ORDER) place(`light-${light}`, { ...shoreline, light }, 1);
  plantStrip(element("plants-local"), large, fixture);

  // 4. Creatures up close: each specimen on its own patch of ground.
  const roomy: CellRect = { x0: 8, y0: 8, x1: fixture.width - 8, y1: fixture.height - 8 };
  const standing = scatter(specimens.creatures, roomy, passable, random).map((seed) => ({
    ...seed,
    pen: pen(seed, SPECIMEN_PEN),
  }));
  const portraits = stage.cast(standing, 2, localBody(SWATCH_PIXELS));
  standing.forEach((seed, index) => {
    const name = specimens.members[index] ?? "";
    paint(`specimen-${name}`, seed, SWATCH_PIXELS, SPECIMEN.width, SPECIMEN.height);
    // The camera holds on the patch; the animal is kept on it.
    const picture = {
      ...base,
      ...SPECIMEN,
      zoom: SWATCH_PIXELS,
      ground: `specimen-${name}`,
      cast: portraits,
      only: index,
      centre: { x: seed.x, y: seed.y },
    };
    element("specimens").append(tile(name, describe(seed, fixture), picture, SPECIMEN.enlarged));
  });
  // On one flat colour (sand, or sea for those that swim), the camera on the animal.
  const sand = packed(fixture.palette["BARE"]?.[2] ?? "#cdbd9f");
  const sea = packed(fixture.sea[Math.floor(fixture.sea.length / 2)] ?? "#3b7fbf");
  const swatch = (layer: CreatureLayer, seed: CreatureSeed, index: number): Picture => ({
    ...base,
    ...SWATCH,
    zoom: SWATCH_PIXELS,
    ground: bodyPlan(seed).swims ? sea : sand,
    cast: layer,
    follow: index,
    centre: middle(island),
  });
  // Every marking, on two bodies: a beast's back, and a beetle's shell.
  const plain = cast("sweep-pattern").creatures[0];
  if (plain !== undefined) {
    const bodies = {
      beast: { ...plain, speed: 0.3 },
      beetle: { ...plain, limbPairs: 3, armour: 0.8, hue: 0.02 },
    };
    for (const [kind, body] of Object.entries(bodies)) {
      // A little further into each marking's share of the gene than the last, to show its colours.
      const marked = PATTERNS.map((_, k) => ({
        ...body,
        pattern: (k + 0.1 + 0.25 * (k % 4)) / PATTERNS.length,
      }));
      const layer = stage.cast(
        scatter(marked, roomy, passable, random),
        6,
        localBody(SWATCH_PIXELS),
      );
      marked.forEach((seed, k) => {
        const picture = swatch(layer, seed, k);
        element(`patterns-${kind}`).append(tile(PATTERNS[k] ?? "", "", picture, SWATCH.enlarged));
      });
    }
  }
  for (const sweep of fixture.casts.filter((candidate) => candidate.name.startsWith("sweep-"))) {
    const gene = sweep.name.slice("sweep-".length);
    const [title, note] = SWEEP_NOTES[gene] ?? [gene, ""];
    const placed = scatter(sweep.creatures, roomy, passable, random);
    const layer = stage.cast(placed, 3, localBody(SWATCH_PIXELS));
    const row = create("div", "sweep");
    const label = create("div", "gene");
    label.append(create("b", "", title), create("span", "", note));
    const steps = create("div", "steps");
    sweep.creatures.forEach((seed, index) => {
      const value = sweep.members[index] ?? "";
      steps.append(tile(value, kindOf(seed), swatch(layer, seed, index), SWATCH.enlarged));
    });
    row.append(label, steps);
    element("sweeps").append(row);
  }

  const drawAll = (): void => {
    for (const { picture, context } of drawn) stage.draw(picture, context);
  };
  let filming = false;
  if (still !== null) {
    const steps = Math.round(Math.min(Math.max(Number(still) || 0, 0), 120) / STILL_STEP_S);
    for (let step = 0; step < steps; step++) stage.tick(STILL_STEP_S);
    drawAll();
  } else {
    stage.tick(0);
    drawAll();
    let last = performance.now();
    const frame = (now: number): void => {
      const dtS = Math.min((now - last) / 1000, MAX_STEP_S);
      last = now;
      requestAnimationFrame(frame);
      if (filming) return; // the film sets the pace while it is being taken
      stage.tick(dtS);
      // Only what moves and can be seen: a picture without creatures never changes.
      for (const { picture, context, seen } of drawn) {
        if (seen && picture.cast !== null) stage.draw(picture, context);
      }
    };
    requestAnimationFrame(frame);
  }

  window.__lookStandalone = async (film): Promise<string> => {
    filming = true;
    drawAll();
    // The loops: every picture with animals in it by day, all on one clock.
    const loops = new Map<HTMLCanvasElement, string>();
    if (film !== undefined) {
      const moving = drawn.filter(
        ({ picture }) => picture.cast !== null && picture.light === "day",
      );
      const writers = moving.map(
        ({ picture }) => new ApngWriter(picture.width, picture.height, Math.round(1000 / film.fps)),
      );
      const frames = Math.round(film.seconds * film.fps);
      const steps = Math.max(1, Math.round(1 / film.fps / STILL_STEP_S));
      for (let frame = 0; frame < frames; frame++) {
        if (frame > 0) for (let step = 0; step < steps; step++) stage.tick(STILL_STEP_S);
        for (const [index, { picture, context }] of moving.entries()) {
          stage.draw(picture, context);
          const pixels = context.getImageData(0, 0, picture.width, picture.height).data;
          await writers[index]?.add(pixels);
        }
      }
      moving.forEach(({ context }, index) => {
        const writer = writers[index];
        if (writer !== undefined) loops.set(context.canvas, dataUri(writer.finish(), "image/png"));
      });
    }
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    const sources = [...document.querySelectorAll("canvas")];
    [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
      const source = sources[index];
      const image = create("img");
      if (source !== undefined) image.src = loops.get(source) ?? source.toDataURL("image/png");
      image.alt = canvas.getAttribute("aria-label") ?? "";
      image.width = canvas.width;
      image.height = canvas.height;
      image.style.cssText = canvas.style.cssText;
      canvas.replaceWith(image);
    });
    for (const node of copy.querySelectorAll("script, link, [data-live]")) node.remove();
    for (const node of copy.querySelectorAll("[data-still]")) node.removeAttribute("hidden");
    filming = false;
    return `<!doctype html>\n${copy.outerHTML}\n`;
  };
  window.__lookReady = true;
}

main().catch((error: unknown) => {
  element("failure").textContent = error instanceof Error ? error.message : String(error);
  element("failure").hidden = false;
  window.__lookReady = true;
});
