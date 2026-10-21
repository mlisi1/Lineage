import { describe, expect, it } from "vitest";
import { COSY } from "../../src/looks";
import { MAP_TILE, MID_TILE, paintGround } from "../../src/terrain/ground";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { BREATH_S, shoreSizes, swellAt, swellSizes, tidePhase } from "../../src/terrain/tide";
import { world } from "../spike/worlds";

describe("the waves' timing (round 6)", () => {
  it("varies slowly over the island, within a few seconds", () => {
    for (let x = 0; x < 200; x += 7) {
      for (let y = 0; y < 120; y += 11) {
        const here = tidePhase(x, y);
        expect(here).toBeGreaterThanOrEqual(0);
        expect(here).toBeLessThan(BREATH_S);
        // A stretch of beach breaks almost at once: a cell on, a fraction of a second.
        expect(Math.abs(tidePhase(x + 1, y) - here)).toBeLessThan(0.2);
      }
    }
  });

  it("are seen further out and run further up the closer the view", () => {
    const [map, middle, local] = [MAP_TILE, MID_TILE, 32].map(shoreSizes);
    expect(map?.swash).toBe(0);
    expect(middle?.reach).toBeGreaterThan(map?.reach ?? 0);
    expect(local?.reach).toBeGreaterThan(middle?.reach ?? 0);
    expect(local?.swash).toBeGreaterThan(middle?.swash ?? 0);
  });
});

describe("the open sea's swell (round 7)", () => {
  it("shows on the map, fainter in the middle view, not up close", () => {
    const map = swellSizes(MAP_TILE);
    const middle = swellSizes(MID_TILE);
    expect(map.strength).toBe(1);
    expect(middle.strength).toBeGreaterThan(0);
    expect(middle.strength).toBeLessThan(map.strength);
    expect(swellSizes(32).strength).toBe(0);
  });

  it("lies in crests across the screen: the phase turns down the screen, barely across", () => {
    const { spacing } = swellSizes(MAP_TILE);
    let down = 0;
    let across = 0;
    const turned = (a: number, b: number): number => {
      const d = Math.abs(a - b);
      return Math.min(d, 1 - d);
    };
    for (let x = 0; x < 300; x += 13) {
      for (let y = 0; y < 200; y += 17) {
        const here = swellAt(x, y, spacing);
        expect(here.phase).toBeGreaterThanOrEqual(0);
        expect(here.phase).toBeLessThan(1);
        expect(here.dash).toBeGreaterThanOrEqual(0);
        expect(here.dash).toBeLessThan(1);
        down += turned(swellAt(x, y + 1, spacing).phase, here.phase);
        across += turned(swellAt(x + 1, y, spacing).phase, here.phase);
      }
    }
    expect(down).toBeGreaterThan(3 * across);
  });

  it("is left by the painter out at sea, past the waves, in the views that show it", () => {
    const sea = Array.from(
      { length: 30 },
      (_, row) => (row < 4 ? "gggg" : "~~~~") + "~".repeat(56),
    );
    const land = { ...world(sea), ...LAND_PALETTE };
    const openSea = (tile: number): number => {
      const painted = paintGround(land, {
        tile,
        style: "blended",
        grain: tile > MAP_TILE,
        surf: true,
        look: COSY,
      });
      const shore = painted.shore;
      if (shore === undefined) throw new Error("no shore data");
      const { reach, swash } = shoreSizes(tile);
      let open = 0;
      for (let at = 0; at < painted.width * painted.height; at++) {
        if ((shore[at * 4 + 3] ?? 0) === 0) continue;
        // Out past the waves' data: the swell's.
        if ((shore[at * 4] ?? 0) > Math.max(reach, swash) + 1) open++;
      }
      return open;
    };
    expect(openSea(MAP_TILE)).toBeGreaterThan(0);
    expect(openSea(MID_TILE)).toBeGreaterThan(0);
    expect(openSea(32)).toBe(0);
  });
});
