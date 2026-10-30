import { describe, expect, it } from "vitest";
import { contentKey, type ArtCache } from "../../src/plants/artcache";
import { standingPlants, useArtCache, type StandingArt } from "../../src/plants/plants";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { fakeCanvas } from "../support/canvas";
import { world } from "../spike/worlds";

fakeCanvas();

/** A land of the same palette each time, but its own objects, as a new page load's is. */
const landOf = (): Land =>
  structuredClone({
    ...world(["~~~~~~", "~gbbg~", "~bccb~", "~~~~~~"], 200),
    ...LAND_PALETTE,
    season: "summer",
  }) as Land;

describe("the plants' drawings kept between page loads (R5, the optimization plan)", () => {
  it("draws a sheet once and keeps it, and a later page with the same land takes it from there", () => {
    const kept = new Map<string, readonly StandingArt[]>();
    const asked: string[] = [];
    const cache: ArtCache = {
      get: (key) => {
        asked.push(key);
        return kept.get(key);
      },
      put: (key, arts) => kept.set(key, arts),
    };
    useArtCache(cache);
    try {
      const first = standingPlants(landOf(), 32, { close: true });
      expect(kept.size).toBe(1);
      const [key, arts] = [...kept][0] ?? ["", []];
      expect(arts.length).toBeGreaterThan(0);
      // Another land of the same palette, as a new page load has: its sheet comes from
      // the cache, as drawn before (nothing drawn and kept again).
      const second = standingPlants(landOf(), 32, { close: true });
      expect(asked.filter((each) => each === key)).toHaveLength(2);
      expect(kept.size).toBe(1);
      second.cull({ x0: 0, y0: 0, x1: 6, y1: 4 });
      first.cull({ x0: 0, y0: 0, x1: 6, y1: 4 });
      expect(second.count).toBe(first.count);
      expect(second.count).toBeGreaterThan(0);
    } finally {
      useArtCache({ get: () => undefined, put: () => undefined });
    }
  });

  it("names a palette by its content, not by which object it is", () => {
    expect(contentKey({ a: [1, 2] })).toBe(contentKey({ a: [1, 2] }));
    expect(contentKey({ a: [1, 2] })).not.toBe(contentKey({ a: [2, 1] }));
  });
});
