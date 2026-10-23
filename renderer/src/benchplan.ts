/**
 * What the scene's benchmark (`bench.ts`, R5) measures, and where: its scenarios, and the
 * places in the recorded world each one looks at, found once before the first runs.
 *
 * The four views the R0 spike was judged on (ADR 0010) come first, now drawn by the real
 * scene from the creatures' recording; then what the atmosphere costs (R4's "For R5"):
 * the moonlit night and its glow, rain, a big fire, the apocalypse's flood repainted ten
 * times a second, and the tide's shader on a coast up close.
 */
import { fireReach } from "./atmosphere/demo";
import type { CreaturesMessage, LandMessage, Message, RareMessage } from "./protocol";
import { landOf } from "./stream";
import type { Land } from "./terrain/land";
import type { ViewName } from "./landscape";

/** Where a pinned camera looks: the plan finds each of these in the recorded world. */
export type Spot = "crowd" | "fuel" | "shore";

export interface BenchScenario {
  name: string;
  about: string;
  /** The committed recording played (`public/stream/`, by `main.ts`'s names). */
  recording: "life";
  /** The view button pressed this many times once the scene is ready (the director films). */
  presses?: number;
  /** Or the camera pinned to a view at a spot of the plan's (no director). */
  pin?: { view: ViewName; at: Spot };
  /** The atmosphere asked for (`?show=`, `atmosphere/demo.ts`). */
  show?: string;
  /**
   * Something the benchmark does itself once the scene is ready: a big fire; the world's
   * end, moved on into its flood; every animal a glow carrier.
   */
  stage?: "fire" | "flood" | "glow";
  /** The view the measurement waits for before its warm-up. */
  view: ViewName;
}

export const SCENARIOS: readonly BenchScenario[] = [
  {
    name: "map",
    about: "The map view: the whole island, every animal a dot.",
    recording: "life",
    presses: 0,
    view: "map",
  },
  {
    name: "middle",
    about: "The middle view, drifting over the island: the button pressed once.",
    recording: "life",
    presses: 1,
    view: "middle",
  },
  {
    name: "middle-crowd",
    about: "The middle view held where the most animals are in sight.",
    recording: "life",
    pin: { view: "middle", at: "crowd" },
    view: "middle",
  },
  {
    name: "local",
    about: "The local view following an animal: the button pressed twice.",
    recording: "life",
    presses: 2,
    view: "local",
  },
  {
    name: "night",
    about:
      "Night over the crowded middle view: the moonlit tint, and the glow pass with every " +
      "animal a glow carrier (the recording has none).",
    recording: "life",
    pin: { view: "middle", at: "crowd" },
    show: "night",
    stage: "glow",
    view: "middle",
  },
  {
    name: "rain",
    about: "Rain over the crowded middle view: raindrops at full strength under grey cloud.",
    recording: "life",
    pin: { view: "middle", at: "crowd" },
    show: "rain",
    view: "middle",
  },
  {
    name: "fire",
    about:
      "A big fire in the middle view, under the thunderstorm that lit it: every burning " +
      "cell lit, flames, smoke and halos.",
    recording: "life",
    pin: { view: "middle", at: "fuel" },
    stage: "fire",
    view: "middle",
  },
  {
    name: "apocalypse",
    about: "The world's end on the map, in its flood: a world-sized texture repainted 10×/s.",
    recording: "life",
    presses: 0,
    stage: "flood",
    view: "map",
  },
  {
    name: "shore",
    about: "The local view held on the most coast it can show: the tide's shader.",
    recording: "life",
    pin: { view: "local", at: "shore" },
    view: "local",
  },
];

/**
 * The scenarios judged (ADR 0010, ADR 0022): the three views and the crowded middle one,
 * each holding 30 fps, the cap on the board.
 */
export const ACCEPTANCE: readonly string[] = ["map", "middle", "middle-crowd", "local"];
/** The atmosphere's costs, measured beside them. */
export const ATMOSPHERE: readonly string[] = ["night", "rain", "fire", "apocalypse", "shore"];
/** Names `?only=` takes for each set. */
const SETS: Readonly<Record<string, readonly string[]>> = {
  acceptance: ACCEPTANCE,
  atmosphere: ATMOSPHERE,
};

/** Cells burning in the big fire: as many as the atmosphere lights (`MOST_FIRES`). */
export const BIG_FIRE_CELLS = 300;
/**
 * Seconds into the world's end the flood scenario starts: the flood is the third act,
 * after 20 s of omen and 40 s of fire, and the sea rises over the land for 60 s; a few
 * seconds in, it is rising everywhere.
 */
export const FLOOD_AT_S = 65;

/**
 * The scenarios `only` names (`acceptance` and `atmosphere` stand for their sets), in
 * table order; all of them for none. Unknown names are an error.
 */
export function selectScenarios(only: readonly string[] | null): BenchScenario[] {
  if (only === null) return [...SCENARIOS];
  const names = new Set(only.flatMap((name) => SETS[name] ?? [name]));
  const known = new Set(SCENARIOS.map((scenario) => scenario.name));
  const unknown = [...names].filter((name) => !known.has(name));
  if (unknown.length > 0) throw new Error(`unknown scenario: ${unknown.join(", ")}`);
  return SCENARIOS.filter((scenario) => names.has(scenario.name));
}

/** A place in cells. */
export interface Place {
  x: number;
  y: number;
}

/** The places the scenarios look at, found in the recording before they run. */
export interface Plan {
  /** The middle view's centre with the most animals in sight while the scenarios run. */
  crowd: Place;
  /** The middle view's centre with the most fuel in sight, and the fire's first cell. */
  fuel: Place;
  fire: Place;
  /** The local view's centre with the most coast in sight. */
  shore: Place;
  /** The world, in cells, and what the recording holds. */
  world: { cells: [number, number]; description: string };
  /** The glow gene's bit in the creatures' rare-gene slots (0: the world has none). */
  glowBit: number;
  /** The genome of every animal born within the horizon, to send again with the glow gene. */
  genomes: { id: number; genome: number[]; slots: number }[];
}

/** The size of a view, in cells. */
export interface ViewCells {
  width: number;
  height: number;
}

/**
 * Sums of `weights` (one per cell of a `width`×`height` grid) over every window of
 * `view` cells, and the centre of the window with the largest; ties go to the first in
 * reading order, so the plan is the same every time.
 */
export function densest(
  weights: Float64Array,
  width: number,
  height: number,
  view: ViewCells,
): Place {
  const w = Math.min(Math.round(view.width), width);
  const h = Math.min(Math.round(view.height), height);
  // Prefix sums with a row and a column of zeros in front.
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += weights[y * width + x] ?? 0;
      sums[(y + 1) * stride + x + 1] = (sums[y * stride + x + 1] ?? 0) + row;
    }
  }
  const at = (x: number, y: number): number => sums[y * stride + x] ?? 0;
  let best = -1;
  let place: Place = { x: width / 2, y: height / 2 };
  for (let y0 = 0; y0 + h <= height; y0++) {
    for (let x0 = 0; x0 + w <= width; x0++) {
      const total = at(x0 + w, y0 + h) - at(x0, y0 + h) - at(x0 + w, y0) + at(x0, y0);
      if (total > best) {
        best = total;
        place = { x: x0 + w / 2, y: y0 + h / 2 };
      }
    }
  }
  return place;
}

/** Least biomass (0–255) a cell needs to burn: the sim's `fire_min_fuel`, as `demo.ts` has it. */
const FUEL_FROM = 38;
/** Cover classes that carry a fire well (the sim's flammability of 0.8 and more). */
const FLAMMABLE = ["GRASS", "SHRUB", "CONIFER"];

function isLand(land: Land, cell: number): boolean {
  return (land.heights[cell] ?? 0) > land.seaLevel;
}

/** One per cell: 1 where a fire would run well. */
export function fuelWeights(land: Land): Float64Array {
  const weights = new Float64Array(land.width * land.height);
  for (let cell = 0; cell < weights.length; cell++) {
    const form = land.coverClasses[land.cover[cell] ?? 0] ?? "";
    const fuel = isLand(land, cell) && (land.biomass[cell] ?? 0) >= FUEL_FROM;
    weights[cell] = fuel && FLAMMABLE.includes(form) ? 1 : 0;
  }
  return weights;
}

/** One per cell: 1 on land beside the sea (four neighbours), where the tide breaks. */
export function coastWeights(land: Land): Float64Array {
  const { width, height } = land;
  const weights = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (!isLand(land, cell)) continue;
      const sea = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx = 0, ny = 0]) => {
        const inside = nx >= 0 && ny >= 0 && nx < width && ny < height;
        return inside && !isLand(land, ny * width + nx);
      });
      weights[cell] = sea ? 1 : 0;
    }
  }
  return weights;
}

/** One per cell: how many animals stood there, over the creatures' messages given. */
export function crowdWeights(
  creatures: readonly CreaturesMessage[],
  width: number,
  height: number,
): Float64Array {
  const weights = new Float64Array(width * height);
  for (const message of creatures) {
    for (const [x, y] of message.positions) {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
      weights[cy * width + cx] = (weights[cy * width + cx] ?? 0) + 1;
    }
  }
  return weights;
}

/** The cell with weight nearest `place`, or `place` itself where there is none. */
function nearestWeighted(weights: Float64Array, width: number, place: Place): Place {
  let best = place;
  let bestD = Infinity;
  for (let cell = 0; cell < weights.length; cell++) {
    if ((weights[cell] ?? 0) <= 0) continue;
    const x = (cell % width) + 0.5;
    const y = Math.floor(cell / width) + 0.5;
    const d = (x - place.x) ** 2 + (y - place.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = { x, y };
    }
  }
  return best;
}

/**
 * The plan for a recording's messages: the first land, and the animals of the first
 * `horizonMs` of sim time (what plays while the scenarios load and run).
 */
export function planOf(
  messages: readonly Message[],
  horizonMs: number,
  views: Readonly<Record<ViewName, ViewCells>>,
): Plan {
  const landMessage = messages.find((message): message is LandMessage => message.type === "land");
  if (landMessage === undefined) throw new Error("bench: the recording has no land");
  const land = landOf(landMessage, null);
  const { width, height } = land;
  const creatures = messages.filter(
    (message): message is CreaturesMessage =>
      message.type === "creatures" && message.t_ms <= landMessage.t_ms + horizonMs,
  );
  const fuel = fuelWeights(land);
  const fuelCentre = densest(fuel, width, height, views.middle);
  const fire = nearestWeighted(fuel, width, fuelCentre);
  const animals = creatures[0]?.ids.length ?? 0;
  const rare = messages.find((message): message is RareMessage => message.type === "rare");
  const glow = rare?.genes.find((gene) => gene.kingdom === "creature" && gene.signature === "glow");
  return {
    crowd: densest(crowdWeights(creatures, width, height), width, height, views.middle),
    fuel: fuelCentre,
    fire,
    shore: densest(coastWeights(land), width, height, views.local),
    world: {
      cells: [width, height],
      description: `${width}×${height} cells, ${animals} animals, world seed ${landMessage.world.seed}`,
    },
    glowBit: glow?.bit ?? 0,
    genomes: creatures.flatMap((message) =>
      message.born.map(({ id, genome, slots }) => ({ id, genome, slots: slots ?? 0 })),
    ),
  };
}

/** The cells the big fire burns from the plan's first cell, in the land as drawn now. */
export function bigFire(land: Land, plan: Plan): number[] {
  return fireReach(land, plan.fire.x, plan.fire.y, BIG_FIRE_CELLS).sort((a, b) => a - b);
}
