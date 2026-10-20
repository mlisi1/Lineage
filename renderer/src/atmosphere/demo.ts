/**
 * The atmosphere on demand (R4): messages as the stream would send them, made up for the
 * land on the screen, so that a look at the scene (`?show=night,fire`) and the visual
 * tests can see each light and each event without waiting years for it. Not the
 * island's history: nothing here reaches the sim.
 *
 *   day, dusk, dawn, night, moon   the light ([presence]: night 0.05, moonlight 0.15)
 *   rain                           the rain god power's rain
 *   fire                           a patch of burning cells
 *   volcano, quake, meteor         the terrain's events (a meteor's crater)
 *   seed, ark                      the god powers that fall from the sky
 *   end                            a world's end (no next world: the same land rises again)
 */
import type { EventsMessage, Message, SkyMessage } from "../protocol";
import type { Land } from "../terrain/land";

export const SHOWS = [
  "day",
  "dusk",
  "dawn",
  "night",
  "moon",
  "rain",
  "fire",
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

/** Cells of the patch set on fire, across. */
const FIRE_CELLS = 5;

/** The names in `text` (comma-separated) that are shows, in order. */
export function showsOf(text: string | null): Show[] {
  if (text === null) return [];
  return text
    .split(",")
    .map((name) => name.trim())
    .filter((name): name is Show => (SHOWS as readonly string[]).includes(name));
}

/** The land cell nearest (x, y) (cells), or (x, y) itself if there is no land. */
export function landNear(land: Land, x: number, y: number): { x: number; y: number } {
  let best = { x, y };
  let bestD = Infinity;
  for (let cy = 0; cy < land.height; cy++) {
    for (let cx = 0; cx < land.width; cx++) {
      if ((land.heights[cy * land.width + cx] ?? 0) <= land.seaLevel + 0.01) continue;
      const d = (cx + 0.5 - x) ** 2 + (cy + 0.5 - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x: cx + 0.5, y: cy + 0.5 };
      }
    }
  }
  return best;
}

/**
 * The messages that show `shows` on `land` around (x, y) at sim time `tMs`: one sky for
 * the light, rain and fire asked for, then the events.
 */
export function demoMessages(
  shows: readonly Show[],
  land: Land,
  x: number,
  y: number,
  tMs: number,
): Message[] {
  const at = landNear(land, x, y);
  const light =
    shows.map((show) => LIGHTS[show]).find((each) => each !== undefined) ?? LIGHTS["day"];
  const burning: number[] = [];
  if (shows.includes("fire")) {
    const half = Math.floor(FIRE_CELLS / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        if (dx * dx + dy * dy > half * half + 1) continue;
        const cx = Math.floor(at.x) + dx;
        const cy = Math.floor(at.y) + dy;
        if (cx < 0 || cy < 0 || cx >= land.width || cy >= land.height) continue;
        burning.push(cy * land.width + cx);
      }
    }
    burning.sort((a, b) => a - b);
  }
  const sky: SkyMessage = {
    type: "sky",
    protocol: 1,
    t_ms: tMs,
    light: light?.light ?? 1,
    present: light?.present ?? true,
    raining: shows.includes("rain"),
    burning,
  };
  const events: EventsMessage["events"] = [];
  const near = { t_ms: tMs, x: at.x, y: at.y };
  if (shows.includes("volcano")) events.push({ kind: "volcano", ...near, radius_cells: 4 });
  if (shows.includes("quake")) events.push({ kind: "earthquake", ...near, radius_cells: 6 });
  if (shows.includes("meteor")) {
    events.push({ kind: "god_power", ...near, power: "meteor" });
    events.push({ kind: "crater", ...near, radius_cells: 3 });
  }
  if (shows.includes("seed")) events.push({ kind: "god_power", ...near, power: "seed" });
  if (shows.includes("ark")) events.push({ kind: "god_power", ...near, power: "ark" });
  if (shows.includes("end")) {
    events.push({ kind: "world_ended", t_ms: tMs, world: 1, seed: 0, cause: "last_creature" });
  }
  const messages: Message[] = [sky];
  if (events.length > 0) messages.push({ type: "events", protocol: 1, events });
  return messages;
}
