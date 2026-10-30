/**
 * A photosynthesiser basking (R5, rare genes in action): the sim feeds an animal with the
 * PHOTOSYNTHESIS gene (drawn by its "leaves") from sunlight while it is on open land. On
 * the screen, one that stands about in daylight on dry land (not walking, not eating, not
 * asleep or torpid, not hunting or tending young) settles after a moment and spreads out
 * flat to the sun: its body pressed low and widened, its leaf-like frills opened out, its
 * legs straight out to the sides; now and then a glint of light runs over its back. It
 * gets up as soon as it moves on, at dusk, or when cloud or rain comes over.
 *
 * Purely cosmetic: it basks only where the layer would have it stand still anyway, and
 * while it basks it does not stroll off. Pure functions and a small state per animal.
 */
import type { Texture } from "pixi.js";
import { pixelTexture, type SparkKind } from "./sparks";

/** It basks while the night is no deeper than this (0 full day, 1 the darkest night). */
const BASK_DARK = 0.3;
/** …and the sky no more overcast than this (0 clear, 1 a thunderstorm's; cloud is 0.5). */
const BASK_CLOUD = 0.25;
/** Seconds it stands before it settles to bask. */
const SETTLE_S = 1.2;
/** Seconds it takes to spread out, and to get up again. */
const SPREAD_S = 1.4;
const GET_UP_S = 0.35;
/** Basking, its body is this much wider across, and its parts this much further out to its sides. */
export const BASK_WIDENS = 0.4;
export const BASK_SPREADS = 0.35;
/** Basking, what catches the light is lifted this share less toward it: pressed to the ground. */
export const BASK_LOWERS = 0.7;
/** Basking, its feet rest this many leg lengths out (standing, 0.8), and straight out to the side. */
export const BASK_REACH = 1.05;
/** Seconds between glints over its back: at least, and up to this much more. */
const GLINT_EVERY_S = 1.2;
const GLINT_MORE_S = 1.6;
/** A glint: a star of sunlight that grows from a dot and shrinks back, this long (seconds). */
const GLINT_S = 0.6;
/** The glint's colour: a warm white, as the sun's. */
export const GLINT_COLOUR = 0xfff3c4;

/** One animal's basking. */
export interface Basker {
  /** How far it is spread out, 0 standing to 1 flat to the sun. */
  share: number;
  /** Seconds it has stood still in the sun, wanting to bask. */
  waited: number;
  /** Seconds to its next glint, and how many it has had (which joint the next lights). */
  glintIn: number;
  glints: number;
}

/** A new basker: standing. */
export function newBasker(): Basker {
  return { share: 0, waited: 0, glintIn: GLINT_EVERY_S, glints: 0 };
}

/** Whether the sun is out for basking: the night's `depth` and the sky's `overcast` (0–1). */
export function sunny(depth: number, overcast: number): boolean {
  return depth <= BASK_DARK && overcast <= BASK_CLOUD;
}

/**
 * Move `basker` on by `dtS` seconds: it settles to bask once it has stood `SETTLE_S` in
 * the sun with `wants` (the caller's: a photosynthesiser standing about in the sun on
 * dry land), and gets up at once without. Returns how far it is spread out (0–1).
 */
export function bask(basker: Basker, wants: boolean, dtS: number): number {
  basker.waited = wants ? basker.waited + dtS : 0;
  const goal = wants && basker.waited >= SETTLE_S ? 1 : 0;
  if (goal === 1) basker.share = Math.min(basker.share + dtS / SPREAD_S, 1);
  else basker.share = Math.max(basker.share - dtS / GET_UP_S, 0);
  return basker.share;
}

/**
 * Whether a glint is due over a basker spread out flat, `dtS` seconds on; `offset` (0–1)
 * keeps animals apart. The wait to the next is drawn from the count, not a random stream.
 */
export function glintDue(basker: Basker, dtS: number, offset: number): boolean {
  if (basker.share < 1) {
    basker.glintIn = GLINT_EVERY_S * (0.5 + offset);
    return false;
  }
  basker.glintIn -= dtS;
  if (basker.glintIn > 0) return false;
  basker.glints++;
  basker.glintIn = GLINT_EVERY_S + GLINT_MORE_S * fraction(offset + basker.glints * 0.618);
  return true;
}

/** Which of `count` places along its back the basker's latest glint is at. */
export function glintPlace(basker: Basker, count: number, offset: number): number {
  return Math.min(Math.floor(fraction(offset * 7 + basker.glints * 0.382) * count), count - 1);
}

const fraction = (value: number): number => value - Math.floor(value);

let glint: SparkKind | null = null;

/** The glint's drawing: a dot, a plus, a star, back to a dot. */
export function glintKind(): SparkKind {
  if (glint === null) {
    const plus = pixelTexture([".#.", "###", ".#."]);
    const frames: Texture[] = [
      pixelTexture(["#"]),
      plus,
      pixelTexture(["..#..", "..#..", "#####", "..#..", "..#.."]),
      plus,
      pixelTexture(["#"]),
    ];
    glint = { frames, lasts: GLINT_S, fadesAt: 0.75 };
  }
  return glint;
}
