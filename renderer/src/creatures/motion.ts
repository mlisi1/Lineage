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
import { withinTurn, type Point } from "./chain";

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
}

/** What `drive` needs of the body. */
export interface Walker {
  head: Point;
  heading: number;
  /** Cells a second at its walking pace. */
  pace: number;
  /** Head to tail, cells. */
  length: number;
  /**
   * A body that bends only so far: which way the body behind the head points (radians),
   * how far the head may turn from it, and the tightest circle (radius, cells) it can walk
   * so. Left out, the head turns as it likes.
   */
  neck?: number;
  bend?: number;
  turning?: number;
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
  };
}

/** A new place from the sim. Returns true if the body must be put there at once (`snap`). */
export function reanchor(motion: Motion, walker: Walker, x: number, y: number): boolean {
  motion.anchor.x = x;
  motion.anchor.y = y;
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
 * Move the walker on by `dtS` seconds. `free` says whether the body can stand at a place.
 * Returns the distance walked, in cells (for what keeps time with steps, such as strokes).
 */
export function drive(
  motion: Motion,
  walker: Walker,
  dtS: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
): number {
  const { head, length } = walker;
  const reach = leash(length);
  const fromAnchor = Math.hypot(head.x - motion.anchor.x, head.y - motion.anchor.y);
  // Wandered or pushed too far: back to where the sim has it.
  if (motion.mode !== "travel" && fromAnchor > reach) {
    travel(motion, motion.anchor.x, motion.anchor.y);
  }

  if (motion.mode === "pause") {
    motion.timer -= dtS;
    // Looking about: now and then a new direction near the one it faced.
    if (random() < dtS / 1.2) motion.look = motion.facing + (random() * 2 - 1) * LOOK_SPAN;
    // Only the head turns: the body stays as it stood.
    walker.heading = keep(walker, turnToward(walker.heading, motion.look, LOOK_RATE, dtS));
    if (motion.timer <= 0) {
      if (random() < STROLL_CHANCE && chooseStroll(motion, reach, random, free)) {
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
  // A place inside the circles it turns on cannot be reached by turning: a stroll stops
  // short of it, a walk to where the sim has it goes on ahead until it can turn there.
  const within = inside(walker, motion.goal);
  if (within && motion.mode === "stroll") {
    pause(motion, walker.heading, lerp(PAUSE_MIN_S, PAUSE_MAX_S, random()));
    return 0;
  }
  if (!within) {
    walker.heading = keep(walker, turnToward(walker.heading, Math.atan2(dy, dx), TURN_RATE, dtS));
  }
  const behind = motion.mode === "travel" ? fromAnchor / reach : 0;
  const hurry = behind > HURRY_FROM_LEASHES ? Math.min(HURRY, behind / HURRY_FROM_LEASHES) : 1;
  const pace = walker.pace * (motion.mode === "stroll" ? STROLL_PACE : hurry);
  // Walk the way it faces, slowing while it still faces away from its goal.
  const facing = Math.max(0, Math.cos(Math.atan2(dy, dx) - walker.heading));
  const stride = Math.min(pace * dtS * (0.25 + 0.75 * facing), left);
  const x = head.x + Math.cos(walker.heading) * stride;
  const y = head.y + Math.sin(walker.heading) * stride;
  // A stroll stops at what it cannot cross; going to where the sim has it never does.
  if (motion.mode === "stroll" && !free(x, y)) {
    pause(motion, walker.heading, PAUSE_MIN_S);
    return 0;
  }
  head.x = x;
  head.y = y;
  return stride;
}

/** `heading`, as far round as the walker's neck lets it turn from its body. */
function keep(walker: Walker, heading: number): number {
  const { neck, bend } = walker;
  return neck === undefined || bend === undefined ? heading : withinTurn(heading, neck, bend);
}

/** Whether `goal` lies inside one of the two circles the walker turns on at its tightest. */
function inside(walker: Walker, goal: Point): boolean {
  const radius = walker.turning ?? 0;
  if (radius <= 0) return false;
  const { head, heading } = walker;
  // The circles' centres lie to either side of the head, `radius` away.
  const sideX = -Math.sin(heading) * radius;
  const sideY = Math.cos(heading) * radius;
  const leftX = goal.x - head.x - sideX;
  const leftY = goal.y - head.y - sideY;
  const rightX = goal.x - head.x + sideX;
  const rightY = goal.y - head.y + sideY;
  const squared = radius * radius;
  return leftX * leftX + leftY * leftY < squared || rightX * rightX + rightY * rightY < squared;
}

/** Pick a place within the leash that the body can stand on; false if none was found. */
function chooseStroll(
  motion: Motion,
  reach: number,
  random: () => number,
  free: (x: number, y: number) => boolean,
): boolean {
  for (let attempt = 0; attempt < STROLL_TRIES; attempt++) {
    const angle = random() * 2 * Math.PI;
    const distance = reach * Math.sqrt(random());
    const x = motion.anchor.x + Math.cos(angle) * distance;
    const y = motion.anchor.y + Math.sin(angle) * distance;
    if (free(x, y)) {
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
