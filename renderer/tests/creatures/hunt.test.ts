import { describe, expect, it } from "vitest";
import type { Point } from "../../src/creatures/chain";
import {
  COURT_GAP_CELLS,
  courtLean,
  FAMILY_NEAR_CELLS,
  trailSpot,
} from "../../src/creatures/family";
import { CHASE_FARTHEST, LUNGE_S, chase, lunge, strikeAfter } from "../../src/creatures/hunting";

describe("a hunter's run", () => {
  it("is not run to prey too far off, nor by a hunter that cannot walk", () => {
    expect(chase(CHASE_FARTHEST + 0.01, 0.6)).toBeNull();
    expect(chase(2, 0)).toBeNull();
    expect(chase(CHASE_FARTHEST, 0.6)).not.toBeNull();
  });

  it("is brief whatever the way, and always quicker than walking", () => {
    for (const distance of [0, 0.1, 0.5, 1, 2, 4, 8, 12]) {
      for (const pace of [0.2, 0.6, 1.5]) {
        const run = chase(distance, pace);
        expect(run).not.toBeNull();
        if (run === null) continue;
        expect(run.run).toBeGreaterThanOrEqual(0.4);
        expect(run.run).toBeLessThanOrEqual(1.2);
        expect(run.speed).toBeGreaterThanOrEqual(2.5);
        // It covers the way in its run.
        expect(run.run * run.speed * pace).toBeGreaterThanOrEqual(distance - 1e-9);
      }
    }
  });

  it("runs faster the further it has to go in its brief run", () => {
    const near = chase(2, 0.6);
    const far = chase(8, 0.6);
    expect(far?.speed ?? 0).toBeGreaterThan(near?.speed ?? Infinity);
  });

  it("strikes during its spring, just after its run", () => {
    expect(strikeAfter(1)).toBeGreaterThan(1);
    expect(strikeAfter(1)).toBeLessThan(1 + LUNGE_S);
  });

  it("springs quicker and quicker to the prey, thrust furthest at the strike, then drawn back", () => {
    expect(lunge(0)).toEqual({ travel: 0, stretch: 0 });
    let travel = 0;
    let stretch = 0;
    let most = { share: 0, stretch: 0 };
    for (let share = 0; share <= 1.0001; share += 0.01) {
      const now = lunge(share);
      // It never goes back toward where it sprang from.
      expect(now.travel).toBeGreaterThanOrEqual(travel - 1e-12);
      expect(now.travel).toBeLessThanOrEqual(1);
      expect(now.stretch).toBeGreaterThanOrEqual(0);
      expect(now.stretch).toBeLessThanOrEqual(1);
      // No jumps: it moves smoothly.
      expect(Math.abs(now.stretch - stretch)).toBeLessThan(0.05);
      if (now.stretch > most.stretch) most = { share, stretch: now.stretch };
      travel = now.travel;
      stretch = now.stretch;
    }
    expect(lunge(0.45)).toEqual({ travel: 1, stretch: 1 });
    expect(most.share).toBeCloseTo(0.45, 1);
    expect(lunge(1).stretch).toBeCloseTo(0);
    // Quicker and quicker: less of the way in its first half than its second.
    expect(lunge(0.225).travel).toBeLessThan(0.5);
  });
});

describe("a young one trailing its mother", () => {
  // A mother facing east: head at x = 2, tail at x = 0.
  const mother: Point[] = [
    { x: 2, y: 5 },
    { x: 1, y: 5 },
    { x: 0, y: 5 },
  ];
  const radii = [0.2, 0.3, 0.1];

  it("keeps behind her tail, beyond both their bodies, and to one side", () => {
    const left = { x: 0, y: 0 };
    const right = { x: 0, y: 0 };
    expect(trailSpot(mother, radii, 0.1, 1, left)).toBe(true);
    expect(trailSpot(mother, radii, 0.1, -1, right)).toBe(true);
    // Behind the tail by its radius and the young one's and a gap.
    expect(left.x).toBeCloseTo(0 - (0.1 + 0.1 + 0.3));
    expect(right.x).toBeCloseTo(left.x);
    // To either side by a share of her widest radius, mirrored.
    expect(left.y - 5).toBeCloseTo(0.8 * 0.3);
    expect(right.y - 5).toBeCloseTo(-0.8 * 0.3);
    // Well within the distance at which a young one trails at all.
    expect(Math.hypot(left.x - 0, left.y - 5)).toBeLessThan(FAMILY_NEAR_CELLS);
  });

  it("turns with her: the spot is behind whichever way she faces", () => {
    const north: Point[] = mother.map(({ x }) => ({ x: 5, y: 5 - x }));
    const spot = { x: 0, y: 0 };
    trailSpot(north, radii, 0.1, 1, spot);
    // She faces −y (her head at y = 3), so behind her is +y, past her tail at y = 5.
    expect(spot.y).toBeCloseTo(5 + 0.5);
  });

  it("has no spot behind a body of no length", () => {
    const out = { x: 7, y: 7 };
    expect(trailSpot([], [], 0.1, 1, out)).toBe(false);
    expect(trailSpot([{ x: 1, y: 1 }], [0.2], 0.1, 1, out)).toBe(false);
    expect(
      trailSpot(
        [
          { x: 1, y: 1 },
          { x: 1, y: 1 },
        ],
        [0.2, 0.2],
        0.1,
        1,
        out,
      ),
    ).toBe(false);
    expect(out).toEqual({ x: 7, y: 7 });
  });
});

describe("a pair touching heads before a birth", () => {
  it("leans in only during the touch, meeting halfway at most", () => {
    const from = 1;
    const lasts = 2.4;
    expect(courtLean(0, from, lasts)).toBe(0);
    expect(courtLean(from, from, lasts)).toBe(0);
    expect(courtLean(lasts, from, lasts)).toBe(0);
    expect(courtLean(lasts + 1, from, lasts)).toBe(0);
    let most = 0;
    let before = 0;
    for (let age = from; age <= lasts; age += 0.01) {
      const lean = courtLean(age, from, lasts);
      expect(lean).toBeGreaterThanOrEqual(0);
      expect(lean).toBeLessThanOrEqual(0.5);
      expect(Math.abs(lean - before)).toBeLessThan(0.05);
      most = Math.max(most, lean);
      before = lean;
    }
    // Held, heads together, through the middle of the touch.
    expect(most).toBeCloseTo(0.5);
    expect(courtLean((from + lasts) / 2, from, lasts)).toBeCloseTo(0.5);
  });

  it("keeps the mate's head a small gap from hers", () => {
    expect(COURT_GAP_CELLS).toBeGreaterThan(0);
    expect(COURT_GAP_CELLS).toBeLessThan(1);
  });
});
