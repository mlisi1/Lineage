import { describe, expect, it } from "vitest";
import { COSY, LOOKS, MAPS, dressed } from "../../src/looks";
import { paintGround } from "../../src/terrain/ground";
import { hexToRgb } from "../../src/terrain/pixels";
import { PALETTE, world } from "../spike/worlds";

describe("the looks", () => {
  it("dresses the land in a look's palette, or leaves it as it comes", () => {
    const land = world(["gg", "gg"]);
    expect(dressed(land, MAPS)).toBe(land);
    const worn = dressed(land, COSY);
    expect(worn.palette).toBe(COSY.land?.palette);
    expect(worn.relief).toBe(COSY.land?.relief);
    expect(worn.cover).toBe(land.cover);
  });

  it("gives every look a ramp for every class the maps colour", () => {
    for (const look of LOOKS) {
      if (look.land === undefined) continue;
      expect(Object.keys(look.land.palette).sort()).toEqual(Object.keys(PALETTE).sort());
      expect(look.land.relief.seaBands.length).toBeGreaterThan(0);
    }
  });

  it("paints the same land in other colours, on the same shore", () => {
    const land = world(["~~gggg", "~~gggg", "~~gggg"]);
    const options = { tile: 8, style: "blended", grain: true } as const;
    const maps = paintGround(land, options);
    const cosy = paintGround(dressed(land, COSY), { ...options, look: COSY });
    expect(cosy.width).toBe(maps.width);
    let differ = 0;
    for (let at = 0; at < maps.rgba.length; at += 4) {
      if (maps.rgba[at] !== cosy.rgba[at] || maps.rgba[at + 1] !== cosy.rgba[at + 1]) differ += 1;
    }
    expect(differ).toBeGreaterThan(maps.rgba.length / 4 / 2);
    // The shore's outline stands where it did, in the look's own colour.
    const outline = hexToRgb(COSY.land?.relief.shoreOutline ?? "#000000");
    const outlined = (rgba: Uint8ClampedArray, colour: readonly number[]): number[] => {
      const found: number[] = [];
      for (let at = 0; at < rgba.length; at += 4) {
        if (rgba[at] === colour[0] && rgba[at + 1] === colour[1] && rgba[at + 2] === colour[2]) {
          found.push(at);
        }
      }
      return found;
    };
    expect(outlined(cosy.rgba, outline)).toEqual(outlined(maps.rgba, hexToRgb("#3d3528")));
  });
});
