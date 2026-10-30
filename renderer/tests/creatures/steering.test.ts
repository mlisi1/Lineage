import { describe, expect, it } from "vitest";
import {
  followChain,
  neckDirection,
  pivot,
  stiffness,
  withinTurn,
  type Point,
} from "../../src/creatures/chain";
import {
  clearAnchor,
  drive,
  hurries,
  leash,
  newMotion,
  reanchor,
  route,
  stepOut,
  trail,
  type Motion,
  type Walker,
} from "../../src/creatures/motion";
import type { Kind } from "../../src/creatures/body";
import { mulberry32 } from "../../src/rng";

const STEP_S = 1 / 30;
const everywhere = (): boolean => true;
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Clear of round bushes, each (x, y, radius) in cells. */
function amongBushes(...bushes: [number, number, number][]): (x: number, y: number) => boolean {
  return (x, y) => bushes.every(([bx, by, r]) => Math.hypot(x - bx, y - by) >= r);
}

function animal(x = 10, y = 10, heading = 0): { motion: Motion; walker: Walker } {
  const walker: Walker = { head: { x, y }, heading, pace: 0.6, length: 0.8 };
  return { motion: newMotion({ x, y }, heading), walker };
}

/** The signed angle (radians) from `a` to `b`, in (−π, π]. */
function turnBetween(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/** The way each segment points, head first: from each joint to the one in front. */
function segmentAngles(joints: readonly Point[]): number[] {
  const angles: number[] = [];
  for (let i = 1; i < joints.length; i++) {
    const lead = joints[i - 1] as Point;
    const joint = joints[i] as Point;
    angles.push(Math.atan2(lead.y - joint.y, lead.x - joint.x));
  }
  return angles;
}

describe("a way round the plants", () => {
  it("goes straight to a goal in sight", () => {
    expect(route({ x: 1, y: 1 }, { x: 4, y: 2 }, everywhere)).toEqual([{ x: 4, y: 2 }]);
  });

  it("goes round a bush in the way, every leg of it clear, and ends at the goal", () => {
    const free = amongBushes([5, 5, 1]);
    const way = route({ x: 3, y: 5 }, { x: 7, y: 5 }, free);
    expect(way).not.toBeNull();
    const places = [{ x: 3, y: 5 }, ...(way ?? [])];
    expect(places[places.length - 1]).toEqual({ x: 7, y: 5 });
    for (let k = 1; k < places.length; k++) {
      const a = places[k - 1] as Point;
      const b = places[k] as Point;
      for (let t = 0; t <= 1; t += 0.02) {
        expect(free(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)).toBe(true);
      }
    }
    // Pulled straight: a few places to pass, not one per step of the grid.
    expect(places.length).toBeLessThan(6);
  });

  it("ends beside a bush when the goal is inside it", () => {
    const free = amongBushes([5, 5, 0.6]);
    const way = route({ x: 2, y: 5 }, { x: 5, y: 5 }, free);
    const end = way?.[way.length - 1];
    expect(end).toBeDefined();
    expect(free((end as Point).x, (end as Point).y)).toBe(true);
    expect(distance(end as Point, { x: 5, y: 5 })).toBeLessThan(0.6 + 0.3);
  });

  it("finds no way into a walled pen, nor round a long way off", () => {
    // A ring of hedge round (5, 5): nothing gets in or out.
    const pen = (x: number, y: number): boolean => {
      const r = Math.hypot(x - 5, y - 5);
      return r < 1.5 || r > 2;
    };
    expect(route({ x: 9, y: 5 }, { x: 5, y: 5 }, pen)).toBeNull();
    // More than eight cells off, with something in the way: not planned.
    const free = amongBushes([10, 5, 1]);
    expect(route({ x: 1, y: 5 }, { x: 19, y: 5 }, free)).toBeNull();
  });
});

describe("walking to where the sim has it among trees and bushes", () => {
  it("walks round a bush in its way instead of through it, and gets there", () => {
    const free = amongBushes([12, 10, 0.6]);
    const { motion, walker } = animal(10, 10);
    reanchor(motion, walker, 14, 10);
    const random = mulberry32(3);
    let inside = 0;
    for (let t = 0; t < 20; t += STEP_S) {
      drive(motion, walker, STEP_S, random, free, everywhere);
      if (!free(walker.head.x, walker.head.y)) inside += 1;
    }
    expect(inside).toBe(0);
    expect(distance(walker.head, { x: 14, y: 10 })).toBeLessThanOrEqual(leash(walker.length));
  });

  it("walks out of a plant it stands in, to its anchor", () => {
    const free = amongBushes([10, 10, 0.4]);
    const { motion, walker } = animal(10, 10);
    motion.anchor.x = 11.5;
    const random = mulberry32(4);
    drive(motion, walker, STEP_S, random, free, everywhere);
    expect(motion.mode).toBe("travel");
    for (let t = 0; t < 10; t += STEP_S) drive(motion, walker, STEP_S, random, free, everywhere);
    expect(free(walker.head.x, walker.head.y)).toBe(true);
  });

  it("strolls only where the way there is clear", () => {
    // A wall of bushes at x = 10.6 (the anchor is just west of it): no stroll crosses it.
    const free = (x: number): boolean => Math.abs(x - 10.6) > 0.1;
    const { motion, walker } = animal(10.2, 10);
    const random = mulberry32(5);
    for (let t = 0; t < 120; t += STEP_S) {
      drive(motion, walker, STEP_S, random, free, everywhere);
      expect(walker.head.x).toBeLessThan(10.5);
    }
  });

  it("says it hurries only while travelling far behind", () => {
    const { motion, walker } = animal(10, 10);
    expect(hurries(motion, walker.head, walker.length)).toBe(false);
    reanchor(motion, walker, 13, 10);
    expect(hurries(motion, walker.head, walker.length)).toBe(true);
    reanchor(motion, walker, 10.2, 10);
    expect(hurries(motion, walker.head, walker.length)).toBe(false);
  });
});

describe("an anchor in a plant", () => {
  it("is left where it is when the place is clear", () => {
    const motion = newMotion({ x: 3, y: 3 }, 0);
    expect(clearAnchor(motion, everywhere, 1)).toBe(true);
    expect(motion.anchor).toEqual({ x: 3, y: 3 });
  });

  it("moves to the nearest clear place, and on past it to leave room for the body", () => {
    const free = amongBushes([3, 3, 0.5]);
    const motion = newMotion({ x: 3, y: 3 }, 0);
    expect(clearAnchor(motion, free, 1)).toBe(true);
    expect(free(motion.anchor.x, motion.anchor.y)).toBe(true);
    // The first clear ring is at 0.56 cells; 0.7 of the body's length further out.
    expect(distance(motion.anchor, { x: 3, y: 3 })).toBeCloseTo(0.56 + 0.7, 5);
  });

  it("stops short of a second plant beyond the first clear place", () => {
    // A bush, and right beyond its east edge another: the anchor stays in the gap.
    const free = (x: number, y: number): boolean => Math.abs(y - 3) > 2 || (x > 3.5 && x < 3.8);
    const motion = newMotion({ x: 3, y: 3 }, 0);
    expect(clearAnchor(motion, free, 1)).toBe(true);
    expect(motion.anchor.x).toBeGreaterThan(3.5);
    expect(motion.anchor.x).toBeLessThan(3.8);
  });

  it("makes a walk under way go to the new anchor", () => {
    const free = amongBushes([3, 3, 0.5]);
    const { motion, walker } = animal(0, 3);
    reanchor(motion, walker, 3, 3);
    expect(motion.mode).toBe("travel");
    clearAnchor(motion, free, walker.length);
    expect(motion.goal).toEqual(motion.anchor);
  });

  it("gives up when hemmed in, and does not look again until the sim moves it", () => {
    let asked = 0;
    const nowhere = (): boolean => {
      asked += 1;
      return false;
    };
    const { motion, walker } = animal(3, 3);
    expect(clearAnchor(motion, nowhere, 1)).toBe(false);
    expect(motion.hemmed).toBe(true);
    asked = 0;
    expect(clearAnchor(motion, nowhere, 1)).toBe(false);
    expect(asked).toBe(0);
    reanchor(motion, walker, 3.1, 3);
    expect(motion.hemmed).toBe(false);
  });
});

describe("stepping out of a plant behind it", () => {
  it("strolls on a little straight ahead when it can", () => {
    const { motion, walker } = animal(5, 5, 0);
    stepOut(motion, walker, everywhere);
    expect(motion.mode).toBe("stroll");
    expect(motion.goal.x).toBeCloseTo(5 + 0.6 * walker.length);
    expect(motion.goal.y).toBeCloseTo(5);
  });

  it("turns aside when straight ahead is blocked", () => {
    const { motion, walker } = animal(5, 5, 0);
    const free = amongBushes([5.48, 5, 0.1]);
    stepOut(motion, walker, free);
    expect(motion.mode).toBe("stroll");
    expect(free(motion.goal.x, motion.goal.y)).toBe(true);
    expect(Math.abs(motion.goal.y - 5)).toBeGreaterThan(0.05);
  });

  it("does nothing unless it is standing still", () => {
    const { motion, walker } = animal(5, 5, 0);
    reanchor(motion, walker, 8, 5);
    stepOut(motion, walker, everywhere);
    expect(motion.mode).toBe("travel");
  });
});

describe("a young one trailing", () => {
  it("keeps the place it trails to within its leash of where the sim has it", () => {
    const motion = newMotion({ x: 10, y: 10 }, 0);
    trail(motion, 0.8, 10.2, 10.1);
    expect(motion.following).toBe(true);
    expect(motion.follow).toEqual({ x: 10.2, y: 10.1 });
    // Its mother far off: the place is drawn in to 0.85 of its leash, toward her.
    trail(motion, 0.8, 20, 10);
    expect(motion.follow.y).toBeCloseTo(10);
    expect(motion.follow.x - 10).toBeCloseTo(0.85 * leash(0.8));
  });

  it("walks after the place it trails to, and stays within its leash", () => {
    const { motion, walker } = animal(10, 10);
    const random = mulberry32(6);
    const reach = leash(walker.length);
    // Its mother walks slowly east and back.
    for (let t = 0; t < 30; t += STEP_S) {
      const mother = 10 + 0.4 * Math.sin(t / 3);
      trail(motion, walker.length, mother, 10.2);
      drive(motion, walker, STEP_S, random, everywhere);
      expect(distance(walker.head, motion.anchor)).toBeLessThanOrEqual(reach + 1e-9);
    }
    // It ends near her (where it keeps to), not wherever it strolled.
    expect(distance(walker.head, motion.follow)).toBeLessThan(walker.length);
  });

  it("trots to catch up when left well behind", () => {
    const { motion, walker } = animal(10, 10);
    // Where the sim has it is within its leash; its mother well beyond.
    motion.anchor.x = 10.8;
    trail(motion, walker.length, 12, 10);
    walker.heading = 0;
    const random = mulberry32(7);
    drive(motion, walker, STEP_S, random, everywhere);
    const stride = drive(motion, walker, STEP_S, random, everywhere);
    // Faster than it ever strolls on its own, faster than its walking pace.
    expect(stride / STEP_S).toBeGreaterThan(walker.pace * 1.2);
  });
});

describe("a body that bends only so far", () => {
  it("lets worms and snakes curl and keeps the shelled and many-legged stiff", () => {
    const joints = 8;
    const whole = (kind: Kind | "chain"): number =>
      stiffness(kind, joints, 0.2).bend * (joints - 2);
    expect(whole("snake")).toBeCloseTo(3.0);
    expect(whole("worm")).toBeGreaterThan(whole("fish"));
    expect(whole("lizard")).toBeGreaterThan(whole("beast"));
    expect(whole("beast")).toBeGreaterThan(whole("tortoise"));
    expect(whole("crab")).toBeLessThan(0.5);
  });

  it("turns the short and stiff on the spot, the others on a circle", () => {
    for (const kind of ["beetle", "tortoise", "crab", "spider", "insect", "hopper"] as const) {
      expect(stiffness(kind, 5, 0.2)).toMatchObject({ pivots: true, turning: 0 });
    }
    const lizard = stiffness("lizard", 5, 0.2);
    expect(lizard.pivots).toBe(false);
    // The tighter the neck may turn, the smaller the circle; a longer step, a wider one.
    expect(lizard.turning).toBeCloseTo(0.2 / Math.sin(lizard.neck));
    expect(stiffness("lizard", 5, 0.4).turning).toBeGreaterThan(lizard.turning);
  });

  it("keeps a heading within its limit of where the body points, either way round", () => {
    expect(withinTurn(0.3, 0, 0.6)).toBeCloseTo(0.3);
    expect(withinTurn(2, 0, 0.6)).toBeCloseTo(0.6);
    expect(withinTurn(-2, 0, 0.6)).toBeCloseTo(-0.6);
    // Across the wrap at ±π, the short way round.
    expect(withinTurn(-3, 3, 0.6)).toBeCloseTo(3 + (2 * Math.PI - 6));
    expect(withinTurn(-3, 3, 0.1)).toBeCloseTo(3.1);
  });

  it("never folds through itself when the head turns right round", () => {
    const kinds: (Kind | "chain")[] = ["snake", "lizard", "beast", "beetle", "fish"];
    for (const kind of kinds) {
      const stiff = stiffness(kind, 8, 0.3);
      const joints: Point[] = Array.from({ length: 8 }, (_, i) => ({ x: -0.3 * i, y: 0 }));
      // The head swings back on itself in a tight half circle.
      let heading = 0;
      for (let step = 0; step < 60; step++) {
        heading += Math.PI / 60;
        const head = joints[0] as Point;
        head.x += Math.cos(heading) * 0.02;
        head.y += Math.sin(heading) * 0.02;
        followChain(joints, 0.3, stiff, heading);
        const angles = segmentAngles(joints);
        expect(Math.abs(turnBetween(angles[0] as number, heading))).toBeLessThanOrEqual(
          stiff.neck + 1e-6,
        );
        for (let i = 1; i < angles.length; i++) {
          expect(
            Math.abs(turnBetween(angles[i] as number, angles[i - 1] as number)),
          ).toBeLessThanOrEqual(stiff.bend + 1e-6);
        }
        for (let i = 1; i < joints.length; i++) {
          expect(distance(joints[i] as Point, joints[i - 1] as Point)).toBeCloseTo(0.3);
        }
      }
    }
  });

  it("straightens a body bent too far over a moment, not at once", () => {
    const stiff = stiffness("beast", 6, 0.3);
    // A body curled into a right angle at its middle.
    const bent = (): Point[] => [
      { x: 0, y: 0 },
      { x: -0.3, y: 0 },
      { x: -0.6, y: 0 },
      { x: -0.6, y: 0.3 },
      { x: -0.6, y: 0.6 },
      { x: -0.6, y: 0.9 },
    ];
    const atOnce = bent();
    followChain(atOnce, 0.3, stiff, 0);
    const eased = bent();
    followChain(eased, 0.3, stiff, 0, 1 / 30);
    const tail = (joints: Point[]): Point => joints[joints.length - 1] as Point;
    // At once it is within its limits; one frame on it is only part of the way there.
    expect(distance(tail(eased), { x: -0.6, y: 0.9 })).toBeGreaterThan(0.01);
    expect(distance(tail(eased), tail(atOnce))).toBeGreaterThan(0.01);
  });

  it("turns a stiff body on the spot about its middle, the head with it", () => {
    const joints: Point[] = Array.from({ length: 5 }, (_, i) => ({ x: 2 - 0.25 * i, y: 1 }));
    const middle = { ...(joints[2] as Point) };
    pivot(joints, Math.PI / 2, 0.6);
    expect(joints[2]).toEqual(middle);
    expect(Math.abs(turnBetween(neckDirection(joints, 0), Math.PI / 2))).toBeCloseTo(0.6);
    for (let i = 1; i < joints.length; i++) {
      expect(distance(joints[i] as Point, joints[i - 1] as Point)).toBeCloseTo(0.25);
    }
    // Within its neck already: not turned.
    const before = joints.map((joint) => ({ ...joint }));
    pivot(joints, neckDirection(joints, 0) + 0.2, 0.6);
    expect(joints).toEqual(before);
  });

  it("walks with its head kept within its neck's turn of its body", () => {
    const { motion, walker } = animal(10, 10, 0);
    walker.neck = 0;
    walker.bend = 0.6;
    reanchor(motion, walker, 6, 10);
    const random = mulberry32(8);
    for (let t = 0; t < 2; t += STEP_S) {
      drive(motion, walker, STEP_S, random, everywhere);
      expect(Math.abs(turnBetween(0, walker.heading))).toBeLessThanOrEqual(0.6 + 1e-9);
    }
  });

  it("does not stroll to a place inside the circle it turns on", () => {
    const { motion, walker } = animal(10, 10, 0);
    walker.turning = 1;
    motion.mode = "stroll";
    // Right beside it, a quarter turn to its left: inside its left turning circle.
    motion.goal.x = 10;
    motion.goal.y = 10.6;
    expect(drive(motion, walker, STEP_S, mulberry32(9), everywhere)).toBe(0);
    expect(motion.mode).toBe("pause");
  });
});
