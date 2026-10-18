/**
 * The looks the land and its plants can be drawn in: the colours that are not the cells'
 * own. Two so far:
 *
 *   maps   the report maps' palette (`tools/viz/pixelmap.py`), as the R0 spike chose it
 *   cosy   after Stardew Valley (R1 proposal, ADR 0013): warmer and more saturated
 *          greens, earth that is orange-brown rather than grey, a bright teal sea, shade
 *          toward violet and light toward gold, outlines in each thing's own darkest tone
 *          taken toward plum rather than grey. The creatures' `cosy` palette (R2) is the
 *          same idea, and the two share the plum and the violet.
 *
 * Seen from above as before: the look changes colours and edges, not the camera.
 */
import { MAP_SEASONS, type SeasonTones } from "./plants/seasons";
import type { LandPalette, Ramp } from "./terrain/land";

type Rgb = readonly [number, number, number];

/** What the ground painter lays on the land besides the palette's ramps (0xRRGGBB). */
export interface GroundTones {
  /** Under trees and bushes a close view shows a floor of litter. */
  litter: number;
  /** Fallen leaves: through the year, and in autumn. */
  leafOchre: number;
  leafBrown: number;
  leafGold: number;
  leafFlame: number;
  /** Lichen besides the palette's: mustard and a chalky crust. */
  lichens: readonly (readonly [number, number, number])[];
  moss: number;
  twig: number;
  ash: number;
  petals: readonly [number, number];
  /** What a shadow on the ground is mixed with, and how far. */
  shadow: number;
  shadowMix: number;
  /** Foam: the shallowest sea mixed this far toward white. */
  foamMix: number;
  /** Sand on the beach; the palette's lightest bare tone if left out. */
  sand?: number;
}

/** The inks of a standing plant that do not come from its ramp. */
export interface PlantInks {
  /** The outline round a drawing whose darkest tone is `dark`. */
  outline: (dark: string) => Rgb;
  /** In shade a colour is cooler as well as darker; in the light, warmer: toward these, so far. */
  deep: Rgb;
  deepMix: number;
  bright: Rgb;
  brightMix: number;
  /** Bark by form. */
  wood: Readonly<Record<string, string>>;
  /** The heart of a flower, and pale petals. */
  core: string;
  pale: string;
  snow: Rgb;
  snowShade: Rgb;
}

export interface Look {
  name: string;
  /** The palette of the land, in place of the one the land comes with; the land's own if left out. */
  land?: LandPalette;
  seasons: SeasonTones;
  ground: GroundTones;
  plants: PlantInks;
}

const shaded = (colour: string, factor: number): Rgb => {
  const value = Number.parseInt(colour.replace("#", ""), 16);
  return [
    Math.min(255, Math.round(((value >> 16) & 255) * factor)),
    Math.min(255, Math.round(((value >> 8) & 255) * factor)),
    Math.min(255, Math.round((value & 255) * factor)),
  ];
};
const toward = (from: Rgb, to: Rgb, share: number): Rgb => [
  Math.round(from[0] * (1 - share) + to[0] * share),
  Math.round(from[1] * (1 - share) + to[1] * share),
  Math.round(from[2] * (1 - share) + to[2] * share),
];

export const MAPS: Look = {
  name: "maps",
  seasons: MAP_SEASONS,
  ground: {
    litter: 0x6a5637,
    leafOchre: 0xb08a4a,
    leafBrown: 0x7a5a34,
    leafGold: 0xd29a2a,
    leafFlame: 0xc25a26,
    lichens: [
      [0xe3cd72, 0xc9a94a, 0x9b7d33],
      [0xe8e6d4, 0xcfccb6, 0xa8a58f],
    ],
    moss: 0x7fa24a,
    twig: 0x5a4632,
    ash: 0xb9b2a8,
    petals: [0xf4f1e4, 0xf2d24b],
    shadow: 0x16203a,
    shadowMix: 0.32,
    foamMix: 0.6,
  },
  plants: {
    outline: (dark) => shaded(dark, 0.62),
    deep: [18, 30, 56],
    deepMix: 0.34,
    bright: [246, 240, 150],
    brightMix: 0.34,
    wood: { BROADLEAF: "#5a4632", CONIFER: "#6e4a34", SHRUB: "#5e4834" },
    core: "#e0b83a",
    pale: "#e9dfc6",
    snow: [244, 248, 252],
    snowShade: [196, 212, 232],
  },
};

/** The plum outlines and the violet shade lean toward, shared with the creatures' cosy look. */
const PLUM: Rgb = [43, 22, 48];
const VIOLET: Rgb = [58, 36, 102];

const ramp = (dark: string, mid: string, light: string): Ramp => [dark, mid, light];

export const COSY: Look = {
  name: "cosy",
  land: {
    palette: {
      BARE: ramp("#8a6a4c", "#a8865e", "#c2a274"),
      LICHEN: ramp("#7f9a58", "#9fb86a", "#c0d484"),
      GRASS: ramp("#4f9a30", "#6cb83a", "#94d24a"),
      SHRUB: ramp("#3d8434", "#55a03e", "#76bc48"),
      BROADLEAF: ramp("#2c6a2c", "#42903a", "#6ab646"),
      CONIFER: ramp("#1d5a48", "#277456", "#3a9064"),
      BURNT: ramp("#4a3238", "#604248", "#7a5658"),
      DORMANT: ramp("#b08a3c", "#d2ac4e", "#ead070"),
    },
    relief: {
      seaBands: [
        { limit: 0.02, colour: "#7fd8e8" },
        { limit: 0.06, colour: "#4ab8de" },
        { limit: 0.14, colour: "#3192d0" },
        { limit: 0.26, colour: "#2a70bc" },
        { limit: 9.99, colour: "#24529c" },
      ],
      slope: 0.012,
      highRockFrom: 0.3,
      highRock: ramp("#7a6a7c", "#9a8c9a", "#bcb0b8"),
      snowFrom: 0.46,
      snow: ramp("#c4cce8", "#e4eaf8", "#ffffff"),
      shoreOutline: "#6a4030",
    },
  },
  seasons: {
    fresh: "#c8f05a",
    gold: ["#c07a18", "#eea828", "#ffd85a"],
    flame: ["#a8341e", "#de5a28", "#f8903c"],
    russet: ["#7e4a28", "#a26634", "#c88a46"],
    rust: ["#94381e", "#c4582c", "#e8823a"],
    cold: "#2a3a6a",
    pale: "#c8b8a8",
  },
  ground: {
    litter: 0x8a5a30,
    leafOchre: 0xd09a48,
    leafBrown: 0x9a6034,
    leafGold: 0xf0b030,
    leafFlame: 0xe06028,
    lichens: [
      [0xf0d26a, 0xd0a840, 0xa07a2c],
      [0xf0ece0, 0xd8d0c0, 0xb0a498],
    ],
    moss: 0x7cbc44,
    twig: 0x7a4c2c,
    ash: 0xc8bcb8,
    petals: [0xfff6e8, 0xffd84a],
    shadow: 0x3a2466,
    shadowMix: 0.3,
    foamMix: 0.75,
    sand: 0xe8cc94,
  },
  plants: {
    outline: (dark) => toward(shaded(dark, 0.5), PLUM, 0.4),
    deep: VIOLET,
    deepMix: 0.3,
    bright: [255, 236, 130],
    brightMix: 0.38,
    wood: { BROADLEAF: "#8a5a34", CONIFER: "#94583a", SHRUB: "#80563a" },
    core: "#f0c030",
    pale: "#fff0d8",
    snow: [250, 252, 255],
    snowShade: [190, 196, 236],
  },
};

export const LOOKS: readonly Look[] = [MAPS, COSY];

/** `land` in the colours of `look`. */
export function dressed<T extends LandPalette>(land: T, look: Look): T {
  return look.land === undefined ? land : { ...land, ...look.land };
}
