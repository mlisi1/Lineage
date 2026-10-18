/** Where the look sheet points its camera: the window of the map that best shows something. */
import type { CellRect } from "./camera";
import type { WorldFixture } from "./fixture";

/** Share of a window's cells in each land-cover class, by class name. */
export type Shares = Readonly<Record<string, number>>;

/** Windows are tried every this many cells. */
const STEP_CELLS = 4;

/**
 * The `width` × `height` window of cells that scores highest. Ties go to the first found,
 * scanning rows from the top, so the answer never depends on anything but the world.
 */
export function findSite(
  fixture: WorldFixture,
  width: number,
  height: number,
  score: (shares: Shares, window: CellRect) => number,
): CellRect {
  const classes = fixture.coverClasses;
  let best = -Infinity;
  let site: CellRect = { x0: 0, y0: 0, x1: width, y1: height };
  for (let y0 = 0; y0 + height <= fixture.height; y0 += STEP_CELLS) {
    for (let x0 = 0; x0 + width <= fixture.width; x0 += STEP_CELLS) {
      const counts = new Array<number>(classes.length).fill(0);
      for (let y = y0; y < y0 + height; y++) {
        for (let x = x0; x < x0 + width; x++) {
          const cover = fixture.cover[y * fixture.width + x] ?? 0;
          counts[cover] = (counts[cover] ?? 0) + 1;
        }
      }
      const shares: Record<string, number> = {};
      classes.forEach((name, index) => {
        shares[name] = (counts[index] ?? 0) / (width * height);
      });
      const window = { x0, y0, x1: x0 + width, y1: y0 + height };
      const value = score(shares, window);
      if (value > best) {
        best = value;
        site = window;
      }
    }
  }
  return site;
}

const share = (shares: Shares, name: string): number => shares[name] ?? 0;
const trees = (shares: Shares): number => share(shares, "BROADLEAF") + share(shares, "CONIFER");

/** Open grassland: grass, few trees, no sea. */
export const meadow = (shares: Shares): number =>
  share(shares, "GRASS") - 2 * trees(shares) - 3 * share(shares, "WATER");

/** Woodland: as many trees as possible, of both kinds if the world has them. */
export const forest = (shares: Shares): number =>
  trees(shares) +
  Math.min(share(shares, "BROADLEAF"), share(shares, "CONIFER")) -
  share(shares, "WATER");

/** A shore with a bit of everything: a quarter sea, the rest as mixed as it comes. */
export const shore = (shares: Shares): number =>
  -2 * Math.abs(share(shares, "WATER") - 0.25) +
  Math.min(trees(shares), 0.2) +
  Math.min(share(shares, "GRASS"), 0.25) +
  Math.min(share(shares, "SHRUB"), 0.2);
