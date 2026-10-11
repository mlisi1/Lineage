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
import { CREATURE_STYLES, bodyPlan, kindOf } from "./body";
import type { CellRect } from "./camera";
import type { Point } from "./chain";
import type { CreatureLayer } from "./creatures";
import { parseFixture, type Cast, type CreatureSeed, type WorldFixture } from "./fixture";
import { LOCAL_TILE, MAP_TILE, paintGround, type GroundStyle } from "./ground";
import type { Passable } from "./habitat";
import { LIGHT_ORDER } from "./light";
import { hexToRgb, type Form, type Stage as Age } from "./pixelart";
import {
  PROPOSED_BODY as BODY,
  PROPOSED_GROUND as GROUND,
  PROPOSED_MAP_GROUND,
  PROPOSED_PLANTS as PLANTS,
} from "./proposal";
import { PLANT_SCALES, colourArt, drawStanding, type PlantScale } from "./plantart";
import { standingPlants } from "./plants";
import { mulberry32, type Random } from "./rng";
import { findSite, forest, shore } from "./sites";
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
/** The closer local view on offer: twice the art pixels per cell, half the cells in sight. */
const CLOSER_TILE = 2 * LOCAL_TILE;
/** The local grounds offered, the first being the one already seen. */
const GROUNDS: readonly GroundStyle[] = ["warped", "tiles", "smooth", "blended"];
const SCALES = [1, 1.5, 2];
/** A portrait: this many art pixels of the local view, shown enlarged. */
const PORTRAIT = { width: 56, height: 44 };
const SPECIMEN_ENLARGED = 3;
const SWEEP_ENLARGED = 2;
const SHEET_ENLARGED = 3;
/** Members of the world's own herd that join the specimens in the staged shot. */
const HERD_IN_STAGED_SHOT = 10;
/** Cells kept clear of a region's edge when placing creatures in it. */
const PLACING_MARGIN = 3;
const PLACING_TRIES = 300;
/** Cells painted beyond a picture's edge, so that the shore's outline has what to meet. */
const PAINT_MARGIN = 2;
/** Longest step of the animation, so a stalled tab does not teleport anybody. */
const MAX_STEP_S = 0.1;
const STILL_STEP_S = 1 / 30;

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
  pattern: ["Pattern", "Plain, a stripe down the back, bands, spots, or a saddle and mask."],
};

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

/** "lizard · herbivore · mass 0.9" */
function describe(seed: CreatureSeed, fixture: WorldFixture): string {
  const diet =
    seed.diet <= fixture.herbivoreMaxDiet
      ? "herbivore"
      : seed.diet >= fixture.predatorMinDiet
        ? "predator"
        : "omnivore";
  const mass = seed.mass >= 10 ? seed.mass.toFixed(0) : seed.mass.toFixed(1);
  return `${kindOf(seed)} · ${diet} · mass ${mass}`;
}

/** The standing plants of one size, side by side on the colour of the ground. */
function plantStrip(host: HTMLElement, scale: PlantScale, fixture: WorldFixture): void {
  const kinds: readonly (readonly [Form, Age])[] = [
    ["BROADLEAF", "mature"],
    ["BROADLEAF", "young"],
    ["CONIFER", "mature"],
    ["CONIFER", "young"],
    ["SHRUB", "mature"],
    ["SHRUB", "young"],
    ["GRASS", "mature"],
  ];
  const arts = kinds.flatMap(([form, age]) =>
    [0, 1].map((variant) => ({ form, art: drawStanding(form, age, variant, scale) })),
  );
  const canvas = create("canvas");
  const wide = arts.reduce((sum, { art }) => sum + art.width + 1, 3);
  const tall = Math.max(...arts.map(({ art }) => art.height)) + 2;
  size(canvas, wide, tall, SHEET_ENLARGED);
  canvas.setAttribute("aria-label", `The ${scale.name} plants`);
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.fillStyle = fixture.palette["GRASS"]?.[1] ?? "#8fbf4f";
  context.fillRect(0, 0, wide, tall);
  let left = 2;
  for (const { form, art } of arts) {
    // Through a canvas of its own, so that the shadow darkens the ground instead of replacing it.
    const pixels = colourArt(art, fixture.palette[form] ?? ["#000000", "#000000", "#000000"]);
    const stamp = create("canvas");
    stamp.width = pixels.width;
    stamp.height = pixels.height;
    stamp
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    context.drawImage(stamp, left, tall - 1 - art.height);
    left += art.width + 1;
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
  const place = (name: string, picture: Picture): void => {
    const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-picture="${name}"]`);
    if (canvas === null) throw new Error(`look.html has no picture "${name}"`);
    show(canvas, picture, ART);
  };
  const base = {
    ...VIEW,
    plants: null,
    light: "day",
    cast: null,
    markers: false,
    follow: null,
  } as const;

  // Where the local view looks: a shore with a bit of everything, and the densest wood.
  const cellsWide = VIEW.width / LOCAL_TILE;
  const cellsTall = VIEW.height / LOCAL_TILE;
  const window64 = [cellsWide, Math.ceil(cellsTall)] as const;
  const sites = {
    shore: middle(findSite(fixture, ...window64, shore)),
    wood: middle(findSite(fixture, ...window64, forest)),
  };
  const local = { ...base, zoom: LOCAL_TILE };

  // The grounds: the map, the default local ground everywhere, the others where shown.
  stage.addGround(
    "map",
    paintGround(fixture, { tile: MAP_TILE, style: PROPOSED_MAP_GROUND, grain: false }),
    MAP_TILE,
  );
  stage.addGround(
    GROUND,
    paintGround(fixture, { tile: LOCAL_TILE, style: GROUND, grain: true }),
    LOCAL_TILE,
  );
  for (const scale of PLANT_SCALES) {
    stage.addPlants(scale.name, standingPlants(fixture, scale, LOCAL_TILE));
  }

  // 1. The map view: the whole world, two art pixels to the cell.
  const herd = stage.cast(fixture.creatures, 1, BODY);
  const map = { ...base, zoom: MAP_TILE, cast: herd, centre: middle(island) };
  place("map-squares", { ...map, ground: "map.png" });
  place("map-smooth", { ...map, ground: "map" });
  place("map-markers", { ...map, ground: "map", markers: true });

  // 2. The local view's ground, four ways, in two places.
  for (const style of GROUNDS) {
    for (const [site, centre] of Object.entries(sites)) {
      let ground: string = style;
      if (style !== GROUND) {
        ground = `${style}-${site}`;
        const cells = around(centre, cellsWide, cellsTall, PAINT_MARGIN, fixture);
        const pixels = paintGround(fixture, { tile: LOCAL_TILE, style, grain: true, cells });
        stage.addGround(ground, pixels, LOCAL_TILE, cells);
      }
      place(`ground-${style}-${site}`, { ...local, ground, plants: PLANTS, centre });
    }
  }

  // The staged shot's players: the specimens and some of the herd, on the shore.
  const specimens = cast("specimens");
  const shoreCells = around(sites.shore, cellsWide, cellsTall, 0, fixture);
  const players = scatter(
    [...specimens.creatures, ...fixture.creatures.slice(0, HERD_IN_STAGED_SHOT)],
    shoreCells,
    passable,
    random,
  );
  const troupes = new Map(
    SCALES.map((scale) => [scale, stage.cast(players, 4, { ...BODY, scale })] as const),
  );
  const troupe = troupes.get(BODY.scale) ?? null;

  // 3. Plants at three sizes: the drawings, then the wood and the shore.
  for (const scale of PLANT_SCALES) {
    plantStrip(element(`plants-${scale.name}`), scale, fixture);
    const picture = { ...local, ground: GROUND, plants: scale.name };
    place(`plants-${scale.name}-wood`, { ...picture, centre: sites.wood });
    place(`plants-${scale.name}-shore`, { ...picture, cast: troupe, centre: sites.shore });
  }

  // 4. Creatures: the specimens in each style, each followed by its own camera.
  const tile = (name: string, note: string, picture: Picture, enlarged: number): HTMLElement => {
    const figure = create("figure", "tile");
    const canvas = create("canvas");
    canvas.setAttribute("aria-label", `${name}: ${note}`);
    const caption = create("figcaption");
    caption.append(create("b", "", name), create("span", "", note));
    figure.append(canvas, caption);
    show(canvas, picture, enlarged);
    return figure;
  };
  const portrait = (layer: CreatureLayer, follow: number): Picture => ({
    ...local,
    ...PORTRAIT,
    ground: GROUND,
    cast: layer,
    follow,
    centre: middle(island),
  });
  const roomy: CellRect = { x0: 8, y0: 8, x1: fixture.width - 8, y1: fixture.height - 8 };
  const standing = scatter(specimens.creatures, roomy, passable, random);
  for (const style of CREATURE_STYLES) {
    const layer = stage.cast(standing, 2, { ...BODY, style });
    specimens.creatures.forEach((seed, index) => {
      const name = specimens.members[index] ?? "";
      const note = style === "circles" ? "" : describe(seed, fixture);
      element(`specimens-${style}`).append(
        tile(name, note, portrait(layer, index), SPECIMEN_ENLARGED),
      );
    });
  }
  // One gene at a time, on one flat colour: sand, or sea for those that swim.
  const sand = packed(fixture.palette["BARE"]?.[2] ?? "#cdbd9f");
  const sea = packed(fixture.sea[Math.floor(fixture.sea.length / 2)] ?? "#3b7fbf");
  for (const sweep of fixture.casts.filter((candidate) => candidate.name.startsWith("sweep-"))) {
    const gene = sweep.name.slice("sweep-".length);
    const [title, note] = SWEEP_NOTES[gene] ?? [gene, ""];
    const layer = stage.cast(scatter(sweep.creatures, roomy, passable, random), 3, BODY);
    const row = create("div", "sweep");
    const label = create("div", "gene");
    label.append(create("b", "", title), create("span", "", note));
    const steps = create("div", "steps");
    sweep.creatures.forEach((seed, index) => {
      const value = sweep.members[index] ?? "";
      const ground = bodyPlan(seed).swims ? sea : sand;
      const picture = { ...portrait(layer, index), ground };
      steps.append(tile(value, kindOf(seed), picture, SWEEP_ENLARGED));
    });
    row.append(label, steps);
    element("sweeps").append(row);
  }
  // The same shore with the animals at three sizes.
  for (const [scale, layer] of troupes) {
    const picture = { ...local, ground: GROUND, plants: PLANTS, cast: layer };
    place(`creatures-${scale}x`, { ...picture, centre: sites.shore });
  }

  // 5. Together: the local view as proposed, a closer one, and the light.
  const together = {
    ...local,
    ground: GROUND,
    plants: PLANTS,
    cast: troupe,
    centre: sites.shore,
  };
  for (const light of LIGHT_ORDER) place(`light-${light}`, { ...together, light });
  const closer = around(
    sites.shore,
    VIEW.width / CLOSER_TILE,
    VIEW.height / CLOSER_TILE,
    PAINT_MARGIN,
    fixture,
  );
  stage.addGround(
    "closer",
    paintGround(fixture, { tile: CLOSER_TILE, style: GROUND, grain: true, cells: closer }),
    CLOSER_TILE,
    closer,
  );
  const medium = PLANT_SCALES.find((scale) => scale.name === PLANTS) ?? PLANT_SCALES[0];
  if (medium !== undefined) stage.addPlants("closer", standingPlants(fixture, medium, CLOSER_TILE));
  place("closer", { ...together, zoom: CLOSER_TILE, ground: "closer", plants: "closer" });

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
