/**
 * A hunt (R5, the owner's second animation): the stream says who killed whom (`died`
 * entries with `by`). The sim's hunter stalked its prey over the hours between two
 * creatures messages, which the scene cannot replay; it shows the end of it instead. The
 * hunter runs to where its prey was last drawn, quicker than it ever walks, and springs:
 * its head is thrust at the prey, the neck after it, a few puffs of dust kicked up behind.
 * The prey stands until the strike, then dies as a kill does (`remains.ts`: a scuffle of
 * dust, bones).
 *
 * Pure: the layer owns the bodies; here are the hunt's numbers and its shape in time.
 */
import type { Point } from "./chain";

/** The hunter runs at least this many times its walking pace. */
const CHASE_PACE = 2.5;
/** A run lasts at least and at most this many seconds: brief, whatever the way. */
const CHASE_LEAST_S = 0.4;
const CHASE_MOST_S = 1.2;
/** A hunter farther than this (cells) from its prey does not run there: the prey simply dies. */
export const CHASE_FARTHEST = 12;
/** It springs from this share of its own length short of the prey. */
export const SPRING_SHARE = 0.5;
/** The spring lasts this many seconds; the strike comes this share of the way into it. */
export const LUNGE_S = 0.32;
const STRIKE_AT = 0.45;
/** At the strike the head is thrust this many body spacings further than the body goes. */
export const LUNGE_STRETCH = 0.9;
/** At the strike the head is this share of its own radius into the prey's body. */
export const BITE_INTO = 0.5;
/** Puffs of dust kicked up from each hind foot as it springs, and their colour. */
export const KICKED = 2;
export const DUST = 0xcbb998;

/** A hunter's hunt, as the layer keeps it. */
export interface Hunt {
  /** Where it strikes (the prey's joint nearest it when the hunt began), and the prey's radius there. */
  prey: Point;
  reach: number;
  /** Seconds since the hunt began, and the seconds of the run before the spring. */
  age: number;
  run: number;
  /** How many times its walking pace it runs at. */
  speed: number;
  /** Where its head sprang from; null while it runs. */
  from: Point | null;
}

/**
 * The run to a prey `distance` cells off for a hunter walking `pace` cells a second: how
 * long it takes (seconds) and how many times its pace it runs at; null if it is too far.
 */
export function chase(distance: number, pace: number): { run: number; speed: number } | null {
  if (distance > CHASE_FARTHEST || pace <= 0) return null;
  const run = Math.min(Math.max(distance / (pace * CHASE_PACE), CHASE_LEAST_S), CHASE_MOST_S);
  return { run, speed: Math.max(CHASE_PACE, distance / (run * pace)) };
}

/** Seconds from the start of a hunt to the strike, for a run of `run` seconds. */
export function strikeAfter(run: number): number {
  return run + LUNGE_S * STRIKE_AT;
}

/**
 * The spring at `share` (0–1) of it: how far the head has gone from where it sprang to
 * where it strikes (0–1; quicker and quicker, then there), and how far it is thrust past
 * the body (0–1; most at the strike, then drawn back).
 */
export function lunge(share: number): { travel: number; stretch: number } {
  if (share < STRIKE_AT) {
    const t = share / STRIKE_AT;
    return { travel: t * t, stretch: t };
  }
  return { travel: 1, stretch: Math.max(0, 1 - (share - STRIKE_AT) / (1 - STRIKE_AT)) };
}
