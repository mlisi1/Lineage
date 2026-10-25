import { describe, expect, it } from "vitest";
import type { SeaAt } from "../../src/creatures/water";
import { Landscape, TILES, type ViewName } from "../../src/landscape";
import { InlinePainter } from "../../src/terrain/painter";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { seaAt } from "../../src/terrain/sea";
import {
  BREATH_S,
  TIDE_LOW,
  TIDE_S,
  shoreSizes,
  swashUp,
  tideLevel,
  tidePhase,
} from "../../src/terrain/tide";
import { SEA_LEVEL, world } from "../spike/worlds";

describe("the tide (tideLevel)", () => {
  it("comes in and goes out once a tide, from its lowest share to full", () => {
    let low = Infinity;
    let high = -Infinity;
    for (let t = 0; t < TIDE_S; t += 0.25) {
      const level = tideLevel(t);
      low = Math.min(low, level);
      high = Math.max(high, level);
      expect(tideLevel(t + TIDE_S)).toBeCloseTo(level, 9);
    }
    expect(low).toBeCloseTo(TIDE_LOW, 3);
    expect(high).toBeCloseTo(1, 3);
    // Half way in at the start, full a quarter of a tide on, lowest three quarters on.
    expect(tideLevel(0)).toBeCloseTo((1 + TIDE_LOW) / 2, 9);
    expect(tideLevel(TIDE_S / 4)).toBeCloseTo(1, 9);
    expect(tideLevel((3 * TIDE_S) / 4)).toBeCloseTo(TIDE_LOW, 9);
  });
});

describe("the swash up the beach (swashUp)", () => {
  const top = 10;

  it("runs up the sand and drains, never further than its top nor below the waterline", () => {
    for (let t = -20; t < 40; t += 0.05) {
      const up = swashUp(t, 7.3, 11.1, top);
      expect(up).toBeGreaterThanOrEqual(0);
      expect(up).toBeLessThanOrEqual(top + 1e-9);
      expect(swashUp(t + BREATH_S, 7.3, 11.1, top)).toBeCloseTo(up, 6);
    }
  });

  it("rises for the first 0.3 of a wave, drains by 0.8 and lies out for the rest", () => {
    // At a place whose wave starts with the clock.
    const x = 0;
    const y = 0;
    const start = -tidePhase(x, y);
    const at = (share: number): number => swashUp(start + share * BREATH_S, x, y, top);
    expect(at(0.001)).toBeLessThan(0.1);
    expect(at(0.15)).toBeGreaterThan(at(0.05));
    expect(at(0.3)).toBeCloseTo(top, 3);
    expect(at(0.5)).toBeLessThan(at(0.35));
    expect(at(0.79)).toBeLessThan(0.1);
    expect(at(0.85)).toBe(0);
    expect(at(0.99)).toBe(0);
  });

  it("breaks at each place on its own wave", () => {
    const here = Array.from({ length: 50 }, (_, k) => swashUp(k * 0.1, 3, 4, top));
    const there = Array.from({ length: 50 }, (_, k) => swashUp(k * 0.1, 140, 90, top));
    expect(here).not.toEqual(there);
  });

  it("runs no swash where the shore has none: the map", () => {
    expect(swashUp(1.2, 3, 4, shoreSizes(4).swash)).toBe(0);
  });
});

describe("the sea under a place (seaAt)", () => {
  const land: Land = {
    ...world(["~~~~gggg"], 200, (x, _y, water) => (water ? SEA_LEVEL - 0.02 * (4 - x) : 0.5)),
    ...LAND_PALETTE,
  };
  const sea: SeaAt = seaAt(land);

  it("says how far below the sea it is, in the land's height units (R5: wading)", () => {
    expect(sea(1.5, 0.5)?.below).toBeCloseTo(0.06, 6);
    expect(sea(0.5, 0.5)?.below).toBeCloseTo(0.08, 6);
    // Deeper further out; none on land.
    expect(sea(0.5, 0.5)?.below ?? 0).toBeGreaterThan(sea(2.5, 0.5)?.below ?? 0);
    expect(sea(6.5, 0.5)).toBeNull();
  });
});

describe("wet feet on the beach (Landscape.swashCovers)", () => {
  /** Sea in the west, a low beach from x = 4, a dune from x = 8. */
  const land: Land = {
    ...world(["~~~~gggggggg", "~~~~gggggggg", "~~~~gggggggg"], 200, (x, _y, water) =>
      water ? SEA_LEVEL - 0.02 : x < 8 ? SEA_LEVEL + 0.02 : SEA_LEVEL + 0.2,
    ),
    ...LAND_PALETTE,
  };
  /** A landscape showing `view` of `land` with its sea's clock at `timeS`. */
  const showing = (view: ViewName, timeS: number): Landscape => {
    const landscape = new Landscape(new InlinePainter());
    Object.assign(landscape, { land, view, seaTime: timeS });
    return landscape;
  };
  /** The share of the moments over a few waves when the swash covers (x, y). */
  const wetShare = (view: ViewName, x: number, y: number): number => {
    let wet = 0;
    const moments = 400;
    for (let k = 0; k < moments; k++) {
      if (showing(view, k * 0.1).swashCovers(x, y)) wet += 1;
    }
    return wet / moments;
  };

  it("covers the beach by the water now and then, in the views close enough to have it", () => {
    // The waterline is half way between the cells, at x = 4.
    for (const view of ["middle", "local"] as const) {
      const share = wetShare(view, 4.08, 1.5);
      expect(share, view).toBeGreaterThan(0.05);
      expect(share, view).toBeLessThan(0.9);
    }
  });

  it("never covers the map, the sea itself, land beyond its reach or high ground", () => {
    expect(wetShare("map", 4.08, 1.5)).toBe(0);
    expect(wetShare("local", 3.5, 1.5)).toBe(0);
    expect(wetShare("local", 5, 1.5)).toBe(0);
    expect(wetShare("local", 9, 1.5)).toBe(0);
  });

  it("covers a place only while the swash has run as far up as it is from the water", () => {
    const x = 4.1;
    const y = 1.5;
    const tile = TILES.local;
    for (let k = 0; k < 400; k++) {
      const t = k * 0.1;
      const up = swashUp(t, x, y, shoreSizes(tile).swash * tideLevel(t)) / tile;
      const wet = showing("local", t).swashCovers(x, y);
      if (wet) expect(up).toBeGreaterThanOrEqual(0.1 - 1e-6);
      if (up > 0.1 + 1e-6) expect(wet).toBe(true);
    }
  });

  it("is dry before any land has come", () => {
    const landscape = new Landscape(new InlinePainter());
    landscape.show("local", { x0: 0, y0: 0, x1: 4, y1: 4 });
    expect(landscape.swashCovers(4.1, 1.5)).toBe(false);
  });
});

describe("the landscape's bushes", () => {
  it("are drawn in pieces unless told otherwise (the owner's choice, 2026-10-24)", () => {
    expect(new Landscape(new InlinePainter()).bushPieces).toBe(true);
  });
});
