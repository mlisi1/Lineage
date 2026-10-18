/**
 * The land sheet (R1): the ground and the plants in each look, side by side, in the three
 * views, through the seasons and from one season into the next.
 *
 *   land.html             the sheet
 *   land.html?look=r0     another look; ?look=all for every one side by side
 *
 * `npm run land` turns it into a self-contained report in `reports/R1-land-sheet/`. The
 * words are in land.html; this file fills in the pictures.
 */
import { DEFAULT_LOOK, LOOKS, dressed, type Look } from "../looks";
import { colourArt, type PlantArt } from "../plants/plantart";
import { standingArts, standingPlants } from "../plants/plants";
import { seasonRamp, type Season } from "../plants/seasons";
import { groundSeasons, later, type YearTime } from "../plants/turning";
import { MAP_TILE, MID_TILE, paintGround, type GroundOptions } from "../terrain/ground";
import type { CellRect, Land } from "../terrain/land";
import { parseFixture, type WorldFixture } from "../spike/fixture";
import { heightAt } from "../spike/habitat";
import { GROUND, LOCAL_PIXELS, MAP_GROUND } from "../spike/proposal";
import { findSite, forest, meadow, shore } from "../spike/sites";
import { Stage, type Picture } from "../spike/stage";
import type { ClockMessage, LandMessage, Message } from "../protocol";
import { Camera, clockAfter, type Cue } from "./films";

/** Replaced by Vite with the commit the page was built from. */
declare const __BUILD_COMMIT__: string;

declare global {
  interface Window {
    /** Set once every picture has been drawn (the report script waits for it). */
    __landReady?: boolean;
    /** The page as one self-contained HTML document, pictures as inline images. */
    __landStandalone?: () => string;
  }
}

/** A view: what the screen holds, in art pixels (1024×600 at 2 screen pixels each). */
const VIEW = { width: 512, height: 300 };
/** Pictures are shown at this many screen pixels per art pixel. */
const SHOWN = 2;
const SHEET_SHOWN = 2;
const MEADOW_BELOW = 0.2;
/** Cells painted beyond a picture's edge, so that the shore's outline has what to meet. */
const MARGIN = 2;
/** The turns the sheet follows, and the days around each change of season it is shown on. */
const TURNS: readonly { name: string; change: Season }[] = [
  { name: "Summer into autumn", change: "autumn" },
  { name: "Autumn into winter", change: "winter" },
  { name: "Winter into spring", change: "spring" },
];
const TURN_DAYS = [-16, -8, 0, 8, 16] as const;
const SEASONS_SHOWN: readonly { name: string; season: Season; snow: boolean }[] = [
  { name: "spring", season: "spring", snow: false },
  { name: "summer", season: "summer", snow: false },
  { name: "autumn", season: "autumn", snow: false },
  { name: "winter", season: "winter", snow: false },
];

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`land.html has no #${id}`);
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

function canvasOf(width: number, height: number, shown: number, label: string): HTMLCanvasElement {
  const canvas = create("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * shown}px`;
  canvas.style.height = `${height * shown}px`;
  canvas.setAttribute("aria-label", label);
  return canvas;
}

/** A figure in `host`: the picture, then a caption in bold and a note. */
function figure(host: HTMLElement, canvas: HTMLCanvasElement, title: string, note = ""): void {
  const made = create("figure", "tile");
  const caption = create("figcaption");
  caption.append(create("b", "", title));
  if (note !== "") caption.append(create("span", "", ` ${note}`));
  made.append(canvas, caption);
  host.append(made);
}

const middle = (rect: CellRect): { x: number; y: number } => ({
  x: (rect.x0 + rect.x1) / 2,
  y: (rect.y0 + rect.y1) / 2,
});

/** The whole cells of a view of `width` × `height` art pixels at `zoom`, around `centre`. */
function around(
  centre: { x: number; y: number },
  zoom: number,
  land: Land,
  margin = MARGIN,
): CellRect {
  const wide = VIEW.width / zoom;
  const tall = VIEW.height / zoom;
  return {
    x0: Math.max(Math.floor(centre.x - wide / 2) - margin, 0),
    y0: Math.max(Math.floor(centre.y - tall / 2) - margin, 0),
    x1: Math.min(Math.ceil(centre.x + wide / 2) + margin, land.width),
    y1: Math.min(Math.ceil(centre.y + tall / 2) + margin, land.height),
  };
}

/** Drawings side by side on one colour, each standing on its shadow if it throws one. */
function sheet(
  host: HTMLElement,
  label: string,
  drawings: readonly { art: PlantArt; pixels: ReturnType<typeof colourArt> }[],
  ground: string,
  shadow: string,
): void {
  const wide = drawings.reduce((sum, { art }) => sum + art.width + 2, 4);
  const tall = Math.max(...drawings.map(({ art }) => art.height)) + 3;
  const canvas = canvasOf(wide, tall, SHEET_SHOWN, label);
  const context = canvas.getContext("2d");
  if (context === null) return;
  context.fillStyle = ground;
  context.fillRect(0, 0, wide, tall);
  let left = 3;
  for (const { art, pixels } of drawings) {
    const top = tall - 2 - art.height;
    if (art.shadow !== undefined) {
      const { rx, ry } = art.shadow;
      context.fillStyle = shadow;
      for (let y = Math.floor(-ry); y <= ry; y++) {
        const half = Math.round(rx * Math.sqrt(Math.max(1 - (y / ry) ** 2, 0)));
        const row = Math.round(top + art.footY + y);
        context.fillRect(Math.round(left + art.footX + rx * 0.16) - half, row, 2 * half, 1);
      }
    }
    const stamp = create("canvas");
    stamp.width = pixels.width;
    stamp.height = pixels.height;
    stamp
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    context.drawImage(stamp, left, top);
    left += art.width + 2;
  }
  figure(host, canvas, label);
}

const shadowCss = (look: Look): string => {
  const { shadow, shadowMix } = look.ground;
  return `rgba(${shadow >> 16}, ${(shadow >> 8) & 255}, ${shadow & 255}, ${shadowMix})`;
};

/** Trees, bushes and grass at the local view's size, in `look`, at one time of year. */
function plantSheets(
  host: HTMLElement,
  land: WorldFixture,
  look: Look,
  season: Season,
  snow: boolean,
): void {
  const worn = dressed(land, look);
  const arts = new Map(
    standingArts(worn, LOCAL_PIXELS, { close: true, season, snow, look }).map((art) => [
      art.key,
      art,
    ]),
  );
  const pick = (
    keys: readonly string[],
  ): { art: PlantArt; pixels: ReturnType<typeof colourArt> }[] =>
    keys.flatMap((key) => {
      const found = arts.get(key);
      if (found === undefined) return [];
      return [
        {
          art: found.art,
          pixels: colourArt(found.art, found.ramp, found.accent, found.wood, look.plants),
        },
      ];
    });
  const ground = snow
    ? worn.relief.snow[1]
    : seasonRamp(worn.palette, "GRASS", season, 0, look.seasons)[1];
  const every = (form: string, growth: string): string[] =>
    [0, 1, 2].map((variant) => `${form}/${growth}/${variant}`);
  sheet(
    host,
    "Trees",
    pick([
      ...every("BROADLEAF", "grown"),
      "BROADLEAF/young/0",
      "BROADLEAF/sprout/0",
      ...every("CONIFER", "grown"),
      "CONIFER/young/0",
    ]),
    ground,
    shadowCss(look),
  );
  sheet(
    host,
    "Bushes, grass and what grows among them",
    pick([
      ...every("SHRUB", "grown"),
      "SHRUB/young/0",
      "GRASS/grown/0",
      "GRASS/grown/1",
      "GRASS/young/0",
      "daisy/0",
      "bell/2",
      "spike/3",
      "umbel/4",
      "fern/0",
      "mushroom/0",
      "mushroom/2",
      "reed/0",
      "stone/1",
      "boulder/1",
      "log/0",
      "stump/1",
    ]),
    ground,
    shadowCss(look),
  );
}

/** A piece of each kind of ground at the local view's size: one cover over a few cells. */
function groundSamples(host: HTMLElement, land: WorldFixture, look: Look): void {
  const worn = dressed(land, look);
  const [across, down] = [3, 2];
  const wide = across + 4;
  const tall = down + 4;
  const sample = (name: string, cover: string, biomass: number, above: number): void => {
    const count = wide * tall;
    const world: Land = {
      ...worn,
      width: wide,
      height: tall,
      cover: new Uint8Array(count).fill(Math.max(worn.coverClasses.indexOf(cover), 0)),
      biomass: new Uint8Array(count).fill(biomass),
      heights: new Float32Array(count).fill(worn.seaLevel + above),
    };
    const pixels = paintGround(world, {
      tile: LOCAL_PIXELS,
      style: GROUND,
      grain: true,
      cells: { x0: 2, y0: 2, x1: 2 + across, y1: 2 + down },
      look,
    });
    const canvas = canvasOf(pixels.width, pixels.height, 1, `Ground: ${name}`);
    canvas
      .getContext("2d")
      ?.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
    figure(host, canvas, name);
  };
  const { highRockFrom, snowFrom } = worn.relief;
  sample("grass", "GRASS", 230, 0.1);
  sample("grass, dried", "GRASS", 50, 0.1);
  sample("bare soil", "BARE", 0, 0.1);
  sample("sand", "BARE", 0, 0.003);
  sample("lichen", "LICHEN", 200, 0.1);
  sample("rock", "BARE", 0, highRockFrom + 0.05);
  sample("snow", "BARE", 0, snowFrom + 0.05);
  sample("under bushes", "SHRUB", 220, 0.1);
  sample("under broadleaves", "BROADLEAF", 230, 0.1);
  sample("under conifers", "CONIFER", 230, 0.1);
  sample("burnt", "BURNT", 0, 0.1);
}

/** A film on the sheet: an animated PNG, shown as large as the other pictures. */
function filmFigure(host: HTMLElement, uri: string, title: string, note: string): void {
  const made = create("figure", "tile");
  const image = create("img");
  image.src = uri;
  image.alt = title;
  image.style.width = `${512 * SHOWN}px`;
  image.style.height = `${300 * SHOWN}px`;
  const caption = create("figcaption");
  caption.append(create("b", "", title), create("span", "", ` ${note}`));
  made.append(image, caption);
  host.append(made);
}

/** The films: the sea moving, and the year turning day by day. */
async function filmSection(host: HTMLElement): Promise<void> {
  const response = await fetch("stream/recording.json");
  if (!response.ok) throw new Error(`stream/recording.json: HTTP ${response.status}`);
  const messages = ((await response.json()) as { messages: Message[] }).messages;
  const clocks = messages.filter((message): message is ClockMessage => message.type === "clock");
  const lands = messages.filter((message): message is LandMessage => message.type === "land");
  const lastClock = clocks.at(-1);
  const lastLand = lands.at(-1);
  if (lastClock === undefined || lastLand === undefined) throw new Error("the recording is empty");
  const camera = await Camera.create();
  const sea = { seconds: 7.2, fps: 8, fadeS: 0.4 };

  filmFigure(
    host,
    await camera.film({ view: "local", x: 26, y: 47 }, [lastClock, lastLand], [], sea),
    "The sea, from close.",
    "The surf comes in and goes back every 3.6 s; glints grow on the open water and go.",
  );
  filmFigure(
    host,
    await camera.film({ view: "middle", x: 40, y: 40 }, [lastClock, lastLand], [], sea),
    "The sea, from the middle view.",
    "The same, smaller.",
  );

  // Summer into autumn: the recording's own days, from 2 September, one every half second.
  const from = 30;
  const day = 0.5;
  const startClock = clocks[from];
  const startLand = lands[1];
  if (startClock !== undefined && startLand !== undefined) {
    const cues: Cue[] = clocks.slice(from + 1).map((clock, index) => ({
      at: (index + 1) * day,
      message: clock,
    }));
    cues.push({ at: (clocks.length - 1 - from) * day, message: lastLand });
    filmFigure(
      host,
      await camera.film({ view: "middle", x: 60, y: 60 }, [startClock, startLand], cues, {
        seconds: cues.length * day + 1.5,
        fps: 10,
        fadeS: 0.4,
      }),
      `Summer into autumn, ${startClock.date} to ${lastClock.date}.`,
      "A day every half second, each fading in over the one before: the wood turns tree by tree, the hills first.",
    );
  }

  // Autumn into winter: the recording ends in September, so the clock is run on over its last land.
  const winterFrom = 68;
  const every = 2;
  const winterCues: Cue[] = Array.from({ length: 16 }, (_, index) => ({
    at: (index + 1) * 0.6,
    message: clockAfter(lastClock, winterFrom + (index + 1) * every),
  }));
  const first = clockAfter(lastClock, winterFrom);
  const final = clockAfter(lastClock, winterFrom + 16 * every);
  filmFigure(
    host,
    await camera.film({ view: "middle", x: 60, y: 60 }, [first, lastLand], winterCues, {
      seconds: 16 * 0.6 + 1.5,
      fps: 10,
      fadeS: 0.4,
    }),
    `Autumn into winter, ${first.date} to ${final.date}.`,
    "Two days every 0.6 s. The clock is run on over the recording's last land (28 September), so the plants are September's and no snow has come: the leaves go, the bushes brown.",
  );
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const only = params.get("look");
  // The chosen look alone, unless asked for another or for all of them.
  const looks = LOOKS.filter((look) =>
    only === "all" ? true : only === null ? look === DEFAULT_LOOK : look.name === only,
  );
  const response = await fetch("spike/world.json");
  if (!response.ok) throw new Error(`spike/world.json: HTTP ${response.status}`);
  const fixture = parseFixture(await response.json());
  const stage = await Stage.create(fixture, "spike", VIEW.width, VIEW.height);
  element("world").textContent = fixture.description;
  element("build").textContent =
    typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "unknown";

  const base: Picture = {
    width: VIEW.width,
    height: VIEW.height,
    zoom: MAP_TILE,
    ground: 0,
    plants: null,
    light: "day",
    cast: null,
    markers: false,
    follow: null,
    only: null,
    subject: null,
    centre: { x: fixture.width / 2, y: fixture.height / 2 },
  };
  const draw = (picture: Picture, label: string): HTMLCanvasElement => {
    const canvas = canvasOf(picture.width, picture.height, SHOWN, label);
    const context = canvas.getContext("2d");
    if (context !== null) stage.draw(picture, context);
    return canvas;
  };

  // Where the camera goes: the same places in every look.
  const midSize = [VIEW.width / MID_TILE, Math.ceil(VIEW.height / MID_TILE)] as const;
  const localSize = [VIEW.width / LOCAL_PIXELS, Math.ceil(VIEW.height / LOCAL_PIXELS)] as const;
  const sites = {
    midWood: middle(findSite(fixture, ...midSize, forest)),
    midShore: middle(findSite(fixture, ...midSize, shore)),
    meadow: middle(
      findSite(fixture, ...localSize, (shares, window) => {
        const centre = middle(window);
        const high = heightAt(fixture, centre.x, centre.y) - fixture.seaLevel > MEADOW_BELOW;
        return meadow(shares) - (high ? 1 : 0) - 2 * (shares["BARE"] ?? 0);
      }),
    ),
    wood: middle(findSite(fixture, ...localSize, forest)),
    shore: middle(findSite(fixture, ...localSize, shore)),
  };

  /** Paint and add a ground for `look` over the view around `centre` at `zoom`. */
  const ground = (
    name: string,
    land: WorldFixture,
    zoom: number,
    centre: { x: number; y: number } | null,
    options: Partial<GroundOptions>,
  ): void => {
    const cells = centre === null ? undefined : around(centre, zoom, land);
    stage.addGround(
      name,
      paintGround(land, {
        tile: zoom,
        style: zoom === MAP_TILE ? MAP_GROUND : GROUND,
        grain: zoom !== MAP_TILE,
        ...(cells === undefined ? {} : { cells }),
        ...options,
      }),
      zoom,
      cells,
    );
  };

  for (const look of looks) {
    const worn = dressed(fixture, look);
    const season = fixture.season;
    const name = look.name;

    // The map.
    ground(`map-${name}`, worn, MAP_TILE, null, { look, season });
    figure(
      element("map"),
      draw({ ...base, ground: `map-${name}` }, `Map, ${name}`),
      name,
      "the whole continent, two art pixels to the cell",
    );

    // The middle view: a wood and a shore.
    const mid = standingPlants(worn, MID_TILE, { look, lazy: true });
    stage.addPlants(`mid-${name}`, mid);
    for (const [where, centre] of [
      ["wood", sites.midWood],
      ["shore", sites.midShore],
    ] as const) {
      const cells = around(centre, MID_TILE, worn);
      ground(`mid-${where}-${name}`, worn, MID_TILE, centre, {
        look,
        season,
        shadows: mid.shadows(cells),
      });
      figure(
        element(`mid-${where}`),
        draw(
          {
            ...base,
            zoom: MID_TILE,
            ground: `mid-${where}-${name}`,
            plants: `mid-${name}`,
            centre,
          },
          `Middle view, ${where}, ${name}`,
        ),
        name,
      );
    }

    // The local view: a meadow, a wood, a shore.
    const near = standingPlants(worn, LOCAL_PIXELS, { look, close: true });
    stage.addPlants(`local-${name}`, near);
    for (const where of ["meadow", "wood", "shore"] as const) {
      const centre = sites[where];
      const cells = around(centre, LOCAL_PIXELS, worn);
      ground(`local-${where}-${name}`, worn, LOCAL_PIXELS, centre, {
        look,
        season,
        shadows: near.shadows(cells),
      });
      figure(
        element(`local-${where}`),
        draw(
          {
            ...base,
            zoom: LOCAL_PIXELS,
            ground: `local-${where}-${name}`,
            plants: `local-${name}`,
            centre,
          },
          `Local view, ${where}, ${name}`,
        ),
        name,
      );
    }

    // Ground samples and plant sheets.
    const samples = create("div", "row");
    element("ground-samples").append(create("h3", "", name), samples);
    groundSamples(samples, fixture, look);
    const plants = create("div", "row");
    element("plants").append(create("h3", "", name), plants);
    plantSheets(plants, fixture, look, "summer", false);

    // Every season: the wood from the middle view, the shore from close, the plants.
    const year = create("div", "row");
    element("seasons").append(create("h3", "", name), year);
    for (const time of SEASONS_SHOWN) {
      const options = { look, season: time.season, snow: time.snow };
      const far = standingPlants(worn, MID_TILE, { ...options, lazy: true });
      stage.addPlants(`mid-${time.name}-${name}`, far);
      const cells = around(sites.midWood, MID_TILE, worn);
      ground(`mid-${time.name}-${name}`, worn, MID_TILE, sites.midWood, {
        ...options,
        shadows: far.shadows(cells),
      });
      const close = standingPlants(worn, LOCAL_PIXELS, { ...options, close: true });
      stage.addPlants(`local-${time.name}-${name}`, close);
      const shoreCells = around(sites.shore, LOCAL_PIXELS, worn);
      ground(`shore-${time.name}-${name}`, worn, LOCAL_PIXELS, sites.shore, {
        ...options,
        shadows: close.shadows(shoreCells),
      });
      const column = create("div", "column");
      column.append(create("h4", "", time.snow ? "winter, under snow" : time.name));
      figure(
        column,
        draw(
          {
            ...base,
            zoom: MID_TILE,
            ground: `mid-${time.name}-${name}`,
            plants: `mid-${time.name}-${name}`,
            centre: sites.midWood,
          },
          `A wood in ${time.name}, ${name}`,
        ),
        "a wood",
      );
      figure(
        column,
        draw(
          {
            ...base,
            zoom: LOCAL_PIXELS,
            ground: `shore-${time.name}-${name}`,
            plants: `local-${time.name}-${name}`,
            centre: sites.shore,
          },
          `A shore in ${time.name}, ${name}`,
        ),
        "a shore, from close",
      );
      year.append(column);
      plantSheets(column, fixture, look, time.season, time.snow);
    }
  }

  // The turn of the year: the same wood day by day around each change of season.
  for (const look of looks) {
    const worn = dressed(fixture, look);
    const name = look.name;
    const host = element("turning");
    host.append(create("h3", "", name));
    for (const turn of TURNS) {
      host.append(create("h4", "", turn.name));
      const row = create("div", "row");
      host.append(row);
      for (const days of TURN_DAYS) {
        const time: YearTime = later({ season: turn.change, progress: 0 }, days);
        const key = `${name}-${turn.change}-${days}`;
        const seasonAt = groundSeasons(
          time,
          (u, v) => heightAt(fixture, u + 0.5, v + 0.5),
          fixture.seaLevel,
        );
        const far = standingPlants(worn, MID_TILE, { look, time, lazy: true });
        stage.addPlants(`mid-turn-${key}`, far);
        const cells = around(sites.midWood, MID_TILE, worn);
        ground(`mid-turn-${key}`, worn, MID_TILE, sites.midWood, {
          look,
          season: time.season,
          seasonAt,
          shadows: far.shadows(cells),
        });
        const column = create("div", "column");
        figure(
          column,
          draw(
            {
              ...base,
              zoom: MID_TILE,
              ground: `mid-turn-${key}`,
              plants: `mid-turn-${key}`,
              centre: sites.midWood,
            },
            `${turn.name}, ${days} days, ${name}`,
          ),
          days === 0 ? "the day it changes" : `${days > 0 ? "+" : "−"}${Math.abs(days)} days`,
        );
        row.append(column);
      }
    }
  }

  // In motion: the R1 scene itself, from the committed recording, filmed.
  await filmSection(element("films"));

  window.__landStandalone = () => {
    const copy = document.documentElement.cloneNode(true) as HTMLElement;
    const originals = [...document.querySelectorAll("canvas")];
    [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
      const original = originals[index];
      if (original === undefined) return;
      const image = document.createElement("img");
      image.src = original.toDataURL("image/png");
      image.setAttribute("style", original.getAttribute("style") ?? "");
      image.alt = original.getAttribute("aria-label") ?? "";
      canvas.replaceWith(image);
    });
    copy.querySelectorAll("script").forEach((script) => script.remove());
    return `<!doctype html>\n${copy.outerHTML}`;
  };
  window.__landReady = true;
}

main().catch((error: unknown) => {
  element("failure").textContent = error instanceof Error ? error.message : String(error);
  window.__landReady = true;
});
