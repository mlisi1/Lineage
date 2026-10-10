import { describe, expect, it } from "vitest";
import { TILE, paintGround } from "../../src/spike/ground";
import {
  cellHash,
  hexToRgb,
  plantLook,
  plantOffset,
  standsAlone,
  type Pixels,
} from "../../src/spike/pixelart";
import { PALETTE, SEA, SHORE_OUTLINE, bitmaps, world } from "./worlds";

const DORMANT = ["LICHEN", "GRASS", "SHRUB"];
const rows = (letter: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => letter.repeat(width));
const packed = (colour: string): number => {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
};
/** A soil colour with its pebble and its lighter grain, as the painter shades them. */
function grains(colour: string): number[] {
  const scaled = (factor: number): number =>
    hexToRgb(colour)
      .map((value) => Math.min(255, Math.round(value * factor)))
      .reduce((all, value) => (all << 8) | value, 0);
  return [packed(colour), scaled(0.86), scaled(1.08)];
}
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
const paint = (fixture: ReturnType<typeof world>): Pixels => {
  const { terrain, map } = bitmaps(fixture);
  return paintGround(fixture, terrain, map);
};
const share = (image: Pixels, colour: string): number =>
  (census(image).get(packed(colour)) ?? 0) / (image.width * image.height);

describe("paintGround", () => {
  it("paints eight opaque pixels per cell, the same every time", () => {
    const fixture = world(["~~~~~~", "~.gb.~", "~.sc.~", "~~~~~~"]);
    const image = paint(fixture);
    expect([image.width, image.height]).toEqual([6 * TILE, 4 * TILE]);
    for (let i = 3; i < image.rgba.length; i += 4) expect(image.rgba[i]).toBe(255);
    expect([...paint(fixture).rgba]).toEqual([...image.rgba]);
  });

  it("leaves the open sea its colour, with a lighter dash here and there", () => {
    const image = paint(world(rows("~", 12, 8)));
    const colours = census(image);
    expect(colours.size).toBe(2);
    expect(share(image, SEA[2] ?? "")).toBeGreaterThan(0.97);
  });

  it("draws the shore as sand, a one-pixel outline, then foam", () => {
    const fixture = world([...rows("~", 9, 3), ...rows("~~~...~~~", 1, 3), ...rows("~", 9, 3)]);
    const image = paint(fixture);
    const outline = packed(SHORE_OUTLINE);
    const sand = packed(PALETTE["BARE"]?.[2] ?? "");
    const sea = packed(SEA[2] ?? "");
    const colours = census(image);
    // All but the middle cell of the island is coast, and sand.
    expect(colours.get(sand)).toBeGreaterThan(200);
    expect(colours.get(outline)).toBeGreaterThan(40);
    const inland = grains(PALETTE["BARE"]?.[1] ?? "");
    expect(inland).toContain(at(image, 36, 36));
    expect(at(image, 0, 0)).toBe(sea);
    // Every outline pixel is the last of the land: it touches water.
    const land = new Set([outline, ...inland, ...grains(PALETTE["BARE"]?.[2] ?? "")]);
    let foam = 0;
    for (let y = 1; y < image.height - 1; y++) {
      for (let x = 1; x < image.width - 1; x++) {
        const around = [
          at(image, x - 1, y),
          at(image, x + 1, y),
          at(image, x, y - 1),
          at(image, x, y + 1),
        ];
        if (at(image, x, y) === outline) {
          expect(around.some((colour) => !land.has(colour))).toBe(true);
        } else if (!land.has(at(image, x, y)) && at(image, x, y) !== sea) {
          foam += 1; // neither land nor plain sea: foam or a wave
        }
      }
    }
    expect(foam).toBeGreaterThan(40);
    // The outline is one pixel wide: far fewer outline pixels than the island has pixels.
    expect(colours.get(outline) ?? 0).toBeLessThan(0.25 * (colours.get(sand) ?? 0));
  });

  it("thickens the grass with its biomass", () => {
    const grass = PALETTE["GRASS"]?.[1] ?? "";
    const thin = share(paint(world(rows("g", 8, 8), 90)), grass);
    const thick = share(paint(world(rows("g", 8, 8), 250)), grass);
    expect(thin).toBeGreaterThan(0.1);
    expect(thick).toBeGreaterThan(thin + 0.2);
    // Where the grass is thin the soil shows.
    expect(share(paint(world(rows("g", 8, 8), 90)), PALETTE["BARE"]?.[1] ?? "")).toBeGreaterThan(
      0.2,
    );
  });

  it("gives woods a darker floor and every tree a shadow", () => {
    const image = paint(world(rows("b", 8, 8), 220));
    const [dark, mid] = PALETTE["BROADLEAF"] ?? ["", ""];
    expect(share(image, dark)).toBeGreaterThan(0.4);
    expect(share(image, mid)).toBeLessThan(0.1); // only a fleck here and there
    const shadow = [...census(image).keys()].filter((colour) => {
      const [r, g, b] = [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
      const [dr, dg, db] = hexToRgb(dark);
      return r < dr && g < dg && b < db;
    });
    expect(shadow.length).toBeGreaterThan(0);
    // Lichen is ground: nothing stands on it, nothing is shaded.
    const lichen = census(paint(world(rows("l", 8, 8), 220)));
    const tones = new Set([...(PALETTE["LICHEN"] ?? []), ...(PALETTE["BARE"] ?? [])].map(packed));
    const strangers = [...lichen.keys()].filter((colour) => !tones.has(colour));
    expect(strangers.length).toBeLessThanOrEqual(2); // a pebble and a lighter grain of soil
  });

  it("lets the border between two cells wander", () => {
    const image = paint(world(rows("....gggg", 1, 12), 255));
    const soil = new Set(grains(PALETTE["BARE"]?.[1] ?? ""));
    // In each row of pixels, where the last soil pixel of the bare half is.
    const edges = new Set<number>();
    for (let y = 0; y < image.height; y++) {
      let last = 0;
      for (let x = 0; x < image.width; x++) if (soil.has(at(image, x, y)) && x < 5 * TILE) last = x;
      edges.add(last);
    }
    expect(edges.size).toBeGreaterThan(3);
    for (const edge of edges) {
      expect(edge).toBeGreaterThan(4 * TILE - 6);
      expect(edge).toBeLessThan(4 * TILE + 8); // a patch of thin growth may show soil a little further
    }
  });
});

describe("plants that stand alone", () => {
  const look = (kind: string, biomass: number): NonNullable<ReturnType<typeof plantLook>> => {
    const found = plantLook(kind, biomass, 3, 4, 77, DORMANT);
    if (found === null) throw new Error("no plant");
    return found;
  };

  it("are every tree, shrubs in leaf, and one tuft of grown grass in three", () => {
    expect(standsAlone(look("BROADLEAF", 40), 3, 4)).toBe(true);
    expect(standsAlone(look("CONIFER", 240), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 200), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 40), 3, 4)).toBe(false); // died back
    expect(standsAlone(look("LICHEN", 240), 3, 4)).toBe(false);
    let tufts = 0;
    for (let x = 0; x < 300; x++) {
      expect(standsAlone(look("GRASS", 100), x, 9)).toBe(false); // young grass is ground
      if (standsAlone(look("GRASS", 240), x, 9)) tufts += 1;
    }
    expect(tufts).toBeGreaterThan(70);
    expect(tufts).toBeLessThan(130);
  });

  it("stand a little off the middle of their cell, always the same way", () => {
    const seen = new Set<string>();
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const [dx, dy] = plantOffset(x, y);
        expect(Number.isInteger(dx) && dx >= -2 && dx <= 2).toBe(true);
        expect(Number.isInteger(dy) && dy >= -2 && dy <= 1).toBe(true);
        seen.add(`${dx},${dy}`);
      }
    }
    expect(seen.size).toBe(20); // every offset is used
    expect(plantOffset(7, 9)).toEqual(plantOffset(7, 9));
  });

  it("hashes a cell to a number in [0, 1) that the salt changes", () => {
    const values = Array.from({ length: 2000 }, (_, i) => cellHash(i % 50, Math.floor(i / 50), 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1));
    expect(cellHash(3, 4, 1)).not.toBe(cellHash(3, 4, 2));
    expect(cellHash(-5, -9, 1)).toBeGreaterThanOrEqual(0); // off the map is fine too
  });
});
