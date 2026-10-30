import { describe, expect, it } from "vitest";
import {
  MOST_LEAN_PER_REACH,
  ROCK_JITTER,
  bendOf,
  gustAt,
  leanedPixels,
  leansOf,
  windStrength,
  type Bend,
} from "../../src/plants/wind";
import type { Pixels } from "../../src/terrain/pixels";
import { mulberry32 } from "../../src/rng";

/** A drawing `width` × `height`, every pixel opaque, its red the row and green the column. */
function block(width: number, height: number): Pixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([y, x, 0, 255], (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
}

/** The columns of row `y` that are drawn. */
function drawnIn(pixels: Pixels, y: number): number[] {
  const out: number[] = [];
  for (let x = 0; x < pixels.width; x++) {
    if ((pixels.rgba[(y * pixels.width + x) * 4 + 3] ?? 0) > 0) out.push(x);
  }
  return out;
}

const grass = bendOf("summer:GRASS/grown/0");
const bush = bendOf("summer:SHRUB/grown/1");
const tree = bendOf("autumn:BROADLEAF/grown/2");
const pine = bendOf("winter+snow:CONIFER/young/0");

/** The lean a plant is drawn at, as the plant layer works it out (`PlantLayer.blow`). */
function leanOf(strength: number, reach: number, push: number, bend: Bend, height: number): number {
  const { lowest, highest } = leansOf(bend, height);
  return Math.min(Math.max(Math.round(strength * reach * push), lowest), highest);
}

describe("how each drawing bends (bendOf)", () => {
  it("bends grass, flowers, bushes and trees, by the first part of the drawing's name", () => {
    expect(grass).not.toBeNull();
    expect(bush).not.toBeNull();
    expect(tree).not.toBeNull();
    expect(pine).not.toBeNull();
    for (const kind of ["dry", "daisy", "bell", "spike", "umbel", "reed", "herb", "fern"]) {
      expect(bendOf(`summer:${kind}/1`), kind).not.toBeNull();
    }
    // Without a season in front, the name is read the same.
    expect(bendOf("SHRUB/young/1")).toEqual(bush);
    // A tree's habit and rare looks after its name do not change how it bends.
    expect(bendOf("winter:BROADLEAF/grown/0/leafy+crown")).toEqual(tree);
  });

  it("leaves stones, boulders, logs, mushrooms, stumps and snags still", () => {
    for (const kind of ["stone", "boulder", "log", "mushroom", "stump", "snag"]) {
      expect(bendOf(`summer:${kind}/0`), kind).toBeNull();
    }
  });

  it("leaves a mangrove's stilt roots still: they stand on the ground, not on the plant", () => {
    expect(bendOf("summer:SHRUB/grown/0#stilts")).toBeNull();
    expect(bendOf("summer:SHRUB/grown/0#berries")).toEqual(bush);
  });

  it("bends grass the most and from its foot, a conifer the least, a crown as one piece", () => {
    if (grass === null || bush === null || tree === null || pine === null) throw new Error();
    expect(grass.flex).toBeGreaterThan(bush.flex);
    expect(bush.flex).toBeGreaterThan(tree.flex);
    expect(tree.flex).toBeGreaterThan(pine.flex);
    expect(grass.hinge).toBe(0);
    expect(grass.stiff).toBe(1);
    for (const stiff of [bush, tree, pine]) {
      expect(stiff.hinge).toBeGreaterThan(0);
      expect(stiff.stiff).toBeLessThan(1);
      expect(stiff.stiff).toBeGreaterThan(stiff.hinge);
    }
  });
});

describe("the leans a drawing is drawn in (leansOf)", () => {
  it("draws none for a drawing that does not bend", () => {
    expect(leansOf(null, 100)).toEqual({ lowest: 0, highest: 0 });
  });

  it("leans by whole pixels: a pixel back against the wind, a few with it", () => {
    for (const bend of [grass, bush, tree, pine]) {
      for (let height = 1; height <= 160; height++) {
        const { lowest, highest } = leansOf(bend, height);
        expect(Number.isInteger(lowest)).toBe(true);
        expect(Number.isInteger(highest)).toBe(true);
        if (highest === 0) {
          expect(lowest).toBe(0);
          continue;
        }
        expect(lowest).toBe(-1);
        expect(highest).toBeGreaterThanOrEqual(1);
        // Never more than three pixels, nor more than a fifth of its height.
        expect(highest).toBeLessThanOrEqual(3);
        expect(highest).toBeLessThanOrEqual(Math.ceil(0.2 * height));
      }
    }
  });

  it("lets a small tuft lean a pixel, and the tallest trees three", () => {
    expect(leansOf(grass, 5).highest).toBe(1);
    expect(leansOf(grass, 40).highest).toBe(3);
    expect(leansOf(tree, 120).highest).toBe(3);
  });

  it("does not lean a stiff plant too short to show it", () => {
    // A conifer of the middle view: a few pixels tall, it would not lean a whole pixel.
    expect(leansOf(pine, 8)).toEqual({ lowest: 0, highest: 0 });
  });

  it("leans a taller plant of a kind at least as far as a shorter one", () => {
    for (const bend of [grass, bush, tree, pine]) {
      let last = 0;
      for (let height = 1; height <= 160; height++) {
        const { highest } = leansOf(bend, height);
        expect(highest).toBeGreaterThanOrEqual(last);
        last = highest;
      }
    }
  });
});

describe("a drawing leaning (leanedPixels)", () => {
  const pixels = block(3, 10);
  const footY = 9;

  it("is widened by the clear pixels to lean in, and as tall", () => {
    if (grass === null) throw new Error();
    const leaned = leanedPixels(pixels, footY, grass, 2, 1, 3);
    expect(leaned.width).toBe(3 + 1 + 3);
    expect(leaned.height).toBe(10);
  });

  it("slides each row by whole pixels: none at the foot, the whole lean at the top", () => {
    if (grass === null) throw new Error();
    const leaned = leanedPixels(pixels, footY, grass, 3, 1, 3);
    // Every row keeps its three pixels side by side, in order.
    for (let y = 0; y < leaned.height; y++) {
      const columns = drawnIn(leaned, y);
      expect(columns).toHaveLength(3);
      expect((columns[2] ?? 0) - (columns[0] ?? 0)).toBe(2);
      for (let k = 0; k < 3; k++) {
        const at = (y * leaned.width + (columns[k] ?? 0)) * 4;
        expect([leaned.rgba[at], leaned.rgba[at + 1]]).toEqual([y, k]);
      }
    }
    // The foot stays where it was (after the pixel added on the left); the top leans 3.
    expect(drawnIn(leaned, footY)[0]).toBe(1);
    expect(drawnIn(leaned, 0)[0]).toBe(1 + 3);
    // Rows shift more the higher they are.
    for (let y = 1; y < leaned.height; y++) {
      expect(drawnIn(leaned, y)[0] ?? 0).toBeLessThanOrEqual(drawnIn(leaned, y - 1)[0] ?? 0);
    }
  });

  it("leans back against the wind into the clear pixels on the left", () => {
    if (grass === null) throw new Error();
    const leaned = leanedPixels(pixels, footY, grass, -1, 1, 3);
    expect(drawnIn(leaned, 0)[0]).toBe(0);
    expect(drawnIn(leaned, footY)[0]).toBe(1);
  });

  it("moves nothing at or below the hinge, and what is stiff as one piece", () => {
    if (tree === null) throw new Error();
    const tall = block(2, 40);
    const foot = 39;
    const leaned = leanedPixels(tall, foot, tree, 3, 0, 3);
    const hinge = foot * (1 - tree.hinge);
    const stiff = foot * (1 - tree.stiff);
    for (let y = 0; y < tall.height; y++) {
      const left = drawnIn(leaned, y)[0];
      if (y >= hinge) expect(left, `row ${y}`).toBe(0);
      if (y <= stiff) expect(left, `row ${y}`).toBe(3);
    }
  });

  it("at lean 0 is the drawing itself, moved over by the pixels added on the left", () => {
    if (bush === null) throw new Error();
    const leaned = leanedPixels(pixels, footY, bush, 0, 2, 2);
    for (let y = 0; y < 10; y++) expect(drawnIn(leaned, y)).toEqual([2, 3, 4]);
  });
});

describe("how hard the wind blows (windStrength)", () => {
  it("is a calm day's breeze without rain or storm, by day", () => {
    expect(windStrength(0, 0, 0)).toBe(1);
  });

  it("blows harder in rain and harder still in a thunderstorm", () => {
    const calm = windStrength(0, 0, 0);
    const rain = windStrength(1, 0, 0);
    const storm = windStrength(1, 1, 0);
    expect(rain).toBeGreaterThan(calm);
    expect(storm).toBeGreaterThan(rain);
    // A half-strength shower is between.
    expect(windStrength(0.5, 0, 0)).toBeGreaterThan(calm);
    expect(windStrength(0.5, 0, 0)).toBeLessThan(rain);
  });

  it("takes rain heavier than a steady shower as a shower, and no rain as none", () => {
    expect(windStrength(3, 0, 0)).toBe(windStrength(1, 0, 0));
    expect(windStrength(-1, 0, 0)).toBe(windStrength(0, 0, 0));
  });

  it("drops a little at night, not to nothing", () => {
    const day = windStrength(1, 0.5, 0);
    const night = windStrength(1, 0.5, 1);
    expect(night).toBeLessThan(day);
    expect(night).toBeGreaterThan(day / 2);
    expect(windStrength(1, 0.5, 0.5)).toBeLessThan(day);
    expect(windStrength(1, 0.5, 0.5)).toBeGreaterThan(night);
  });
});

describe("the wind's push at a place (gustAt)", () => {
  const random = mulberry32(17);
  const places = Array.from({ length: 400 }, () => ({
    x: random() * 200,
    y: random() * 120,
    t: random() * 600,
    jitter: random() * ROCK_JITTER,
  }));

  it("is the same at the same place and moment", () => {
    for (const { x, y, t, jitter } of places.slice(0, 20)) {
      expect(gustAt(x, y, t, jitter)).toBe(gustAt(x, y, t, jitter));
    }
  });

  it("stays about -0.5 to 1.2: a lull may push back a little, a gust's crest the most", () => {
    const pushes = places.map(({ x, y, t, jitter }) => gustAt(x, y, t, jitter));
    for (const push of pushes) {
      expect(push).toBeGreaterThanOrEqual(-0.5);
      expect(push).toBeLessThanOrEqual(1.25);
    }
    // Both gusts and lulls come by.
    expect(Math.max(...pushes)).toBeGreaterThan(0.7);
    expect(Math.min(...pushes)).toBeLessThan(0.1);
    // On the whole it blows with the wind.
    expect(pushes.reduce((sum, push) => sum + push, 0) / pushes.length).toBeGreaterThan(0);
  });

  it("moves neighbours together and plants far apart on their own", () => {
    let near = 0;
    let far = 0;
    for (const { x, y, t } of places) {
      near += Math.abs(gustAt(x + 0.2, y, t, 0) - gustAt(x, y, t, 0));
      far += Math.abs(gustAt(x + 37, y + 23, t, 0) - gustAt(x, y, t, 0));
    }
    expect(near / places.length).toBeLessThan(0.15);
    expect(far).toBeGreaterThan(3 * near);
  });

  it("rolls the gusts downwind as a slow wave, east and a little south", () => {
    // What is here now is a cell further downwind a little under half a second later.
    for (const { x, y, t } of places.slice(0, 50)) {
      const later = gustAt(x + 0.94, y + 0.34, t + (0.94 * 0.94 + 0.34 * 0.34) / 2.2, 0);
      expect(later).toBeCloseTo(gustAt(x, y, t, 0), 6);
    }
  });

  it("sets a plant only a little out of step with its neighbour by its jitter", () => {
    let apart = 0;
    for (const { x, y, t } of places) {
      apart = Math.max(apart, Math.abs(gustAt(x, y, t, ROCK_JITTER) - gustAt(x, y, t, 0)));
    }
    expect(apart).toBeGreaterThan(0);
    // The rocking is a small share of the push: the gusts are what is seen.
    expect(apart).toBeLessThan(0.3);
  });
});

describe("storms lean more than calm", () => {
  it("leans a tree further and more often in a thunderstorm than on a calm day", () => {
    if (tree === null) throw new Error();
    const height = 100;
    const reach = tree.flex * height;
    const calm = windStrength(0, 0, 0);
    const storm = windStrength(1, 1, 0);
    const random = mulberry32(5);
    let calmMost = -Infinity;
    let stormMost = -Infinity;
    let calmSum = 0;
    let stormSum = 0;
    for (let k = 0; k < 500; k++) {
      const push = gustAt(random() * 100, random() * 100, random() * 300, 0);
      const quiet = leanOf(calm, reach, push, tree, height);
      const blown = leanOf(storm, reach, push, tree, height);
      // Either way: with the wind in a gust, back against it in a lull.
      expect(Math.abs(blown)).toBeGreaterThanOrEqual(Math.abs(quiet));
      calmMost = Math.max(calmMost, quiet);
      stormMost = Math.max(stormMost, blown);
      calmSum += quiet;
      stormSum += blown;
    }
    expect(stormMost).toBe(leansOf(tree, height).highest);
    expect(calmMost).toBeLessThan(stormMost);
    expect(stormSum).toBeGreaterThan(calmSum);
  });

  it("gives grass a pixel on a calm day and its full lean in a storm", () => {
    if (grass === null) throw new Error();
    const height = 30;
    const reach = grass.flex * height;
    const crest = 1.2;
    expect(leanOf(windStrength(0, 0, 0), reach, crest, grass, height)).toBeGreaterThanOrEqual(1);
    expect(leanOf(windStrength(1, 1, 0), reach, crest, grass, height)).toBe(
      leansOf(grass, height).highest,
    );
  });
});

describe("the most a plant leans (review P3)", () => {
  it("is never outleant: a plant under half a pixel of it never leans", () => {
    const random = mulberry32(7);
    let most = 0;
    for (let k = 0; k < 20000; k++) {
      const strength = windStrength(random(), random() < 0.5 ? 1 : random(), 0);
      const gust = gustAt(random() * 200, random() * 120, random() * 600, random() * 6);
      most = Math.max(most, Math.abs(strength * gust));
    }
    expect(most).toBeLessThanOrEqual(MOST_LEAN_PER_REACH);
    expect(most).toBeGreaterThan(MOST_LEAN_PER_REACH * 0.6);
  });
});
