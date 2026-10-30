import { describe, expect, it } from "vitest";
import { heightAt, passableIn } from "../../src/creatures/habitat";
import { DAY_CYCLE_S, cycleTint, lightTint } from "../../src/spike/light";
import { MAP, SEA_LEVEL } from "./worlds";

describe("where a body can be", () => {
  const passable = passableIn(MAP);

  it("is land for walkers and water for swimmers", () => {
    // The middle of a grass cell well inland, and of a sea cell well offshore.
    expect(passable(14.5, 2.5, false)).toBe(true);
    expect(passable(14.5, 2.5, true)).toBe(false);
    expect(passable(1.5, 1.5, false)).toBe(false);
    expect(passable(1.5, 1.5, true)).toBe(true);
  });

  it("puts the shore where the height between two cells crosses the sea level", () => {
    // Columns 3 and 4 of row 2 are sea and land: their middles are at 3.5 and 4.5, and
    // with land as high as the sea is deep the shore runs half-way, at 4.
    expect(heightAt(MAP, 3.5, 2.5)).toBeCloseTo(SEA_LEVEL - 0.1);
    expect(heightAt(MAP, 4.5, 2.5)).toBeCloseTo(SEA_LEVEL + 0.1);
    expect(heightAt(MAP, 4, 2.5)).toBeCloseTo(SEA_LEVEL);
    expect(passable(3.8, 2.5, true)).toBe(true);
    expect(passable(4.2, 2.5, false)).toBe(true);
    // Nobody stands on the waterline itself.
    expect(passable(4, 2.5, false)).toBe(false);
    expect(passable(4, 2.5, true)).toBe(false);
  });

  it("is never the outermost ring of cells, nor beyond it", () => {
    for (const swims of [false, true]) {
      expect(passable(0.5, 5, swims)).toBe(false);
      expect(passable(23.5, 5, swims)).toBe(false);
      expect(passable(5, 0.5, swims)).toBe(false);
      expect(passable(5, 11.5, swims)).toBe(false);
      expect(passable(-3, 40, swims)).toBe(false);
    }
  });
});

describe("light", () => {
  it("leaves the day untouched and darkens the night", () => {
    expect(lightTint("day")).toBe(0xffffff);
    const night = lightTint("night");
    expect(night & 255).toBeGreaterThan((night >> 16) & 255); // bluish
    expect((night >> 16) & 255).toBeLessThan(128);
  });

  it("cycles through the day, blending from one light to the next", () => {
    expect(cycleTint(0)).toBe(lightTint("day"));
    expect(cycleTint(DAY_CYCLE_S / 4)).toBe(lightTint("dusk"));
    expect(cycleTint(DAY_CYCLE_S / 2)).toBe(lightTint("night"));
    expect(cycleTint(DAY_CYCLE_S * 1.75)).toBe(lightTint("dawn"));
    const between = cycleTint(DAY_CYCLE_S / 8);
    const red = (rgb: number): number => (rgb >> 8) & 255;
    expect(red(between)).toBeLessThan(red(lightTint("day")));
    expect(red(between)).toBeGreaterThan(red(lightTint("dusk")));
  });
});
