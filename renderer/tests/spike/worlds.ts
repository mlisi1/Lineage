/** Small hand-drawn worlds for tests. */
import type { Ramp, WorldFixture } from "../../src/spike/fixture";

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

/** How high the sea stands in these worlds, and how far land and sea floor lie from it. */
export const SEA_LEVEL = 0.4;
export const LAND = 0.1;
export const DEPTH = 0.1;

/**
 * A world from a picture: one letter per cell. Every plant has biomass `biomass`; land
 * lies `LAND` above the sea and the sea floor `DEPTH` below it, unless `heightOf` says
 * otherwise.
 */
export function world(
  rows: readonly string[],
  biomass = 200,
  heightOf?: (x: number, y: number, water: boolean) => number,
): WorldFixture {
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
  const heights = new Float32Array(width * rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      cover[y * width + x] = CLASSES.indexOf(letters[letter] ?? "BARE");
      const water = letter === "~";
      heights[y * width + x] =
        heightOf?.(x, y, water) ?? (water ? SEA_LEVEL - DEPTH : SEA_LEVEL + LAND);
    });
  });
  return {
    width,
    height: rows.length,
    heights,
    seaLevel: SEA_LEVEL,
    relief: {
      seaBands: [0.02, 0.06, 0.14, 0.26, 9.99].map((limit, band) => ({
        limit,
        colour: SEA[band] ?? "",
      })),
      slope: 0.012,
      highRockFrom: 0.3,
      highRock: ["#77716c", "#98928c", "#b5b0aa"],
      snowFrom: 0.46,
      snow: ["#c9d3dc", "#e6edf2", "#ffffff"],
      shoreOutline: SHORE_OUTLINE,
    },
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
