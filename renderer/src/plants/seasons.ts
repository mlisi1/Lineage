/**
 * What changes with the time of year and with a plant's age, as the renderer draws it:
 * the stages of growth a standing plant goes through, and the colours of each form in
 * each season. The simulation knows biomass and the date; this is how they show.
 */
import type { Ramp } from "../terrain/land";
import { hexToRgb } from "../terrain/pixels";

export const SEASONS = ["spring", "summer", "autumn", "winter"] as const;
export type Season = (typeof SEASONS)[number];

/** A season by its name in the fixture; summer where the name is not one. */
export function seasonOf(name: string): Season {
  return (SEASONS as readonly string[]).includes(name) ? (name as Season) : "summer";
}

/**
 * How far a standing plant has grown: a sprout just established, young, grown to its
 * full size, and old (a tree as tall as a grown one, stouter and broader).
 */
export const GROWTHS = ["sprout", "young", "grown", "old"] as const;
export type Growth = (typeof GROWTHS)[number];
/** Biomass (0–255) from which a plant is young, grown and old; below, a sprout. */
export const YOUNG_FROM = 44;
export const GROWN_FROM = 128;
export const OLD_FROM = 216;

export function growthOf(biomass: number): Growth {
  return biomass >= OLD_FROM
    ? "old"
    : biomass >= GROWN_FROM
      ? "grown"
      : biomass >= YOUNG_FROM
        ? "young"
        : "sprout";
}

/** Bark: greyer on a broadleaf, redder on a conifer; a bush's stems between the two. */
export const WOOD: Readonly<Record<string, string>> = {
  BROADLEAF: "#5a4632",
  CONIFER: "#6e4a34",
  SHRUB: "#5e4834",
};
export const woodOf = (form: string): string => WOOD[form] ?? "#5a4632";

const hex = (rgb: readonly number[]): string =>
  `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
/** `from` mixed `share` of the way toward `to`. */
export function mixHex(from: string, to: string, share: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return hex(a.map((value, i) => value * (1 - share) + (b[i] ?? 0) * share));
}
const toward = (ramp: Ramp, to: string, share: number): Ramp => [
  mixHex(ramp[0], to, share),
  mixHex(ramp[1], to, share),
  mixHex(ramp[2], to, share),
];
const blend = (from: Ramp, to: Ramp, share: number): Ramp => [
  mixHex(from[0], to[0], share),
  mixHex(from[1], to[1], share),
  mixHex(from[2], to[2], share),
];

/** The colours the seasons bring, over and above each form's own palette. */
export interface SeasonTones {
  /** The green of new leaves, which spring mixes into everything that grows them. */
  fresh: string;
  /** What a broadleaf turns to in autumn: gold, flame, and the brown of what is left. */
  gold: Ramp;
  flame: Ramp;
  russet: Ramp;
  /** A bush in autumn. */
  rust: Ramp;
  /** What winter cools an evergreen toward, and pales dried growth toward. */
  cold: string;
  pale: string;
}

/** The seasons of the cosy look (ADR 0014): strong golds and reds. */
export const COSY_SEASONS: SeasonTones = {
  fresh: "#c8f05a",
  gold: ["#c07a18", "#eea828", "#ffd85a"],
  flame: ["#a8341e", "#de5a28", "#f8903c"],
  russet: ["#7e4a28", "#a26634", "#c88a46"],
  rust: ["#94381e", "#c4582c", "#e8823a"],
  cold: "#2a3a6a",
  pale: "#c8b8a8",
};
/** The seasons of the R0 look. */
export const R0_SEASONS: SeasonTones = {
  fresh: "#b4dc52",
  gold: ["#a8761f", "#d29a2a", "#eec24a"],
  flame: ["#8f3a1e", "#c25a26", "#e8853a"],
  russet: ["#6b4a2c", "#8a6238", "#a67c48"],
  rust: ["#7d3f28", "#a8562e", "#c97a3a"],
  cold: "#1c3a4a",
  pale: "#a9a595",
};
const NO_RAMP: Ramp = ["#000000", "#000000", "#000000"];

/**
 * The three tones of `form` in `season`. `variant` tells apart the plants of one form
 * where they do not all turn alike: in autumn one broadleaf in three goes gold, one
 * flame, and one is still half green.
 */
export function seasonRamp(
  palette: Readonly<Record<string, Ramp>>,
  form: string,
  season: Season,
  variant = 0,
  tones: SeasonTones = COSY_SEASONS,
): Ramp {
  const ramp = palette[form] ?? NO_RAMP;
  const dry = palette["DORMANT"] ?? ramp;
  if (season === "summer" || form === "BARE" || form === "BURNT") return ramp;
  if (season === "spring") {
    if (form === "LICHEN") return ramp;
    return toward(ramp, tones.fresh, form === "CONIFER" ? 0.1 : 0.3);
  }
  if (season === "autumn") {
    if (form === "BROADLEAF") {
      return variant % 3 === 0
        ? tones.gold
        : variant % 3 === 1
          ? tones.flame
          : blend(ramp, tones.gold, 0.55);
    }
    if (form === "SHRUB") return variant % 3 === 1 ? blend(ramp, tones.rust, 0.5) : tones.rust;
    if (form === "GRASS") return blend(ramp, dry, 0.55);
    return ramp;
  }
  // Winter: evergreens darker and bluer; what is left of the rest dried and pale.
  if (form === "CONIFER") return toward(ramp, tones.cold, 0.2);
  // Bare wood: a broadleaf's branches, and a bush's twigs (a cosy bush stays a dome of them).
  if (form === "BROADLEAF" || form === "SHRUB") return tones.russet;
  if (form === "LICHEN") return ramp;
  return toward(dry, tones.pale, 0.25);
}

/**
 * The tones of the ground under `form` in `season`: what the plants above it have
 * dropped, not their own colours. In autumn the floor of a wood is russet, not the gold
 * of the leaves still on the trees.
 */
export function floorRamp(
  palette: Readonly<Record<string, Ramp>>,
  form: string,
  season: Season,
  tones: SeasonTones = COSY_SEASONS,
): Ramp {
  const ramp = palette[form] ?? NO_RAMP;
  if (season === "autumn" && form === "BROADLEAF") return blend(ramp, tones.russet, 0.6);
  if (season === "autumn" && form === "SHRUB") return blend(ramp, tones.rust, 0.35);
  return seasonRamp(palette, form, season, 0, tones);
}
