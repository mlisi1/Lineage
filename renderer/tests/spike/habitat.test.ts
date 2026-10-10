import { describe, expect, it } from "vitest";
import { passableIn } from "../../src/spike/habitat";
import { DAY_CYCLE_S, cycleTint, lightTint } from "../../src/spike/light";
import { MAP } from "./worlds";

describe("where a body can be", () => {
  const passable = passableIn(MAP);

  it("is land for walkers and water for swimmers", () => {
    expect(passable(12, 2, false)).toBe(true);
    expect(passable(12, 2, true)).toBe(false);
    expect(passable(2, 2, false)).toBe(false);
    expect(passable(2, 2, true)).toBe(true);
    expect(passable(11.6, 2.4, false)).toBe(true); // rounds to the cell
  });

  it("is never the outermost ring of cells, nor beyond it", () => {
    for (const swims of [false, true]) {
      expect(passable(0, 5, swims)).toBe(false);
      expect(passable(23, 5, swims)).toBe(false);
      expect(passable(5, 0, swims)).toBe(false);
      expect(passable(5, 11, swims)).toBe(false);
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
