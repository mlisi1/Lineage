/** Small hand-drawn worlds for tests. */
import type { Ramp, WorldFixture } from "../../src/spike/fixture";
import { hexToRgb } from "../../src/spike/pixelart";

const CLASSES = ["WATER", "BARE", "LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER", "BURNT"];

/** The ramps of the report maps, as the fixture carries them. */
export const PALETTE: Readonly<Record<string, Ramp>> = {
  BARE: ["#8f7f68", "#b3a188", "#cdbd9f"],
  LICHEN: ["#8b9a7a", "#a9b792", "#c3cfa8"],
  GRASS: ["#6f9a3f", "#8fbf4f", "#aad468"],
  SHRUB: ["#4f7d3a", "#6a9a45", "#84b356"],
  BROADLEAF: ["#2f6230", "#3f7d3a", "#55964a"],
  CONIFER: ["#1f4a3a", "#2b6149", "#3a7a5a"],
  BURNT: ["#3a302b", "#4f423a", "#66564b"],
  DORMANT: ["#8f8448", "#b3a65c", "#cdc177"],
};
export const SEA = ["#8ecbe6", "#5aa7d6", "#3b7fbf", "#2c5f9e", "#1f437a"];
export const SHORE_OUTLINE = "#3d3528";

/** A world from a picture: one letter per cell. Every plant has biomass `biomass`. */
export function world(rows: readonly string[], biomass = 200): WorldFixture {
  const letters: Record<string, string> = {
    "~": "WATER",
    ".": "BARE",
    l: "LICHEN",
    g: "GRASS",
    s: "SHRUB",
    b: "BROADLEAF",
    c: "CONIFER",
  };
  const width = rows[0]?.length ?? 0;
  const cover = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      cover[y * width + x] = CLASSES.indexOf(letters[letter] ?? "BARE");
    });
  });
  return {
    width,
    height: rows.length,
    cover,
    biomass: new Uint8Array(cover.length).fill(biomass),
    coverClasses: CLASSES,
    palette: PALETTE,
    sea: SEA,
    dormantBelow: 77,
    dormantClasses: ["LICHEN", "GRASS", "SHRUB"],
    creatures: [],
    casts: [],
    herbivoreMaxDiet: 0.35,
    predatorMinDiet: 0.65,
    description: "",
  };
}

/** Sea in the north-west, grassland, a mixed wood, and a shore with a bit of everything. */
export const MAP = world([
  "~~~~........gggggggg....",
  "~~~~........gggggggg....",
  "~~~~........gggggggg....",
  "~~~~........gggggggg....",
  "bcbcbcbc................",
  "cbcbcbcb................",
  "bcbcbcbc................",
  "cbcbcbcb................",
  "................ssssss~~",
  "................gggggg~~",
  "................bbbbbb~~",
  "................cccccc~~",
]);

/**
 * The two map bitmaps of a world, as RGBA: the bare ground (the shore outlined, as in
 * the report maps) and the same with every plant in the middle tone of its ramp.
 */
export function bitmaps(fixture: WorldFixture): {
  terrain: Uint8ClampedArray;
  map: Uint8ClampedArray;
} {
  const { width, height, cover, coverClasses } = fixture;
  const terrain = new Uint8ClampedArray(width * height * 4);
  const map = new Uint8ClampedArray(width * height * 4);
  const kind = (x: number, y: number): string =>
    x < 0 || y < 0 || x >= width || y >= height
      ? ""
      : (coverClasses[cover[y * width + x] ?? 0] ?? "");
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const name = kind(x, y);
      const coastal = [kind(x - 1, y), kind(x + 1, y), kind(x, y - 1), kind(x, y + 1)].includes(
        "WATER",
      );
      const ground =
        name === "WATER" ? (SEA[2] ?? "") : coastal ? SHORE_OUTLINE : PALETTE["BARE"]?.[1];
      const grown = name === "WATER" || name === "BARE" ? ground : PALETTE[name]?.[1];
      terrain.set([...hexToRgb(ground ?? "#000000"), 255], (y * width + x) * 4);
      map.set([...hexToRgb(grown ?? "#000000"), 255], (y * width + x) * 4);
    }
  }
  return { terrain, map };
}
