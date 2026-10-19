import { describe, expect, it } from "vitest";
import { COSY, DEFAULT_LOOK, R0, dressed } from "../../src/looks";
import { paintGround } from "../../src/terrain/ground";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { hexToRgb } from "../../src/terrain/pixels";
import { PALETTE, world } from "../spike/worlds";

describe("the looks", () => {
  it("draw in cosy unless told otherwise, in the palette the land comes with", () => {
    expect(DEFAULT_LOOK).toBe(COSY);
    const land = world(["gg", "gg"]);
    expect(dressed(land, COSY)).toBe(land);
  });

  it("keep the R0 look's own palette, for the record", () => {
    const land = { ...world(["gg", "gg"]), ...LAND_PALETTE };
    const worn = dressed(land, R0);
    expect(worn.palette).toBe(R0.land?.palette);
    expect(worn.palette["GRASS"]).toEqual(PALETTE["GRASS"]);
    expect(worn.cover).toBe(land.cover);
  });

  it("give the shared palette a ramp for every class the R0 look colours", () => {
    expect(Object.keys(LAND_PALETTE.palette).sort()).toEqual(Object.keys(PALETTE).sort());
    expect(LAND_PALETTE.relief.seaBands.length).toBeGreaterThan(0);
  });

  it("paint the same land in other colours, on the same shore", () => {
    const land = { ...world(["~~gggg", "~~gggg", "~~gggg"]), ...LAND_PALETTE };
    const options = { tile: 8, style: "blended", grain: true } as const;
    const cosy = paintGround(land, { ...options, look: COSY });
    const r0 = paintGround(dressed(land, R0), { ...options, look: R0 });
    expect(cosy.width).toBe(r0.width);
    let differ = 0;
    for (let at = 0; at < r0.rgba.length; at += 4) {
      if (r0.rgba[at] !== cosy.rgba[at] || r0.rgba[at + 1] !== cosy.rgba[at + 1]) differ += 1;
    }
    expect(differ).toBeGreaterThan(r0.rgba.length / 4 / 2);
    // The shore's outline stands where it did, in each look's own colour.
    const outlined = (rgba: Uint8ClampedArray, colour: readonly number[]): number[] => {
      const found: number[] = [];
      for (let at = 0; at < rgba.length; at += 4) {
        if (rgba[at] === colour[0] && rgba[at + 1] === colour[1] && rgba[at + 2] === colour[2]) {
          found.push(at);
        }
      }
      return found;
    };
    const cosyLine = outlined(cosy.rgba, hexToRgb(LAND_PALETTE.relief.shoreOutline));
    expect(cosyLine.length).toBeGreaterThan(0);
    expect(cosyLine).toEqual(outlined(r0.rgba, hexToRgb(R0.land?.relief.shoreOutline ?? "")));
  });
});
