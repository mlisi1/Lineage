import { describe, expect, it } from "vitest";
import {
  breath,
  breathPeriod,
  drive,
  leash,
  newMotion,
  reanchor,
  type Motion,
  type Walker,
} from "../../src/creatures/motion";
import { mulberry32 } from "../../src/rng";

const STEP_S = 1 / 30;
const everywhere = (): boolean => true;

function animal(x = 10, y = 10): { motion: Motion; walker: Walker } {
  const walker: Walker = { head: { x, y }, heading: 0, pace: 0.6, length: 0.8 };
  return { motion: newMotion({ x, y }, 0), walker };
}

/** Run for `seconds`, calling `each` after every step. */
function run(
  motion: Motion,
  walker: Walker,
  seconds: number,
  seed = 1,
  free: (x: number, y: number) => boolean = everywhere,
  each: (walked: number) => void = () => undefined,
): void {
  const random = mulberry32(seed);
  for (let t = 0; t < seconds; t += STEP_S) each(drive(motion, walker, STEP_S, random, free));
}

describe("life between sim ticks", () => {
  it("stays within its leash of where the sim has it, and does not stand frozen", () => {
    const { motion, walker } = animal();
    const reach = leash(walker.length);
    let walked = 0;
    let still = 0;
    let steps = 0;
    run(motion, walker, 120, 3, everywhere, (stride) => {
      const away = Math.hypot(walker.head.x - 10, walker.head.y - 10);
      expect(away).toBeLessThanOrEqual(reach + 1e-9);
      walked += stride;
      if (stride === 0) still += 1;
      steps += 1;
    });
    // Two minutes of life: it strolls some, and spends most of it at rest.
    expect(walked).toBeGreaterThan(2 * reach);
    expect(still / steps).toBeGreaterThan(0.5);
    expect(still / steps).toBeLessThan(0.95);
  });

  it("looks about while it pauses", () => {
    const { motion, walker } = animal();
    const headings = new Set<number>();
    run(motion, walker, 30, 5, everywhere, () => headings.add(Math.round(walker.heading * 10)));
    expect(headings.size).toBeGreaterThan(3);
  });

  it("walks to a new place from the sim, then lives there", () => {
    const { motion, walker } = animal();
    expect(reanchor(motion, walker, 14, 11)).toBe(false);
    expect(motion.mode).toBe("travel");
    let seconds = 0;
    run(motion, walker, 30, 7, everywhere, () => {
      if (motion.mode === "travel") seconds += STEP_S;
    });
    // About 4.1 cells at 0.6 cells a second, with some turning.
    expect(seconds).toBeGreaterThan(4.1 / 0.6 / 2);
    expect(seconds).toBeLessThan(15);
    const away = Math.hypot(walker.head.x - 14, walker.head.y - 11);
    expect(away).toBeLessThanOrEqual(leash(walker.length) + 1e-9);
  });

  it("hurries when far behind, and is put in place when too far to walk", () => {
    const near = animal();
    const far = animal();
    reanchor(near.motion, near.walker, 12, 10);
    reanchor(far.motion, far.walker, 19, 10);
    const random = mulberry32(1);
    const nearStep = drive(near.motion, near.walker, STEP_S, random, everywhere);
    const farStep = drive(far.motion, far.walker, STEP_S, random, everywhere);
    expect(farStep).toBeGreaterThan(nearStep * 1.5);

    const lost = animal();
    expect(reanchor(lost.motion, lost.walker, 40, 40)).toBe(true);
    expect(lost.walker.head).toEqual({ x: 40, y: 40 });
  });

  it("strolls only where its body can stand", () => {
    // Only water west of x = 10: a swimmer at the shore never strolls onto land.
    const { motion, walker } = animal();
    const water = (x: number): boolean => x <= 10;
    run(
      motion,
      walker,
      120,
      9,
      (x) => water(x),
      () => {
        expect(walker.head.x).toBeLessThanOrEqual(10 + 1e-9);
      },
    );
  });

  it("is the same every time from the same seed", () => {
    const a = animal();
    const b = animal();
    reanchor(a.motion, a.walker, 12, 12);
    reanchor(b.motion, b.walker, 12, 12);
    run(a.motion, a.walker, 40, 11);
    run(b.motion, b.walker, 40, 11);
    expect(a.walker).toEqual(b.walker);
  });

  it("breathes slower the heavier it is", () => {
    expect(breathPeriod(16)).toBeGreaterThan(breathPeriod(1));
    expect(breathPeriod(1)).toBeGreaterThan(breathPeriod(0.25));
    expect(breath(0, 1)).toBeCloseTo(0);
    expect(breath(breathPeriod(1) / 2, 1)).toBeCloseTo(1);
    for (let t = 0; t < 10; t += 0.37) {
      expect(breath(t, 3, 0.4)).toBeGreaterThanOrEqual(0);
      expect(breath(t, 3, 0.4)).toBeLessThanOrEqual(1);
    }
  });
});
