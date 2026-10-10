/**
 * What a creature looks like: every drawing decision that follows from its genes and
 * derived body, as plain numbers. `creatures.ts` turns a plan into sprites.
 *
 * A first pass at showing the genes, to judge the look. R2 replaces it with the
 * phenotype shared with `fauna/phenotype.py`.
 */
import type { CreatureSeed } from "./fixture";

/** Body length in cells of a creature of mass 1; it grows with the cube root of mass. */
const LENGTH_PER_UNIT_MASS = 1.1;
const MIN_SEGMENTS = 4;
const MAX_SEGMENTS = 9;
/** Head radius as a share of body length, for a creature of middling build. */
const HEAD_RADIUS = 0.17;
/** Build: the speed gene trades girth for leg. Stout at 0, slim at 1. */
const GIRTH_SLOW = 1.14;
const GIRTH_FAST = 0.84;
const LEG_SLOW = 1.8;
const LEG_FAST = 2.8;
/** How much thinner the tail is than the head; swimmers taper further. */
const TAIL_TAPER = 0.55;
const TAIL_TAPER_AQUATIC = 0.2;
/** The chest, just behind the head, is the widest segment. */
const CHEST = 1.12;
/** Eyes: radius as a share of the head's, at no sense and at full sense. */
const EYE_MIN = 0.2;
const EYE_MAX = 0.5;
/** Jaws: none below this gene value; then mandibles of this length, in head radii. */
const JAW_FROM = 0.2;
const JAW_MIN = 0.6;
const JAW_MAX = 2.0;
/** Armour: none below this gene value; then a shell this far beyond each segment. */
const ARMOUR_FROM = 0.15;
const SHELL_MIN = 0.18;
const SHELL_MAX = 0.5;
/** Pattern gene: plain below the first bound, banded below the second, spotted above. */
const BANDS_FROM = 1 / 3;
const SPOTS_FROM = 2 / 3;
/** Fins: none below this gene value; then this long, in head radii. */
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

export type Pattern = "plain" | "bands" | "spots";

export interface BodyPlan {
  /** Head to tail, in cells. */
  length: number;
  /** Distance between neighbouring joints of the chain. */
  spacing: number;
  /** Radius of each segment, head first. */
  radii: number[];
  /** The joint each leg pair grows from, front to back. */
  legJoints: number[];
  legLength: number;
  eyeRadius: number;
  /** Length of the mandibles; 0 for none. */
  jawLength: number;
  /** How far the shell reaches beyond each segment, as a share of its radius; 0 for none. */
  shell: number;
  pattern: Pattern;
  /** Length of the side fins and width of the tail fluke; 0 for none. */
  finLength: number;
  /** Lives in the water rather than on land. */
  swims: boolean;
  /** Cells per second. */
  pace: number;
  colours: {
    body: number;
    /** Legs and the dark part of bands. */
    dark: number;
    band: number;
    spot: number;
    shell: number;
    jaw: number;
    fin: number;
  };
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
/** 0 at `from`, 1 at full gene value. */
const above = (gene: number, from: number): number => clamp01((gene - from) / (1 - from));

/** hue 0–1 → 0xRRGGBB at a fixed saturation, with `light` as lightness (0–1). */
export function colour(hue: number, light: number): number {
  const chroma = (1 - Math.abs(2 * light - 1)) * SATURATION;
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

/** Blend two 0xRRGGBB colours: `from` at 0, `to` at 1. */
export function blend(from: number, to: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(lerp((from >> shift) & 0xff, (to >> shift) & 0xff, clamp01(t))) << shift;
  return channel(16) | channel(8) | channel(0);
}

export function bodyPlan(seed: CreatureSeed): BodyPlan {
  const length = LENGTH_PER_UNIT_MASS * Math.cbrt(seed.mass);
  const segments = Math.min(Math.max(Math.round(3 + 2.2 * length), MIN_SEGMENTS), MAX_SEGMENTS);
  const head = HEAD_RADIUS * length * lerp(GIRTH_SLOW, GIRTH_FAST, seed.speed);
  const taper = TAIL_TAPER + TAIL_TAPER_AQUATIC * seed.aquatic;
  const radii: number[] = [];
  for (let i = 0; i < segments; i++) {
    const along = i / (segments - 1);
    radii.push(head * (i === 1 ? CHEST : 1 - taper * along ** 1.3));
  }

  const pairs = Math.round(seed.limbPairs);
  const legJoints: number[] = [];
  for (let pair = 0; pair < pairs; pair++) {
    // Spread from the chest to the hips, never on the head or the tail tip.
    const joint = 1 + Math.round((pair * (segments - 3)) / Math.max(pairs - 1, 1));
    legJoints.push(Math.min(joint, segments - 2));
  }

  const swims = seed.aquatic >= SWIMS_FROM;
  const dark = colour(seed.hue, 0.3);
  return {
    length,
    spacing: length / (segments - 1),
    radii,
    legJoints,
    legLength: HEAD_RADIUS * length * lerp(LEG_SLOW, LEG_FAST, seed.speed),
    eyeRadius: head * lerp(EYE_MIN, EYE_MAX, seed.sense),
    jawLength: seed.jaw < JAW_FROM ? 0 : head * lerp(JAW_MIN, JAW_MAX, above(seed.jaw, JAW_FROM)),
    shell:
      seed.armour < ARMOUR_FROM ? 0 : lerp(SHELL_MIN, SHELL_MAX, above(seed.armour, ARMOUR_FROM)),
    pattern: seed.pattern < BANDS_FROM ? "plain" : seed.pattern < SPOTS_FROM ? "bands" : "spots",
    finLength:
      seed.aquatic < FINS_FROM ? 0 : head * lerp(FIN_MIN, FIN_MAX, above(seed.aquatic, FINS_FROM)),
    swims,
    pace: PACE_BASE + PACE_PER_SPEED * (swims ? seed.swimSpeed : seed.landSpeed),
    colours: {
      body: colour(seed.hue, 0.55),
      dark,
      band: colour(seed.hue + 0.08, 0.4),
      spot: colour(seed.hue + 0.08, 0.8),
      shell: colour(seed.hue, 0.18),
      // Grazers' jaws are the colour of their legs; the more meat, the more ivory.
      jaw: blend(dark, IVORY, seed.diet),
      fin: colour(seed.hue, 0.72),
    },
  };
}

/** Sprites a creature is made of, without building it. */
export function spriteCount(plan: BodyPlan): number {
  const segments = plan.radii.length;
  return (
    segments + // body
    (plan.shell > 0 ? segments : 0) +
    (plan.pattern === "spots" ? segments - 1 : 0) +
    2 + // eyes
    (plan.jawLength > 0 ? 2 : 0) +
    (plan.finLength > 0 ? 3 : 0) + // two side fins and the tail fluke
    plan.legJoints.length * 4 // two legs of two bones per pair
  );
}
