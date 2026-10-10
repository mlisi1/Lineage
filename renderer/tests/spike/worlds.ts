/** Small hand-drawn worlds for tests. */
import type { WorldFixture } from "../../src/spike/fixture";

const CLASSES = ["WATER", "BARE", "LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER", "BURNT"];

/** A world from a picture: one letter per cell. */
export function world(rows: readonly string[]): WorldFixture {
  const letters: Record<string, string> = {
    "~": "WATER",
    ".": "BARE",
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
    biomass: new Uint8Array(cover.length).fill(200),
    coverClasses: CLASSES,
    palette: {},
    sea: [],
    dormantBelow: 0,
    dormantClasses: [],
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
