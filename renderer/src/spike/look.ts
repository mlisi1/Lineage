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
import { PATTERNS, bodyPlan, kindOf } from "../creatures/body";
import type { CellRect } from "./camera";
import type { Point } from "../creatures/chain";
import type { CreatureLayer } from "./creatures";
import { parseFixture, type Cast, type CreatureSeed, type WorldFixture } from "./fixture";
import { MAP_TILE, MID_TILE, paintGround, type Shadow } from "./ground";
import { heightAt } from "./habitat";
import { LIGHT_ORDER } from "./light";
import { colourArt, type PlantArt } from "./plantart";
import { outIn, standingArts, standingPlants, type StandingArt } from "./plants";
import { GROUND, LOCAL_PIXELS, MAP_GROUND, MID_BODY, PORTRAIT_PIXELS, localBody } from "./proposal";
import { seasonRamp, type Season } from "./seasons";
import { mulberry32 } from "./rng";
import { findSite, forest, meadow, shore } from "./sites";
import {
  around,
  centreOf,
  create,
  describe,
  element,
  middle,
  packed,
  pen,
  scatter,
  size,
  standalone,
  type Drawn,
} from "./sheetkit";
import { Stage, type Picture } from "./stage";

/** Replaced by Vite with the commit the page was built from. */
declare const __BUILD_COMMIT__: string;

/** Screen pixels per art pixel: settled when the painted ground was chosen. */
const ART = 2;
/** A view: what the screen holds, in art pixels. */
const VIEW = { width: DESIGN_WIDTH / ART, height: DESIGN_HEIGHT / ART };
/**
 * Portraits: an animal on its patch of ground at the local view's own size, and on one
 * flat colour from much closer, as a bestiary would show it.
 */
const SPECIMEN = { width: 112, height: 88, enlarged: 2 };
const SWATCH = { width: 84, height: 64, enlarged: 2 };
/** Bare heights (rock, snow) make a poor meadow: land this far above the sea is passed over. */
const MEADOW_BELOW = 0.2;
/** The times of year the vegetation is shown in: the four seasons, and winter under snow. */
interface Time {
  name: string;
  season: Season;
  snow: boolean;
}
const TIMES: readonly Time[] = [
  { name: "spring", season: "spring", snow: false },
  { name: "summer", season: "summer", snow: false },
  { name: "autumn", season: "autumn", snow: false },
  { name: "winter", season: "winter", snow: false },
  { name: "snow", season: "winter", snow: true },
];
const SUMMER: Time = { name: "summer", season: "summer", snow: false };
/** A sample of each kind of ground: so many cells of it, at the local view's size. */
const SAMPLE = { cells: [3, 2], enlarged: 2 } as const;
/** How far from the middle of its picture the animal a local picture is about may go, in cells. */
const SUBJECT_PEN = { x: 2.2, y: 1.3 };
const COMPANY_PEN = { x: 5, y: 3 };
const SPECIMEN_PEN = { x: 0.8, y: 0.55 };
/** Members of the world's own herd that join the specimens in the middle view's staged shot. */
const HERD_IN_STAGED_SHOT = 10;
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

/** The drawings a layer of plants is made of at one time of year, to pick from by name. */
function drawingsOf(
  fixture: WorldFixture,
  time: Time,
  tile = LOCAL_PIXELS,
): (key: string) => Drawing[] {
  const arts = new Map<string, StandingArt>(
    standingArts(fixture, tile, {
      close: tile === LOCAL_PIXELS,
      season: time.season,
      snow: time.snow,
    }).map((art) => [art.key, art]),
  );
  return (key) => {
    const found = arts.get(key);
    if (found === undefined) return [];
    return [{ art: found.art, pixels: colourArt(found.art, found.ramp, found.accent, found.wood) }];
  };
}

/** The colour a sheet's plants stand on at a time of year: grass, or snow. */
const groundOf = (fixture: WorldFixture, time: Time): string =>
  time.snow ? fixture.relief.snow[1] : seasonRamp(fixture.palette, "GRASS", time.season)[1];

const every = (form: string, growth: string): string[] =>
  [0, 1, 2].map((variant) => `${form}/${growth}/${variant}`);

/** The trees and bushes full grown, in their three builds, and at the middle view's size. */
function treeSheets(host: HTMLElement, fixture: WorldFixture): void {
  const near = drawingsOf(fixture, SUMMER);
  const far = drawingsOf(fixture, SUMMER, MID_TILE);
  const ground = groundOf(fixture, SUMMER);
  sheet(
    host,
    "Broadleaf trees and conifers, full grown",
    [...every("BROADLEAF", "grown"), ...every("CONIFER", "grown")].flatMap(near),
    ground,
  );
  sheet(
    host,
    "Bushes, and the three kinds at the middle view's size",
    [
      ...every("SHRUB", "grown").flatMap(near),
      ...["BROADLEAF", "CONIFER", "SHRUB"].flatMap((form) => every(form, "grown")).flatMap(far),
    ],
    ground,
  );
}

/** Every stage of growth of each kind, and what a fire leaves. */
function stageSheets(host: HTMLElement, fixture: WorldFixture): void {
  const near = drawingsOf(fixture, SUMMER);
  const stages = (form: string): string[] =>
    ["sprout", "young", "grown", "old"].map((growth) => `${form}/${growth}/0`);
  sheet(
    host,
    "Stages of a broadleaf tree and of a conifer",
    [...stages("BROADLEAF"), ...stages("CONIFER")].flatMap(near),
    groundOf(fixture, SUMMER),
  );
  sheet(
    host,
    "Stages of a bush and of grass; dried grass; what a fire leaves",
    [
      ...stages("SHRUB"),
      "GRASS/sprout/0",
      "GRASS/young/0",
      "GRASS/grown/0",
      "dry/0",
      "stump/1",
      "snag/0",
      "snag/1",
      "log/0",
    ].flatMap(near),
    groundOf(fixture, SUMMER),
  );
}

/** The vegetation at one time of year: trees, then bushes, grass and what is out. */
function seasonSheets(host: HTMLElement, fixture: WorldFixture, time: Time): void {
  const near = drawingsOf(fixture, time);
  const ground = groundOf(fixture, time);
  sheet(
    host,
    `Trees in ${time.snow ? "winter, under snow" : time.season}`,
    [
      ...every("BROADLEAF", "grown"),
      "BROADLEAF/young/0",
      "BROADLEAF/sprout/0",
      "CONIFER/grown/0",
      "CONIFER/grown/1",
      "CONIFER/young/0",
      "CONIFER/sprout/0",
    ].flatMap(near),
    ground,
  );
  const small = [
    ...["daisy", "bell", "spike", "umbel"].flatMap((kind) => [
      `${kind}/0`,
      `${kind}/2`,
      `${kind}/3`,
    ]),
    "herb/0",
    "fern/0",
    "fern/1",
    "mushroom/0",
    "mushroom/1",
    "mushroom/2",
    "reed/0",
    "stone/0",
    "stone/1",
    "boulder/1",
    "log/0",
    "stump/0",
  ].filter((key) => outIn(time.season, key.split("/")[0] ?? ""));
  const when = time.snow ? "winter, under snow" : time.season;
  sheet(
    host,
    `Bushes and grass in ${when}`,
    [
      ...every("SHRUB", "grown"),
      "SHRUB/young/0",
      "SHRUB/sprout/0",
      "GRASS/grown/0",
      "GRASS/grown/1",
      "GRASS/young/0",
    ].flatMap(near),
    ground,
  );
  sheet(host, `What is out in ${when}`, small.flatMap(near), ground);
}

/** What grows and lies among the trees, on the colour of the ground it is found on. */
function smallSheets(host: HTMLElement, fixture: WorldFixture): void {
  const near = drawingsOf(fixture, SUMMER);
  const bare = fixture.palette["BARE"]?.[1] ?? "#b3a188";
  sheet(
    host,
    "In the grass: tufts, herbs and four kinds of flower",
    [
      ...every("GRASS", "grown"),
      "GRASS/young/0",
      "dry/0",
      "dry/1",
      "herb/0",
      "herb/1",
      ...["daisy", "bell", "spike", "umbel"].flatMap((kind) =>
        [0, 1, 2, 3, 4].map((colour) => `${kind}/${colour}`),
      ),
    ].flatMap(near),
    groundOf(fixture, SUMMER),
  );
  sheet(
    host,
    "Under trees and on bare ground: ferns, mushrooms, reeds, stones, boulders, logs, stumps",
    [
      "SHRUB/sprout/0",
      "fern/0",
      "fern/1",
      "mushroom/0",
      "mushroom/1",
      "mushroom/2",
      "reed/0",
      "reed/1",
      "stone/0",
      "stone/1",
      "stone/2",
      "stone/3",
      "boulder/0",
      "boulder/1",
      "boulder/3",
      "log/0",
      "log/1",
      "stump/0",
      "stump/1",
      "snag/0",
    ].flatMap(near),
    bare,
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
    extra: { shadows?: (cells: CellRect) => Shadow[]; time?: Time } = {},
  ): void => {
    const cells = around(centre, width / pixels, height / pixels, PAINT_MARGIN, fixture);
    const shadows = extra.shadows?.(cells);
    const time = extra.time ?? { season: fixture.season, snow: false };
    stage.addGround(
      name,
      paintGround(fixture, {
        tile: pixels,
        style: GROUND,
        grain: true,
        cells,
        season: time.season,
        snow: time.snow,
        ...(shadows === undefined ? {} : { shadows }),
      }),
      pixels,
      cells,
    );
  };

  // 1. The map view: the whole world, two art pixels to the cell, animals as dots.
  const { season } = fixture;
  stage.addGround(
    "map",
    paintGround(fixture, { tile: MAP_TILE, style: MAP_GROUND, grain: false, season }),
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

  // 2. The middle view: eight art pixels to the cell, the same trees and bushes as the
  // local view at a quarter of the size, their shadows on the ground, small animals.
  const midPlants = standingPlants(fixture, MID_TILE);
  stage.addGround(
    "mid",
    paintGround(fixture, {
      tile: MID_TILE,
      style: GROUND,
      grain: true,
      season,
      shadows: midPlants.shadows(island),
    }),
    MID_TILE,
  );
  stage.addPlants("mid", midPlants);
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
  const near = standingPlants(fixture, LOCAL_PIXELS, { close: true });
  stage.addPlants("local", near);
  const shadows = (cells: CellRect): Shadow[] => near.shadows(cells);
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
  const local = (scene: keyof typeof LOCAL_SCENES): Picture => {
    paint(scene, localSites[scene], LOCAL_PIXELS, VIEW.width, VIEW.height, { shadows });
    return {
      ...base,
      zoom: LOCAL_PIXELS,
      ground: scene,
      plants: "local",
      cast: stage.cast(players(scene), 5, localBody(LOCAL_PIXELS)),
      subject: 0,
      centre: localSites[scene],
    };
  };
  // The ground on its own, then a piece of each kind of it.
  paint("bare", localSites.meadow, LOCAL_PIXELS, VIEW.width, VIEW.height);
  place("ground", { ...base, zoom: LOCAL_PIXELS, ground: "bare", centre: localSites.meadow });
  groundSamples(element("ground-samples"), fixture);
  // The trees and bushes side by side, then in a wood; what grows among them.
  treeSheets(element("trees"), fixture);
  place("local-wood", local("wood"));
  smallSheets(element("plants-small"), fixture);
  place("local-meadow", local("meadow"));
  const shoreline = local("shore");
  place("local-shore", shoreline);
  for (const light of LIGHT_ORDER) place(`light-${light}`, { ...shoreline, light }, 1);

  // 4. The vegetation in every variation: the stages of growth, then each time of year
  // on a sheet, on the same shore from close and in the same wood from the middle view.
  stageSheets(element("stages"), fixture);
  for (const time of TIMES) {
    seasonSheets(element(`plants-${time.name}`), fixture, time);
    const options = { season: time.season, snow: time.snow };
    // From close: the shore, with nobody on it.
    const close = standingPlants(fixture, LOCAL_PIXELS, { ...options, close: true });
    stage.addPlants(`local-${time.name}`, close);
    paint(`shore-${time.name}`, localSites.shore, LOCAL_PIXELS, VIEW.width, VIEW.height, {
      shadows: (cells) => close.shadows(cells),
      time,
    });
    place(`local-${time.name}`, {
      ...base,
      zoom: LOCAL_PIXELS,
      ground: `shore-${time.name}`,
      plants: `local-${time.name}`,
      centre: localSites.shore,
    });
    // From the middle view: the wood.
    const far = standingPlants(fixture, MID_TILE, { ...options, lazy: true });
    stage.addPlants(`mid-${time.name}`, far);
    const cells = around(midWood, midCells[0], midCells[1], PAINT_MARGIN, fixture);
    stage.addGround(
      `mid-${time.name}`,
      paintGround(fixture, {
        tile: MID_TILE,
        style: GROUND,
        grain: true,
        cells,
        ...options,
        shadows: far.shadows(cells),
      }),
      MID_TILE,
      cells,
    );
    place(
      `mid-${time.name}`,
      {
        ...base,
        zoom: MID_TILE,
        ground: `mid-${time.name}`,
        plants: `mid-${time.name}`,
        centre: midWood,
      },
      1,
    );
  }

  // 5. Creatures up close: each specimen on its own patch of ground, at the local view's size.
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
    const html = await standalone(drawn, stage, STILL_STEP_S, film);
    filming = false;
    return html;
  };
  window.__lookReady = true;
}

main().catch((error: unknown) => {
  element("failure").textContent = error instanceof Error ? error.message : String(error);
  element("failure").hidden = false;
  window.__lookReady = true;
});
