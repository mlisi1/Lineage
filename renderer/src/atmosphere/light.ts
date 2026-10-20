/**
 * The scene's light (R4, ADR 0021): the colour multiplied over the land, its plants and
 * animals for the sim's light of the moment, the owner's presence being the sun.
 *
 *   day        white, graded a little by the season (warm summer, cool winter)
 *   twilight   rose as the light falls after the owner leaves (dusk), lilac as it rises
 *              when they come back (dawn)
 *   night      moonlit blue: dark, but the land, the sea and the animals still read
 *              (the owner, 2026-10-20), and glowing things stand out
 *
 * The sim's light changes in steps (a presence tick every 10 sim-minutes); `LightEase`
 * moves the shown light from one step to the next over the time between them, so that a
 * dusk fades instead of stepping (the owner, 2026-10-20).
 */
import type { Season } from "../protocol";

/** Red, green and blue multipliers, 0–1. */
export type Rgb = readonly [number, number, number];

/** The sim's light at night ([presence] night_light): the bottom of the scale drawn. */
export const NIGHT_LIGHT = 0.05;
/** Where on the way from night to day (0–1) twilight is most coloured. */
const TWILIGHT_AT = 0.35;
/** Moonlit blue: the colour of the darkest night. */
export const NIGHT: Rgb = [0.3, 0.38, 0.66];
/** Twilight as the owner leaves (dusk) and comes back (dawn). */
export const DUSK: Rgb = [0.96, 0.62, 0.56];
export const DAWN: Rgb = [0.86, 0.68, 0.82];
/** Daylight in the middle of each season; it turns toward the next season's as one goes by. */
export const SEASON_DAY: Readonly<Record<Season, Rgb>> = {
  spring: [0.98, 1.0, 0.96],
  summer: [1.0, 0.99, 0.95],
  autumn: [1.0, 0.96, 0.9],
  winter: [0.92, 0.95, 1.0],
};
const NEXT_SEASON: Readonly<Record<Season, Season>> = {
  spring: "summer",
  summer: "autumn",
  autumn: "winter",
  winter: "spring",
};
/** Rain greys the day: multiplied in while the rain god power's rain falls. */
export const RAIN_GREY: Rgb = [0.8, 0.84, 0.92];
/** The shortest and longest time (wall seconds) the shown light takes to reach a new step. */
export const EASE_MIN_S = 0.25;
export const EASE_MAX_S = 600;

export function mixRgb(from: Rgb, to: Rgb, share: number): Rgb {
  const t = Math.min(Math.max(share, 0), 1);
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

export function multiplyRgb(a: Rgb, b: Rgb): Rgb {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

/** As 0xRRGGBB, for a sprite's tint. */
export function packRgb(rgb: Rgb): number {
  const channel = (value: number): number => Math.round(Math.min(Math.max(value, 0), 1) * 255);
  return (channel(rgb[0]) << 16) | (channel(rgb[1]) << 8) | channel(rgb[2]);
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** How far the sim's `light` is from night to day, 0–1. */
export function daylight(light: number): number {
  return Math.min(Math.max((light - NIGHT_LIGHT) / (1 - NIGHT_LIGHT), 0), 1);
}

/** How dark it is, 0 (day) to 1 (night): how strongly glowing things show. */
export function darkness(light: number): number {
  return 1 - smooth(daylight(light) / TWILIGHT_AT);
}

/** Daylight's colour `progress` (0–1) through `season`: its own in the middle, then toward the next. */
export function seasonDay(season: Season, progress: number): Rgb {
  const own = SEASON_DAY[season];
  // Its own until halfway, then all the way to the next by its end.
  const turn = 2 * Math.max(progress - 0.5, 0);
  return mixRgb(own, SEASON_DAY[NEXT_SEASON[season]], turn);
}

/**
 * The colour over the scene at the sim's `light`; `rising` while the owner is at the desk
 * (dawn's colour on the way up, dusk's on the way down).
 */
export function skyTint(
  light: number,
  rising: boolean,
  season: Season = "summer",
  progress = 0.5,
): Rgb {
  const twilight = rising ? DAWN : DUSK;
  const day = seasonDay(season, progress);
  const f = daylight(light);
  if (f <= TWILIGHT_AT) return mixRgb(NIGHT, twilight, smooth(f / TWILIGHT_AT));
  return mixRgb(twilight, day, smooth((f - TWILIGHT_AT) / (1 - TWILIGHT_AT)));
}

/**
 * The light shown, eased from one of the sim's steps to the next: each new step is
 * reached over the wall time since the step before it (so the scene runs one step behind
 * the sim, smoothly), between `EASE_MIN_S` and `EASE_MAX_S`.
 */
export class LightEase {
  private from: number;
  private to: number;
  private elapsed = 0;
  private duration = EASE_MIN_S;
  /** Wall seconds since the last step came, or null before the first. */
  private sinceStep: number | null = null;

  constructor(start = 1) {
    this.from = start;
    this.to = start;
  }

  /** The light shown now. */
  get value(): number {
    if (this.duration <= 0) return this.to;
    return this.from + (this.to - this.from) * Math.min(this.elapsed / this.duration, 1);
  }

  /** The step it is on its way to. */
  get target(): number {
    return this.to;
  }

  /** A new step of the sim's light. The first is taken at once. */
  step(light: number): void {
    if (this.sinceStep === null) {
      this.from = light;
      this.to = light;
      this.sinceStep = 0;
      return;
    }
    this.from = this.value;
    this.to = light;
    this.duration = Math.min(Math.max(this.sinceStep, EASE_MIN_S), EASE_MAX_S);
    this.elapsed = 0;
    this.sinceStep = 0;
  }

  /** Jump to `light` at once (a picture that must not wait, or the dark of a sequence). */
  set(light: number): void {
    this.from = light;
    this.to = light;
    this.elapsed = 0;
  }

  tick(dtS: number): void {
    this.elapsed += dtS;
    if (this.sinceStep !== null) this.sinceStep += dtS;
  }
}
