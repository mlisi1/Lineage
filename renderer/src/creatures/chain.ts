/** Procedural body motion: a chain of joints following a head, and two-bone legs. */
import type { Kind } from "./body";

export interface Point {
  x: number;
  y: number;
}

/** How a chain may bend: what `followChain` keeps it within, and what the head can turn. */
export interface Stiffness {
  /** How far (radians) the head may turn from the body behind it: looking about, or a turn begun. */
  neck: number;
  /** How far (radians) each joint further back may bend from the one in front. */
  bend: number;
  /**
   * The tightest circle (radius, cells) the head can walk with the neck turned as far as it
   * goes; 0 for a body that turns on the spot instead (`pivots`).
   */
  turning: number;
  /** A short, stiff body: it turns on the spot, about its middle, rather than walking round. */
  pivots: boolean;
}

/**
 * How far a body of each kind bends from head to tail (radians), all its joints together:
 * a worm, a snake or an eel curves round into a U, a lizard or a newt sweeps its tail, a
 * fish flexes, and the shelled, the short and the many-legged hardly bend at all. Shared
 * evenly among the joints, so that no part of the body comes round onto another.
 */
const BODY_BEND: Readonly<Record<Kind | "chain", number>> = {
  worm: 2.8,
  snake: 3.0,
  eel: 3.0,
  fish: 1.4,
  newt: 2.0,
  lizard: 2.0,
  beast: 1.0,
  hopper: 0.5,
  insect: 0.8,
  tortoise: 0.4,
  beetle: 0.45,
  spider: 0.4,
  crab: 0.3,
  chain: 2.4,
};
/**
 * The short and stiff turn on the spot, as a beetle or a tortoise does: walking round on
 * a circle wider than they are long would take them far from where they meant to go.
 */
const PIVOTS: ReadonlySet<Kind | "chain"> = new Set([
  "hopper",
  "insect",
  "tortoise",
  "beetle",
  "spider",
  "crab",
]);
/** How far (radians) any head turns from the body behind it: the looking about's span, nearly. */
const NECK_TURN = 0.6;
/** How fast (a share of what is left, a second) a body bent further than it may, as a torpid one waking, straightens. */
const STRAIGHTEN_RATE = 10;

/** The stiffness of a body of `kind` with `joints` joints `spacing` apart. */
export function stiffness(kind: Kind | "chain", joints: number, spacing: number): Stiffness {
  const pivots = PIVOTS.has(kind);
  return {
    neck: NECK_TURN,
    bend: BODY_BEND[kind] / Math.max(joints - 2, 1),
    turning: pivots ? 0 : spacing / Math.sin(NECK_TURN),
    pivots,
  };
}

/**
 * Turn the whole body on the spot, about its middle joint, as far as it takes for the
 * head's `heading` to be within `neck` (radians) of the body behind it. The head moves
 * with the rest: a body turning on the spot does not turn about its nose.
 */
export function pivot(joints: readonly Point[], heading: number, neck: number): void {
  const from = neckDirection(joints, heading);
  const turn = heading - withinTurn(heading, from, neck);
  const middle = joints[joints.length >> 1];
  if (turn === 0 || middle === undefined) return;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const cx = middle.x;
  const cy = middle.y;
  for (const joint of joints) {
    const dx = joint.x - cx;
    const dy = joint.y - cy;
    joint.x = cx + dx * cos - dy * sin;
    joint.y = cy + dx * sin + dy * cos;
  }
}

/** Which way the body behind the head points (radians): from the second joint to the head. */
export function neckDirection(joints: readonly Point[], heading: number): number {
  const head = joints[0];
  const neck = joints[1];
  if (head === undefined || neck === undefined) return heading;
  const dx = head.x - neck.x;
  const dy = head.y - neck.y;
  return dx === 0 && dy === 0 ? heading : Math.atan2(dy, dx);
}

/** `heading`, turned back if need be to within `limit` (radians) of `from`. */
export function withinTurn(heading: number, from: number, limit: number): number {
  const difference = Math.atan2(Math.sin(heading - from), Math.cos(heading - from));
  return from + Math.min(Math.max(difference, -limit), limit);
}

/**
 * Chain follow: every joint is pulled to `spacing` behind the one before it. The first
 * joint is the head and stays where it is. This is what makes a body trail and bend.
 *
 * With `stiff`, a joint is also kept from bending further than it may: the neck within
 * `stiff.neck` of `heading`, the joints behind within `stiff.bend` of the one in front. A
 * body bent further already (curled up asleep) straightens over the next `dtS` seconds at
 * `STRAIGHTEN_RATE` rather than at once; left out, at once.
 */
export function followChain(
  joints: readonly Point[],
  spacing: number,
  stiff?: Stiffness,
  heading = 0,
  dtS = Infinity,
): void {
  const ease = Math.min(STRAIGHTEN_RATE * dtS, 1);
  // The way the body points in front of the joint: the head's heading, then each segment's.
  let aheadX = Math.cos(heading);
  let aheadY = Math.sin(heading);
  for (let i = 1; i < joints.length; i++) {
    const lead = joints[i - 1];
    const joint = joints[i];
    if (lead === undefined || joint === undefined) return;
    let dx = joint.x - lead.x;
    let dy = joint.y - lead.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 1e-9) {
      // Sitting exactly on its leader: any direction will do.
      dx = -aheadX;
      dy = -aheadY;
      distance = 1;
    }
    // This segment's direction, from the joint to its leader.
    let ux = -dx / distance;
    let uy = -dy / distance;
    if (stiff !== undefined) {
      const limit = i === 1 ? stiff.neck : stiff.bend;
      const bend = Math.atan2(aheadX * uy - aheadY * ux, aheadX * ux + aheadY * uy);
      const over = Math.abs(bend) - limit;
      if (over > 0) {
        // Turn it back toward the one in front, all the way to its limit or by a share.
        const kept = Math.sign(bend) * (Math.abs(bend) - over * ease);
        const cos = Math.cos(kept);
        const sin = Math.sin(kept);
        ux = aheadX * cos - aheadY * sin;
        uy = aheadX * sin + aheadY * cos;
      }
    }
    joint.x = lead.x - ux * spacing;
    joint.y = lead.y - uy * spacing;
    aheadX = ux;
    aheadY = uy;
  }
}

/**
 * Two-bone leg: where the knee is, given hip and foot. `bend` picks which of the two
 * solutions (+1 or −1). A foot out of reach is treated as at full stretch, so the result
 * is always a point `upper` from the hip.
 */
export function solveKnee(
  hip: Point,
  foot: Point,
  upper: number,
  lower: number,
  bend: 1 | -1,
  out: Point,
): void {
  const dx = foot.x - hip.x;
  const dy = foot.y - hip.y;
  const reach = Math.hypot(dx, dy);
  const distance = Math.min(Math.max(reach, Math.abs(upper - lower) + 1e-6), upper + lower - 1e-6);
  const ux = reach > 1e-9 ? dx / reach : 1;
  const uy = reach > 1e-9 ? dy / reach : 0;
  // Distance from the hip, along the hip–foot line, to the foot of the knee's height.
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(upper * upper - along * along, 0));
  out.x = hip.x + ux * along - uy * height * bend;
  out.y = hip.y + uy * along + ux * height * bend;
}

/** A curled-up body goes this far round (in turns): a sleeping animal's coil. */
const CURL_TURNS = 0.85;

/**
 * Curl a chain up, as an animal lying torpid: the head stays where it is, facing
 * `heading`, and the joints follow it round a circle, `spacing` apart, curving to the
 * body's left; `turns` round (R5: a sleeper curls as far as its body bends).
 */
export function curl(
  joints: readonly Point[],
  spacing: number,
  heading: number,
  turns = CURL_TURNS,
): void {
  const head = joints[0];
  if (head === undefined || joints.length < 2) return;
  const length = spacing * (joints.length - 1);
  // Round enough that the body goes `turns` round, but never so tight that two joints
  // `spacing` apart would not fit on it.
  const radius = Math.max(length / (2 * Math.PI * Math.max(turns, 1e-3)), spacing / 2 + 1e-9);
  const step = 2 * Math.asin(spacing / (2 * radius));
  // The centre is to the head's left; going backward round it is going down the body.
  const cx = head.x - Math.sin(heading) * radius;
  const cy = head.y + Math.cos(heading) * radius;
  const start = Math.atan2(head.y - cy, head.x - cx);
  for (let i = 1; i < joints.length; i++) {
    const joint = joints[i];
    if (joint === undefined) continue;
    const angle = start - i * step;
    joint.x = cx + Math.cos(angle) * radius;
    joint.y = cy + Math.sin(angle) * radius;
  }
}
