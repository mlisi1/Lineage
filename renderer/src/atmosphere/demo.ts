/**
 * The atmosphere on demand (R4): messages as the stream would send them, made up for the
 * land on the screen, so that a look at the scene (`?show=night,fire`) and the visual
 * tests can see each light and each event, and what it leaves, without waiting years for
 * it. Not the island's history: nothing here reaches the sim.
 *
 *   day, dusk, dawn, night, moon        the light ([presence]: night 0.05, moonlight 0.15)
 *   rain, thunder, storm, soaking       what falls (the island's own rain; the rain power's)
 *   cloud                               an overcast sky, nothing falling
 *   fire                                a thunderstorm's lightning sets the plants alight
 *                                       (the fire goes where they carry it, `fireReach`)
 *   burnt                               where such a fire went: charred trees, scorch
 *   volcano, quake, meteor              the terrain's events; a volcano raises its cone and
 *                                       a meteor digs its bowl in the land sent with them
 *   seed, ark                           the powers (`burnt,seed` sows the burnt ground)
 *                                       : seed motes, then sprouts on the bare
 *                                       land in sight; the ark's light and its newcomers
 *   end                                 a world's end (no next world: the same land rises)
 *
 * Messages that come later (the land after a seed takes, the newcomers after the ark's
 * light) carry the wall seconds to wait.
 */
import type {
  CreaturesMessage,
  EventsMessage,
  Grid,
  LandMessage,
  Message,
  SkyMessage,
} from "../protocol";
import { gridNumbers, landOf } from "../stream";
import type { Land } from "../terrain/land";
import { cellHash } from "../terrain/pixels";

export const SHOWS = [
  "day",
  "dusk",
  "dawn",
  "night",
  "moon",
  "rain",
  "thunder",
  "storm",
  "soaking",
  "cloud",
  "fire",
  "burnt",
  "volcano",
  "quake",
  "meteor",
  "seed",
  "ark",
  "end",
] as const;
export type Show = (typeof SHOWS)[number];

/** The light and presence of each time of day shown. */
const LIGHTS: Readonly<Record<string, { light: number; present: boolean }>> = {
  day: { light: 1, present: true },
  dusk: { light: 0.4, present: false },
  dawn: { light: 0.4, present: true },
  night: { light: 0.05, present: false },
  moon: { light: 0.15, present: false },
};
const RAINS = ["rain", "thunder", "storm", "soaking", "cloud"] as const;

/** Cells set on fire, and burnt in a burnt wood; cells across the bare land sown. */
const FIRE_CELLS = 24;
const BURNT_CELLS = 60;
/** Least biomass (0–255) that carries fire (the sim's `fire_min_fuel`, 0.15). */
const FUEL_FROM = 38;
/** How readily each form burns (the sim's `[flora] flammability_*`). */
const FLAMMABLE: Readonly<Record<string, number>> = {
  LICHEN: 0.2,
  GRASS: 1,
  SHRUB: 0.8,
  BROADLEAF: 0.35,
  CONIFER: 0.9,
};

/**
 * The cells a fire from (x, y) reaches first: it goes from cell to neighbouring cell only
 * where plants carry it, the most flammable fuel first, as the sim's fire spreads. The
 * cells come in the order the fire reached them.
 */
export function fireReach(land: Land, x: number, y: number, count: number): number[] {
  const fuel = (cell: number): number => {
    const biomass = land.biomass[cell] ?? 0;
    if (biomass < FUEL_FROM || (land.heights[cell] ?? 0) <= land.seaLevel) return 0;
    const form = land.coverClasses[land.cover[cell] ?? 0] ?? "";
    return (FLAMMABLE[form] ?? 0) * (biomass / 255);
  };
  const start = Math.floor(y) * land.width + Math.floor(x);
  const reached = new Set<number>();
  // The burning edge, the most flammable cell taken next (a hash breaks ties).
  const edge: { cell: number; score: number }[] = [{ cell: start, score: 1 }];
  while (edge.length > 0 && reached.size < count) {
    edge.sort((a, b) => b.score - a.score);
    const next = edge.shift();
    if (next === undefined || reached.has(next.cell)) continue;
    reached.add(next.cell);
    const cx = next.cell % land.width;
    const cy = Math.floor(next.cell / land.width);
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= land.width || ny >= land.height) continue;
      const cell = ny * land.width + nx;
      const carries = fuel(cell);
      if (carries > 0 && !reached.has(cell)) {
        // A fire runs most where fuel is best, and widens out from where it began.
        const away = Math.hypot(nx - x, ny - y) / Math.sqrt(count);
        const luck = 0.6 + 0.4 * cellHash(cell, 0, 503);
        edge.push({ cell, score: carries * luck * Math.exp(-away) });
      }
    }
  }
  return [...reached];
}

const SOWN_CELLS = 24;
/** A demo volcano's and meteor's size (cells), and the cone's height and bowl's depth (height units). */
const VOLCANO_RADIUS = 5;
const VOLCANO_HEIGHT = 0.12;
const METEOR_RADIUS = 3;
const METEOR_DEPTH = 0.05;
/** The bare land round a cone or a crater, as a share of its radius (the sim's `[flora] barren_reach`). */
const BARREN_REACH = 1.4;
/** Wall seconds before the seed's sprouts show, and the ark's newcomers land. */
const SOWN_AFTER_S = 4;
const LANDED_AFTER_S = 1.5;
/** How many newcomers the ark brings in a demo. */
const ARK_COUNT = 6;

/** A message, and the wall seconds to wait before it is sent. */
export interface Timed {
  afterS: number;
  message: Message;
}

/** The names in `text` (comma-separated) that are shows, in order. */
export function showsOf(text: string | null): Show[] {
  if (text === null) return [];
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name): name is Show => (SHOWS as readonly string[]).includes(name));
}

/**
 * The land cell nearest (x, y) (cells), or (x, y) itself if there is no land; with
 * `bare`, the nearest land cell with (almost) no plants on it.
 */
export function landNear(land: Land, x: number, y: number, bare = false): { x: number; y: number } {
  let best = { x, y };
  let bestD = Infinity;
  for (let cy = 0; cy < land.height; cy++) {
    for (let cx = 0; cx < land.width; cx++) {
      const cell = cy * land.width + cx;
      if ((land.heights[cell] ?? 0) <= land.seaLevel + 0.01) continue;
      if (bare && (land.biomass[cell] ?? 0) > 10) continue;
      const d = (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: cx + 0.5, y: cy + 0.5 };
      }
    }
  }
  return best;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** `grid` with its whole numbers replaced by `numbers`. */
export function regrid(grid: Grid, numbers: Uint8Array | Uint16Array): Grid {
  if (grid.encoding === "u8") return { ...grid, data: encodeBase64(Uint8Array.from(numbers)) };
  const bytes = new Uint8Array(numbers.length * 2);
  numbers.forEach((value, i) => {
    bytes[2 * i] = value & 255;
    bytes[2 * i + 1] = value >> 8;
  });
  return { ...grid, data: encodeBase64(bytes) };
}

/** Cells within `radius` of (x, y), with their distance as a share of it. */
function around(message: LandMessage, x: number, y: number, radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
    for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
      if (cx < 0 || cy < 0 || cx >= message.width || cy >= message.height) continue;
      const d = Math.hypot(cx + 0.5 - x, cy + 0.5 - y) / radius;
      if (d <= 1) out.push([cy * message.width + cx, d]);
    }
  }
  return out;
}

/** The land of `message` changed as `change` says, on its grids' whole numbers. */
function changed(
  message: LandMessage,
  change: (grids: {
    heights: Uint16Array;
    cover: Uint8Array;
    biomass: Uint8Array;
    plantHeight: Uint8Array;
    scorch: Uint8Array;
    cls: (name: string) => number;
    heightUnit: number;
  }) => void,
): LandMessage {
  const cells = message.width * message.height;
  const heights = Uint16Array.from(gridNumbers(message.heights, cells));
  const cover = Uint8Array.from(gridNumbers(message.cover, cells));
  const biomass = Uint8Array.from(gridNumbers(message.biomass, cells));
  const plantHeight = Uint8Array.from(gridNumbers(message.plant_height, cells));
  const scorchGrid = message.scorch ?? { encoding: "u8", scale: 255, data: "" };
  const scorch =
    message.scorch === undefined
      ? new Uint8Array(cells)
      : Uint8Array.from(gridNumbers(message.scorch, cells));
  change({
    heights,
    cover,
    biomass,
    plantHeight,
    scorch,
    cls: (name) => message.cover_classes.indexOf(name),
    heightUnit: message.heights.scale,
  });
  return {
    ...message,
    heights: regrid(message.heights, heights),
    cover: regrid(message.cover, cover),
    biomass: regrid(message.biomass, biomass),
    plant_height: regrid(message.plant_height, plantHeight),
    scorch: regrid(scorchGrid, scorch),
  };
}

/** A cone of a volcano at (x, y), as the sim raises it, the land round it bared (`barren_reach`). */
export function withCone(message: LandMessage, x: number, y: number): LandMessage {
  return changed(message, ({ heights, cover, biomass, cls, heightUnit }) => {
    for (const [cell, d] of around(message, x, y, VOLCANO_RADIUS)) {
      const rise = VOLCANO_HEIGHT * (1 - d) ** 1.5 * heightUnit;
      heights[cell] = Math.min((heights[cell] ?? 0) + Math.round(rise), 65535);
    }
    for (const [cell] of around(message, x, y, VOLCANO_RADIUS * BARREN_REACH)) {
      cover[cell] = Math.max(cls("BARE"), 0);
      biomass[cell] = 0;
    }
  });
}

/** A meteor's bowl at (x, y) (`apply_crater`), the land round it bared. */
export function withCrater(message: LandMessage, x: number, y: number): LandMessage {
  return changed(message, ({ heights, cover, biomass, cls, heightUnit }) => {
    for (const [cell, d] of around(message, x, y, METEOR_RADIUS)) {
      const dig = METEOR_DEPTH * (1 - d * d) * heightUnit;
      heights[cell] = Math.max((heights[cell] ?? 0) - Math.round(dig), 0);
    }
    for (const [cell] of around(message, x, y, METEOR_RADIUS * BARREN_REACH)) {
      cover[cell] = Math.max(cls("BARE"), 0);
      biomass[cell] = 0;
    }
  });
}

/** A wood a fire went through round (x, y): the trees it killed, the ground scorched. */
export function withBurnt(message: LandMessage, x: number, y: number, land: Land): LandMessage {
  const burnt = fireReach(land, x, y, BURNT_CELLS);
  return changed(message, ({ cover, biomass, plantHeight, scorch, cls }) => {
    burnt.forEach((cell, n) => {
      const wood = (land.plantHeight?.[cell] ?? 0) >= 153;
      cover[cell] = Math.max(cls("BURNT"), 0);
      biomass[cell] = wood ? 6 : 0; // what a fire leaves of a tree: 3 %
      plantHeight[cell] = land.plantHeight?.[cell] ?? 0;
      scorch[cell] = Math.round(255 * (1 - (0.3 * n) / burnt.length));
    });
  });
}

/** Sprouts on the bare land round (x, y), as the seed power's seeds take. */
export function withSprouts(message: LandMessage, x: number, y: number, land: Land): LandMessage {
  return changed(message, ({ cover, biomass, plantHeight, cls }) => {
    for (const [cell, d] of around(message, x, y, SOWN_CELLS / 2)) {
      if ((land.heights[cell] ?? 0) <= land.seaLevel || (land.biomass[cell] ?? 0) > 10) continue;
      if (cellHash(cell, 0, 501) > 0.5 * (1 - d) + 0.1) continue;
      const kind = cellHash(cell, 1, 502);
      cover[cell] = Math.max(cls(kind < 0.6 ? "GRASS" : kind < 0.85 ? "SHRUB" : "BROADLEAF"), 0);
      biomass[cell] = 10; // seedlings, as the sim sows them (`seedling_biomass`, 0.04)
      plantHeight[cell] = kind < 0.6 ? 40 : kind < 0.85 ? 120 : 190;
    }
  });
}

export interface DemoWorld {
  land: Land;
  /** The land as the stream last sent it, to be changed and sent again. */
  landMessage: LandMessage | null;
  /** The animals as the stream last sent them, to which newcomers are added. */
  creatures: CreaturesMessage | null;
}

/**
 * The messages that show `shows` on the land of `world` around (x, y) at sim time `tMs`:
 * one sky for the light, rain and fire asked for, then the events and what they leave.
 */
export function demoMessages(
  shows: readonly Show[],
  world: DemoWorld,
  x: number,
  y: number,
  tMs: number,
): Timed[] {
  const { land, landMessage, creatures } = world;
  const at = landNear(land, x, y);
  const light =
    shows.map((show) => LIGHTS[show]).find((each) => each !== undefined) ?? LIGHTS["day"];
  const fire = shows.includes("fire");
  const rain: SkyMessage["rain"] =
    RAINS.find((kind) => shows.includes(kind)) ?? (fire ? "storm" : "none");
  const burning: number[] = [];
  if (fire) burning.push(...fireReach(land, at.x, at.y, FIRE_CELLS).sort((a, b) => a - b));
  const sky: SkyMessage = {
    type: "sky",
    protocol: 1,
    t_ms: tMs,
    light: light?.light ?? 1,
    present: light?.present ?? true,
    rain,
    burning,
  };
  const out: Timed[] = [{ afterS: 0, message: sky }];
  const events: EventsMessage["events"] = [];
  const near = { t_ms: tMs, x: at.x, y: at.y };
  const sendLand = (message: LandMessage, afterS = 0): void => {
    out.push({ afterS, message: { ...message, t_ms: tMs } });
  };
  if (fire) events.push({ kind: "fire_started", ...near });
  // What later shows build on: the land as a fire left it, if one did.
  let after = landMessage;
  let afterLand = land;
  if (shows.includes("burnt") && landMessage !== null) {
    after = withBurnt(landMessage, at.x, at.y, land);
    afterLand = landOf(after, null);
    sendLand(after);
  }
  if (shows.includes("volcano")) {
    events.push({ kind: "volcano", ...near, radius_cells: VOLCANO_RADIUS });
    if (landMessage !== null) sendLand(withCone(landMessage, at.x, at.y));
  }
  if (shows.includes("quake")) events.push({ kind: "earthquake", ...near, radius_cells: 6 });
  if (shows.includes("meteor")) {
    events.push({ kind: "god_power", ...near, power: "meteor" });
    events.push({ kind: "crater", ...near, radius_cells: METEOR_RADIUS });
    // The bowl shows as the meteor strikes.
    if (landMessage !== null) sendLand(withCrater(landMessage, at.x, at.y), 1.2);
  }
  if (shows.includes("seed")) {
    events.push({ kind: "god_power", ...near, power: "seed" });
    // The seeds take on bare land: the bare land nearest what is in sight (with `burnt`,
    // the ground the fire has just bared).
    const sown = landNear(afterLand, at.x, at.y, true);
    if (after !== null) {
      sendLand(withSprouts(after, sown.x, sown.y, afterLand), SOWN_AFTER_S);
    }
  }
  if (shows.includes("ark")) {
    events.push({ kind: "god_power", ...near, power: "ark" });
    events.push({ kind: "creatures_arrived", ...near, count: ARK_COUNT });
    const ids = Array.from({ length: ARK_COUNT }, (_, k) => 990_001 + k);
    const before = creatures ?? {
      type: "creatures" as const,
      protocol: 1 as const,
      t_ms: tMs,
      ids: [],
      positions: [],
      born: [],
    };
    const genome = Array.from({ length: 32 }, (_, k) => (k % 4 === 0 ? 0.7 : 0.45));
    out.push({
      afterS: LANDED_AFTER_S,
      message: {
        ...before,
        t_ms: tMs,
        ids: [...before.ids, ...ids],
        positions: [
          ...before.positions,
          ...ids.map((_, k): [number, number] => [
            at.x + Math.cos(k * 1.1) * 1.2,
            at.y + Math.sin(k * 1.1) * 0.8,
          ]),
        ],
        species: [...(before.species ?? before.ids.map(() => 0)), ...ids.map(() => 99)],
        born: ids.map((id) => ({ id, genome, slots: 0 })),
        torpid: before.torpid ?? [],
      },
    });
  }
  if (shows.includes("end")) {
    events.push({ kind: "world_ended", t_ms: tMs, world: 1, seed: 0, cause: "last_creature" });
  }
  if (events.length > 0)
    out.splice(1, 0, { afterS: 0, message: { type: "events", protocol: 1, events } });
  return out;
}
