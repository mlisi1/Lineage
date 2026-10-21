import { describe, expect, it } from "vitest";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { GLINT_SLOTS, Sea, glintAt, seaAt } from "../../src/terrain/sea";
import { world } from "../spike/worlds";

const land = {
  ...world(["~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg"]),
  ...LAND_PALETTE,
};
const view = { x0: 0, y0: 0, x1: 14, y1: 4 };

describe("the moving sea", () => {


  it("puts glints on open water only, the same at the same moment", () => {
    let seen = 0;
    for (let step = 0; step < 60; step++) {
      const time = step * 0.37;
      for (let slot = 0; slot < GLINT_SLOTS; slot++) {
        const glint = glintAt(land, slot, time, view, 32);
        expect(glint).toEqual(glintAt(land, slot, time, view, 32));
        if (glint === null) continue;
        seen += 1;
        // Land starts at x = 10; the shallows by it are kept clear too.
        expect(glint.x).toBeLessThan(10);
        expect(glint.length).toBeGreaterThanOrEqual(1);
        expect(glint.length).toBeLessThanOrEqual(8);
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  it("comes and goes: a glint is not there all the time", () => {
    const shown = Array.from({ length: 100 }, (_, step) => glintAt(land, 3, step * 0.1, view, 32));
    expect(shown.some((glint) => glint === null)).toBe(true);
    expect(shown.some((glint) => glint !== null)).toBe(true);
  });
});

describe("the sea at a place, for creatures under water", () => {
  it("is the depth band's colour and a depth, deeper away from the shore, none on land", () => {
    // Depth falls off with distance from the shore here: from 0.01 by it to 0.4 far out.
    const deep = {
      ...world(["~~~~~~~~~~gggg"], 200, (x, _y, water) =>
        water ? 0.4 - 0.04 * (10 - x) + 0.01 : 0.5,
      ),
      ...LAND_PALETTE,
    };
    const sea = seaAt(deep);
    expect(sea(12.5, 0.5)).toBeNull();
    const near = sea(9.5, 0.5);
    const far = sea(0.5, 0.5);
    if (near === null || far === null) throw new Error("no sea");
    expect(far.depth).toBeGreaterThan(near.depth);
    expect(far.depth).toBeLessThanOrEqual(1);
    const colours = LAND_PALETTE.relief.seaBands.map((band) =>
      Number.parseInt(band.colour.slice(1), 16),
    );
    expect(colours).toContain(near.colour);
    expect(colours).toContain(far.colour);
    expect(far.colour).not.toBe(near.colour);
  });
});

describe("the surf the painter leaves for the sea", () => {


  it("leaves a glint where it is on the water while the view moves", () => {
    const open = { ...world(Array.from({ length: 40 }, () => "~".repeat(80))), ...LAND_PALETTE };
    const sea = new Sea(8);
    const sprites = sea.glints.children;
    let compared = 0;
    let last: (readonly [number, number] | null)[] = [];
    for (let step = 0; step < 60; step++) {
      // The camera pans six cells a second (more than an art pixel a frame); the glints
      // drift on their own only a little.
      const time = step / 30;
      const x0 = 10 + 6 * time;
      sea.tick(time, open, { x0, y0: 10, x1: x0 + 64, y1: 10 + 37.5 }, null);
      const now = sprites.map((sprite) =>
        sprite.visible ? ([sprite.x, sprite.y] as const) : null,
      );
      now.forEach((at, slot) => {
        const before = last[slot];
        if (at === null || before === null || before === undefined) return;
        // Within a showing, at most the drift's own art pixel or so a frame.
        expect(Math.abs(at[0] - before[0])).toBeLessThanOrEqual(1 / 8 + 1e-9);
        expect(at[1]).toBe(before[1]);
        compared += 1;
      });
      last = now;
    }
    expect(compared).toBeGreaterThan(100);
  });
});

