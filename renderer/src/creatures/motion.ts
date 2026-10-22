/**
 * Life between sim ticks. The sim moves an animal every ten sim-minutes, a fraction of
 * a cell at a time; watched in real time that is stillness. Here an animal keeps to the
 * place the sim last gave it (its anchor) and lives there: it walks to a new anchor when
 * one comes, then pauses, looks about, and strolls a little around it, never further than
 * its leash. Where it is drawn is cosmetic; where it is, is the sim's.
 *
 * Pure: the caller owns the head and heading of the body's chain and a random stream,
 * and says which places the body can stand on. Nothing here allocates per frame.
 */
import type { Point } from "./chain";

/** How far (cells) an animal strays from its anchor: this, and this much per body length. */
const LEASH_BASE = 0.4;
const LEASH_PER_LENGTH = 0.6;
/** Further than this (cells) from its anchor, it is put there at once: it is a new arrival or the camera cut. */
const SNAP_CELLS = 12;
/** Close enough to where it is going, as a share of its body length. */
const ARRIVED_SHARE = 0.15;
/** Behind by more than this many leashes, it hurries: up to `HURRY` times its pace. */
const HURRY_FROM_LEASHES = 3;
const HURRY = 2;
/** Strolls are slower than walking to a new place. */
const STROLL_PACE = 0.55;
/** Seconds a pause lasts, from and to. */
const PAUSE_MIN_S = 1.5;
const PAUSE_MAX_S = 5;
/** After a pause, the chance it strolls rather than pausing again. */
const STROLL_CHANCE = 0.6;
/** Places tried when choosing where to stroll to. */
const STROLL_TRIES = 8;
/** Places along the way to a stroll's goal that must be free too, besides the goal (R5). */
const STROLL_CHECKS = 3;
/**
 * Walking to where the sim has it, it looks this share of its body length ahead (R5); what
 * is in the way there it walks round, turning aside by `STEER_STEP` (radians) at a time,
 * up to `STEER_TRIES` times either way; with no way round, it goes straight on.
 */
const STEER_AHEAD_SHARE = 0.6;
const STEER_STEP = Math.PI / 8;
const STEER_TRIES = 5;
/** Facing its way round within half a turn aside (the cosine of it), it walks on. */
const TURNED = Math.cos(STEER_STEP / 2);
/**
 * Moving its anchor off what it cannot stand on (R5): rings this far apart (cells), out
 * to `CLEAR_REACH`, each tried at `CLEAR_ANGLES` places.
 */
const CLEAR_STEP = 0.08;
const CLEAR_REACH = 1.6;
const CLEAR_ANGLES = 12;
/**
 * The anchor goes on past the first clear place, outward, by this share of the body's
 * length where it can: room for the body behind the head as it walks out.
 */
const CLEAR_BEYOND_SHARE = 0.7;
/**
 * Paused with its body in a plant behind it, it steps on by this share of its length,
 * straight ahead or turned aside by up to `STEP_OUT_TRIES` steps of `STEER_STEP`.
 */
const STEP_OUT_SHARE = 0.6;
const STEP_OUT_TRIES = 4;
/** How fast it turns toward where it is going, and while looking about (radians a second). */
const TURN_RATE = 3;
const LOOK_RATE = 1.2;
/** How far it looks either way while it pauses (radians). */
const LOOK_SPAN = 0.7;
/** A breath: seconds at mass 1, growing with the fourth root of mass (as heart rates slow). */
const BREATH_S = 2.4;
const BREATH_MASS_EXPONENT = 0.25;

export type Mode = "travel" | "stroll" | "pause";

export interface Motion {
  /** Where the sim says the animal is, in cells. */
  anchor: Point;
  mode: Mode;
  /** Where it is walking to (travel, stroll). */
  goal: Point;
  /** Seconds left of a pause. */
  timer: number;
  /** The heading it turns its head toward while it pauses. */
  look: number;
  /** The heading it had when the pause began: it looks about either side of it. */
  facing: number;
  /** The side it last turned aside to round what was in its way (1 or -1), 0 for none. */
  side: number;
  /** No clear place was found near the anchor (`clearAnchor`): not looked for again until it moves. */
  hemmed: boolean;
}

/** What `drive` needs of the body. */
export interface Walker {
  head: Point;
  heading: number;
  /** Cells a second at its walking pace. */
  pace: number;
  /** Head to tail, cells. */
  length: number;
}

export function leash(length: number): number {
  return LEASH_BASE + LEASH_PER_LENGTH * length;
}

export function newMotion(anchor: Point, heading: number): Motion {
  return {
    anchor: { x: anchor.x, y: anchor.y },
    mode: "pause",
    goal: { x: anchor.x, y: anchor.y },
    timer: 0,
    look: heading,
    facing: heading,
    side: 0,
    hemmed: false,
  };
}

/** A new place from the sim. Returns true if the body must be put there at once (`snap`). */
export function reanchor(motion: Motion, walker: Walker, x: number, y: number): boolean {
  motion.anchor.x = x;
  motion.anchor.y = y;
  motion.hemmed = false;
  const far = Math.hypot(x - walker.head.x, y - walker.head.y);
  if (far > SNAP_CELLS) {
    walker.head.x = x;
    walker.head.y = y;
    pause(motion, walker.heading, 0);
    return true;
  }
  // On its way somewhere already, or now out of reach: it goes to the new place.
  if (motion.mode === "travel" || far > leash(walker.length)) travel(motion, x, y);
  return false;
}

/** Turn `from` toward `to` by at most `rate × dtS`; angles in radians. */
function turnToward(from: number, to: number, rate: number, dtS: number): number {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const most = rate * dtS;
  return from + Math.min(Math.max(difference, -most), most);
}

function travel(motion: Motion, x: number, y: number): void {
  motion.mode = "travel";
  motion.goal.x = x;
  motion.goal.y = y;
}

function pause(motion: Motion, heading: number, seconds: number): void {
  motion.mode = "pause";
  motion.timer = seconds;
  motion.facing = heading;
  motion.look = heading;
}

/**
 * Move the walker on by `dtS` seconds. `free` says whether the body can stand at a place;
 * `ground` whether the place itself is one it lives on (land, or water for a swimmer),
 * whatever stands there: where `ground` holds and `free` does not, a plant is in the way,
 * which a walk to the anchor goes round (R5). Returns the distance walked, in cells (for
 * what keeps time with steps, such as strokes).
 */
export function drive(
  motion: Motion,
  walker: Walker,
  dtS: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
  ground: (x: number, y: number) => boolean = free,
): number {
  const { head, length } = walker;
  const reach = leash(length);
  const fromAnchor = Math.hypot(head.x - motion.anchor.x, head.y - motion.anchor.y);
  // Wandered or pushed too far: back to where the sim has it.
  if (motion.mode !== "travel" && fromAnchor > reach) {
    travel(motion, motion.anchor.x, motion.anchor.y);
  }
  // Standing in a plant (one grew there, or it was put there): it walks out to its anchor,
  // if the anchor is clear and not where it stands already.
  if (
    motion.mode !== "travel" &&
    fromAnchor > ARRIVED_SHARE * length &&
    ground(head.x, head.y) &&
    !free(head.x, head.y) &&
    free(motion.anchor.x, motion.anchor.y)
  ) {
    travel(motion, motion.anchor.x, motion.anchor.y);
  }

  if (motion.mode === "pause") {
    motion.timer -= dtS;
    // Looking about: now and then a new direction near the one it faced.
    if (random() < dtS / 1.2) motion.look = motion.facing + (random() * 2 - 1) * LOOK_SPAN;
    walker.heading = turnToward(walker.heading, motion.look, LOOK_RATE, dtS);
    if (motion.timer <= 0) {
      if (random() < STROLL_CHANCE && chooseStroll(motion, walker.head, reach, random, free)) {
        motion.mode = "stroll";
      } else {
        pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
      }
    }
    return 0;
  }

  const dx = motion.goal.x - head.x;
  const dy = motion.goal.y - head.y;
  const left = Math.hypot(dx, dy);
  if (left <= ARRIVED_SHARE * length) {
    pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
    return 0;
  }
  const direct = Math.atan2(dy, dx);
  const way =
    motion.mode === "travel"
      ? steer(motion, head, direct, Math.min(STEER_AHEAD_SHARE * length, left), free, ground)
      : direct;
  // With no way round what is in its way, it goes straight on.
  const noWay = Number.isNaN(way);
  const toward = noWay ? direct : way;
  walker.heading = turnToward(walker.heading, toward, TURN_RATE, dtS);
  const behind = motion.mode === "travel" ? fromAnchor / reach : 0;
  const hurry = behind > HURRY_FROM_LEASHES ? Math.min(HURRY, behind / HURRY_FROM_LEASHES) : 1;
  const pace = walker.pace * (motion.mode === "stroll" ? STROLL_PACE : hurry);
  // Walk the way it faces, slowing while it still faces away from its goal.
  const facing = Math.max(0, Math.cos(toward - walker.heading));
  const stride = Math.min(pace * dtS * (0.25 + 0.75 * facing), left);
  const x = head.x + Math.cos(walker.heading) * stride;
  const y = head.y + Math.sin(walker.heading) * stride;
  // A stroll stops at what it cannot cross; going to where the sim has it never does.
  if (motion.mode === "stroll" && !free(x, y)) {
    pause(motion, walker.heading, PAUSE_MIN_S);
    return 0;
  }
  // Going there, it turns on the spot before it would step into a plant, if it has a way
  // round (R5) and is still turning to it; facing it, it walks on whatever is there.
  if (
    motion.mode === "travel" &&
    !noWay &&
    facing < TURNED &&
    ground(x, y) &&
    !free(x, y) &&
    free(head.x, head.y)
  ) {
    return 0;
  }
  head.x = x;
  head.y = y;
  return stride;
}

/**
 * The way to head for `toward` (radians), round a plant in the way `ahead` cells on: the
 * nearest heading either side that is free there, the side turned to last time first;
 * NaN if there is none. Only plants are walked round; across water or off it, it goes
 * straight on as before.
 */
function steer(
  motion: Motion,
  head: Point,
  toward: number,
  ahead: number,
  free: (x: number, y: number) => boolean,
  ground: (x: number, y: number) => boolean,
): number {
  const x = head.x + Math.cos(toward) * ahead;
  const y = head.y + Math.sin(toward) * ahead;
  if (free(x, y) || !ground(x, y)) {
    motion.side = 0;
    return toward;
  }
  const first = motion.side === 0 ? 1 : motion.side;
  for (let k = 1; k <= STEER_TRIES; k++) {
    for (let turn = 0; turn < 2; turn++) {
      const side = turn === 0 ? first : -first;
      const angle = toward + side * k * STEER_STEP;
      if (free(head.x + Math.cos(angle) * ahead, head.y + Math.sin(angle) * ahead)) {
        motion.side = side;
        return angle;
      }
    }
  }
  return Number.NaN;
}

/**
 * Put the anchor of `motion` on the nearest place `free` says the body can stand on (R5:
 * the sim may have an animal in a wood, where it is drawn beside a trunk, not on it), and
 * a walk to the anchor goes there instead. Returns false if none is near; it then stays,
 * and is not looked for again until the sim moves it.
 */
export function clearAnchor(
  motion: Motion,
  free: (x: number, y: number) => boolean,
  length: number,
): boolean {
  const { anchor } = motion;
  if (motion.hemmed || free(anchor.x, anchor.y)) return !motion.hemmed;
  for (let ring = CLEAR_STEP; ring <= CLEAR_REACH; ring += CLEAR_STEP) {
    for (let k = 0; k < CLEAR_ANGLES; k++) {
      const angle = (2 * Math.PI * k) / CLEAR_ANGLES;
      const x = anchor.x + Math.cos(angle) * ring;
      const y = anchor.y + Math.sin(angle) * ring;
      if (!free(x, y)) continue;
      const further = ring + CLEAR_BEYOND_SHARE * length;
      const fx = anchor.x + Math.cos(angle) * further;
      const fy = anchor.y + Math.sin(angle) * further;
      const room = free(fx, fy);
      anchor.x = room ? fx : x;
      anchor.y = room ? fy : y;
      if (motion.mode === "travel") travel(motion, anchor.x, anchor.y);
      return true;
    }
  }
  motion.hemmed = true;
  return false;
}

/**
 * Paused with its head clear and its body in a plant (R5), it strolls on a little, to the
 * first place ahead or nearly ahead that `free` says it can stand on.
 */
export function stepOut(
  motion: Motion,
  walker: Walker,
  free: (x: number, y: number) => boolean,
): void {
  if (motion.mode !== "pause") return;
  const { head, heading, length } = walker;
  const ahead = STEP_OUT_SHARE * length;
  for (let k = 0; k <= STEP_OUT_TRIES; k++) {
    for (let turn = 0; turn < (k === 0 ? 1 : 2); turn++) {
      const angle = heading + (turn === 0 ? k : -k) * STEER_STEP;
      const x = head.x + Math.cos(angle) * ahead;
      const y = head.y + Math.sin(angle) * ahead;
      if (!free(x, y)) continue;
      motion.mode = "stroll";
      motion.goal.x = x;
      motion.goal.y = y;
      return;
    }
  }
}

/** Pick a place within the leash that the body can stand on; false if none was found. */
function chooseStroll(
  motion: Motion,
  head: Point,
  reach: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
): boolean {
  for (let attempt = 0; attempt < STROLL_TRIES; attempt++) {
    const angle = random() * 2 * Math.PI;
    const distance = reach * Math.sqrt(random());
    const x = motion.anchor.x + Math.cos(angle) * distance;
    const y = motion.anchor.y + Math.sin(angle) * distance;
    // The goal and the way there clear (R5), so that it does not stop short at a bush.
    let clear = free(x, y);
    for (let k = 1; clear && k <= STROLL_CHECKS; k++) {
      const t = k / (STROLL_CHECKS + 1);
      clear = free(lerp(head.x, x, t), lerp(head.y, y, t));
    }
    if (clear) {
      motion.goal.x = x;
      motion.goal.y = y;
      return true;
    }
  }
  return false;
}

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Seconds a breath takes for an animal of `mass`. */
export function breathPeriod(mass: number): number {
  return BREATH_S * Math.max(mass, 1e-3) ** BREATH_MASS_EXPONENT;
}

/** How full its chest is at time `t` seconds, 0–1, starting from `offset` (0–1) into a breath. */
export function breath(t: number, mass: number, offset = 0): number {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / breathPeriod(mass) + offset));
}
