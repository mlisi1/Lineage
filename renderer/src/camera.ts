/**
 * Where the camera is, and how it moves (R3): a point in cells pulled toward where it
 * wants to be by a damped spring, so that it starts gently, eases in and, when the
 * subject turns, swings a little past before it settles, as a hand-held camera would. The
 * director (`director.ts`) says where it wants to be; this says how it gets there.
 *
 * Pure: no PixiJS, no clock. Fixed sub-steps make it move the same at 30 fps as at 60.
 */
import type { CellRect } from "./terrain/land";

export interface Point {
  x: number;
  y: number;
}

export interface SpringOptions {
  /** Seconds the spring would take to swing once, undamped: how lazy the camera is. */
  periodS: number;
  /** 1 is critically damped (no swing past); below it the camera overshoots a little. */
  damping: number;
  /** Cells a second the camera never moves faster than. */
  maxSpeed: number;
}

/** Seconds of one sub-step: small enough to be stable for any period used here. */
const SUB_STEP_S = 1 / 240;
/** A frame longer than this (the page was hidden) is taken as this long. */
const LONGEST_FRAME_S = 0.25;

/** A point that follows a moving target on a damped spring. */
export class Spring {
  readonly at: Point;
  readonly velocity: Point = { x: 0, y: 0 };
  private left = 0;

  constructor(
    at: Point,
    public options: SpringOptions,
  ) {
    this.at = { x: at.x, y: at.y };
  }

  /** Be at `at`, still: a cut. */
  snap(at: Point): void {
    this.at.x = at.x;
    this.at.y = at.y;
    this.velocity.x = 0;
    this.velocity.y = 0;
  }

  /** Move on by `dtS` seconds toward `target`. */
  step(target: Point, dtS: number): void {
    const { periodS, damping, maxSpeed } = this.options;
    const omega = (2 * Math.PI) / periodS;
    this.left += Math.min(Math.max(dtS, 0), LONGEST_FRAME_S);
    while (this.left >= SUB_STEP_S) {
      this.left -= SUB_STEP_S;
      // Semi-implicit Euler: the velocity first, then the position from it.
      this.velocity.x +=
        (omega * omega * (target.x - this.at.x) - 2 * damping * omega * this.velocity.x) *
        SUB_STEP_S;
      this.velocity.y +=
        (omega * omega * (target.y - this.at.y) - 2 * damping * omega * this.velocity.y) *
        SUB_STEP_S;
      const speed = Math.hypot(this.velocity.x, this.velocity.y);
      if (speed > maxSpeed) {
        this.velocity.x *= maxSpeed / speed;
        this.velocity.y *= maxSpeed / speed;
      }
      this.at.x += this.velocity.x * SUB_STEP_S;
      this.at.y += this.velocity.y * SUB_STEP_S;
    }
  }
}

/**
 * How fast something is going, smoothed: the camera leads a walking subject by its
 * velocity, and a raw frame-to-frame velocity would make it twitch with every step.
 */
export class Velocity {
  readonly value: Point = { x: 0, y: 0 };
  private last: Point | null = null;

  /** `smoothS`: seconds over which a change of speed is taken in. */
  constructor(private readonly smoothS: number) {}

  /** Forget the past: the subject changed, or was put somewhere new. */
  reset(): void {
    this.last = null;
    this.value.x = 0;
    this.value.y = 0;
  }

  update(at: Point, dtS: number): Point {
    if (this.last !== null && dtS > 0) {
      const share = 1 - Math.exp(-dtS / this.smoothS);
      this.value.x += ((at.x - this.last.x) / dtS - this.value.x) * share;
      this.value.y += ((at.y - this.last.y) / dtS - this.value.y) * share;
    }
    this.last = { x: at.x, y: at.y };
    return this.value;
  }
}

/**
 * Where the camera wants to be to keep `subject` framed: ahead of it by `leadS` seconds
 * of its `velocity`, but only once that is further than `deadZone` cells from where the
 * camera is. Within the dead zone the camera stays put, so an animal pottering about its
 * place does not drag the picture with every step.
 */
export function framing(
  camera: Point,
  subject: Point,
  velocity: Point,
  leadS: number,
  deadZone: number,
): Point {
  const aimX = subject.x + velocity.x * leadS;
  const aimY = subject.y + velocity.y * leadS;
  const dx = aimX - camera.x;
  const dy = aimY - camera.y;
  const off = Math.hypot(dx, dy);
  if (off <= deadZone) return { x: camera.x, y: camera.y };
  const share = 1 - deadZone / off;
  return { x: camera.x + dx * share, y: camera.y + dy * share };
}

/** The cells in sight with the view's middle at `centre`, `width` × `height` cells. */
export function sight(centre: Point, width: number, height: number): CellRect {
  return {
    x0: centre.x - width / 2,
    y0: centre.y - height / 2,
    x1: centre.x + width / 2,
    y1: centre.y + height / 2,
  };
}

/**
 * The nearest middle to `centre` from which a `width` × `height` view stays within a
 * world of `worldWidth` × `worldHeight` cells (the world's middle, on an axis the view
 * is larger than the world on).
 */
export function within(
  centre: Point,
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
): Point {
  const clamp = (value: number, half: number, size: number): number =>
    half * 2 >= size ? size / 2 : Math.min(Math.max(value, half), size - half);
  return {
    x: clamp(centre.x, width / 2, worldWidth),
    y: clamp(centre.y, height / 2, worldHeight),
  };
}
