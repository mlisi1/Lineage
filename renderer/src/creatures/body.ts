/**
 * What a creature looks like: every drawing decision that follows from its genes and
 * derived body, as plain numbers. A plan is a chain of joints, parts that ride on them
 * (discs, wedges and bars, each with a size, a place and a colour) and legs.
 * `creatures.ts` turns a plan into sprites and moves them.
 *
 * Three styles, to choose from:
 *
 *   circles  every body the same chain of circles, the genes adding trimmings
 *   shapes   a body plan per kind of animal (worm, fish, lizard, beetle, crab…), so
 *            that the silhouette says what it is
 *   lit      the same plans with a dark outline around the animal, a lit back and a
 *            far side in shade; markings are shaded the same way, each on its own
 *   cosy     lit, after Stardew Valley's palette (R2 proposal): richer colours, an
 *            outline in the animal's own darkest tone rather than near black, shade
 *            that turns violet and light that turns gold, larger eyes with a glint,
 *            and a soft shadow on the ground under the animal
 *
 * A body is drawn from its `Look`: the values the phenotype derives from the genome
 * (`phenotype.ts`, the port of `fauna/phenotype.py`) and the genes that show.
 */
import * as cosy from "../palette";
import { geneOf, type Genome } from "./genome";
import type { RareLook } from "./rare";
import type { Colours } from "./colours";
import type { Phenotype } from "./phenotype";

/** What a body is drawn from: derived values of its phenotype, then the genes that show. */
export interface Look {
  mass: number;
  limbPairs: number;
  /** Cells per hour, on land and in water. */
  landSpeed: number;
  swimSpeed: number;
  // Genes, each 0–1.
  diet: number;
  speed: number;
  armour: number;
  sense: number;
  aquatic: number;
  jaw: number;
  hue: number;
  pattern: number;
  /** Rare genes it carries, by signature (`rare.ts`); none if left out. */
  rare?: readonly RareLook[];
  /**
   * Its colours from its genes ranked among its species' (R5, `colours.ts`); left out,
   * the body is its HUE at the style's saturation and the markings follow PATTERN.
   */
  colours?: Colours;
  /** How far grown toward coming of age, 0–1 (R5); left out, grown. */
  growth?: number;
}

/** The look of a creature with this genome and the body the phenotype derives from it. */
export function lookOf(genome: Genome, body: Phenotype): Look {
  return {
    mass: body.mass,
    limbPairs: body.limbPairs,
    landSpeed: body.landSpeed,
    swimSpeed: body.swimSpeed,
    diet: geneOf(genome, "DIET"),
    speed: geneOf(genome, "SPEED"),
    armour: geneOf(genome, "ARMOUR"),
    sense: geneOf(genome, "SENSE"),
    aquatic: geneOf(genome, "AQUATIC"),
    jaw: geneOf(genome, "JAW"),
    hue: geneOf(genome, "HUE"),
    pattern: geneOf(genome, "PATTERN"),
  };
}

export type CreatureStyle = "circles" | "shapes" | "lit" | "cosy";
export const CREATURE_STYLES: readonly CreatureStyle[] = ["circles", "shapes", "lit", "cosy"];

export interface BodyOptions {
  style: CreatureStyle;
  /** Drawn size against the first look's: 1 is a body of 1.1 cells at mass 1. */
  scale: number;
  /**
   * Art pixels to the cell in the view the body is drawn for. An outline is one of them
   * wide, and detail smaller than a pixel or two is left out.
   */
  pixels: number;
  /** Walking speed against the first look's hurry: close up, an animal ambles. */
  pace: number;
}
export const FIRST_LOOK: BodyOptions = { style: "circles", scale: 1, pixels: 8, pace: 1 };

/**
 * The markings of the `shapes` and `lit` styles. The pattern gene picks one by twelfths;
 * how far into its twelfth the gene lies picks the colour the marking is made in.
 */
export const PATTERNS = [
  "plain",
  "stripe",
  "twin",
  "bands",
  "bars",
  "spots",
  "rings",
  "saddle",
  "fade",
  "chevrons",
  "speckle",
  "eyespots",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** The marking a pattern gene gives, and how far (0–1) into its share of the gene it lies. */
export function patternOf(gene: number): { pattern: Pattern; shade: number } {
  const scaled = Math.min(Math.max(gene, 0), 1) * PATTERNS.length;
  const index = Math.min(Math.floor(scaled), PATTERNS.length - 1);
  return { pattern: PATTERNS[index] ?? "plain", shade: Math.min(scaled - index, 0.999) };
}

/** The body plans of the `shapes` and `lit` styles. */
export type Kind =
  | "worm"
  | "snake"
  | "fish"
  | "eel"
  | "hopper"
  | "lizard"
  | "beast"
  | "newt"
  | "tortoise"
  | "insect"
  | "beetle"
  | "spider"
  | "crab";

export type Shape = "disc" | "wedge" | "bar";

/**
 * Drawing order of parts: lower layers first. Legs go under everything. A lit body is
 * its outline, then every mass in its shaded tone, then the masses themselves drawn a
 * little smaller toward the light, then what catches the light. Markings lie on top of
 * it, each stacked the same way on its own.
 */
export const LAYER = {
  ground: 0,
  outline: 1,
  under: 2,
  shade: 3,
  body: 4,
  light: 5,
  mark: 6,
  face: 7,
} as const;

export interface Part {
  shape: Shape;
  /** The joint whose position and direction it rides. */
  joint: number;
  /** Size along and across its own axis, in cells. A wedge points along its axis. */
  along: number;
  across: number;
  /** Where its middle is from the joint: toward the joint's front, and to its left. */
  forward: number;
  side: number;
  /** Angle of its axis from the joint's direction, in radians. */
  turn: number;
  colour: number;
  layer: number;
  /** Shifted this far (cells) toward the light, whichever way the body faces. */
  lift: number;
  /** Drawn in its one colour even where a lit body would shade it: a stripe, a fade. */
  flat: boolean;
  /** Opacity, 1 unless said: only the shadow on the ground lets the ground through. */
  alpha?: number;
}

export interface LegPlan {
  joint: number;
  side: 1 | -1;
  length: number;
  thickness: number;
  /** Where the foot rests: 0 straight out to the side, positive toward the front (radians). */
  aim: number;
  colour: number;
  /** Width of a dark edge round the leg, in cells; 0 where the leg is too thin for one. */
  edge: number;
  /** Radius of the foot at its end, in cells; 0 where it would not show. */
  foot: number;
  /**
   * How far the leg has turned into a fin: 0 a leg, up to 1 a foot that is webbed wider
   * and wider, 1 a flipper that rows instead of stepping.
   */
  fin: number;
  /** The colour of the foot, its webbing or the flipper. */
  sole: number;
}

export interface BodyPlan {
  kind: Kind | "chain";
  /** Head to tail, in cells. */
  length: number;
  /** Distance between neighbouring joints of the chain. */
  spacing: number;
  joints: number;
  /** Half the width of the body at each joint, head first (legs start from its edge). */
  radii: number[];
  parts: Part[];
  legs: LegPlan[];
  /** Lives in the water rather than on land. */
  swims: boolean;
  /** Cells per second. */
  pace: number;
  /** The animal's own colour: what a marker on the map shows. */
  colour: number;
  /** The colour of its outline, and of the edge round its legs. */
  outline: number;
}

/** Body length in cells of a creature of mass 1; it grows with the cube root of mass. */
const LENGTH_PER_UNIT_MASS = 1.1;
/** Head radius as a share of body length, for a creature of middling build. */
const HEAD_RADIUS = 0.17;
/** Build: the speed gene trades girth for leg. Stout at 0, slim at 1. */
const GIRTH_SLOW = 1.14;
const GIRTH_FAST = 0.84;
const LEG_SLOW = 1.8;
const LEG_FAST = 2.8;
/** Eyes: radius as a share of the head's, at no sense and at full sense. */
const EYE_MIN = 0.2;
const EYE_MAX = 0.5;
/** Jaws: none below this gene value; then this long, in head radii. */
const JAW_FROM = 0.2;
const JAW_MIN = 0.6;
const JAW_MAX = 2.0;
/** Armour: none below the first value; from the second the body is under one shell. */
const ARMOUR_FROM = 0.15;
const SHELL_FROM = 0.55;
/**
 * Fins: none below this gene value; then this long, in head radii. An animal with legs
 * grows no fins beside them: its feet web from here on, and are flippers from the value
 * at which it lives in the water.
 */
const FINS_FROM = 0.3;
const FIN_MIN = 1.0;
const FIN_MAX = 2.6;
/** From this aquatic gene value a creature lives in the water. */
export const SWIMS_FROM = 0.6;
/** Pace in cells per second: far faster than the sim, to keep bodies moving. */
const PACE_BASE = 0.6;
const PACE_PER_SPEED = 0.4;
const SATURATION = 0.5;
const IVORY = 0xf2ead0;
const EYE = 0x1b1b1b;
const OUTLINE = 0x1f1a17;
/** A leg gets an edge of its own from this many pixels thick, a foot from this many. */
const LEG_EDGE_FROM_PX = 2.5;
const FOOT_FROM_PX = 2;
/** An eye gets a glint from this many pixels across. */
const GLINT_FROM_PX = 3;
/** A webbed foot: its radius in leg thicknesses, at no webbing and just short of a flipper. */
const WEB_MIN = 0.55;
const WEB_MAX = 0.72;
/** A flipper: how long against the leg it replaces, and how wide against its own length. */
const FLIPPER_LENGTH = 0.85;
const FLIPPER_WIDTH = 0.46;
/** And never less than this many times as wide as the leg was thick. */
const FLIPPER_BROADER = 1.5;
/** How much shorter the flippers are on a body that keeps other legs to walk on. */
const FLIPPER_AMONG_LEGS = 0.7;
/** Markings keep inside this share of the mass they are on, clear of its outline. */
const MARK_INSIDE = 0.9;
/** A marking narrower than this many pixels is left out. */
const MARK_FROM_PX = 0.75;
/**
 * lit: a mass or a marking has a side in shade from this many pixels across, as wide as
 * this share of it (between half a pixel and one and a half each way), and a lit patch
 * from this many; the largest also get a gleam.
 */
const SHADE_FROM_PX = 3;
const SHADE_SHARE = 0.08;
const LIGHT_FROM_PX = 5;
/** A marking carries a lit patch only if it is no longer than this many times its width. */
const LIT_MARK_ASPECT = 2.2;
const GLEAM_FROM_PX = 14;
/** What shade is mixed with: a dark blue, so that the far side is cooler as well as darker. */
const SHADOW = 0x1c1838;
const SHADE_MIX = 0.36;
/** What a lit marking is mixed with: a warm white. */
const SUNLIT = 0xfff4d6;

/**
 * How a lit body is coloured. `lit` is the first: grey-black outline, cool shade. `cosy`
 * follows Stardew Valley's animals: more saturated, the outline the animal's own colour
 * taken almost to black and toward plum, shade toward violet, light toward gold, eyes a
 * size larger, and a shadow under the animal on the ground.
 */
interface Palette {
  saturation: number;
  /** The outline of an animal of this hue. */
  outline: (hue: number) => number;
  shadow: number;
  shadeMix: number;
  /** How wide the shade along a mass's far edge is, as a share of the mass. */
  shadeShare: number;
  /** And no wider than this many pixels. */
  shadeMaxPx: number;
  sunlit: number;
  /** The body's lit patch: the body toward `light` (the body's own pale tone) by this, then toward `warm`. */
  lightMix: number;
  warm: number;
  warmMix: number;
  eyes: number;
  glintFromPx: number;
  /** A shadow on the ground under the animal, this opaque; 0 for none. */
  groundShadow: number;
}
const PALETTES: Readonly<Record<"lit" | "cosy", Palette>> = {
  lit: {
    saturation: SATURATION,
    outline: () => OUTLINE,
    shadow: SHADOW,
    shadeMix: SHADE_MIX,
    shadeShare: SHADE_SHARE,
    shadeMaxPx: 1.5,
    sunlit: SUNLIT,
    lightMix: 0.5,
    warm: SUNLIT,
    warmMix: 0,
    eyes: 1,
    glintFromPx: GLINT_FROM_PX,
    groundShadow: 0,
  },
  cosy: {
    saturation: 0.82,
    outline: (hue) => blend(colour(hue, 0.2, 0.85), cosy.PLUM, 0.35),
    shadow: cosy.SHADE,
    shadeMix: 0.5,
    shadeShare: 0.16,
    shadeMaxPx: 2.5,
    sunlit: cosy.SUNLIT,
    lightMix: 0.65,
    warm: cosy.GOLD,
    warmMix: 0.4,
    eyes: 1.45,
    glintFromPx: 2,
    groundShadow: 0.38,
  },
};
/**
 * Rare genes (M7), each drawn by its signature (`rare.ts`):
 *   venom    fangs in acid green, and a dark tip at the end of the body
 *   warning  bold bands across the back, in black or yellow against the body
 *   elder    colours greyer, and pale flecks along the back
 *   gills    a fan of frills either side behind the head
 *   coat     a soft, wide outline: fur
 *   leaves   colours turned toward leaf green, and leaves along the back
 *   glow     pale spots along the back (lit in the dark: R4)
 *   giant    nothing here: it is drawn at its adjusted mass
 */
const VENOM_FANG = 0xc8f04a;
const VENOM_TIP = 0x241028;
const VENOM_TIP_MIX = 0.65;
const WARNING_DARK = 0x1e1612;
const WARNING_BRIGHT = 0xf2c91e;
/** A body this light (0–255) gets dark warning bands, a darker one bright bands. */
const WARNING_LIGHT_BODY = 140;
const ELDER_SATURATION = 0.55;
const ELDER_FLECK = 0xebe5d8;
const GILL = 0xe8707e;
const GILL_MIX = 0.75;
/** A gill frill, in head radii: how long, how wide, and how far out from the head's middle. */
const GILL_LENGTH = 1.5;
const GILL_WIDTH = 0.5;
const GILL_OUT = 1.45;
/** A coat: the outline this many times as wide, partway toward the body's colour. */
const COAT_WIDTH = 3.5;
const COAT_MIX = 0.6;
const LEAF_HUE = 0.3;
const LEAF_HUE_SHIFT = 0.85;
const LEAF = 0x5fa83c;
const LEAF_MIX = 0.5;
export const GLOW_SPOT = 0xdcffb4;

/** The shadow on the ground: its size against the body it lies under. */
const GROUND_SHADOW_LONG = 1.0;
const GROUND_SHADOW_WIDE = 2.0;

/** A newborn is this share of its grown length, its head this much larger for it. */
const YOUNG_SIZE = 0.5;
const YOUNG_HEAD = 0.35;

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
/** 0 at `from`, 1 at full gene value. */
const above = (gene: number, from: number): number => clamp01((gene - from) / (1 - from));

/** hue 0–1 → 0xRRGGBB at a fixed saturation, with `light` as lightness (0–1). */
export function colour(hue: number, light: number, saturation = SATURATION): number {
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const sector = (((hue % 1) + 1) % 1) * 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const lift = light - chroma / 2;
  const byte = (value: number): number => Math.round((value + lift) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/** Perceived lightness of 0xRRGGBB, 0–255. */
function lightnessOf(rgb: number): number {
  return 0.299 * ((rgb >> 16) & 255) + 0.587 * ((rgb >> 8) & 255) + 0.114 * (rgb & 255);
}

/** A hue `share` of the way from `from` to `to`, the short way round the wheel. */
function towardHue(from: number, to: number, share: number): number {
  const gap = ((((to - from) % 1) + 1.5) % 1) - 0.5;
  return (((from + gap * share) % 1) + 1) % 1;
}

/** Blend two 0xRRGGBB colours: `from` at 0, `to` at 1. */
export function blend(from: number, to: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(lerp((from >> shift) & 0xff, (to >> shift) & 0xff, clamp01(t))) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** Which body plan a genome builds: leg pairs first, then water, armour and speed. */
export function kindOf(seed: Look): Kind {
  const pairs = Math.round(seed.limbPairs);
  const finned = seed.aquatic >= FINS_FROM;
  const shelled = seed.armour >= SHELL_FROM;
  if (pairs === 0) {
    if (finned) return seed.speed < 0.4 ? "eel" : "fish";
    return seed.speed >= 0.5 ? "snake" : "worm";
  }
  if (pairs === 1) return "hopper";
  if (pairs === 2) {
    if (shelled) return "tortoise";
    if (seed.aquatic >= 0.5) return "newt";
    return seed.speed >= 0.55 ? "lizard" : "beast";
  }
  if (pairs === 3) return shelled ? "beetle" : "insect";
  return finned || seed.armour >= 0.4 ? "crab" : "spider";
}

/** Widths of the body at each joint, as shares of the reference radius, head first. */
function widths(kind: Kind, length: number): number[] {
  const count = (base: number, low: number, high: number): number =>
    Math.min(Math.max(Math.round(base + 3 * length), low), high);
  switch (kind) {
    case "worm": {
      const joints = count(4, 6, 10);
      return Array.from({ length: joints }, (_, i) =>
        i === 0 ? 0.62 : i === joints - 1 ? 0.42 : i === joints - 2 ? 0.6 : 0.7,
      );
    }
    case "snake": {
      const joints = count(6, 9, 12);
      return Array.from({ length: joints }, (_, i) => {
        const t = i / (joints - 1);
        return i === 0
          ? 0.75
          : i === 1
            ? 0.5
            : t < 0.55
              ? 0.62
              : lerp(0.62, 0.14, (t - 0.55) / 0.45);
      });
    }
    case "fish":
      return [0.8, 1.15, 1.0, 0.65, 0.32];
    case "eel":
      return [0.6, 0.66, 0.66, 0.62, 0.58, 0.52, 0.44, 0.34, 0.2];
    case "hopper":
      return [1.0, 1.35, 0.9];
    case "lizard":
      return [0.85, 0.7, 1.05, 1.1, 0.9, 0.6, 0.38, 0.18];
    case "beast":
      return [0.95, 1.2, 1.3, 1.05, 0.3];
    case "newt":
      return [1.0, 0.8, 0.95, 0.9, 0.65, 0.42, 0.22];
    case "tortoise":
      return [0.6, 1.0, 1.0, 0.25];
    case "insect":
      return [0.7, 0.85, 0.45, 1.05, 0.8];
    case "beetle":
      return [0.6, 0.95, 1.25, 1.0];
    case "spider":
      return [0.85, 1.0, 1.5];
    case "crab":
      return [0.5, 1.0, 0.5];
  }
}

/** How much longer or shorter than the plain chain each kind is. */
const STRETCH: Readonly<Record<Kind, number>> = {
  worm: 1.2,
  snake: 1.55,
  fish: 1.0,
  eel: 1.45,
  hopper: 0.78,
  lizard: 1.3,
  beast: 0.92,
  newt: 1.15,
  tortoise: 0.85,
  insect: 1.0,
  beetle: 0.9,
  spider: 0.8,
  crab: 0.46,
};

/** Where each kind's leg pairs grow and rest: joint, aim, and length and thickness in radii. */
const LEGS: Readonly<Record<Kind, readonly (readonly [number, number, number, number])[]>> = {
  worm: [],
  snake: [],
  fish: [],
  eel: [],
  hopper: [[1, -0.55, 3.4, 0.75]],
  lizard: [
    [2, 0.5, 2.4, 0.42],
    [4, -0.3, 2.4, 0.42],
  ],
  beast: [
    [1, 0.4, 1.9, 0.7],
    [3, -0.3, 1.9, 0.7],
  ],
  newt: [
    [2, 0.5, 1.9, 0.45],
    [4, -0.3, 1.9, 0.45],
  ],
  tortoise: [
    [1, 0.65, 1.5, 0.7],
    [2, -0.65, 1.5, 0.7],
  ],
  insect: [
    [1, 0.75, 2.6, 0.3],
    [1, 0.05, 2.6, 0.3],
    [2, -0.7, 2.8, 0.3],
  ],
  beetle: [
    [1, 0.7, 2.0, 0.36],
    [2, 0.05, 2.0, 0.36],
    [2, -0.7, 2.1, 0.36],
  ],
  spider: [
    [1, 0.95, 3.4, 0.26],
    [1, 0.35, 3.6, 0.26],
    [1, -0.3, 3.6, 0.26],
    [1, -0.9, 3.4, 0.26],
  ],
  crab: [
    [1, 0.45, 2.6, 0.34],
    [1, 0.05, 2.8, 0.34],
    [1, -0.35, 2.8, 0.34],
    [1, -0.8, 2.5, 0.34],
  ],
};

/**
 * The plan of a body with this look. `kind` overrides the kind its own genes give (one
 * plan per species, `species.ts`); the rest still follows its own genes.
 */
export function bodyPlan(
  input: Look,
  options: BodyOptions = FIRST_LOOK,
  kind: Kind = kindOf(input),
): BodyPlan {
  const rare = new Set<RareLook>(input.rare ?? []);
  // With colours from its genes, every part drawn in its hue (fins, outline) takes the body's.
  const own: Look = input.colours === undefined ? input : { ...input, hue: input.colours.body.hue };
  // Leaves turn its colours toward leaf green, whatever its hue.
  const leafy = (hue: number): number => towardHue(hue, LEAF_HUE, LEAF_HUE_SHIFT);
  const seed: Look = rare.has("leaves")
    ? {
        ...own,
        hue: leafy(own.hue),
        ...(input.colours === undefined
          ? {}
          : {
              colours: {
                body: { ...input.colours.body, hue: leafy(input.colours.body.hue) },
                mark: { ...input.colours.mark, hue: leafy(input.colours.mark.hue) },
              },
            }),
      }
    : own;
  const genes = seed.colours;
  // A young one is smaller, its head larger for its body (R5).
  const young = 1 - clamp01(seed.growth ?? 1);
  const base =
    options.scale * LENGTH_PER_UNIT_MASS * Math.cbrt(seed.mass) * (1 - (1 - YOUNG_SIZE) * young);
  const swims = seed.aquatic >= SWIMS_FROM;
  const pace =
    options.pace * (PACE_BASE + PACE_PER_SPEED * (swims ? seed.swimSpeed : seed.landSpeed));
  const palette = PALETTES[options.style === "cosy" ? "cosy" : "lit"];
  /** The animal's colours, as saturated as the style has them. */
  const saturation = palette.saturation * (rare.has("elder") ? ELDER_SATURATION : 1);
  const tone = (hue: number, light: number): number => colour(hue, light, saturation);
  /** The body's colour this much lighter (+) or darker (-) than its own. */
  const bodyTone = (by: number): number =>
    genes === undefined
      ? tone(seed.hue, 0.55 + by)
      : colour(
          genes.body.hue,
          Math.min(Math.max(genes.body.light + by, 0.08), 0.92),
          genes.body.saturation * (rare.has("elder") ? ELDER_SATURATION : 1),
        );
  const body = bodyTone(0);
  const dark = bodyTone(-0.25);
  const parts: Part[] = [];
  const part = (
    shape: Shape,
    joint: number,
    along: number,
    across: number,
    tint: number,
    layer: number,
    forward = 0,
    side = 0,
    turn = 0,
  ): void => {
    parts.push({
      shape,
      joint,
      along,
      across,
      forward,
      side,
      turn,
      colour: tint,
      layer,
      lift: 0,
      flat: false,
    });
  };
  /** The same part on both sides of the body. */
  const pair = (
    shape: Shape,
    joint: number,
    along: number,
    across: number,
    tint: number,
    layer: number,
    forward: number,
    side: number,
    turn = 0,
  ): void => {
    part(shape, joint, along, across, tint, layer, forward, side, turn);
    part(shape, joint, along, across, tint, layer, forward, -side, -turn);
  };
  const girth = lerp(GIRTH_SLOW, GIRTH_FAST, seed.speed);
  const reference = HEAD_RADIUS * base * girth;
  const eye = reference * lerp(EYE_MIN, EYE_MAX, seed.sense);
  const jaw =
    seed.jaw < JAW_FROM ? 0 : reference * lerp(JAW_MIN, JAW_MAX, above(seed.jaw, JAW_FROM));
  const jawColour = rare.has("venom") ? VENOM_FANG : blend(dark, IVORY, seed.diet);
  const fin =
    seed.aquatic < FINS_FROM
      ? 0
      : reference * lerp(FIN_MIN, FIN_MAX, above(seed.aquatic, FINS_FROM));
  const finColour = tone(seed.hue, 0.72);
  const legLength = HEAD_RADIUS * base * lerp(LEG_SLOW, LEG_FAST, seed.speed);

  if (options.style === "circles") {
    // The first look: one chain for every animal.
    const segments = Math.min(Math.max(Math.round(3 + 2.2 * base), 4), 9);
    const taper = 0.55 + 0.2 * seed.aquatic;
    const radii = Array.from({ length: segments }, (_, i) => {
      const along = i / (segments - 1);
      return reference * (i === 1 ? 1.12 : 1 - taper * along ** 1.3);
    });
    const pattern = seed.pattern < 1 / 3 ? "plain" : seed.pattern < 2 / 3 ? "bands" : "spots";
    const shell = seed.armour < ARMOUR_FROM ? 0 : lerp(0.18, 0.5, above(seed.armour, ARMOUR_FROM));
    const last = segments - 1;
    if (fin > 0) {
      const at = Math.max(1, Math.round(last / 3));
      // Swept back from the shoulders, and a fluke across the tail tip.
      pair(
        "disc",
        at,
        fin,
        fin * 0.45,
        finColour,
        LAYER.under,
        -fin * 0.3,
        (radii[at] ?? 0) * 0.6 + fin * 0.4,
        2.2,
      );
      part(
        "disc",
        last,
        fin * 0.45,
        fin * 1.1,
        finColour,
        LAYER.under,
        -(radii[last] ?? 0) - fin * 0.18,
      );
    }
    if (jaw > 0) {
      // Pincers: rooted at the cheeks, closing toward the middle at the tips.
      pair(
        "bar",
        0,
        Math.hypot(jaw, reference * 0.45),
        Math.max(reference * 0.45, 0.05),
        jawColour,
        LAYER.under,
        reference * 0.5 + jaw / 2,
        reference * 0.375,
        -Math.atan2(reference * 0.45, jaw),
      );
    }
    for (let i = last; i >= 0; i--) {
      const radius = radii[i] ?? 0;
      if (shell > 0)
        part(
          "disc",
          i,
          2 * radius * (1 + shell),
          2 * radius * (1 + shell),
          tone(seed.hue, 0.18),
          LAYER.under,
        );
      const banded = pattern === "bands" && i % 2 === 1;
      part(
        "disc",
        i,
        2 * radius,
        2 * radius,
        banded ? tone(seed.hue + 0.08, 0.4) : body,
        LAYER.body,
      );
      if (pattern === "spots" && i > 0)
        part("disc", i, radius * 0.9, radius * 0.9, tone(seed.hue + 0.08, 0.8), LAYER.mark);
    }
    pair("disc", 0, 2 * eye, 2 * eye, EYE, LAYER.face, reference * 0.35, reference * 0.55);
    const pairs = Math.round(seed.limbPairs);
    const legs: LegPlan[] = [];
    for (let index = 0; index < pairs; index++) {
      const joint = Math.min(
        1 + Math.round((index * (segments - 3)) / Math.max(pairs - 1, 1)),
        segments - 2,
      );
      for (const side of [1, -1] as const) {
        legs.push({
          joint,
          side,
          length: legLength,
          thickness: Math.max((radii[joint] ?? 0) * 0.45, 0.04),
          aim: 0.38,
          colour: dark,
          edge: 0,
          foot: 0,
          fin: 0,
          sole: dark,
        });
      }
    }
    return finish({
      kind: "chain",
      length: base,
      spacing: base / last,
      joints: segments,
      radii,
      parts,
      legs,
      swims,
      pace,
      colour: body,
      outline: OUTLINE,
    });
  }

  const length = base * STRETCH[kind];
  const shares = widths(kind, base);
  const joints = shares.length;
  const spacing = length / (joints - 1);
  const radii = shares.map(
    (share, i) => share * reference * (i === 0 ? 1 + YOUNG_HEAD * young : 1),
  );
  const last = joints - 1;
  const light = bodyTone(0.15);
  const mark = tone(seed.hue + 0.08, 0.38);
  const pale = tone(seed.hue + 0.08, 0.8);
  const shellColour = bodyTone(-0.31);
  const head = radii[0] ?? reference;

  // Warning colours are bold bands, whatever the pattern gene says.
  const warning = rare.has("warning");
  const { pattern, shade } = warning
    ? { pattern: "bands" as Pattern, shade: 0 }
    : patternOf(seed.pattern);
  // The colour of the marking: darker, paler, or a colour from across the wheel.
  const accent = warning
    ? lightnessOf(body) > WARNING_LIGHT_BODY
      ? WARNING_DARK
      : WARNING_BRIGHT
    : genes !== undefined
      ? colour(genes.mark.hue, genes.mark.light, genes.mark.saturation)
      : ([mark, pale, tone(seed.hue + 0.5, 0.6), tone(seed.hue + 0.33, 0.45)][
          Math.floor(shade * 4)
        ] ?? mark);
  // Under a shell or a carapace the trunk is not what catches the light.
  const covered = kind === "tortoise" || kind === "beetle" || kind === "crab";
  /**
   * The body's colour at a joint. A body that fades does it in its masses themselves,
   * from its own colour at the shoulders to the marking's at the tail; under one shell
   * it is the shell that fades, further down.
   */
  const bodyAt = (joint: number): number =>
    pattern === "fade" && !covered
      ? blend(body, accent, clamp01((joint - 1) / Math.max(last - 1, 1)))
      : body;

  // The trunk: an oval at every joint, long enough to run into the next. A worm is ringed.
  for (let i = last; i >= 1; i--) {
    // A crab ends with its carapace: the last joint only steers the chain.
    if (kind === "crab" && i === last) continue;
    const radius = radii[i] ?? 0;
    const tint = bodyAt(i);
    part(
      "disc",
      i,
      Math.max(2 * radius, spacing * 1.3),
      2 * radius,
      kind === "worm" && i % 2 === 0 ? blend(tint, dark, 0.28) : tint,
      covered ? LAYER.under : LAYER.body,
    );
  }
  // The one mass the markings go on, for the kinds that have one: a shell, a carapace.
  let canvas: Part | null = null;

  // What is particular to the kind: shell, abdomen, carapace, tail.
  if (kind === "tortoise" || kind === "beetle") {
    const across = (kind === "tortoise" ? 3.1 : 2.9) * reference;
    const along = spacing * (joints - 2) + 1.6 * reference;
    const middle = kind === "tortoise" ? 1 : 2;
    part("disc", middle, along, across, shellColour, LAYER.body, -spacing * 0.5);
    canvas = parts[parts.length - 1] ?? null;
    part(
      "disc",
      middle,
      along * 0.8,
      across * 0.78,
      blend(body, shellColour, 0.35),
      LAYER.light,
      -spacing * 0.5,
    );
    if (kind === "beetle") {
      // Wing cases meet along the back; the plate behind the head is the pronotum.
      part(
        "bar",
        middle,
        along * 0.82,
        Math.max(reference * 0.16, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
      );
      part("disc", 1, 1.5 * reference, 2.2 * reference, shellColour, LAYER.body);
    } else {
      // Scutes: a cross of seams over the dome.
      part(
        "bar",
        middle,
        along * 0.74,
        Math.max(reference * 0.14, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
      );
      part(
        "bar",
        middle,
        across * 0.72,
        Math.max(reference * 0.14, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
        0,
        Math.PI / 2,
      );
      part(
        "wedge",
        last,
        reference * 0.9,
        reference * 0.6,
        body,
        LAYER.under,
        -reference * 0.5,
        0,
        Math.PI,
      );
    }
  } else if (kind === "crab") {
    // Wider than long, eyes on stalks, and the arms that carry the claws.
    part("disc", 1, 2.3 * reference, 3.6 * reference, body, LAYER.body);
    canvas = parts[parts.length - 1] ?? null;
    part(
      "disc",
      1,
      1.7 * reference,
      2.9 * reference,
      blend(body, light, 0.5),
      LAYER.light,
      -0.1 * reference,
    );
    // A pincer on each arm: a palm, and two fingers that close toward each other.
    const claw = reference * (0.8 + 0.5 * seed.jaw);
    const reach = 1.75 * reference;
    const out = 1.25 * reference;
    pair(
      "bar",
      1,
      1.5 * reference,
      0.45 * reference,
      dark,
      LAYER.under,
      1.05 * reference,
      1.45 * reference,
      -0.55,
    );
    pair(
      "wedge",
      1,
      claw,
      claw * 0.42,
      jawColour,
      LAYER.under,
      reach + claw * 0.72,
      out + claw * 0.14,
      -0.12,
    );
    pair(
      "wedge",
      1,
      claw * 0.8,
      claw * 0.34,
      jawColour,
      LAYER.under,
      reach + claw * 0.58,
      out - claw * 0.3,
      -0.5,
    );
    pair("disc", 1, claw * 1.1, claw * 0.85, body, LAYER.body, reach, out, -0.25);
    pair(
      "bar",
      0,
      0.9 * reference,
      Math.max(0.16 * reference, 0.03),
      dark,
      LAYER.under,
      0.5 * reference,
      0.5 * reference,
    );
  } else if (kind === "spider") {
    part("disc", 2, 3.1 * reference, 3.0 * reference, bodyAt(2), LAYER.body, -0.2 * reference);
    part("disc", 2, 1.0 * reference, 1.1 * reference, mark, LAYER.mark, -0.3 * reference);
  } else if (kind === "insect") {
    // Three parts: head, thorax, and an abdomen that ends in a point.
    part("disc", 3, spacing * 2.3, 2.1 * reference, bodyAt(3), LAYER.body, -spacing * 0.45);
    part(
      "wedge",
      last,
      reference * 1.1,
      reference * 0.9,
      dark,
      LAYER.under,
      -reference * 0.9,
      0,
      Math.PI,
    );
    pair(
      "bar",
      0,
      1.9 * reference,
      Math.max(0.12 * reference, 0.03),
      dark,
      LAYER.under,
      head + 0.7 * reference,
      0.55 * reference,
      0.5,
    );
  } else if (kind === "beast") {
    part("disc", 2, spacing * 2.5, 2.7 * reference, bodyAt(2), LAYER.body, spacing * 0.35);
    part(
      "bar",
      last,
      spacing * 1.2,
      Math.max(0.3 * reference, 0.04),
      dark,
      LAYER.under,
      -spacing * 0.2,
    );
  } else if (kind === "hopper") {
    // A thigh at each hip, where the one pair of legs is all muscle.
    pair(
      "disc",
      1,
      2.0 * reference,
      1.3 * reference,
      blend(body, dark, 0.3),
      LAYER.under,
      -0.5 * reference,
      1.2 * reference,
      0.5,
    );
  }

  // The head.
  const hunter = seed.diet >= 0.65;
  if (kind === "snake" || kind === "lizard" || (kind === "beast" && hunter) || kind === "newt") {
    const blunt = kind === "newt" ? 0.75 : 1;
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
    part("wedge", 0, 2.2 * head * blunt, 2 * head, body, LAYER.body, head * (0.6 + 0.5 * blunt));
  } else if (kind === "beast") {
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
    part("bar", 0, 1.1 * head, 1.25 * head, body, LAYER.body, 0.95 * head);
    if (seed.sense >= 0.3)
      pair("wedge", 0, 0.9 * head, 0.7 * head, dark, LAYER.under, -0.5 * head, 0.85 * head, 2.3);
  } else if (kind === "fish" || kind === "eel") {
    part("disc", 0, 2.4 * head, 2 * head, body, LAYER.body, 0.2 * head);
  } else if (kind === "beetle" || kind === "tortoise") {
    // Poking out from under the shell.
    part("disc", 0, 2 * head, 2 * head, blend(body, dark, 0.3), LAYER.under);
  } else {
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
  }

  // Jaws: pincers on the kinds with a shell of their own, tusks on the others. All of
  // them come out from under the head, so they are outlined with it.
  if (jaw > 0 && kind !== "crab") {
    if (kind === "beetle") {
      part("wedge", 0, jaw * 1.5, head * 0.9, dark, LAYER.under, head + jaw * 0.6);
    } else if (kind === "insect" || kind === "spider" || kind === "worm") {
      pair(
        "bar",
        0,
        Math.hypot(jaw, head * 0.45),
        Math.max(head * 0.42, 0.05),
        jawColour,
        LAYER.under,
        head * 0.5 + jaw / 2,
        head * 0.375,
        -Math.atan2(head * 0.45, jaw),
      );
    } else {
      pair(
        "wedge",
        0,
        jaw * 0.9,
        Math.max(head * 0.42, 0.05),
        jawColour,
        LAYER.under,
        head * 1.1 + jaw * 0.2,
        head * 0.5,
        0.25,
      );
    }
  }

  // Fins, for whatever swims. At the shoulders only on a body without legs: one with
  // legs swims with them, and they are what turns into fins (below).
  if (fin > 0) {
    const at = Math.max(1, Math.round(last / 3));
    const root = radii[at] ?? reference;
    if (LEGS[kind].length === 0) {
      pair(
        "wedge",
        at,
        fin,
        fin * 0.6,
        finColour,
        LAYER.under,
        -fin * 0.2,
        root * 0.7 + fin * 0.3,
        2.0,
      );
    }
    const tail = radii[last] ?? 0;
    if (kind === "fish") {
      // A forked tail and a ridge down the back.
      pair(
        "wedge",
        last,
        fin * 1.3,
        fin * 0.7,
        finColour,
        LAYER.under,
        -tail - fin * 0.5,
        fin * 0.3,
        -0.45,
      );
      part(
        "bar",
        2,
        spacing * 1.6,
        Math.max(reference * 0.22, 0.03),
        dark,
        LAYER.mark,
        spacing * 0.3,
      );
    } else if (kind === "eel" || kind === "newt") {
      for (let i = kind === "eel" ? 2 : Math.ceil(last / 2); i <= last; i++) {
        part("bar", i, spacing * 1.1, Math.max((radii[i] ?? 0) * 0.5, 0.03), finColour, LAYER.mark);
      }
      part("wedge", last, fin * 0.9, fin * 0.8, finColour, LAYER.under, -tail - fin * 0.3);
    } else if (kind === "lizard" || kind === "beast") {
      // A fluke, on the kinds with a tail to carry one.
      part("wedge", last, fin * 0.8, fin * 1.0, finColour, LAYER.under, -tail - fin * 0.3);
    }
  }

  // Plates on a back that is armoured but not under one shell.
  if (seed.armour >= ARMOUR_FROM && !covered) {
    const strength = above(seed.armour, ARMOUR_FROM);
    for (let i = 1; i < last; i++) {
      const radius = radii[i] ?? 0;
      part(
        "bar",
        i,
        Math.max(spacing * 0.45, 0.04),
        radius * lerp(0.9, 1.7, strength),
        shellColour,
        LAYER.mark,
      );
    }
  }

  // Markings. They go on stations down the back: along the one mass if the kind has
  // one, else on the widest part at each joint between the head and the tail tip.
  interface Station {
    joint: number;
    forward: number;
    /** Half the width of the body here, and how far along it this station reaches. */
    half: number;
    span: number;
    /** The mass the station is on: a marking does not leave it. */
    mass: Part;
  }
  const stations: Station[] = [];
  const along = (mass: Part): void => {
    const count = Math.max(1, Math.round(mass.along / spacing));
    for (let k = 0; k < count; k++) {
      // From the front of the mass to its back; an oval narrows toward both ends.
      const t = 0.5 - (k + 0.5) / count;
      stations.push({
        joint: mass.joint,
        forward: mass.forward + t * mass.along,
        half: (mass.across / 2) * 0.92 * Math.sqrt(Math.max(1 - (2 * t) ** 2, 0.2)),
        span: mass.along / count,
        mass,
      });
    }
  };
  if (canvas !== null) {
    along(canvas);
  } else {
    for (let i = 1; i <= Math.max(last - 1, 1); i++) {
      const masses = parts.filter(
        (mass) =>
          mass.joint === i && mass.layer === LAYER.body && mass.shape === "disc" && mass.side === 0,
      );
      const widest = masses.reduce<Part | null>(
        (best, mass) => (best === null || mass.across > best.across ? mass : best),
        null,
      );
      if (widest !== null) along(widest);
    }
  }
  const thin = 1 / options.pixels;
  /**
   * How much smaller a marking has to be drawn to stay on its mass: one that fills a box
   * of half-sizes `long` × `wide` in the mass's own axes, its middle `ahead` and `aside`
   * of the mass's. A `round` marking fills its box as an oval does.
   */
  const room = (
    mass: Part,
    ahead: number,
    aside: number,
    long: number,
    wide: number,
    round: boolean,
  ): number => {
    const a = (mass.along / 2) * MARK_INSIDE;
    const b = (mass.across / 2) * MARK_INSIDE;
    const corner = round ? Math.SQRT1_2 : 1;
    const inside = (x: number, y: number): boolean => (x / a) ** 2 + (y / b) ** 2 <= 1;
    const fits = (k: number): boolean =>
      inside(Math.abs(ahead) + k * long, aside) &&
      inside(ahead, Math.abs(aside) + k * wide) &&
      inside(Math.abs(ahead) + k * long * corner, Math.abs(aside) + k * wide * corner);
    if (fits(1)) return 1;
    let low = 0;
    let high = 1;
    for (let step = 0; step < 6; step++) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    return low;
  };
  /**
   * A marking at a station, drawn no larger than its mass has room for. Returns how much
   * smaller that made it, for a marking nested in it to be given the same.
   */
  const put = (
    shape: Shape,
    station: Station,
    long: number,
    wide: number,
    tint: number,
    ahead = 0,
    aside = 0,
    turn = 0,
    given?: number,
  ): number => {
    const { mass } = station;
    const cos = Math.abs(Math.cos(turn));
    const sin = Math.abs(Math.sin(turn));
    const k =
      given ??
      room(
        mass,
        station.forward + ahead - mass.forward,
        aside,
        (long * cos + wide * sin) / 2,
        (long * sin + wide * cos) / 2,
        shape === "disc",
      );
    // Smaller than most of a pixel it would not show.
    if (k * Math.min(long, wide) * options.pixels < MARK_FROM_PX) return k;
    part(
      shape,
      station.joint,
      long * k,
      wide * k,
      tint,
      LAYER.mark,
      station.forward + ahead,
      aside,
      turn,
    );
    return k;
  };
  /** The parts just added are one marking drawn in one colour: no shade of their own. */
  const flatten = (from: number): void => {
    for (const added of parts.slice(from)) added.flat = true;
  };
  if (canvas !== null && (pattern === "stripe" || pattern === "twin")) {
    // On one mass a stripe is one long oval, which tapers as the shell it lies on does.
    const from = parts.length;
    for (const side of pattern === "stripe" ? [0] : [0.24, -0.24]) {
      const aside = side * canvas.across;
      const chord = Math.sqrt(1 - ((2 * side) / MARK_INSIDE) ** 2);
      part(
        "disc",
        canvas.joint,
        canvas.along * MARK_INSIDE * chord * 0.92,
        Math.max(canvas.across * (pattern === "stripe" ? 0.2 : 0.13), thin),
        accent,
        LAYER.mark,
        canvas.forward,
        aside,
      );
    }
    flatten(from);
  }
  if (canvas !== null && pattern === "fade") {
    // One shell fades toward its rear: ovals that all touch its end, each smaller and
    // nearer the marking's colour than the one it lies on.
    const from = parts.length;
    const long = canvas.along * MARK_INSIDE;
    for (const [share, far] of [
      [0.8, 0.35],
      [0.56, 0.7],
      [0.32, 1],
    ] as const) {
      part(
        "disc",
        canvas.joint,
        long * share,
        canvas.across * MARK_INSIDE * share,
        blend(canvas.colour, accent, far),
        LAYER.mark,
        canvas.forward - (long / 2) * (1 - share),
      );
    }
    flatten(from);
  }
  stations.forEach((station, index) => {
    const { joint, forward, half, span } = station;
    const flip = index % 2 === 0 ? 1 : -1;
    const from = parts.length;
    switch (pattern) {
      case "plain":
      case "saddle":
      case "eyespots":
      case "fade":
        // A chain of masses fades in its own colours, a shell in ovals (both above).
        break;
      case "stripe":
        // Down a chain of masses a stripe is ovals that run into each other and bend
        // with the back.
        if (canvas !== null) break;
        part("disc", joint, span * 1.35, Math.max(half * 0.5, thin), accent, LAYER.mark, forward);
        flatten(from);
        break;
      case "twin":
        if (canvas !== null) break;
        pair(
          "disc",
          joint,
          span * 1.35,
          Math.max(half * 0.3, thin),
          accent,
          LAYER.mark,
          forward,
          half * 0.5,
        );
        flatten(from);
        break;
      case "bands":
        // A narrow oval across the back, on every other station.
        if (index % 2 === 0) put("disc", station, span * 0.5, half * 1.9, accent);
        break;
      case "bars":
        // One bar across the back at each station, all leaning the same way, as a tiger's.
        put(
          "bar",
          station,
          half * 1.6,
          Math.max(span * 0.24, thin),
          accent,
          0,
          0,
          Math.PI / 2 + 0.35,
        );
        break;
      case "spots":
        put("disc", station, half * 0.9, half * 0.9, accent, 0, half * 0.35 * flip);
        break;
      case "rings": {
        const k = put("disc", station, half * 1.2, half * 1.2, mark, 0, half * 0.25 * flip);
        put("disc", station, half * 0.62, half * 0.62, pale, 0, half * 0.25 * flip, 0, k);
        break;
      }
      case "chevrons":
        put("wedge", station, span * 0.95, half * 1.7, accent, 0, 0, Math.PI);
        break;
      case "speckle":
        put("disc", station, half * 0.36, half * 0.36, mark, span * 0.28, half * 0.5);
        put("disc", station, half * 0.3, half * 0.3, pale, -span * 0.1, -half * 0.55);
        put("disc", station, half * 0.34, half * 0.34, mark, -span * 0.32, half * 0.15 * flip);
        break;
    }
  });
  const widest = stations.reduce<Station | null>(
    (best, station) => (best === null || station.half > best.half ? station : best),
    null,
  );
  if (pattern === "saddle" && widest !== null) {
    // One patch over the middle of the widest mass, as large as fits it.
    const { mass } = widest;
    put("disc", { ...widest, forward: mass.forward }, mass.along * 0.72, mass.across * 0.8, accent);
    // And a mask across the eyes, where the head is not half under a shell.
    if (!covered) part("disc", 0, head * 0.9, head * 1.7, mark, LAYER.mark, head * 0.3);
  }
  if (pattern === "eyespots" && widest !== null) {
    // Two false eyes on the widest part of the back: dark, pale, and a dark middle.
    for (const side of [1, -1]) {
      let k: number | undefined;
      for (const [size, tint] of [
        [0.95, mark],
        [0.66, pale],
        [0.28, mark],
      ] as const) {
        const across = widest.half * size;
        k = put("disc", widest, across, across, tint, 0, side * widest.half * 0.46, 0, k);
      }
    }
  }

  // Eyes: on stalks for a crab, a cluster for a spider, on the sides for the rest. Their
  // size goes by the head they sit on, which is small on a beetle or a crab.
  const sighted = 2 * head * lerp(EYE_MIN, EYE_MAX, seed.sense) * palette.eyes;
  const stalked = reference * lerp(EYE_MIN, EYE_MAX, seed.sense) * palette.eyes;
  if (kind === "crab") {
    pair("disc", 0, stalked, stalked, EYE, LAYER.face, 0.95 * reference, 0.5 * reference);
  } else if (kind === "spider") {
    pair("disc", 0, 0.7 * sighted, 0.7 * sighted, EYE, LAYER.face, head * 0.55, head * 0.3);
    pair("disc", 0, 0.6 * sighted, 0.6 * sighted, EYE, LAYER.face, head * 0.25, head * 0.62);
  } else if (kind !== "worm" || seed.sense >= 0.5) {
    const bulge = kind === "hopper" || kind === "fish" ? 0.85 : 0.6;
    pair("disc", 0, sighted, sighted, EYE, LAYER.face, head * 0.3, head * bulge);
    if (sighted * options.pixels >= palette.glintFromPx) {
      // A glint, on the side of each eye the light comes from.
      pair(
        "disc",
        0,
        sighted * 0.36,
        sighted * 0.36,
        0xffffff,
        LAYER.face,
        head * 0.3,
        head * bulge,
      );
      for (const glint of parts.slice(-2)) glint.lift = sighted * 0.22;
    }
  }

  // Legs, and how far the aquatic gene has turned them into fins. On a body with many
  // legs only the last pair turns, as a water beetle's; the others go on walking.
  const finned = clamp01((seed.aquatic - FINS_FROM) / (SWIMS_FROM - FINS_FROM));
  const legs: LegPlan[] = [];
  LEGS[kind].forEach(([joint, aim, reach, thick], index, rows) => {
    const turned = rows.length <= 2 || index === rows.length - 1 ? finned : 0;
    const flipper = turned === 1;
    // On a body with many legs a flipper is shorter: it is one pair of paddles among legs.
    const blade = FLIPPER_LENGTH * (rows.length > 2 ? FLIPPER_AMONG_LEGS : 1);
    const long = (reach / 2.3) * legLength * (flipper ? blade : 1);
    const thickness = Math.max(thick * reference, 0.04);
    for (const side of [1, -1] as const) {
      legs.push({
        joint,
        side,
        length: long,
        // A flipper is a blade: what was the leg's thickness is its width.
        thickness: flipper
          ? Math.max(long * FLIPPER_WIDTH, thickness * FLIPPER_BROADER)
          : thickness,
        aim,
        colour: dark,
        edge: 0,
        foot: turned > 0 && !flipper ? thickness * lerp(WEB_MIN, WEB_MAX, turned) : 0,
        fin: turned,
        sole: turned > 0 ? blend(dark, finColour, 0.4 + 0.6 * turned) : dark,
      });
    }
  });

  // Rare genes' overlays, on the joints of the trunk (not a crab's last, which is not drawn).
  const trunk = Array.from({ length: last }, (_, i) => i + 1).filter(
    (i) => !(kind === "crab" && i === last),
  );
  const pixel = 1 / options.pixels;
  const flat = (): void => {
    const added = parts[parts.length - 1];
    if (added !== undefined) added.flat = true;
  };
  if (rare.has("venom")) {
    const tip = trunk[trunk.length - 1] ?? 0;
    for (const p of parts) {
      if (p.joint === tip && (p.layer === LAYER.body || p.layer === LAYER.under)) {
        p.colour = blend(p.colour, VENOM_TIP, VENOM_TIP_MIX);
      }
    }
  }
  if (rare.has("elder")) {
    trunk.forEach((i) => {
      const r = radii[i] ?? 0;
      for (let k = 0; k < 3; k++) {
        const size = Math.max(r * 0.3, pixel);
        part(
          "disc",
          i,
          size,
          size,
          ELDER_FLECK,
          LAYER.mark,
          (k - 1) * r * 0.45,
          (((i + k) % 3) - 1) * r * 0.45,
        );
        flat();
      }
    });
  }
  if (rare.has("gills")) {
    const gill = blend(body, GILL, GILL_MIX);
    for (const side of [1, -1]) {
      for (let k = 0; k < 3; k++) {
        part(
          "wedge",
          0,
          head * GILL_LENGTH,
          head * GILL_WIDTH,
          gill,
          LAYER.under,
          -head * (0.3 + 0.2 * k),
          side * head * GILL_OUT,
          side * (1.8 + 0.4 * (k - 1)),
        );
      }
    }
  }
  if (rare.has("leaves")) {
    const leaf = blend(body, LEAF, LEAF_MIX);
    trunk.slice(0, -1).forEach((i, n) => {
      const r = radii[i] ?? 0;
      const side = n % 2 === 0 ? 1 : -1;
      part("wedge", i, r * 1.5, r * 0.7, leaf, LAYER.under, -r * 0.2, side * r * 0.85, side * 2.4);
    });
  }
  if (rare.has("glow")) {
    trunk.slice(0, -1).forEach((i) => {
      const r = radii[i] ?? 0;
      const size = Math.max(r * 0.4, 1.2 * pixel);
      for (const side of [1, -1]) {
        part("disc", i, size, size, GLOW_SPOT, LAYER.mark, 0, side * r * 0.5);
        flat();
      }
    });
  }

  const plan = finish({
    kind,
    length,
    spacing,
    joints,
    radii,
    parts,
    legs,
    swims,
    pace,
    colour: body,
    outline: palette.outline(seed.hue),
  });
  if (options.style === "lit" || options.style === "cosy") {
    const coat = rare.has("coat");
    if (coat) plan.outline = blend(plan.outline, body, COAT_MIX);
    lightUp(plan, light, 1 / options.pixels, palette, coat ? COAT_WIDTH : 1);
  }
  return plan;
}

/** Put the parts in drawing order. */
function finish(plan: BodyPlan): BodyPlan {
  plan.parts.sort((a, b) => a.layer - b.layer);
  return plan;
}

/**
 * lit: a dark edge around the whole animal, `edge` cells wide; every mass with its far
 * side in shade and its back lit; every marking large enough shaded the same way. Legs
 * thick enough to carry them get an edge and a foot, and so does every flipper.
 */
function lightUp(
  plan: BodyPlan,
  light: number,
  edge: number,
  palette: Palette,
  outlineWidth = 1,
): void {
  const parts: Part[] = [];
  const masses: Part[] = [];
  for (const part of plan.parts) {
    const marking = part.layer === LAYER.mark;
    if (part.layer === LAYER.body || part.layer === LAYER.under) {
      masses.push({
        ...part,
        along: part.along + 2 * edge * outlineWidth,
        across: part.across + 2 * edge * outlineWidth,
        colour: plan.outline,
        layer: LAYER.outline,
      });
    }
    const small = Math.min(part.along, part.across);
    if ((part.layer !== LAYER.body && !marking) || part.flat || small < SHADE_FROM_PX * edge) {
      parts.push(part);
      continue;
    }
    // The side away from the light: the part as it was, darker, and on it the part
    // itself, smaller and toward the light, so that the dark shows along its far edge.
    const shaded = { ...part, colour: blend(part.colour, palette.shadow, palette.shadeMix) };
    const rim = Math.min(
      Math.max(small * palette.shadeShare, 0.5 * edge),
      palette.shadeMaxPx * edge,
    );
    part.along -= 2 * rim;
    part.across -= 2 * rim;
    part.lift += rim;
    // A marking is stacked on its own, in place; the masses of the body layer by layer,
    // so that the shade of one does not show on its neighbour.
    if (marking) parts.push(shaded, part);
    else {
      masses.push({ ...shaded, layer: LAYER.shade });
      parts.push(part);
    }
    // Only what is round catches the light, not what sticks out of the body, nor a
    // marking much longer than wide: a lit patch on a band would cut it in two.
    if (part.shape !== "disc" || small < LIGHT_FROM_PX * edge) continue;
    if (marking && Math.max(part.along, part.across) > LIT_MARK_ASPECT * small) continue;
    const lit = {
      ...part,
      along: part.along * 0.5,
      across: part.across * 0.5,
      colour: marking
        ? blend(part.colour, palette.sunlit, 0.4)
        : blend(blend(part.colour, light, palette.lightMix), palette.warm, palette.warmMix),
      layer: marking ? LAYER.mark : LAYER.light,
      lift: part.lift + small * 0.14,
    };
    if (marking) parts.push(lit);
    else masses.push(lit);
    if (marking || small < GLEAM_FROM_PX * edge) continue;
    masses.push({
      ...lit,
      along: part.along * 0.2,
      across: part.across * 0.2,
      colour: blend(part.colour, 0xffffff, 0.62),
      lift: part.lift + small * 0.22,
    });
  }
  plan.parts = [...parts, ...masses];
  if (palette.groundShadow > 0) plan.parts.push(groundShadow(plan, palette.groundShadow));
  finish(plan);
  for (const leg of plan.legs) {
    if (leg.fin === 1) {
      leg.edge = edge;
      continue;
    }
    if (leg.thickness >= LEG_EDGE_FROM_PX * edge) leg.edge = edge;
    if (leg.thickness >= FOOT_FROM_PX * edge) leg.foot = Math.max(leg.foot, leg.thickness * 0.62);
  }
}

/**
 * A soft shadow on the ground: one oval under the middle of the body, a little behind it
 * and down and to the right, away from the light. One sprite whatever the body, so that
 * it is evenly dark (overlapping see-through ovals would darken where they meet).
 */
function groundShadow(plan: BodyPlan, alpha: number): Part {
  const middle = Math.floor(plan.joints / 2);
  const widest = Math.max(...plan.radii);
  return {
    shape: "disc",
    joint: middle,
    along: plan.length * GROUND_SHADOW_LONG,
    across: 2 * widest * GROUND_SHADOW_WIDE,
    // Centred on the body: the chain runs from the head (joint 0) back.
    forward: (middle - (plan.joints - 1) / 2) * plan.spacing,
    side: 0,
    turn: 0,
    colour: cosy.GROUND_SHADOW,
    layer: LAYER.ground,
    // Away from the light: a negative lift moves it down and to the right.
    lift: -widest * 0.9,
    flat: true,
    alpha,
  };
}

/** Sprites a creature is made of, without building it. */
export function spriteCount(plan: BodyPlan): number {
  let legs = 0;
  for (const leg of plan.legs) {
    // A flipper is one blade and its edge.
    if (leg.fin === 1) legs += leg.edge > 0 ? 2 : 1;
    // Two bones a leg, each with its edge if the leg has one, a foot, and the foot's edge.
    else legs += (leg.edge > 0 ? 4 : 2) + (leg.foot > 0 ? (leg.edge > 0 ? 2 : 1) : 0);
  }
  return plan.parts.length + legs;
}
