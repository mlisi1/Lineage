/** Procedural body motion: a chain of joints following a head, and two-bone legs. */

export interface Point {
  x: number;
  y: number;
}

/**
 * Chain follow: every joint is pulled to `spacing` behind the one before it. The first
 * joint is the head and stays where it is. This is what makes a body trail and bend.
 */
export function followChain(joints: readonly Point[], spacing: number): void {
  for (let i = 1; i < joints.length; i++) {
    const lead = joints[i - 1];
    const joint = joints[i];
    if (lead === undefined || joint === undefined) return;
    let dx = joint.x - lead.x;
    let dy = joint.y - lead.y;
    let distance = Math.hypot(dx, dy);
    if (distance < 1e-9) {
      // Sitting exactly on its leader: any direction will do.
      dx = -1;
      dy = 0;
      distance = 1;
    }
    joint.x = lead.x + (dx / distance) * spacing;
    joint.y = lead.y + (dy / distance) * spacing;
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
 * body's left.
 */
export function curl(joints: readonly Point[], spacing: number, heading: number): void {
  const head = joints[0];
  if (head === undefined || joints.length < 2) return;
  const length = spacing * (joints.length - 1);
  // Round enough that the body goes CURL_TURNS round, but never so tight that two joints
  // `spacing` apart would not fit on it.
  const radius = Math.max(length / (2 * Math.PI * CURL_TURNS), spacing / 2 + 1e-9);
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
