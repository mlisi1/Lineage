/**
 * The year turning from one season to the next over weeks rather than overnight.
 *
 * The world's clock says which season it is and how far into it (the simulation's own
 * calendar). Around each change of season, places turn one after another: each has an
 * *earliness*, from −1 (the last to turn) to 1 (the first), and shows the next season
 * once the year is within `TURN_SEASONS / 2 × earliness` of the change. So the turn
 * takes `TURN_SEASONS` of a season (about four weeks) from the first place to the last.
 *
 * Earliness is made of:
 *
 *   a front     low-frequency noise over the land: the turn sweeps across it in fronts,
 *               not in specks
 *   height      autumn and winter come down from the hills first; spring and summer
 *               reach the hills last
 *   the plant   each tree or bush turns on its own day near its place's: a wood colours
 *               one tree after another
 *   evergreen   the plant's `EVERGREEN` gene: the more of it, the later the plant turns
 *               into autumn and into winter (the simulation has it keep its leaves)
 *
 * The ground is the front and the height only; a plant adds its own two.
 */
import { valueNoise } from "../terrain/ground";
import { cellHash } from "../terrain/pixels";
import { SEASONS, type Season } from "./seasons";

/** From the first place to turn to the last, in seasons. */
export const TURN_SEASONS = 0.3;
/** Cells across a front of the turn. */
const FRONT_CELLS = 18;
/** What earliness is made of: shares of the front, of height and of the plant itself. */
const FRONT = 0.55;
const HEIGHT = 0.45;
const OWN = 0.35;
const EVERGREEN = 0.5;
/** Height above the sea at which the hills are as early (or late) as they get. */
const HILLS = 0.35;
/** How far a dithered pixel may stray from its place's turn, in earliness. */
export const DITHER = 0.08;

/** Where the world is in its year: a season and how far into it, 0–1. */
export interface YearTime {
  season: Season;
  progress: number;
}

/** The year as a number of seasons since spring began: 0–4. */
export function phaseOf(time: YearTime): number {
  return SEASONS.indexOf(time.season) + Math.min(Math.max(time.progress, 0), 0.999999);
}

/** The time `days` after `time`, with seasons `seasonDays` long. */
export function later(time: YearTime, days: number, seasonDays = 91.3): YearTime {
  const phase = (((phaseOf(time) + days / seasonDays) % 4) + 4) % 4;
  return { season: SEASONS[Math.floor(phase)] ?? "spring", progress: phase % 1 };
}

/** The season shown by a place of `earliness` (−1 to 1) at `time`. */
export function seasonShown(time: YearTime, earliness: number): Season {
  const phase = phaseOf(time) + (TURN_SEASONS / 2) * Math.min(Math.max(earliness, -1), 1);
  return SEASONS[((Math.floor(phase) % 4) + 4) % 4] ?? "summer";
}

/** The season the year turns to next, from `time`: the change it is nearest to. */
function turningTo(time: YearTime): Season {
  const phase = phaseOf(time);
  return SEASONS[Math.round(phase) % 4] ?? "summer";
}

/** Whether being high makes a place early (into autumn and winter) or late (into spring and summer). */
const hillsFirst = (time: YearTime): number => {
  const next = turningTo(time);
  return next === "autumn" || next === "winter" ? 1 : -1;
};

/** Earliness of the ground at (u, v), in cells from the middle of the first, `above` the sea there. */
export function groundEarliness(time: YearTime, u: number, v: number, above: number): number {
  const front = 2 * valueNoise(u / FRONT_CELLS, v / FRONT_CELLS, 91) - 1;
  const high = 2 * Math.min(Math.max(above / HILLS, 0), 1) - 1;
  return FRONT * front + HEIGHT * high * hillsFirst(time);
}

/**
 * Earliness of the plant on cell (x, y), `above` the sea, with the `evergreen` gene (0–1;
 * none where it is not known).
 */
export function plantEarliness(
  time: YearTime,
  x: number,
  y: number,
  above: number,
  evergreen?: number,
): number {
  const own = 2 * cellHash(x, y, 93) - 1;
  const next = turningTo(time);
  const keeps =
    evergreen !== undefined && (next === "autumn" || next === "winter")
      ? EVERGREEN * (1 - 2 * evergreen)
      : 0;
  return groundEarliness(time, x, y, above) + OWN * own + keeps;
}

/** The season of the ground at each place, for the painter (`GroundOptions.seasonAt`). */
export function groundSeasons(
  time: YearTime,
  heightAt: (u: number, v: number) => number,
  seaLevel: number,
): (u: number, v: number, dither: number) => Season {
  // Away from a turn every place shows the same season (the season shown only grows with
  // earliness, and the earliest and the latest show the same): no need to work it out
  // pixel by pixel (R5, the optimization plan: it was an eighth of a painting's time).
  const [only, other] = seasonsInPlay(time);
  if (only !== undefined && other === undefined) return () => only;
  // In a turn, what is the same for every place is worked out once: the same numbers
  // `seasonShown` and `groundEarliness` work out each time.
  const phase = phaseOf(time);
  const hills = hillsFirst(time);
  return (u, v, dither) => {
    const front = 2 * valueNoise(u / FRONT_CELLS, v / FRONT_CELLS, 91) - 1;
    const high = 2 * Math.min(Math.max((heightAt(u, v) - seaLevel) / HILLS, 0), 1) - 1;
    const earliness = FRONT * front + HEIGHT * high * hills + DITHER * dither;
    const shown = phase + (TURN_SEASONS / 2) * Math.min(Math.max(earliness, -1), 1);
    return SEASONS[((Math.floor(shown) % 4) + 4) % 4] ?? "summer";
  };
}

/** Whether, at `time`, some places show one season and some another. */
export function isTurning(time: YearTime): boolean {
  const phase = phaseOf(time);
  return Math.abs(phase - Math.round(phase)) < TURN_SEASONS / 2 + 1e-9;
}

/** The two seasons a turn is between at `time` (the same one twice when it is not turning). */
export function seasonsInPlay(time: YearTime): readonly Season[] {
  const before = seasonShown(time, -1);
  const after = seasonShown(time, 1);
  return before === after ? [before] : [before, after];
}
