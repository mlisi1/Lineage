import { describe, expect, it } from "vitest";
import { findSite, forest, meadow, shore } from "../../src/spike/sites";
import { MAP, world } from "./worlds";

describe("findSite", () => {
  it("finds the grassland, the wood and the shore", () => {
    expect(findSite(MAP, 8, 4, meadow)).toEqual({ x0: 12, y0: 0, x1: 20, y1: 4 });
    expect(findSite(MAP, 8, 4, forest)).toEqual({ x0: 0, y0: 4, x1: 8, y1: 8 });
    // A quarter water, with shrubs, grass and both trees: the bottom-right corner.
    expect(findSite(MAP, 8, 4, shore)).toEqual({ x0: 16, y0: 8, x1: 24, y1: 12 });
  });

  it("prefers a wood with both kinds of tree, and takes the first of equals", () => {
    const mixed = { BROADLEAF: 0.4, CONIFER: 0.4 };
    const pure = { BROADLEAF: 0.8, CONIFER: 0 };
    expect(forest(mixed)).toBeGreaterThan(forest(pure));
    const flat = world(["........", "........", "........", "........"]);
    expect(findSite(flat, 4, 4, meadow)).toEqual({ x0: 0, y0: 0, x1: 4, y1: 4 });
  });
});
