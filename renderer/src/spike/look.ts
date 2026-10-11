/**
 * The look sheet: how the renderer draws the three views of the world, and the proposals
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
import {
  parseFixture,
  type Cast,
  type CreatureSeed,
  type Ramp,
  type WorldFixture,
} from "./fixture";
import { MAP_TILE, MID_TILE, paintGround, type Shadow } from "./ground";
import { heightAt, type Passable } from "./habitat";
import { LIGHT_ORDER } from "./light";
import { hexToRgb, type Form, type Stage as Age } from "./pixelart";
import {
  CAP_COLOURS,
  FLOWER_COLOURS,
  MOSS_COLOUR,
  PLANT_SCALES,
  SMALL_SIZES,
  TREE_STYLES,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
  type PlantScale,
  type Small,
  type TreeStyle,
} from "./plantart";
import { standingPlants } from "./plants";
import {
  CREATURE_SCALES,
  GROUND,
  LOCAL_PIXELS,
  MAP_GROUND,
  MID_BODY,
  PLANTS,
  PORTRAIT_PIXELS,
  TREES,
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
/**
 * Portraits: an animal on its patch of ground at the local view's own size, and on one
 * flat colour twice as close, as a bestiary would show it.
 */
const SPECIMEN = { width: 112, height: 88, enlarged: 2 };
const SWATCH = { width: 84, height: 64, enlarged: 2 };
/** Bare heights (rock, snow) make a poor meadow: land this far above the sea is passed over. */
const MEADOW_BELOW = 0.2;
/** How many cells around the local view's ground is read over: the proposals. */
const CALMS = [1, 2, 3] as const;
/** A sample of each kind of ground: so many cells of it, at the local view's size. */
const SAMPLE = { cells: [3, 2], enlarged: 2 } as const;
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
  size: [
    "Size",
    "Mass from 0.25 to 16; length grows with its cube root. At the local view's own distance.",
  ],
  limbs: [
    "Limbs",
    "The number of leg pairs picks the family: none a worm or snake, one a hopper, two a beast or lizard, three an insect, four a spider or crab.",
  ],
  speed: ["Speed", "Slimmer and longer in the leg; at 0.55 a stocky beast becomes a lizard."],
  armour: ["Armour", "Plates along the back, then from 0.55 a single shell: a tortoise."],
  sense: ["Sense", "Bigger eyes; ears on a beast."],
  aquatic: [
    "Aquatic",
    "The feet web from 0.3, wider and wider; at 0.6 the legs are flippers that row, and the animal lives in the water. A flat tail from 0.5.",
  ],
  jaw: ["Jaw", "Tusks, longer with the gene (pincers on insects, claws on crabs)."],
  diet: ["Diet", "A hunter gets a pointed snout, and ivory in place of dark tusks."],
  hue: ["Hue", "Body colour, once round the colour wheel."],
  pattern: ["Pattern", "Five of the twelve markings; all of them are in the rows above."],
};

/**
 * The animals the local view's pictures are about, by specimen name, and their company.
 * The meadow holds the lightest, a middling one and the heaviest, to judge sizes by.
 */
const LOCAL_SCENES = {
  meadow: { subject: "grazer", company: ["giant", "mouse", "hunter", "random-3"] },
  wood: { subject: "hunter", company: ["tank", "random-4", "grazer"] },
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

interface Drawing {
  art: PlantArt;
  pixels: ReturnType<typeof colourArt>;
}

/** Drawings side by side on one colour, each standing on its shadow if it throws one. */
function sheet(
  host: HTMLElement,
  label: string,
  drawings: readonly Drawing[],
  ground: string,
): void {
  const canvas = create("canvas");
  const wide = drawings.reduce((sum, { art }) => sum + art.width + 2, 4);
  const tall = Math.max(...drawings.map(({ art }) => art.height)) + 3;
  size(canvas, wide, tall, SHEET_ENLARGED);
  canvas.setAttribute("aria-label", label);
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.fillStyle = ground;
  context.fillRect(0, 0, wide, tall);
  let left = 3;
  for (const { art, pixels } of drawings) {
    const top = tall - 2 - art.height;
    if (art.shadow !== undefined) {
      // As the ground paints it: one flat darker tone, hard-edged.
      const { rx, ry } = art.shadow;
      context.fillStyle = "rgba(22, 32, 58, 0.32)";
      for (let y = Math.floor(-ry); y <= ry; y++) {
        const half = Math.round(rx * Math.sqrt(Math.max(1 - (y / ry) ** 2, 0)));
        const row = Math.round(top + art.footY + y);
        context.fillRect(Math.round(left + art.footX + rx * 0.16) - half, row, 2 * half, 1);
      }
    }
    // Through a canvas of its own, so that clear pixels leave the ground as it is.
    const stamp = create("canvas");
    stamp.width = pixels.width;
    stamp.height = pixels.height;
    stamp
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    context.drawImage(stamp, left, top);
    left += art.width + 2;
  }
  host.append(canvas);
}

/** The trees and bushes of one style: every drawing of each, grown and young. */
function treeSheets(
  host: HTMLElement,
  style: TreeStyle,
  scale: PlantScale,
  fixture: WorldFixture,
): void {
  const detail = LOCAL_PIXELS / MID_TILE;
  const ground = fixture.palette["GRASS"]?.[1] ?? "#8fbf4f";
  const standing = (form: Form, age: Age, variant: number, at = detail): Drawing => {
    const art = drawStanding(form, age, variant, scale, at, style);
    return { art, pixels: colourArt(art, fixture.palette[form] ?? ["", "", ""]) };
  };
  const all = (form: Form): Drawing[] => [
    ...[0, 1, 2].map((variant) => standing(form, "mature", variant)),
    ...[0, 1].map((variant) => standing(form, "young", variant)),
  ];
  sheet(
    host,
    `${style}: broadleaf trees and conifers`,
    [...all("BROADLEAF"), ...all("CONIFER")],
    ground,
  );
  sheet(
    host,
    `${style}: bushes, and the three at the middle view's size`,
    [
      ...all("SHRUB"),
      ...(["BROADLEAF", "CONIFER", "SHRUB"] as const).flatMap((form) =>
        [0, 1, 2].map((variant) => standing(form, "mature", variant, 1)),
      ),
    ],
    ground,
  );
}

/** What grows and lies among the trees, on the colour of the ground it is found on. */
function smallSheets(host: HTMLElement, scale: PlantScale, fixture: WorldFixture): void {
  const detail = LOCAL_PIXELS / MID_TILE;
  const ramp = (name: string): Ramp => fixture.palette[name] ?? ["", "", ""];
  const small = (
    kind: Small,
    variant: number,
    colours: Ramp,
    accent?: string,
    wood?: string,
  ): Drawing => {
    const [width, height] = SMALL_SIZES[kind];
    const art = drawSmall(
      kind,
      [width * detail, height * detail],
      mulberry32(31 + variant),
      variant,
    );
    return { art, pixels: colourArt(art, colours, accent, wood) };
  };
  const tuft = (age: Age, variant: number, colours: string): Drawing => {
    const art = drawStanding("GRASS", age, variant, scale, detail);
    return { art, pixels: colourArt(art, ramp(colours)) };
  };
  const flowers = (["daisy", "bell", "spike", "umbel"] as const).flatMap((kind) =>
    FLOWER_COLOURS.map((accent, colour) => small(kind, colour, ramp("GRASS"), accent)),
  );
  sheet(
    host,
    "In the grass: tufts, herbs and four kinds of flower",
    [
      ...[0, 1, 2].map((variant) => tuft("mature", variant, "GRASS")),
      tuft("young", 0, "GRASS"),
      ...[0, 1].map((variant) => tuft("mature", variant, "DORMANT")),
      ...[0, 1].map((variant) => small("herb", variant, ramp("GRASS"))),
      ...flowers,
    ],
    ramp("GRASS")[1],
  );
  const rock = fixture.relief.highRock;
  sheet(
    host,
    "Under trees and on bare ground: ferns, mushrooms, reeds, stones, boulders, logs, stumps",
    [
      ...[0, 1].map((variant) => small("fern", variant, ramp("SHRUB"))),
      ...[0, 1, 2].map((variant) => small("mushroom", variant, ramp("BARE"), CAP_COLOURS[variant])),
      ...[0, 1].map((variant) => small("reed", variant, ramp("DORMANT"))),
      ...[0, 1, 2, 3].map((variant) => small("stone", variant, rock, ramp("LICHEN")[2])),
      small("boulder", 0, rock),
      small("boulder", 1, rock, MOSS_COLOUR),
      small("boulder", 3, rock, ramp("LICHEN")[2]),
      ...[0, 1].map((variant) => small("log", variant, ramp("BARE"), MOSS_COLOUR)),
      small("stump", 0, ramp("BARE")),
      small("stump", 1, ramp("BURNT"), undefined, "#2e2622"),
    ],
    ramp("BARE")[1],
  );
}

/** A piece of each kind of ground at the local view's size: one cover over a few cells. */
function groundSamples(host: HTMLElement, fixture: WorldFixture): void {
  const [across, down] = SAMPLE.cells;
  // Two cells of margin, so that the sample is not the edge of its little world.
  const wide = across + 4;
  const tall = down + 4;
  const sample = (name: string, cover: string, biomass: number, above: number): void => {
    const count = wide * tall;
    const world: WorldFixture = {
      ...fixture,
      width: wide,
      height: tall,
      cover: new Uint8Array(count).fill(Math.max(fixture.coverClasses.indexOf(cover), 0)),
      biomass: new Uint8Array(count).fill(biomass),
      heights: new Float32Array(count).fill(fixture.seaLevel + above),
      creatures: [],
      casts: [],
    };
    const pixels = paintGround(world, {
      tile: LOCAL_PIXELS,
      style: GROUND,
      grain: true,
      cells: { x0: 2, y0: 2, x1: 2 + across, y1: 2 + down },
    });
    const figure = create("figure", "tile");
    const canvas = create("canvas");
    size(canvas, pixels.width, pixels.height, SAMPLE.enlarged);
    canvas.setAttribute("aria-label", `Ground: ${name}`);
    canvas
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    const caption = create("figcaption");
    caption.append(create("b", "", name));
    figure.append(canvas, caption);
    host.append(figure);
  };
  const { highRockFrom, snowFrom } = fixture.relief;
  sample("grass, grown", "GRASS", 230, 0.1);
  sample("grass, thin", "GRASS", 120, 0.1);
  sample("grass, dried", "GRASS", 50, 0.1);
  sample("bare soil", "BARE", 0, 0.1);
  sample("sand", "BARE", 0, 0.003);
  sample("lichen on soil", "LICHEN", 200, 0.1);
  sample("rock", "BARE", 0, highRockFrom + 0.05);
  sample("lichen on rock", "LICHEN", 220, highRockFrom + 0.05);
  sample("snow", "BARE", 0, snowFrom + 0.05);
  sample("under bushes", "SHRUB", 220, 0.1);
  sample("under broadleaves", "BROADLEAF", 230, 0.1);
  sample("under conifers", "CONIFER", 230, 0.1);
  sample("burnt", "BURNT", 0, 0.1);
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
  /**
   * Paint the ground a picture of `width` × `height` art pixels round `centre` needs,
   * with the shadows of what stands on it if `shadows` lists them.
   */
  const paint = (
    name: string,
    centre: Point,
    pixels: number,
    width: number,
    height: number,
    extra: { calm?: number; shadows?: (cells: CellRect) => Shadow[] } = {},
  ): void => {
    const cells = around(centre, width / pixels, height / pixels, PAINT_MARGIN, fixture);
    const shadows = extra.shadows?.(cells);
    stage.addGround(
      name,
      paintGround(fixture, {
        tile: pixels,
        style: GROUND,
        grain: true,
        cells,
        ...(extra.calm === undefined ? {} : { calm: extra.calm }),
        ...(shadows === undefined ? {} : { shadows }),
      }),
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
  const near = Object.fromEntries(
    TREE_STYLES.map((style) => [style, standingPlants(fixture, large, LOCAL_PIXELS, style)]),
  );
  for (const style of TREE_STYLES) {
    const layer = near[style];
    if (layer !== undefined) stage.addPlants(`local-${style}`, layer);
  }
  // Trees are as large in every style, so the shadows of one style serve them all.
  const shadows = (cells: CellRect): Shadow[] => near[TREES]?.shadows(cells) ?? [];
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
  const seeds = { meadow: players("meadow"), wood: players("wood"), shore: players("shore") };
  for (const scene of ["meadow", "wood", "shore"] as const) {
    paint(scene, localSites[scene], LOCAL_PIXELS, VIEW.width, VIEW.height, { shadows });
  }
  const local = (
    scene: keyof typeof LOCAL_SCENES,
    style: TreeStyle = TREES,
    scale?: number,
  ): Picture => ({
    ...base,
    zoom: LOCAL_PIXELS,
    ground: scene,
    plants: `local-${style}`,
    cast: stage.cast(seeds[scene], 5, localBody(LOCAL_PIXELS, scale)),
    subject: 0,
    centre: localSites[scene],
  });
  // The ground on its own, read over one, two and three cells around.
  for (const calm of CALMS) {
    paint(`calm-${calm}`, localSites.meadow, LOCAL_PIXELS, VIEW.width, VIEW.height, { calm });
    place(`ground-${calm}`, {
      ...base,
      zoom: LOCAL_PIXELS,
      ground: `calm-${calm}`,
      centre: localSites.meadow,
    });
  }
  groundSamples(element("ground-samples"), fixture);
  // The wood in each style of tree, and the trees of each style side by side.
  for (const style of TREE_STYLES) {
    place(`wood-${style}`, local("wood", style));
    treeSheets(element(`trees-${style}`), style, large, fixture);
  }
  smallSheets(element("plants-small"), large, fixture);
  // The meadow with the animals at each size.
  CREATURE_SCALES.forEach((scale, index) => {
    place(`size-${index + 1}`, local("meadow", TREES, scale));
  });
  const shoreline = local("shore");
  place("local-shore", shoreline);
  for (const light of LIGHT_ORDER) place(`light-${light}`, { ...shoreline, light }, 1);

  // 4. Creatures up close: each specimen on its own patch of ground, at the local view's size.
  const roomy: CellRect = { x0: 8, y0: 8, x1: fixture.width - 8, y1: fixture.height - 8 };
  const standing = scatter(specimens.creatures, roomy, passable, random).map((seed) => ({
    ...seed,
    pen: pen(seed, SPECIMEN_PEN),
  }));
  const portraits = stage.cast(standing, 2, localBody(LOCAL_PIXELS));
  standing.forEach((seed, index) => {
    const name = specimens.members[index] ?? "";
    paint(`specimen-${name}`, seed, LOCAL_PIXELS, SPECIMEN.width, SPECIMEN.height);
    // The camera holds on the patch; the animal is kept on it.
    const picture = {
      ...base,
      ...SPECIMEN,
      zoom: LOCAL_PIXELS,
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
  const swatch = (
    layer: CreatureLayer,
    seed: CreatureSeed,
    index: number,
    zoom: number = PORTRAIT_PIXELS,
  ): Picture => ({
    ...base,
    ...SWATCH,
    zoom,
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
        localBody(PORTRAIT_PIXELS),
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
    // Sizes are told apart at the local view's own distance; the rest is seen from closer.
    const zoom = gene === "size" ? LOCAL_PIXELS : PORTRAIT_PIXELS;
    const placed = scatter(sweep.creatures, roomy, passable, random);
    const layer = stage.cast(placed, 3, localBody(zoom));
    const row = create("div", "sweep");
    const label = create("div", "gene");
    label.append(create("b", "", title), create("span", "", note));
    const steps = create("div", "steps");
    sweep.creatures.forEach((seed, index) => {
      const value = sweep.members[index] ?? "";
      steps.append(tile(value, kindOf(seed), swatch(layer, seed, index, zoom), SWATCH.enlarged));
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
