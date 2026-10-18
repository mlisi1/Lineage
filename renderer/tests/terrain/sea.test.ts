import { describe, expect, it } from "vitest";
import { paintGround } from "../../src/terrain/ground";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { BREATH_S, GLINT_SLOTS, glintAt, surfAlphas } from "../../src/terrain/sea";
import { world } from "../spike/worlds";

const land = {
  ...world(["~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg", "~~~~~~~~~~gggg"]),
  ...LAND_PALETTE,
};
const view = { x0: 0, y0: 0, x1: 14, y1: 4 };

describe("the moving sea", () => {
  it("brings the foam in as the outer line goes, and back", () => {
    const quarter = surfAlphas(BREATH_S / 4);
    const threeQuarters = surfAlphas((3 * BREATH_S) / 4);
    expect(quarter.near).toBeCloseTo(1);
    expect(quarter.far).toBeLessThan(0.3);
    expect(threeQuarters.near).toBeLessThan(0.3);
    expect(threeQuarters.far).toBeCloseTo(1);
    expect(surfAlphas(BREATH_S + 0.7).near).toBeCloseTo(surfAlphas(0.7).near);
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

describe("the surf the painter leaves for the sea", () => {
  it("is two bands on the water by the shore, clear on land and far out", () => {
    const pixels = paintGround(land, { tile: 32, style: "blended", grain: true, surf: true });
    const { surf } = pixels;
    if (surf === undefined) throw new Error("no surf");
    const alpha = (band: Uint8ClampedArray, x: number, y: number): number =>
      band[(y * pixels.width + x) * 4 + 3] ?? 0;
    const row = 64;
    // Where the height crosses the sea level, between the middles of cells 9 and 10; the
    // coast wanders a few pixels either side of it.
    const shore = 10 * 32;
    const opaque = (band: Uint8ClampedArray, from: number, to: number): number => {
      let n = 0;
      for (let x = Math.round(from); x < Math.round(to); x++) if (alpha(band, x, row) > 0) n += 1;
      return n;
    };
    expect(opaque(surf.near, shore - 16, shore + 8)).toBeGreaterThan(0);
    expect(opaque(surf.near, 0, shore - 40)).toBe(0);
    expect(opaque(surf.far, 0, shore - 40)).toBe(0);
    expect(opaque(surf.near, shore + 16, pixels.width)).toBe(0);
    expect(opaque(surf.far, shore + 16, pixels.width)).toBe(0);
    expect(opaque(surf.far, shore - 24, shore + 4)).toBeGreaterThan(0);
    // Without asking, none.
    expect(paintGround(land, { tile: 32, style: "blended", grain: true }).surf).toBeUndefined();
  });
});
