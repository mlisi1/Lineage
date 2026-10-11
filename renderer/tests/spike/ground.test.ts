import { describe, expect, it } from "vitest";
import {
  GROUND_STYLES,
  MID_TILE,
  MAP_TILE,
  paintGround,
  valueNoise,
  type GroundStyle,
} from "../../src/spike/ground";
import { hexToRgb, type Pixels } from "../../src/spike/pixelart";
import { DEPTH, LAND, PALETTE, SEA, SEA_LEVEL, SHORE_OUTLINE, world } from "./worlds";

const rows = (letter: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => letter.repeat(width));
const packed = (colour: string): number => {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
};
const at = (image: Pixels, x: number, y: number): number => {
  const i = (y * image.width + x) * 4;
  return ((image.rgba[i] ?? 0) << 16) | ((image.rgba[i + 1] ?? 0) << 8) | (image.rgba[i + 2] ?? 0);
};
/** How many pixels of the image have each colour. */
function census(image: Pixels): Map<number, number> {
  const counts = new Map<number, number>();
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      counts.set(at(image, x, y), (counts.get(at(image, x, y)) ?? 0) + 1);
    }
  }
  return counts;
}
const share = (image: Pixels, colour: string): number =>
  (census(image).get(packed(colour)) ?? 0) / (image.width * image.height);
const local = (style: GroundStyle, grain = true) => ({ tile: MID_TILE, style, grain });

const ISLAND = [...rows("~", 9, 3), ...rows("~~~...~~~", 1, 3), ...rows("~", 9, 3)];
const BARE = PALETTE["BARE"] ?? ["", "", ""];
const GRASS = PALETTE["GRASS"] ?? ["", "", ""];
/** The band of sea the worlds' flat sea floor falls in. */
const SEA_HERE = SEA[2] ?? "";

describe("paintGround", () => {
  it("paints opaque pixels, tile to the cell, the same every time, in every style", () => {
    const fixture = world(["~~~~~~", "~.gb.~", "~.sc.~", "~~~~~~"]);
    for (const style of GROUND_STYLES) {
      const image = paintGround(fixture, local(style));
      expect([image.width, image.height]).toEqual([6 * MID_TILE, 4 * MID_TILE]);
      for (let i = 3; i < image.rgba.length; i += 4) expect(image.rgba[i]).toBe(255);
      expect([...paintGround(fixture, local(style)).rgba]).toEqual([...image.rgba]);
    }
    const map = paintGround(fixture, { tile: MAP_TILE, style: "smooth", grain: false });
    expect([map.width, map.height]).toEqual([6 * MAP_TILE, 4 * MAP_TILE]);
  });

  it("draws flat squares in the map's colours when asked for squares without grain", () => {
    const fixture = world(["~~~~~~", "~~..gg", "~~..gg", "~~..gg"]);
    const image = paintGround(fixture, local("squares", false));
    // The middle of a sea cell, of a bare cell and of a grass cell, away from the shore.
    expect(at(image, 4, 4)).toBe(packed(SEA_HERE));
    expect(at(image, 3 * 8 + 4, 2 * 8 + 4)).toBe(packed(BARE[1]));
    expect(at(image, 5 * 8 + 4, 2 * 8 + 4)).toBe(packed(GRASS[1]));
    // Nothing but those, the lit slopes that face the sea floor to the north-west (as on
    // the report maps), the beach, and the outline of the shore.
    expect(new Set(census(image).keys())).toEqual(
      new Set([SEA_HERE, BARE[1], BARE[2], GRASS[1], GRASS[2], SHORE_OUTLINE].map(packed)),
    );
  });

  it("leaves the open sea its colour, with a lighter dash here and there", () => {
    for (const style of GROUND_STYLES) {
      const grained = paintGround(world(rows("~", 12, 8)), local(style));
      expect(census(grained).size).toBe(2);
      expect(share(grained, SEA_HERE)).toBeGreaterThan(0.97);
      const flat = paintGround(world(rows("~", 12, 8)), local(style, false));
      expect(census(flat).size).toBe(1);
    }
  });

  it("outlines the shore one pixel wide, and adds foam only with grain", () => {
    for (const style of GROUND_STYLES) {
      const image = paintGround(world(ISLAND), local(style));
      const outline = packed(SHORE_OUTLINE);
      const sea = packed(SEA_HERE);
      const colours = census(image);
      const edge = colours.get(outline) ?? 0;
      // An island of three cells a side has a shore of about 96 pixels.
      expect(edge).toBeGreaterThan(50);
      expect(edge).toBeLessThan(170);
      expect(at(image, 36, 36)).not.toBe(sea); // its middle is land
      expect(at(image, 0, 0)).toBe(sea);
      // Grain adds foam and pebbles; the outline is there without it.
      const flat = paintGround(world(ISLAND), local(style, false));
      expect(census(flat).get(outline)).toBe(edge);
      expect(census(image).size).toBeGreaterThan(census(flat).size);
    }
  });

  it("puts an interpolated shore where the height crosses the sea level, not on a cell's edge", () => {
    // Land four times as high as the sea is deep: the shore lies a fifth of the way out.
    const steep = world(ISLAND, 200, (_x, _y, water) => SEA_LEVEL + (water ? -DEPTH : 4 * LAND));
    const level = world(ISLAND);
    const land = (image: Pixels): number => {
      let count = 0;
      for (const [colour, pixels] of census(image)) {
        if (![packed(SEA_HERE), packed(SEA[1] ?? ""), packed(SEA[0] ?? "")].includes(colour)) {
          count += pixels;
        }
      }
      return count;
    };
    const flat = { tile: MID_TILE, style: "smooth", grain: false } as const;
    expect(land(paintGround(steep, flat))).toBeGreaterThan(land(paintGround(level, flat)) * 1.25);
    // Squares do not care how high the land is.
    const squares = { ...flat, style: "squares" } as const;
    expect(land(paintGround(steep, squares))).toBe(land(paintGround(level, squares)));
  });

  it("shades relief by the slope toward the light, and bands the sea by depth", () => {
    // Rising toward the south-east: every slope faces the light (which is north-west)... away.
    const rising = world(rows(".", 8, 8), 200, (x, y) => SEA_LEVEL + 0.05 + 0.02 * (x + y));
    const falling = world(rows(".", 8, 8), 200, (x, y) => SEA_LEVEL + 0.4 - 0.02 * (x + y));
    for (const style of ["squares", "smooth"] as const) {
      const options = { tile: MID_TILE, style, grain: false };
      // Height gained walking toward the light is positive where the land falls away from it.
      expect(at(paintGround(rising, options), 36, 36)).toBe(packed(BARE[2]));
      expect(at(paintGround(falling, options), 36, 36)).toBe(packed(BARE[0]));
    }
    // A sea floor that drops to the east: shallow water first, then band after band.
    const shelf = world(rows("~", 12, 2), 200, (x) => SEA_LEVEL - 0.01 - 0.03 * x);
    const image = paintGround(shelf, { tile: MID_TILE, style: "smooth", grain: false });
    const seen: number[] = [];
    for (let x = 0; x < image.width; x++) {
      const colour = at(image, x, 8);
      if (seen[seen.length - 1] !== colour) seen.push(colour);
    }
    expect(seen).toEqual(SEA.map(packed));
  });

  it("turns bare heights to rock and snow", () => {
    const peak = world(rows(".", 4, 4), 200, () => SEA_LEVEL + 0.5);
    const rock = world(rows(".", 4, 4), 200, () => SEA_LEVEL + 0.35);
    const flat = { tile: MID_TILE, style: "smooth", grain: false } as const;
    expect(at(paintGround(peak, flat), 16, 16)).toBe(packed("#e6edf2"));
    expect(at(paintGround(rock, flat), 16, 16)).toBe(packed("#98928c"));
  });

  it("thickens the grass with its biomass, and shows the soil where it is thin", () => {
    for (const style of ["warped", "blended"] as const) {
      const thin = paintGround(world(rows("g", 8, 8), 90), local(style));
      const thick = paintGround(world(rows("g", 8, 8), 250), local(style));
      expect(share(thin, GRASS[1])).toBeGreaterThan(0.1);
      expect(share(thick, GRASS[1])).toBeGreaterThan(share(thin, GRASS[1]) + 0.2);
      expect(share(thin, BARE[1])).toBeGreaterThan(0.2);
    }
    // On the map there is no grain: grass is its flat colour, however thin.
    const map = paintGround(world(rows("g", 8, 8), 90), local("smooth", false));
    expect(share(map, GRASS[1])).toBe(1);
  });

  it("gives woods a darker floor up close and their own colour on the map", () => {
    const [dark, mid] = PALETTE["BROADLEAF"] ?? ["", ""];
    const close = paintGround(world(rows("b", 8, 8), 220), local("smooth"));
    expect(share(close, dark)).toBeGreaterThan(0.4);
    expect(share(close, mid)).toBeLessThan(0.1); // only a fleck here and there
    const map = paintGround(world(rows("b", 8, 8), 220), local("smooth", false));
    expect(share(map, mid)).toBe(1);
  });

  it("cuts the border between two kinds of ground, or blends it", () => {
    const halves = world(rows("....gggg", 1, 8), 255);
    /** Along the middle row of pixels: how often the colour changes between soil and grass. */
    const changes = (style: GroundStyle): number => {
      const image = paintGround(halves, local(style, false));
      let count = 0;
      for (let x = 1; x < image.width; x++) {
        if (at(image, x, 30) !== at(image, x - 1, 30)) count += 1;
      }
      return count;
    };
    expect(changes("squares")).toBe(1);
    expect(changes("smooth")).toBe(1);
    // Dithered: the two alternate over a few pixels before one gives way.
    expect(changes("blended")).toBeGreaterThan(2);
  });

  it("lets a border wander in every style but squares", () => {
    const halves = world(rows("....gggg", 1, 12), 255);
    for (const style of GROUND_STYLES) {
      const image = paintGround(halves, local(style, false));
      const edges = new Set<number>();
      for (let y = 0; y < image.height; y++) {
        let first = image.width;
        for (let x = image.width - 1; x >= 0; x--) {
          if (at(image, x, y) === packed(GRASS[1])) first = x;
        }
        edges.add(first);
      }
      if (style === "squares") expect([...edges]).toEqual([4 * MID_TILE]);
      else expect(edges.size).toBeGreaterThan(2);
      for (const edge of edges) expect(Math.abs(edge - 4 * MID_TILE)).toBeLessThan(8);
    }
  });

  it("gives a closer view a wider shore and finer edges, on the same land", () => {
    const fixture = world(ISLAND);
    const mid = paintGround(fixture, local("blended"));
    const near = paintGround(fixture, { tile: 4 * MID_TILE, style: "blended", grain: true });
    expect([near.width, near.height]).toEqual([4 * mid.width, 4 * mid.height]);
    const outline = packed(SHORE_OUTLINE);
    // Still an outline of one pixel: four times as long, not sixteen times as much.
    const ratio = (census(near).get(outline) ?? 0) / (census(mid).get(outline) ?? 1);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(6.5);
    // Sand the sea has just left, which the middle view has no room for.
    const wet = [...census(near).keys()].filter((colour) => !census(mid).has(colour));
    expect(wet.length).toBeGreaterThan(0);
    // The land is where it was: as much of the picture is sea.
    const sea = (image: Pixels): number => share(image, SEA_HERE);
    expect(Math.abs(sea(near) - sea(mid))).toBeLessThan(0.06);
  });

  it("paints part of the world as it paints the whole", () => {
    const fixture = world(["~~~~~~~~", "~..gg..~", "~.bbcc.~", "~..ss..~", "~~~~~~~~"]);
    for (const style of GROUND_STYLES) {
      const whole = paintGround(fixture, local(style));
      const cells = { x0: 2, y0: 1, x1: 6, y1: 4 };
      const part = paintGround(fixture, { ...local(style), cells });
      expect([part.width, part.height]).toEqual([4 * MID_TILE, 3 * MID_TILE]);
      // Away from the part's own edge, where the shore's outline has nothing to meet.
      for (let y = 2; y < part.height - 2; y++) {
        for (let x = 2; x < part.width - 2; x++) {
          expect(at(part, x, y)).toBe(at(whole, x + 2 * MID_TILE, y + MID_TILE));
        }
      }
    }
  });
});

describe("valueNoise", () => {
  it("stays in range, hits its corners and runs smoothly between them", () => {
    let low = 1;
    let high = 0;
    for (let i = 0; i < 400; i++) {
      const value = valueNoise(i * 0.37, i * 0.11, 3);
      low = Math.min(low, value);
      high = Math.max(high, value);
      expect(Math.abs(valueNoise(i * 0.37 + 0.01, i * 0.11, 3) - value)).toBeLessThan(0.03);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(1);
    expect(high - low).toBeGreaterThan(0.5);
    expect(valueNoise(2.5, 7.25, 1)).toBe(valueNoise(2.5, 7.25, 1));
    expect(valueNoise(2.5, 7.25, 1)).not.toBe(valueNoise(2.5, 7.25, 2));
  });
});
