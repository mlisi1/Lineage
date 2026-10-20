import { describe, expect, it } from "vitest";
import { paintGround } from "../../src/terrain/ground";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { BREATH_S, GLINT_SLOTS, Sea, glintAt, seaAt, surfAlphas } from "../../src/terrain/sea";
import { world } from "../spike/worlds";

const land = {
  ...world(["~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg"]),
  ...LAND_PALETTE,
};
const view = { x0: 0, y0: 0, x1: 14, y1: 4 };

describe("the moving sea", () => {
  it("brings a crest in: the far line, then the nearer, then the foam flares and fades", () => {
    const peak = (band: number): number => {
      let best = 0;
      let at = 0;
      for (let step = 0; step < 360; step++) {
        const alpha = surfAlphas((step / 360) * BREATH_S)[band] ?? 0;
        if (alpha > best) {
          best = alpha;
          at = step;
        }
      }
      return at;
    };
    expect(peak(2)).toBeLessThan(peak(1));
    expect(peak(1)).toBeLessThan(peak(0));
    for (let step = 0; step < 36; step++) {
      const [foam = 0, near = 0, far = 0] = surfAlphas((step / 36) * BREATH_S);
      // The foam never quite goes; the lines come from nothing.
      expect(foam).toBeGreaterThanOrEqual(0.3 - 1e-9);
      expect(Math.min(near, far)).toBeGreaterThanOrEqual(0);
      expect(Math.max(foam, near, far)).toBeLessThanOrEqual(1);
    }
    expect(surfAlphas(BREATH_S + 0.7)[1]).toBeCloseTo(surfAlphas(0.7)[1] ?? 0);
  });

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
  it("is three bands on the water by the shore, the foam nearest, and none on the ground", () => {
    const pixels = paintGround(land, { tile: 32, style: "blended", grain: true, surf: true });
    const bands = pixels.surf;
    if (bands === undefined) throw new Error("no surf");
    expect(bands).toHaveLength(3);
    const row = 64;
    const shore = 10 * 32;
    // The lines are dashed: look along a few rows.
    const xs = (band: Uint8ClampedArray): number[] => {
      const found: number[] = [];
      for (let y = row - 24; y < row + 24; y++) {
        for (let x = 0; x < pixels.width; x++) {
          if ((band[(y * pixels.width + x) * 4 + 3] ?? 0) > 0) found.push(x);
        }
      }
      return found;
    };
    const [foam = [], near = [], far = []] = bands.map(xs);
    const middle = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    for (const band of [foam, near, far]) {
      expect(band.length).toBeGreaterThan(0);
      // On the water, within a cell of the shore, never far out or on land.
      expect(Math.max(...band)).toBeLessThan(shore + 12);
      expect(Math.min(...band)).toBeGreaterThan(shore - 40);
    }
    expect(middle(far)).toBeLessThan(middle(near));
    expect(middle(near)).toBeLessThan(middle(foam));
    // The ground itself has no foam where the surf moves; it has it without the surf.
    const foamColour = (rgba: Uint8ClampedArray): number => {
      let white = 0;
      for (let x = shore - 40; x < shore; x++) {
        const at = (row * pixels.width + x) * 4;
        if ((rgba[at] ?? 0) > 200 && (rgba[at + 1] ?? 0) > 220 && (rgba[at + 2] ?? 0) > 220)
          white += 1;
      }
      return white;
    };
    const still = paintGround(land, { tile: 32, style: "blended", grain: true });
    expect(still.surf).toBeUndefined();
    expect(foamColour(still.rgba)).toBeGreaterThan(0);
    expect(foamColour(pixels.rgba)).toBe(0);
  });

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
