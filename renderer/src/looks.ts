/**
 * The looks the land and its plants can be drawn in: the colours besides the palette the
 * land comes with, and the rules plants are drawn by.
 *
 *   cosy   the look (ADR 0014), after Stardew Valley: in the report maps' palette
 *          (`tools/viz/pixelmap.py`, which is cosy too), shade toward violet and light
 *          toward gold, outlines in each thing's own darkest tone taken toward plum,
 *          plants in Stardew's shapes (`plants/cosyart.ts`). The creatures' cosy palette
 *          (R2) is the same idea; the plum, the violet and the gold come from `palette.ts`.
 *   r0     the R0 look, kept for the record: the earlier palette and the bundles of T1.
 *
 * Seen from above as before: the look changes colours and edges, not the camera.
 */
import * as TONES from "./palette";
import type { Shapes } from "./plants/plantart";
import { COSY_SEASONS, R0_SEASONS, type SeasonTones } from "./plants/seasons";
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
  /** Foam: the shallowest sea mixed this far toward white; and the outer line of the surf. */
  foamMix: number;
  surfMix: number;
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
  /** The darkest tone is first darkened by this (1 for none), so shade never lightens it. */
  deepShade: number;
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
  /** A palette of the land in place of the one it comes with; the land's own if left out. */
  land?: LandPalette;
  seasons: SeasonTones;
  ground: GroundTones;
  plants: PlantInks;
  /** The rules the plants are drawn by. */
  shapes: Shapes;
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

const ramp = (dark: string, mid: string, light: string): Ramp => [dark, mid, light];

/** The R0 look, kept for the record: the report maps' palette before ADR 0014, the bundles of T1. */
export const R0: Look = {
  name: "r0",
  shapes: "bundles",
  land: {
    palette: {
      BARE: ramp("#8f7f68", "#b3a188", "#cdbd9f"),
      LICHEN: ramp("#8b9a7a", "#a9b792", "#c3cfa8"),
      GRASS: ramp("#6f9a3f", "#8fbf4f", "#aad468"),
      SHRUB: ramp("#4f7d3a", "#6a9a45", "#84b356"),
      BROADLEAF: ramp("#2f6230", "#3f7d3a", "#55964a"),
      CONIFER: ramp("#1f4a3a", "#2b6149", "#3a7a5a"),
      BURNT: ramp("#3a302b", "#4f423a", "#66564b"),
      DORMANT: ramp("#8f8448", "#b3a65c", "#cdc177"),
    },
    relief: {
      seaBands: [
        { limit: 0.02, colour: "#8ecbe6" },
        { limit: 0.06, colour: "#5aa7d6" },
        { limit: 0.14, colour: "#3b7fbf" },
        { limit: 0.26, colour: "#2c5f9e" },
        { limit: 9.99, colour: "#1f437a" },
      ],
      slope: 0.012,
      highRockFrom: 0.3,
      highRock: ramp("#77716c", "#98928c", "#b5b0aa"),
      snowFrom: 0.46,
      snow: ramp("#c9d3dc", "#e6edf2", "#ffffff"),
      shoreOutline: "#3d3528",
    },
  },
  seasons: R0_SEASONS,
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
    surfMix: 0.35,
  },
  plants: {
    outline: (dark) => shaded(dark, 0.62),
    deep: [18, 30, 56],
    deepMix: 0.34,
    deepShade: 1,
    bright: [246, 240, 150],
    brightMix: 0.34,
    wood: { BROADLEAF: "#5a4632", CONIFER: "#6e4a34", SHRUB: "#5e4834" },
    core: "#e0b83a",
    pale: "#e9dfc6",
    snow: [244, 248, 252],
    snowShade: [196, 212, 232],
  },
};

const rgbOf = (colour: number): Rgb => [colour >> 16, (colour >> 8) & 255, colour & 255];
/** The plum outlines lean toward, the violet of shade, the gold of light: shared with the creatures. */
const PLUM = rgbOf(TONES.PLUM);
const VIOLET = rgbOf(TONES.SHADE);

/** The look chosen (ADR 0014), in the palette the land comes with: the report maps' own. */
export const COSY: Look = {
  name: "cosy",
  shapes: "cosy",
  seasons: COSY_SEASONS,
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
    // The creatures' shadow on the ground: dark enough to darken even a conifer's floor.
    shadow: TONES.GROUND_SHADOW,
    shadowMix: 0.3,
    foamMix: 0.75,
    surfMix: 0.4,
    sand: 0xe8cc94,
  },
  plants: {
    outline: (dark) => toward(shaded(dark, 0.5), PLUM, 0.4),
    deep: VIOLET,
    deepMix: 0.18,
    deepShade: 0.74,
    bright: rgbOf(TONES.GOLD),
    brightMix: 0.38,
    wood: { BROADLEAF: "#8a5a34", CONIFER: "#94583a", SHRUB: "#80563a" },
    core: "#f0c030",
    pale: "#fff0d8",
    snow: [250, 252, 255],
    snowShade: [190, 196, 236],
  },
};

export const LOOKS: readonly Look[] = [COSY, R0];
/** What everything is drawn in unless told otherwise. */
export const DEFAULT_LOOK = COSY;

/** `land` in the colours of `look`. */
export function dressed<T extends LandPalette>(land: T, look: Look): T {
  return look.land === undefined ? land : { ...land, ...look.land };
}
