/**
 * Family life (R5, asked by the owner on 2026-10-24), drawn only: the sim has no families
 * beyond who bore whom (`born[].parent`).
 *
 * A young one trails its mother until it comes of age: where the sim has them near each
 * other, its strolls about its own place are drawn toward a spot a little behind her and
 * to one side, walking after her as she goes and trotting to catch up (`motion.trail`).
 * The young of one brood trail in a line, each behind the one born before it. Where the
 * sim has it is never left for her: the spot is kept within its leash.
 *
 * And before a birth, the mother and the nearest grown one of her kind turn to each other
 * (the mate trotting up to her) and touch heads, a heart or two rising, before the newborn
 * is there: staged when the birth comes, since the stream says nothing of it before.
 *
 * Pure: the layer owns the animals; nothing here allocates per frame.
 */
import type { Point } from "./chain";

/** A young one trails only while the sim has it and the one it trails this near (cells). */
export const FAMILY_NEAR_CELLS = 3;
/** It keeps this far (cells) behind the end of the one it trails, beyond both their radii. */
const TRAIL_GAP_CELLS = 0.3;
/** And this many of the trailed one's widest radii to the side. */
const TRAIL_ASIDE = 0.8;

/**
 * Seconds the pair touch heads, after the mate has walked up to her: a walk of at least
 * `COURT_WALK_LEAST_S` and at most `COURT_WALK_MOST_S` (a mate further off is not asked),
 * reckoned at its pace with this margin for turning to her. It trots up, at `COURT_TROT`
 * times its pace.
 */
export const COURT_TOUCH_S = 1.4;
export const COURT_WALK_LEAST_S = 0.4;
export const COURT_WALK_MOST_S = 2.5;
export const COURT_WALK_MARGIN = 1.25;
export const COURT_TROT = 1.6;
/** A mate is looked for this near (cells, head to head). */
export const COURT_REACH_CELLS = 2.2;
/** The mate's head comes to this far (cells) from hers, beyond their two heads' radii. */
export const COURT_GAP_CELLS = 0.3;
/** Each leans its head at most this many of its body spacings toward the other. */
export const COURT_LEAN_MOST = 0.7;
/**
 * Where the mate comes to (radians from the way she faces): to one side of her head, the
 * side away from where her newborn will lie first.
 */
export const COURT_ANGLES = [0.9, 1.4, 0.5] as const;
/** Hearts that rise between them, the first this share of the way into their touch. */
export const COURT_HEARTS = 2;
export const COURT_HEARTS_FROM = 0.3;
/**
 * The share of the gap between their heads each closes at the touch (half: they meet),
 * leaning in over this first share of it and back over this last.
 */
const COURT_CLOSE = 0.5;
const COURT_IN_SHARE = 0.3;
const COURT_OUT_SHARE = 0.25;

/**
 * Where the head of a young one trailing `joints` (a mother's, or an elder sibling's,
 * with `radii`) should be, put in `out`: behind its last joint and to `side` (1 or -1) of
 * it. False if the trailed body has no length to go by.
 */
export function trailSpot(
  joints: readonly Point[],
  radii: readonly number[],
  ownRadius: number,
  side: number,
  out: Point,
): boolean {
  const head = joints[0];
  const tail = joints[joints.length - 1];
  if (head === undefined || tail === undefined) return false;
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const span = Math.hypot(dx, dy);
  if (span < 1e-6) return false;
  const ux = dx / span;
  const uy = dy / span;
  const back = (radii[radii.length - 1] ?? 0) + ownRadius + TRAIL_GAP_CELLS;
  let widest = 0;
  for (const radius of radii) widest = Math.max(widest, radius);
  const aside = TRAIL_ASIDE * widest * side;
  out.x = tail.x - ux * back - uy * aside;
  out.y = tail.y - uy * back + ux * aside;
  return true;
}

/**
 * How far a courting animal leans its head toward its mate's at `age` seconds into a
 * courtship whose touch begins at `from` and ends at `lasts` (the share of the gap between
 * their heads it closes): nothing while the mate walks up, then in, held, and out again
 * before the newborn is there.
 */
export function courtLean(age: number, from: number, lasts: number): number {
  const t = (age - from) / Math.max(lasts - from, 1e-3);
  if (t <= 0 || t >= 1) return 0;
  const ease = Math.min(t / COURT_IN_SHARE, (1 - t) / COURT_OUT_SHARE, 1);
  return COURT_CLOSE * (0.5 - 0.5 * Math.cos(Math.PI * ease));
}
