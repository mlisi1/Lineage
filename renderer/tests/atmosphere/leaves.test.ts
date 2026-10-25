import { describe, expect, it } from "vitest";
import { Container, Sprite } from "pixi.js";
import { Leaves, type LeavesView } from "../../src/atmosphere/leaves";
import type { ViewName } from "../../src/landscape";
import type { Crown } from "../../src/plants/plants";
import type { ClockMessage } from "../../src/protocol";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

const TILE: Readonly<Record<ViewName, number>> = { map: 4, middle: 8, local: 32 };
const COLOURS = [0x8a3a1c, 0xc8642a, 0xe8a040] as const;

/** Plants with a broadleaf's crown on every cell `wood` says, four rows to the cell. */
function plantsOf(wood: (x: number, y: number) => boolean, height = 12, rowsPerCell = 4) {
  const guests = Array.from({ length: height * rowsPerCell }, () => new Container());
  return {
    guests,
    rowsPerCell,
    crownAt(x: number, y: number): Crown | undefined {
      if (x < 0 || y < 0 || !wood(Math.floor(x), Math.floor(y))) return undefined;
      return {
        half: 0.4,
        bottom: 0.9,
        top: 1.8,
        colours: COLOURS,
        x: Math.floor(x) + 0.5,
        y: Math.floor(y) + 0.9,
      };
    },
  };
}
const WOOD = plantsOf(() => true);

const frameOf = (view: ViewName, extra: Partial<LeavesView> = {}): LeavesView => ({
  view,
  cells: { x0: 0, y0: 0, x1: 16, y1: 10 },
  tile: TILE[view],
  plants: WOOD,
  wind: null,
  ending: false,
  ...extra,
});

const clock = (season: ClockMessage["season"], progress: number): ClockMessage => ({
  type: "clock",
  protocol: 1,
  t_ms: 0,
  date: "2026-10-01",
  season,
  season_progress: progress,
  day_of_year: 280,
  days_in_year: 365,
});

/** Leaves of `seed` in late autumn (or as `season` and `progress` say). */
function leavesIn(season: ClockMessage["season"] = "autumn", progress = 1, seed = 4): Leaves {
  const leaves = new Leaves(seed, new Container());
  leaves.receive(clock(season, progress));
  return leaves;
}

/** Run for `seconds`, a thirtieth at a time; the leaves out (falling and lying) at each step. */
function run(leaves: Leaves, frame: LeavesView | ((t: number) => LeavesView), seconds: number) {
  const out: number[] = [];
  for (let k = 0; k < seconds * 30; k++) {
    leaves.update(1 / 30, typeof frame === "function" ? frame(k / 30) : frame);
    const { falling, lying } = leaves.state;
    out.push(falling + lying);
  }
  return out;
}
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

/** The leaves' sprites shown among the plants' rows. */
const shown = (plants: { guests: readonly Container[] }): Sprite[] =>
  plants.guests.flatMap((row) =>
    row.children.filter((child): child is Sprite => child instanceof Sprite && child.visible),
  );

describe("autumn leaves (R5)", () => {
  it("come loose from the crowns in sight, a few at a time", () => {
    const counts = run(leavesIn(), frameOf("middle"), 30);
    expect(Math.max(...counts)).toBeGreaterThan(0);
    expect(Math.max(...counts)).toBeLessThanOrEqual(22);
    const near = run(leavesIn(), frameOf("local"), 30);
    expect(Math.max(...near)).toBeGreaterThan(0);
    expect(Math.max(...near)).toBeLessThanOrEqual(12);
  });

  it("fall only where a crown marks a broadleaf dropping its leaves", () => {
    const bare = plantsOf(() => false);
    expect(Math.max(...run(leavesIn(), frameOf("middle", { plants: bare }), 30))).toBe(0);
    expect(Math.max(...run(leavesIn(), frameOf("middle", { plants: null }), 30))).toBe(0);
  });

  it("do not fall on the map, nor while a world ends", () => {
    expect(Math.max(...run(leavesIn(), frameOf("map"), 30))).toBe(0);
    expect(Math.max(...run(leavesIn(), frameOf("middle", { ending: true }), 30))).toBe(0);
  });

  it("fall more late in autumn than early in it", () => {
    // A small view of a few trees, so that the pool is never full.
    const small = { x0: 0, y0: 0, x1: 4, y1: 3 };
    const early = mean(run(leavesIn("autumn", 0), frameOf("local", { cells: small }), 120));
    const late = mean(run(leavesIn("autumn", 1), frameOf("local", { cells: small }), 120));
    expect(late).toBeGreaterThan(early * 1.5);
  });

  it("fall more in a thunderstorm's wind than on a calm day", () => {
    const small = { x0: 0, y0: 0, x1: 4, y1: 3 };
    const calm = (t: number): LeavesView =>
      frameOf("local", { cells: small, wind: { timeS: t, strength: 1 } });
    const storm = (t: number): LeavesView =>
      frameOf("local", { cells: small, wind: { timeS: t, strength: 3.4 } });
    expect(mean(run(leavesIn("autumn", 0), storm, 120))).toBeGreaterThan(
      1.5 * mean(run(leavesIn("autumn", 0), calm, 120)),
    );
  });

  it("drop more from a wood than from a lone tree", () => {
    const lone = plantsOf((x, y) => x === 8 && y === 5);
    const wood = mean(run(leavesIn(), frameOf("middle"), 60));
    const one = mean(run(leavesIn(), frameOf("middle", { plants: lone }), 60));
    expect(wood).toBeGreaterThan(one);
  });

  it("come off in the colours the tree has turned, drawn in whole art pixels", () => {
    const plants = plantsOf(() => true);
    const leaves = leavesIn();
    for (const view of ["middle", "local"] as const) {
      const frame = frameOf(view, { plants });
      run(leaves, frame, 10);
      const sprites = shown(plants);
      expect(sprites.length).toBeGreaterThan(0);
      for (const sprite of sprites) {
        expect(COLOURS).toContain(sprite.tint);
        // A texel of one art pixel in the middle view, of two up close.
        expect(sprite.scale.x).toBeCloseTo((view === "local" ? 2 : 1) / TILE[view], 9);
        const left = sprite.x * TILE[view];
        expect(left).toBeCloseTo(Math.round(left), 6);
      }
    }
  });

  it("are sorted among the plants by where each will land", () => {
    const plants = plantsOf((x, y) => x === 8 && y === 5);
    const leaves = leavesIn();
    const rows = new Set<number>();
    for (let k = 0; k < 60 * 30; k++) {
      leaves.update(1 / 30, frameOf("local", { plants }));
      plants.guests.forEach((row, index) => {
        if (row.children.some((child) => child.visible)) rows.add(index);
      });
    }
    expect(rows.size).toBeGreaterThan(0);
    // The tree's foot is at y = 5.9; its leaves land a little behind and in front of it,
    // carried a little further south by the wind on the way down.
    for (const row of rows) {
      expect(row / 4).toBeGreaterThanOrEqual(5.9 - 0.15 - 0.25);
      expect(row / 4).toBeLessThanOrEqual(5.9 + 0.45 + 0.5);
    }
  });

  it("lie on the ground a moment, fainter at the last, then go", () => {
    const plants = plantsOf(() => true);
    const leaves = leavesIn();
    let lay = false;
    let faint = false;
    for (let k = 0; k < 30 * 30; k++) {
      leaves.update(1 / 30, frameOf("middle", { plants }));
      if (leaves.state.lying > 0) lay = true;
      if (shown(plants).some((sprite) => sprite.alpha < 1)) faint = true;
    }
    expect(lay).toBe(true);
    expect(faint).toBe(true);
    // Without a crown in sight any more, every leaf is gone within the time one takes to fall and lie.
    const bare = plantsOf(() => false);
    run(leaves, frameOf("middle", { plants: bare }), 30);
    expect(leaves.state).toEqual({ falling: 0, lying: 0 });
  });

  it("are cleared when the view changes", () => {
    const leaves = leavesIn();
    run(leaves, frameOf("middle"), 10);
    expect(leaves.state.falling + leaves.state.lying).toBeGreaterThan(0);
    leaves.update(1 / 30, frameOf("local", { plants: plantsOf(() => false) }));
    expect(leaves.state).toEqual({ falling: 0, lying: 0 });
  });

  it("fall the same way for the same seed", () => {
    expect(run(leavesIn(), frameOf("middle"), 20)).toEqual(run(leavesIn(), frameOf("middle"), 20));
  });
});
